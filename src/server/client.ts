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

const SESSION_COOKIE = 'openerp_session';

const TIMEOUT = 15_000;

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

  /** Sends a JSON request and returns the answer's data; throws the server's error. */
  async post(path: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.data(await this.send('POST', path, payload, signal));
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
    payload: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const url = new URL(path, this.server);
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const data = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload));
    const headers: Record<string, string | number> = { Accept: 'application/json' };
    if (this.session) {
      headers.Cookie = this.session;
    }
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    const timeout = AbortSignal.timeout(TIMEOUT);
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
      request.on('error', reject);
      request.end(data);
    });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined; // for example the error page of a server that is starting
  }
}
