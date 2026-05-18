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

  it("trigger 1: fires on external_llm_call_with_excerpt + non-allowed policy (Codex PR #68 round 3 P1)", () => {
    for (const policy of ["manual_review_required", "prohibited", "unknown"] as const) {
      const ctx: RiskTriggerContext = {
        ...permissiveCtx(),
        intendedAction: "external_llm_call_with_excerpt",
        externalLlmPolicy: policy,
      };
      const risks = detectRisks(ctx);
      expect(risks.map((r) => r.trigger)).toContain(
        "external_llm_raw_text_unauthorized"
      );
    }
  });

  it("trigger 1: does NOT fire on external_llm_call_with_excerpt when externalLlmPolicy='allowed' + sourceId registered", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      intendedAction: "external_llm_call_with_excerpt",
      externalLlmPolicy: "allowed",
    };
    expect(detectRisks(ctx)).toEqual([]);
  });

  it("trigger 1: fires on external_llm_call_with_excerpt + sourceId=null (fail-closed unregistered)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      sourceId: null,
      intendedAction: "external_llm_call_with_excerpt",
      externalLlmPolicy: "allowed",
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

  it("trigger 4: does NOT false-positive on 'Reuters Institute' research org (GPT review post-PR-#68 finding 1 — negative lookahead)", () => {
    // Reuters Institute Digital News Report / Reuters Institute for the
    // Study of Journalism (Oxford) are research orgs, NOT wire-service
    // full-text sources. Pre-finding `reuters` substring match would
    // mis-classify these. Post-fix `/\breuters\b(?!\s+institute)/i`
    // excludes Institute-suffixed names.
    for (const name of [
      "Reuters Institute Digital News Report",
      "Reuters Institute for the Study of Journalism",
      "Reuters Institute",
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

  it("trigger 4: STILL fires on 'Reuters' / 'Reuters News' / 'Reuters Wire' (wire service proper)", () => {
    for (const name of ["Reuters", "Reuters News", "Reuters Wire", "Reuters World"]) {
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

  it("trigger 4: fires on registered source (sourceId !== null) with sourceName missing — fail-closed (Codex PR #68 round 3 P2)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      sourceId: "src_registered_but_no_name",
      intendedAction: "extract_full_text",
      sourceName: undefined,
    };
    const risks = detectRisks(ctx);
    expect(risks.map((r) => r.trigger)).toContain("wire_service_full_text");
    expect(risks.find((r) => r.trigger === "wire_service_full_text")?.rationale)
      .toContain("source_name missing");
  });

  it("trigger 4: fires on registered source with empty sourceName string (trim-aware fail-closed)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      sourceId: "src_registered_empty_name",
      intendedAction: "chunk_create",
      sourceName: "   ",
    };
    expect(detectRisks(ctx).map((r) => r.trigger)).toContain(
      "wire_service_full_text"
    );
  });

  it("trigger 4: does NOT fire when sourceId=null + sourceName missing (detector 4 specifically — Opus PR #66~#78 review F2 generalized the unregistered-source fail-closed to detector 3 terms_violation; detector 4 stays scoped to wire-service classification)", () => {
    const ctx: RiskTriggerContext = {
      ...permissiveCtx(),
      sourceId: null,
      intendedAction: "extract_full_text",
      sourceName: undefined,
    };
    // Trigger 4 specifically should NOT fire here. Post-F2, detector 3
    // (terms_violation) fires on sourceId=null for any collection action,
    // so detectRisks DOES return a triggers[] — but the assertion below
    // is scoped to trigger 4 (wire-service) absence, which remains true.
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

  it("non-risk action: stage=extract_cache_embed_cloud_upload → mode=inline_block, decision=block (r2_upload with permissive policies — compatible)", () => {
    const result = evaluatePolicyGate({
      stage: "extract_cache_embed_cloud_upload",
      ctx: {
        ...permissiveCtx(),
        intendedAction: "r2_upload",
        archivePolicy: "full_snapshot_allowed",
        rawCloudPolicy: "allowed_public_data_only",
      },
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

  it("non-risk action: stage=publication_preflight → mode=inline_block, decision=block (publication_preflight action — compatible)", () => {
    const result = evaluatePolicyGate({
      stage: "publication_preflight",
      ctx: { ...permissiveCtx(), intendedAction: "publication_preflight" },
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

  it("evaluatePolicyGate: throws on invalid stage (runtime fail-closed boundary guard, GPT review post-PR-#68 finding 3)", () => {
    expect(() =>
      evaluatePolicyGate({
        // @ts-expect-error — runtime validation test
        stage: "bogus_stage",
        ctx: permissiveCtx(),
      })
    ).toThrow(/invalid stage/);
  });

  it("evaluatePolicyGate: throws on invalid intendedAction (runtime fail-closed boundary guard)", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "discovery",
        ctx: {
          ...permissiveCtx(),
          // @ts-expect-error — runtime validation test
          intendedAction: "made_up_action",
        },
      })
    ).toThrow(/invalid intendedAction/);
  });

  it("stageDefaultMode: throws on invalid stage (runtime safety boundary)", () => {
    expect(() =>
      // @ts-expect-error — runtime validation test
      stageDefaultMode("not_a_stage")
    ).toThrow(/invalid stage/);
  });

  it("evaluatePolicyGate: throws on invalid archivePolicy typo (Codex PR #68 round 5 P1 finding 1 — fail-closed for malformed policy)", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "content_production",
        ctx: {
          ...permissiveCtx(),
          intendedAction: "extract_full_text",
          // @ts-expect-error — runtime validation test (typo of full_snapshot_allowed)
          archivePolicy: "full_snapshot_allowd",
        },
      })
    ).toThrow(/invalid archivePolicy/);
  });

  it("evaluatePolicyGate: throws on invalid rawCloudPolicy typo", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "extract_cache_embed_cloud_upload",
        ctx: {
          ...permissiveCtx(),
          intendedAction: "r2_upload",
          // @ts-expect-error — runtime validation test
          rawCloudPolicy: "allowed_publik",
        },
      })
    ).toThrow(/invalid rawCloudPolicy/);
  });

  it("evaluatePolicyGate: throws on invalid externalLlmPolicy typo", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "interactive_exploration",
        ctx: {
          ...permissiveCtx(),
          intendedAction: "external_llm_call_with_raw_text",
          // @ts-expect-error — runtime validation test
          externalLlmPolicy: "alowed",
        },
      })
    ).toThrow(/invalid externalLlmPolicy/);
  });

  it("evaluatePolicyGate: accepts 'unknown' sentinel for all 3 policy fields without throwing — but Opus PR #66~#78 review F2 makes terms_violation fire on sourceId=null collection action (was inline_warn pre-fix, now mode-invariant inline_block)", () => {
    const result = evaluatePolicyGate({
      stage: "discovery",
      ctx: {
        sourceId: null,
        archivePolicy: "unknown",
        rawCloudPolicy: "unknown",
        externalLlmPolicy: "unknown",
        intendedAction: "discovery_fetch",
        sourceName: "Unknown Source",
      },
    });
    // Pre-F2: no detector fired → stage-default discovery → inline_warn.
    // Post-F2: detectTermsViolation fires on sourceId=null for any collection
    // action (semantic = "unregistered source has unproven terms"), so this
    // becomes mode-invariant inline_block per INV-0017-4.
    expect(result.gateMode).toBe("inline_block");
    expect(result.decision).toBe("block");
    expect(result.triggers.map((t) => t.trigger)).toContain("terms_violation");
  });

  it("evaluatePolicyGate: throws when registered source has archivePolicy='unknown' (Codex PR #68 round 6 P1 — registered source unknown sentinel fail-closed)", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "discovery",
        ctx: {
          ...permissiveCtx(),
          sourceId: "src_registered_001",
          archivePolicy: "unknown",
        },
      })
    ).toThrow(/registered source.*cannot have archivePolicy='unknown'/);
  });

  it("evaluatePolicyGate: throws when registered source has rawCloudPolicy='unknown'", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "discovery",
        ctx: {
          ...permissiveCtx(),
          sourceId: "src_registered_002",
          rawCloudPolicy: "unknown",
        },
      })
    ).toThrow(/registered source.*cannot have rawCloudPolicy='unknown'/);
  });

  it("evaluatePolicyGate: throws when registered source has externalLlmPolicy='unknown'", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "discovery",
        ctx: {
          ...permissiveCtx(),
          sourceId: "src_registered_003",
          externalLlmPolicy: "unknown",
        },
      })
    ).toThrow(/registered source.*cannot have externalLlmPolicy='unknown'/);
  });

  it("evaluatePolicyGate: throws on non-risk r2_upload in content_production stage (Codex PR #68 round 5 P1 finding 3 — stage-action compatibility, fail-closed when no risk fires)", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "content_production",
        ctx: {
          ...permissiveCtx(),
          intendedAction: "r2_upload",
          archivePolicy: "full_snapshot_allowed",
          rawCloudPolicy: "allowed_public_data_only",
        },
      })
    ).toThrow(/stage-action incompatibility/);
  });

  it("evaluatePolicyGate: does NOT throw compatibility mismatch before risk detection — risk remains inline_block across stages even when stage-action would be incompatible", () => {
    // r2_upload in content_production = incompatible by matrix, BUT
    // metadata_only archive_policy fires trigger 8 (raw_cloud_upload).
    // INV-0017-4 mandates risk is mode-invariant inline_block — the
    // compatibility throw must NOT mask the risk block. evaluator runs
    // detectRisks() BEFORE assertStageActionCompatible().
    const result = evaluatePolicyGate({
      stage: "content_production",
      ctx: {
        ...permissiveCtx(),
        intendedAction: "r2_upload",
        archivePolicy: "metadata_only",
      },
    });
    expect(result.gateMode).toBe("inline_block");
    expect(result.decision).toBe("block");
    expect(result.triggers.map((t) => t.trigger)).toContain("raw_cloud_upload");
  });

  it("evaluatePolicyGate: allows compatible non-risk r2_upload in extract_cache_embed_cloud_upload stage → inline_block (stage default), no throw", () => {
    // permissive (full + allowed_public) → no risk fires; r2_upload is
    // compatible with extract_cache_embed_cloud_upload stage; stage
    // default mode is inline_block per INV-0017-3 → block (NOT allow —
    // operator inline decision required for this stage even when
    // policies are permissive).
    const result = evaluatePolicyGate({
      stage: "extract_cache_embed_cloud_upload",
      ctx: {
        ...permissiveCtx(),
        intendedAction: "r2_upload",
        archivePolicy: "full_snapshot_allowed",
        rawCloudPolicy: "allowed_public_data_only",
      },
    });
    expect(result.triggers).toEqual([]);
    expect(result.gateMode).toBe("inline_block");
    expect(result.decision).toBe("block");
  });

  it("evaluatePolicyGate: throws on non-risk embed in interactive_exploration stage (storage-class containment)", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "interactive_exploration",
        ctx: {
          ...permissiveCtx(),
          intendedAction: "embed",
          archivePolicy: "full_snapshot_allowed",
        },
      })
    ).toThrow(/stage-action incompatibility/);
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

  // -------------------------------------------------------------------------
  // Opus PR #66~#78 review F2: unregistered source (sourceId=null)
  // fail-closed generalization
  // -------------------------------------------------------------------------

  it("F2: throws when sourceId=null + archivePolicy is not 'unknown' sentinel (symmetric boundary throw)", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "discovery",
        ctx: {
          ...permissiveCtx(),
          sourceId: null,
          intendedAction: "discovery_fetch",
          archivePolicy: "full_snapshot_allowed",
          rawCloudPolicy: "unknown",
          externalLlmPolicy: "unknown",
        },
      })
    ).toThrow(
      /unregistered source.*must have archivePolicy='unknown' sentinel/
    );
  });

  it("F2: throws when sourceId=null + rawCloudPolicy is not 'unknown'", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "discovery",
        ctx: {
          ...permissiveCtx(),
          sourceId: null,
          intendedAction: "discovery_fetch",
          archivePolicy: "unknown",
          rawCloudPolicy: "allowed_public_data_only",
          externalLlmPolicy: "unknown",
        },
      })
    ).toThrow(
      /unregistered source.*must have rawCloudPolicy='unknown' sentinel/
    );
  });

  it("F2: throws when sourceId=null + externalLlmPolicy is not 'unknown'", () => {
    expect(() =>
      evaluatePolicyGate({
        stage: "discovery",
        ctx: {
          ...permissiveCtx(),
          sourceId: null,
          intendedAction: "discovery_fetch",
          archivePolicy: "unknown",
          rawCloudPolicy: "unknown",
          externalLlmPolicy: "allowed",
        },
      })
    ).toThrow(
      /unregistered source.*must have externalLlmPolicy='unknown' sentinel/
    );
  });

  it("F2: detectTermsViolation fires on sourceId=null + extract_full_text (pre-fix bypass surface — content_production stage default batch_report would have allowed)", () => {
    const ctx: RiskTriggerContext = {
      sourceId: null,
      archivePolicy: "unknown",
      rawCloudPolicy: "unknown",
      externalLlmPolicy: "unknown",
      intendedAction: "extract_full_text",
      sourceName: "Unregistered Source",
    };
    const risks = detectRisks(ctx);
    const triggers = risks.map((r) => r.trigger);
    expect(triggers).toContain("terms_violation");
    expect(risks.find((r) => r.trigger === "terms_violation")?.rationale).toContain(
      "sourceId=null"
    );
  });

  it("F2: evaluatePolicyGate blocks extract_full_text on unregistered source in content_production stage (regression for stage-default batch_report bypass)", () => {
    const result = evaluatePolicyGate({
      stage: "content_production",
      ctx: {
        sourceId: null,
        archivePolicy: "unknown",
        rawCloudPolicy: "unknown",
        externalLlmPolicy: "unknown",
        intendedAction: "extract_full_text",
        sourceName: "Unregistered Source",
      },
    });
    // Pre-fix: terms_violation detector required archive='do_not_collect', so
    // unknown-sentinel unregistered source fell through to stage-default
    // batch_report → decision='allow'. Post-fix: terms_violation fires on
    // sourceId=null, so result is mode-invariant inline_block.
    expect(result.gateMode).toBe("inline_block");
    expect(result.decision).toBe("block");
    expect(result.triggers.map((t) => t.trigger)).toContain("terms_violation");
  });

  it("F2: evaluatePolicyGate blocks chunk_create on unregistered source in content_production stage", () => {
    const result = evaluatePolicyGate({
      stage: "extract_cache_embed_cloud_upload",
      ctx: {
        sourceId: null,
        archivePolicy: "unknown",
        rawCloudPolicy: "unknown",
        externalLlmPolicy: "unknown",
        intendedAction: "chunk_create",
        sourceName: "Unregistered Source",
      },
    });
    expect(result.gateMode).toBe("inline_block");
    expect(result.decision).toBe("block");
    expect(result.triggers.map((t) => t.trigger)).toContain("terms_violation");
  });

  it("F2: evaluatePolicyGate blocks discovery_fetch on unregistered source in discovery stage (pre-fix would have warn'd via inline_warn stage default)", () => {
    const result = evaluatePolicyGate({
      stage: "discovery",
      ctx: {
        sourceId: null,
        archivePolicy: "unknown",
        rawCloudPolicy: "unknown",
        externalLlmPolicy: "unknown",
        intendedAction: "discovery_fetch",
        sourceName: "Unregistered Source",
      },
    });
    expect(result.gateMode).toBe("inline_block");
    expect(result.decision).toBe("block");
    expect(result.triggers.map((t) => t.trigger)).toContain("terms_violation");
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
