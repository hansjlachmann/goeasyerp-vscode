import { join } from 'node:path';
import * as vscode from 'vscode';
import { BaseCommands } from './commands/base';
import { CompileCommands } from './commands/compile';
import { ContainerCommands } from './commands/containers';
import { NewAppCommand } from './commands/newApp';
import { Docker } from './container/docker';
import { ContainerManager } from './container/manager';
import { ContainerStore } from './container/store';
import { GoToolchains } from './go/toolchain';
import { messages } from './messages';
import { run } from './runner';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(messages.outputChannelName);
  const docker = new Docker(run);
  const store = new ContainerStore(join(context.globalStorageUri.fsPath, 'containers'));
  const manager = new ContainerManager(store, docker);
  const containers = new ContainerCommands(manager, docker, context.secrets, output);
  const goStorage = join(context.globalStorageUri.fsPath, 'go');
  const base = new BaseCommands(
    new GoToolchains(goStorage, run),
    run,
    goStorage,
    context.environmentVariableCollection,
    output,
  );

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('goeasyerp.showOutput', () => output.show()),
    ...containers.register(),
    new NewAppCommand(manager, context.secrets).register(),
    ...base.register(),
    ...new CompileCommands(base, run, output).register(),
  );
  // Not awaited: it downloads, and activation must not wait for that.
  void base.activate();
}
