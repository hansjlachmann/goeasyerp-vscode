import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { parse } from 'yaml';
import { appDirectory } from '../app/application';
import { AppError } from '../base/problems';
import type { BaseWorkspace } from '../base/workspace';
import { PublishAdapter, type Request } from '../debug/adapter';
import { messages } from '../messages';
import { passwordKey } from '../password';
import { publishPackage, unpublishApp, type FollowOptions } from '../publish/build';
import {
  DEFAULT_CONFIGURATION,
  readTarget,
  requestAddress,
  startPage,
  type Target,
} from '../publish/config';
import { Session } from '../publish/session';
import { AuditRefused, ServerClient } from '../server/client';
import { compareVersions, isVersion, MIN_BASE_VERSION } from '../version';
import type { BaseCommands } from './base';
import type { CompileCommands } from './compile';

const TYPE = 'goeasyerp';

interface Connection {
  client: ServerClient;
  session: Session;
  version: string;
}

/** F5 and Ctrl+F5 publish the app; the command to unpublish it. */
export class PublishCommands
  implements vscode.DebugConfigurationProvider, vscode.DebugAdapterDescriptorFactory
{
  private busy = false;

  constructor(
    private readonly base: BaseCommands,
    private readonly compiler: CompileCommands,
    private readonly secrets: vscode.SecretStorage,
    private readonly output: vscode.OutputChannel,
  ) {}

  register(): vscode.Disposable[] {
    return [
      vscode.debug.registerDebugConfigurationProvider(TYPE, this),
      vscode.debug.registerDebugAdapterDescriptorFactory(TYPE, this),
      vscode.commands.registerCommand('goeasyerp.unpublishApp', () => this.unpublish()),
    ];
  }

  /** F5 without a launch.json publishes to a local container. */
  resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    configuration: vscode.DebugConfiguration,
  ): vscode.DebugConfiguration {
    return configuration.type ? configuration : { ...DEFAULT_CONFIGURATION };
  }

  resolveDebugConfigurationWithSubstitutedVariables(
    _folder: vscode.WorkspaceFolder | undefined,
    configuration: vscode.DebugConfiguration,
  ): vscode.DebugConfiguration | undefined {
    try {
      readTarget(configuration);
      return configuration;
    } catch (error) {
      this.showError(reason(error));
      return undefined;
    }
  }

  createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.DebugAdapterDescriptor {
    const messagesOut = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    const adapter = new PublishAdapter(
      (message) => messagesOut.fire(message),
      (noDebug, signal) => this.publish(session.configuration, !noDebug, signal),
    );
    return new vscode.DebugAdapterInlineImplementation({
      onDidSendMessage: messagesOut.event,
      handleMessage: (message) => adapter.handle(message as Request),
      dispose: () => adapter.dispose(),
    });
  }

  /** Compiles, publishes, waits until the server runs the build, and opens the browser. */
  private async publish(
    configuration: vscode.DebugConfiguration,
    mayOpen: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    await this.run(signal, async (workspace, report, abort) => {
      const target = readTarget(configuration);
      await vscode.workspace.saveAll(false);
      this.output.clear();
      this.output.show(true);

      report(messages.connecting(target.server));
      // Logged in first, so that the password is asked for before the wait.
      const { client, session, version } = await this.connect(target, abort);

      report(messages.compiling);
      const result = await this.compiler.run(workspace, version, {
        signal: abort,
        write: (text) => this.output.appendLine(text),
      });
      if (!result.package) {
        throw new Error(messages.compileFailed);
      }

      report(messages.uploading);
      const zip = await readFile(result.package);
      let build: number;
      try {
        build = await publishPackage(session, client, zip, this.follow(report, abort));
      } catch (error) {
        if (error instanceof AuditRefused) {
          this.showFindings(workspace, error);
        }
        throw error;
      }

      const published = messages.published(build, target.server);
      this.output.appendLine(published);
      if (mayOpen && target.openBrowser) {
        await vscode.env.openExternal(vscode.Uri.parse(startPage(target)));
      } else {
        this.showInfo(published, startPage(target));
      }
    });
  }

  private async unpublish(): Promise<void> {
    const configuration = await this.pickConfiguration();
    if (!configuration) {
      return;
    }
    await this.run(undefined, async (workspace, report, abort) => {
      const target = readTarget(configuration);
      const manifest = await readFile(
        join(appDirectory(workspace.app), 'application.yaml'),
        'utf8',
      );
      const { application } = (parse(manifest) ?? {}) as {
        application?: { id?: unknown; name?: unknown };
      };
      if (typeof application?.id !== 'string') {
        throw new Error(messages.noAppId);
      }
      const name = String(application.name);
      const choice = await vscode.window.showWarningMessage(
        messages.confirmUnpublish(name, target.server),
        { modal: true },
        messages.unpublish,
      );
      if (choice !== messages.unpublish) {
        return;
      }
      this.output.show(true);
      report(messages.connecting(target.server));
      const { client, session } = await this.connect(target, abort);
      const build = await unpublishApp(session, client, application.id, this.follow(report, abort));
      const done = messages.unpublished(name, build);
      this.output.appendLine(done);
      this.showInfo(done, startPage(target));
    });
  }

  /** One publish at a time, with a cancellable notification; errors go to the user. */
  private async run(
    signal: AbortSignal | undefined,
    task: (
      workspace: BaseWorkspace,
      report: (step: string) => void,
      signal: AbortSignal,
    ) => Promise<void>,
  ): Promise<void> {
    if (this.busy) {
      void vscode.window.showWarningMessage(messages.publishBusy);
      return;
    }
    this.busy = true;
    try {
      const workspace = await this.base.open();
      if (!workspace) {
        void vscode.window.showInformationMessage(messages.noApp);
        return;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'GoEasyERP',
          cancellable: true,
        },
        (progress, token) => {
          const cancelled = new AbortController();
          token.onCancellationRequested(() => cancelled.abort());
          const abort = signal ? AbortSignal.any([signal, cancelled.signal]) : cancelled.signal;
          return task(workspace, (message) => progress.report({ message }), abort);
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.output.appendLine(messages.publishStopped);
      } else {
        this.output.appendLine(reason(error));
        // errors of the merge have been shown, with their places
        if (!(error instanceof AppError)) {
          this.showError(reason(error));
        }
      }
    } finally {
      this.busy = false;
    }
  }

  /** The server's version, and a logged-in session. */
  private async connect(target: Target, signal: AbortSignal): Promise<Connection> {
    const client = new ServerClient(requestAddress(target.server));
    let version: string;
    try {
      ({ version } = await client.version(signal));
    } catch {
      signal.throwIfAborted();
      throw new Error(messages.serverUnreachable(target.server));
    }
    if (!isVersion(version) || compareVersions(version, MIN_BASE_VERSION) < 0) {
      throw new Error(messages.serverTooOld(target.server, version, MIN_BASE_VERSION));
    }
    const key = passwordKey(target.server, target.user);
    const session = new Session(client, target.user, target.company, {
      stored: () => Promise.resolve(this.secrets.get(key)),
      ask: (problem) => this.askPassword(target, problem),
      keep: async (password) => {
        await this.secrets.store(key, password);
      },
    });
    await session.login();
    return { client, session, version };
  }

  private async askPassword(target: Target, problem?: string): Promise<string | undefined> {
    const prompt = messages.loginPassword(target.user, target.server);
    const password = await vscode.window.showInputBox({
      prompt: problem ? `${problem} ${prompt}` : prompt,
      password: true,
      ignoreFocusOut: true,
    });
    return password || undefined;
  }

  private follow(report: (step: string) => void, signal: AbortSignal): FollowOptions {
    return {
      signal,
      onLog: (text) => this.output.append(text),
      onStep: (step) => report(messages.building(step)),
    };
  }

  private showFindings(workspace: BaseWorkspace, refused: AuditRefused): void {
    const directory = appDirectory(workspace.app);
    const findings = refused.findings.map((finding) => ({
      file: join(directory, finding.file || 'application.yaml'),
      line: finding.line || 1,
      message: `[${finding.rule}] ${finding.detail} (${finding.key})`,
      excepted: finding.excepted === true,
    }));
    for (const finding of findings) {
      this.output.appendLine(`${finding.file}, line ${finding.line}: ${finding.message}`);
    }
    this.compiler.showFindings(findings);
  }

  private async pickConfiguration(): Promise<vscode.DebugConfiguration | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const configurations = folders.flatMap((folder) =>
      vscode.workspace
        .getConfiguration('launch', folder.uri)
        .get<vscode.DebugConfiguration[]>('configurations', [])
        .filter((configuration) => configuration.type === TYPE),
    );
    if (configurations.length <= 1) {
      return configurations[0] ?? { ...DEFAULT_CONFIGURATION };
    }
    const picked = await vscode.window.showQuickPick(
      configurations.map((configuration) => ({
        label: configuration.name,
        description: String(configuration.server),
        configuration,
      })),
      { placeHolder: messages.pickConfiguration },
    );
    return picked?.configuration;
  }

  private showInfo(text: string, page: string): void {
    void vscode.window.showInformationMessage(text, messages.openBrowser).then((choice) => {
      if (choice) {
        void vscode.env.openExternal(vscode.Uri.parse(page));
      }
    });
  }

  private showError(text: string): void {
    void vscode.window
      .showErrorMessage(messages.failed(text), messages.showOutput)
      .then((choice) => {
        if (choice) {
          this.output.show();
        }
      });
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
