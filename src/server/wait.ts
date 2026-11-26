import { setTimeout as sleep } from 'node:timers/promises';
import type { ServerClient, ServerVersion } from './client';

/** Asks for the server's version until it answers. */
export async function waitForServer(
  client: Pick<ServerClient, 'version'>,
  options: { signal?: AbortSignal; timeout: number; interval?: number },
): Promise<ServerVersion> {
  const deadline = Date.now() + options.timeout;
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      return await client.version(options.signal);
    } catch (error) {
      options.signal?.throwIfAborted();
      if (Date.now() >= deadline) {
        throw error;
      }
    }
    await sleep(options.interval ?? 2000, undefined, { signal: options.signal });
  }
}
