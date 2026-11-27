import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface ServerVersion {
  version: string;
  build: number;
}

export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Response {
  status: number;
  body: unknown;
}

/** An app installed on a server, with its number series as text ("50000–50099, …"). */
export interface InstalledApp {
  object_series?: string;
  field_series?: string;
}

/** A build the server was asked for. */
export interface Requested {
  build_no: number;
}

export interface Build {
  status: string;
  done: boolean;
  error_message: string;
  /** The log from the byte asked for. */
  log: string;
  /** Where the next request for the log starts. */
  log_size: number;
}

/** A finding of the server's app audit; the file is relative to the app's folder. */
export interface ServerFinding {
  rule?: string;
  file?: string;
  line?: number;
  key?: string;
  detail?: string;
  excepted?: boolean;
}

/** The server's app audit refused the package. */
export class AuditRefused extends ServerError {
  constructor(
    message: string,
    readonly findings: ServerFinding[],
  ) {
    super(message, 422);
  }
}

interface Body {
  type: string;
  data: Buffer;
}

const SESSION_COOKIE = 'openerp_session';

const TIMEOUT = 15_000;
// The server unpacks and audits a package before it answers.
const PUBLISH_TIMEOUT = 120_000;

/**
 * The server's API. It uses Node's HTTP client, which sends no Origin header: the server's
 * cross-site check lets such requests through.
 */
export class ServerClient {
  private session: string | undefined;

  constructor(private readonly server: string) {}

  async version(signal?: AbortSignal): Promise<ServerVersion> {
    const { status, body } = await this.send('GET', '/api/version', undefined, signal);
    const value = body as Partial<ServerVersion> | undefined;
    if (status !== 200 || typeof value?.version !== 'string' || typeof value.build !== 'number') {
      throw new ServerError(`Unexpected answer to /api/version (HTTP ${status})`, status);
    }
    return { version: value.version, build: value.build };
  }

  async createFirstUser(user: {
    user_id: string;
    user_name: string;
    password: string;
    setup_token: string;
  }): Promise<void> {
    await this.post('/api/auth/init', user);
  }

  /** Logs in; the session cookie is kept in memory for the following requests. */
  async login(user: string, password: string, company: string): Promise<void> {
    await this.post('/api/auth/login', { user_id: user, password, company });
  }

  /** The apps installed on the server, the base application among them. Needs a login. */
  async installedApps(signal?: AbortSignal): Promise<InstalledApp[]> {
    const response = await this.send('GET', '/api/tables/Installed_App/list', undefined, signal);
    return (this.data(response) as { records?: InstalledApp[] }).records ?? [];
  }

  /** Publishes an app's package on a development server. Needs a login. */
  async publish(zip: Buffer, signal?: AbortSignal): Promise<Requested> {
    const response = await this.send(
      'POST',
      '/api/dev/apps',
      { type: 'application/zip', data: zip },
      signal,
      PUBLISH_TIMEOUT,
    );
    const answer = response.body as
      { error?: string; data?: { findings?: ServerFinding[] | null } } | undefined;
    if (response.status === 422) {
      throw new AuditRefused(answer?.error ?? 'HTTP 422', answer?.data?.findings ?? []);
    }
    return this.data(response) as Requested;
  }

  async unpublish(appId: string, signal?: AbortSignal): Promise<Requested> {
    const path = `/api/dev/apps/${encodeURIComponent(appId)}`;
    return this.data(
      await this.send('DELETE', path, undefined, signal, PUBLISH_TIMEOUT),
    ) as Requested;
  }

  /** A build's state, with its log from the byte `from`. */
  async build(no: number, from: number, signal?: AbortSignal): Promise<Build> {
    const path = `/api/dev/builds/${no}?from=${from}`;
    return this.data(await this.send('GET', path, undefined, signal)) as Build;
  }

  /** Sends a JSON request and returns the answer's data; throws the server's error. */
  async post(path: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.data(await this.send('POST', path, json(payload), signal));
  }

  private data({ status, body }: Response): unknown {
    const answer = body as { success?: boolean; data?: unknown; error?: string } | undefined;
    if (status !== 200 || !answer?.success) {
      throw new ServerError(answer?.error ?? `HTTP ${status}`, status);
    }
    return answer.data;
  }

  private send(
    method: string,
    path: string,
    body: Body | undefined,
    signal: AbortSignal | undefined,
    limit = TIMEOUT,
  ): Promise<Response> {
    const url = new URL(path, this.server);
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers: Record<string, string | number> = { Accept: 'application/json' };
    if (this.session) {
      headers.Cookie = this.session;
    }
    if (body) {
      headers['Content-Type'] = body.type;
      headers['Content-Length'] = body.data.length;
    }
    const timeout = AbortSignal.timeout(limit);
    return new Promise((resolve, reject) => {
      const request = send(
        url,
        { method, headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout },
        (response) => {
          // Bytes, decoded at the end: with setEncoding, Node's network inspection (on while
          // the extension is debugged) throws on every chunk, and the answer is lost.
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            const cookies = response.headers['set-cookie'] ?? [];
            const session = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
            this.session = session?.split(';')[0] ?? this.session;
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: response.statusCode ?? 0, body: parseJson(text) });
          });
        },
      );
      request.on('error', (error) => {
        const slow = timeout.aborted && !signal?.aborted;
        reject(slow ? new Error(`${url.host} did not answer in time`, { cause: error }) : error);
      });
      request.end(body?.data);
    });
  }
}

function json(payload: unknown): Body {
  return { type: 'application/json', data: Buffer.from(JSON.stringify(payload)) };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined; // for example the error page of a server that is starting
  }
}
