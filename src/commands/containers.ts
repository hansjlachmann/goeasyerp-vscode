import * as vscode from 'vscode';
import type { Docker } from '../container/docker';
import { ContainerManager, FIRST_USER, type Progress } from '../container/manager';
import { findFreePort, isPortFree } from '../container/ports';
import { fetchVersions } from '../container/releases';
import { serverUrl, type Container } from '../container/store';
import { messages } from '../messages';
import { passwordKey, passwordProblem } from '../password';
import { ServerError } from '../server/client';
import { compareVersions, isVersion, MIN_BASE_VERSION } from '../version';

const INSTALL_PAGES: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'https://docs.docker.com/desktop/setup/install/windows-install/',
  darwin: 'https://docs.docker.com/desktop/setup/install/mac-install/',
  linux: 'https://docs.docker.com/engine/install/',
};

type Report = (step: string) => void;

export class ContainerCommands {
  private busy = false;

  constructor(
    private readonly manager: ContainerManager,
    private readonly docker: Docker,
    private readonly secrets: vscode.SecretStorage,
    private readonly output: vscode.OutputChannel,
  ) {}

  register(): vscode.Disposable[] {
    const command = (name: string, action: () => Promise<void>) =>
      vscode.commands.registerCommand(name, () => this.guard(action));
    return [
      command('goeasyerp.createContainer', () => this.create()),
      command('goeasyerp.startContainer', () => this.start()),
      command('goeasyerp.stopContainer', () => this.stop()),
      command('goeasyerp.removeContainer', () => this.remove()),
    ];
  }

  /** One container operation at a time, with Docker present; errors go to the user. */
  private async guard(action: () => Promise<void>): Promise<void> {
    if (this.busy) {
      void vscode.window.showWarningMessage(messages.busy);
      return;
    }
    this.busy = true;
    try {
      if (await this.dockerReady()) {
        await action();
      }
    } catch (error) {
      this.showError(messages.failed(reason(error)));
    } finally {
      this.busy = false;
    }
  }

  private async dockerReady(): Promise<boolean> {
    const state = await this.docker.state();
    if (state === 'ready') {
      return true;
    }
    const text = {
      missing: messages.dockerMissing,
      unreachable: messages.dockerUnreachable,
      noCompose: messages.dockerNoCompose,
    }[state];
    const page = INSTALL_PAGES[process.platform] ?? INSTALL_PAGES.linux!;
    void vscode.window.showErrorMessage(text, messages.installDocker).then((choice) => {
      if (choice) {
        void vscode.env.openExternal(vscode.Uri.parse(page));
      }
    });
    return false;
  }

  private async create(): Promise<void> {
    const version = await this.askVersion();
    if (!version) {
      return;
    }
    const port = await this.askPort();
    if (!port) {
      return;
    }
    // Asked before the start, so that nobody has to wait for it to finish.
    const password = await this.askPassword();
    if (!password) {
      return;
    }

    let container: Container | undefined;
    try {
      await this.withProgress(
        messages.creating(`GoEasyERP ${version}`),
        async (report, progress) => {
          report(messages.downloadingFiles);
          container = await this.manager.prepare(version, port, progress.signal);
          report(messages.startingContainer);
          await this.manager.start(container, progress);
          report(messages.creatingUser);
        },
      );
    } catch (error) {
      this.reportIncomplete(container, error);
      return;
    }
    if (container && (await this.createUser(container, password))) {
      this.showInfo(messages.created(container.project, serverUrl(container.port), FIRST_USER));
    }
  }

  private async start(): Promise<void> {
    const container = await this.pickContainer(messages.actionStart);
    if (!container) {
      return;
    }
    // A creation that did not finish left the container without its first user.
    const password = container.userCreated ? undefined : await this.askPassword();
    if (!container.userCreated && !password) {
      return;
    }
    try {
      await this.withProgress(messages.starting(container.project), async (report, progress) => {
        report(messages.startingContainer);
        await this.manager.start(container, progress);
      });
    } catch (error) {
      this.reportIncomplete(container, error);
      return;
    }
    if (!password || (await this.createUser(container, password))) {
      this.showInfo(messages.started(container.project, serverUrl(container.port)));
    }
  }

  private async stop(): Promise<void> {
    const container = await this.pickContainer(messages.actionStop);
    if (!container) {
      return;
    }
    await this.withProgress(messages.stopping(container.project), (_report, progress) =>
      this.manager.stop(container, progress),
    );
    this.showInfo(messages.stopped(container.project));
  }

