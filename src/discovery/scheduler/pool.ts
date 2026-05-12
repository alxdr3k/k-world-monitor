// Bounded concurrency pool for discovery fetches (ADR-0030 INV-0030-1).
// Global cap: DISCOVERY_MAX_CONCURRENCY (default 8).
// Per-host cap: DISCOVERY_MAX_PER_HOST (default 1).
//
// Acquisition order: per-host first, then global.
// This prevents host-blocked tasks from holding global slots and starving other hosts.

import { Semaphore } from "./semaphore";

function readEnvInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val || !/^\d+$/.test(val)) return fallback;
  const n = parseInt(val, 10);
  return n > 0 ? n : fallback;
}

const globalLimit = readEnvInt("DISCOVERY_MAX_CONCURRENCY", 8);
const perHostLimit = readEnvInt("DISCOVERY_MAX_PER_HOST", 1);
// Cap the per-host map to avoid unbounded growth for long-running crawlers.
const PER_HOST_MAX_ENTRIES = 10_000;

const globalPool = new Semaphore(globalLimit);
const perHostPools = new Map<string, Semaphore>();

function getHostPool(hostname: string): Semaphore {
  let sem = perHostPools.get(hostname);
  if (!sem) {
    // Evict the oldest idle entry when map is full to cap memory growth.
    // Skip semaphores that still have active or queued work (available < limit)
    // to avoid splitting a host's concurrency across two semaphore instances,
    // which would silently violate the DISCOVERY_MAX_PER_HOST invariant.
    if (perHostPools.size >= PER_HOST_MAX_ENTRIES) {
      // Prefer evicting an idle entry (available === limit) to avoid splitting
      // a host's concurrency. If all entries are active, fall back to evicting
      // the oldest entry (insertion-order first) to enforce the hard map cap
      // and prevent unbounded memory growth.
      let evicted = false;
      for (const [key, candidate] of perHostPools) {
        if (candidate.available === perHostLimit) {
          perHostPools.delete(key);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        // All entries are active — skip eviction to preserve per-host invariant.
        // Temporarily allow map to exceed cap rather than violate per-host limit.
        console.warn(
          `[pool] perHostPools at cap (${PER_HOST_MAX_ENTRIES}) with all entries active; ` +
          `skipping eviction for ${hostname} to preserve per-host concurrency limit.`
        );
      }
    }
    sem = new Semaphore(perHostLimit);
    perHostPools.set(hostname, sem);
  }
  return sem;
}

// Run fn under the global pool and the per-host pool for hostname.
// Acquires per-host first, then global — this ensures tasks blocked on a
// busy host do not consume global capacity and starve other hosts.
// Release in reverse order: global first, then per-host.
export async function runWithPool<T>(hostname: string, fn: () => Promise<T>): Promise<T> {
  const hostPool = getHostPool(hostname);
  await hostPool.acquire();
  await globalPool.acquire();
  try {
    return await fn();
  } finally {
    globalPool.release();
    hostPool.release();
  }
}

// Exposed for testing only.
export { globalPool, perHostPools };

// Clear the per-host pool map between tests to prevent state leakage.
// Only safe to call when all tasks have completed (no active semaphores).
export function resetPools(): void {
  perHostPools.clear();
}
