import { join, relative } from 'node:path';
import * as vscode from 'vscode';
import { appDirectory, findApp } from '../app/application';
import { launchServer } from '../base/launch';
import { AppError, type Problem } from '../base/problems';
import { BaseWorkspace, type SyncOptions, type Toolchains } from '../base/workspace';
import { fetchVersions } from '../container/releases';
import type { GoToolchain } from '../go/toolchain';
import { messages } from '../messages';
import { LatestQueue } from '../queue';
import type { Runner } from '../runner';
import { ServerClient } from '../server/client';
import { compareVersions, isVersion, MIN_BASE_VERSION } from '../version';

const DEBOUNCE = 1500;

/** Keeps the merged base of the workspace's app up to date. */
export class BaseCommands implements vscode.Disposable {
  private readonly queue = new LatestQueue();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('goeasyerp');
  private readonly watched: vscode.Disposable[] = [];
  private workspace: BaseWorkspace | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly toolchains: Toolchains,
    private readonly run: Runner,
    private readonly goStorage: string,
    private readonly environment: vscode.GlobalEnvironmentVariableCollection,
    private readonly output: vscode.OutputChannel,
  ) {}

  register(): vscode.Disposable[] {
    return [vscode.commands.registerCommand('goeasyerp.downloadBase', () => this.download()), this];
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const watcher of this.watched) {
      watcher.dispose();
    }
    this.diagnostics.dispose();
  }

  /** At startup: brings a set-up app up to date, or offers to set one up. */
  async activate(): Promise<void> {
    const workspace = await this.open();
    if (!workspace) {
      return;
    }
    if (await workspace.lastVersion()) {
      await this.sync(workspace, true);
    } else {
      const choice = await vscode.window.showInformationMessage(
        messages.offerDownload,
        messages.downloadBase,
      );
      if (choice) {
        await this.sync(workspace, true);
      }
    }
  }

  private async download(): Promise<void> {
    const workspace = await this.open();
    if (!workspace) {
      void vscode.window.showInformationMessage(messages.noApp);
      return;
    }
    await this.sync(workspace, true);
  }

  /** The first app among the workspace's folders; its files are watched from then on. */
  private async open(): Promise<BaseWorkspace | undefined> {
    if (this.workspace) {
      return this.workspace;
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const app = await findApp(folder.uri.fsPath);
      if (!app) {
        continue;
      }
      const workspace = new BaseWorkspace(app, this.toolchains, this.run);
      this.workspace = workspace;
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(appDirectory(app), '**/{*.yaml,*.yml,go.mod}'),
      );
      const changed = (uri: vscode.Uri) => {
        const path = relative(appDirectory(app), uri.fsPath);
        // .goeasyerp holds the merge's own output.
        if (!path.split(/[\\/]/).some((part) => part.startsWith('.'))) {
          this.later(workspace);
        }
      };
      this.watched.push(
        watcher,
        watcher.onDidChange(changed),
        watcher.onDidCreate(changed),
        watcher.onDidDelete(changed),
      );
      return workspace;
    }
    return undefined;
  }

  private later(workspace: BaseWorkspace): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // Only an app that has been set up follows its changes.
      void workspace.lastVersion().then(async (version) => {
        if (version) {
          await this.sync(workspace, false);
        }
      });
    }, DEBOUNCE);
  }

  /** Merges one at a time. With askServer the server's version decides, else the last one. */
  private sync(workspace: BaseWorkspace, askServer: boolean): Promise<void> {
    return this.queue.add(async () => {
      try {
        const version = await this.version(workspace, askServer);
        if (!version) {
          return;
        }
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.preparingBase(version),
            cancellable: true,
          },
          (progress, token) => {
            const abort = new AbortController();
            token.onCancellationRequested(() => abort.abort());
            return workspace.sync(version, this.progress(progress, abort.signal));
          },
        );
        this.diagnostics.clear();
        await this.useToolchain(workspace, result.toolchain);
        if (result.changed) {
          await vscode.commands
            .executeCommand('go.languageserver.restart')
            .then(undefined, () => {});
        }
        this.output.appendLine(messages.baseReady(version));
      } catch (error) {
        this.report(error);
      }
    });
  }

  private progress(
    progress: vscode.Progress<{ message?: string }>,
    signal: AbortSignal,
  ): SyncOptions {
    let step = '';
    return {
      signal,
      onStep: (name) => {
        step = messages.step[name];
        progress.report({ message: step });
        this.output.appendLine(step);
      },
      onPercent: (percent) => progress.report({ message: `${step} ${percent}%` }),
      onOutput: (text) => this.output.append(text),
    };
  }

  private async version(workspace: BaseWorkspace, askServer: boolean): Promise<string | undefined> {
    const last = await workspace.lastVersion();
    if (!askServer && last) {
      return last;
    }
    const folder = vscode.Uri.file(workspace.app.root);
    const server = launchServer(
      vscode.workspace.getConfiguration('launch', folder).get('configurations'),
    );
    if (server) {
      try {
        const { version } = await new ServerClient(server).version(AbortSignal.timeout(5000));
        if (isVersion(version) && compareVersions(version, MIN_BASE_VERSION) >= 0) {
          return version;
        }
        this.output.appendLine(messages.serverTooOld(server, version, MIN_BASE_VERSION));
      } catch {
        this.output.appendLine(messages.serverUnreachable(server));
      }
    }
    return last ?? this.askVersion();
  }

  private async askVersion(): Promise<string | undefined> {
    const versions = await fetchVersions(AbortSignal.timeout(15_000)).catch(() => []);
    if (versions.length > 0) {
      return vscode.window.showQuickPick(versions, {
        placeHolder: messages.pickBaseVersion,
        ignoreFocusOut: true,
      });
    }
    return vscode.window.showInputBox({
      prompt: messages.enterVersion(MIN_BASE_VERSION),
      ignoreFocusOut: true,
      validateInput: (text) =>
        isVersion(text) && compareVersions(text, MIN_BASE_VERSION) >= 0
          ? undefined
          : messages.badVersion(MIN_BASE_VERSION),
    });
  }

  /** Points the Go extension, and the workspace's terminals and tasks, at the toolchain. */
  private async useToolchain(workspace: BaseWorkspace, toolchain: GoToolchain): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace.app.root));
    if (!folder) {
      return;
    }
    const config = vscode.workspace.getConfiguration('go', folder.uri);
    const current = config.inspect<string>('goroot')?.workspaceValue;
    const variables = this.environment.getScoped({ workspaceFolder: folder });
    if (toolchain.managed) {
      if (current !== toolchain.goroot) {
        await config.update('goroot', toolchain.goroot, vscode.ConfigurationTarget.Workspace);
      }
      variables.description = messages.terminalPath(toolchain.version);
      variables.prepend(
        'PATH',
        join(toolchain.goroot, 'bin') + (process.platform === 'win32' ? ';' : ':'),
      );
    } else {
      // The developer's own Go fits: remove what an earlier version of the base needed.
      if (current?.startsWith(this.goStorage)) {
        await config.update('goroot', undefined, vscode.ConfigurationTarget.Workspace);
      }
      variables.clear();
    }
  }

  private report(error: unknown): void {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    const text = error instanceof Error ? error.message : String(error);
    this.output.appendLine(text);
    if (error instanceof AppError) {
      this.show(error.problems);
    }
    const shown = error instanceof AppError ? messages.appErrors : messages.failed(text);
    void vscode.window.showErrorMessage(shown, messages.showOutput).then((choice) => {
      if (choice) {
        this.output.show();
      }
    });
  }

  private show(problems: Problem[]): void {
    this.diagnostics.clear();
    for (const file of new Set(problems.map((problem) => problem.file))) {
      this.diagnostics.set(
        vscode.Uri.file(file),
        problems
          .filter((problem) => problem.file === file)
          .map((problem) => {
            const line = Math.max(problem.line - 1, 0);
            const diagnostic = new vscode.Diagnostic(
              new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
              problem.message,
            );
            diagnostic.source = 'GoEasyERP';
            return diagnostic;
          }),
      );
    }
  }
}
