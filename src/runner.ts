import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Receives stdout and stderr as they arrive. */
  onOutput?: (text: string) => void;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a program without a shell. Resolves with its exit code; rejects when the program cannot
 * be started or the run is aborted.
 */
export type Runner = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

export const run: Runner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (text: string) => {
      stdout += text;
      options.onOutput?.(text);
    });
    child.stderr.setEncoding('utf8').on('data', (text: string) => {
      stderr += text;
      options.onOutput?.(text);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
