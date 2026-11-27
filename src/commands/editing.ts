import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as vscode from 'vscode';
import { appDirectory, type App } from '../app/application';
import {
  nextFree,
  readIdentity,
  usedFieldNumbers,
  usedObjectNumbers,
  type ObjectType,
  type ReadText,
} from '../app/numbers';
import { messages } from '../messages';
import { missingImports, snippetsFor, type Context } from '../snippets/snippets';
import type { BaseCommands } from './base';

/** The text of a file, with the changes not saved yet. */
const readOpen: ReadText = async (path) => {
  const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === path);
  return open ? open.getText() : readFile(path, 'utf8');
};

/** Snippets filled with the app's prefix and numbers, and the next free numbers. */
export class EditingCommands implements vscode.CompletionItemProvider {
  constructor(private readonly base: BaseCommands) {}

  register(): vscode.Disposable[] {
    return [
      vscode.languages.registerCompletionItemProvider(
        [
          { language: 'yaml', scheme: 'file' },
          { language: 'go', scheme: 'file' },
        ],
        this,
      ),
      vscode.commands.registerCommand('goeasyerp.nextObjectNo', () => this.insert('object')),
      vscode.commands.registerCommand('goeasyerp.nextFieldNo', () => this.insert('field')),
    ];
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    const app = (await this.base.open())?.app;
    if (!app) {
      return [];
    }
    const snippets = snippetsFor(this.pathInApp(app, document));
    if (snippets.length === 0) {
      return [];
    }
    const context = await this.context(app).catch(() => undefined);
    if (!context) {
      return []; // application.yaml cannot be read at the moment
    }
    const range = document.getWordRangeAtPosition(position, /[\w-]+/);
    return snippets.map((snippet) => {
      const item = new vscode.CompletionItem(snippet.name, vscode.CompletionItemKind.Snippet);
      const body = snippet.body(context);
      item.insertText = new vscode.SnippetString(body);
      item.detail = `GoEasyERP: ${snippet.description}`;
      item.range = range;
      const imports = missingImports(document.getText(), snippet.imports ?? []);
      if (imports) {
        const place = new vscode.Position(imports.line, 0);
        item.additionalTextEdits = [vscode.TextEdit.insert(place, imports.text)];
      }
      return item;
    });
  }

  private pathInApp(app: App, document: vscode.TextDocument): string {
    const path = relative(appDirectory(app), document.uri.fsPath).replaceAll('\\', '/');
    return path.startsWith('..') ? '.outside' : path;
  }

  private async identity(app: App) {
    return readIdentity(await readOpen(join(appDirectory(app), 'application.yaml')));
  }

  private async context(app: App): Promise<Context> {
    const directory = appDirectory(app);
    const { prefix, objects, fields } = await this.identity(app);
    const object = async (type: ObjectType) =>
      nextFree(objects, await usedObjectNumbers(directory, type, readOpen)) ?? 0;
    return {
      prefix,
      table: await object('table'),
      page: await object('page'),
      field: nextFree(fields, await usedFieldNumbers(directory, readOpen)) ?? 0,
    };
  }

  /** Inserts the next free number at each cursor. */
  private async insert(kind: 'object' | 'field'): Promise<void> {
    try {
      const app = (await this.base.open())?.app;
      const editor = vscode.window.activeTextEditor;
      if (!app || !editor) {
        void vscode.window.showInformationMessage(app ? messages.noEditor : messages.noApp);
        return;
      }
      const directory = appDirectory(app);
      const identity = await this.identity(app);
      let series = identity.fields;
      let used: number[];
      if (kind === 'field') {
        used = await usedFieldNumbers(directory, readOpen);
      } else {
        const type = await this.objectType(this.pathInApp(app, editor.document));
        if (!type) {
          return;
        }
        series = identity.objects;
        used = await usedObjectNumbers(directory, type, readOpen);
      }
      const numbers: number[] = [];
      for (let i = 0; i < editor.selections.length; i++) {
        const next = nextFree(series, [...used, ...numbers]);
        if (next === undefined) {
          throw new Error(messages.seriesFull);
        }
        numbers.push(next);
      }
      await editor.edit((edit) => {
        const inOrder = [...editor.selections].sort((a, b) => a.start.compareTo(b.start));
        inOrder.forEach((selection, i) => edit.replace(selection, String(numbers[i])));
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(messages.failed(text));
    }
  }

  /** The type the file's folder tells, else the one the developer picks. */
  private async objectType(path: string): Promise<ObjectType | undefined> {
    if (path.startsWith('custom/tables/')) {
      return 'table';
    }
    if (path.startsWith('custom/pages/')) {
      return 'page';
    }
    const picked = await vscode.window.showQuickPick(
      (['table', 'page', 'report', 'codeunit'] as const).map((type) => ({
        label: messages.objectType[type],
        type,
      })),
      { placeHolder: messages.pickObjectType },
    );
    return picked?.type;
  }
}
