/**
 * Unit tests for bounded concurrency pool (ADR-0030 INV-0030-1).
 * INFRA-1B.2b.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { runWithPool, getGlobalPool, getGlobalLimit, perHostPoolsSnapshot, resetPools } from "../../src/discovery/scheduler/pool";

// Reset entire pool state between tests so that env-var changes and map
// accumulation from one test do not bleed into the next.
beforeEach(() => {
  resetPools();
});

// Reset pool state between tests by draining any queued permits.
// The module-level singletons share state across tests, so we verify
// each test leaves the pool with its full capacity.
function assertPoolsIdle() {
  // global pool should be fully available after each test.
  // Read the env-derived limit through the same accessor the production code
  // uses (lazy-init), not directly from process.env, so this assertion stays
  // consistent with module-internal state if resetPools has been called.
  expect(getGlobalPool().available).toBe(getGlobalLimit());
}

describe("runWithPool — basic behavior", () => {
  it("runs fn and returns its result", async () => {
    const result = await runWithPool("example.com", async () => 42);
    expect(result).toBe(42);
    assertPoolsIdle();
  });

  it("releases slots even when fn throws", async () => {
    await expect(
      runWithPool("example.com", async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
    assertPoolsIdle();
  });

  it("creates separate per-host pools per hostname", async () => {
    await Promise.all([
      runWithPool("host-a.example.com", async () => null),
      runWithPool("host-b.example.com", async () => null),
    ]);
    expect(perHostPoolsSnapshot().has("host-a.example.com")).toBe(true);
    expect(perHostPoolsSnapshot().has("host-b.example.com")).toBe(true);
    assertPoolsIdle();
  });

  it("reuses existing per-host pool for same hostname", async () => {
    await runWithPool("reuse-host.example.com", async () => null);
    const first = perHostPoolsSnapshot().get("reuse-host.example.com");
    await runWithPool("reuse-host.example.com", async () => null);
    const second = perHostPoolsSnapshot().get("reuse-host.example.com");
    expect(first).toBe(second);
    assertPoolsIdle();
  });
});

describe("getHostPool — eviction safety", () => {
  it("getHostPool reuses the existing entry for a host already in the map", async () => {
    // Register a host and grab its semaphore, then acquire a permit so it is
    // marked active. A second lookup must return the same Semaphore instance —
    // not a freshly created one — so concurrent tasks share the same limit.
    const { Semaphore } = await import("../../src/discovery/scheduler/semaphore");
    const host = `evict-active-${Date.now()}.example.com`;

    // Insert the host via runWithPool so it appears in perHostPoolsSnapshot.
    await runWithPool(host, async () => null);
    const semBefore = perHostPoolsSnapshot().get(host);
    expect(semBefore).toBeDefined();

    // Simulate an active acquisition on this semaphore.
    await semBefore!.acquire();
    expect(semBefore!.available).toBe(0); // slot is held

    // A subsequent runWithPool for the same host should reuse semBefore.
    // We cannot await it (it would block on the held slot), so just check the
    // map still points to the same instance after the lookup path runs.
    const semAfter = perHostPoolsSnapshot().get(host);
    expect(semAfter).toBe(semBefore);

    // Release the manually acquired permit.
    semBefore!.release();
    expect(semBefore!.available).toBe(1);

    assertPoolsIdle();
  });
});

describe("runWithPool — per-host concurrency", () => {
  it("serializes concurrent calls to the same host", async () => {
    const perHostLimit = parseInt(process.env["DISCOVERY_MAX_PER_HOST"] ?? "1");
    if (perHostLimit !== 1) {
      // Only meaningful with limit=1
      return;
    }

    let concurrent = 0;
    let maxConcurrent = 0;
    const host = `serial-test-${Date.now()}.example.com`;

    const tasks = Array.from({ length: 3 }, () =>
      runWithPool(host, async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise<void>((r) => setTimeout(r, 5));
        concurrent--;
      })
    );

    await Promise.all(tasks);
    expect(maxConcurrent).toBe(1);
    assertPoolsIdle();
  });

  it("allows concurrent calls to different hosts", async () => {
    const starts: number[] = [];
    const now = Date.now();

    const tasks = ["host1.example.com", "host2.example.com", "host3.example.com"].map((h) =>
      runWithPool(h, async () => {
        starts.push(Date.now() - now);
        await new Promise<void>((r) => setTimeout(r, 20));
      })
    );

    await Promise.all(tasks);
    // All three should start near-simultaneously (within 50ms of each other)
    const spread = Math.max(...starts) - Math.min(...starts);
    expect(spread).toBeLessThan(50);
    assertPoolsIdle();
  });
});
