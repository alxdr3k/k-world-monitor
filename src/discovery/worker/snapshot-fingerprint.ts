// Snapshot fingerprint creation (INFRA-1B.3).
// Takes a fetched document body and creates Document + Snapshot nodes in Neo4j,
// with content_hash deduplication and conditional R2 upload for permitted artifacts.
//
// ADR-0012 INV-0012-3: raw third-party text → r2_key = NULL always.
// ADR-0012 INV-0012-4: only full_snapshot_allowed + allowed_public_data_only → R2 upload.

import { ulid } from "ulid";
import { createHash } from "crypto";
import { withSession } from "../../storage/neo4j/connection";
import { r2Put } from "../../storage/r2/client";
import { getDb } from "../../storage/sqlite/connection";
import type { ContentKind } from "../fetch/safe-fetch";

export type ArchivePolicy =
  | "metadata_only"
  | "excerpt_only"
  | "full_snapshot_allowed"
  | "do_not_collect";

export type RawCloudPolicy = "always_prohibited" | "allowed_public_data_only";

export interface SnapshotInput {
  sourceId: string;
  queueId: string;
  url: string;
  title?: string;
  publishedAt?: string;
  accessedAt: string;
  body: Uint8Array;
  contentKind: ContentKind;
  mimeType: string;
  archivePolicy: ArchivePolicy;
  rawCloudPolicy: RawCloudPolicy;
}

export interface SnapshotResult {
  snapId: string;
  docId: string;
  contentHash: string;
  r2Key: string | null;
  deduplicated: boolean;
}

// ---------------------------------------------------------------------------
// P2-13: Hash raw bytes directly to avoid memory overhead of hex-encoding body.
// Cross-source dedup: hash body only — identical bytes fetched from mirror URLs
// or tracking-parameter variants must share one Snapshot. URL identity lives on
// Document, not on content_hash.
// ---------------------------------------------------------------------------

