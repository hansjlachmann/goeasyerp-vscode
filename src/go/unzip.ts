import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { openPromise } from 'yauzl';

/** Unpacks a .zip, refusing every entry that would land outside the target folder. */
export async function unzip(archive: string, target: string): Promise<void> {
  const root = resolve(target);
  const zip = await openPromise(archive);
  // yauzl itself refuses absolute names, "..", and backslashes.
  for await (const entry of zip.eachEntry()) {
    const path = resolve(root, entry.fileName);
    if (!path.startsWith(root + sep)) {
      throw new Error(`The archive has a path outside its folder: ${entry.fileName}`);
    }
    if (entry.fileName.endsWith('/')) {
      await mkdir(path, { recursive: true });
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(path));
  }
}
