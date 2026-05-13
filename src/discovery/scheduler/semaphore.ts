// Minimal async semaphore — bounds concurrent promise executions.
// No external dependencies.

export class Semaphore {
  private readonly limit: number;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`Semaphore limit must be a positive integer, got ${limit}`);
    }
    this.limit = limit;
  }

  acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    // Guard against double-release: with no queued waiters, `active` would
    // underflow below zero and `available` would silently exceed `limit`,
    // weakening the concurrency invariant. Throw so a release/acquire bug is
    // caught immediately instead of hiding in production with subtle
    // over-concurrency.
    if (this.queue.length === 0 && this.active <= 0) {
      throw new Error("Semaphore.release(): no active holder to release");
    }
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.active--;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get available(): number {
    return this.limit - this.active;
  }
}
