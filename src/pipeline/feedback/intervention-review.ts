// Intervention review handler — 3-option action (INFRA-1B.6).
// Implements ADR-0018 INV-0018-5:
//   - ignore: marks intervention resolved_ignore, decrements importance_score.
//   - manual_claim: creates ManualClaimEntry via createManualClaimEntry(), marks resolved_manual_claim.
//   - temp_text: registers the intervention URL in raw_cache_items (SQLite, ADR-0021),
//     marks resolved_temp_text. Raw text is NOT stored (INV-0018-3).
//
// All resolution options update the AccessIntervention status in Neo4j.
// Status guard: only interventions with status 'pending_user_review' can be resolved;
// re-resolving is rejected to prevent conflicting terminal-action writes.

import { ulid } from "ulid";
import { withSession } from "../../storage/neo4j/connection";
import { getDb } from "../../storage/sqlite/connection";
import {
  createManualClaimEntry,
  type ManualClaimInput,
  type ManualClaimRecord,
} from "./manual-claim-entry";

export type ReviewAction = "ignore" | "manual_claim" | "temp_text";

export interface ReviewResult {
  interventionId: string;
  action: ReviewAction;
  resolvedAt: string;
  manualClaimRecord?: ManualClaimRecord;
  rawCacheItemId?: string;
}

// ---------------------------------------------------------------------------
// Neo4j: update AccessIntervention status + resolved_at.
// Precondition: intervention must have status='pending_user_review'.
// Throws if not found or already resolved.
// ---------------------------------------------------------------------------

async function resolveIntervention(
  interventionId: string,
  status: string,
  resolvedAt: string,
  importanceAdjust?: number
): Promise<void> {
  await withSession(async (session) => {
    const setClause =
      importanceAdjust !== undefined
        ? `i.status = $status, i.resolved_at = $resolvedAt,
           i.importance_score = CASE
             WHEN i.importance_score + $adjust < 0 THEN 0.0
             ELSE i.importance_score + $adjust
           END`
        : "i.status = $status, i.resolved_at = $resolvedAt";
    const result = await session.run(
      `MATCH (i:AccessIntervention {intervention_id: $interventionId})
       WHERE i.status = 'pending_user_review'
       SET ${setClause}
       RETURN count(i) AS matched`,
      {
        interventionId,
        status,
        resolvedAt,
        ...(importanceAdjust !== undefined ? { adjust: importanceAdjust } : {}),
      }
    );
    const matched = Number(result.records[0]?.get("matched") ?? 0);
    if (matched === 0) {
      throw new Error(
        `resolveIntervention: AccessIntervention not found or not in pending_user_review state for id='${interventionId}'.`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// SQLite: raw_cache_items for temp_text (ADR-0021 integration).
// Stores the intervention source URL as a cache reference.
// Raw text is NOT persisted (INV-0018-3, ADR-0012 INV-0012-3).
// sessionId is required (FK to research_session; no "unknown" fallback).
// Returns the cache_id, or throws and rolls back on any error.
// ---------------------------------------------------------------------------

function registerTempTextUrl(
  interventionUrl: string,
  sessionId: string
): string {
  const cacheId = `rcache_${ulid()}`;
  const now = new Date().toISOString();
  // expires_at: 7 days from now (DEC-007 ceiling).
  const db = getDb();
  db.prepare(
    `INSERT INTO raw_cache_items
       (cache_id, session_id, url, content_hash, indexed, embedded, expires_at)
     VALUES (?, ?, ?, NULL, 0, 0, datetime(?, '+7 days'))`
  ).run(cacheId, sessionId, interventionUrl, now);
  return cacheId;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export async function reviewIntervention(
  interventionId: string,
  action: ReviewAction,
  opts: {
    /** Required for manual_claim. */
    manualClaimInput?: ManualClaimInput;
    /**
     * Required for temp_text: the source URL associated with the intervention.
     * Raw text is not stored (INV-0018-3).
     */
    interventionUrl?: string;
    /** Required for temp_text: FK to research_session(session_id). */
    sessionId?: string;
  } = {}
): Promise<ReviewResult> {
  const resolvedAt = new Date().toISOString();

  if (action === "ignore") {
    // Lower importance_score by 0.2 (encourages Pattern 1 policy learning).
    // Note: policy_learning_events write is out-of-scope for this slice (ADR-0018 scope.out).
    await resolveIntervention(interventionId, "resolved_ignore", resolvedAt, -0.2);
    return { interventionId, action, resolvedAt };
  }

  if (action === "manual_claim") {
    if (!opts.manualClaimInput) {
      throw new Error("manualClaimInput is required for manual_claim action.");
    }
    // Atomicity: createManualClaimEntry and resolveIntervention are separate Neo4j
    // sessions and cannot be combined into one transaction across Neo4j driver sessions.
    // Strategy: resolve the intervention first; if claim creation fails, the intervention
    // is marked resolved but the claim is absent — the operator can detect this via the
    // missing :RESOLVES edge and re-run. This is preferable to the alternative (orphaned
    // claim with unresolved intervention) because re-resolution is blocked by the status
    // guard; claim-absent state is detectable via graph query.
    await resolveIntervention(interventionId, "resolved_manual_claim", resolvedAt);
    const record = await createManualClaimEntry({
      ...opts.manualClaimInput,
      interventionId,
    });
    return { interventionId, action, resolvedAt, manualClaimRecord: record };
  }

  if (action === "temp_text") {
    if (!opts.interventionUrl) {
      throw new Error("interventionUrl is required for temp_text action.");
    }
    if (!opts.sessionId) {
      throw new Error("sessionId is required for temp_text action (FK to research_session).");
    }
    // Atomicity: perform the SQLite insert inside a transaction. If the Neo4j
    // resolveIntervention call fails, we roll back the SQLite row so no
    // duplicate cache entries accumulate on retry.
    const db = getDb();
    const insertTx = db.transaction((url: string, sid: string) =>
      registerTempTextUrl(url, sid)
    );
    // Run Neo4j update first; only commit SQLite if it succeeds.
    await resolveIntervention(interventionId, "resolved_temp_text", resolvedAt);
    const rawCacheItemId = insertTx(opts.interventionUrl, opts.sessionId);
    return { interventionId, action, resolvedAt, rawCacheItemId };
  }

  // Guard against unknown action values — do not fall through silently.
  throw new Error(
    `reviewIntervention: unknown action '${action as string}'. Must be one of: ignore, manual_claim, temp_text.`
  );
}
