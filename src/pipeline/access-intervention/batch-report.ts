// Batch report generator for access_interventions (INFRA-1B.5).
// Fetches all unresolved AccessIntervention nodes for a session and
// renders a structured report (AC-024 INV-0017-6).
//
// Report format: severity-bucketed Markdown suitable for operator review.
// HIGH/CRITICAL interventions are flagged as potential cite-check blockers.

import { withSession } from "../../storage/neo4j/connection";
import type { Severity } from "./severity";

export interface InterventionSummary {
  interventionId: string;
  sourceId: string;
  sourceName: string;
  url: string;
  attemptedAction: string;
  accessResult: string;
  policyResult: string;
  severity: Severity;
  whyItMatters: string | null;
  importanceScore: number;
  scenarioId: string | null;
  thesisId: string | null;
  createdAt: string;
}

export interface BatchReport {
  sessionId: string;
  generatedAt: string;
  total: number;
  bySeverity: Record<Severity, InterventionSummary[]>;
  hasBlockers: boolean;  // any CRITICAL or HIGH unresolved intervention
  markdown: string;
}

export async function generateBatchReport(sessionId: string): Promise<BatchReport> {
  const interventions = await withSession(async (session) => {
    const result = await session.run(
      `MATCH (i:AccessIntervention {session_id: $sessionId, status: 'pending_user_review'})
       RETURN
         i.intervention_id  AS intervention_id,
         i.source_id        AS source_id,
         i.source_name      AS source_name,
         i.url              AS url,
         i.attempted_action AS attempted_action,
         i.access_result    AS access_result,
         i.policy_result    AS policy_result,
         i.severity         AS severity,
         i.why_it_matters   AS why_it_matters,
         i.importance_score AS importance_score,
         i.scenario_id      AS scenario_id,
         i.thesis_id        AS thesis_id,
         i.created_at       AS created_at
       ORDER BY i.created_at ASC`,
      { sessionId }
    );
    return result.records.map((r) => ({
      interventionId: r.get("intervention_id") as string,
      sourceId: r.get("source_id") as string,
      sourceName: r.get("source_name") as string,
      url: r.get("url") as string,
      attemptedAction: r.get("attempted_action") as string,
      accessResult: r.get("access_result") as string,
      policyResult: r.get("policy_result") as string,
      severity: r.get("severity") as Severity,
      whyItMatters: r.get("why_it_matters") as string | null,
      importanceScore: r.get("importance_score") as number,
      scenarioId: r.get("scenario_id") as string | null,
      thesisId: r.get("thesis_id") as string | null,
      createdAt: r.get("created_at") as string,
    }));
  });

  const bySeverity: Record<Severity, InterventionSummary[]> = {
    CRITICAL: [],
    HIGH: [],
    MEDIUM: [],
    LOW: [],
  };
  for (const item of interventions) {
    if (Object.hasOwn(bySeverity, item.severity)) {
      bySeverity[item.severity].push(item);
    } else {
      // Unknown severity values (e.g. legacy data) are treated conservatively
      // as HIGH to avoid masking potential blockers. They are bucketed into
      // bySeverity.HIGH so the total and hasBlockers remain consistent.
      bySeverity.HIGH.push(item);
    }
  }

  const total = Object.values(bySeverity).reduce((s, a) => s + a.length, 0);
  const hasBlockers =
    bySeverity.CRITICAL.length > 0 || bySeverity.HIGH.length > 0;
  const generatedAt = new Date().toISOString();

  const markdown = renderMarkdown(sessionId, generatedAt, total, bySeverity, hasBlockers);

  return {
    sessionId,
    generatedAt,
    total,
    bySeverity,
    hasBlockers,
    markdown,
  };
}

function renderMarkdown(
  sessionId: string,
  generatedAt: string,
  total: number,
  bySeverity: Record<Severity, InterventionSummary[]>,
  hasBlockers: boolean
): string {
  const lines: string[] = [
    `# Access Intervention Batch Report`,
    ``,
    `**Session:** ${sessionId}  `,
    `**Generated:** ${generatedAt}  `,
    `**Total unresolved:** ${total}`,
    hasBlockers
      ? `\n> ⚠️ HIGH/CRITICAL interventions present — unresolved items may block publication cite check.`
      : `\n> All interventions are MEDIUM or LOW severity.`,
    ``,
  ];

  for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as Severity[]) {
    const items = bySeverity[sev];
    if (items.length === 0) continue;
    lines.push(`## ${sev} (${items.length})`);
    lines.push(``);
    for (const item of items) {
      lines.push(`### ${item.sourceName}`);
      lines.push(`- **ID:** ${item.interventionId}`);
      lines.push(`- **URL:** ${item.url}`);
      lines.push(`- **Action attempted:** ${item.attemptedAction}`);
      lines.push(`- **Result:** ${item.accessResult}`);
      lines.push(`- **Policy:** ${item.policyResult}`);
      lines.push(`- **Importance:** ${Number(item.importanceScore).toFixed(2)}`);
      if (item.whyItMatters) lines.push(`- **Why it matters:** ${item.whyItMatters}`);
      if (item.scenarioId) lines.push(`- **Scenario:** ${item.scenarioId}`);
      if (item.thesisId) lines.push(`- **Thesis:** ${item.thesisId}`);
      lines.push(`- **Created:** ${item.createdAt}`);
      lines.push(``);
    }
  }

  return lines.join("\n");
}
