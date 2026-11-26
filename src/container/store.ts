import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isVersion } from '../version';

/** One development container: a folder with the compose files, .env and container.json. */
export interface Container {
  /** The Compose project name; also the folder's name. */
  project: string;
  version: string;
  port: number;
  /** Whether the first user has been made. */
  userCreated: boolean;
}

const PROJECT = /^goeasyerp-dev-[0-9-]+$/;
const METADATA = 'container.json';

/** The project name for a version, with a number appended when the name is taken. */
export function projectName(version: string, taken: readonly string[]): string {
  const base = `goeasyerp-dev-${version.replaceAll('.', '-')}`;
  let name = base;
  for (let next = 2; taken.includes(name); next++) {
    name = `${base}-${next}`;
  }
  return name;
}

/** The address developers and launch configurations use. */
export function serverUrl(port: number): string {
  return `http://localhost:${port}`;
}

export class ContainerStore {
  constructor(readonly root: string) {}

  folder(project: string): string {
    if (!PROJECT.test(project)) {
      throw new Error(`Not a container name: ${project}`);
    }
    return join(this.root, project);
  }

  async list(): Promise<Container[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const containers = await Promise.all(
      names.filter((name) => PROJECT.test(name)).map((name) => this.read(name)),
    );
    return containers
      .filter((container) => container !== undefined)
      .sort((a, b) => a.project.localeCompare(b.project, 'en', { numeric: true }));
  }

  /** Makes the folder of a new container with its files. The folder must not exist. */
  async create(container: Container, files: Record<string, string>): Promise<void> {
    const folder = this.folder(container.project);
    await mkdir(this.root, { recursive: true });
    await mkdir(folder, { mode: 0o700 });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(folder, name), content, { mode: 0o600, flag: 'wx' });
    }
    await this.save(container);
  }

  async save(container: Container): Promise<void> {
    const file = join(this.folder(container.project), METADATA);
    await writeFile(file, `${JSON.stringify(container, null, 2)}\n`);
  }

  async delete(project: string): Promise<void> {
    await rm(this.folder(project), { recursive: true, force: true });
  }

  private async read(project: string): Promise<Container | undefined> {
    try {
      const text = await readFile(join(this.folder(project), METADATA), 'utf8');
      const value = JSON.parse(text) as Partial<Container>;
      if (!isVersion(String(value.version)) || !Number.isInteger(value.port)) {
        return undefined;
      }
      return {
        project,
        version: value.version as string,
        port: value.port as number,
        userCreated: value.userCreated === true,
      };
    } catch {
      return undefined; // not a container's folder, or one that was only half written
    }
  }
}
