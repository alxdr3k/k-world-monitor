/**
 * Unit tests for access_interventions (INFRA-1B.5).
 * Tests: severity.ts (pure), recorder.ts (Neo4j mocked), batch-report.ts (Neo4j mocked).
 * AC-024.
 */

import { describe, it, expect, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock Neo4j withSession.
// ---------------------------------------------------------------------------

type SessionFn<T> = (session: unknown) => Promise<T>;

const neo4jRuns: Array<{ query: string; params: Record<string, unknown> }> = [];
let batchQueryResult: Array<Record<string, unknown>> = [];

mock.module("../../src/storage/neo4j/connection", () => ({
  withSession: async <T>(fn: SessionFn<T>): Promise<T> => {
    const tx = {
      run: async (query: string, params: Record<string, unknown>) => {
        neo4jRuns.push({ query, params });
        // Return a mock "linked=1" row for the HAS_INTERVENTION link query so the
        // Source-missing guard passes in unit tests (Source nodes are not in this mock).
        if (query.includes("HAS_INTERVENTION") && query.includes("RETURN count")) {
          return { records: [{ get: (_k: string) => 1 }] };
        }
        return { records: [] };
      },
      commit: async () => {},
      rollback: async () => {},
    };
    const session = {
      beginTransaction: () => tx,
      run: async (query: string, params: Record<string, unknown>) => {
        neo4jRuns.push({ query, params });
        // Return mock data for batch report queries.
        return {
          records: batchQueryResult.map((row) => ({
            get: (key: string) => row[key] ?? null,
          })),
        };
      },
    };
    return fn(session);
  },
}));

import { computeSeverity } from "../../src/pipeline/access-intervention/severity";
import { recordIntervention, type InterventionInput } from "../../src/pipeline/access-intervention/recorder";
import { generateBatchReport } from "../../src/pipeline/access-intervention/batch-report";

// ---------------------------------------------------------------------------
// severity.ts — pure function, no mocks needed.
// ---------------------------------------------------------------------------

describe("computeSeverity — inline_block", () => {
  it("LOW importance → HIGH", () => {
    expect(computeSeverity({ gateMode: "inline_block", importanceScore: 0.2 })).toBe("HIGH");
  });
  it("MID importance → HIGH", () => {
    expect(computeSeverity({ gateMode: "inline_block", importanceScore: 0.5 })).toBe("HIGH");
  });
  it("HIGH importance → CRITICAL", () => {
    expect(computeSeverity({ gateMode: "inline_block", importanceScore: 0.8 })).toBe("CRITICAL");
  });
  it("assumption link elevates HIGH → CRITICAL", () => {
    expect(
      computeSeverity({
        gateMode: "inline_block",
        importanceScore: 0.2,
        relatedAssumptionIds: ["assum_001"],
      })
    ).toBe("CRITICAL");
  });
});

describe("computeSeverity — inline_warn", () => {
  it("LOW importance → LOW", () => {
    expect(computeSeverity({ gateMode: "inline_warn", importanceScore: 0.1 })).toBe("LOW");
  });
  it("MID importance → MEDIUM", () => {
    expect(computeSeverity({ gateMode: "inline_warn", importanceScore: 0.5 })).toBe("MEDIUM");
  });
  it("HIGH importance → HIGH", () => {
    expect(computeSeverity({ gateMode: "inline_warn", importanceScore: 0.9 })).toBe("HIGH");
  });
  it("assumption link elevates LOW → MEDIUM", () => {
    expect(
      computeSeverity({
        gateMode: "inline_warn",
        importanceScore: 0.1,
        relatedAssumptionIds: ["assum_002"],
      })
    ).toBe("MEDIUM");
  });
});

describe("computeSeverity — batch_report", () => {
  it("any importance → LOW or MEDIUM", () => {
    expect(computeSeverity({ gateMode: "batch_report", importanceScore: 0.1 })).toBe("LOW");
    expect(computeSeverity({ gateMode: "batch_report", importanceScore: 0.5 })).toBe("LOW");
    expect(computeSeverity({ gateMode: "batch_report", importanceScore: 0.9 })).toBe("MEDIUM");
  });
  it("assumption link elevates LOW → MEDIUM for batch_report", () => {
    expect(
      computeSeverity({
        gateMode: "batch_report",
        importanceScore: 0.1,
        relatedAssumptionIds: ["assum_003"],
      })
    ).toBe("MEDIUM");
  });
});

describe("computeSeverity — edge cases", () => {
  it("clamps importanceScore below 0 to 0 bucket", () => {
    expect(computeSeverity({ gateMode: "inline_warn", importanceScore: -1 })).toBe("LOW");
  });
  it("clamps importanceScore above 1 to high bucket", () => {
    expect(computeSeverity({ gateMode: "inline_warn", importanceScore: 2 })).toBe("HIGH");
  });
  it("empty relatedAssumptionIds does not elevate", () => {
    expect(
      computeSeverity({
        gateMode: "inline_warn",
        importanceScore: 0.1,
        relatedAssumptionIds: [],
      })
    ).toBe("LOW");
  });
  it("severity ceiling is CRITICAL even with assumption link", () => {
    // inline_block HIGH bucket = CRITICAL → elevate → still CRITICAL
    expect(
      computeSeverity({
        gateMode: "inline_block",
        importanceScore: 0.9,
        relatedAssumptionIds: ["assum_004"],
      })
    ).toBe("CRITICAL");
  });
});

// ---------------------------------------------------------------------------
// recorder.ts — Neo4j mocked.
// ---------------------------------------------------------------------------

function baseInput(): InterventionInput {
  return {
    sessionId: "sess_TEST",
    sourceId: "src_TEST001",
    url: "https://example.com/blocked",
    sourceName: "Example Source",
    attemptedAction: "fetch_full_text",
    accessResult: "403_forbidden",
    gateMode: "inline_block",
    policyResult: "manual_only",
    importanceScore: 0.8,
  };
}

describe("recordIntervention", () => {
  it("returns interventionId with aci_ prefix and computed severity", async () => {
    neo4jRuns.length = 0;
    const result = await recordIntervention(baseInput());
    expect(result.interventionId).toMatch(/^aci_/);
    expect(result.severity).toBe("CRITICAL"); // inline_block + 0.8 = CRITICAL
  });

  it("writes CREATE AccessIntervention and HAS_INTERVENTION queries", async () => {
    neo4jRuns.length = 0;
    await recordIntervention(baseInput());
    const createQ = neo4jRuns.find((r) => r.query.includes("CREATE (i:AccessIntervention"));
    const linkQ = neo4jRuns.find((r) => r.query.includes("HAS_INTERVENTION"));
    expect(createQ).toBeTruthy();
    expect(linkQ).toBeTruthy();
  });

  it("stores correct session_id and source_id in params", async () => {
    neo4jRuns.length = 0;
    await recordIntervention(baseInput());
    const createQ = neo4jRuns.find((r) => r.query.includes("CREATE (i:AccessIntervention"))!;
    expect(createQ.params["sessionId"]).toBe("sess_TEST");
    expect(createQ.params["sourceId"]).toBe("src_TEST001");
  });

  it("stores status=pending_user_review by default (in query text)", async () => {
    neo4jRuns.length = 0;
    await recordIntervention(baseInput());
    const createQ = neo4jRuns.find((r) => r.query.includes("CREATE (i:AccessIntervention"))!;
    expect(createQ.query).toContain("'pending_user_review'");
  });

  it("serializes fallbackUsed to JSON string", async () => {
    neo4jRuns.length = 0;
    await recordIntervention({ ...baseInput(), fallbackUsed: { used: "web_search", query: "test" } });
    const createQ = neo4jRuns.find((r) => r.query.includes("CREATE (i:AccessIntervention"))!;
    const json = createQ.params["fallbackUsedJson"] as string;
    expect(JSON.parse(json)).toEqual({ used: "web_search", query: "test" });
  });

  it("passes null for optional fields when not provided", async () => {
    neo4jRuns.length = 0;
    await recordIntervention(baseInput());
    const createQ = neo4jRuns.find((r) => r.query.includes("CREATE (i:AccessIntervention"))!;
    expect(createQ.params["scenarioId"]).toBeNull();
    expect(createQ.params["thesisId"]).toBeNull();
    expect(createQ.params["relatedQuery"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// batch-report.ts — Neo4j mocked to return intervention records.
// ---------------------------------------------------------------------------

describe("generateBatchReport", () => {
  it("returns empty report when no unresolved interventions", async () => {
    batchQueryResult = [];
    neo4jRuns.length = 0;
    const report = await generateBatchReport("sess_EMPTY");
    expect(report.total).toBe(0);
    expect(report.hasBlockers).toBe(false);
    expect(report.bySeverity.CRITICAL).toHaveLength(0);
    expect(report.bySeverity.HIGH).toHaveLength(0);
  });

  it("hasBlockers=true when CRITICAL intervention present", async () => {
    batchQueryResult = [
      {
        intervention_id: "int_001",
        source_id: "src_001",
        source_name: "Blocked Source",
        url: "https://example.com",
        attempted_action: "fetch",
        access_result: "403",
        policy_result: "inline_block",
        severity: "CRITICAL",
        why_it_matters: null,
        importance_score: 0.9,
        scenario_id: null,
        thesis_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const report = await generateBatchReport("sess_CRIT");
    expect(report.hasBlockers).toBe(true);
    expect(report.bySeverity.CRITICAL).toHaveLength(1);
    expect(report.total).toBe(1);
  });

  it("hasBlockers=true when HIGH intervention present", async () => {
    batchQueryResult = [
      {
        intervention_id: "int_002",
        source_id: "src_002",
        source_name: "High Source",
        url: "https://example.com/high",
        attempted_action: "embed",
        access_result: "policy_block",
        policy_result: "inline_block",
        severity: "HIGH",
        why_it_matters: "Key data source",
        importance_score: 0.7,
        scenario_id: "scen_001",
        thesis_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const report = await generateBatchReport("sess_HIGH");
    expect(report.hasBlockers).toBe(true);
    expect(report.bySeverity.HIGH).toHaveLength(1);
  });

  it("hasBlockers=false for MEDIUM/LOW only", async () => {
    batchQueryResult = [
      {
        intervention_id: "int_003",
        source_id: "src_003",
        source_name: "Low Source",
        url: "https://example.com/low",
        attempted_action: "warn",
        access_result: "warn",
        policy_result: "batch_report",
        severity: "LOW",
        why_it_matters: null,
        importance_score: 0.2,
        scenario_id: null,
        thesis_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const report = await generateBatchReport("sess_LOW");
    expect(report.hasBlockers).toBe(false);
  });

  it("markdown contains intervention_id and source name", async () => {
    batchQueryResult = [
      {
        intervention_id: "int_MARK001",
        source_id: "src_mark",
        source_name: "Markdown Source",
        url: "https://example.com/md",
        attempted_action: "fetch",
        access_result: "403",
        policy_result: "inline_block",
        severity: "HIGH",
        why_it_matters: "Critical for analysis",
        importance_score: 0.75,
        scenario_id: null,
        thesis_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const report = await generateBatchReport("sess_MD");
    expect(report.markdown).toContain("int_MARK001");
    expect(report.markdown).toContain("Markdown Source");
    expect(report.markdown).toContain("Critical for analysis");
    expect(report.markdown).toContain("## HIGH");
  });

  it("sessionId is echoed in the report", async () => {
    batchQueryResult = [];
    const report = await generateBatchReport("sess_ECHO123");
    expect(report.sessionId).toBe("sess_ECHO123");
    expect(report.markdown).toContain("sess_ECHO123");
  });
});
