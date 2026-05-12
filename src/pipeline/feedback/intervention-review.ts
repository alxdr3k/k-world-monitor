// Intervention review handler — 3-option action (INFRA-1B.6).
// Implements ADR-0018 INV-0018-5:
//   - ignore: marks intervention resolved_ignore, decrements importance_score.
//   - manual_claim: creates ManualClaimEntry via createManualClaimEntry(), marks resolved_manual_claim.
//   - temp_text: stores text in raw_cache_items (SQLite), marks resolved_temp_text.
//
// All resolution options update the AccessIntervention status in Neo4j.

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
        `resolveIntervention: AccessIntervention not found for id='${interventionId}'.`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// SQLite: raw_cache_items for temp_text (ADR-0021 integration).
// ---------------------------------------------------------------------------

function storeTempText(
  interventionId: string,
  text: string,
  sessionId: string
): string {
  const itemId = `rcache_${ulid()}`;
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO raw_cache_items
       (item_id, session_id, source_id, content_type, content_text, created_at, expires_at)
     VALUES (?, ?, ?, 'temp_text', ?, ?, datetime(?, '+7 days'))`
  ).run(itemId, sessionId, interventionId, text, now, now);
  return itemId;
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
    /** Required for temp_text: the raw text snippet to cache. */
    tempText?: string;
    sessionId?: string;
  } = {}
): Promise<ReviewResult> {
  const resolvedAt = new Date().toISOString();

  if (action === "ignore") {
    // Lower importance_score by 0.2 (encourages Pattern 1 policy learning).
    await resolveIntervention(interventionId, "resolved_ignore", resolvedAt, -0.2);
    return { interventionId, action, resolvedAt };
  }

  if (action === "manual_claim") {
    if (!opts.manualClaimInput) {
      throw new Error("manualClaimInput is required for manual_claim action.");
    }
    const record = await createManualClaimEntry({
      ...opts.manualClaimInput,
      interventionId,
    });
    await resolveIntervention(interventionId, "resolved_manual_claim", resolvedAt);
    return { interventionId, action, resolvedAt, manualClaimRecord: record };
  }

  // temp_text
  if (!opts.tempText) {
    throw new Error("tempText is required for temp_text action.");
  }
  const sessionId = opts.sessionId ?? opts.manualClaimInput?.sessionId ?? "unknown";
  const rawCacheItemId = storeTempText(interventionId, opts.tempText, sessionId);
  await resolveIntervention(interventionId, "resolved_temp_text", resolvedAt);
  return { interventionId, action, resolvedAt, rawCacheItemId };
}
