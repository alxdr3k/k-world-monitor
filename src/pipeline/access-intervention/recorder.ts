// AccessIntervention recorder (INFRA-1B.5).
// Creates AccessIntervention Neo4j nodes (INV-0017-6) and links them to Source.
// Severity is computed deterministically by severity.ts (INV-0017-7).
//
// Node ID: `int_<ULID>` (ADR-0011 ID prefix policy).
// Relationship: (Source)-[:HAS_INTERVENTION]->(AccessIntervention)

import { ulid } from "ulid";
import { withSession } from "../../storage/neo4j/connection";
import { computeSeverity, type PolicyResult, type Severity } from "./severity";

export interface InterventionInput {
  sessionId: string;
  sourceId: string;
  url: string;
  sourceName: string;
  attemptedAction: string;
  accessResult: string;
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
  const interventionId = `int_${ulid()}`;
  const severity = computeSeverity({
    policyResult: input.policyResult,
    importanceScore: input.importanceScore,
    relatedAssumptionIds: input.relatedAssumptionIds,
  });
  const now = new Date().toISOString();

  await withSession(async (session) => {
    const tx = session.beginTransaction();
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
           status:                 'unresolved',
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
          importanceScore: input.importanceScore,
          severity,
          fallbackUsedJson: input.fallbackUsed ? JSON.stringify(input.fallbackUsed) : null,
          requestedUserAction: input.requestedUserAction ?? null,
          createdAt: now,
        }
      );

      // Link Source → AccessIntervention.
      await tx.run(
        `MATCH (src:Source {source_id: $sourceId})
         MATCH (i:AccessIntervention {intervention_id: $interventionId})
         CREATE (src)-[:HAS_INTERVENTION]->(i)`,
        { sourceId: input.sourceId, interventionId }
      );

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  });

  return { interventionId, severity };
}
