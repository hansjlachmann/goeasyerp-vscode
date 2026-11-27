import { ServerError, type ServerClient } from '../server/client';

export interface Passwords {
  /** The password kept for the server and user. */
  stored(): Promise<string | undefined>;
  /** Asks the user; `problem` says why again. Undefined: the user gave up. */
  ask(problem?: string): Promise<string | undefined>;
  /** Keeps a password the server took. */
  keep(password: string): Promise<void>;
}

/** A login that logs in again when the server has ended the session. */
export class Session {
  constructor(
    private readonly client: ServerClient,
    private readonly user: string,
    private readonly company: string,
    private readonly passwords: Passwords,
  ) {}

  /** Logs in with the kept password, else asks until the server takes one. */
  async login(): Promise<void> {
    let password = await this.passwords.stored();
    let problem: string | undefined;
    for (;;) {
      password ??= await this.passwords.ask(problem);
      if (password === undefined) {
        throw new DOMException('No password was given', 'AbortError');
      }
      try {
        await this.client.login(this.user, password, this.company);
        await this.passwords.keep(password);
        return;
      } catch (error) {
        // Anything but a wrong password, the server's lock after many tries for one, ends it.
        if (!(error instanceof ServerError) || error.status !== 401) {
          throw error;
        }
        problem = error.message;
        password = undefined;
      }
    }
  }

  /** Runs a request, logging in again once when the session has ended. */
  async request<T>(request: (client: ServerClient) => Promise<T>): Promise<T> {
    try {
      return await request(this.client);
    } catch (error) {
      if (!(error instanceof ServerError) || error.status !== 401) {
        throw error;
      }
      await this.login();
      return request(this.client);
    }
  }
}
