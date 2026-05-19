/**
 * tests/policy/llm_routing_config_test.ts
 *
 * Operator decision D3 (2026-05-18) — pure config/policy validator tests for
 * ADR-0023 INV-0023-2 / INV-0023-3 / INV-0023-5.
 *
 * Two test classes:
 *   1. Integration: the live `data/llm_routing.yaml` passes all three
 *      assertions (canonical lock).
 *   2. Unit: synthetic configs cover positive + negative cases per assertion.
 */

import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import {
  loadLlmRoutingConfig,
  assertTier0VendorRoles,
  assertTiersCapabilityCanonical,
  assertGoogleScopeIsTier3Only,
  checkLlmRoutingConfig,
  FORBIDDEN_TIER_PRICE_AXIS_KEYS,
  FORBIDDEN_CAPABILITY_VALUE_TOKENS,
  NON_GOOGLE_TIERS,
  GOOGLE_REQUIRED_TIER,
  ALLOWED_TIER3_GOOGLE_ROLES,
  TIER0_OPENAI_REQUIRED_EFFORT,
  TIER0_ANTHROPIC_ALLOWED_EFFORTS,
  LlmRoutingConfigError,
  type LlmRoutingConfig,
} from "../../scripts/check-llm-routing-config";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const LIVE_YAML = join(REPO_ROOT, "data", "llm_routing.yaml");

// ---------------------------------------------------------------------------
// Integration — live data/llm_routing.yaml
// ---------------------------------------------------------------------------

