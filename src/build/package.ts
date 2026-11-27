import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { parse } from 'yaml';
import { ZipFile } from 'yazl';
import { slug } from '../app/template';

// The server's rules for an app package (the same as for Upload App).
const EXTENSIONS = ['.yaml', '.yml', '.go', '.mod', '.sum', '.json', '.md', '.txt'];
const NAMES = ['LICENSE', 'NOTICE', 'README'];
export const LIMITS = {
  zipped: 2 * 1024 * 1024,
  unpacked: 20 * 1024 * 1024,
  file: 5 * 1024 * 1024,
  files: 2000,
};

/** Whether a file of the app's folder belongs in the package. */
export function isPackaged(name: string): boolean {
  if (name.startsWith('.') || name.endsWith('_test.go') || name === 'go.work.sum') {
    return false;
  }
  return NAMES.includes(name) || EXTENSIONS.some((end) => name.toLowerCase().endsWith(end));
}

/** The paths of the package's files, relative to the app's folder, with forward slashes. */
async function packagedFiles(directory: string, folder = ''): Promise<string[]> {
  const entries = await readdir(join(directory, folder), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    // Hidden folders hold the downloaded base, Git's data and the editor's settings.
    if (entry.name.startsWith('.')) {
      continue;
    }
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await packagedFiles(directory, path)));
    } else if (isPackaged(entry.name)) {
      if (!entry.isFile()) {
        throw new Error(`${path}: a package can hold files only, no links`);
      }
      if (path.includes('\\')) {
        throw new Error(`${path}: a file name in a package cannot hold a backslash`);
      }
      files.push(path);
    }
  }
  return files.sort();
}

/** The app's package, built in memory. The same files give the same bytes. */
export async function buildPackage(directory: string): Promise<Buffer> {
  const files = await packagedFiles(directory);
  if (files.length > LIMITS.files) {
    throw new Error(`The app has more than ${LIMITS.files} files`);
  }
  const zip = new ZipFile();
  const bytes = buffer(zip.outputStream);
  let unpacked = 0;
  for (const file of files) {
    const content = await readFile(join(directory, file));
    unpacked += content.length;
    if (content.length > LIMITS.file) {
      throw new Error(`${file} is larger than ${LIMITS.file / 1024 / 1024} MB`);
    }
    if (unpacked > LIMITS.unpacked) {
      throw new Error(`The app's files are larger than ${LIMITS.unpacked / 1024 / 1024} MB`);
    }
    zip.addBuffer(content, file, { mtime: new Date(2000, 0, 1), mode: 0o100644 });
  }
  zip.end();
  const result = await bytes;
  if (result.length > LIMITS.zipped) {
    throw new Error(`The package is larger than ${LIMITS.zipped / 1024 / 1024} MB`);
  }
  return result;
}

/** Writes the package to .goeasyerp/out/<name>-<version>.zip and returns its path. */
export async function writePackage(root: string, appDirectory: string): Promise<string> {
  const manifest = await readFile(join(appDirectory, 'application.yaml'), 'utf8');
  const { application } = (parse(manifest) ?? {}) as {
    application?: { name?: unknown; version?: unknown };
  };
  if (typeof application?.name !== 'string' || typeof application.version !== 'string') {
    throw new Error('application.yaml needs a name and a version');
  }
  const version = application.version.replaceAll(/[^\w.+-]/g, '_');
  const target = join(root, '.goeasyerp', 'out', `${slug(application.name)}-${version}.zip`);
  const content = await buildPackage(appDirectory);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}
