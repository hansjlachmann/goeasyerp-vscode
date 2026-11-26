import { access, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { extract } from 'tar';
import { downloadFile, type DownloadOptions } from '../download';
import type { Runner } from '../runner';
import { compareVersions, isVersion } from '../version';
import { unzip } from './unzip';

const FILE_LIST = 'https://go.dev/dl/?mode=json&include=all';
const DOWNLOADS = 'https://go.dev/dl/';
const KEPT_VERSIONS = 2;

export interface GoToolchain {
  version: string;
  goroot: string;
  /** Whether the extension downloaded it, rather than finding it on the PATH. */
  managed: boolean;
}

export interface GoRelease {
  version: string;
  files: { filename: string; os: string; arch: string; kind: string; sha256: string }[];
}

/** The Go version the base is built with: its toolchain line, else its go line. */
export function requiredGoVersion(goMod: string): string {
  const match =
    /^toolchain\s+go(\d+\.\d+\.\d+)\s*$/m.exec(goMod) ?? /^go\s+(\d+\.\d+\.\d+)\s*$/m.exec(goMod);
  if (!match) {
    throw new Error('The go.mod of the base names no Go version');
  }
  return match[1];
}

/** The official archive of a Go version for a computer. */
export function goArchive(
  releases: GoRelease[],
  version: string,
  platform: NodeJS.Platform,
  arch: string,
): GoRelease['files'][number] {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform as string];
  const goArch = { x64: 'amd64', arm64: 'arm64' }[arch];
  const file = releases
    .find((release) => release.version === `go${version}`)
    ?.files.find((f) => f.kind === 'archive' && f.os === os && f.arch === goArch);
  if (!file || !/^[\w.-]+$/.test(file.filename)) {
    throw new Error(`There is no Go ${version} for ${platform} ${arch}`);
  }
  return file;
}

/** The environment for running a toolchain's go, whatever the developer's own Go settings are. */
export function goEnvironment(
  toolchain: GoToolchain,
  environment: NodeJS.ProcessEnv,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const result = { ...environment };
  // Windows writes it "Path"; setting a second spelling would leave which one counts open.
  const pathName = Object.keys(result).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  result[pathName] = [join(toolchain.goroot, 'bin'), result[pathName]]
    .filter(Boolean)
    .join(delimiter);
  return {
    ...result,
    GOROOT: toolchain.goroot,
    GOTOOLCHAIN: 'local',
    GOFLAGS: '',
    GOOS: '',
    GOARCH: '',
    ...extra,
  };
}

export interface Fetching {
  releases: (signal?: AbortSignal) => Promise<GoRelease[]>;
  file: (url: string, target: string, options?: DownloadOptions) => Promise<string>;
}

const fromGoDev: Fetching = {
  releases: async (signal) => {
    const response = await fetch(FILE_LIST, { signal });
    if (!response.ok) {
      throw new Error(`${FILE_LIST}: HTTP ${response.status}`);
    }
    return (await response.json()) as GoRelease[];
  },
  file: downloadFile,
};

export class GoToolchains {
  constructor(
    /** The folder the downloaded versions are kept in. */
    private readonly root: string,
    private readonly run: Runner,
    private readonly fetching: Fetching = fromGoDev,
    private readonly computer = { platform: process.platform, arch: process.arch as string },
  ) {}

  /** The Go of exactly this version: the one on the PATH, or a downloaded one. */
  async ensure(version: string, options: DownloadOptions = {}): Promise<GoToolchain> {
    if (!isVersion(version)) {
      throw new Error(`Not a Go version: ${version}`);
    }
    const installed = await this.onPath(version);
    if (installed) {
      return { version, goroot: installed, managed: false };
    }
    const goroot = join(this.root, version, 'go');
    if (!(await exists(goroot))) {
      await this.install(version, options);
    }
    await this.removeOld(version);
    return { version, goroot, managed: true };
  }

  private async onPath(version: string): Promise<string | undefined> {
    // GOTOOLCHAIN=local: the installed version, not one it would switch to.
    const env = { ...process.env, GOTOOLCHAIN: 'local', GOROOT: '' };
    try {
      const found = await this.run('go', ['version'], { env });
      if (found.code !== 0 || !found.stdout.includes(` go${version} `)) {
        return undefined;
      }
      const goroot = await this.run('go', ['env', 'GOROOT'], { env });
      return goroot.code === 0 ? goroot.stdout.trim() : undefined;
    } catch {
      return undefined; // no Go on the PATH
    }
  }

  private async install(version: string, options: DownloadOptions): Promise<void> {
    const releases = await this.fetching.releases(options.signal);
    const file = goArchive(releases, version, this.computer.platform, this.computer.arch);

    await mkdir(this.root, { recursive: true });
    // Unpacked aside and renamed when complete, so a broken download is never used.
    const temporary = await mkdtemp(join(this.root, 'download-'));
    try {
      const archive = join(temporary, file.filename);
      const sha256 = await this.fetching.file(DOWNLOADS + file.filename, archive, options);
      if (sha256 !== file.sha256) {
        throw new Error(`${file.filename}: the checksum does not match, the file is not used`);
      }
      const unpacked = join(temporary, 'unpacked');
      await mkdir(unpacked);
      if (file.filename.endsWith('.zip')) {
        await unzip(archive, unpacked);
      } else {
        // node-tar refuses paths outside the target folder.
        await extract({ file: archive, cwd: unpacked, strict: true });
      }
      await rm(join(this.root, version), { recursive: true, force: true });
      await rename(unpacked, join(this.root, version));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  /** Keeps the version in use and the newest other one. */
  private async removeOld(current: string): Promise<void> {
    const others = (await readdir(this.root).catch(() => []))
      .filter((name) => isVersion(name) && name !== current)
      .sort((a, b) => compareVersions(b, a));
    for (const version of others.slice(KEPT_VERSIONS - 1)) {
      await rm(join(this.root, version), { recursive: true, force: true });
    }
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
