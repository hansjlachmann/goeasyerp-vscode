/**
 * A development container's whole life, with Docker and the published images. It takes a few
 * minutes. BASE_VERSION picks the base release.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freeSeries, parseSeries } from '../../src/app/series';
import { Docker } from '../../src/container/docker';
import { ContainerManager, FIRST_USER } from '../../src/container/manager';
import { findFreePort } from '../../src/container/ports';
import { ContainerStore, type Container } from '../../src/container/store';
import { run } from '../../src/runner';
import { ServerClient } from '../../src/server/client';
import { TESTED_BASE_VERSION } from './version';

const version = process.env.BASE_VERSION ?? TESTED_BASE_VERSION;
const password = `Pw-${randomBytes(16).toString('hex')}`;
const progress = { onOutput: (text: string) => process.stdout.write(text) };

describe(`a development container of base ${version}`, () => {
  const docker = new Docker(run);
  let root: string;
  let manager: ContainerManager;
  let container: Container;

  const client = () => new ServerClient(`http://127.0.0.1:${container.port}`);
  const login = () =>
    client().post('/api/auth/login', { user_id: FIRST_USER, password, company: 'main' });
  const state = async () => (await manager.states())[0]?.state;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'goeasyerp-integration-'));
    manager = new ContainerManager(new ContainerStore(root), docker);
    container = await manager.prepare(version, await findFreePort(18080));
  });

  afterAll(async () => {
    // Removes what a failed test left; after the last test there is nothing left.
    for (const left of await manager.store.list()) {
      await manager.remove(left, progress);
    }
    await rm(root, { recursive: true, force: true });
  });

  it('starts and answers with its version', async () => {
    await manager.start(container, progress);
    expect(await client().version()).toEqual({ version, build: 0 });
    expect(await state()).toBe('running');
  });

  it('makes the first user, who can log in', async () => {
    await manager.createFirstUser(container, password);
    await expect(login()).resolves.toBeDefined();
    expect((await manager.store.list())[0]?.userCreated).toBe(true);
  });

  it('tells which numbers its apps use', async () => {
    const server = client();
    await server.login(FIRST_USER, password, 'main');
    const used = (await server.installedApps()).flatMap((app) =>
      parseSeries(`${app.object_series}, ${app.field_series}`),
    );
    expect(used).toContainEqual({ from: 1, to: 999 });
    expect(freeSeries(used)).toEqual({ from: 50000, to: 50099 });
  });

  it('stops', async () => {
    await manager.stop(container, progress);
    expect(await state()).toBe('stopped');
    await expect(client().version()).rejects.toThrow();
  });

  it('starts again with its data', async () => {
    await manager.start(container, progress);
    await expect(login()).resolves.toBeDefined();
  });

  it('is removed with its database', async () => {
    await manager.remove(container, progress);
    expect(await manager.store.list()).toEqual([]);
    expect(await docker.hasVolumes(container.project)).toBe(false);
  });
});
