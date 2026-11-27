/**
 * F5's code path against a real development container: compiles the base's test app, publishes
 * it, and checks that the server runs the build. It takes several minutes: Docker, the network
 * and the first build of a new container.
 */
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findApp } from '../../src/app/application';
import { writeApp } from '../../src/app/template';
import { BaseWorkspace } from '../../src/base/workspace';
import { compile } from '../../src/build/compile';
import { buildPackage } from '../../src/build/package';
import { Docker } from '../../src/container/docker';
import { ContainerManager, FIRST_USER } from '../../src/container/manager';
import { findFreePort } from '../../src/container/ports';
import { ContainerStore, type Container } from '../../src/container/store';
import { GoToolchains } from '../../src/go/toolchain';
import { publishPackage, unpublishApp } from '../../src/publish/build';
import { Session } from '../../src/publish/session';
import { run } from '../../src/runner';
import { AuditRefused, ServerClient } from '../../src/server/client';
import { TESTED_BASE_VERSION } from './version';

const version = process.env.BASE_VERSION ?? TESTED_BASE_VERSION;
const password = `Pw-${randomBytes(16).toString('hex')}`;
const APP_ID = '0f72f6dc-d125-44df-90c1-e61420d854fe';

describe(`publishing to a development container of base ${version}`, () => {
  let temporary: string;
  let manager: ContainerManager;
  let container: Container;
  let workspace: BaseWorkspace;
  let client: ServerClient;
  let session: Session;
  let app: string;
  const steps: string[] = [];
  const follow = {
    onLog: (text: string) => process.stdout.write(text),
    onStep: (step: string) => steps.push(step),
  };

  const compiled = async () => {
    const lines: string[] = [];
    const result = await compile(workspace, version, run, { write: (text) => lines.push(text) });
    expect(result.package, lines.join('\n')).toBeDefined();
    return readFile(result.package!);
  };

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'goeasyerp-publish-'));
    manager = new ContainerManager(
      new ContainerStore(join(temporary, 'containers')),
      new Docker(run),
    );
    container = await manager.prepare(version, await findFreePort(18180));
    await manager.start(container);
    await manager.createFirstUser(container, password);
    client = new ServerClient(`http://127.0.0.1:${container.port}`);
    session = new Session(client, FIRST_USER, 'main', {
      stored: () => Promise.resolve(password),
      ask: () => Promise.resolve(undefined),
      keep: () => Promise.resolve(),
    });
    await session.login();

    // The base's test app, from the base's source of this version
    const toolchains = new GoToolchains(join(temporary, 'go'), run);
    const scratch = join(temporary, 'source');
    await writeApp(scratch, {
      name: 'Source',
      publisher: 'Tests',
      contact: 'https://example.com',
      prefix: 'src',
      baseVersion: version,
      series: { from: 60000, to: 60099 },
    });
    const first = new BaseWorkspace((await findApp(scratch))!, toolchains, run);
    await first.sync(version);
    app = join(temporary, 'app');
    await cp(join(scratch, '.goeasyerp/base', version, 'testdata/apps/loyalty-points'), app, {
      recursive: true,
    });
    workspace = new BaseWorkspace((await findApp(app))!, toolchains, run);
  }, 15 * 60_000);

  afterAll(async () => {
    for (const left of await manager.store.list()) {
      await manager.remove(left);
    }
    await rm(temporary, { recursive: true, force: true });
  });

  it("publishes the base's test app", async () => {
    const build = await publishPackage(session, client, await compiled(), follow);
    expect((await client.version()).build).toBe(build);
    expect(steps.length).toBeGreaterThan(2);
  });

  it('publishes a change of the code', async () => {
    const file = join(app, 'loyalty.go');
    const code = await readFile(file, 'utf8');
    await writeFile(file, code.replace('pointsPerInvoice = 10', 'pointsPerInvoice = 20'));
    const zip = await compiled();
    const started = Date.now();
    const build = await publishPackage(session, client, zip, follow);
    console.log(`a change of the code was live in ${Math.round((Date.now() - started) / 1000)} s`);
    expect((await client.version()).build).toBe(build);
  });

  it("gets the server's audit findings", async () => {
    await writeFile(
      join(app, 'spy.go'),
      'package loyaltypoints\n\nimport "os"\n\nvar _ = os.Args\n',
    );
    const error = await publishPackage(session, client, await buildPackage(app), follow).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AuditRefused);
    expect((error as AuditRefused).findings).toContainEqual(
      expect.objectContaining({ file: 'spy.go', line: 3 }),
    );
    await rm(join(app, 'spy.go'));
  });

  it('unpublishes it', async () => {
    const build = await unpublishApp(session, client, APP_ID, follow);
    expect((await client.version()).build).toBe(build);
  });
});
