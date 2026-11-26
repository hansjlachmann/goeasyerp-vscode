import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { extract } from 'tar';
import { downloadFile, type DownloadOptions } from '../download';
import { isVersion } from '../version';

export type FetchSource = (
  url: string,
  target: string,
  options?: DownloadOptions,
) => Promise<unknown>;

export function sourceUrl(version: string): string {
  return `https://github.com/hansjlachmann/goeasyerp/archive/refs/tags/v${version}.tar.gz`;
}

/**
 * Downloads the base's source of a version into the folder, unless it is there. The frontend is
 * left out: nothing here needs it.
 */
export async function ensureSource(
  folder: string,
  version: string,
  options: DownloadOptions = {},
  fetchSource: FetchSource = downloadFile,
): Promise<void> {
  if (!isVersion(version)) {
    throw new Error(`Not a version: ${version}`);
  }
  if (
    await access(join(folder, 'go.mod')).then(
      () => true,
      () => false,
    )
  ) {
    return;
  }
  await mkdir(dirname(folder), { recursive: true });
  const temporary = await mkdtemp(join(dirname(folder), 'download-'));
  try {
    const archive = join(temporary, 'base.tar.gz');
    await fetchSource(sourceUrl(version), archive, options);
    const unpacked = join(temporary, 'unpacked');
    await mkdir(unpacked);
    await extract({
      file: archive,
      cwd: unpacked,
      strict: true,
      strip: 1, // the archive's top folder
      filter: (path) => path.split('/')[1] !== 'frontend',
    });
    await rm(folder, { recursive: true, force: true });
    await rename(unpacked, folder);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
