/**
 * Unit tests for Semaphore (ADR-0030 INV-0030-1).
 * INFRA-1B.2b.
 */

import { describe, it, expect } from "bun:test";
import { Semaphore } from "../../src/discovery/scheduler/semaphore";

describe("Semaphore — constructor", () => {
  it("accepts a positive integer limit", () => {
    expect(() => new Semaphore(1)).not.toThrow();
    expect(() => new Semaphore(8)).not.toThrow();
  });

  it("throws RangeError for limit 0", () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });

  it("throws RangeError for negative limit", () => {
    expect(() => new Semaphore(-1)).toThrow(RangeError);
  });

  it("throws RangeError for non-integer limit", () => {
    expect(() => new Semaphore(1.5)).toThrow(RangeError);
  });

  it("available equals limit initially", () => {
    expect(new Semaphore(3).available).toBe(3);
  });
});

describe("Semaphore — acquire/release", () => {
  it("acquire resolves immediately below limit", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    expect(sem.available).toBe(1);
    await sem.acquire();
    expect(sem.available).toBe(0);
  });

  it("release restores available", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    sem.release();
    expect(sem.available).toBe(1);
  });

  it("acquire blocks when at limit and unblocks after release", async () => {
    const sem = new Semaphore(1);
    await sem.acquire(); // fills the slot

    let unblocked = false;
    const waiter = sem.acquire().then(() => { unblocked = true; });

    // Still blocked — we haven't released yet
    await Promise.resolve();
    expect(unblocked).toBe(false);

    sem.release();
    await waiter;
    expect(unblocked).toBe(true);
  });

  it("queued waiters are released FIFO", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];
    const w1 = sem.acquire().then(() => { order.push(1); sem.release(); });
    const w2 = sem.acquire().then(() => { order.push(2); sem.release(); });
    const w3 = sem.acquire().then(() => { order.push(3); sem.release(); });

    sem.release(); // triggers w1
    await Promise.all([w1, w2, w3]);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("Semaphore — run", () => {
  it("runs fn and returns its result", async () => {
    const sem = new Semaphore(2);
    const result = await sem.run(async () => 42);
    expect(result).toBe(42);
    expect(sem.available).toBe(2); // slot released
  });

  it("releases slot even when fn throws", async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
    expect(sem.available).toBe(1);
  });

  it("enforces concurrency limit", async () => {
    const sem = new Semaphore(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 5 }, () =>
      sem.run(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise<void>((r) => setTimeout(r, 5));
        concurrent--;
      })
    );

    await Promise.all(tasks);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
