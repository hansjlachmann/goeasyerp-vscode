import { access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { appDirectory } from '../app/application';
import type { BaseWorkspace, SyncOptions, SyncResult } from '../base/workspace';
import { goEnvironment } from '../go/toolchain';
import { messages } from '../messages';
import type { Runner } from '../runner';
import { readAudit, type Finding } from './audit';
import { relativeToWorkspace } from './goOutput';
import { writePackage } from './package';

export interface CompileOptions extends Omit<SyncOptions, 'onOutput'> {
  /** Receives the output, line by line or in blocks of lines. */
  write: (text: string) => void;
  /** Called when the base is ready, before the app is built. */
  onBase?: (result: SyncResult) => Promise<void>;
}

export interface CompileResult {
  /** The package's path; undefined when the app has errors. */
  package: string | undefined;
  findings: Finding[];
}

/**
 * Compiles the app on this computer, publishing nothing: merges the base if the definitions
 * changed, builds and vets the app, audits it and writes its package. Throws AppError for
 * errors of the merge.
 */
export function compile(
  workspace: BaseWorkspace,
  version: string,
  run: Runner,
  options: CompileOptions,
): Promise<CompileResult> {
  const { write, signal } = options;
  const { root } = workspace.app;
  const directory = appDirectory(workspace.app);

  // Nothing may merge while the app is built against the merged base.
  return workspace.exclusive(async () => {
    const base = await workspace.refresh(version, {
      ...options,
      onStep: (step) => write(messages.step[step]),
      onOutput: undefined,
    });
    await options.onBase?.(base);
    const { toolchain } = base;
    const go = (args: string[], cwd: string, env: NodeJS.ProcessEnv) =>
      run(join(toolchain.goroot, 'bin', 'go'), args, {
        cwd,
        env: goEnvironment(toolchain, process.env, env),
        signal,
      });

    let built = true;
    if (await exists(join(directory, 'go.mod'))) {
      for (const command of ['build', 'vet']) {
        write(`go ${command} ./...`);
        // The workspace's go.work joins the app and the merged base.
        const result = await go([command, './...'], directory, { GOWORK: '' });
        const output = `${result.stdout}${result.stderr}`.trim();
        if (output) {
          write(relativeToWorkspace(output, root, directory));
        }
        if (result.code !== 0) {
          built = false;
          break; // vet would repeat the build's errors
        }
      }
    }

    // The audit reads the source, so it also reports on an app that does not build.
    write(messages.auditing);
    const audited = await go(['run', './cmd/app-audit', '-json', directory], workspace.work, {
      GOWORK: 'off',
    });
    // 1: the app is refused; anything else is a failure of the audit itself.
    if (audited.code > 1 || !audited.stdout.trim().startsWith('[')) {
      throw new Error(`app-audit: ${audited.stderr.trim()}`);
    }
    const { findings, notes } = readAudit(audited.stdout, directory);
    for (const finding of findings) {
      // Not written as "file:line:", which the Go problem matcher would report a second time.
      const place = `${relative(root, finding.file)}, line ${finding.line}`;
      write(
        `${finding.excepted ? messages.approved : messages.refused} ${place}: ${finding.message}`,
      );
    }
    notes.forEach(write);

    if (!built || findings.some((finding) => !finding.excepted)) {
      return { package: undefined, findings };
    }
    const path = await writePackage(root, directory);
    write(messages.packaged(relative(root, path)));
    return { package: path, findings };
  });
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
