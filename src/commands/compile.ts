import * as vscode from 'vscode';
import { appDirectory } from '../app/application';
import { compile } from '../build/compile';
import type { Finding } from '../build/audit';
import { writePackage } from '../build/package';
import { messages } from '../messages';
import type { Runner } from '../runner';
import type { BaseCommands } from './base';

const TYPE = 'goeasyerp';
const SOURCE = 'GoEasyERP';
// Go's errors reach the Problems panel through the editor's own matcher for Go.
const MATCHERS = ['$go'];

/** The compile task (Ctrl+Shift+B) and the commands to compile and package. */
export class CompileCommands implements vscode.TaskProvider {
  private readonly audit = vscode.languages.createDiagnosticCollection('goeasyerp-audit');

  constructor(
    private readonly base: BaseCommands,
    private readonly run: Runner,
    private readonly output: vscode.OutputChannel,
  ) {}

  register(): vscode.Disposable[] {
    return [
      this.audit,
      vscode.tasks.registerTaskProvider(TYPE, this),
      vscode.commands.registerCommand('goeasyerp.compile', () => this.start()),
      vscode.commands.registerCommand('goeasyerp.packageApp', () => this.package()),
    ];
  }

  async provideTasks(): Promise<vscode.Task[]> {
    const workspace = await this.base.open();
    if (!workspace) {
      return [];
    }
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspace.app.root));
    return folder ? [this.task({ type: TYPE, task: 'compile' }, folder)] : [];
  }

  /** A task written in tasks.json. */
  resolveTask(task: vscode.Task): vscode.Task | undefined {
    if (task.definition.task !== 'compile' || !task.scope) {
      return undefined;
    }
    return this.task(task.definition, task.scope, task.name, task.problemMatchers);
  }

  private task(
    definition: vscode.TaskDefinition,
    scope: vscode.WorkspaceFolder | vscode.TaskScope,
    name: string = messages.compileTask,
    matchers: string[] = MATCHERS,
  ): vscode.Task {
    const execution = new vscode.CustomExecution(() => Promise.resolve(this.terminal()));
    const task = new vscode.Task(definition, scope, name, SOURCE, execution, matchers);
    task.group = vscode.TaskGroup.Build;
    task.presentationOptions = { clear: true };
    return task;
  }

  private async start(): Promise<void> {
    const [task] = await this.provideTasks();
    if (task) {
      await vscode.tasks.executeTask(task);
    } else {
      void vscode.window.showInformationMessage(messages.noApp);
    }
  }

  private terminal(): vscode.Pseudoterminal {
    const text = new vscode.EventEmitter<string>();
    const closed = new vscode.EventEmitter<number>();
    const abort = new AbortController();
    const write = (lines: string) => text.fire(`${lines.replaceAll(/\r?\n/g, '\r\n')}\r\n`);
    return {
      onDidWrite: text.event,
      onDidClose: closed.event,
      open: () => {
        void this.compile(write, abort.signal).then((ok) => closed.fire(ok ? 0 : 1));
      },
      close: () => abort.abort(),
    };
  }

  private async compile(write: (text: string) => void, signal: AbortSignal): Promise<boolean> {
    this.audit.clear();
    try {
      const target = await this.base.target();
      if (!target) {
        return false;
      }
      const result = await compile(target.workspace, target.version, this.run, {
        signal,
        write,
        onBase: (base) => this.base.apply(target.workspace, base),
      });
      this.show(result.findings);
      write(result.package ? messages.compiled : messages.compileFailed);
      return result.package !== undefined;
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      this.base.report(error);
      return false;
    }
  }

  private async package(): Promise<void> {
    try {
      const workspace = await this.base.open();
      if (!workspace) {
        void vscode.window.showInformationMessage(messages.noApp);
        return;
      }
      await vscode.workspace.saveAll(false);
      const path = await writePackage(workspace.app.root, appDirectory(workspace.app));
      const text = messages.packageWritten(path);
      this.output.appendLine(text);
      void vscode.window.showInformationMessage(text, messages.reveal).then((choice) => {
        if (choice) {
          void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path));
        }
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(messages.failed(reason));
    }
  }

  private show(findings: Finding[]): void {
    for (const file of new Set(findings.map((finding) => finding.file))) {
      this.audit.set(
        vscode.Uri.file(file),
        findings
          .filter((finding) => finding.file === file)
          .map((finding) => {
            const line = Math.max(finding.line - 1, 0);
            const diagnostic = new vscode.Diagnostic(
              new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
              finding.message,
              finding.excepted
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Error,
            );
            diagnostic.source = 'GoEasyERP audit';
            return diagnostic;
          }),
      );
    }
  }
}
