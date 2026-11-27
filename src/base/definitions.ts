import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A hash of the files a merge reads: the app's definitions, texts and go.mod. */
export async function definitionsHash(directory: string): Promise<string> {
  const hash = createHash('sha256');
  const add = async (folder: string): Promise<void> => {
    const entries = await readdir(join(directory, folder), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        await add(path);
      } else if (/\.ya?ml$/.test(entry.name) || entry.name === 'go.mod') {
        const content = await readFile(join(directory, path));
        hash.update(`${path}\0${content.length}\0`).update(content);
      }
    }
  };
  await add('.');
  return hash.digest('hex');
}
