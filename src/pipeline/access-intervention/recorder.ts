// AccessIntervention recorder (INFRA-1B.5).
// Creates AccessIntervention Neo4j nodes (INV-0017-6) and links them to Source.
// Severity is computed deterministically by severity.ts (INV-0017-7).
//
// Node ID: `aci_<ULID>` (ADR-0011 ID prefix policy; ids.ts AccessIntervention → "aci_").
// Relationship: (Source)-[:HAS_INTERVENTION]->(AccessIntervention)

import { ulid } from "ulid";
import { withSession } from "../../storage/neo4j/connection";
import { computeSeverity, type GateMode, type PolicyResult, type Severity } from "./severity";
import { type AccessResult } from "../../utils/enums";

export interface InterventionInput {
  sessionId: string;
  sourceId: string;
  url: string;
  sourceName: string;
  attemptedAction: string;
  accessResult: AccessResult;
  /** Gate mode: determines severity and inline vs batch disposition. */
  gateMode: GateMode;
  /** Canonical policy outcome for this source (manual_only | metadata_only | excluded). */
  policyResult: PolicyResult;
  importanceScore: number;
  scenarioId?: string;
  thesisId?: string;
  relatedQuery?: string;
  whyItMatters?: string;
  relatedAssumptionIds?: string[];
  fallbackUsed?: Record<string, unknown>;
  requestedUserAction?: string;
}

export interface InterventionRecord {
  interventionId: string;
  severity: Severity;
}

export async function recordIntervention(
  input: InterventionInput
): Promise<InterventionRecord> {
  const interventionId = `aci_${ulid()}`;
  // Clamp importanceScore to [0, 1] before persistence so the stored value
  // is consistent with the severity computation (computeSeverity also clamps).
  // Non-finite values (NaN, ±Infinity) are stored as 0 to avoid invalid DB data.
  const importanceScore = Number.isFinite(input.importanceScore)
    ? Math.max(0, Math.min(1, input.importanceScore))
    : 0;
  const severity = computeSeverity({
    gateMode: input.gateMode,
    importanceScore,
    relatedAssumptionIds: input.relatedAssumptionIds,
  });
  const now = new Date().toISOString();

  await withSession(async (session) => {
    const tx = session.beginTransaction();
    let rolledBack = false;
    let commitAttempted = false;
    try {
      await tx.run(
        `CREATE (i:AccessIntervention {
           intervention_id:        $interventionId,
           session_id:             $sessionId,
           source_id:              $sourceId,
           scenario_id:            $scenarioId,
           thesis_id:              $thesisId,
           url:                    $url,
           source_name:            $sourceName,
           attempted_action:       $attemptedAction,
           access_result:          $accessResult,
           policy_result:          $policyResult,
           related_query:          $relatedQuery,
           why_it_matters:         $whyItMatters,
           importance_score:       $importanceScore,
           severity:               $severity,
           fallback_used_json:     $fallbackUsedJson,
           requested_user_action:  $requestedUserAction,
           status:                 'pending_user_review',
           created_at:             $createdAt,
           resolved_at:            null
         })`,
        {
          interventionId,
          sessionId: input.sessionId,
          sourceId: input.sourceId,
          scenarioId: input.scenarioId ?? null,
          thesisId: input.thesisId ?? null,
          url: input.url,
          sourceName: input.sourceName,
          attemptedAction: input.attemptedAction,
          accessResult: input.accessResult,
          policyResult: input.policyResult,
          relatedQuery: input.relatedQuery ?? null,
          whyItMatters: input.whyItMatters ?? null,
          importanceScore,
          severity,
          fallbackUsedJson: input.fallbackUsed ? JSON.stringify(input.fallbackUsed) : null,
          requestedUserAction: input.requestedUserAction ?? null,
          createdAt: now,
        }
      );

      // Link Source → AccessIntervention.
      // Use a subquery count check to verify Source exists before committing;
      // if Source is missing the transaction is rolled back to avoid orphan nodes.
      const linkResult = await tx.run(
        `MATCH (src:Source {source_id: $sourceId})
         MATCH (i:AccessIntervention {intervention_id: $interventionId})
         CREATE (src)-[:HAS_INTERVENTION]->(i)
         RETURN count(src) AS linked`,
        { sourceId: input.sourceId, interventionId }
      );
      const linked = (linkResult.records[0]?.get("linked") as number | undefined) ?? 0;
      if (Number(linked) === 0) {
        rolledBack = true;
        await tx.rollback();
        throw new Error(
          `recordIntervention: Source node not found for sourceId='${input.sourceId}'. ` +
          `AccessIntervention '${interventionId}' not committed.`
        );
      }

      commitAttempted = true;
      await tx.commit();
    } catch (err) {
      // Only rollback if commit was not yet attempted. Neo4j transactions
      // cannot be rolled back after commit() is called (even if commit fails),
      // so attempting rollback on a commit-path failure would throw a secondary
      // error masking the original.
      if (!rolledBack && !commitAttempted) {
        await tx.rollback();
      }
      throw err;
    }
  });

  return { interventionId, severity };
}
