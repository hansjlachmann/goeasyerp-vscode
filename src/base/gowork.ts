import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const BASE_MODULE = 'github.com/hansjlachmann/goeasyerp';
const MARKER = '// Written by the GoEasyERP extension.';

/** The base version an app's go.mod requires. */
export function requiredBaseVersion(goMod: string): string | undefined {
  const pattern = new RegExp(
    `^\\s*(?:require\\s+)?${BASE_MODULE.replaceAll('.', '\\.')}\\s+(v\\S+)`,
    'm',
  );
  return pattern.exec(goMod)?.[1];
}

/** The go.work of an app's workspace: the app and the merged base. */
export function goWork(
  appFolder: string,
  workFolder: string,
  goLine: string,
  required: string,
): string {
  const use = (folder: string) => (folder === '.' ? '.' : `./${folder}`);
  return `${MARKER} Do not commit it.
go ${goLine}

use (
\t${use(appFolder)}
\t${use(workFolder)}
)

replace ${BASE_MODULE} ${required} => ${use(workFolder)}
`;
}

/** Writes go.work, unless the folder has one the developer made. Answers whether it changed. */
export async function writeGoWork(root: string, content: string): Promise<boolean> {
  const file = join(root, 'go.work');
  const old = await readFile(file, 'utf8').catch(() => undefined);
  if (old === content) {
    return false;
  }
  if (old !== undefined && !old.startsWith(MARKER)) {
    throw new Error(`${file} was not written by this extension. Remove or rename it.`);
  }
  await writeFile(file, content);
  return true;
}