describe("data/llm_routing.yaml — live config integration", () => {
  it("loads as a valid LlmRoutingConfig", () => {
    const config = loadLlmRoutingConfig(LIVE_YAML);
    expect(config.vendors).toBeDefined();
    expect(config.tiers).toBeDefined();
  });

  it("satisfies INV-0023-2 (Tier 0 vendor role lock)", () => {
    const config = loadLlmRoutingConfig(LIVE_YAML);
    expect(() => assertTier0VendorRoles(config)).not.toThrow();
  });

  it("satisfies INV-0023-3 (tier mapping = capability, no price axis)", () => {
    const config = loadLlmRoutingConfig(LIVE_YAML);
    expect(() => assertTiersCapabilityCanonical(config)).not.toThrow();
  });

  it("satisfies INV-0023-5 (Google scope = Tier 3 only)", () => {
    const config = loadLlmRoutingConfig(LIVE_YAML);
    expect(() => assertGoogleScopeIsTier3Only(config)).not.toThrow();
  });

  it("checkLlmRoutingConfig aggregate entry passes on live YAML", () => {
    expect(() => checkLlmRoutingConfig(LIVE_YAML)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Synthetic configs — fixture builder
// ---------------------------------------------------------------------------

function baseConfig(): LlmRoutingConfig {
  return {
    vendors: {
      openai: { role: "default_llm_vendor", required: true },
      anthropic: { role: "cross_vendor_review_and_domain_override", required: true },
      google: { role: "search_grounding_optional_and_tier3_fallback", required: false },
    },
    tiers: {
      tier_0: {
        capability: "frontier_reasoning_with_extended_thinking",
        used_in: ["scenario_validate_adversarial_pass"],
        openai: { model: "gpt-5.5-pro", effort: "extended_thinking", role: "default" },
        anthropic: { model: "claude-opus-4-7", effort: "xhigh", role: "cross_vendor_review_only" },
        google: { role: "disabled" },
      },
      tier_1: {
        capability: "high_reasoning_primary_composer",
        used_in: ["scenario_composer"],
        openai: { model: "gpt-5.5-pro", effort: "standard", role: "default" },
        anthropic: { model: "claude-sonnet-4-6", effort: "high", role: "domain_override" },
        google: { role: "disabled" },
      },
      tier_2: {
        capability: "mid_structured_extraction",
        used_in: ["article_extract_default"],
        openai: { model: "gpt-5-mini", effort: "standard", role: "default" },
        anthropic: { model: "claude-sonnet-4-6", effort: "standard", role: "domain_override" },
        google: { role: "disabled" },
      },
      tier_3: {
        capability: "high_volume_throughput_and_search_grounding",
        used_in: ["cite_check_overclaim_llm_judge_default"],
        openai: { model: "gpt-5-nano", effort: "standard", role: "default" },
        anthropic: { model: "claude-haiku-4-5", effort: "standard", role: "cross_vendor_review_only" },
        google: { model: "gemini-2.5-flash", role: "search_grounding_or_cost_effective_fallback" },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// assertTier0VendorRoles — INV-0023-2
// ---------------------------------------------------------------------------

describe("assertTier0VendorRoles — INV-0023-2", () => {
  it("passes on canonical Tier 0 mapping", () => {
    expect(() => assertTier0VendorRoles(baseConfig())).not.toThrow();
  });

  it("passes when google block is omitted at Tier 0", () => {
    const config = baseConfig();
    delete config.tiers.tier_0!.google;
    expect(() => assertTier0VendorRoles(config)).not.toThrow();
  });

  it("throws when tier_0 block is missing", () => {
    const config = baseConfig();
    delete (config.tiers as Record<string, unknown>).tier_0;
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTier0VendorRoles(config)).toThrow(/missing 'tier_0'/);
  });

  it("throws when openai role is not 'default'", () => {
    const config = baseConfig();
    config.tiers.tier_0!.openai!.role = "fallback";
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTier0VendorRoles(config)).toThrow(/tier_0\.openai\.role/);
  });

  it("throws when anthropic role is not 'cross_vendor_review_only'", () => {
    const config = baseConfig();
    config.tiers.tier_0!.anthropic!.role = "domain_override";
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTier0VendorRoles(config)).toThrow(/tier_0\.anthropic\.role/);
  });

  it("throws when google role is set to non-disabled at Tier 0", () => {
    const config = baseConfig();
    config.tiers.tier_0!.google = { model: "gemini-2.5-pro", role: "default" };
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTier0VendorRoles(config)).toThrow(/tier_0\.google\.role/);
  });

  it("throws when openai block is omitted at Tier 0", () => {
    const config = baseConfig();
    delete config.tiers.tier_0!.openai;
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws when anthropic block is omitted at Tier 0", () => {
    const config = baseConfig();
    delete config.tiers.tier_0!.anthropic;
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
  });

  // PR #93 codex review P2 round 1 — Tier 0 effort enforcement
  it("throws when tier_0.openai.effort is not 'extended_thinking'", () => {
    const config = baseConfig();
    config.tiers.tier_0!.openai!.effort = "standard";
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTier0VendorRoles(config)).toThrow(/tier_0\.openai\.effort/);
  });

  it("throws when tier_0.openai.effort is missing", () => {
    const config = baseConfig();
    delete config.tiers.tier_0!.openai!.effort;
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws when tier_0.anthropic.effort is 'standard' (weaker than 'high')", () => {
    const config = baseConfig();
    config.tiers.tier_0!.anthropic!.effort = "standard";
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTier0VendorRoles(config)).toThrow(/tier_0\.anthropic\.effort/);
  });

  it("throws when tier_0.anthropic.effort is 'low'", () => {
    const config = baseConfig();
    config.tiers.tier_0!.anthropic!.effort = "low";
    expect(() => assertTier0VendorRoles(config)).toThrow(LlmRoutingConfigError);
  });

  it("accepts tier_0.anthropic.effort = 'high' (literal ADR wording)", () => {
    const config = baseConfig();
    config.tiers.tier_0!.anthropic!.effort = "high";
    expect(() => assertTier0VendorRoles(config)).not.toThrow();
  });

  it("accepts tier_0.anthropic.effort = 'xhigh' (live operational catalog)", () => {
    const config = baseConfig();
    config.tiers.tier_0!.anthropic!.effort = "xhigh";
    expect(() => assertTier0VendorRoles(config)).not.toThrow();
  });

  it("TIER0_OPENAI_REQUIRED_EFFORT and TIER0_ANTHROPIC_ALLOWED_EFFORTS are exported", () => {
    expect(TIER0_OPENAI_REQUIRED_EFFORT).toBe("extended_thinking");
    expect(TIER0_ANTHROPIC_ALLOWED_EFFORTS.has("high")).toBe(true);
    expect(TIER0_ANTHROPIC_ALLOWED_EFFORTS.has("xhigh")).toBe(true);
    expect(TIER0_ANTHROPIC_ALLOWED_EFFORTS.has("standard")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertTiersCapabilityCanonical — INV-0023-3
// ---------------------------------------------------------------------------

describe("assertTiersCapabilityCanonical — INV-0023-3", () => {
  it("passes on canonical config (every tier has capability, no price axis)", () => {
    expect(() => assertTiersCapabilityCanonical(baseConfig())).not.toThrow();
  });

  it("throws when a tier lacks the capability field", () => {
    const config = baseConfig();
    delete (config.tiers.tier_1 as unknown as { capability?: string }).capability;
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(/non-empty 'capability'/);
  });

  it("throws when capability is an empty string", () => {
    const config = baseConfig();
    config.tiers.tier_2!.capability = "";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws when capability is whitespace-only", () => {
    const config = baseConfig();
    config.tiers.tier_2!.capability = "   ";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws when capability is not a string", () => {
    const config = baseConfig();
    (config.tiers.tier_3 as unknown as { capability: number }).capability = 42;
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws on forbidden tier-canonical key 'price'", () => {
    const config = baseConfig();
    (config.tiers.tier_3 as unknown as { price: string }).price = "low";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(/forbidden price-axis canonical key 'price'/);
  });

  it("throws on forbidden tier-canonical key 'cost'", () => {
    const config = baseConfig();
    (config.tiers.tier_3 as unknown as { cost: string }).cost = "low";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(/'cost'/);
  });

  it("throws on forbidden tier-canonical key 'cheap' (case-insensitive)", () => {
    const config = baseConfig();
    (config.tiers.tier_3 as unknown as { Cheap: boolean }).Cheap = true;
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws on forbidden tier-canonical key 'budget'", () => {
    const config = baseConfig();
    (config.tiers.tier_2 as unknown as { budget: string }).budget = "tight";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws on forbidden tier-canonical key 'cost_tier'", () => {
    const config = baseConfig();
    (config.tiers.tier_2 as unknown as { cost_tier: number }).cost_tier = 2;
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("allows cost-like keys INSIDE vendor sub-blocks (operational metadata exempt)", () => {
    const config = baseConfig();
    // Adding a hypothetical operational metric on the vendor sub-block is OK —
    // the forbidden-key scan is tier-canonical only, not transitive.
    (config.tiers.tier_3!.openai as unknown as { cost_per_1m_tokens: string }).cost_per_1m_tokens = "0.10";
    expect(() => assertTiersCapabilityCanonical(config)).not.toThrow();
  });

  it("FORBIDDEN_TIER_PRICE_AXIS_KEYS includes documented price-axis terms", () => {
    expect(FORBIDDEN_TIER_PRICE_AXIS_KEYS.has("price")).toBe(true);
    expect(FORBIDDEN_TIER_PRICE_AXIS_KEYS.has("cost")).toBe(true);
    expect(FORBIDDEN_TIER_PRICE_AXIS_KEYS.has("cheap")).toBe(true);
    expect(FORBIDDEN_TIER_PRICE_AXIS_KEYS.has("budget")).toBe(true);
  });

  // PR #93 codex review P2 round 1 — capability VALUE scan for price-axis terms
  it("throws when capability value contains 'cost' as snake_case token (low_cost_high_volume)", () => {
    const config = baseConfig();
    config.tiers.tier_3!.capability = "low_cost_high_volume_and_search_grounding";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(/forbidden price-axis token 'cost'/);
  });

  it("throws when capability value starts with 'cost_'", () => {
    const config = baseConfig();
    config.tiers.tier_3!.capability = "cost_effective_search";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws when capability value contains 'cheap' token", () => {
    const config = baseConfig();
    config.tiers.tier_3!.capability = "cheap_high_volume";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(/'cheap'/);
  });

  it("throws when capability value contains 'budget' token", () => {
    const config = baseConfig();
    config.tiers.tier_3!.capability = "budget_grounding";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws when capability value contains 'price' token", () => {
    const config = baseConfig();
    config.tiers.tier_3!.capability = "price_optimized";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("scan is case-insensitive ('Cost_Effective')", () => {
    const config = baseConfig();
    config.tiers.tier_3!.capability = "Cost_Effective_Grounding";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("does NOT match 'cost' embedded in non-token positions ('accost')", () => {
    const config = baseConfig();
    config.tiers.tier_3!.capability = "accost_grounding"; // hypothetical, no real word boundary
    expect(() => assertTiersCapabilityCanonical(config)).not.toThrow();
  });

  it("does NOT match 'cost' embedded in non-token positions ('costume')", () => {
    const config = baseConfig();
    config.tiers.tier_3!.capability = "costume_recognition";
    expect(() => assertTiersCapabilityCanonical(config)).not.toThrow();
  });

  it("accepts 'high_volume_throughput_and_search_grounding' (clean capability)", () => {
    const config = baseConfig();
    config.tiers.tier_3!.capability = "high_volume_throughput_and_search_grounding";
    expect(() => assertTiersCapabilityCanonical(config)).not.toThrow();
  });

  it("FORBIDDEN_CAPABILITY_VALUE_TOKENS exports the documented set", () => {
    expect(FORBIDDEN_CAPABILITY_VALUE_TOKENS).toEqual(["price", "cost", "cheap", "budget"]);
  });

  // PR #93 codex review round 2 P2 — composite key names containing forbidden tokens
  it("throws on composite tier-canonical key 'cost_basis' (round 2 codex P2)", () => {
    const config = baseConfig();
    (config.tiers.tier_2 as unknown as { cost_basis: string }).cost_basis = "per_million_tokens";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(/forbidden price-axis canonical key 'cost_basis'/);
  });

  it("throws on composite tier-canonical key 'price_axis' (round 2 codex P2)", () => {
    const config = baseConfig();
    (config.tiers.tier_2 as unknown as { price_axis: string }).price_axis = "tier_3";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(/'price_axis'/);
  });

  it("throws on composite tier-canonical key 'budget_label' (round 2 codex P2)", () => {
    const config = baseConfig();
    (config.tiers.tier_2 as unknown as { budget_label: string }).budget_label = "low";
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(/'budget_label'/);
  });

  it("throws on composite tier-canonical key 'cheap_indicator' (round 2 codex P2)", () => {
    const config = baseConfig();
    (config.tiers.tier_2 as unknown as { cheap_indicator: boolean }).cheap_indicator = true;
    expect(() => assertTiersCapabilityCanonical(config)).toThrow(LlmRoutingConfigError);
  });

  it("does NOT false-match legitimate keys with embedded non-token sequences (round 2 codex P2)", () => {
    const config = baseConfig();
    // Existing tier-canonical keys (capability, used_in, openai, anthropic, google)
    // contain no forbidden tokens — baseline should still pass.
    expect(() => assertTiersCapabilityCanonical(config)).not.toThrow();
    // Hypothetical additions like 'accost_metadata' / 'costume_class' should
    // also pass (token regex requires word boundary).
    (config.tiers.tier_2 as unknown as { accost_metadata: string }).accost_metadata = "x";
    expect(() => assertTiersCapabilityCanonical(config)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// assertGoogleScopeIsTier3Only — INV-0023-5
// ---------------------------------------------------------------------------

describe("assertGoogleScopeIsTier3Only — INV-0023-5", () => {
  it("passes on canonical config (Google only at Tier 3)", () => {
    expect(() => assertGoogleScopeIsTier3Only(baseConfig())).not.toThrow();
  });

  it("passes when google block is omitted at lower tiers", () => {
    const config = baseConfig();
    delete config.tiers.tier_0!.google;
    delete config.tiers.tier_1!.google;
    delete config.tiers.tier_2!.google;
    expect(() => assertGoogleScopeIsTier3Only(config)).not.toThrow();
  });

  it("throws when tier_3 is missing", () => {
    const config = baseConfig();
    delete (config.tiers as Record<string, unknown>).tier_3;
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(/missing 'tier_3'/);
  });

  it("throws when tier_3 has no google block", () => {
    const config = baseConfig();
    delete config.tiers.tier_3!.google;
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(/tier_3\.google\.role/);
  });

  it("throws when tier_3.google.role is 'disabled'", () => {
    const config = baseConfig();
    config.tiers.tier_3!.google = { role: "disabled" };
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(LlmRoutingConfigError);
  });

  it("throws when Google is enabled at tier_0", () => {
    const config = baseConfig();
    config.tiers.tier_0!.google = { role: "default" };
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(/tier_0\.google\.role/);
  });

  it("throws when Google is enabled at tier_1", () => {
    const config = baseConfig();
    config.tiers.tier_1!.google = { role: "domain_override" };
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(/tier_1\.google\.role/);
  });

  it("throws when Google is enabled at tier_2", () => {
    const config = baseConfig();
    config.tiers.tier_2!.google = { role: "fallback" };
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(/tier_2\.google\.role/);
  });

  // PR #93 codex review P2 round 1 — unknown future tiers must also reject Google
  it("rejects Google enabled at an unknown future tier (tier_experimental with role=default)", () => {
    const config = baseConfig();
    (config.tiers as Record<string, unknown>).tier_experimental = {
      capability: "experimental",
      used_in: [],
      google: { role: "default" },
    };
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(/tier_experimental\.google\.role/);
  });

  it("tolerates unknown future tier when google is omitted or disabled", () => {
    const config = baseConfig();
    (config.tiers as Record<string, unknown>).tier_experimental = {
      capability: "experimental",
      used_in: [],
      google: { role: "disabled" },
    };
    expect(() => assertGoogleScopeIsTier3Only(config)).not.toThrow();
  });

  it("tolerates unknown future tier when google block is omitted entirely", () => {
    const config = baseConfig();
    (config.tiers as Record<string, unknown>).tier_4 = {
      capability: "future_tier",
      used_in: [],
    };
    expect(() => assertGoogleScopeIsTier3Only(config)).not.toThrow();
  });

  // PR #93 codex review P2 round 1 — Tier 3 Google role allowlist
  it("throws when tier_3.google.role is 'default' (forbidden main generator role)", () => {
    const config = baseConfig();
    config.tiers.tier_3!.google = { role: "default" };
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(LlmRoutingConfigError);
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(/must be one of/);
  });

  it("throws when tier_3.google.role is 'cross_vendor_review_only' (forbidden reviewer role)", () => {
    const config = baseConfig();
    config.tiers.tier_3!.google = { role: "cross_vendor_review_only" };
    expect(() => assertGoogleScopeIsTier3Only(config)).toThrow(LlmRoutingConfigError);
  });

  it("accepts tier_3.google.role = 'search_grounding'", () => {
    const config = baseConfig();
    config.tiers.tier_3!.google = { role: "search_grounding" };
    expect(() => assertGoogleScopeIsTier3Only(config)).not.toThrow();
  });

  it("accepts tier_3.google.role = 'cost_effective_fallback'", () => {
    const config = baseConfig();
    config.tiers.tier_3!.google = { role: "cost_effective_fallback" };
    expect(() => assertGoogleScopeIsTier3Only(config)).not.toThrow();
  });

  it("accepts tier_3.google.role = composite 'search_grounding_or_cost_effective_fallback' (live YAML)", () => {
    const config = baseConfig();
    config.tiers.tier_3!.google = { role: "search_grounding_or_cost_effective_fallback" };
    expect(() => assertGoogleScopeIsTier3Only(config)).not.toThrow();
  });

  it("ALLOWED_TIER3_GOOGLE_ROLES exports the documented set", () => {
    expect(ALLOWED_TIER3_GOOGLE_ROLES.has("search_grounding_or_cost_effective_fallback")).toBe(true);
    expect(ALLOWED_TIER3_GOOGLE_ROLES.has("search_grounding")).toBe(true);
    expect(ALLOWED_TIER3_GOOGLE_ROLES.has("cost_effective_fallback")).toBe(true);
    expect(ALLOWED_TIER3_GOOGLE_ROLES.has("default")).toBe(false);
    expect(ALLOWED_TIER3_GOOGLE_ROLES.has("cross_vendor_review_only")).toBe(false);
  });

  it("NON_GOOGLE_TIERS lists documented tier_0/1/2 (documentary)", () => {
    expect(NON_GOOGLE_TIERS).toEqual(["tier_0", "tier_1", "tier_2"]);
  });

  it("GOOGLE_REQUIRED_TIER is tier_3", () => {
    expect(GOOGLE_REQUIRED_TIER).toBe("tier_3");
  });
});

// ---------------------------------------------------------------------------
// Loader error paths
// ---------------------------------------------------------------------------

describe("loadLlmRoutingConfig — loader errors", () => {
  it("throws on non-existent path", () => {
    expect(() =>
      loadLlmRoutingConfig(join(REPO_ROOT, "data", "does-not-exist.yaml")),
    ).toThrow();
  });
});
