import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Range } from './series';

export type ObjectType = 'table' | 'page' | 'report' | 'codeunit';

/** What an app's application.yaml says about its names and numbers. */
export interface Identity {
  prefix: string;
  objects: Range[];
  fields: Range[];
}

export function readIdentity(manifest: string): Identity {
  const { application } = (parse(manifest) ?? {}) as {
    application?: { prefix?: unknown; number_series?: { objects?: unknown; fields?: unknown } };
  };
  const ranges = (value: unknown): Range[] =>
    (Array.isArray(value) ? (value as Partial<Range>[]) : []).filter(
      (range): range is Range => Number.isInteger(range?.from) && Number.isInteger(range?.to),
    );
  return {
    prefix: typeof application?.prefix === 'string' ? application.prefix : '',
    objects: ranges(application?.number_series?.objects),
    fields: ranges(application?.number_series?.fields),
  };
}

/** Reads a file; the editor gives the text of an unsaved one. */
export type ReadText = (path: string) => Promise<string>;

const readSaved: ReadText = (path) => readFile(path, 'utf8');

async function files(directory: string, folder: string, extension: RegExp): Promise<string[]> {
  const entries = await readdir(join(directory, folder), { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await files(directory, path, extension)));
    } else if (extension.test(entry.name)) {
      found.push(join(directory, path));
    }
  }
  return found;
}

const YAML = /\.ya?ml$/;

async function matches(paths: string[], pattern: RegExp, read: ReadText): Promise<number[]> {
  const numbers: number[] = [];
  for (const path of paths) {
    // Comments do not use a number. Read as text: a file being edited may not be valid.
    const text = (await read(path)).replaceAll(/(^|\s)(#|\/\/).*$/gm, '$1');
    numbers.push(...[...text.matchAll(pattern)].map((match) => Number(match[1])));
  }
  return numbers;
}

/** The field numbers the app's tables and table extensions use. */
export async function usedFieldNumbers(
  directory: string,
  read: ReadText = readSaved,
): Promise<number[]> {
  const paths = [
    ...(await files(directory, 'tables', YAML)),
    ...(await files(directory, 'custom/tables', YAML)),
  ];
  return matches(paths, /(?<![\w-])no:\s*(\d+)/g, read);
}

/** The object numbers of a type the app uses. */
export async function usedObjectNumbers(
  directory: string,
  type: ObjectType,
  read: ReadText = readSaved,
): Promise<number[]> {
  if (type === 'table' || type === 'page') {
    const paths = await files(directory, `custom/${type}s`, YAML);
    return matches(paths, /^[ \t]+id:\s*(\d+)/gm, read);
  }
  // Reports and routines are Go code: every number written there counts, and those run from YAML.
  const code = await files(directory, '.', /\.go$/);
  const definitions = await files(directory, '.', YAML);
  return [
    ...(await matches(code, /(?<![\w.])(\d{4,})(?![\w.])/g, read)),
    ...(await matches(definitions, new RegExp(`${type}:(\\d+)`, 'g'), read)),
  ];
}

/**
 * The number after the highest one used in the series, as a number is never used again. When
 * the series has none left there, the first unused one. Undefined: the series is full.
 */
export function nextFree(series: readonly Range[], used: readonly number[]): number | undefined {
  const ranges = [...series].sort((a, b) => a.from - b.from);
  const taken = new Set(used);
  const inside = used.filter((n) => ranges.some((range) => range.from <= n && n <= range.to));
  const highest = inside.reduce((a, b) => Math.max(a, b), 0);
  for (const start of [highest + 1, 0]) {
    for (const range of ranges) {
      for (let n = Math.max(range.from, start); n <= range.to; n++) {
        if (!taken.has(n)) {
          return n;
        }
      }
    }
  }
  return undefined;
}
