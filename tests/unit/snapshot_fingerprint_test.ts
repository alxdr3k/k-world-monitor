/**
 * Unit tests for createSnapshotFingerprint (INFRA-1B.3).
 *
 * Neo4j is mocked via the shared test-helpers/neo4j-mock builder.
 * R2 is mocked inline (single function). SQLite runs in-memory.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { createNeo4jMock, ok } from "../test-helpers/neo4j-mock";

process.env["SQLITE_PATH"] = ":memory:";

// ---------------------------------------------------------------------------
// Shared Neo4j mock + closure-driven behavior flags.
// ---------------------------------------------------------------------------

interface FindExistingConfig {
  snapId: string;
  r2Key: string | null;
  docId?: string;
}
let findExistingResult: FindExistingConfig | null = null;
// When true, the Source-existence guard query returns count=0 — used to
// exercise ensureSourceLinkage's missing-Source rollback path on dedup.
let sourceMissingOnGuard = false;
// When set, MERGE Document's RETURN d.doc_id ignores the input params.docId
// and returns this value — simulating Neo4j's ON MATCH branch where the
// stored docId differs from the candidate (F-10 contract).
let mergeDocIdOverride: string | null = null;
// When true, allLinkedSourcesAllowR2SnapshotUpload returns a prohibited source
// after the r2Put has already succeeded — exercises the TOCTOU close branch.
// The prohibited source is unregistered (no source_material_policy row) so the
// length mismatch path in the policy function rejects.
let policyRevertsAfterR2Put = false;
let allLinkedSourcesCallCount = 0;

// AI-P0-1 (INFRA-1B.3.h1-policy-fix) regression-test hooks: per-call linked
// source_id lists returned by the Neo4j mock's `collect(DISTINCT src.source_id)`
// handler. Defaults to ["src-1"] for both pre- and post-r2Put checks so
// existing tests keep their current behavior. Tests that need to exercise
// cross-source archive_policy enforcement override these arrays + INSERT
// matching rows into source_material_policy. The TOCTOU `policyRevertsAfterR2Put`
// flag (above) takes precedence on the recheck call when set.
let linkedSourceIdsFirstCall: string[] = ["src-1"];
let linkedSourceIdsRecheck: string[] = ["src-1"];

const neo4j = createNeo4jMock();
function registerHandlers() {
  neo4j.tx.on(/MATCH \(src:Source.*count\(src\)/s, () =>
    ok({ matched: sourceMissingOnGuard ? 0 : 1 })
  );
  neo4j.tx.on(/MERGE \(d:Document[\s\S]*RETURN d\.doc_id/, ({ params }) =>
    ok({ doc_id: mergeDocIdOverride ?? (params["docId"] as string) })
  );

  // SET s.r2_key handler registered BEFORE the broader Snapshot handler so it
  // wins the first-match dispatch in createNeo4jMock. Throws when
  // neo4jSetShouldThrow=true so audit-hook tests can exercise the
  // set_r2_key_failed_neo4j branch deterministically.
  neo4j.session.on(/SET s\.r2_key/, () => {
    if (neo4jSetShouldThrow) {
      throw new Error("simulated Neo4j SET s.r2_key failure");
    }
    return ok({});
  });

  neo4j.session.on(/collect\(DISTINCT src\.source_id\)/, () => {
    allLinkedSourcesCallCount++;
    // First call = pre-r2Put check. Subsequent calls = post-r2Put recheck.
    // policyRevertsAfterR2Put forces the recheck to return an unregistered
    // source so the SET back-patch is skipped per the TOCTOU close.
    if (policyRevertsAfterR2Put && allLinkedSourcesCallCount > 1) {
      return ok({ source_ids: ["src-prohibited"] });
    }
    // AI-P0-1 regression-test hooks — see flag definitions above.
    const ids =
      allLinkedSourcesCallCount === 1 ? linkedSourceIdsFirstCall : linkedSourceIdsRecheck;
    return ok({ source_ids: ids });
  });
  neo4j.session.on(/MATCH \(s:Snapshot/, () => {
    if (!findExistingResult) return { records: [] };
    const cfg = findExistingResult;
    return ok({
      snap_id: cfg.snapId,
      doc_id: cfg.docId ?? `doc_dedup_${cfg.snapId}`,
      r2_key: cfg.r2Key,
    });
  });
}
registerHandlers();

mock.module("../../src/storage/neo4j/connection", () => neo4j.module);

// Back-compat alias so existing test bodies need minimal edits.
const neo4jRuns = neo4j.runs as ReadonlyArray<{ query: string; params: Record<string, unknown> }>;

// ---------------------------------------------------------------------------
// Mock R2 r2Put.
// ---------------------------------------------------------------------------

const r2Puts: Array<{ key: string }> = [];
let r2PutShouldThrow = false;
let neo4jSetShouldThrow = false;

mock.module("../../src/storage/r2/client", () => ({
  r2Put: async (key: string, _data: ArrayBuffer) => {
    if (r2PutShouldThrow) {
      throw new Error("simulated r2Put failure");
    }
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
  TypedQueueError,
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
      snap_id       TEXT,
      error_code    TEXT
                    CHECK (
                      error_code IS NULL OR
                      error_code IN (
                        'source_not_found_in_graph',
                        'dedup_prohibited_source',
                        'policy_do_not_collect',
                        'http_status',
                        'empty_body',
                        'runtime_error'
                      )
                    ),
      error_detail  TEXT,
      updated_at    TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS discovery_queue_url_source_active_idx
      ON discovery_queue (source_id, url)
      WHERE status IN ('pending', 'processing');
    CREATE INDEX IF NOT EXISTS discovery_queue_status_idx
      ON discovery_queue (status, discovered_at);
    CREATE TABLE IF NOT EXISTS source_material_policy (
      source_id            TEXT NOT NULL PRIMARY KEY,
      archive_policy       TEXT NOT NULL,
      raw_cloud_policy     TEXT NOT NULL,
      external_llm_policy  TEXT NOT NULL,
      checked_at           TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z',
      updated_at           TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'
    );
    INSERT OR REPLACE INTO source_material_policy
      (source_id, archive_policy, raw_cloud_policy, external_llm_policy)
      VALUES ('src-1', 'full_snapshot_allowed', 'allowed_public_data_only', 'allowed');
    -- policy_decisions: v1 + v7 (intended_action column for R2 upload audit).
    -- INFRA-1B.3.x-audit hooks INSERT into this table around every r2Put call,
    -- so the snapshot-fingerprint tests must materialize the schema here.
    CREATE TABLE IF NOT EXISTS policy_decisions (
      decision_id       TEXT PRIMARY KEY,
      source_id         TEXT,
      session_id        TEXT,
      url               TEXT,
      trigger_type      TEXT NOT NULL,
      policy_gate_mode  TEXT NOT NULL CHECK (policy_gate_mode IN ('inline_block','inline_warn','batch_report')),
      decision          TEXT NOT NULL,
      rationale         TEXT,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      intended_action   TEXT
    );
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
  neo4j.reset();
  registerHandlers();
  r2Puts.length = 0;
  findExistingResult = null;
  sourceMissingOnGuard = false;
  mergeDocIdOverride = null;
  policyRevertsAfterR2Put = false;
  allLinkedSourcesCallCount = 0;
  linkedSourceIdsFirstCall = ["src-1"];
  linkedSourceIdsRecheck = ["src-1"];
  r2PutShouldThrow = false;
  neo4jSetShouldThrow = false;
  setupDb();
});

// ---------------------------------------------------------------------------
// Audit row inspector for INFRA-1B.3.x-audit integration tests.
// ---------------------------------------------------------------------------

interface AuditRow {
  decision: string;
  source_id: string | null;
  url: string | null;
  trigger_type: string;
  policy_gate_mode: string;
  intended_action: string | null;
  rationale: string | null;
}

function readAuditRows(): AuditRow[] {
  // require() typing flattens to any, which breaks .query<T,P>() generics;
  // use an explicit cast so the returned rows keep their AuditRow shape.
  const conn = require("../../src/storage/sqlite/connection") as {
    getDb: () => import("bun:sqlite").Database;
  };
  return conn
    .getDb()
    .query<AuditRow, []>(
      `SELECT decision, source_id, url, trigger_type, policy_gate_mode,
              intended_action, rationale
       FROM policy_decisions
       WHERE intended_action = 'r2_upload'
       ORDER BY decision_id`
    )
    .all();
}

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

  it("marks discovery_queue row as done with snap_id in its own column", async () => {
    const db = setupDb();
    const queueId = "dq_test006";
    seedQueue(db, queueId);

    const result = await createSnapshotFingerprint(baseInput(queueId));

    const row = db
      .prepare("SELECT status, snap_id, error_code, error_detail FROM discovery_queue WHERE queue_id = ?")
      .get(queueId) as { status: string; snap_id: string | null; error_code: string | null; error_detail: string | null } | null;
    expect(row?.status).toBe("done");
    expect(row?.snap_id).toBe(result.snapId);
    expect(row?.error_code).toBeNull();
    expect(row?.error_detail).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createSnapshotFingerprint — deduplication
// ---------------------------------------------------------------------------

describe("createSnapshotFingerprint — deduplication", () => {
  it("returns deduplicated=true when content_hash already exists in Neo4j", async () => {
    // Existing snapshot already has r2_key set — dedup path preserves it.
    findExistingResult = { snapId: "snap_EXISTING", r2Key: "permitted_artifact/derived/snapshot/snap_EXISTING" };

    const db = setupDb();
    const queueId = "dq_dedup001";
    seedQueue(db, queueId);

    const result = await createSnapshotFingerprint(baseInput(queueId));

    expect(result.deduplicated).toBe(true);
    expect(result.snapId).toBe("snap_EXISTING");
    expect(result.r2Key).toBe("permitted_artifact/derived/snapshot/snap_EXISTING");
    // F-10 fix — docId on dedup must be the CURRENT source's linked Document
    // (created/matched by ensureSourceLinkage), not the first-writer doc_id
    // denormalized on the Snapshot (s.doc_id), which would be stale across
    // cross-source dedup. The linkage MERGE returns a fresh doc_<ulid> via the
    // mock's docId echo, so any doc_<ulid> shape proves the new return path.
    expect(result.docId).toMatch(/^doc_[0-9A-HJKMNP-TV-Z]+$/);
    expect(result.docId).not.toBe("doc_dedup_snap_EXISTING");
  });

  it("skips Snapshot node creation and R2 upload when deduplicated", async () => {
    findExistingResult = { snapId: "snap_EXISTING", r2Key: "permitted_artifact/derived/snapshot/snap_EXISTING" };

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
    findExistingResult = { snapId: "snap_EXISTING", r2Key: "permitted_artifact/derived/snapshot/snap_EXISTING" };

    const db = setupDb();
    const queueId = "dq_dedup003";
    seedQueue(db, queueId);

    await createSnapshotFingerprint(baseInput(queueId));

    const row = db
      .prepare("SELECT status, snap_id, error_code FROM discovery_queue WHERE queue_id = ?")
      .get(queueId) as { status: string; snap_id: string | null; error_code: string | null } | null;
    expect(row?.status).toBe("done");
    expect(row?.snap_id).toBe("snap_EXISTING");
    expect(row?.error_code).toBeNull();
  });

  it("back-fills R2 upload on dedup path when existing r2_key is null (retry after prior R2 failure)", async () => {
    // Simulate a Snapshot that was created but R2 upload failed — r2_key is null.
    findExistingResult = { snapId: "snap_EXISTING", r2Key: null };

    const db = setupDb();
    const queueId = "dq_dedup004";
    seedQueue(db, queueId);

    // Input has full_snapshot_allowed + allowed_public_data_only — R2 should be retried.
    const result = await createSnapshotFingerprint(baseInput(queueId));

    expect(result.deduplicated).toBe(true);
    expect(result.r2Key).toMatch(/^permitted_artifact\/derived\/snapshot\/snap_EXISTING/);
    expect(r2Puts).toHaveLength(1);

    // r2_key back-patch SET query should have been issued.
    const r2KeyPatch = neo4jRuns.find(
      (r) => r.query.includes("SET s.r2_key") && r.params["snapId"] === "snap_EXISTING"
    );
    expect(r2KeyPatch).toBeDefined();
  });

  it("does NOT back-fill R2 upload on dedup path when existing r2_key is null but policy is metadata_only", async () => {
    findExistingResult = { snapId: "snap_EXISTING", r2Key: null };

    const db = setupDb();
    const queueId = "dq_dedup005";
    seedQueue(db, queueId);

    const input = { ...baseInput(queueId), archivePolicy: "metadata_only" as const };
    const result = await createSnapshotFingerprint(input);

    expect(result.deduplicated).toBe(true);
    expect(result.r2Key).toBeNull();
    expect(r2Puts).toHaveLength(0);
  });

  // F-21: dedup docId must come from the CURRENT source's linked Document,
  // not from the Snapshot's first-writer s.doc_id property. Previous test
  // only verified the ON CREATE branch (mock echoed input). Force the MERGE
  // Document RETURN to give a value that does NOT match the input candidate,
  // simulating Neo4j's ON MATCH branch where a prior writer's stored docId
  // is preserved. The dedup return must propagate THAT value.
  it("dedup return docId reflects ensureSourceLinkage ON MATCH (stored != candidate)", async () => {
    findExistingResult = { snapId: "snap_EXISTING", r2Key: "permitted_artifact/derived/snapshot/snap_EXISTING" };
    mergeDocIdOverride = "doc_PRIOR_LINKER";

    const db = setupDb();
    const queueId = "dq_dedup_onmatch";
    seedQueue(db, queueId);

    const result = await createSnapshotFingerprint(baseInput(queueId));

    expect(result.deduplicated).toBe(true);
    // The dedup path must surface the linker's MERGE-resolved doc_id, not
    // the freshly generated candidate that the linker would have produced
    // on the ON CREATE branch.
    expect(result.docId).toBe("doc_PRIOR_LINKER");
  });

  // F-23: ensureSourceLinkage must return null when the Source node is absent
  // on the dedup path; the caller must mark the queue row 'error' and throw
  // (not silently return success). This exercises lines 310-313 +
  // 442-449 of snapshot-fingerprint.ts, which the previous mock could not
  // reach because count(src) always returned 1.
  it("throws TypedQueueError(source_not_found_in_graph) when dedup linkage finds no Source node", async () => {
    findExistingResult = { snapId: "snap_EXISTING", r2Key: null };
    sourceMissingOnGuard = true;

    const db = setupDb();
    const queueId = "dq_dedup_no_source";
    seedQueue(db, queueId);

    // Contract: createSnapshotFingerprint throws TypedQueueError with the
    // specific errorCode. Marker-call ownership lives in processOneRow's
    // catch (PR-ε codex P2 fix), so the row stays in 'processing' until the
    // outer recovery scope handles the throw. Tests that invoke
    // createSnapshotFingerprint directly verify the throw contract only.
    let caught: unknown;
    try {
      await createSnapshotFingerprint(baseInput(queueId));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TypedQueueError);
    expect((caught as TypedQueueError).errorCode).toBe("source_not_found_in_graph");
    expect((caught as Error).message).toMatch(/dedup: source not found in graph/);
    // No R2 upload occurs when linkage fails (early throw before r2Put).
    expect(r2Puts).toHaveLength(0);
  });

  // AI-P1-3 (INFRA-1B.3.h2-queue-cli): error_code unification — new-path
  // (createDocumentAndSnapshot) now throws TypedQueueError when the Source
  // node is missing, matching the dedup-path behavior. Previously this site
  // threw plain Error which processOneRow's catch bucketed as 'runtime_error',
  // forcing operator alert configs to cover both error_codes for the same
  // failure mode. Both paths now emit `source_not_found_in_graph`.
  it("throws TypedQueueError(source_not_found_in_graph) on new-path when Source node is absent (AI-P1-3)", async () => {
    findExistingResult = null; // force new-path (createDocumentAndSnapshot)
    sourceMissingOnGuard = true; // count(src) returns 0

    const db = setupDb();
    const queueId = "dq_newpath_no_source";
    seedQueue(db, queueId);

    let caught: unknown;
    try {
      await createSnapshotFingerprint(baseInput(queueId));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TypedQueueError);
    expect((caught as TypedQueueError).errorCode).toBe("source_not_found_in_graph");
    expect((caught as Error).message).toMatch(/new-path: source not found in graph/);
    // The rollback happens inside createDocumentAndSnapshot's catch, so no
    // partial Document or Snapshot is persisted (verifiable by counting
    // MERGE writes — tx.rollback was called).
    expect(neo4j.tx.rollbackCount).toBeGreaterThan(0);
    // No R2 upload (the missing-Source guard fires inside the Neo4j tx,
    // BEFORE the createSnapshotFingerprint reaches the R2 upload block).
    expect(r2Puts).toHaveLength(0);
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
    neo4j.reset(); registerHandlers();
    r2Puts.length = 0;
    db.prepare(`INSERT INTO discovery_queue (queue_id, source_id, url, status)
      VALUES (?, 'src-1', 'https://example.com/article', 'processing')`).run(queueId2);

    // Same body + same URL → must produce the exact same hash (stable / deterministic).
    const r2 = await createSnapshotFingerprint(baseInput(queueId2));
    expect(r1.contentHash).toBe(r2.contentHash);
  });

  it("produces identical content_hash for different URLs with same body (cross-source dedup)", async () => {
    const db = setupDb();
    const queueId1 = "dq_hash003";
    const queueId2 = "dq_hash004";
    seedQueue(db, queueId1);

    const r1 = await createSnapshotFingerprint(baseInput(queueId1));

    findExistingResult = null;
    neo4j.reset(); registerHandlers();
    r2Puts.length = 0;
    db.prepare(`INSERT INTO discovery_queue (queue_id, source_id, url, status)
      VALUES (?, 'src-1', 'https://example.com/other', 'processing')`).run(queueId2);

    // Body-only hash: identical bytes from different URLs (mirrors,
    // tracking-parameter variants) must collide so cross-source dedup works.
    const r2 = await createSnapshotFingerprint({
      ...baseInput(queueId2),
      url: "https://example.com/other",
    });
    expect(r1.contentHash).toBe(r2.contentHash);
  });
});

// ---------------------------------------------------------------------------
// r2-orphan recovery — verifies the claim in the PR #25 commit message that
// "the next eligible retry dedup-matches and r2Put's idempotent overwrite
// restores consistency" when a SET r2_key Neo4j write fails after a
// successful r2Put. The dedup back-fill path must re-upload (same key,
// idempotent overwrite) and patch r2_key on the next attempt.
// ---------------------------------------------------------------------------

describe("createSnapshotFingerprint — r2 orphan back-fill", () => {
  it("dedup retry back-fills r2_key when prior attempt left r2_key=null", async () => {
    // Simulate the state left after a prior worker that:
    //   1. created Snapshot in Neo4j with r2_key=null,
    //   2. successfully uploaded to r2,
    //   3. then crashed BEFORE the SET r2_key back-patch landed.
    // The graph has snap_id=snap_ORPHAN, r2_key=null. The r2 object exists
    // at permitted_artifact/derived/snapshot/snap_ORPHAN (mocked r2Put will
    // overwrite it idempotently).
    findExistingResult = { snapId: "snap_ORPHAN", r2Key: null };

    const db = setupDb();
    const queueId = "dq_orphan_recover";
    seedQueue(db, queueId);

    const result = await createSnapshotFingerprint(baseInput(queueId));

    // Verify dedup matched.
    expect(result.deduplicated).toBe(true);
    expect(result.snapId).toBe("snap_ORPHAN");
    // r2 object was re-uploaded (back-fill path triggered).
    expect(r2Puts).toHaveLength(1);
    expect(r2Puts[0]!.key).toBe("permitted_artifact/derived/snapshot/snap_ORPHAN");
    // The graph SET r2_key write was issued — this is the back-patch that
    // closes the orphan.
    const setPatch = neo4j.runs.find(
      (r) => r.via === "session" && /SET s\.r2_key/.test(r.query) &&
             r.params["snapId"] === "snap_ORPHAN"
    );
    expect(setPatch).toBeDefined();
    expect(result.r2Key).toBe("permitted_artifact/derived/snapshot/snap_ORPHAN");
    // Queue row marked done — no inflated failure count for the orphan.
    const row = db
      .prepare("SELECT status FROM discovery_queue WHERE queue_id = ?")
      .get(queueId) as { status: string };
    expect(row.status).toBe("done");
  });

  it("dedup back-fill skips SET r2_key when policy reverts after r2Put (INV-0012-3 TOCTOU close)", async () => {
    // The pre-r2Put policy check passes (first
    // allLinkedSourcesAllowR2SnapshotUpload call returns allowed); a concurrent
    // linker then attaches a prohibited source, so the post-r2Put recheck
    // returns prohibited. The SET r2_key must NOT be issued — r2_key stays null
    // in the graph so the prohibited source never observes an r2 reference.
    findExistingResult = { snapId: "snap_TOCTOU", r2Key: null };
    policyRevertsAfterR2Put = true;

    const db = setupDb();
    const queueId = "dq_toctou";
    seedQueue(db, queueId);

    const result = await createSnapshotFingerprint(baseInput(queueId));

    expect(result.deduplicated).toBe(true);
    // r2Put DID run (we got that far before the revert was visible).
    expect(r2Puts).toHaveLength(1);
    // But the SET r2_key back-patch was NOT issued — fail-safe.
    const setPatch = neo4j.runs.find(
      (r) => r.via === "session" && /SET s\.r2_key/.test(r.query)
    );
    expect(setPatch).toBeUndefined();
    // Result reflects no r2 association from the caller's perspective.
    expect(result.r2Key).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// INFRA-1B.3.x-audit caller-hook integration tests.
//
// Audit module unit tests (tests/unit/audit_policy_decisions_test.ts) verify
// recordR2UploadDecision INSERT shape. These tests verify the OTHER half of
// the contract: that every r2Put call site in snapshot-fingerprint emits the
// right audit row sequence under each operational scenario (Codex PR #39
// reviewer P2 — caller hook tests).
// ---------------------------------------------------------------------------

describe("createSnapshotFingerprint — audit hook integration (INFRA-1B.3.x-audit)", () => {
  it("new snapshot + allowed policy → attempted + uploaded audit rows", async () => {
    const db = setupDb();
    seedQueue(db, "dq_audit_new");

    const result = await createSnapshotFingerprint(baseInput("dq_audit_new"));

    expect(result.deduplicated).toBe(false);
    expect(r2Puts).toHaveLength(1);
    const audit = readAuditRows();
    expect(audit.map((r) => r.decision)).toEqual(["attempted", "uploaded"]);
    for (const row of audit) {
      expect(row.intended_action).toBe("r2_upload");
      expect(row.trigger_type).toBe("r2_upload");
      expect(row.policy_gate_mode).toBe("batch_report");
      expect(row.source_id).toBe("src-1");
    }
  });

  it("dedup back-fill + allowed policy → attempted + uploaded audit rows", async () => {
    findExistingResult = { snapId: "snap_dedup_audit", r2Key: null };
    const db = setupDb();
    seedQueue(db, "dq_audit_dedup");

    const result = await createSnapshotFingerprint(baseInput("dq_audit_dedup"));

    expect(result.deduplicated).toBe(true);
    expect(r2Puts).toHaveLength(1);
    const audit = readAuditRows();
    expect(audit.map((r) => r.decision)).toEqual(["attempted", "uploaded"]);
    expect(audit[0]!.rationale).toContain("dedup back-fill");
  });

  it("dedup back-fill TOCTOU rejected → attempted + skipped_toctou, no SET r2_key", async () => {
    findExistingResult = { snapId: "snap_audit_toctou", r2Key: null };
    policyRevertsAfterR2Put = true;
    const db = setupDb();
    seedQueue(db, "dq_audit_toctou");

    await createSnapshotFingerprint(baseInput("dq_audit_toctou"));

    expect(r2Puts).toHaveLength(1);
    const audit = readAuditRows();
    expect(audit.map((r) => r.decision)).toEqual(["attempted", "skipped_toctou"]);
    const setPatch = neo4j.runs.find(
      (r) => r.via === "session" && /SET s\.r2_key/.test(r.query)
    );
    expect(setPatch).toBeUndefined();
  });

  it("archive_policy=metadata_only → no r2Put + no audit rows (audit-by-absence)", async () => {
    const db = setupDb();
    seedQueue(db, "dq_audit_meta");

    await createSnapshotFingerprint({
      ...baseInput("dq_audit_meta"),
      archivePolicy: "metadata_only",
    });

    expect(r2Puts).toHaveLength(0);
    expect(readAuditRows()).toHaveLength(0);
  });

  it("raw_cloud_policy=always_prohibited → no r2Put + no audit rows", async () => {
    const db = setupDb();
    seedQueue(db, "dq_audit_prohibited");

    await createSnapshotFingerprint({
      ...baseInput("dq_audit_prohibited"),
      rawCloudPolicy: "always_prohibited",
    });

    expect(r2Puts).toHaveLength(0);
    expect(readAuditRows()).toHaveLength(0);
  });

  it("r2Put throw → only attempted audit row, queue marked error", async () => {
    r2PutShouldThrow = true;
    const db = setupDb();
    seedQueue(db, "dq_audit_r2_throw");

    await expect(
      createSnapshotFingerprint(baseInput("dq_audit_r2_throw"))
    ).rejects.toThrow(/simulated r2Put failure/);

    expect(r2Puts).toHaveLength(0); // pushed only on success
    const audit = readAuditRows();
    expect(audit.map((r) => r.decision)).toEqual(["attempted"]);
  });

  it("Neo4j SET r2_key throw → attempted + set_r2_key_failed_neo4j audit rows", async () => {
    neo4jSetShouldThrow = true;
    const db = setupDb();
    seedQueue(db, "dq_audit_set_throw");

    const result = await createSnapshotFingerprint(baseInput("dq_audit_set_throw"));

    expect(r2Puts).toHaveLength(1); // r2Put succeeded
    expect(result.r2Key).toBeNull(); // SET failed → r2Key stays null
    const audit = readAuditRows();
    expect(audit.map((r) => r.decision)).toEqual([
      "attempted",
      "set_r2_key_failed_neo4j",
    ]);
    expect(audit[1]!.rationale).toContain("simulated Neo4j SET");
  });

  it("audit failure (schema mismatch) → throws BEFORE r2Put, NFR-008 hard gate", async () => {
    // Simulate v7 migration NOT applied: drop policy_decisions table so the
    // first `attempted` audit insert raises "no such table". auditR2UploadOrThrow
    // MUST re-throw on ALL audit failures (transient + permanent alike)
    // because SQLite busy_timeout=5000ms already provides driver-level retry;
    // letting r2Put proceed after audit failure would silently violate
    // INV-0012-3 / NFR-008 audit-by-absence invariant (Codex PR #39 round 3
    // P1 + reviewer "audit hard gate").
    const db = setupDb();
    db.exec("DROP TABLE policy_decisions");
    seedQueue(db, "dq_audit_fail");

    await expect(
      createSnapshotFingerprint(baseInput("dq_audit_fail"))
    ).rejects.toThrow(/no such table|policy_decisions/i);

    // r2Put must NOT have run — fail-fast preserves NFR-008.
    expect(r2Puts).toHaveLength(0);
  });

  it("new-path first-create TOCTOU rejected → attempted + skipped_toctou, no SET r2_key", async () => {
    // Codex PR #39 reviewer P1 regression: even on the new-path first-create
    // branch (actualSnapId === snapId, no MERGE-match), a concurrent worker
    // can dedup-link a prohibited source between createDocumentAndSnapshot
    // commit and r2_key SET. The pre-r2Put cross-source check passes
    // (allLinkedSourcesAllowR2SnapshotUpload returns allowed), r2Put runs, but
    // the post-r2Put recheck catches the now-prohibited link and skips SET.
    // The previous `mergeMatchedExisting → stillAllowed=true` short-circuit
    // failed to close this window. Symmetric to the dedup TOCTOU test.
    findExistingResult = null; // force new-path, NOT dedup-match
    policyRevertsAfterR2Put = true;
    const db = setupDb();
    seedQueue(db, "dq_newpath_toctou");

    const result = await createSnapshotFingerprint(baseInput("dq_newpath_toctou"));

    expect(result.deduplicated).toBe(false); // first-create branch
    expect(r2Puts).toHaveLength(1); // r2Put did run (pre-check passed)
    expect(result.r2Key).toBeNull(); // post-check rejected → no SET
    const setPatch = neo4j.runs.find(
      (r) => r.via === "session" && /SET s\.r2_key/.test(r.query)
    );
    expect(setPatch).toBeUndefined();
    const audit = readAuditRows();
    expect(audit.map((r) => r.decision)).toEqual(["attempted", "skipped_toctou"]);
    expect(audit[0]!.rationale).toContain("new-path; first create");
  });
});

// ---------------------------------------------------------------------------
// AI-P0-1 (INFRA-1B.3.h1-policy-fix) — R2 cross-source policy guard regression
// tests for archive_policy enforcement.
//
// Bug (GPT P0-1, Claude L4-F miss): the previous guard
// `allLinkedSourcesAllowRawCloud()` only inspected raw_cloud_policy and
// ignored archive_policy. A Source with archive_policy in
// {metadata_only, excerpt_only, do_not_collect} but
// raw_cloud_policy='allowed_public_data_only' (data-entry skew or future
// policy_learning relaxation) could be linked to an R2-backed Snapshot
// through cross-source dedup, violating ADR-0012 INV-0012-3 permitted-
// artifact gate (legal-safety P0).
//
// Fix: renamed to `allLinkedSourcesAllowR2SnapshotUpload()`, the SQL now
// SELECTs both archive_policy and raw_cloud_policy, and every linked source
// must satisfy archive_policy='full_snapshot_allowed' AND
// raw_cloud_policy='allowed_public_data_only'.
// ---------------------------------------------------------------------------

describe("createSnapshotFingerprint — cross-source archive_policy guard (AI-P0-1)", () => {
  function insertPolicy(
    sourceId: string,
    archivePolicy: string,
    rawCloudPolicy: string,
  ): void {
    const { getDb } = require("../../src/storage/sqlite/connection");
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO source_material_policy
         (source_id, archive_policy, raw_cloud_policy, external_llm_policy)
         VALUES (?, ?, ?, 'allowed')`,
      )
      .run(sourceId, archivePolicy, rawCloudPolicy);
    // The snapshot-fingerprint test mock's MATCH (src:Source ...) handler
    // returns count=1 regardless of source_id, so registration of the source
    // node itself is not needed for these unit tests.
  }

  it("dedup back-fill: linked source with archive_policy=metadata_only is rejected (raw_cloud_policy alone is not enough)", async () => {
    // Pre-fix behavior: the guard only saw raw_cloud_policy='allowed_public_data_only'
    // and let R2 back-fill proceed. Post-fix: archive_policy='metadata_only'
    // disqualifies the linked source even though raw_cloud_policy is open.
    findExistingResult = { snapId: "snap_ARCHIVE_META_DEDUP", r2Key: null };
    linkedSourceIdsFirstCall = ["src-meta"];
    linkedSourceIdsRecheck = ["src-meta"];

    const db = setupDb();
    insertPolicy("src-meta", "metadata_only", "allowed_public_data_only");
    seedQueue(db, "dq_archive_meta_dedup");

    const result = await createSnapshotFingerprint(baseInput("dq_archive_meta_dedup"));

    expect(result.deduplicated).toBe(true);
    expect(r2Puts).toHaveLength(0);
    expect(result.r2Key).toBeNull();
    // audit-by-absence: blocked-by-policy never writes a runtime row.
    expect(readAuditRows()).toHaveLength(0);
    // No SET r2_key write either.
    const setPatch = neo4j.runs.find(
      (r) => r.via === "session" && /SET s\.r2_key/.test(r.query),
    );
    expect(setPatch).toBeUndefined();
  });

  it("dedup back-fill: linked source with archive_policy=excerpt_only is rejected", async () => {
    findExistingResult = { snapId: "snap_ARCHIVE_EXCERPT_DEDUP", r2Key: null };
    linkedSourceIdsFirstCall = ["src-excerpt"];
    linkedSourceIdsRecheck = ["src-excerpt"];

    const db = setupDb();
    insertPolicy("src-excerpt", "excerpt_only", "allowed_public_data_only");
    seedQueue(db, "dq_archive_excerpt_dedup");

    const result = await createSnapshotFingerprint(baseInput("dq_archive_excerpt_dedup"));

    expect(result.deduplicated).toBe(true);
    expect(r2Puts).toHaveLength(0);
    expect(result.r2Key).toBeNull();
    expect(readAuditRows()).toHaveLength(0);
  });

  it("dedup back-fill: linked source with archive_policy=do_not_collect is rejected", async () => {
    findExistingResult = { snapId: "snap_ARCHIVE_DNC_DEDUP", r2Key: null };
    linkedSourceIdsFirstCall = ["src-dnc"];
    linkedSourceIdsRecheck = ["src-dnc"];

    const db = setupDb();
    insertPolicy("src-dnc", "do_not_collect", "allowed_public_data_only");
    seedQueue(db, "dq_archive_dnc_dedup");

    const result = await createSnapshotFingerprint(baseInput("dq_archive_dnc_dedup"));

    expect(result.deduplicated).toBe(true);
    expect(r2Puts).toHaveLength(0);
    expect(result.r2Key).toBeNull();
    expect(readAuditRows()).toHaveLength(0);
  });

  it("new-path: linked source with archive_policy=metadata_only blocks r2Put + writes no audit rows (audit-by-absence)", async () => {
    // First-create branch (not dedup). Input itself is
    // full_snapshot_allowed + allowed_public_data_only so the input gate
    // passes; the pre-r2Put cross-source guard must still reject because
    // the linked source's archive_policy is metadata_only.
    linkedSourceIdsFirstCall = ["src-meta-newpath"];
    linkedSourceIdsRecheck = ["src-meta-newpath"];

    const db = setupDb();
    insertPolicy("src-meta-newpath", "metadata_only", "allowed_public_data_only");
    seedQueue(db, "dq_archive_meta_newpath");

    const result = await createSnapshotFingerprint(baseInput("dq_archive_meta_newpath"));

    expect(result.deduplicated).toBe(false);
    expect(r2Puts).toHaveLength(0);
    expect(result.r2Key).toBeNull();
    expect(readAuditRows()).toHaveLength(0);
  });

  it("cross-source mixed: one full_snapshot_allowed source + one metadata_only source → group rejected", async () => {
    // Even when most linked sources are policy-compliant, a SINGLE
    // restrictive source disqualifies the whole back-fill — the permitted-
    // artifact gate is an AND across all linked sources.
    findExistingResult = { snapId: "snap_MIXED_LINKED", r2Key: null };
    linkedSourceIdsFirstCall = ["src-ok", "src-meta-mixed"];
    linkedSourceIdsRecheck = ["src-ok", "src-meta-mixed"];

    const db = setupDb();
    insertPolicy("src-ok", "full_snapshot_allowed", "allowed_public_data_only");
    insertPolicy("src-meta-mixed", "metadata_only", "allowed_public_data_only");
    seedQueue(db, "dq_mixed_linked");

    const result = await createSnapshotFingerprint(baseInput("dq_mixed_linked"));

    expect(result.deduplicated).toBe(true);
    expect(r2Puts).toHaveLength(0);
    expect(result.r2Key).toBeNull();
    expect(readAuditRows()).toHaveLength(0);
  });

  it("TOCTOU close on archive_policy: pre-check OK but post-r2Put recheck finds metadata_only source → skipped_toctou, no SET r2_key", async () => {
    // Symmetric to the existing raw_cloud_policy TOCTOU test, but driven by
    // archive_policy on the post-check. Pre-check sees only src-ok
    // (full_snapshot_allowed + allowed_public_data_only). After r2Put runs,
    // a concurrent linker attaches src-meta-toctou (metadata_only); the
    // post-r2Put recheck must reject and skip SET r2_key. Audit ledger
    // records attempted + skipped_toctou (Codex P2 invariant).
    findExistingResult = { snapId: "snap_TOCTOU_ARCHIVE", r2Key: null };
    linkedSourceIdsFirstCall = ["src-ok-toctou"];
    linkedSourceIdsRecheck = ["src-ok-toctou", "src-meta-toctou"];

    const db = setupDb();
    insertPolicy("src-ok-toctou", "full_snapshot_allowed", "allowed_public_data_only");
    insertPolicy("src-meta-toctou", "metadata_only", "allowed_public_data_only");
    seedQueue(db, "dq_toctou_archive");

    const result = await createSnapshotFingerprint(baseInput("dq_toctou_archive"));

    expect(result.deduplicated).toBe(true);
    // r2Put DID run — pre-check passed before the concurrent linker arrived.
    expect(r2Puts).toHaveLength(1);
    // But the SET r2_key back-patch was rejected by the post-check.
    expect(result.r2Key).toBeNull();
    const setPatch = neo4j.runs.find(
      (r) => r.via === "session" && /SET s\.r2_key/.test(r.query),
    );
    expect(setPatch).toBeUndefined();
    const audit = readAuditRows();
    expect(audit.map((r) => r.decision)).toEqual(["attempted", "skipped_toctou"]);
  });
});
