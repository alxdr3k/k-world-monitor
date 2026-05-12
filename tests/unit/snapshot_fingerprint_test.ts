/**
 * Unit tests for createSnapshotFingerprint (INFRA-1B.3).
 *
 * Neo4j and R2 are mocked so no network I/O occurs.
 * SQLite runs in-memory for discovery_queue state.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";

process.env["SQLITE_PATH"] = ":memory:";

// ---------------------------------------------------------------------------
// Mock Neo4j withSession before importing the module under test.
// ---------------------------------------------------------------------------

type SessionFn<T> = (session: unknown) => Promise<T>;

// Records of Neo4j runs in the current test
const neo4jRuns: Array<{ query: string; params: Record<string, unknown> }> = [];
let findExistingResult: string | null = null; // what MATCH returns for dedup check

mock.module("../../src/storage/neo4j/connection", () => ({
  withSession: async <T>(fn: SessionFn<T>): Promise<T> => {
    const tx = {
      run: async (query: string, params: Record<string, unknown>) => {
        neo4jRuns.push({ query, params });
        // P1-3 source guard: return count=1 so the guard does not throw in tests.
        if (query.includes("MATCH (src:Source") && query.includes("count(src)")) {
          return { records: [{ get: (_: string) => 1 }] };
        }
        // P1-1 MERGE Document RETURN: echo back the pre-generated docId parameter.
        if (query.includes("MERGE (d:Document") && query.includes("RETURN d.doc_id")) {
          return { records: [{ get: (_: string) => params["docId"] }] };
        }
        return { records: [] };
      },
      commit: async () => {},
      rollback: async () => {},
    };
    const session = {
      run: async (query: string, params: Record<string, unknown>) => {
        neo4jRuns.push({ query, params });
        // Deduplication MATCH query returns existing snap_id if configured.
        if (query.includes("MATCH (s:Snapshot") && findExistingResult) {
          return {
            records: [{ get: (_: string) => findExistingResult }],
          };
        }
        return { records: [] };
      },
      beginTransaction: () => tx,
      close: async () => {},
    };
    return fn(session);
  },
}));

// ---------------------------------------------------------------------------
// Mock R2 r2Put.
// ---------------------------------------------------------------------------

const r2Puts: Array<{ key: string }> = [];

mock.module("../../src/storage/r2/client", () => ({
  r2Put: async (key: string, _data: ArrayBuffer) => {
    r2Puts.push({ key });
    return { key, sha256: "mock-sha256", byteSize: 4 };
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------

import { closeDb } from "../../src/storage/sqlite/connection";
import {
  createSnapshotFingerprint,
  type SnapshotInput,
} from "../../src/discovery/worker/snapshot-fingerprint";

// ---------------------------------------------------------------------------
// SQLite setup.
// ---------------------------------------------------------------------------

function setupDb() {
  closeDb();
  const { getDb } = require("../../src/storage/sqlite/connection");
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT NOT NULL PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS discovery_queue (
      queue_id      TEXT NOT NULL PRIMARY KEY,
      source_id     TEXT NOT NULL,
      url           TEXT NOT NULL,
      title         TEXT,
      published_at  TEXT,
      discovered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      content_hash  TEXT,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','error')),
      error_detail  TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS discovery_queue_url_source_active_idx
      ON discovery_queue (source_id, url)
      WHERE status IN ('pending', 'processing');
    CREATE INDEX IF NOT EXISTS discovery_queue_status_idx
      ON discovery_queue (status, discovered_at);
  `);
  return db;
}

function seedQueue(db: ReturnType<typeof setupDb>, queueId: string) {
  db.prepare(
    `INSERT INTO discovery_queue (queue_id, source_id, url, status)
     VALUES (?, 'src-1', 'https://example.com/article', 'processing')`
  ).run(queueId);
}

function baseInput(queueId: string): SnapshotInput {
  return {
    sourceId: "src-1",
    queueId,
    url: "https://example.com/article",
    title: "Test Article",
    publishedAt: "2026-01-01T00:00:00.000Z",
    accessedAt: new Date().toISOString(),
    body: new TextEncoder().encode("<html>test</html>"),
    contentKind: "html",
    mimeType: "text/html",
    archivePolicy: "full_snapshot_allowed",
    rawCloudPolicy: "allowed_public_data_only",
  };
}

beforeEach(() => {
  neo4jRuns.length = 0;
  r2Puts.length = 0;
  findExistingResult = null;
  setupDb();
});

// ---------------------------------------------------------------------------
// createSnapshotFingerprint — new snapshot
// ---------------------------------------------------------------------------

describe("createSnapshotFingerprint — new snapshot", () => {
  it("returns snapId, docId, contentHash, r2Key, deduplicated=false", async () => {
    const db = setupDb();
    const queueId = "dq_test001";
    seedQueue(db, queueId);

    const result = await createSnapshotFingerprint(baseInput(queueId));

    expect(result.deduplicated).toBe(false);
    expect(result.snapId).toMatch(/^snap_/);
    expect(result.docId).toMatch(/^doc_/);
    expect(result.contentHash).toHaveLength(64); // sha256 hex
    expect(result.r2Key).toMatch(/^permitted_artifact\/derived\/snapshot\/snap_/);
  });

  it("writes to R2 when archivePolicy=full_snapshot_allowed and rawCloudPolicy=allowed_public_data_only", async () => {
    const db = setupDb();
    const queueId = "dq_test002";
    seedQueue(db, queueId);

    await createSnapshotFingerprint(baseInput(queueId));

    expect(r2Puts).toHaveLength(1);
    expect(r2Puts[0]!.key).toMatch(/^permitted_artifact\/derived\/snapshot\/snap_/);
  });

  it("back-patches Snapshot r2_key in Neo4j after successful R2 upload", async () => {
    const db = setupDb();
    const queueId = "dq_test002b";
    seedQueue(db, queueId);

    const result = await createSnapshotFingerprint(baseInput(queueId));

    // A SET r2_key query must have been issued after the R2 upload.
    const r2KeyUpdate = neo4jRuns.find(
      (r) => r.query.includes("SET s.r2_key") && r.params["r2Key"] === result.r2Key
    );
    expect(r2KeyUpdate).toBeDefined();
    expect(r2KeyUpdate?.params["snapId"]).toBe(result.snapId);
  });

  it("does NOT write to R2 when archivePolicy=metadata_only", async () => {
    const db = setupDb();
    const queueId = "dq_test003";
    seedQueue(db, queueId);

    const input = { ...baseInput(queueId), archivePolicy: "metadata_only" as const };
    const result = await createSnapshotFingerprint(input);

    expect(r2Puts).toHaveLength(0);
    expect(result.r2Key).toBeNull();
  });

  it("does NOT write to R2 when rawCloudPolicy=always_prohibited", async () => {
    const db = setupDb();
    const queueId = "dq_test004";
    seedQueue(db, queueId);

    const input = { ...baseInput(queueId), rawCloudPolicy: "always_prohibited" as const };
    const result = await createSnapshotFingerprint(input);

    expect(r2Puts).toHaveLength(0);
    expect(result.r2Key).toBeNull();
  });

  it("creates Document and Snapshot nodes in Neo4j", async () => {
    const db = setupDb();
    const queueId = "dq_test005";
    seedQueue(db, queueId);

    await createSnapshotFingerprint(baseInput(queueId));

    const queries = neo4jRuns.map((r) => r.query);
    // Should have MERGE Document, MERGE Snapshot (idempotent), MERGE Source→Doc, MERGE Doc→Snap
    expect(queries.some((q) => q.includes("MERGE (d:Document"))).toBe(true);
    expect(queries.some((q) => q.includes("MERGE (s:Snapshot"))).toBe(true);
    expect(queries.some((q) => q.includes("HAS_DOCUMENT"))).toBe(true);
    expect(queries.some((q) => q.includes("HAS_SNAPSHOT"))).toBe(true);
  });

  it("marks discovery_queue row as done with snap_id in error_detail", async () => {
    const db = setupDb();
    const queueId = "dq_test006";
    seedQueue(db, queueId);

    const result = await createSnapshotFingerprint(baseInput(queueId));

    const row = db
      .prepare("SELECT status, error_detail FROM discovery_queue WHERE queue_id = ?")
      .get(queueId) as { status: string; error_detail: string } | null;
    expect(row?.status).toBe("done");
    expect(row?.error_detail).toBe(`snap_id:${result.snapId}`);
  });
});

// ---------------------------------------------------------------------------
// createSnapshotFingerprint — deduplication
// ---------------------------------------------------------------------------

describe("createSnapshotFingerprint — deduplication", () => {
  it("returns deduplicated=true when content_hash already exists in Neo4j", async () => {
    findExistingResult = "snap_EXISTING";

    const db = setupDb();
    const queueId = "dq_dedup001";
    seedQueue(db, queueId);

    const result = await createSnapshotFingerprint(baseInput(queueId));

    expect(result.deduplicated).toBe(true);
    expect(result.snapId).toBe("snap_EXISTING");
    expect(result.r2Key).toBeNull();
    expect(result.docId).toBe(""); // dedup path returns empty docId
  });

  it("skips Snapshot node creation and R2 upload when deduplicated", async () => {
    findExistingResult = "snap_EXISTING";

    const db = setupDb();
    const queueId = "dq_dedup002";
    seedQueue(db, queueId);

    await createSnapshotFingerprint(baseInput(queueId));

    // No new Snapshot node should be created on the dedup path.
    // Source linkage writes (MERGE Document + edges) may still run (P1-6 requirement).
    const snapshotWrites = neo4jRuns.filter(
      (r) => r.query.includes("MERGE (s:Snapshot") || r.query.includes("CREATE (s:Snapshot")
    );
    expect(snapshotWrites).toHaveLength(0);
    expect(r2Puts).toHaveLength(0);
  });

  it("still marks queue item as done when deduplicated", async () => {
    findExistingResult = "snap_EXISTING";

    const db = setupDb();
    const queueId = "dq_dedup003";
    seedQueue(db, queueId);

    await createSnapshotFingerprint(baseInput(queueId));

    const row = db
      .prepare("SELECT status, error_detail FROM discovery_queue WHERE queue_id = ?")
      .get(queueId) as { status: string; error_detail: string } | null;
    expect(row?.status).toBe("done");
    expect(row?.error_detail).toBe("snap_id:snap_EXISTING");
  });
});

// ---------------------------------------------------------------------------
// Content hash correctness
// ---------------------------------------------------------------------------

describe("createSnapshotFingerprint — content hash", () => {
  it("produces the same content_hash for identical body+url (stable hashing)", async () => {
    const db = setupDb();
    const queueId1 = "dq_hash001";
    const queueId2 = "dq_hash002";
    seedQueue(db, queueId1);

    const r1 = await createSnapshotFingerprint(baseInput(queueId1));

    // Reset dedup so second call doesn't short-circuit on the existing hash.
    findExistingResult = null;
    neo4jRuns.length = 0;
    r2Puts.length = 0;
    db.prepare(`INSERT INTO discovery_queue (queue_id, source_id, url, status)
      VALUES (?, 'src-1', 'https://example.com/article', 'processing')`).run(queueId2);

    // Same body + same URL → must produce the exact same hash (stable / deterministic).
    const r2 = await createSnapshotFingerprint(baseInput(queueId2));
    expect(r1.contentHash).toBe(r2.contentHash);
  });

  it("produces different content_hash for different URLs with same body", async () => {
    const db = setupDb();
    const queueId1 = "dq_hash003";
    const queueId2 = "dq_hash004";
    seedQueue(db, queueId1);

    const r1 = await createSnapshotFingerprint(baseInput(queueId1));

    findExistingResult = null;
    neo4jRuns.length = 0;
    r2Puts.length = 0;
    db.prepare(`INSERT INTO discovery_queue (queue_id, source_id, url, status)
      VALUES (?, 'src-1', 'https://example.com/other', 'processing')`).run(queueId2);

    // Different URL → different hash even for identical body.
    const r2 = await createSnapshotFingerprint({
      ...baseInput(queueId2),
      url: "https://example.com/other",
    });
    expect(r1.contentHash).not.toBe(r2.contentHash);
  });
});
