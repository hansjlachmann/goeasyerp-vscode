import { setTimeout as sleep } from 'node:timers/promises';
import { messages } from '../messages';
import { ServerError, type Build, type ServerClient } from '../server/client';
import type { Session } from './session';

export interface FollowOptions {
  signal?: AbortSignal;
  /** Receives the build's log as it grows. */
  onLog: (text: string) => void;
  /** Called with the heading of each step of the build. */
  onStep?: (step: string) => void;
  /** Milliseconds between two requests. */
  interval?: number;
  /** How long the server may be unreachable. */
  patience?: number;
}

const INTERVAL = 1500;
const PATIENCE = 60_000;

/** A server that restarts, cannot be reached, or asks to slow down: worth asking again. */
function isPassing(error: unknown): boolean {
  return !(error instanceof ServerError) || [429, 502, 503, 504].includes(error.status);
}

/** Asks until the answer satisfies, quietly asking again while the server is unreachable. */
async function poll<T>(
  ask: () => Promise<T>,
  done: (answer: T) => boolean,
  options: FollowOptions,
  /** How long the answer may take to satisfy; undefined: as long as the server answers. */
  within?: number,
): Promise<T> {
  const patience = options.patience ?? PATIENCE;
  const deadline = within === undefined ? Infinity : Date.now() + within;
  let answered = Date.now();
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      const answer = await ask();
      if (done(answer)) {
        return answer;
      }
      answered = Date.now();
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!isPassing(error) || Date.now() - answered >= patience) {
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(messages.notLive);
    }
    await sleep(options.interval ?? INTERVAL, undefined, { signal: options.signal });
  }
}

/** Shows a build until it is done and the server runs it. */
export async function followBuild(
  session: Session,
  client: ServerClient,
  no: number,
  options: FollowOptions,
): Promise<void> {
  let from = 0;
  let line = '';
  const read = async (): Promise<Build> => {
    const build = await session.request((c) => c.build(no, from, options.signal));
    from = build.log_size;
    if (build.log) {
      options.onLog(build.log);
      const lines = (line + build.log).split('\n');
      line = lines.pop() ?? '';
      for (const complete of lines) {
        const step = /(?:^|\s)== (.+)$/.exec(complete.trimEnd())?.[1];
        if (step) {
          options.onStep?.(step);
        }
      }
    }
    return build;
  };
  const build = await poll(read, (answer) => answer.done, options);
  if (build.status !== 'Succeeded') {
    throw new Error(messages.buildFailed(no, build.status, build.error_message));
  }
  options.onStep?.(messages.switching);
  await poll(
    () => client.version(options.signal),
    (answer) => answer.build === no,
    options,
    options.patience ?? PATIENCE,
  );
}

/** Publishes a package and waits until the server runs it. Answers the build's number. */
export async function publishPackage(
  session: Session,
  client: ServerClient,
  zip: Buffer,
  options: FollowOptions,
): Promise<number> {
  const { build_no } = await withEndpoint(() =>
    session.request((c) => c.publish(zip, options.signal)),
  );
  await followBuild(session, client, build_no, options);
  return build_no;
}

/** Takes an app out again and waits until the server runs the build without it. */
export async function unpublishApp(
  session: Session,
  client: ServerClient,
  appId: string,
  options: FollowOptions,
): Promise<number> {
  const { build_no } = await withEndpoint(() =>
    session.request((c) => c.unpublish(appId, options.signal)),
  );
  await followBuild(session, client, build_no, options);
  return build_no;
}

/** A 404 for these requests: the server has no development endpoint. */
async function withEndpoint<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof ServerError && error.status === 404) {
      throw new Error(messages.notDevelopmentServer, { cause: error });
    }
    throw error;
  }
}
