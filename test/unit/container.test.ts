import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Docker } from '../../src/container/docker';
import { composeEnvironment, newEnvFile, readEnvValue } from '../../src/container/env';
import { ContainerManager } from '../../src/container/manager';
import { findFreePort, isPortFree } from '../../src/container/ports';
import { usableVersions } from '../../src/container/releases';
import { ContainerStore, projectName } from '../../src/container/store';
import { passwordKey, passwordProblem } from '../../src/password';
import type { Runner } from '../../src/runner';
import { compareVersions } from '../../src/version';

const ok = { code: 0, stdout: '', stderr: '' };

describe('versions', () => {
  it('compares by number, not by text', () => {
    expect(compareVersions('0.1.1000', '0.1.194')).toBeGreaterThan(0);
    expect(compareVersions('0.1.194', '0.2.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('offers only releases with the development endpoint, newest first', () => {
    const releases = [
      { tag_name: 'v0.1.193' },
      { tag_name: 'v0.1.194' },
      { tag_name: 'v0.1.200' },
      { tag_name: 'v0.2.0', draft: true },
      { tag_name: 'v0.3.0', prerelease: true },
      { tag_name: 'nightly' },
    ];
    expect(usableVersions(releases)).toEqual(['0.1.200', '0.1.194']);
  });
});

describe('.env', () => {
  it('has random secrets of the required lengths', () => {
    const env = newEnvFile(8081);
    const lengths = {
      JWT_SECRET: 64,
      POSTGRES_PASSWORD: 48,
      OPENERP_ENCRYPTION_KEY: 64,
      SETUP_TOKEN: 32,
      BUILDER_DB_PASSWORD: 48,
    };
    for (const [name, length] of Object.entries(lengths)) {
      expect(readEnvValue(env, name)).toMatch(new RegExp(`^[0-9a-f]{${length}}$`));
    }
    expect(readEnvValue(env, 'GOEASYERP_PORT')).toBe('8081');
    expect(readEnvValue(env, 'GOEASYERP_BIND')).toBe('127.0.0.1');
    expect(readEnvValue(env, 'COMPOSE_PROFILES')).toBe('apps');
    expect(newEnvFile(8081)).not.toBe(env);
  });

  it("keeps the developer's environment from overriding it", () => {
    const environment = { PATH: '/bin', GOEASYERP_BIND: '0.0.0.0', jwt_secret: 'x' };
    expect(composeEnvironment(environment)).toEqual({ PATH: '/bin' });
  });
});

describe('ports', () => {
  it('skips busy and reserved ports', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      expect(await isPortFree(port)).toBe(false);
      expect(await findFreePort(port, [port + 1])).toBeGreaterThan(port + 1);
    } finally {
      server.close();
    }
  });
});

describe('passwords', () => {
  it('checks the length and the user ID', () => {
    expect(passwordProblem('short', 'ADMIN')).toBeDefined();
    expect(passwordProblem('my-admin-password', 'ADMIN')).toBeDefined();
    expect(passwordProblem('correct horse battery', 'ADMIN')).toBeUndefined();
  });

  it('keys a password by server and user', () => {
    expect(passwordKey('http://LocalHost:8080/', 'admin')).toBe(
      passwordKey('http://localhost:8080', 'ADMIN'),
    );
  });
});

describe('containers', () => {
  let root: string;
  let store: ContainerStore;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'goeasyerp-test-'));
    store = new ContainerStore(join(root, 'containers'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('names projects by version', () => {
    expect(projectName('0.1.194', [])).toBe('goeasyerp-dev-0-1-194');
    expect(projectName('0.1.194', ['goeasyerp-dev-0-1-194'])).toBe('goeasyerp-dev-0-1-194-2');
  });

  it('writes the files of a new container, avoiding left-over volumes', async () => {
    const runner: Runner = (_command, args) =>
      Promise.resolve(
        args.at(-1) === 'label=com.docker.compose.project=goeasyerp-dev-0-1-194'
          ? { ...ok, stdout: 'volume\n' }
          : ok,
      );
    const manager = new ContainerManager(store, new Docker(runner), (url) => Promise.resolve(url));

    const container = await manager.prepare('0.1.194', 8082);

    expect(container.project).toBe('goeasyerp-dev-0-1-194-2');
    expect(await store.list()).toEqual([container]);
    if (process.platform !== 'win32') {
      const env = await stat(join(store.folder(container.project), '.env'));
      expect(env.mode & 0o777).toBe(0o600);
    }
  });

  it('writes nothing when a download fails', async () => {
    const manager = new ContainerManager(store, new Docker(() => Promise.resolve(ok)), () =>
      Promise.reject(new Error('offline')),
    );
    await expect(manager.prepare('0.1.194', 8082)).rejects.toThrow('offline');
    expect(await store.list()).toEqual([]);
  });

  it('keeps the folder when removing fails', async () => {
    const runner: Runner = (_command, args) =>
      Promise.resolve(args.includes('down') ? { code: 1, stdout: '', stderr: 'no engine' } : ok);
    const manager = new ContainerManager(store, new Docker(runner), () => Promise.resolve(''));
    const container = await manager.prepare('0.1.194', 8082);

    await expect(manager.remove(container)).rejects.toThrow('no engine');
    expect(await store.list()).toHaveLength(1);
  });

  it('takes over a container that has a user already', async () => {
    const server = createHttpServer((_request, response) => {
      response.writeHead(403).end('{"success":false,"error":"users exist"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const manager = new ContainerManager(store, new Docker(() => Promise.resolve(ok)), () =>
      Promise.resolve(''),
    );
    try {
      const { port } = server.address() as AddressInfo;
      const container = await manager.prepare('0.1.194', port);

      expect(await manager.createFirstUser(container, 'correct horse battery')).toBe(false);
      expect((await store.list())[0]?.userCreated).toBe(true);
    } finally {
      server.close();
    }
  });

  it('refuses names that are not containers', () => {
    expect(() => store.folder('../elsewhere')).toThrow();
  });
});

describe('docker', () => {
  const state = (runner: Runner) => new Docker(runner).state();

  it('tells apart what is wrong', async () => {
    const missing = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
    expect(await state(() => Promise.reject(missing))).toBe('missing');
    expect(await state(() => Promise.resolve({ ...ok, code: 1 }))).toBe('unreachable');
    expect(
      await state((_command, args) =>
        Promise.resolve(args[0] === 'compose' ? { ...ok, code: 1 } : ok),
      ),
    ).toBe('noCompose');
    expect(await state(() => Promise.resolve(ok))).toBe('ready');
  });
});
