import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** An error of the merge or the table code generator, placed in one of the app's files. */
export interface Problem {
  file: string;
  /** Counted from 1. */
  line: number;
  message: string;
}

/** An error in the app, as opposed to a failure of the tools (no network, for example). */
export class AppError extends Error {
  constructor(readonly problems: Problem[]) {
    super(problems.map((problem) => problem.message).join('\n'));
  }
}

/** The error messages in the output of extmerge ("Error: …") and tablegen ("✗ …"). */
export function errorMessages(output: string): string[] {
  const lines = output.split(/\r?\n/).filter((line) => !/^exit status \d+$/.test(line));
  const generator = lines.filter((line) => line.startsWith('✗ ')).map((line) => line.slice(2));
  if (generator.length > 0) {
    return generator;
  }
  const start = lines.findIndex((line) => line.startsWith('Error: '));
  // A YAML error continues over several lines.
  return start < 0 ? [] : [lines.slice(start).join('\n').slice('Error: '.length).trim()];
}

async function appFiles(directory: string, folder = ''): Promise<string[]> {
  const entries = await readdir(join(directory, folder), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await appFiles(directory, path)));
    } else if (/\.(ya?ml|mod)$/.test(entry.name)) {
      files.push(join(directory, path));
    }
  }
  return files;
}

/**
 * The file an error message is about: the one it names (with its path or its name), else the one
 * that holds a name of the app it quotes, else application.yaml.
 */
export async function locate(
  message: string,
  appDirectory: string,
  prefix: string | undefined,
): Promise<Problem> {
  const files = await appFiles(appDirectory);
  const line = Number(/\bline (\d+):/.exec(message)?.[1] ?? 1);
  const named = (name: string) =>
    new RegExp(`(^|[^\\w.-])${name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w.-])`).test(
      message,
    );

  // The longest path first: the message can name the app's folder too.
  const byPath = files.filter((file) => message.includes(file)).sort((a, b) => b.length - a.length);
  const file = byPath[0] ?? files.find((candidate) => named(basename(candidate)));
  if (file) {
    return { file, line, message };
  }

  if (prefix) {
    const names = message.match(new RegExp(`\\b${prefix}_\\w+`, 'gi')) ?? [];
    for (const name of names) {
      for (const candidate of files) {
        const rows = (await readFile(candidate, 'utf8')).split('\n');
        const row = rows.findIndex((text) => new RegExp(`\\b${name}\\b`, 'i').test(text));
        if (row >= 0) {
          return { file: candidate, line: row + 1, message };
        }
      }
    }
  }
  return { file: join(appDirectory, 'application.yaml'), line: 1, message };
}
