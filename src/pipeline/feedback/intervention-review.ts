// Intervention review handler — 3-option action (INFRA-1B.6).
// Implements ADR-0018 INV-0018-5:
//   - ignore: marks intervention resolved_ignore, decrements importance_score.
//   - manual_claim: creates ManualClaimEntry via createManualClaimEntry(), marks resolved_manual_claim.
//   - temp_text: loads the intervention's source URL from Neo4j, registers it in raw_cache_items
//     (SQLite, ADR-0021), marks resolved_temp_text. Raw text is NOT stored (INV-0018-3).
//
// All resolution options update the AccessIntervention status in Neo4j.
// Status guard: only interventions with status 'pending_user_review' can be resolved;
// re-resolving is rejected to prevent conflicting terminal-action writes.
//
// Ordering invariant:
//   manual_claim — intervention context (status, provenance) is fetched first to guard
//     against creating claims for already-resolved interventions. Claim is created BEFORE
//     the status is transitioned; if resolve fails the intervention stays pending and retryable.
//   temp_text — intervention context is fetched first (same guard). SQLite cache row is
//     inserted BEFORE resolve; if resolve fails the cache row is deleted (compensation)
//     so no orphan rows accumulate.

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

interface InterventionContext {
  status: string;
  sessionId: string;
  sourceId: string;
  url: string;
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
// Neo4j: fetch intervention context (status, provenance) for pre-validation.
// Loaded before any side effects (claim creation, cache insert) so already-resolved
// interventions are rejected without mutating Neo4j or SQLite.
// Provenance fields (sessionId, sourceId, url) are used to keep ManualClaimEntry
// and raw_cache_items data consistent with the AccessIntervention they resolve.
// ---------------------------------------------------------------------------

async function fetchInterventionContext(interventionId: string): Promise<InterventionContext> {
  return withSession(async (session) => {
    const result = await session.run(
      `MATCH (i:AccessIntervention {intervention_id: $interventionId})
       RETURN i.status AS status, i.session_id AS sessionId, i.source_id AS sourceId, i.url AS url`,
      { interventionId }
    );
    const record = result.records[0];
    if (!record) {
      throw new Error(
        `reviewIntervention: AccessIntervention not found for id='${interventionId}'.`
      );
    }
    return {
      status: record.get("status") as string,
      sessionId: record.get("sessionId") as string,
      sourceId: record.get("sourceId") as string,
      url: record.get("url") as string,
    };
  });
}

// ---------------------------------------------------------------------------
// SQLite: raw_cache_items for temp_text (ADR-0021 integration).
// Stores the intervention source URL (loaded from Neo4j) as a cache reference.
// Raw text is NOT persisted (INV-0018-3, ADR-0012 INV-0012-3).
// Returns the cache_id, or throws on any error.
// ---------------------------------------------------------------------------

function registerTempTextUrl(
  interventionUrl: string,
  sessionId: string
): string {
  const cacheId = `rcache_${ulid()}`;
  const now = new Date().toISOString();
  const db = getDb();
  // Precondition: raw_cache_items.session_id is a FK to research_session.
  // Verify the parent row exists to surface a clear error instead of a cryptic FK violation.
  const sessionRow = db
    .prepare("SELECT session_id FROM research_session WHERE session_id = ?")
    .get(sessionId);
  if (!sessionRow) {
    throw new Error(
      `registerTempTextUrl: research_session not found for session_id='${sessionId}'. ` +
      `Ensure the session is initialized in SQLite before resolving interventions via temp_text.`
    );
  }
  // expires_at: 7 days from now (DEC-007 ceiling).
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
    // Load intervention context before creating any Neo4j nodes:
    // 1. Reject already-resolved interventions so we don't create orphan claims.
    // 2. Override provenance fields (sessionId, sourceId, url) from the intervention
    //    record so the ManualClaimEntry is consistent with the AccessIntervention it resolves.
    const ctx = await fetchInterventionContext(interventionId);
    if (ctx.status !== "pending_user_review") {
      throw new Error(
        `reviewIntervention: intervention '${interventionId}' is not reviewable (status='${ctx.status}').`
      );
    }
    const record = await createManualClaimEntry({
      ...opts.manualClaimInput,
      sessionId: ctx.sessionId,
      sourceId: ctx.sourceId,
      url: ctx.url,
      // Override canonicalUrl to match the intervention's source URL for provenance consistency.
      canonicalUrl: ctx.url,
      interventionId,
    });
    // Compensation: if resolveIntervention fails after claim creation, delete the claim
    // so retries do not accumulate duplicate ManualClaimEntry nodes. Mirrors temp_text pattern.
    try {
      await resolveIntervention(interventionId, "resolved_manual_claim", resolvedAt);
    } catch (resolveErr) {
      try {
        await withSession(async (session) => {
          await session.run(
            `MATCH (m:ManualClaimEntry {manual_claim_id: $id}) DETACH DELETE m`,
            { id: record.manualClaimId }
          );
        });
      } catch {
        // swallow cleanup error — original resolve error is authoritative
      }
      throw resolveErr;
    }
    return { interventionId, action, resolvedAt, manualClaimRecord: record };
  }

  if (action === "temp_text") {
    // Load intervention context for:
    // 1. Pending-state pre-check — avoids creating SQLite rows for already-resolved interventions.
    // 2. URL provenance — cache entry must use the intervention's own source URL.
    // 3. Session consistency — cache row must belong to the intervention's session.
    const ctx = await fetchInterventionContext(interventionId);
    if (ctx.status !== "pending_user_review") {
      throw new Error(
        `reviewIntervention: intervention '${interventionId}' is not reviewable (status='${ctx.status}').`
      );
    }
    // SQLite-first: insert cache row before resolving so a Neo4j failure leaves the
    // intervention pending and retryable. Delete the row (compensate) on resolve failure
    // so orphan cache entries don't accumulate. Wrap the delete in try/catch so a cleanup
    // failure does not mask the original resolve error.
    const rawCacheItemId = registerTempTextUrl(ctx.url, ctx.sessionId);
    try {
      await resolveIntervention(interventionId, "resolved_temp_text", resolvedAt);
    } catch (resolveErr) {
      try {
        getDb().prepare("DELETE FROM raw_cache_items WHERE cache_id = ?").run(rawCacheItemId);
      } catch {
        // swallow cleanup error — original resolve error is authoritative
      }
      throw resolveErr;
    }
    return { interventionId, action, resolvedAt, rawCacheItemId };
  }

  // Guard against unknown action values — do not fall through silently.
  throw new Error(
    `reviewIntervention: unknown action '${action as string}'. Must be one of: ignore, manual_claim, temp_text.`
  );
}
