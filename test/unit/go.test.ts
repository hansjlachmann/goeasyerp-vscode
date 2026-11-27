import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { create } from 'tar';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  goArchive,
  goEnvironment,
  GoToolchains,
  requiredGoVersion,
  type Fetching,
  type GoRelease,
} from '../../src/go/toolchain';
import { unzip } from '../../src/go/unzip';
import type { Runner } from '../../src/runner';

const noGo: Runner = () => Promise.reject(new Error('ENOENT'));
const linux = { platform: 'linux' as const, arch: 'x64' };

describe('the Go the base needs', () => {
  it('is the toolchain line, else the go line', () => {
    expect(requiredGoVersion('go 1.26.0\n\ntoolchain go1.26.11\n')).toBe('1.26.11');
    expect(requiredGoVersion('module x\n\ngo 1.26.0\n')).toBe('1.26.0');
    expect(() => requiredGoVersion('module x\n')).toThrow();
  });

  it('has an archive per computer', () => {
    const file = { filename: 'a.zip', os: 'windows', arch: 'arm64', kind: 'archive', sha256: '' };
    const releases = [{ version: 'go1.26.11', files: [file] }];
    expect(goArchive(releases, '1.26.11', 'win32', 'arm64')).toBe(file);
    expect(() => goArchive(releases, '1.26.11', 'linux', 'x64')).toThrow('no Go 1.26.11');
  });

  it('runs with that Go and no other settings', () => {
    const toolchain = { version: '1.26.11', goroot: '/go', managed: true };
    const env = goEnvironment(toolchain, { Path: '/bin', GOFLAGS: '-mod=vendor' });
    expect(env.Path).toBe([join('/go', 'bin'), '/bin'].join(delimiter));
    expect(env).not.toHaveProperty('PATH');
    expect(env).toMatchObject({ GOROOT: '/go', GOTOOLCHAIN: 'local', GOFLAGS: '' });
  });
});

describe('managed Go', () => {
  let root: string;
  let archive: string;
  let sha256: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'goeasyerp-go-'));
    await mkdir(join(root, 'source/go/bin'), { recursive: true });
    await writeFile(join(root, 'source/go/bin/go'), 'program');
    archive = join(root, 'go.tar.gz');
    await create({ file: archive, cwd: join(root, 'source'), gzip: true }, ['go']);
    sha256 = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const fetching = (checksum: () => string): Fetching => ({
    releases: () =>
      Promise.resolve(
        ['1.24.0', '1.25.0', '1.26.11'].map((version): GoRelease => ({
          version: `go${version}`,
          files: [
            {
              filename: 'go.tar.gz',
              os: 'linux',
              arch: 'amd64',
              kind: 'archive',
              sha256: checksum(),
            },
          ],
        })),
      ),
    file: async (_url, target) => {
      await writeFile(target, await readFile(archive));
      return sha256;
    },
  });

  it('uses the Go on the PATH when its version is exactly the one needed', async () => {
    const run: Runner = (_command, args) =>
      Promise.resolve({
        code: 0,
        stdout: args[0] === 'version' ? 'go version go1.26.11 linux/amd64\n' : '/usr/local/go\n',
        stderr: '',
      });
    const toolchains = new GoToolchains(
      join(root, 'go'),
      run,
      fetching(() => 'unused'),
      linux,
    );
    expect(await toolchains.ensure('1.26.11')).toEqual({
      version: '1.26.11',
      goroot: '/usr/local/go',
      managed: false,
    });
  });

  it('knows its own download when that is the Go on the PATH', async () => {
    const store = join(root, 'go');
    const own = join(store, '1.26.11', 'go');
    let onPath = false;
    const run: Runner = (_command, args) =>
      onPath
        ? Promise.resolve({
            code: 0,
            stdout: args[0] === 'version' ? 'go version go1.26.11 linux/amd64\n' : `${own}\n`,
            stderr: '',
          })
        : noGo(_command, args);
    const toolchains = new GoToolchains(
      store,
      run,
      fetching(() => sha256),
      linux,
    );
    const first = await toolchains.ensure('1.26.11');
    onPath = true;

    expect(await toolchains.ensure('1.26.11')).toEqual(first);
    expect(first).toMatchObject({ goroot: own, managed: true });
  });

  it('downloads it otherwise, and keeps two versions', async () => {
    const store = join(root, 'go');
    const toolchains = new GoToolchains(
      store,
      noGo,
      fetching(() => sha256),
      linux,
    );
    await toolchains.ensure('1.24.0');
    await toolchains.ensure('1.25.0');
    const toolchain = await toolchains.ensure('1.26.11');

    expect(await readFile(join(toolchain.goroot, 'bin/go'), 'utf8')).toBe('program');
    expect((await readdir(store)).sort()).toEqual(['1.25.0', '1.26.11']);
  });

  it('refuses a download whose checksum does not match', async () => {
    const store = join(root, 'go');
    const toolchains = new GoToolchains(
      store,
      noGo,
      fetching(() => 'another'),
      linux,
    );
    await expect(toolchains.ensure('1.26.11')).rejects.toThrow('checksum');
    expect(await readdir(store)).toEqual([]);
  });

  /** A stored (uncompressed) zip with one file. */
  async function zipWith(entry: string, content: string): Promise<string> {
    const name = Buffer.from(entry);
    const data = Buffer.from(content);
    const header = (length: number, signature: number, sizes: number, nameLength: number) => {
      const buffer = Buffer.alloc(length);
      buffer.writeUInt32LE(signature, 0);
      buffer.writeUInt32LE(crc32(data), sizes);
      buffer.writeUInt32LE(data.length, sizes + 4);
      buffer.writeUInt32LE(data.length, sizes + 8);
      buffer.writeUInt16LE(name.length, nameLength);
      return buffer;
    };
    const local = header(30, 0x04034b50, 14, 26);
    const central = header(46, 0x02014b50, 16, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(local.length + name.length + data.length, 16);
    const zip = join(root, 'test.zip');
    await writeFile(zip, Buffer.concat([local, name, data, central, name, end]));
    return zip;
  }

  it('unpacks a zip', async () => {
    await unzip(await zipWith('go/bin/go.exe', 'program'), join(root, 'out'));
    expect(await readFile(join(root, 'out/go/bin/go.exe'), 'utf8')).toBe('program');
  });

  it('refuses a zip with a path outside its folder', async () => {
    const zip = await zipWith('../x', 'program');
    await expect(unzip(zip, join(root, 'out'))).rejects.toThrow(/relative path|outside/);
    await expect(readFile(join(root, 'x'))).rejects.toThrow();
  });
});
