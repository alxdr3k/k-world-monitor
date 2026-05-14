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
import { recordR2UploadDecision } from "../../storage/audit/policy-decisions";
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

// discovery_queue.source_id is now canonical src_<ULID> at the producer
// (rss-worker.enqueueDiscoveredItems resolves slug→canonical before INSERT,
// enforced by the FK to source_material_policy(source_id)). Consumer-side
// normalization is no longer needed and the previous slug-fallback resolver
// has been removed — the column is trusted to already be canonical.
//
// discovery_queue.updated_at is part of the base v6 schema. The previous
// probe-and-branch triplet (hasUpdatedAtColumn / tryHasUpdatedAtColumn /
// tryUpdatedAtClause) defended against a pre-v7 schema that no longer
// exists; every UPDATE statement now sets updated_at unconditionally via
// SET_UPDATED_AT.
const SET_UPDATED_AT = ", updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')";

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
    let committed = false;
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

      // Set committed BEFORE tx.commit() so the catch handler never attempts
      // rollback after a commit is in-flight. Mirrors the chunker.ts pattern
      // (commitAttempted=true before await tx.commit()) to avoid the Neo4j
      // driver error on rollback-after-commit.
      committed = true;
      await tx.commit();
      return { docId: actualDocId, snapId: actualSnapId };
    } catch (err) {
      if (!committed) await tx.rollback();
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
    let committed = false;
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

      // Set committed BEFORE tx.commit() — same pattern as createDocumentAndSnapshot
      // and chunker.ts to avoid rollback-after-commit Neo4j driver error.
      committed = true;
      await tx.commit();
      return linkedDocId;
    } catch (err) {
      if (!committed) await tx.rollback();
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// discovery_queue status update (serial SQLite, INV-0030-2).
// ---------------------------------------------------------------------------

// Discrete failure-mode enum. Must match the CHECK constraint on
// discovery_queue.error_code in migrations/sqlite/v6_discovery_queue.sql.
// Splitting from the free-form error_detail lets operator dashboards bucket
// failures via GROUP BY error_code without parsing English strings.
export type QueueErrorCode =
  | "source_not_found_in_graph"
  | "dedup_prohibited_source"
  | "policy_do_not_collect"
  | "http_status"
  | "empty_body"
  | "runtime_error";

// TypedQueueError carries a discrete QueueErrorCode through a throw so the
// per-row recovery catch block can record the SPECIFIC failure mode rather
// than clobbering it with a generic "runtime_error" bucket.
//
// Pattern: helpers in createSnapshotFingerprint (dedup prohibited, missing
// Source linkage, etc.) throw a TypedQueueError with the right code. The
// catch block in processOneRow inspects err.errorCode (falling back to
// "runtime_error" for any non-typed exception) and is the SINGLE call site
// for markQueueItemError on the per-row path. This removes the previous
// "inner mark then throw, outer mark would clobber but is no-op due to
// WHERE status='processing'" implicit-safety pattern that was correct but
// fragile to readers.
export class TypedQueueError extends Error {
  constructor(public readonly errorCode: QueueErrorCode, message: string) {
    super(message);
    this.name = "TypedQueueError";
  }
}

// Single UPDATE writes status + snap_id + content_hash atomically. snap_id
// now has its own column; error_code/error_detail are cleared so a re-run
// of a previously errored row (after stale-reclaim or operator retry) does
// not retain stale failure metadata next to the success.
function markQueueItemDone(queueId: string, snapId: string, contentHash: string): void {
  getDb()
    .prepare(
      `UPDATE discovery_queue
       SET status = 'done',
           snap_id = ?,
           content_hash = ?,
           error_code = NULL,
           error_detail = NULL${SET_UPDATED_AT}
       WHERE queue_id = ? AND status = 'processing'`
    )
    .run(snapId, contentHash, queueId);
}

// errorCode is a discrete enum; detail is optional free-form supplementary
// text (truncated to 500 chars). On error, snap_id is explicitly NULLed so
// a row that previously succeeded then was re-queued and failed does not
// retain a misleading snap_id.
function markQueueItemError(
  queueId: string,
  errorCode: QueueErrorCode,
  detail?: string
): void {
  getDb()
    .prepare(
      `UPDATE discovery_queue
       SET status = 'error',
           snap_id = NULL,
           error_code = ?,
           error_detail = ?${SET_UPDATED_AT}
       WHERE queue_id = ? AND status = 'processing'`
    )
    .run(errorCode, detail ? detail.slice(0, 500) : null, queueId);
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
    // ADR-0012 INV-0012-3 cross-source guard (dedup link path): a Source whose
    // raw_cloud_policy is `always_prohibited` must never be linked to a
    // Snapshot that already has an r2_key, because the link would associate
    // the prohibited source with a cloud-backed raw artifact through dedup
    // reuse. Mark the row error and throw so this is counted as a real failure.
    if (existing.r2Key !== null && input.rawCloudPolicy === "always_prohibited") {
      throw new TypedQueueError(
        "dedup_prohibited_source",
        `dedup: prohibited source cannot link to r2-backed snapshot: ${input.sourceId}`
      );
    }

    // P1-6: Ensure Source→Document→Snapshot edges for current source_id even on dedup.
    // If the Source node is missing, throw a typed error so the per-row catch
    // records the SPECIFIC error_code (not a generic runtime_error).
    const linked = await ensureSourceLinkage(input, contentHash);
    if (!linked) {
      throw new TypedQueueError(
        "source_not_found_in_graph",
        `dedup: source not found in graph: ${input.sourceId}`
      );
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
      // INV-0012-3 audit row 1/2 — record attempt BEFORE r2Put so a network
      // failure still leaves a recoverable audit trail (NFR-008 audit-by-absence
      // proof requires every upload attempt accounted for).
      recordR2UploadDecision({
        sourceId: input.sourceId,
        snapId: existing.snapId,
        url: input.url,
        archivePolicy: input.archivePolicy,
        rawCloudPolicy: input.rawCloudPolicy,
        decision: "attempted",
        rationale: "dedup back-fill path",
      });
      await r2Put(key, bodyBuf);
      // ADR-0012 INV-0012-3 TOCTOU close: re-check linked-source policy AFTER
      // r2Put completes. A concurrent linker can attach a prohibited source
      // between the first check and now; if so, skip the SET r2_key Neo4j
      // write so the Snapshot remains r2_key=null and the prohibited source
      // never sees an r2-backed reference.
      //
      // We DO NOT r2Delete the uploaded object here: another worker may have
      // legitimately re-uploaded the same idempotent key during this window,
      // and an asymmetric delete (r2Delete does not call checkPermittedPrefix)
      // would wipe their legitimate object. The orphan is bounded — the next
      // eligible retry will dedup-match and re-evaluate policy; if still
      // allowed it back-fills the r2_key via r2Put's idempotent overwrite.
      //
      // If the re-check itself throws (transient Neo4j blip), the SAFE default
      // is to skip the SET so we never escalate a verification failure into a
      // graph link the prohibited source could observe.
      let stillAllowed: boolean;
      try {
        stillAllowed = await allLinkedSourcesAllowRawCloud(existing.snapId);
      } catch (recheckErr) {
        console.warn(
          `[snapshot] dedup post-r2Put policy recheck failed; leaving r2_key=null for safety:`,
          recheckErr instanceof Error ? recheckErr.message : recheckErr
        );
        stillAllowed = false;
      }
      if (stillAllowed) {
        // SET r2_key is best-effort: if Neo4j is unavailable here the r2 object
        // already exists, the Snapshot node still has r2_key=null, and a later
        // retry will dedup-match and back-fill via the same idempotent path
        // (r2Put overwrites by key). Treat the SET failure as a soft warning
        // rather than escalating to markQueueItemError (which would inflate
        // the failure counter and mislead operators about a real outage).
        try {
          await withSession(async (session) => {
            await session.run(
              `MATCH (s:Snapshot {snap_id: $snapId}) SET s.r2_key = $r2Key`,
              { snapId: existing.snapId, r2Key: key }
            );
          });
          dedupR2Key = key;
          // INV-0012-3 audit row 2/2 — successful upload + back-patch.
          recordR2UploadDecision({
            sourceId: input.sourceId,
            snapId: existing.snapId,
            url: input.url,
            archivePolicy: input.archivePolicy,
            rawCloudPolicy: input.rawCloudPolicy,
            decision: "uploaded",
            rationale: `dedup back-fill path; r2_key=${key}`,
          });
        } catch (setErr) {
          console.warn(
            `[snapshot] dedup r2_key back-patch failed for ${existing.snapId}; ` +
              `r2 object uploaded, retry will back-fill:`,
            setErr instanceof Error ? setErr.message : setErr
          );
          // INV-0012-3 audit row 2/2 — r2 object uploaded but Neo4j SET failed.
          recordR2UploadDecision({
            sourceId: input.sourceId,
            snapId: existing.snapId,
            url: input.url,
            archivePolicy: input.archivePolicy,
            rawCloudPolicy: input.rawCloudPolicy,
            decision: "set_r2_key_failed_neo4j",
            rationale: `dedup back-fill path; ${setErr instanceof Error ? setErr.message : String(setErr)}`,
          });
        }
      } else {
        // INV-0012-3 audit row 2/2 — TOCTOU recheck rejected (concurrent
        // prohibited source linker, or recheck itself threw). r2 object
        // remains orphaned by design (see rationale above for why we do
        // NOT r2Delete here).
        recordR2UploadDecision({
          sourceId: input.sourceId,
          snapId: existing.snapId,
          url: input.url,
          archivePolicy: input.archivePolicy,
          rawCloudPolicy: input.rawCloudPolicy,
          decision: "skipped_toctou",
          rationale: "dedup back-fill path; post-r2Put cross-source policy recheck rejected — r2_key not set",
        });
      }
    }

    markQueueItemDone(input.queueId, existing.snapId, contentHash);
    return {
      snapId: existing.snapId,
      // F-10: use the current-source's linked docId, not the first writer's
      // s.doc_id property on the deduplicated Snapshot (which would be stale
      // across cross-source dedup). `linked` is the doc_id from
      // ensureSourceLinkage's MERGE for THIS source — that is the authoritative
      // Document for this dedup call's source.
      docId: linked,
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
      // INV-0012-3 audit row 1/2 — new-path attempt BEFORE r2Put.
      recordR2UploadDecision({
        sourceId: input.sourceId,
        snapId: actualSnapId,
        url: input.url,
        archivePolicy: input.archivePolicy,
        rawCloudPolicy: input.rawCloudPolicy,
        decision: "attempted",
        rationale: mergeMatchedExisting
          ? "new-path; MERGE matched existing Snapshot"
          : "new-path; first create",
      });
      await r2Put(key, bodyBuf);
      // ADR-0012 INV-0012-3 TOCTOU close (MERGE-matched branch only): if our
      // Snapshot CREATE collided with a concurrent worker, re-check policy
      // after r2Put. If a linker attached a prohibited source between the
      // first check and now, skip the SET so r2_key stays null. See the
      // dedup-backfill path above for the rationale on NOT r2Delete'ing here
      // (avoids wiping a concurrent legitimate re-upload of the same key).
      // A re-check throw is treated as "not allowed" so we fail safe — the
      // prohibited source must never see a SET back-patched r2_key.
      let stillAllowed: boolean;
      if (!mergeMatchedExisting) {
        stillAllowed = true;
      } else {
        try {
          stillAllowed = await allLinkedSourcesAllowRawCloud(actualSnapId);
        } catch (recheckErr) {
          console.warn(
            `[snapshot] new-path post-r2Put policy recheck failed; leaving r2_key=null for safety:`,
            recheckErr instanceof Error ? recheckErr.message : recheckErr
          );
          stillAllowed = false;
        }
      }
      if (stillAllowed) {
        // SET r2_key is best-effort (same rationale as the dedup back-fill
        // path above): a Neo4j failure here is non-fatal because the r2 object
        // exists and the next dedup-matched retry will back-fill via the same
        // idempotent key. Escalating to markQueueItemError would inflate the
        // failure counter for a transient Neo4j blip even though graph + r2
        // are recoverable.
        try {
          await withSession(async (session) => {
            await session.run(
              `MATCH (s:Snapshot {snap_id: $snapId}) SET s.r2_key = $r2Key`,
              { snapId: actualSnapId, r2Key: key }
            );
          });
          r2Key = key;
          // INV-0012-3 audit row 2/2 — successful new-path upload + back-patch.
          recordR2UploadDecision({
            sourceId: input.sourceId,
            snapId: actualSnapId,
            url: input.url,
            archivePolicy: input.archivePolicy,
            rawCloudPolicy: input.rawCloudPolicy,
            decision: "uploaded",
            rationale: `new-path; r2_key=${key}`,
          });
        } catch (setErr) {
          console.warn(
            `[snapshot] new-path r2_key back-patch failed for ${actualSnapId}; ` +
              `r2 object uploaded, retry will back-fill:`,
            setErr instanceof Error ? setErr.message : setErr
          );
          // INV-0012-3 audit row 2/2 — r2 object uploaded, Neo4j SET failed.
          recordR2UploadDecision({
            sourceId: input.sourceId,
            snapId: actualSnapId,
            url: input.url,
            archivePolicy: input.archivePolicy,
            rawCloudPolicy: input.rawCloudPolicy,
            decision: "set_r2_key_failed_neo4j",
            rationale: `new-path; ${setErr instanceof Error ? setErr.message : String(setErr)}`,
          });
        }
      } else {
        // INV-0012-3 audit row 2/2 — TOCTOU recheck rejected on MERGE-matched branch.
        recordR2UploadDecision({
          sourceId: input.sourceId,
          snapId: actualSnapId,
          url: input.url,
          archivePolicy: input.archivePolicy,
          rawCloudPolicy: input.rawCloudPolicy,
          decision: "skipped_toctou",
          rationale: "new-path; MERGE-matched existing snapshot; post-r2Put cross-source policy recheck rejected",
        });
      }
    }
  }

  markQueueItemDone(input.queueId, actualSnapId, contentHash);

  // P2: MERGE race — if another worker created the Snapshot first, actualSnapId !== snapId.
  // Count this as a deduplicated result so processDiscoveryQueue metrics are accurate.
  return { snapId: actualSnapId, docId: actualDocId, contentHash, r2Key, deduplicated: actualSnapId !== snapId };
}

