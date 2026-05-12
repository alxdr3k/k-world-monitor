// Snapshot fingerprint creation (INFRA-1B.3).
// Takes a fetched document body and creates Document + Snapshot nodes in Neo4j,
// with content_hash deduplication and conditional R2 upload for permitted artifacts.
//
// ADR-0012 INV-0012-3: raw third-party text → r2_key = NULL always.
// ADR-0012 INV-0012-4: only full_snapshot_allowed + allowed_public_data_only → R2 upload.

import { ulid } from "ulid";
import { sha256Hex } from "../../utils/hash";
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
// Deduplication: check Neo4j for existing Snapshot with same content_hash.
// ---------------------------------------------------------------------------

async function findExistingSnapshot(contentHash: string): Promise<string | null> {
  return withSession(async (session) => {
    const result = await session.run(
      "MATCH (s:Snapshot {content_hash: $hash}) RETURN s.snap_id AS snap_id LIMIT 1",
      { hash: contentHash }
    );
    const record = result.records[0];
    return record ? (record.get("snap_id") as string) : null;
  });
}

// ---------------------------------------------------------------------------
// Neo4j writes: Document + Snapshot nodes with Source→Document→Snapshot chain.
// ---------------------------------------------------------------------------

async function createDocumentAndSnapshot(
  input: SnapshotInput,
  snapId: string,
  docId: string,
  contentHash: string,
  r2Key: string | null
): Promise<void> {
  const now = new Date().toISOString();

  await withSession(async (session) => {
    const tx = session.beginTransaction();
    try {
      // Upsert Document node (idempotent on url+source_id).
      await tx.run(
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
           d.published_at = COALESCE($publishedAt, d.published_at)`,
        {
          docId,
          sourceId: input.sourceId,
          url: input.url,
          title: input.title ?? null,
          publishedAt: input.publishedAt ?? null,
          createdAt: now,
        }
      );

      // Create Snapshot node.
      await tx.run(
        `CREATE (s:Snapshot {
           snap_id:      $snapId,
           doc_id:       $docId,
           url:          $url,
           accessed_at:  $accessedAt,
           content_hash: $contentHash,
           locator:      '',
           mime:         $mime,
           byte_size:    $byteSize,
           r2_key:       $r2Key,
           created_at:   $createdAt
         })`,
        {
          snapId,
          docId,
          url: input.url,
          accessedAt: input.accessedAt,
          contentHash,
          mime: input.mimeType,
          byteSize: input.body.byteLength,
          r2Key,
          createdAt: now,
        }
      );

      // Link Source→Document and Document→Snapshot.
      await tx.run(
        `MATCH (src:Source {source_id: $sourceId}), (d:Document {url: $url, source_id: $sourceId})
         MERGE (src)-[:HAS_DOCUMENT]->(d)`,
        { sourceId: input.sourceId, url: input.url }
      );

      await tx.run(
        `MATCH (d:Document {url: $url, source_id: $sourceId}), (s:Snapshot {snap_id: $snapId})
         CREATE (d)-[:HAS_SNAPSHOT]->(s)`,
        { url: input.url, sourceId: input.sourceId, snapId }
      );

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// discovery_queue status update (serial SQLite, INV-0030-2).
// ---------------------------------------------------------------------------

function markQueueItemDone(queueId: string, snapId: string): void {
  getDb()
    .prepare(
      `UPDATE discovery_queue
       SET status = 'done', content_hash = (
         SELECT content_hash FROM discovery_queue WHERE queue_id = ?
       )
       WHERE queue_id = ?`
    )
    .run(queueId, queueId);
  // Store snap_id reference in error_detail column repurposed as result metadata.
  // (A dedicated snap_id column will be added in a later migration if needed.)
  getDb()
    .prepare(
      `UPDATE discovery_queue SET error_detail = ? WHERE queue_id = ?`
    )
    .run(`snap_id:${snapId}`, queueId);
}

function markQueueItemError(queueId: string, detail: string): void {
  getDb()
    .prepare(
      `UPDATE discovery_queue SET status = 'error', error_detail = ? WHERE queue_id = ?`
    )
    .run(detail.slice(0, 500), queueId);
}

// ---------------------------------------------------------------------------
// Main public function.
// ---------------------------------------------------------------------------

export async function createSnapshotFingerprint(
  input: SnapshotInput
): Promise<SnapshotResult> {
  const contentHash = sha256Hex(Buffer.from(input.body).toString("hex") + input.url);

  // Deduplication: if identical content already snapped, skip Neo4j write.
  const existing = await findExistingSnapshot(contentHash);
  if (existing) {
    markQueueItemDone(input.queueId, existing);
    return {
      snapId: existing,
      docId: "",
      contentHash,
      r2Key: null,
      deduplicated: true,
    };
  }

  const snapId = `snap_${ulid()}`;
  const docId = `doc_${ulid()}`;

  // R2 upload: only for explicitly permitted artifacts (ADR-0012 INV-0012-3/4).
  let r2Key: string | null = null;
  if (
    input.archivePolicy === "full_snapshot_allowed" &&
    input.rawCloudPolicy === "allowed_public_data_only"
  ) {
    const key = `permitted_artifact/derived/snapshot/${snapId}`;
    const bodyBuf = input.body.buffer.slice(
      input.body.byteOffset,
      input.body.byteOffset + input.body.byteLength
    ) as ArrayBuffer;
    await r2Put(key, bodyBuf);
    r2Key = key;
  }

  await createDocumentAndSnapshot(input, snapId, docId, contentHash, r2Key);
  markQueueItemDone(input.queueId, snapId);

  return { snapId, docId, contentHash, r2Key, deduplicated: false };
}

export async function processDiscoveryQueue(
  archivePolicyFn: (sourceId: string) => Promise<{
    archivePolicy: ArchivePolicy;
    rawCloudPolicy: RawCloudPolicy;
  }>
): Promise<{ processed: number; deduplicated: number; errors: number }> {
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT queue_id, source_id, url, title, published_at
       FROM discovery_queue
       WHERE status = 'pending'
       ORDER BY discovered_at ASC
       LIMIT 100`
    )
    .all() as Array<{
      queue_id: string;
      source_id: string;
      url: string;
      title: string | null;
      published_at: string | null;
    }>;

  // Mark as processing (serial write before async fetch, INV-0030-2).
  const ids = pending.map((r) => r.queue_id);
  if (ids.length > 0) {
    db.prepare(
      `UPDATE discovery_queue SET status = 'processing'
       WHERE queue_id IN (${ids.map(() => "?").join(",")})`
    ).run(...ids);
  }

  let processed = 0;
  let deduplicated = 0;
  let errors = 0;

  for (const row of pending) {
    try {
      const { archivePolicy, rawCloudPolicy } = await archivePolicyFn(row.source_id);
      const { safeFetch, MAX_BYTES } = await import("../fetch/safe-fetch");
      const res = await safeFetch(row.url, { maxBytes: MAX_BYTES.rss });

      if (res.status >= 400) {
        markQueueItemError(row.queue_id, `HTTP ${res.status}`);
        errors++;
        continue;
      }

      const mimeType =
        res.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "application/octet-stream";
      const result = await createSnapshotFingerprint({
        sourceId: row.source_id,
        queueId: row.queue_id,
        url: row.url,
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
