import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { goProblems } from '../../src/build/goOutput';
import { PublishAdapter, type Message } from '../../src/debug/adapter';
import { publishPackage, unpublishApp } from '../../src/publish/build';
import {
  DEFAULT_CONFIGURATION,
  readTarget,
  requestAddress,
  startPage,
} from '../../src/publish/config';
import { Session, type Passwords } from '../../src/publish/session';
import { AuditRefused, ServerClient } from '../../src/server/client';

describe('a launch configuration', () => {
  it('has defaults', () => {
    const target = readTarget({ ...DEFAULT_CONFIGURATION });
    expect(target).toMatchObject({ user: 'ADMIN', company: 'main', openBrowser: true });
    expect(startPage(target)).toBe('http://localhost:8080/');
    expect(startPage({ ...target, startupPageId: 22 })).toBe('http://localhost:8080/pages/22');
  });

  it('refuses what it cannot use', () => {
    const bad = (extra: object) => () => readTarget({ ...DEFAULT_CONFIGURATION, ...extra });
    expect(bad({ server: 'localhost:8080' })).toThrow('server');
    expect(bad({ server: 'http://host/path' })).toThrow('server');
    expect(bad({ server: 'http://name:secret@host' })).toThrow('server');
    expect(bad({ schemaUpdateMode: 'recreate' })).toThrow('not available yet');
    expect(bad({ startupPageId: '22' })).toThrow('startupPageId');
  });

  it('calls a local container on 127.0.0.1', () => {
    expect(requestAddress('http://localhost:8081')).toBe('http://127.0.0.1:8081');
    expect(requestAddress('https://dev.example.com')).toBe('https://dev.example.com');
  });
});

type Answer = [status: number, body: object | string];

let server: Server | undefined;
afterEach(() => server?.close());

