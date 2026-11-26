import * as vscode from 'vscode';
import { messages } from './messages';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(messages.outputChannelName);

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('goeasyerp.showOutput', () => output.show()),
  );
}
