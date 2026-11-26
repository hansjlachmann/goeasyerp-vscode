import type { Runner, RunOptions, RunResult } from '../runner';
import { composeEnvironment } from './env';

export const COMPOSE_FILES = ['docker-compose.local.yml', 'docker-compose.dev.yml'] as const;

export type DockerState =
  /** The docker program is not installed. */
  | 'missing'
  /** Docker is installed, but its engine cannot be reached. */
  | 'unreachable'
  /** Docker works, but has no Compose plugin. */
  | 'noCompose'
  | 'ready';

export type ContainerState = 'running' | 'stopped' | 'absent';

export class DockerError extends Error {}

export class Docker {
  constructor(private readonly run: Runner) {}

  async state(): Promise<DockerState> {
    let engine: RunResult;
    try {
      engine = await this.run('docker', ['version']);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 'missing';
      }
      throw error;
    }
    if (engine.code !== 0) {
      return 'unreachable';
    }
    const compose = await this.run('docker', ['compose', 'version']);
    return compose.code === 0 ? 'ready' : 'noCompose';
  }

  /** Runs a Compose command for one container, in the folder holding its files. */
  async compose(
    folder: string,
    project: string,
    command: string[],
    options: Pick<RunOptions, 'signal' | 'onOutput'> = {},
  ): Promise<void> {
    const args = ['compose', '--progress', 'plain', '-p', project];
    for (const file of COMPOSE_FILES) {
      args.push('-f', file);
    }
    const result = await this.run('docker', [...args, ...command], {
      ...options,
      cwd: folder,
      env: composeEnvironment(process.env),
    });
    if (result.code !== 0) {
      throw new DockerError(`docker compose ${command.join(' ')}: ${lastLine(result.stderr)}`);
    }
  }

  /** The state of every Compose project, by name. */
  async projectStates(): Promise<Map<string, ContainerState>> {
    const output = await this.output(['compose', 'ls', '--all', '--format', 'json']);
    const projects = JSON.parse(output || '[]') as { Name: string; Status: string }[];
    return new Map(
      projects.map((project) => [
        project.Name,
        project.Status.includes('running') ? 'running' : 'stopped',
      ]),
    );
  }

  /** Whether volumes of a Compose project exist, for example from an earlier installation. */
  async hasVolumes(project: string): Promise<boolean> {
    const filter = `label=com.docker.compose.project=${project}`;
    return (await this.output(['volume', 'ls', '--quiet', '--filter', filter])) !== '';
  }

  private async output(args: string[]): Promise<string> {
    const result = await this.run('docker', args);
    if (result.code !== 0) {
      throw new DockerError(`docker ${args.slice(0, 2).join(' ')}: ${lastLine(result.stderr)}`);
    }
    return result.stdout.trim();
  }
}

function lastLine(text: string): string {
  return text.trim().split('\n').at(-1) ?? '';
}
