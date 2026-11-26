import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { freeSeries, parseSeries, type Range } from '../app/series';
import { isPrefix, proposedPrefix, slug, writeApp } from '../app/template';
import { FIRST_USER, type ContainerManager } from '../container/manager';
import { fetchVersions } from '../container/releases';
import { serverUrl, type Container } from '../container/store';
import { messages } from '../messages';
import { passwordKey } from '../password';
import { ServerClient } from '../server/client';
import { compareVersions, isVersion, MIN_BASE_VERSION } from '../version';

export class NewAppCommand {
  constructor(
    private readonly manager: ContainerManager,
    private readonly secrets: vscode.SecretStorage,
  ) {}

  register(): vscode.Disposable {
    return vscode.commands.registerCommand('goeasyerp.newApp', async () => {
      try {
        await this.create();
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(messages.failed(text));
      }
    });
  }

  private async create(): Promise<void> {
    const required = (value: string): string | undefined =>
      value.trim() ? undefined : messages.required;
    const ask = (prompt: string, check = required, value?: string) =>
      vscode.window.showInputBox({ prompt, value, ignoreFocusOut: true, validateInput: check });

    const name = (await ask(messages.appName))?.trim();
    if (!name) {
      return;
    }
    const publisher = (await ask(messages.appPublisher))?.trim();
    if (!publisher) {
      return;
    }
    const contact = (await ask(messages.appContact))?.trim();
    if (!contact) {
      return;
    }
    const prefix = await ask(
      messages.appPrefix,
      (value) => (isPrefix(value) ? undefined : messages.badPrefix),
      proposedPrefix(name),
    );
    if (!prefix) {
      return;
    }
    const parent = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      title: messages.appParent(slug(name)),
      openLabel: messages.appParentButton,
    });
    if (!parent?.[0]) {
      return;
    }
    const directory = join(parent[0].fsPath, slug(name));
    if ((await readdir(directory).catch(() => [])).length > 0) {
      throw new Error(messages.folderNotEmpty(directory));
    }

    const container = await this.localContainer();
    const baseVersion = container?.version ?? (await this.newestVersion());
    if (!baseVersion) {
      return;
    }
    const series = await this.freeSeries(container);
    await writeApp(directory, {
      name,
      publisher,
      contact,
      prefix,
      baseVersion,
      series,
      server: container && serverUrl(container.port),
    });
    await this.open(directory, series);
  }

  /** A local container for the app to publish to: a running one first, then the newest. */
  private async localContainer(): Promise<(Container & { running: boolean }) | undefined> {
    // Without Docker there is no state to ask for.
    const containers = await this.manager
      .states()
      .catch(async () =>
        (await this.manager.store.list()).map((container) => ({ container, state: 'absent' })),
      );
    return containers
      .map(({ container, state }) => ({ ...container, running: state === 'running' }))
      .sort(
        (a, b) => Number(b.running) - Number(a.running) || compareVersions(b.version, a.version),
      )[0];
  }

  private async newestVersion(): Promise<string | undefined> {
    const versions = await fetchVersions(AbortSignal.timeout(15_000)).catch(() => []);
    return (
      versions[0] ??
      vscode.window.showInputBox({
        prompt: messages.enterVersion(MIN_BASE_VERSION),
        ignoreFocusOut: true,
        validateInput: (text) =>
          isVersion(text) && compareVersions(text, MIN_BASE_VERSION) >= 0
            ? undefined
            : messages.badVersion(MIN_BASE_VERSION),
      })
    );
  }

  /** Numbers no app installed in the container uses, when it can be asked. */
  private async freeSeries(
    container: (Container & { running: boolean }) | undefined,
  ): Promise<Range> {
    let used: Range[] = [];
    if (container?.running) {
      const password = await this.secrets.get(passwordKey(serverUrl(container.port), FIRST_USER));
      if (password) {
        try {
          const client = new ServerClient(`http://127.0.0.1:${container.port}`);
          await client.login(FIRST_USER, password, 'main');
          used = (await client.installedApps()).flatMap((app) =>
            parseSeries(`${app.object_series ?? ''}, ${app.field_series ?? ''}`),
          );
        } catch {
          // the default series: the build refuses an overlap
        }
      }
    }
    return freeSeries(used);
  }

  private async open(directory: string, series: Range): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      messages.appCreated(directory, series.from, series.to),
      messages.openFolder,
      messages.openNewWindow,
    );
    if (choice) {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(directory), {
        forceNewWindow: choice === messages.openNewWindow,
      });
    }
  }
}
