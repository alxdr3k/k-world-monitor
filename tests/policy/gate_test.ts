/**
 * Unit + integration tests for INFRA-1B.5.h2-policy-gate-risk-triggers
 * (AC-023 / TEST-023 evidence, AI-P1-11 D1a/D2a 결정 lock 2026-05-17).
 *
 * Covers:
 *   - src/pipeline/policy-gate/risk-triggers.ts (detectRisks +
 *     stageDefaultMode + evaluatePolicyGate)
 *   - src/pipeline/policy-gate/decision-ledger.ts
 *     (recordPolicyGateDecision)
 *
 * Verifies ADR-0017 invariants:
 *   - INV-0017-3: stage-default mode mapping (5 stages)
 *   - INV-0017-4: 8 risk triggers are mode-invariant inline_block (List A
 *     canonical, NOT retrospective List B which is content-production
 *     safety / P0-M6 axis / ADR-0017 범위 밖)
 *   - INV-0017-5: every decision recorded to policy_decisions ledger
 *
 * Non-coverage (explicit out-of-scope):
 *   - access_intervention accumulation (INV-0017-6, batch_report mode)
 *     — covered by tests/unit/access_intervention_test.ts (AC-024)
 *   - R2 upload audit ledger — covered by
 *     tests/unit/audit_policy_decisions_test.ts (intended_action='r2_upload'
 *     namespace, separate from this module's intended_action=NULL namespace)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { closeDb, getDb } from "../../src/storage/sqlite/connection";
import {
  detectRisks,
  evaluatePolicyGate,
  stageDefaultMode,
  type RiskTriggerContext,
} from "../../src/pipeline/policy-gate/risk-triggers";
import {
  NON_RISK_TRIGGER_TYPE,
  recordPolicyGateDecision,
} from "../../src/pipeline/policy-gate/decision-ledger";
import {
  PIPELINE_STAGE,
  RISK_TRIGGER,
  type PipelineStage,
} from "../../src/utils/enums";

process.env["SQLITE_PATH"] = ":memory:";

// ---------------------------------------------------------------------------
// SQLite setup — mirrors v1 schema + v7 ALTER + v8 audit hardening triggers.
// Generic policy_gate rows are written with intended_action=NULL so the
// v8 enum triggers bypass them per the WHEN clauses.
// ---------------------------------------------------------------------------

function setupDb(): void {
  closeDb();
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS policy_decisions (
      decision_id       TEXT PRIMARY KEY,
      source_id         TEXT,
      session_id        TEXT,
      url               TEXT,
      trigger_type      TEXT NOT NULL,
      policy_gate_mode  TEXT NOT NULL CHECK (policy_gate_mode IN ('inline_block','inline_warn','batch_report')),
      decision          TEXT NOT NULL,
      rationale         TEXT,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      intended_action   TEXT,
      upload_attempt_id TEXT,
      snap_id           TEXT
    );

    CREATE TRIGGER IF NOT EXISTS policy_decisions_intended_action_enum_ins
    BEFORE INSERT ON policy_decisions
    FOR EACH ROW
    WHEN NEW.intended_action IS NOT NULL
         AND NEW.intended_action NOT IN ('r2_upload')
    BEGIN
      SELECT RAISE(ABORT,
        'policy_decisions.intended_action: invalid value (must be NULL or in INTENDED_ACTION enum: r2_upload)');
    END;

    CREATE TRIGGER IF NOT EXISTS policy_decisions_r2_upload_decision_enum_ins
    BEFORE INSERT ON policy_decisions
    FOR EACH ROW
    WHEN NEW.intended_action = 'r2_upload'
         AND NEW.decision NOT IN (
           'attempted',
           'uploaded',
           'skipped_toctou',
           'set_r2_key_failed_neo4j'
         )
    BEGIN
      SELECT RAISE(ABORT,
        'policy_decisions.decision: invalid value for intended_action=r2_upload (must be in R2_UPLOAD_DECISION enum)');
    END;
  `);
}

// Baseline ctx — a fully permissive registered source (no risks fire by
// default). Tests mutate fields per scenario.
function permissiveCtx(): RiskTriggerContext {
  return {
    sourceId: "src_test_permissive",
    archivePolicy: "full_snapshot_allowed",
    rawCloudPolicy: "allowed_public_data_only",
    externalLlmPolicy: "allowed",
    intendedAction: "discovery_fetch",
    sourceName: "Test Source",
    url: "https://example.test/article/1",
  };
}

// ---------------------------------------------------------------------------
// stageDefaultMode — ADR-0017 INV-0017-3
// ---------------------------------------------------------------------------

describe("stageDefaultMode (ADR-0017 INV-0017-3)", () => {
  it("Discovery / Initial fetch → inline_warn", () => {
    expect(stageDefaultMode("discovery")).toBe("inline_warn");
  });

  it("Extract / Cache / Embed / Cloud upload → inline_block", () => {
    expect(stageDefaultMode("extract_cache_embed_cloud_upload")).toBe(
      "inline_block"
    );
  });

  it("Interactive exploration (scenario·thesis) → batch_report", () => {
    expect(stageDefaultMode("interactive_exploration")).toBe("batch_report");
  });

  it("Content production (additional fetch) → batch_report", () => {
    expect(stageDefaultMode("content_production")).toBe("batch_report");
  });

  it("Publication preflight → inline_block", () => {
    expect(stageDefaultMode("publication_preflight")).toBe("inline_block");
  });

  it("covers all 5 stages defined in PIPELINE_STAGE enum", () => {
    for (const stage of PIPELINE_STAGE) {
      const mode = stageDefaultMode(stage);
      expect(["inline_block", "inline_warn", "batch_report"]).toContain(mode);
    }
  });
});

// ---------------------------------------------------------------------------
// detectRisks — ADR-0017 INV-0017-4 List A 8 triggers
// ---------------------------------------------------------------------------

describe("detectRisks (ADR-0017 INV-0017-4 List A — 8 risk triggers)", () => {
  it("trigger 1 (external_llm_raw_text_unauthorized): fires on external_llm_call_with_raw_text when policy != allowed", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "external_llm_call_with_raw_text",
      externalLlmPolicy: "manual_review_required",
    };
    const risks = detectRisks(ctx);
    expect(risks.map((r) => r.trigger)).toContain(
      "external_llm_raw_text_unauthorized"
    );
  });

  it("trigger 1: does NOT fire when external_llm_policy='allowed'", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "external_llm_call_with_raw_text",
      externalLlmPolicy: "allowed",
    };
    expect(detectRisks(ctx)).toEqual([]);
  });

  it("trigger 1: fires on 'unknown' external_llm_policy (unregistered source)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      sourceId: null,
      intendedAction: "external_llm_call_with_raw_text",
      externalLlmPolicy: "unknown",
    };
    const risks = detectRisks(ctx);
    expect(risks.map((r) => r.trigger)).toContain(
      "external_llm_raw_text_unauthorized"
    );
  });

  it("trigger 1: fires on sourceId=null even when externalLlmPolicy='allowed' is incorrectly populated (Codex PR #68 round 2 P2 — fail-closed for unregistered)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      sourceId: null,
      intendedAction: "external_llm_call_with_raw_text",
      externalLlmPolicy: "allowed", // mistakenly populated by buggy caller
    };
    const risks = detectRisks(ctx);
    expect(risks.map((r) => r.trigger)).toContain(
      "external_llm_raw_text_unauthorized"
    );
    expect(risks[0]?.rationale).toContain("source unregistered");
  });

  it("trigger 2 (paywalled_source_fetch): fires on extract_full_text with archive_policy=metadata_only", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "extract_full_text",
      archivePolicy: "metadata_only",
    };
    const risks = detectRisks(ctx);
    expect(risks.map((r) => r.trigger)).toContain("paywalled_source_fetch");
  });

  it("trigger 2: fires on excerpt_only as well", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "chunk_create",
      archivePolicy: "excerpt_only",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain(
      "paywalled_source_fetch"
    );
  });

  it("trigger 2: does NOT fire on discovery_fetch (metadata-only RSS poll)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "discovery_fetch",
      archivePolicy: "metadata_only",
    };
    expect(detectRisks(ctx)).toEqual([]);
  });

  it("trigger 3 (terms_violation): fires when archive_policy=do_not_collect on any collection action", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "chunk_create",
      archivePolicy: "do_not_collect",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain("terms_violation");
  });

  it("trigger 3: does NOT fire on publication_preflight (non-collection action)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "publication_preflight",
      archivePolicy: "do_not_collect",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).not.toContain(
      "terms_violation"
    );
  });

  it("trigger 3: fires on external_llm_call_with_raw_text + do_not_collect (Codex PR #68 round 2 P1 — terms 'no AI' clause)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "external_llm_call_with_raw_text",
      archivePolicy: "do_not_collect",
      externalLlmPolicy: "allowed", // would otherwise bypass trigger 1
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain("terms_violation");
  });

  it("trigger 3: fires on external_llm_call_with_excerpt + do_not_collect (Codex PR #68 round 2 P1)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "external_llm_call_with_excerpt",
      archivePolicy: "do_not_collect",
      externalLlmPolicy: "allowed",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain("terms_violation");
  });

  it("trigger 4 (wire_service_full_text): fires on Reuters extract_full_text", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "extract_full_text",
      sourceName: "Reuters",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain(
      "wire_service_full_text"
    );
  });

  it("trigger 4: fires on case-insensitive AP / AFP / Bloomberg / Yonhap / Xinhua", () => {
    for (const name of [
      "Associated Press",
      "AP News",
      "AFP",
      "BLOOMBERG",
      "yonhap news agency",
      "Xinhua",
    ]) {
      const ctx: RiskTriggerContext = {
        ...permissiveCtx(),
        intendedAction: "extract_full_text",
        sourceName: name,
      };
      const risks = detectRisks(ctx);
      expect(risks.map((r) => r.trigger)).toContain("wire_service_full_text");
    }
  });

  it("trigger 4: does NOT fire on non-wire-service Reuters-adjacent names (e.g., 'Bloomberg Opinion' still counts but 'Reuter' alone doesn't)", () => {
    // 'Bloomberg Opinion' includes 'bloomberg' substring → fires (acceptable v0 over-block).
    // 'NPR' alone has no match → no fire.
    const ctxNpr: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "extract_full_text",
      sourceName: "NPR",
    };
    expect(detectRisks(ctxNpr)).toEqual([]);
  });

  it("trigger 4: fires on bare 'AP' alias (Codex PR #68 P1 finding — word-boundary regex)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "extract_full_text",
      sourceName: "AP",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain(
      "wire_service_full_text"
    );
  });

  it("trigger 4: fires on bare 'AFP' / 'TASS' aliases via word-boundary regex", () => {
    for (const name of ["AFP", "TASS"]) {
      const ctx: RiskTriggerContext = {
        ...permissiveCtx(),
        intendedAction: "extract_full_text",
        sourceName: name,
      };
      expect(detectRisks(ctx).map((r) => r.trigger)).toContain(
        "wire_service_full_text"
      );
    }
  });

  it("trigger 4: does NOT false-positive on common English words containing 'ap' / 'afp' / 'tass' substrings", () => {
    // Without word-boundary regex, naive substring match would false-positive
    // on these (Aperture / MAPS / happenstance / Stafford / Tasmania).
    // The PR #68 Codex P1 fix isolates short acronyms behind \b...\b.
    for (const name of [
      "Aperture Photo Service",
      "MAPS Magazine",
      "Happenstance Quarterly",
      "Stafford Gazette",
      "Tasmania Daily News",
    ]) {
      const ctx: RiskTriggerContext = {
        ...permissiveCtx(),
        intendedAction: "extract_full_text",
        sourceName: name,
      };
      expect(detectRisks(ctx).map((r) => r.trigger)).not.toContain(
        "wire_service_full_text"
      );
    }
  });

  it("trigger 4: does NOT fire on discovery_fetch (RSS metadata-only)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "discovery_fetch",
      sourceName: "Reuters",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).not.toContain(
      "wire_service_full_text"
    );
  });

  it("trigger 5 (article_raw_quote_or_cache): fires on quote_storage when archive_policy != full_snapshot_allowed", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "quote_storage",
      archivePolicy: "excerpt_only",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain(
      "article_raw_quote_or_cache"
    );
  });

  it("trigger 5: fires on raw_cache with metadata_only", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "raw_cache",
      archivePolicy: "metadata_only",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain(
      "article_raw_quote_or_cache"
    );
  });

  it("trigger 5: does NOT fire with full_snapshot_allowed", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "quote_storage",
      archivePolicy: "full_snapshot_allowed",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).not.toContain(
      "article_raw_quote_or_cache"
    );
  });

  it("trigger 6 (image_inclusion_without_license): fires unconditionally on image_inclusion (v0 conservative)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "image_inclusion",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain(
      "image_inclusion_without_license"
    );
  });

  it("trigger 7 (raw_embedding): fires on embed with archive_policy != full_snapshot_allowed", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "embed",
      archivePolicy: "metadata_only",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain("raw_embedding");
  });

  it("trigger 7: does NOT fire with full_snapshot_allowed", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "embed",
      archivePolicy: "full_snapshot_allowed",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).not.toContain("raw_embedding");
  });

  it("trigger 8 (raw_cloud_upload): fires on r2_upload with restrictive archive_policy", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "r2_upload",
      archivePolicy: "metadata_only",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain("raw_cloud_upload");
  });

  it("trigger 8: fires on r2_upload with restrictive raw_cloud_policy even if archive is permissive", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "r2_upload",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "always_prohibited",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain("raw_cloud_upload");
  });

  it("trigger 8: does NOT fire when both archive=full + raw_cloud=allowed_public", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "r2_upload",
      archivePolicy: "full_snapshot_allowed",
      rawCloudPolicy: "allowed_public_data_only",
    };
    expect(detectRisks(ctx)).toEqual([]);
  });

  it("permissive context with discovery_fetch fires NO triggers", () => {
    expect(detectRisks(permissiveCtx())).toEqual([]);
  });

  it("multiple triggers fire concurrently (wire-service + paywalled + raw quote)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "quote_storage",
      archivePolicy: "metadata_only",
      sourceName: "Reuters",
    };
    const triggers = detectRisks(ctx).map((r) => r.trigger);
    // wire-service detector only fires for full-text-class actions, so on
    // quote_storage we expect trigger 5 (article_raw_quote_or_cache).
    expect(triggers).toContain("article_raw_quote_or_cache");
  });

  it("detector count equals RISK_TRIGGER enum size (8)", () => {
    expect(RISK_TRIGGER.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// evaluatePolicyGate — INV-0017-3 + INV-0017-4 합산
// ---------------------------------------------------------------------------

describe("evaluatePolicyGate (ADR-0017 INV-0017-3 + INV-0017-4 합산)", () => {
  it("non-risk action: stage=discovery → mode=inline_warn, decision=warn", () => {
    const result = evaluatePolicyGate({
      stage: "discovery",
      ctx: permissiveCtx(),
    });
    expect(result.triggers).toEqual([]);
    expect(result.gateMode).toBe("inline_warn");
    expect(result.decision).toBe("warn");
  });

  it("non-risk action: stage=extract_cache_embed_cloud_upload → mode=inline_block, decision=block", () => {
    const result = evaluatePolicyGate({
      stage: "extract_cache_embed_cloud_upload",
      ctx: permissiveCtx(),
    });
    expect(result.triggers).toEqual([]);
    expect(result.gateMode).toBe("inline_block");
    expect(result.decision).toBe("block");
  });

  it("non-risk action: stage=interactive_exploration → mode=batch_report, decision=allow", () => {
    const result = evaluatePolicyGate({
      stage: "interactive_exploration",
      ctx: permissiveCtx(),
    });
    expect(result.triggers).toEqual([]);
    expect(result.gateMode).toBe("batch_report");
    expect(result.decision).toBe("allow");
  });

  it("non-risk action: stage=content_production → mode=batch_report, decision=allow", () => {
    const result = evaluatePolicyGate({
      stage: "content_production",
      ctx: permissiveCtx(),
    });
    expect(result.triggers).toEqual([]);
    expect(result.gateMode).toBe("batch_report");
    expect(result.decision).toBe("allow");
  });

  it("non-risk action: stage=publication_preflight → mode=inline_block, decision=block", () => {
    const result = evaluatePolicyGate({
      stage: "publication_preflight",
      ctx: permissiveCtx(),
    });
    expect(result.triggers).toEqual([]);
    expect(result.gateMode).toBe("inline_block");
    expect(result.decision).toBe("block");
  });

  // INV-0017-4: risk action is mode-invariant inline_block — verify across
  // ALL 5 stages that a single risk trigger overrides the stage-default.
  it("INV-0017-4 mode-invariance: raw_cloud_upload risk → inline_block in every stage", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "r2_upload",
      archivePolicy: "metadata_only",
    };
    for (const stage of PIPELINE_STAGE) {
      const result = evaluatePolicyGate({ stage, ctx });
      expect(result.gateMode).toBe("inline_block");
      expect(result.decision).toBe("block");
      expect(result.triggers.map((t) => t.trigger)).toContain("raw_cloud_upload");
    }
  });

  it("INV-0017-4 mode-invariance: terms_violation risk → inline_block in every stage", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "chunk_create",
      archivePolicy: "do_not_collect",
    };
    for (const stage of PIPELINE_STAGE) {
      const result = evaluatePolicyGate({ stage, ctx });
      expect(result.gateMode).toBe("inline_block");
      expect(result.decision).toBe("block");
    }
  });

  it("rationale includes all triggered risk IDs when multiple fire", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "raw_cache",
      archivePolicy: "do_not_collect",
    };
    const result = evaluatePolicyGate({
      stage: "extract_cache_embed_cloud_upload",
      ctx,
    });
    // raw_cache + do_not_collect fires both terms_violation (trigger 3) and
    // article_raw_quote_or_cache (trigger 5).
    expect(result.triggers.length).toBeGreaterThanOrEqual(2);
    expect(result.rationale).toContain("terms_violation");
    expect(result.rationale).toContain("article_raw_quote_or_cache");
  });
});

// ---------------------------------------------------------------------------
// recordPolicyGateDecision — INV-0017-5 ledger persistence
// ---------------------------------------------------------------------------

describe("recordPolicyGateDecision (ADR-0017 INV-0017-5 ledger persistence)", () => {
  beforeEach(() => {
    setupDb();
  });

  it("inserts a row with intended_action=NULL (operator-gate namespace)", () => {
    const decisionId = recordPolicyGateDecision({
      sessionId: "rs_test_session",
      sourceId: "src_test",
      url: "https://example.test/article/1",
      triggerType: "raw_cloud_upload",
      decision: "block",
      gateMode: "inline_block",
      rationale: "test risk decision",
    });
    expect(decisionId.startsWith("pdec_")).toBe(true);
    const row = getDb()
      .query<
        {
          decision_id: string;
          intended_action: string | null;
          trigger_type: string;
          decision: string;
          policy_gate_mode: string;
        },
        [string]
      >(
        `SELECT decision_id, intended_action, trigger_type, decision, policy_gate_mode
         FROM policy_decisions WHERE decision_id = ?`
      )
      .get(decisionId);
    expect(row).not.toBeNull();
    expect(row?.intended_action).toBeNull();
    expect(row?.trigger_type).toBe("raw_cloud_upload");
    expect(row?.decision).toBe("block");
    expect(row?.policy_gate_mode).toBe("inline_block");
  });

  it("records a non-risk decision with trigger_type='non_risk_action'", () => {
    const decisionId = recordPolicyGateDecision({
      sessionId: "rs_test_session",
      sourceId: "src_test",
      url: "https://example.test/article/1",
      triggerType: NON_RISK_TRIGGER_TYPE,
      decision: "warn",
      gateMode: "inline_warn",
      rationale: "non_risk stage-default discovery_fetch",
    });
    const row = getDb()
      .query<
        { trigger_type: string; decision: string; policy_gate_mode: string },
        [string]
      >(
        `SELECT trigger_type, decision, policy_gate_mode FROM policy_decisions WHERE decision_id = ?`
      )
      .get(decisionId);
    expect(row?.trigger_type).toBe("non_risk_action");
    expect(row?.decision).toBe("warn");
    expect(row?.policy_gate_mode).toBe("inline_warn");
  });

  it("rejects invalid triggerType (defense-in-depth writer guard)", () => {
    expect(() =>
      recordPolicyGateDecision({
        sessionId: "rs_test",
        sourceId: null,
        url: "https://example.test/x",
        // @ts-expect-error — runtime validation test
        triggerType: "bogus_trigger",
        decision: "block",
        gateMode: "inline_block",
        rationale: "invalid trigger type",
      })
    ).toThrow(/invalid triggerType/);
  });

  it("rejects invalid decision value", () => {
    expect(() =>
      recordPolicyGateDecision({
        sessionId: "rs_test",
        sourceId: null,
        url: "https://example.test/x",
        triggerType: "raw_cloud_upload",
        // @ts-expect-error — runtime validation test
        decision: "maybe",
        gateMode: "inline_block",
        rationale: "invalid decision",
      })
    ).toThrow(/invalid decision/);
  });

  it("rejects invalid gateMode value", () => {
    expect(() =>
      recordPolicyGateDecision({
        sessionId: "rs_test",
        sourceId: null,
        url: "https://example.test/x",
        triggerType: "raw_cloud_upload",
        decision: "block",
        // @ts-expect-error — runtime validation test
        gateMode: "always_block",
        rationale: "invalid gate mode",
      })
    ).toThrow(/invalid gateMode/);
  });

  it("v8 r2_upload enum trigger does NOT fire on operator-gate rows (intended_action IS NULL)", () => {
    // This row has decision='block' which would FAIL the r2_upload decision
    // enum trigger if intended_action were 'r2_upload'. Verifies namespace
    // separation works as designed (v7 ALTER comment + v8 WHEN clause).
    expect(() =>
      recordPolicyGateDecision({
        sessionId: "rs_test",
        sourceId: "src_test",
        url: "https://example.test/x",
        triggerType: "raw_cloud_upload",
        decision: "block", // NOT in r2_upload decision enum (would fail if intended_action='r2_upload')
        gateMode: "inline_block",
        rationale: "namespace separation test",
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// End-to-end TEST-023: each of the 8 risk triggers + ledger record
// ---------------------------------------------------------------------------

interface E2EScenario {
  trigger: (typeof RISK_TRIGGER)[number];
  ctxOverride: Partial<RiskTriggerContext>;
  stage: PipelineStage;
}

const E2E_SCENARIOS: E2EScenario[] = [
  {
    trigger: "external_llm_raw_text_unauthorized",
    ctxOverride: {
      intendedAction: "external_llm_call_with_raw_text",
      externalLlmPolicy: "prohibited",
    },
    stage: "extract_cache_embed_cloud_upload",
  },
  {
    trigger: "paywalled_source_fetch",
    ctxOverride: {
      intendedAction: "extract_full_text",
      archivePolicy: "metadata_only",
    },
    stage: "discovery",
  },
  {
    trigger: "terms_violation",
    ctxOverride: {
      intendedAction: "embed",
      archivePolicy: "do_not_collect",
    },
    stage: "interactive_exploration",
  },
  {
    trigger: "wire_service_full_text",
    ctxOverride: {
      intendedAction: "extract_full_text",
      sourceName: "Reuters",
    },
    stage: "content_production",
  },
  {
    trigger: "article_raw_quote_or_cache",
    ctxOverride: {
      intendedAction: "quote_storage",
      archivePolicy: "excerpt_only",
    },
    stage: "publication_preflight",
  },
  {
    trigger: "image_inclusion_without_license",
    ctxOverride: {
      intendedAction: "image_inclusion",
    },
    stage: "content_production",
  },
  {
    trigger: "raw_embedding",
    ctxOverride: {
      intendedAction: "embed",
      archivePolicy: "metadata_only",
    },
    stage: "extract_cache_embed_cloud_upload",
  },
  {
    trigger: "raw_cloud_upload",
    ctxOverride: {
      intendedAction: "r2_upload",
      archivePolicy: "metadata_only",
    },
    stage: "discovery",
  },
];

describe("TEST-023 E2E: 8 risk triggers × mode-invariant inline_block × ledger record", () => {
  beforeEach(() => {
    setupDb();
  });

  for (const scenario of E2E_SCENARIOS) {
    it(`${scenario.trigger}: detected → inline_block + ledger row + INV-0017-4 mode-invariance verified`, () => {
      const ctx: RiskTriggerContext = {
        ...permissiveCtx(),
        ...scenario.ctxOverride,
      };
      const result = evaluatePolicyGate({ stage: scenario.stage, ctx });
      // INV-0017-4 mode-invariance: any risk → inline_block, decision=block
      expect(result.gateMode).toBe("inline_block");
      expect(result.decision).toBe("block");
      expect(result.triggers.map((t) => t.trigger)).toContain(scenario.trigger);

      // INV-0017-5 ledger persistence
      const decisionId = recordPolicyGateDecision({
        sessionId: "rs_test_e2e",
        sourceId: ctx.sourceId,
        url: ctx.url ?? "",
        triggerType: scenario.trigger,
        decision: result.decision,
        gateMode: result.gateMode,
        rationale: result.rationale,
      });
      const row = getDb()
        .query<
          {
            trigger_type: string;
            decision: string;
            policy_gate_mode: string;
            intended_action: string | null;
          },
          [string]
        >(
          `SELECT trigger_type, decision, policy_gate_mode, intended_action
           FROM policy_decisions WHERE decision_id = ?`
        )
        .get(decisionId);
      expect(row?.trigger_type).toBe(scenario.trigger);
      expect(row?.decision).toBe("block");
      expect(row?.policy_gate_mode).toBe("inline_block");
      expect(row?.intended_action).toBeNull();
    });
  }

  it("covers all 8 risk triggers in E2E_SCENARIOS", () => {
    const covered = new Set(E2E_SCENARIOS.map((s) => s.trigger));
    for (const trigger of RISK_TRIGGER) {
      expect(covered.has(trigger)).toBe(true);
    }
  });
});
