import * as vscode from 'vscode';
import { appDirectory } from '../app/application';
import { AppError, type Problem } from '../base/problems';
import type { BaseWorkspace } from '../base/workspace';
import { compile, type CompileOptions, type CompileResult } from '../build/compile';
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
  private readonly go = vscode.languages.createDiagnosticCollection('goeasyerp-go');

  constructor(
    private readonly base: BaseCommands,
    private readonly runner: Runner,
    private readonly output: vscode.OutputChannel,
  ) {}

  register(): vscode.Disposable[] {
    return [
      this.audit,
      this.go,
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

  /** Compiles the app and shows the audit's findings. */
  async run(
    workspace: BaseWorkspace,
    version: string,
    options: Pick<CompileOptions, 'signal' | 'write'>,
    /** Whether to list Go's errors too: a task's problem matcher does that itself. */
    listGo = true,
  ): Promise<CompileResult> {
    this.audit.clear();
    this.go.clear();
    try {
      const result = await compile(workspace, version, this.runner, {
        ...options,
        onBase: (base) => this.base.apply(workspace, base),
      });
      this.showFindings(result.findings);
      if (listGo) {
        this.show(this.go, 'go', result.goProblems);
      }
      return result;
    } catch (error) {
      // errors of the merge belong to the app's definitions
      if (error instanceof AppError) {
        this.base.report(error);
      }
      throw error;
    }
  }

  showFindings(findings: Finding[]): void {
    this.show(this.audit, 'GoEasyERP audit', findings);
  }

  private async compile(write: (text: string) => void, signal: AbortSignal): Promise<boolean> {
    try {
      const target = await this.base.target();
      if (!target) {
        return false;
      }
      const result = await this.run(target.workspace, target.version, { signal, write }, false);
      write(result.package ? messages.compiled : messages.compileFailed);
      return result.package !== undefined;
    } catch (error) {
      write(error instanceof Error ? error.message : String(error));
      if (!(error instanceof AppError)) {
        this.base.report(error);
      }
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

  private show(
    collection: vscode.DiagnosticCollection,
    source: string,
    problems: (Problem & { excepted?: boolean })[],
  ): void {
    for (const file of new Set(problems.map((problem) => problem.file))) {
      collection.set(
        vscode.Uri.file(file),
        problems
          .filter((problem) => problem.file === file)
          .map((problem) => {
            const line = Math.max(problem.line - 1, 0);
            const diagnostic = new vscode.Diagnostic(
              new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
              problem.message,
              problem.excepted
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Error,
            );
            diagnostic.source = source;
            return diagnostic;
          }),
      );
    }
  }
}
