import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServerClient, ServerError } from '../server/client';
import { waitForServer } from '../server/wait';
import { COMPOSE_FILES, type ContainerState, type Docker } from './docker';
import { newEnvFile, readEnvValue } from './env';
import { projectName, type Container, type ContainerStore } from './store';

export const FIRST_USER = 'ADMIN';
const FIRST_USER_NAME = 'Administrator';

// A first start makes the tables and the demo data, which takes 1-3 minutes.
const START_TIMEOUT = 10 * 60_000;

export interface Progress {
  signal?: AbortSignal;
  onOutput?: (text: string) => void;
}

export type Download = (url: string, signal?: AbortSignal) => Promise<string>;

export const download: Download = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.text();
};

export function composeFileUrl(version: string, file: string): string {
  return `https://raw.githubusercontent.com/hansjlachmann/goeasyerp/v${version}/${file}`;
}

/** The address the extension itself calls: the port is published on 127.0.0.1 only. */
function localClient(container: Container): ServerClient {
  return new ServerClient(`http://127.0.0.1:${container.port}`);
}

export class ContainerManager {
  constructor(
    readonly store: ContainerStore,
    private readonly docker: Docker,
    private readonly fetchFile: Download = download,
  ) {}

  /** Writes the files of a new container. Nothing runs yet. */
  async prepare(version: string, port: number, signal?: AbortSignal): Promise<Container> {
    const files: Record<string, string> = {};
    for (const file of COMPOSE_FILES) {
      files[file] = await this.fetchFile(composeFileUrl(version, file), signal);
    }
    files['.env'] = newEnvFile(port);

    // A new password would not open the database of a volume that is left over.
    const taken = (await this.store.list()).map((container) => container.project);
    let project = projectName(version, taken);
    while (await this.docker.hasVolumes(project)) {
      taken.push(project);
      project = projectName(version, taken);
    }

    const container: Container = { project, version, port, userCreated: false };
    await this.store.create(container, files);
    return container;
  }

  /** Starts a container and waits until its server answers. */
  async start(container: Container, progress: Progress = {}): Promise<void> {
    await this.compose(container, ['up', '-d'], progress);
    const server = await waitForServer(localClient(container), {
      signal: progress.signal,
      timeout: START_TIMEOUT,
    });
    // Whatever else might answer on the port must not get the setup token.
    if (server.version !== container.version) {
      throw new Error(
        `Port ${container.port} answers with version ${server.version}, not ${container.version}`,
      );
    }
  }

  async stop(container: Container, progress: Progress = {}): Promise<void> {
    await this.compose(container, ['stop'], progress);
  }

  /** Removes the container with its database, and its folder. */
  async remove(container: Container, progress: Progress = {}): Promise<void> {
    await this.compose(container, ['down', '--volumes', '--remove-orphans'], progress);
    await this.store.delete(container.project);
  }

  /**
   * Makes the first user of a running container, with the setup token of its .env file.
   * Answers false when the container has a user already, for example one made in the browser.
   */
  async createFirstUser(container: Container, password: string): Promise<boolean> {
    const env = await readFile(join(this.store.folder(container.project), '.env'), 'utf8');
    let created = true;
    try {
      await localClient(container).createFirstUser({
        user_id: FIRST_USER,
        user_name: FIRST_USER_NAME,
        password,
        setup_token: readEnvValue(env, 'SETUP_TOKEN') ?? '',
      });
    } catch (error) {
      if (!(error instanceof ServerError) || error.status !== 403) {
        throw error;
      }
      created = false;
    }
    await this.store.save({ ...container, userCreated: true });
    return created;
  }

  async states(): Promise<{ container: Container; state: ContainerState }[]> {
    const states = await this.docker.projectStates();
    return (await this.store.list()).map((container) => ({
      container,
      state: states.get(container.project) ?? 'absent',
    }));
  }

  private compose(container: Container, command: string[], progress: Progress): Promise<void> {
    const folder = this.store.folder(container.project);
    return this.docker.compose(folder, container.project, command, progress);
  }
}
