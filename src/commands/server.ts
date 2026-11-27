import * as vscode from 'vscode';
import { messages } from '../messages';
import { DEFAULT_CONFIGURATION, readTarget, requestAddress, startPage } from '../publish/config';
import { ServerClient } from '../server/client';
import { statusText, type ServerState } from '../status';
import type { BaseCommands } from './base';

const TYPE = 'goeasyerp';
const EVERY = 10_000;

/** The workspace's GoEasyERP launch configurations. */
export function launchConfigurations(): vscode.DebugConfiguration[] {
  return (vscode.workspace.workspaceFolders ?? []).flatMap((folder) =>
    vscode.workspace
      .getConfiguration('launch', folder.uri)
      .get<vscode.DebugConfiguration[]>('configurations', [])
      .filter((configuration) => configuration.type === TYPE),
  );
}

/** One configuration: the only one, else the one the developer picks. */
export async function pickConfiguration(
  placeHolder: string,
): Promise<vscode.DebugConfiguration | undefined> {
  const configurations = launchConfigurations();
  if (configurations.length <= 1) {
    return configurations[0] ?? { ...DEFAULT_CONFIGURATION };
  }
  const picked = await vscode.window.showQuickPick(
    configurations.map((configuration) => ({
      label: configuration.name,
      description: String(configuration.server),
      configuration,
    })),
    { placeHolder },
  );
  return picked?.configuration;
}

/** The status bar item with the server's state, and Open in Browser. */
export class ServerStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  private timer: NodeJS.Timeout | undefined;
  /** The server published to last; before that, the first configuration's. */
  private server: string | undefined;
  private building: { step?: string } | undefined;

  constructor(private readonly base: BaseCommands) {
    this.item.command = 'goeasyerp.showOutput';
    this.item.tooltip = messages.statusTooltip;
  }

  register(): vscode.Disposable[] {
    return [
      this,
      vscode.commands.registerCommand('goeasyerp.openBrowser', () => this.openBrowser()),
    ];
  }

  /** Shows the item and keeps it current, when the workspace holds an app. */
  async start(): Promise<void> {
    if (!(await this.base.open())) {
      return;
    }
    await this.refresh();
    this.timer = setInterval(() => {
      // Nobody looks at the status of a window in the background.
      if (vscode.window.state.focused) {
        void this.refresh();
      }
    }, EVERY);
  }

  /** A publish to a server runs; undefined step: it has just started. */
  publishing(server: string, step?: string): void {
    this.server = server;
    this.building = { step };
    this.show(server, { kind: 'building', step });
  }

  async published(): Promise<void> {
    this.building = undefined;
    await this.refresh();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item.dispose();
  }

  private async refresh(): Promise<void> {
    const server =
      this.server ?? String(launchConfigurations()[0]?.server ?? DEFAULT_CONFIGURATION.server);
    if (this.building) {
      return;
    }
    let state: ServerState;
    try {
      const client = new ServerClient(requestAddress(server));
      const { build } = await client.version(AbortSignal.timeout(5000));
      state = { kind: 'running', build };
    } catch {
      state = { kind: 'offline' };
    }
    // A publish may have started in the meantime.
    if (!this.building) {
      this.show(server, state);
    }
  }

  private show(server: string, state: ServerState): void {
    this.item.text = statusText(server, state);
    this.item.show();
  }

  private async openBrowser(): Promise<void> {
    const configuration = await pickConfiguration(messages.pickToOpen);
    if (!configuration) {
      return;
    }
    try {
      await vscode.env.openExternal(vscode.Uri.parse(startPage(readTarget(configuration))));
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(messages.failed(text));
    }
  }
}
