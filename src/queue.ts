/**
 * Runs tasks one at a time. A task asked for while one runs waits; another one asked for in the
 * meantime takes its place, as only the newest state matters.
 */
export class LatestQueue {
  private running: Promise<void> | undefined;
  private waiting: (() => Promise<void>) | undefined;

  /** Resolves when nothing runs or waits any more. Tasks handle their own errors. */
  add(task: () => Promise<void>): Promise<void> {
    this.waiting = task;
    this.running ??= this.drain();
    return this.running;
  }

  private async drain(): Promise<void> {
    try {
      // After add has stored the promise, so that a failing task cannot leave it behind.
      await Promise.resolve();
      while (this.waiting) {
        const task = this.waiting;
        this.waiting = undefined;
        await task();
      }
    } finally {
      this.running = undefined;
    }
  }
}
