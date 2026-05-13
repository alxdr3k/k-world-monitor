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

// Cap the per-host map to avoid unbounded growth for long-running crawlers.
const PER_HOST_MAX_ENTRIES = 10_000;

// All pool state lives in a single record so the lazy-init lifecycle is in
// one place. resetPools() simply replaces the record. Tests that mutate env
// vars AFTER import call resetPools() so the next acquire re-reads the env.
interface PoolState {
  globalLimit: number;
  perHostLimit: number;
  globalPool: Semaphore;
  perHostPools: Map<string, Semaphore>;
}

let state: PoolState | undefined;

function getState(): PoolState {
  if (state === undefined) {
    const globalLimit = readEnvInt("DISCOVERY_MAX_CONCURRENCY", 8);
    const perHostLimit = readEnvInt("DISCOVERY_MAX_PER_HOST", 1);
    state = {
      globalLimit,
      perHostLimit,
      globalPool: new Semaphore(globalLimit),
      perHostPools: new Map(),
    };
  }
  return state;
}

function getHostPool(hostname: string): Semaphore {
  const s = getState();
  let sem = s.perHostPools.get(hostname);
  if (!sem) {
    // Evict the oldest idle entry when map is full to cap memory growth.
    // Skip semaphores that still have active or queued work (available < limit)
    // to avoid splitting a host's concurrency across two semaphore instances,
    // which would silently violate the DISCOVERY_MAX_PER_HOST invariant.
    if (s.perHostPools.size >= PER_HOST_MAX_ENTRIES) {
      // Prefer evicting an idle entry (available === limit) to avoid splitting
      // a host's concurrency. If all entries are active, fall back to leaving
      // the map slightly over cap rather than violating per-host limit.
      let evicted = false;
      for (const [key, candidate] of s.perHostPools) {
        if (candidate.available === s.perHostLimit) {
          s.perHostPools.delete(key);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        console.warn(
          `[pool] perHostPools at cap (${PER_HOST_MAX_ENTRIES}) with all entries active; ` +
          `skipping eviction for ${hostname} to preserve per-host concurrency limit.`
        );
      }
    }
    sem = new Semaphore(s.perHostLimit);
    s.perHostPools.set(hostname, sem);
  }
  return sem;
}

// Run fn under the global pool and the per-host pool for hostname.
// Acquires per-host first, then global — this ensures tasks blocked on a
// busy host do not consume global capacity and starve other hosts.
// Release in reverse order: global first, then per-host.
//
// The second acquire (global) is wrapped so a future AbortSignal-aware
// Semaphore that rejects acquire() does not leak the host slot. Today the
// Semaphore never rejects, but the structural guarantee matches the comment.
export async function runWithPool<T>(hostname: string, fn: () => Promise<T>): Promise<T> {
  const hostPool = getHostPool(hostname);
  const gPool = getState().globalPool;
  await hostPool.acquire();
  try {
    await gPool.acquire();
  } catch (err) {
    hostPool.release();
    throw err;
  }
  try {
    return await fn();
  } finally {
    gPool.release();
    hostPool.release();
  }
}

// Test-only accessors. Production callers should only use runWithPool.
export function getGlobalPool(): Semaphore {
  return getState().globalPool;
}
export function getGlobalLimit(): number {
  return getState().globalLimit;
}
export function getPerHostLimit(): number {
  return getState().perHostLimit;
}
export function perHostPoolsSnapshot(): Map<string, Semaphore> {
  return getState().perHostPools;
}

// Clear the entire pool state between tests so the NEXT call re-reads env vars.
// Only safe to call when all tasks have completed (no active semaphores).
export function resetPools(): void {
  state = undefined;
}