// ---------------------------------------------------------------------------
// processDiscoveryQueue decomposition (PR #25 retro item D).
// The orchestrator was a 300-line monolith doing reclaim + claim + busy-retry
// + per-row heartbeat + fetch + fingerprint. Split into three named helpers
// so each piece is independently readable and its recovery scope is obvious.
// ---------------------------------------------------------------------------

type QueueRow = {
  queue_id: string;
  source_id: string;
  url: string;
  title: string | null;
  published_at: string | null;
};

const STALE_RECLAIM_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const BATCH_SIZE = 100;
const MAX_BUSY_RETRIES = 5;
const BUSY_BACKOFF_MS = 50;

// RFC 9110: 204 No Content and 205 Reset Content MUST NOT include a message body.
const NO_BODY_2XX = new Set([204, 205]);

// P2-10: Reset stale processing rows from crashed workers.
// updated_at is part of the base v6 schema — strftime no-millis format matches
// every writer in this module so lexicographic comparison is sound.
function reclaimStaleRows(db: ReturnType<typeof getDb>): void {
  const threshold = new Date(Date.now() - STALE_RECLAIM_THRESHOLD_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  db.prepare(
    `UPDATE discovery_queue
     SET status = 'pending', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE status = 'processing' AND updated_at < ?`
  ).run(threshold);
}

// P1-5: Atomic row claiming via IMMEDIATE SQLite transaction so two concurrent
// workers cannot claim the same rows. bun:sqlite defaults to DEFERRED, which
// allows another reader to interleave between SELECT and UPDATE; IMMEDIATE
// acquires a write lock at BEGIN so the SELECT+UPDATE block is exclusive.
//
// R5 P2 — Bounded retry on SQLITE_BUSY: BEGIN IMMEDIATE waits for any other
// writer to release first. Without retry, an otherwise healthy worker run
// aborts and processes zero rows when the discovery producer or another
// worker holds a write transaction. We retry a small number of times with
// linear backoff; if contention persists the caller still sees the error
// after the budget.
async function claimBatchWithBusyRetry(
  db: ReturnType<typeof getDb>,
  batchSize: number
): Promise<QueueRow[]> {
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
  try {
    const pending = db
      .prepare(
        `SELECT queue_id, source_id, url, title, published_at
         FROM discovery_queue
         WHERE status = 'pending'
         ORDER BY discovered_at ASC
         LIMIT ?`
      )
      .all(batchSize) as QueueRow[];

    if (pending.length > 0) {
      const ids = pending.map((r) => r.queue_id);
      db.prepare(
        `UPDATE discovery_queue
         SET status = 'processing'${SET_UPDATED_AT}
         WHERE queue_id IN (${ids.map(() => "?").join(",")})`
      ).run(...ids);
    }

    db.prepare("COMMIT").run();
    return pending;
  } catch (err) {
    try { db.prepare("ROLLBACK").run(); } catch { /* ignore rollback errors */ }
    throw err;
  }
}

type RowOutcome = "processed" | "deduplicated" | "error" | "skipped";

// Process one claimed row: re-verify ownership, heartbeat, policy lookup,
// safeFetch, createSnapshotFingerprint. All error paths route through
// markQueueItemError so a per-row failure never aborts the batch. Returns
// the outcome counter the orchestrator should increment.
async function processOneRow(
  db: ReturnType<typeof getDb>,
  row: QueueRow,
  archivePolicyFn: (sourceId: string) => Promise<{
    archivePolicy: ArchivePolicy;
    rawCloudPolicy: RawCloudPolicy;
  }>
): Promise<RowOutcome> {
  // P2-13: Verify the row is still in 'processing' state before doing any
  // outbound work. The stale-reclaim step resets rows to 'pending' after 1h;
  // if another worker claimed and completed the row in the interim, skip to
  // avoid duplicate fetches and redundant graph writes.
  const stillProcessing = db
    .prepare(`SELECT 1 FROM discovery_queue WHERE queue_id = ? AND status = 'processing'`)
    .get(row.queue_id);
  if (!stillProcessing) return "skipped";

  // Heartbeat: touch updated_at before processing so the 1h stale-reclaim
  // does not requeue a still-active row mid-batch.
  db.prepare(
    `UPDATE discovery_queue SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE queue_id = ?`
  ).run(row.queue_id);

  try {
    // row.source_id is canonical src_<ULID> (rss-worker.enqueueDiscoveredItems
    // is the only writer; the FK to source_material_policy enforces it).
    const { archivePolicy, rawCloudPolicy } = await archivePolicyFn(row.source_id);

    // P1-7: Enforce do_not_collect before any outbound fetch.
    if (archivePolicy === "do_not_collect") {
      markQueueItemError(row.queue_id, "policy_do_not_collect");
      return "error";
    }

    const { safeFetch, MAX_BYTES } = await import("../fetch/safe-fetch");
    // P1-2: Use MAX_BYTES.html for document URLs — larger cap than rss (10MB vs 5MB).
    const res = await safeFetch(row.url, { maxBytes: MAX_BYTES.html });

    // P2-12: Require 2xx with non-empty body. Empty payloads must not be
    // fingerprinted (they would all share one hash and pollute dedup state).
    const empty2xx = res.status >= 200 && res.status < 300 && res.body.byteLength === 0;
    if (
      !(res.status >= 200 && res.status < 300) ||
      NO_BODY_2XX.has(res.status) ||
      empty2xx
    ) {
      markQueueItemError(
        row.queue_id,
        empty2xx ? "empty_body" : "http_status",
        `HTTP ${res.status}`
      );
      return "error";
    }

    const mimeType =
      res.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "application/octet-stream";

    // P2-11: Use finalUrl (after redirects) as the canonical URL for snapshot identity.
    const result = await createSnapshotFingerprint({
      sourceId: row.source_id,
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

    return result.deduplicated ? "deduplicated" : "processed";
  } catch (err) {
    // Single marker call site for the per-row path. TypedQueueError carries
    // a specific QueueErrorCode through the throw; any other exception is
    // bucketed as "runtime_error". The marker's WHERE status='processing'
    // would have preserved an inner mark in the prior pattern too, but
    // making the call site singular removes that implicit-safety reliance.
    const errorCode: QueueErrorCode =
      err instanceof TypedQueueError ? err.errorCode : "runtime_error";
    const message = err instanceof Error ? err.message : String(err);
    markQueueItemError(row.queue_id, errorCode, message);
    return "error";
  }
}

export async function processDiscoveryQueue(
  archivePolicyFn: (sourceId: string) => Promise<{
    archivePolicy: ArchivePolicy;
    rawCloudPolicy: RawCloudPolicy;
  }>
): Promise<{ processed: number; deduplicated: number; errors: number }> {
  const db = getDb();

  reclaimStaleRows(db);
  const pending = await claimBatchWithBusyRetry(db, BATCH_SIZE);

  let processed = 0;
  let deduplicated = 0;
  let errors = 0;
  for (const row of pending) {
    const outcome = await processOneRow(db, row, archivePolicyFn);
    if (outcome === "processed") processed++;
    else if (outcome === "deduplicated") deduplicated++;
    else if (outcome === "error") errors++;
    // "skipped" is intentionally uncounted — another worker handled it.
  }

  return { processed, deduplicated, errors };
}