  private async remove(): Promise<void> {
    const container = await this.pickContainer(messages.actionRemove);
    if (!container) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      messages.confirmRemove(container.project),
      { modal: true, detail: messages.confirmRemoveDetail },
      messages.remove,
    );
    if (choice !== messages.remove) {
      return;
    }
    await this.withProgress(messages.removing(container.project), (_report, progress) =>
      this.manager.remove(container, progress),
    );
    await this.secrets.delete(passwordKey(serverUrl(container.port), FIRST_USER));
    this.showInfo(messages.removed(container.project));
  }

  /**
   * Makes the first user and keeps the password; asks again for one the server refuses.
   * Answers whether the container has its first user.
   */
  private async createUser(container: Container, first: string): Promise<boolean> {
    let password: string | undefined = first;
    while (password) {
      try {
        if (await this.manager.createFirstUser(container, password)) {
          await this.secrets.store(passwordKey(serverUrl(container.port), FIRST_USER), password);
        } else {
          this.showInfo(messages.userExists(container.project));
        }
        return true;
      } catch (error) {
        if (!(error instanceof ServerError) || error.status !== 400) {
          this.reportIncomplete(container, error);
          return false;
        }
        password = await this.askPassword(messages.passwordRefused(error.message));
      }
    }
    this.reportIncomplete(container);
    return false;
  }

  private async askVersion(): Promise<string | undefined> {
    let versions: string[];
    try {
      versions = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: messages.loadingVersions },
        () => fetchVersions(AbortSignal.timeout(15_000)),
      );
    } catch (error) {
      return vscode.window.showInputBox({
        prompt: messages.versionsUnavailable(reason(error)),
        placeHolder: messages.enterVersion(MIN_BASE_VERSION),
        ignoreFocusOut: true,
        validateInput: (text) =>
          isVersion(text) && compareVersions(text, MIN_BASE_VERSION) >= 0
            ? undefined
            : messages.badVersion(MIN_BASE_VERSION),
      });
    }
    if (versions.length === 0) {
      throw new Error(messages.noVersions);
    }
    const picked = await vscode.window.showQuickPick(
      versions.map((version, index) => ({
        label: version,
        description: index === 0 ? messages.newest : undefined,
      })),
      { placeHolder: messages.pickVersion, ignoreFocusOut: true },
    );
    return picked?.label;
  }

  private async askPort(): Promise<number | undefined> {
    // Ports of stopped containers are free now, but taken as soon as they start again.
    const reserved = (await this.manager.store.list()).map((container) => container.port);
    const proposal = await findFreePort(undefined, reserved);
    const text = await vscode.window.showInputBox({
      prompt: messages.enterPort,
      value: String(proposal),
      ignoreFocusOut: true,
      validateInput: async (value) => {
        const port = Number(value);
        if (!/^\d+$/.test(value) || port < 1024 || port > 65535) {
          return messages.badPort;
        }
        const free = !reserved.includes(port) && (await isPortFree(port));
        return free ? undefined : messages.portBusy(port);
      },
    });
    return text === undefined ? undefined : Number(text);
  }

  private async askPassword(problem?: string): Promise<string | undefined> {
    const ask = (prompt: string, check: (value: string) => string | undefined) =>
      vscode.window.showInputBox({
        prompt,
        password: true,
        ignoreFocusOut: true,
        validateInput: check,
      });
    const prompt = messages.enterPassword(FIRST_USER);
    const password = await ask(problem ? `${problem} ${prompt}` : prompt, (value) =>
      passwordProblem(value, FIRST_USER),
    );
    if (!password) {
      return undefined;
    }
    const repeated = await ask(messages.repeatPassword, (value) =>
      value === password ? undefined : messages.passwordsDiffer,
    );
    return repeated === password ? password : undefined;
  }

  private async pickContainer(action: string): Promise<Container | undefined> {
    const containers = await this.manager.states();
    if (containers.length === 0) {
      this.showInfo(messages.noContainers);
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      containers.map(({ container, state }) => ({
        label: container.project,
        description: messages.state[state],
        detail: messages.containerDetail(container.version, serverUrl(container.port)),
        container,
      })),
      { placeHolder: messages.pickContainer(action), ignoreFocusOut: true },
    );
    return picked?.container;
  }

  /** Runs a task with a cancellable notification; Docker's output goes to the Output channel. */
  private withProgress(
    title: string,
    task: (report: Report, progress: Progress) => Promise<void>,
  ): Thenable<void> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      async (notification, token) => {
        const abort = new AbortController();
        const listener = token.onCancellationRequested(() => abort.abort());
        this.output.appendLine(title);
        try {
          await task((message) => notification.report({ message }), {
            signal: abort.signal,
            onOutput: (text) => this.output.append(text),
          });
        } finally {
          listener.dispose();
        }
      },
    );
  }

  private reportIncomplete(container: Container | undefined, error?: unknown): void {
    if (!container) {
      this.showError(messages.failed(reason(error)));
    } else if (error === undefined || isAbort(error)) {
      this.showError(messages.cancelled(container.project));
    } else {
      this.showError(`${messages.failed(reason(error))} ${messages.incomplete(container.project)}`);
    }
  }

  // Not awaited: an open notification must not keep the next command waiting.
  private showInfo(text: string): void {
    this.output.appendLine(text);
    void vscode.window.showInformationMessage(text);
  }

  private showError(text: string): void {
    this.output.appendLine(text);
    void vscode.window.showErrorMessage(text, messages.showOutput).then((choice) => {
      if (choice) {
        this.output.show();
      }
    });
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
