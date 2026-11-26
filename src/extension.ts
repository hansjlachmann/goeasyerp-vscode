import { join } from 'node:path';
import * as vscode from 'vscode';
import { ContainerCommands } from './commands/containers';
import { Docker } from './container/docker';
import { ContainerManager } from './container/manager';
import { ContainerStore } from './container/store';
import { messages } from './messages';
import { run } from './runner';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(messages.outputChannelName);
  const docker = new Docker(run);
  const store = new ContainerStore(join(context.globalStorageUri.fsPath, 'containers'));
  const containers = new ContainerCommands(
    new ContainerManager(store, docker),
    docker,
    context.secrets,
    output,
  );

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('goeasyerp.showOutput', () => output.show()),
    ...containers.register(),
  );
}