function sha256HexBytes(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

// ---------------------------------------------------------------------------
// Source id normalization: discovery producer v0 enqueues slug-form source_id
// (e.g. "ft-asia"), but the graph and source_material_policy use canonical
// src_<ULID> identifiers. Look up the canonical id via source_registry_slug_map
// (v3 migration); fall back to the raw value if the table is absent or the
// slug has no mapping yet (lets src_<ULID> rows pass through untouched).
// ---------------------------------------------------------------------------

function normalizeSourceId(rawSourceId: string): string {
  if (rawSourceId.startsWith("src_")) return rawSourceId;
  try {
    const row = getDb()
      .prepare("SELECT source_id FROM source_registry_slug_map WHERE slug = ?")
      .get(rawSourceId) as { source_id: string } | undefined;
    return row?.source_id ?? rawSourceId;
  } catch {
    return rawSourceId; // slug_map table absent (pre-v3 schema)
  }
}

// ---------------------------------------------------------------------------
// discovery_queue schema detection — v6 has no `updated_at` column; v7+ does.
// Cache the probe so we run it once per process.
// ---------------------------------------------------------------------------

let _hasUpdatedAt: boolean | null = null;
function hasUpdatedAtColumn(): boolean {
  if (_hasUpdatedAt !== null) return _hasUpdatedAt;
  try {
    getDb().prepare("SELECT updated_at FROM discovery_queue LIMIT 0").all();
    _hasUpdatedAt = true;
  } catch {
    _hasUpdatedAt = false;
  }
  return _hasUpdatedAt;
}

// ---------------------------------------------------------------------------
// Deduplication: check Neo4j for existing Snapshot with same content_hash.
// ---------------------------------------------------------------------------

interface ExistingSnapshot {
  snapId: string;
  docId: string;
  r2Key: string | null;
}

// Returns true only when every Source linked to this Snapshot has
// raw_cloud_policy='allowed_public_data_only' in source_material_policy.
// Used by the dedup R2 back-fill path so cross-source dedup cannot retroactively
// give a Source with always_prohibited policy access to an R2 artifact path
// (ADR-0012 INV-0012-3). Treats unknown / unregistered sources as prohibited.
async function allLinkedSourcesAllowRawCloud(snapId: string): Promise<boolean> {
  const sourceIds = await withSession(async (session) => {
    const result = await session.run(
      `MATCH (s:Snapshot {snap_id: $snapId})<-[:HAS_SNAPSHOT]-(:Document)<-[:HAS_DOCUMENT]-(src:Source)
       RETURN collect(DISTINCT src.source_id) AS source_ids`,
      { snapId }
    );
    const record = result.records[0];
    return record ? ((record.get("source_ids") as string[]) ?? []) : [];
  });
  if (sourceIds.length === 0) return false;
  const placeholders = sourceIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT source_id, raw_cloud_policy FROM source_material_policy
       WHERE source_id IN (${placeholders})`
    )
    .all(...sourceIds) as Array<{ source_id: string; raw_cloud_policy: string }>;
  // Any unmapped source or non-allowed policy disqualifies back-fill.
  if (rows.length !== sourceIds.length) return false;
  return rows.every((r) => r.raw_cloud_policy === "allowed_public_data_only");
}

// Returns null when no Snapshot with this content_hash exists.
// Also returns r2_key (so dedup can back-fill a failed R2 upload) and doc_id
// (so the dedup result satisfies SnapshotResult contract with a real document
// identifier instead of an empty string).
async function findExistingSnapshot(contentHash: string): Promise<ExistingSnapshot | null> {
  return withSession(async (session) => {
    const result = await session.run(
      "MATCH (s:Snapshot {content_hash: $hash}) RETURN s.snap_id AS snap_id, s.doc_id AS doc_id, s.r2_key AS r2_key LIMIT 1",
      { hash: contentHash }
    );
    const record = result.records[0];
    if (!record) return null;
    return {
      snapId: record.get("snap_id") as string,
      docId: (record.get("doc_id") as string | null) ?? "",
      r2Key: (record.get("r2_key") as string | null) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Neo4j writes: Document + Snapshot nodes with Source→Document→Snapshot chain.
//
// P1-1: MERGE Document and RETURN d.doc_id so the actual stored doc_id is used
//        for Snapshot.doc_id, not a freshly generated UUID.
// P1-3: Guard that Source exists before committing; throw if missing.
// P1-4: MERGE on content_hash instead of CREATE for idempotent concurrent writes.
//
// Returns the actual { docId, snapId } stored in Neo4j (MERGE may match existing nodes).
// ---------------------------------------------------------------------------

async function createDocumentAndSnapshot(
  input: SnapshotInput,
  snapId: string,
  docId: string,
  contentHash: string
): Promise<{ docId: string; snapId: string }> {
  const now = new Date().toISOString();

  return withSession(async (session) => {
    const tx = session.beginTransaction();
    try {
      // Upsert Document (idempotent on url+source_id).
      // RETURN d.doc_id so ON MATCH case returns the existing stored value.
      const docResult = await tx.run(
        `MERGE (d:Document {url: $url, source_id: $sourceId})
         ON CREATE SET
           d.doc_id       = $docId,
           d.source_id    = $sourceId,
           d.url          = $url,
           d.canonical_url = $url,
           d.title        = $title,
           d.published_at = $publishedAt,
           d.created_at   = $createdAt
         ON MATCH SET
           d.title        = COALESCE($title, d.title),
           d.published_at = COALESCE($publishedAt, d.published_at)
         RETURN d.doc_id AS doc_id`,
        {
          docId,
          sourceId: input.sourceId,
          url: input.url,
          title: input.title ?? null,
          publishedAt: input.publishedAt ?? null,
          createdAt: now,
        }
      );

      // Use the doc_id returned from the MERGE (not the pre-generated local var).
      const actualDocId: string =
        docResult.records.length > 0
          ? (docResult.records[0]!.get("doc_id") as string)
          : docId;

      // P1-3: Guard — Source must exist before linking.
      // If missing, roll back so Document+Snapshot are never committed without a Source.
      const sourceCheck = await tx.run(
        `MATCH (src:Source {source_id: $sourceId}) RETURN count(src) AS matched`,
        { sourceId: input.sourceId }
      );
      const matched =
        sourceCheck.records.length > 0
          ? Number(sourceCheck.records[0]!.get("matched"))
          : 0;
      if (matched === 0) {
        throw new Error(`Source not found in graph: ${input.sourceId}`);
      }

      // P1-4: MERGE on content_hash makes Snapshot creation idempotent.
      // RETURN s.snap_id so the caller uses the actual persisted ID even when MERGE
      // matches an existing node (race: two workers with the same contentHash).
      const snapResult = await tx.run(
        `MERGE (s:Snapshot {content_hash: $contentHash})
         ON CREATE SET
           s.snap_id     = $snapId,
           s.doc_id      = $actualDocId,
           s.url         = $url,
           s.accessed_at = $accessedAt,
           s.locator     = '',
           s.mime        = $mime,
           s.byte_size   = $byteSize,
           s.r2_key      = null,
           s.created_at  = $createdAt
         RETURN s.snap_id AS snap_id`,
        {
          snapId,
          actualDocId,
          url: input.url,
          accessedAt: input.accessedAt,
          contentHash,
          mime: input.mimeType,
          byteSize: input.body.byteLength,
          createdAt: now,
        }
      );
      const actualSnapId: string =
        snapResult.records.length > 0
          ? (snapResult.records[0]!.get("snap_id") as string)
          : snapId;

      // Link Source→Document (MERGE to avoid duplicate edges).
      await tx.run(
        `MATCH (src:Source {source_id: $sourceId}), (d:Document {url: $url, source_id: $sourceId})
         MERGE (src)-[:HAS_DOCUMENT]->(d)`,
        { sourceId: input.sourceId, url: input.url }
      );

      // Link Document→Snapshot (MERGE to avoid duplicate edges).
      await tx.run(
        `MATCH (d:Document {url: $url, source_id: $sourceId}), (s:Snapshot {content_hash: $contentHash})
         MERGE (d)-[:HAS_SNAPSHOT]->(s)`,
        { url: input.url, sourceId: input.sourceId, contentHash }
      );

      await tx.commit();
      return { docId: actualDocId, snapId: actualSnapId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// P1-6: Source linkage on dedup path.
// When a snapshot is deduplicated, still ensure Source→Document→Snapshot edges
// exist for the current source_id (content may have been first seen from a
// different source).
// ---------------------------------------------------------------------------

async function ensureSourceLinkage(
  input: SnapshotInput,
  contentHash: string
): Promise<string | null> {
  return withSession(async (session) => {
    const tx = session.beginTransaction();
    try {
      // On the dedup path tolerate a missing Source (do not throw) — but report
      // back to the caller so the queue row is marked error rather than done.
      const sourceCheck = await tx.run(
        `MATCH (src:Source {source_id: $sourceId}) RETURN count(src) AS matched`,
        { sourceId: input.sourceId }
      );
      const matched =
        sourceCheck.records.length > 0
          ? Number(sourceCheck.records[0]!.get("matched"))
          : 0;
      if (matched === 0) {
        await tx.rollback();
        return null;
      }

      const now = new Date().toISOString();
      const newDocId = `doc_${ulid()}`;

      // Upsert Document for this source. RETURN d.doc_id so the caller can hand
      // a real docId back from the dedup path (ON MATCH keeps the existing id,
      // ON CREATE uses newDocId).
      const docResult = await tx.run(
        `MERGE (d:Document {url: $url, source_id: $sourceId})
         ON CREATE SET
           d.doc_id       = $docId,
           d.source_id    = $sourceId,
           d.url          = $url,
           d.canonical_url = $url,
           d.title        = $title,
           d.published_at = $publishedAt,
           d.created_at   = $createdAt
         ON MATCH SET
           d.title        = COALESCE($title, d.title),
           d.published_at = COALESCE($publishedAt, d.published_at)
         RETURN d.doc_id AS doc_id`,
        {
          docId: newDocId,
          sourceId: input.sourceId,
          url: input.url,
          title: input.title ?? null,
          publishedAt: input.publishedAt ?? null,
          createdAt: now,
        }
      );
      const linkedDocId =
        docResult.records.length > 0
          ? (docResult.records[0]!.get("doc_id") as string)
          : newDocId;

      await tx.run(
        `MATCH (src:Source {source_id: $sourceId}), (d:Document {url: $url, source_id: $sourceId})
         MERGE (src)-[:HAS_DOCUMENT]->(d)`,
        { sourceId: input.sourceId, url: input.url }
      );

      await tx.run(
        `MATCH (d:Document {url: $url, source_id: $sourceId}), (s:Snapshot {content_hash: $contentHash})
         MERGE (d)-[:HAS_SNAPSHOT]->(s)`,
        { url: input.url, sourceId: input.sourceId, contentHash }
      );

      await tx.commit();
      return linkedDocId;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// discovery_queue status update (serial SQLite, INV-0030-2).
// ---------------------------------------------------------------------------

// P2-8: Pass computed contentHash directly — the old code was a self-copy no-op
//        (SELECT content_hash FROM discovery_queue WHERE queue_id = ?).
// Single UPDATE to ensure status, content_hash, and error_detail are written atomically.
// error_detail stores snap_id as result metadata; a dedicated snap_id column will be
// added in a later migration if needed.
// updated_at clause is included only when v7 column is present (pre-v7 DBs would throw).
function markQueueItemDone(queueId: string, snapId: string, contentHash: string): void {
  const u = hasUpdatedAtColumn()
    ? ", updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    : "";
  getDb()
    .prepare(
      `UPDATE discovery_queue
       SET status = 'done', content_hash = ?, error_detail = ?${u}
       WHERE queue_id = ?`
    )
    .run(contentHash, `snap_id:${snapId}`, queueId);
}

function markQueueItemError(queueId: string, detail: string): void {
  const u = hasUpdatedAtColumn()
    ? ", updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    : "";
  getDb()
    .prepare(
      `UPDATE discovery_queue
       SET status = 'error', error_detail = ?${u}
       WHERE queue_id = ?`
    )
    .run(detail.slice(0, 500), queueId);
}

// ---------------------------------------------------------------------------
// Main public function.
// ---------------------------------------------------------------------------

export async function createSnapshotFingerprint(
  input: SnapshotInput
): Promise<SnapshotResult> {
  // P2-13: Hash raw Uint8Array bytes — no hex-stringify to avoid doubling memory.
  // Body-only hash so mirror URLs / tracking-parameter variants of identical
  // content all collide on one Snapshot (cross-source dedup).
  const contentHash = sha256HexBytes(input.body);

  // Deduplication: if identical content already snapped, skip Neo4j write.
  const existing = await findExistingSnapshot(contentHash);
  if (existing) {
    // P1-6: Ensure Source→Document→Snapshot edges for current source_id even on dedup.
    // If the Source node is missing, mark the queue row error and throw so the
    // caller's metrics count this as a real failure (not a successful dedup).
    const linked = await ensureSourceLinkage(input, contentHash);
    if (!linked) {
      markQueueItemError(
        input.queueId,
        `dedup: source not found in graph: ${input.sourceId}`
      );
      throw new Error(`dedup: source not found in graph: ${input.sourceId}`);
    }

    // Back-fill R2 upload if a previous attempt left r2_key=null for a permitted artifact.
    // This handles the case where a prior worker created the Snapshot node but then failed
    // before completing the R2 upload (leaving r2_key=null permanently without this retry).
    //
    // ADR-0012 INV-0012-3 cross-source guard: snapshots are deduplicated across sources,
    // so the existing Snapshot may already be linked to a source whose raw_cloud_policy
    // is `always_prohibited`. Uploading to R2 under any policy from the *current* source
    // would retroactively give the prohibited source path an r2_key, violating the
    // raw-cloud prohibition. Only back-fill when every linked source's policy permits it.
    let dedupR2Key: string | null = existing.r2Key;
    if (
      existing.r2Key === null &&
      input.archivePolicy === "full_snapshot_allowed" &&
      input.rawCloudPolicy === "allowed_public_data_only" &&
      (await allLinkedSourcesAllowRawCloud(existing.snapId))
    ) {
      const key = `permitted_artifact/derived/snapshot/${existing.snapId}`;
      const bodyBuf = input.body.buffer.slice(
        input.body.byteOffset,
        input.body.byteOffset + input.body.byteLength
      ) as ArrayBuffer;
      await r2Put(key, bodyBuf);
      dedupR2Key = key;
      await withSession(async (session) => {
        await session.run(
          `MATCH (s:Snapshot {snap_id: $snapId}) SET s.r2_key = $r2Key`,
          { snapId: existing.snapId, r2Key: key }
        );
      });
    }

    markQueueItemDone(input.queueId, existing.snapId, contentHash);
    return {
      snapId: existing.snapId,
      docId: existing.docId,
      contentHash,
      r2Key: dedupR2Key,
      deduplicated: true,
    };
  }

  const snapId = `snap_${ulid()}`;
  const docId = `doc_${ulid()}`;

  // P2-9: Neo4j write FIRST, R2 upload after — prevents orphaned R2 objects on Neo4j failure.
  const { docId: actualDocId, snapId: actualSnapId } = await createDocumentAndSnapshot(
    input,
    snapId,
    docId,
    contentHash
  );

  // R2 upload: only for explicitly permitted artifacts (ADR-0012 INV-0012-3/4).
  // P2-9 addendum: After Neo4j write, upload to R2 and then back-patch the
  // Snapshot node's r2_key so the stored graph reflects the actual R2 locator.
  //
  // R5 P1 — MERGE race cross-source guard: when `actualSnapId !== snapId`, the
  // MERGE matched a Snapshot created by a concurrent worker that may have
  // linked the node to a Source whose raw_cloud_policy is `always_prohibited`.
  // Re-run the cross-source policy check (same guard as the dedup back-fill
  // path) so we never grant an r2_key to a snapshot already shared with a
  // prohibited source.
  let r2Key: string | null = null;
  if (
    input.archivePolicy === "full_snapshot_allowed" &&
    input.rawCloudPolicy === "allowed_public_data_only"
  ) {
    const mergeMatchedExisting = actualSnapId !== snapId;
    const policyOk =
      !mergeMatchedExisting ||
      (await allLinkedSourcesAllowRawCloud(actualSnapId));
    if (policyOk) {
      const key = `permitted_artifact/derived/snapshot/${actualSnapId}`;
      const bodyBuf = input.body.buffer.slice(
        input.body.byteOffset,
        input.body.byteOffset + input.body.byteLength
      ) as ArrayBuffer;
      await r2Put(key, bodyBuf);
      r2Key = key;
      // Back-patch r2_key on the Snapshot node now that upload succeeded.
      await withSession(async (session) => {
        await session.run(
          `MATCH (s:Snapshot {snap_id: $snapId}) SET s.r2_key = $r2Key`,
          { snapId: actualSnapId, r2Key: key }
        );
      });
    }
  }

  markQueueItemDone(input.queueId, actualSnapId, contentHash);

  return { snapId: actualSnapId, docId: actualDocId, contentHash, r2Key, deduplicated: false };
}

export async function processDiscoveryQueue(
  archivePolicyFn: (sourceId: string) => Promise<{
    archivePolicy: ArchivePolicy;
    rawCloudPolicy: RawCloudPolicy;
  }>
): Promise<{ processed: number; deduplicated: number; errors: number }> {
  const db = getDb();

  // P2-10: Reset stale processing rows from crashed workers (older than 1 hour).
  // Uses updated_at column (added in v7 migration). Gracefully skips on pre-v7 schemas.
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.prepare(
      `UPDATE discovery_queue
       SET status = 'pending', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE status = 'processing' AND updated_at < ?`
    ).run(oneHourAgo);
  } catch (err) {
    // Only suppress the specific "no such column: updated_at" case (pre-v7 schema).
    // Any other missing column or unrelated error must propagate so operational
    // regressions (e.g. queue-recovery bugs) fail fast instead of silently disabling.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/no such column:\s*updated_at/i.test(msg)) throw err;
    // updated_at column absent (pre-v7 schema) — stale reclaim skipped.
  }

  // P1-5: Atomic row claiming using an IMMEDIATE SQLite transaction so two concurrent
  // workers cannot claim the same rows. bun:sqlite defaults to DEFERRED, which allows
  // another reader to interleave between our SELECT and UPDATE; IMMEDIATE acquires a
  // write lock at BEGIN so the SELECT+UPDATE block is exclusive.
  const batchSize = 100;
  let pending: Array<{
    queue_id: string;
    source_id: string;
    url: string;
    title: string | null;
    published_at: string | null;
  }> = [];

  // R5 P2 — Bounded retry on SQLITE_BUSY: BEGIN IMMEDIATE acquires a write lock
  // up front, and SQLite allows only one writer per database. Another worker
  // (or the discovery producer's enqueue path) holding a write transaction will
  // cause BEGIN IMMEDIATE to throw `SQLITE_BUSY`. Without retry, an otherwise
  // healthy worker run aborts and processes zero rows. We retry a small number
  // of times with linear backoff; if contention persists the caller still sees
  // the error after the budget.
  const MAX_BUSY_RETRIES = 5;
  const BUSY_BACKOFF_MS = 50;
  for (let attempt = 0; ; attempt++) {
    try {
      db.prepare("BEGIN IMMEDIATE").run();
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/SQLITE_BUSY|database is locked/i.test(msg) || attempt >= MAX_BUSY_RETRIES) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, BUSY_BACKOFF_MS * (attempt + 1)));
    }
  }
  {
    try {
      pending = db
        .prepare(
          `SELECT queue_id, source_id, url, title, published_at
           FROM discovery_queue
           WHERE status = 'pending'
           ORDER BY discovered_at ASC
           LIMIT ?`
        )
        .all(batchSize) as typeof pending;

      if (pending.length > 0) {
        const ids = pending.map((r) => r.queue_id);
        const u = hasUpdatedAtColumn()
          ? ", updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
          : "";
        db.prepare(
          `UPDATE discovery_queue
           SET status = 'processing'${u}
           WHERE queue_id IN (${ids.map(() => "?").join(",")})`
        ).run(...ids);
      }

      db.prepare("COMMIT").run();
    } catch (err) {
      try { db.prepare("ROLLBACK").run(); } catch { /* ignore rollback errors */ }
      throw err;
    }
  }

  // RFC 9110: 204 No Content and 205 Reset Content MUST NOT include a message body.
  const NO_BODY_2XX = new Set([204, 205]);

  let processed = 0;
  let deduplicated = 0;
  let errors = 0;

  for (const row of pending) {
    // Heartbeat: touch updated_at before processing so the 1h stale-reclaim
    // does not requeue a still-active row mid-batch (long fetch/Neo4j writes
    // can exceed the threshold for batches of large items).
    if (hasUpdatedAtColumn()) {
      db.prepare(
        `UPDATE discovery_queue SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE queue_id = ?`
      ).run(row.queue_id);
    }

    // Normalize slug→canonical src_<ULID> up front so both the policy lookup
    // and the downstream graph MATCH operate on the same id namespace. The v0
    // discovery producer enqueues slug-form ids while source_material_policy
    // and Source nodes are keyed by canonical ids.
    const canonicalSourceId = normalizeSourceId(row.source_id);

    try {
      const { archivePolicy, rawCloudPolicy } = await archivePolicyFn(canonicalSourceId);

      // P1-7: Enforce do_not_collect before any outbound fetch.
      if (archivePolicy === "do_not_collect") {
        markQueueItemError(row.queue_id, "skipped: do_not_collect policy");
        errors++;
        continue;
      }

      const { safeFetch, MAX_BYTES } = await import("../fetch/safe-fetch");

      // P1-2: Use MAX_BYTES.html for document URLs — larger cap than rss (10MB vs 5MB).
      const res = await safeFetch(row.url, { maxBytes: MAX_BYTES.html });

      // P2-12: Require 2xx with non-empty body; treat no-body 2xx (204, 205),
      // empty 200, 3xx, 4xx, 5xx as errors. Empty payloads must not be
      // fingerprinted (they would all share one hash and pollute dedup state).
      const empty2xx =
        res.status >= 200 && res.status < 300 && res.body.byteLength === 0;
      if (
        !(res.status >= 200 && res.status < 300) ||
        NO_BODY_2XX.has(res.status) ||
        empty2xx
      ) {
        markQueueItemError(
          row.queue_id,
          empty2xx ? `HTTP ${res.status} empty body` : `HTTP ${res.status}`
        );
        errors++;
        continue;
      }

      const mimeType =
        res.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "application/octet-stream";

      // P2-11: Use finalUrl (after redirects) as the canonical URL for snapshot identity.
      const result = await createSnapshotFingerprint({
        sourceId: canonicalSourceId,
        queueId: row.queue_id,
        url: res.finalUrl,
        title: row.title ?? undefined,
        publishedAt: row.published_at ?? undefined,
        accessedAt: new Date().toISOString(),
        body: res.body,
        contentKind: res.contentKind,
        mimeType,
        archivePolicy,
        rawCloudPolicy,
      });

      if (result.deduplicated) deduplicated++;
      else processed++;
    } catch (err) {
      markQueueItemError(
        row.queue_id,
        err instanceof Error ? err.message : String(err)
      );
      errors++;
    }
  }

  return { processed, deduplicated, errors };
}
