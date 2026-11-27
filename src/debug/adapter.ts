/** The messages of the Debug Adapter Protocol that a publish needs. */
export interface Request {
  type: string;
  seq: number;
  command: string;
  arguments?: Record<string, unknown>;
}

export type Message =
  | { type: 'response'; seq: number; request_seq: number; command: string; success: boolean }
  | { type: 'event'; seq: number; event: string };

/**
 * Not a debugger: a launch publishes the app and ends the session. Stopping the session aborts
 * the publish.
 */
export class PublishAdapter {
  private seq = 0;
  private readonly abort = new AbortController();

  constructor(
    private readonly send: (message: Message) => void,
    private readonly publish: (noDebug: boolean, signal: AbortSignal) => Promise<void>,
  ) {}

  handle(message: Request): void {
    if (message.type !== 'request') {
      return;
    }
    if (message.command === 'disconnect' || message.command === 'terminate') {
      this.abort.abort();
    }
    this.send({
      type: 'response',
      seq: ++this.seq,
      request_seq: message.seq,
      command: message.command,
      success: true,
    });
    if (message.command === 'initialize') {
      this.event('initialized');
    } else if (message.command === 'launch') {
      const noDebug = message.arguments?.noDebug === true;
      // The publish tells the user about its errors itself.
      void this.publish(noDebug, this.abort.signal)
        .catch(() => undefined)
        .then(() => this.event('terminated'));
    }
  }

  dispose(): void {
    this.abort.abort();
  }

  private event(event: string): void {
    this.send({ type: 'event', seq: ++this.seq, event });
  }
}