/** A server that answers each request with the next answer listed for it. */
async function script(answers: Record<string, Answer[]>) {
  const requests: string[] = [];
  server = createServer((request: IncomingMessage, response) => {
    request.resume().on('end', () => {
      const key = `${request.method} ${request.url}`;
      requests.push(key);
      const list = answers[key] ?? [];
      const [status, body] = (list.length > 1 ? list.shift() : list[0]) ?? [404, {}];
      const cookie = key === 'POST /api/auth/login' ? { 'set-cookie': 'openerp_session=s' } : {};
      response.writeHead(status, cookie);
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const client = new ServerClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  return { client, requests };
}

const ok = (data: object): Answer => [200, { success: true, data }];
const refused: Answer = [401, { success: false, error: 'wrong password' }];
const building = (extra: object): Answer =>
  ok({ status: 'Running', done: false, error_message: '', log: '', log_size: 0, ...extra });

function passwords(asked: (string | undefined)[], stored?: string) {
  const kept: string[] = [];
  const problems: (string | undefined)[] = [];
  const value: Passwords = {
    stored: () => Promise.resolve(stored),
    ask: (problem) => {
      problems.push(problem);
      return Promise.resolve(asked.shift());
    },
    keep: (password) => Promise.resolve(void kept.push(password)),
  };
  return { value, kept, problems };
}

describe('the login', () => {
  const login = 'POST /api/auth/login';

  it('asks again after a wrong password, and keeps the right one', async () => {
    const { client } = await script({ [login]: [refused, ok({})] });
    const given = passwords(['right'], 'old');
    await new Session(client, 'ADMIN', 'main', given.value).login();
    expect(given.problems).toEqual(['wrong password']);
    expect(given.kept).toEqual(['right']);
  });

  it('ends when the user gives up, or the server locks the address', async () => {
    const { client } = await script({ [login]: [[429, { success: false, error: 'wait' }]] });
    const given = passwords([], 'any');
    await expect(new Session(client, 'ADMIN', 'main', given.value).login()).rejects.toThrow('wait');
    await expect(
      new Session(client, 'ADMIN', 'main', passwords([]).value).login(),
    ).rejects.toHaveProperty('name', 'AbortError');
  });
});

describe('a publish', () => {
  const requested = ok({ build_no: 7 });
  const options = () => {
    const log: string[] = [];
    const steps: string[] = [];
    return {
      log,
      steps,
      onLog: (text: string) => log.push(text),
      onStep: (step: string) => steps.push(step),
      interval: 1,
      patience: 200,
    };
  };
  const start = async (answers: Record<string, Answer[]>) => {
    const { client, requests } = await script({ 'POST /api/auth/login': [ok({})], ...answers });
    const session = new Session(client, 'ADMIN', 'main', passwords([], 'password').value);
    return { client, session, requests };
  };

  it('shows the log, rides out a restart and waits until the build is live', async () => {
    const { client, session } = await start({
      'POST /api/dev/apps': [requested],
      'GET /api/dev/builds/7?from=0': [
        building({ log: '2026/01/01 == Copying\n== Comp', log_size: 10 }),
      ],
      'GET /api/dev/builds/7?from=10': [
        [502, 'Bad Gateway'],
        building({ status: 'Succeeded', done: true, log: 'iling\n', log_size: 16 }),
      ],
      'GET /api/version': [
        [502, 'Bad Gateway'],
        [200, { version: '0.1.197', build: 6 }],
        [200, { version: '0.1.197', build: 7 }],
      ],
    });
    const seen = options();
    expect(await publishPackage(session, client, Buffer.from('zip'), seen)).toBe(7);
    expect(seen.log.join('')).toBe('2026/01/01 == Copying\n== Compiling\n');
    expect(seen.steps.slice(0, 2)).toEqual(['Copying', 'Compiling']);
  });

  it('logs in again when the session has ended', async () => {
    const { client, session, requests } = await start({
      'POST /api/dev/apps': [refused, requested],
      'GET /api/dev/builds/7?from=0': [building({ status: 'Succeeded', done: true })],
      'GET /api/version': [[200, { version: '0.1.197', build: 7 }]],
    });
    await publishPackage(session, client, Buffer.from('zip'), options());
    expect(requests.filter((r) => r === 'POST /api/auth/login')).toHaveLength(1);
    expect(requests.filter((r) => r === 'POST /api/dev/apps')).toHaveLength(2);
  });

  it("reports a failed build with the server's reason", async () => {
    const { client, session } = await start({
      'POST /api/dev/apps': [requested],
      'GET /api/dev/builds/7?from=0': [
        building({ status: 'Failed', done: true, error_message: 'compile error' }),
      ],
    });
    await expect(publishPackage(session, client, Buffer.from('z'), options())).rejects.toThrow(
      'Build 7 failed: compile error',
    );
  });

  it("gives the audit's findings", async () => {
    const finding = { rule: 'import', file: 'a.go', line: 3, key: 'os', detail: 'no' };
    const { client, session } = await start({
      'POST /api/dev/apps': [
        [422, { success: false, error: 'refused', data: { findings: [finding] } }],
      ],
    });
    const error = await publishPackage(session, client, Buffer.from('z'), options()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AuditRefused);
    expect((error as AuditRefused).findings).toEqual([finding]);
  });

  it('says when the server is not for development, and does not retry', async () => {
    const { client, session, requests } = await start({});
    await expect(unpublishApp(session, client, 'id', options())).rejects.toThrow(
      'not a development server',
    );
    expect(requests).toEqual(['DELETE /api/dev/apps/id']);
  });

  it('gives up on a server that stays unreachable', async () => {
    const { client, session } = await start({
      'POST /api/dev/apps': [requested],
      'GET /api/dev/builds/7?from=0': [[502, 'Bad Gateway']],
    });
    await expect(
      publishPackage(session, client, Buffer.from('z'), { ...options(), patience: 20 }),
    ).rejects.toThrow('HTTP 502');
  });

  it('stops waiting when cancelled', async () => {
    const { client, session } = await start({
      'POST /api/dev/apps': [requested],
      'GET /api/dev/builds/7?from=0': [building({})],
    });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 30);
    await expect(
      publishPackage(session, client, Buffer.from('z'), { ...options(), signal: abort.signal }),
    ).rejects.toHaveProperty('name', 'AbortError');
  });
});

describe('the launch session', () => {
  const run = async (noDebug: boolean, fail = false) => {
    const sent: string[] = [];
    let published: boolean | undefined;
    const done = new Promise<void>((resolve) => {
      const send = (message: Message) => {
        sent.push(message.type === 'event' ? message.event : message.command);
        if (message.type === 'event' && message.event === 'terminated') {
          resolve();
        }
      };
      const adapter = new PublishAdapter(send, (value) => {
        published = value;
        return fail ? Promise.reject(new Error('x')) : Promise.resolve();
      });
      adapter.handle({ type: 'request', seq: 1, command: 'initialize' });
      adapter.handle({ type: 'request', seq: 2, command: 'launch', arguments: { noDebug } });
    });
    await done;
    return { sent, published };
  };

  it('publishes and ends', async () => {
    expect(await run(true)).toEqual({
      sent: ['initialize', 'initialized', 'launch', 'terminated'],
      published: true,
    });
    expect((await run(false, true)).sent).toContain('terminated');
  });

  it('aborts the publish when stopped', () => {
    let signal: AbortSignal | undefined;
    const adapter = new PublishAdapter(
      () => {},
      (_noDebug, given) => {
        signal = given;
        return new Promise(() => {});
      },
    );
    adapter.handle({ type: 'request', seq: 1, command: 'launch' });
    adapter.handle({ type: 'request', seq: 2, command: 'disconnect' });
    expect(signal?.aborted).toBe(true);
  });
});

describe("Go's errors", () => {
  it('have a file and a line', () => {
    const output = '# pkg\nregister.go:4:19: undefined: missing\nvet: sub/a.go:2: bad';
    expect(goProblems(output, '/w')).toEqual([
      { file: '/w/register.go', line: 4, message: 'undefined: missing' },
      { file: '/w/sub/a.go', line: 2, message: 'bad' },
    ]);
  });
});
