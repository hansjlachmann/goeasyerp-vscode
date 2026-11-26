import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerClient, ServerError } from '../../src/server/client';
import { waitForServer } from '../../src/server/wait';

let server: Server | undefined;
afterEach(() => server?.close());

async function serve(status: number, body: string, seen: IncomingHttpHeaders[] = []) {
  server = createServer((request, response) => {
    seen.push(request.headers);
    response.writeHead(status).end(body);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return new ServerClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
}

const user = { user_id: 'ADMIN', user_name: 'A', password: 'p', setup_token: 't' };

describe('server client', () => {
  it('reads the version', async () => {
    const client = await serve(200, '{"version":"0.1.194","build":3}');
    expect(await client.version()).toEqual({ version: '0.1.194', build: 3 });
  });

  it('sends no Origin header', async () => {
    const seen: IncomingHttpHeaders[] = [];
    const client = await serve(200, '{"success":true,"data":{}}', seen);
    await client.createFirstUser(user);
    expect(seen[0]).not.toHaveProperty('origin');
  });

  it("reports the server's error and status", async () => {
    const client = await serve(400, '{"success":false,"error":"too common"}');
    await expect(client.createFirstUser(user)).rejects.toEqual(new ServerError('too common', 400));
  });

  it('does not take an error page for a version', async () => {
    const client = await serve(502, '<html>Bad Gateway</html>');
    await expect(client.version()).rejects.toThrow('HTTP 502');
  });
});

describe('waiting for the server', () => {
  it('asks until the server answers', async () => {
    let calls = 0;
    const client = {
      version: () =>
        ++calls < 3
          ? Promise.reject(new Error('refused'))
          : Promise.resolve({ version: '0.1.194', build: 0 }),
    };
    await waitForServer(client, { timeout: 1000, interval: 1 });
    expect(calls).toBe(3);
  });

  it('gives up after the timeout', async () => {
    const client = { version: () => Promise.reject(new Error('refused')) };
    await expect(waitForServer(client, { timeout: 5, interval: 1 })).rejects.toThrow('refused');
  });

  it('stops when cancelled', async () => {
    const abort = new AbortController();
    const client = { version: () => Promise.reject(new Error('refused')) };
    const waiting = waitForServer(client, { signal: abort.signal, timeout: 60_000 });
    abort.abort();
    await expect(waiting).rejects.toHaveProperty('name', 'AbortError');
  });
});
