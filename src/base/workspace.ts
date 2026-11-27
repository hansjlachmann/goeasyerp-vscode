import { access, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { appDirectory, type App } from '../app/application';
import type { DownloadOptions } from '../download';
import { goEnvironment, requiredGoVersion, type GoToolchain } from '../go/toolchain';
import type { Runner } from '../runner';
import { definitionsHash } from './definitions';
import { goWork, requiredBaseVersion, writeGoWork } from './gowork';
import { AppError, errorMessages, locate } from './problems';
import { ensureSource, type FetchSource } from './source';

const FOLDER = '.goeasyerp';
const WORK = `${FOLDER}/work`;
/** The file of the work copy that names its base version. */
const MARKER = '.goeasyerp-version';

interface State {
  version?: string;
  /** The hash of the app's definitions at the last complete merge. */
  definitions?: string;
}

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
  private last: Promise<unknown> = Promise.resolve();

  constructor(
    readonly app: App,
    private readonly toolchains: Toolchains,
    private readonly run: Runner,
    private readonly fetchSource?: FetchSource,
  ) {}

  /** The base version used last. */
  async lastVersion(): Promise<string | undefined> {
    const { version } = await this.state();
    return typeof version === 'string' ? version : undefined;
  }

  /** The work copy: the base merged with the app. */
  get work(): string {
    return this.path(WORK);
  }

  /** Runs one task at a time among those that read or write the work copy. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.last.then(task, task);
    this.last = result.catch(() => undefined);
    return result;
  }

  /** Merges anew, after any other task on the work copy. */
  sync(version: string, options: SyncOptions = {}): Promise<SyncResult> {
    return this.exclusive(() => this.merge(version, options));
  }

  /**
   * Merges unless the last merge was of this version and the app's definitions are the same.
   * To be called within exclusive().
   */
  async refresh(version: string, options: SyncOptions = {}): Promise<SyncResult> {
    const state = await this.state();
    const marker = await readFile(join(this.work, MARKER), 'utf8').catch(() => '');
    if (
      state.version !== version ||
      marker !== version ||
      state.definitions !== (await definitionsHash(appDirectory(this.app)))
    ) {
      return this.merge(version, options);
    }
    const goMod = await readFile(this.path(FOLDER, 'base', version, 'go.mod'), 'utf8');
    const toolchain = await this.toolchains.ensure(requiredGoVersion(goMod), options);
    return { toolchain, changed: false };
  }

  /**
   * Downloads the base of the version, merges the app into a work copy of it, generates the
   * table code and writes the workspace's go.work. Throws AppError for errors in the app.
   */
  private async merge(version: string, options: SyncOptions): Promise<SyncResult> {
    const { signal, onPercent, onStep } = options;
    const source = this.path(FOLDER, 'base', version);
    onStep?.('source');
    await ensureSource(source, version, { signal, onPercent }, this.fetchSource);
    // Without the definitions' hash until the merge is complete: a broken one is repeated.
    await this.save({ version });
    const definitions = await definitionsHash(appDirectory(this.app));

    onStep?.('go');
    const goMod = await readFile(join(source, 'go.mod'), 'utf8');
    const toolchain = await this.toolchains.ensure(requiredGoVersion(goMod), { signal, onPercent });

    const work = this.path(WORK);
    const marker = join(work, MARKER);
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
    await this.save({ version, definitions });
    return { toolchain, changed: changedVersion || changedWork };
  }

  private async state(): Promise<State> {
    try {
      return JSON.parse(await readFile(this.path(FOLDER, 'state.json'), 'utf8')) as State;
    } catch {
      return {}; // not set up yet, or a damaged file that the next merge replaces
    }
  }

  private async save(state: State): Promise<void> {
    await mkdir(this.path(FOLDER), { recursive: true });
    await writeFile(this.path(FOLDER, 'state.json'), `${JSON.stringify(state)}\n`);
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
