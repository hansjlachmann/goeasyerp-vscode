import { access, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { appDirectory, type App } from '../app/application';
import type { DownloadOptions } from '../download';
import { goEnvironment, requiredGoVersion, type GoToolchain } from '../go/toolchain';
import type { Runner } from '../runner';
import { goWork, requiredBaseVersion, writeGoWork } from './gowork';
import { AppError, errorMessages, locate } from './problems';
import { ensureSource, type FetchSource } from './source';

const FOLDER = '.goeasyerp';
const WORK = `${FOLDER}/work`;

/** What a merge changes in the work copy; each merge starts from the base's own. */
const MERGED = [
  'backend/definitions',
  'backend/business-logic/tables',
  'backend/installedapps',
  'translations',
];

export interface SyncOptions {
  signal?: AbortSignal;
  onStep?: (step: 'source' | 'go' | 'copy' | 'merge' | 'generate') => void;
  onPercent?: DownloadOptions['onPercent'];
  onOutput?: (text: string) => void;
}

export interface SyncResult {
  toolchain: GoToolchain;
  /** Whether go.work or the base version changed: the language server must read them again. */
  changed: boolean;
}

export interface Toolchains {
  ensure(version: string, options?: DownloadOptions): Promise<GoToolchain>;
}

/** The base merged with an app, in the app's .goeasyerp folder. */
export class BaseWorkspace {
  constructor(
    readonly app: App,
    private readonly toolchains: Toolchains,
    private readonly run: Runner,
    private readonly fetchSource?: FetchSource,
  ) {}

  /** The base version used last. */
  async lastVersion(): Promise<string | undefined> {
    try {
      const text = await readFile(this.path(FOLDER, 'state.json'), 'utf8');
      const { version } = JSON.parse(text) as { version?: unknown };
      return typeof version === 'string' ? version : undefined;
    } catch {
      return undefined; // not set up yet, or a damaged file that the next merge replaces
    }
  }

  async rememberVersion(version: string): Promise<void> {
    await mkdir(this.path(FOLDER), { recursive: true });
    await writeFile(this.path(FOLDER, 'state.json'), `${JSON.stringify({ version })}\n`);
  }

  /**
   * Downloads the base of the version, merges the app into a work copy of it, generates the
   * table code and writes the workspace's go.work. Throws AppError for errors in the app.
   */
  async sync(version: string, options: SyncOptions = {}): Promise<SyncResult> {
    const { signal, onPercent, onStep } = options;
    const source = this.path(FOLDER, 'base', version);
    onStep?.('source');
    await ensureSource(source, version, { signal, onPercent }, this.fetchSource);
    await this.rememberVersion(version);

    onStep?.('go');
    const goMod = await readFile(join(source, 'go.mod'), 'utf8');
    const toolchain = await this.toolchains.ensure(requiredGoVersion(goMod), { signal, onPercent });

    const work = this.path(WORK);
    const marker = join(work, '.goeasyerp-version');
    const changedVersion = (await readFile(marker, 'utf8').catch(() => '')) !== version;
    if (changedVersion) {
      onStep?.('copy');
      await rm(work, { recursive: true, force: true });
      await cp(source, work, { recursive: true });
      await writeFile(marker, version);
    }

    onStep?.('merge');
    const merged = join(work, 'merged');
    const translations = join(work, 'merged-translations');
    await rm(translations, { recursive: true, force: true });
    await this.go(toolchain, options, [
      'run',
      './tools/extmerge',
      '--core',
      join(source, 'backend/definitions'),
      '--extensions',
      appDirectory(this.app),
      '--output',
      merged,
      '--translations',
      join(source, 'translations'),
      '--translations-output',
      translations,
      '--go-root',
      work,
    ]);

    // extmerge wrote the app's Register call; keep it while the base's own folders return.
    const wiring = join('backend/installedapps', 'apps_gen.go');
    const register = await readFile(join(work, wiring), 'utf8').catch(() => undefined);
    for (const folder of MERGED) {
      await rm(join(work, folder), { recursive: true, force: true });
    }
    await cp(merged, join(work, 'backend/definitions'), { recursive: true });
    await cp(
      join(source, 'backend/business-logic/tables'),
      join(work, 'backend/business-logic/tables'),
      { recursive: true },
    );
    await cp(join(source, 'backend/installedapps'), join(work, 'backend/installedapps'), {
      recursive: true,
    });
    if (register !== undefined) {
      await writeFile(join(work, wiring), register);
    }
    // An app without texts gets no merged translations: the base's own stay.
    const texts = (await exists(translations)) ? translations : join(source, 'translations');
    await cp(texts, join(work, 'translations'), { recursive: true });

    onStep?.('generate');
    await this.removeAppRecords(source, work);
    await this.go(toolchain, options, ['generate', './backend/generated/tables']);

    const appGoMod = await readFile(join(appDirectory(this.app), 'go.mod'), 'utf8').catch(() => '');
    const required = requiredBaseVersion(appGoMod);
    let changedWork = false;
    if (required) {
      const goLine = /^go\s+(\S+)/m.exec(goMod)![1];
      changedWork = await writeGoWork(
        this.app.root,
        goWork(this.app.folder, WORK, goLine, required),
      );
    }
    return { toolchain, changed: changedVersion || changedWork };
  }

  /**
   * Removes the records of tables an app added earlier. The generator would remove them too, but
   * "go generate" fails when a file of the package disappears while it runs.
   */
  private async removeAppRecords(source: string, work: string): Promise<void> {
    const folder = 'backend/generated/tables';
    const own = new Set(await readdir(join(source, folder)));
    for (const file of await readdir(join(work, folder))) {
      if (file.endsWith('_gen.go') && !own.has(file)) {
        await rm(join(work, folder, file));
      }
    }
  }

  private async go(toolchain: GoToolchain, options: SyncOptions, args: string[]): Promise<void> {
    const result = await this.run(join(toolchain.goroot, 'bin', 'go'), args, {
      cwd: this.path(WORK),
      // The work copy is built on its own: its go.work names the app, which may not compile.
      env: goEnvironment(toolchain, process.env, { GOWORK: 'off' }),
      signal: options.signal,
      onOutput: options.onOutput,
    });
    if (result.code === 0) {
      return;
    }
    const messages = errorMessages(`${result.stdout}\n${result.stderr}`);
    if (messages.length === 0) {
      throw new Error(`go ${args[0]}: ${result.stderr.trim().split('\n').at(-1) ?? ''}`);
    }
    const directory = appDirectory(this.app);
    const prefix = await this.prefix();
    throw new AppError(
      await Promise.all(messages.map((message) => locate(message, directory, prefix))),
    );
  }

  private async prefix(): Promise<string | undefined> {
    try {
      const text = await readFile(join(appDirectory(this.app), 'application.yaml'), 'utf8');
      const prefix = (parse(text) as { application?: { prefix?: unknown } }).application?.prefix;
      return typeof prefix === 'string' && /^[a-z0-9]+$/.test(prefix) ? prefix : undefined;
    } catch {
      return undefined;
    }
  }

  private path(...parts: string[]): string {
    return join(this.app.root, ...parts);
  }
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
