/**
 * data/llm_routing.yaml — pure config/policy validator
 *
 * Operator decision D3 (2026-05-18) — ADR-0023 INV-0023-2 / INV-0023-3 /
 * INV-0023-5 are config-level invariants without runtime code enforcement.
 * Enforce them as a pure validator over the operational model snapshot YAML.
 *
 * INV-0023-2: Tier 0 = OpenAI frontier (default) + Anthropic frontier
 *             (cross_vendor_review_only) + Google disabled.
 * INV-0023-3: Tier mapping = capability (성능 / 분야 우위 / 특성), NOT price.
 *             Enforced as: every tier has a `capability` field; no
 *             price-axis term (price / cost / cheap / budget) appears as a
 *             tier-canonical field key.
 * INV-0023-5: Google scope = Tier 3 only. tier_0 / tier_1 / tier_2 must
 *             have `google.role: disabled` (or omit google). Tier 3 must
 *             have a non-disabled google role.
 *
 * The validator is intentionally narrow:
 *   - It only checks structural / mapping invariants the operator locked.
 *   - It does NOT execute LLM calls or wire into routing logic.
 *   - It does NOT cover INV-0023-4 (cross_vendor_review enforcement) which
 *     is EXTR-1A.* phase deferred (Cycle 18 contract).
 */

import { readFileSync } from "node:fs";
import { load as yamlLoad } from "js-yaml";

// ---------------------------------------------------------------------------
// YAML shape
// ---------------------------------------------------------------------------

export interface LlmRoutingVendorEntry {
  role: string;
  required?: boolean;
  sdk?: string;
  strict_schema?: string;
}

export interface LlmRoutingTierVendorEntry {
  model?: string;
  effort?: string;
  role: string;
  override_trigger?: string;
  condition?: string;
}

export interface LlmRoutingTierEntry {
  capability: string;
  used_in: string[];
  openai?: LlmRoutingTierVendorEntry;
  anthropic?: LlmRoutingTierVendorEntry;
  google?: LlmRoutingTierVendorEntry;
}

export interface LlmRoutingConfig {
  vendors: Record<string, LlmRoutingVendorEntry>;
  tiers: Record<string, LlmRoutingTierEntry>;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export class LlmRoutingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmRoutingConfigError";
  }
}

export function loadLlmRoutingConfig(path: string): LlmRoutingConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = yamlLoad(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LlmRoutingConfigError(`expected YAML object at ${path}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (!isRecord(obj.vendors)) {
    throw new LlmRoutingConfigError(`${path}: missing or invalid 'vendors' block`);
  }
  if (!isRecord(obj.tiers)) {
    throw new LlmRoutingConfigError(`${path}: missing or invalid 'tiers' block`);
  }
  return obj as unknown as LlmRoutingConfig;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// INV-0023-2 — Tier 0 vendor role mapping (locked)
// ---------------------------------------------------------------------------

/**
 * Required Tier 0 effort levels (per ADR-0023 INV-0023-2 statement —
 * "OpenAI frontier reasoning model with extended thinking" + "Anthropic
 * frontier reasoning model with high effort"). The Anthropic side accepts
 * both `high` (the literal ADR wording) and `xhigh` (the strictly stronger
 * level used by the live operational catalog) — both satisfy the
 * "high effort" lock; weaker levels (`standard`, `low`, etc.) do not.
 */
export const TIER0_OPENAI_REQUIRED_EFFORT = "extended_thinking";
export const TIER0_ANTHROPIC_ALLOWED_EFFORTS: ReadonlySet<string> = new Set([
  "high",
  "xhigh",
]);

/**
 * Asserts the Tier 0 vendor role + effort mapping locked by ADR-0023 INV-0023-2:
 *   - tier_0.openai.role    = "default"
 *   - tier_0.openai.effort  = "extended_thinking"  (per ADR statement)
 *   - tier_0.anthropic.role = "cross_vendor_review_only"
 *   - tier_0.anthropic.effort ∈ {"high", "xhigh"}  (per ADR "high effort")
 *   - tier_0.google.role    = "disabled" (or google omitted)
 *
 * Throws `LlmRoutingConfigError` on any deviation. Other tiers are out of
 * scope for this assertion (INV-0023-2 only locks Tier 0).
 *
 * Effort enforcement (PR #93 codex review P2 round 1) — without these,
 * an operational catalog edit could silently downgrade Tier 0 from
 * extended-thinking + high effort to a weaker reasoning level while
 * still satisfying the role lock.
 */
export function assertTier0VendorRoles(config: LlmRoutingConfig): void {
  const tier0 = config.tiers["tier_0"];
  if (!tier0) {
    throw new LlmRoutingConfigError(
      "INV-0023-2: missing 'tier_0' block in tiers map",
    );
  }

  const openaiRole = tier0.openai?.role;
  if (openaiRole !== "default") {
    throw new LlmRoutingConfigError(
      `INV-0023-2: tier_0.openai.role must be 'default' (got: ${JSON.stringify(openaiRole)})`,
    );
  }
  const openaiEffort = tier0.openai?.effort;
  if (openaiEffort !== TIER0_OPENAI_REQUIRED_EFFORT) {
    throw new LlmRoutingConfigError(
      `INV-0023-2: tier_0.openai.effort must be '${TIER0_OPENAI_REQUIRED_EFFORT}' (got: ${JSON.stringify(openaiEffort)}); ADR statement locks Tier 0 to extended thinking`,
    );
  }

  const anthropicRole = tier0.anthropic?.role;
  if (anthropicRole !== "cross_vendor_review_only") {
    throw new LlmRoutingConfigError(
      `INV-0023-2: tier_0.anthropic.role must be 'cross_vendor_review_only' (got: ${JSON.stringify(anthropicRole)})`,
    );
  }
  const anthropicEffort = tier0.anthropic?.effort;
  if (typeof anthropicEffort !== "string" || !TIER0_ANTHROPIC_ALLOWED_EFFORTS.has(anthropicEffort)) {
    throw new LlmRoutingConfigError(
      `INV-0023-2: tier_0.anthropic.effort must be one of {${[...TIER0_ANTHROPIC_ALLOWED_EFFORTS].join(", ")}} (got: ${JSON.stringify(anthropicEffort)}); ADR statement locks Tier 0 to high effort`,
    );
  }

  // Google must be either omitted or explicitly disabled at tier_0.
  const googleRole = tier0.google?.role;
  if (tier0.google !== undefined && googleRole !== "disabled") {
    throw new LlmRoutingConfigError(
      `INV-0023-2: tier_0.google.role must be 'disabled' or google omitted (got: ${JSON.stringify(googleRole)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// INV-0023-3 — Tier mapping = capability, NOT price
// ---------------------------------------------------------------------------

/**
 * Set of tier-canonical field keys forbidden as canonical tier criteria.
 * Per operator D3 (2026-05-18), "tier 설명/metadata 에서 price/cost/cheap
 * 류의 기준이 canonical tier definition 으로 쓰이지 않도록 방지".
 *
 * Note: these terms are only forbidden as TIER-LEVEL keys. They are still
 * allowed inside vendor sub-blocks if a future operational metric needs
 * them (e.g. `tier_3.openai.cost_per_1m_tokens` would not trigger this).
 */
export const FORBIDDEN_TIER_PRICE_AXIS_KEYS: ReadonlySet<string> = new Set([
  "price",
  "cost",
  "cheap",
  "budget",
  "cost_tier",
  "price_tier",
  "price_class",
  "cost_class",
]);

/**
 * Forbidden price-axis tokens scanned as substrings of the tier-canonical
 * `capability` VALUE (PR #93 codex review P2 round 1). Matched with
 * snake_case-aware word boundaries: token must be preceded by start-of-
 * string or non-letter, and followed by non-letter or end-of-string.
 *
 * - `low_cost_high_volume` → matches `cost` ✓
 * - `cost_effective`        → matches `cost` ✓
 * - `accost`                → does NOT match (preceded by letter)
 * - `costume`               → does NOT match (followed by letter)
 *
 * Operator D3 spec (2026-05-18): "tier 설명/metadata 에서 price/cost/cheap
 * 류 의 기준이 canonical tier definition 으로 쓰이지 않도록 방지". Vendor
 * sub-blocks (tier.openai etc.) remain exempt — operational cost metadata
 * MAY live there.
 */
export const FORBIDDEN_CAPABILITY_VALUE_TOKENS: readonly string[] = [
  "price",
  "cost",
  "cheap",
  "budget",
];

/**
 * Asserts each tier entry has a non-empty `capability` string field
 * (canonical tier criterion per INV-0023-3), contains no top-level
 * key from FORBIDDEN_TIER_PRICE_AXIS_KEYS, AND whose capability VALUE
 * does not include any FORBIDDEN_CAPABILITY_VALUE_TOKENS (with
 * snake_case-aware word boundaries — see token list docstring).
 *
 * Vendor sub-blocks (tier.openai / tier.anthropic / tier.google) are
 * intentionally exempt from both scans — operational cost metadata MAY
 * live there, just not as a canonical tier criterion.
 */
export function assertTiersCapabilityCanonical(config: LlmRoutingConfig): void {
  for (const [tierKey, tier] of Object.entries(config.tiers)) {
    if (typeof tier.capability !== "string" || tier.capability.trim() === "") {
      throw new LlmRoutingConfigError(
        `INV-0023-3: tier '${tierKey}' must have a non-empty 'capability' string field (got: ${JSON.stringify(tier.capability)})`,
      );
    }

    for (const key of Object.keys(tier)) {
      if (FORBIDDEN_TIER_PRICE_AXIS_KEYS.has(key.toLowerCase())) {
        throw new LlmRoutingConfigError(
          `INV-0023-3: tier '${tierKey}' has forbidden price-axis canonical key '${key}' (price/cost/cheap/budget terms must not be tier-canonical; ADR-0023 INV-0023-3)`,
        );
      }
    }

    const capabilityLower = tier.capability.toLowerCase();
    for (const token of FORBIDDEN_CAPABILITY_VALUE_TOKENS) {
      const pattern = new RegExp(`(?:^|[^a-z])${token}(?![a-z])`);
      if (pattern.test(capabilityLower)) {
        throw new LlmRoutingConfigError(
          `INV-0023-3: tier '${tierKey}' capability value contains forbidden price-axis token '${token}' (got: ${JSON.stringify(tier.capability)}); ADR-0023 INV-0023-3 locks the canonical capability descriptor to capability axis only — move cost language into vendor sub-block operational metadata`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// INV-0023-5 — Google scope = Tier 3 only
// ---------------------------------------------------------------------------

/**
 * Asserts Google vendor appears (with a non-disabled role) only at tier_3.
 *
 * - EVERY tier other than tier_3 (including unknown future tiers like
 *   tier_4 / tier_experimental) must have `google.role: disabled` or the
 *   google block omitted entirely (PR #93 codex review P2 round 1 — was
 *   previously restricted to tier_0/1/2 only).
 * - tier_3 must exist and `tier_3.google.role` must be in
 *   `ALLOWED_TIER3_GOOGLE_ROLES` (search grounding / cost-effective
 *   fallback only; main-generator `default` and `cross_vendor_review_only`
 *   are forbidden per INV-0023-5 / INV-0023-2 alignment — PR #93 codex
 *   review P2 round 1).
 *
 * `NON_GOOGLE_TIERS` is retained as a documentation constant listing the
 * three documented non-Google tiers; the actual scan is now over every
 * non-tier_3 tier present in the config.
 */
export const NON_GOOGLE_TIERS: readonly string[] = ["tier_0", "tier_1", "tier_2"];
export const GOOGLE_REQUIRED_TIER = "tier_3";

/**
 * Roles allowed for Google at tier_3. Per ADR-0023 INV-0023-5, Google
 * usage scope is "Tier 3 + 탐색 (Google Search grounding) 보조 + 동일 tier
 * 비용효율 우위 시만"; "메인 generator 의 default 또는 reviewer 로 사용 금지".
 *
 * The live operational config uses the composite literal
 * `search_grounding_or_cost_effective_fallback`; we also accept the
 * sub-roles in case a future split.
 */
export const ALLOWED_TIER3_GOOGLE_ROLES: ReadonlySet<string> = new Set([
  "search_grounding_or_cost_effective_fallback",
  "search_grounding",
  "cost_effective_fallback",
]);

export function assertGoogleScopeIsTier3Only(config: LlmRoutingConfig): void {
  for (const [tierKey, tier] of Object.entries(config.tiers)) {
    if (tierKey === GOOGLE_REQUIRED_TIER) continue;
    const role = tier.google?.role;
    if (tier.google !== undefined && role !== "disabled") {
      throw new LlmRoutingConfigError(
        `INV-0023-5: ${tierKey}.google.role must be 'disabled' or google omitted (got: ${JSON.stringify(role)}); Google scope is Tier 3 only — any non-tier_3 tier with Google enabled violates the lock`,
      );
    }
  }

  const tier3 = config.tiers[GOOGLE_REQUIRED_TIER];
  if (!tier3) {
    throw new LlmRoutingConfigError(
      `INV-0023-5: missing '${GOOGLE_REQUIRED_TIER}' block; expected Google to be enabled at Tier 3`,
    );
  }
  const tier3Google = tier3.google?.role;
  if (typeof tier3Google !== "string" || !ALLOWED_TIER3_GOOGLE_ROLES.has(tier3Google)) {
    throw new LlmRoutingConfigError(
      `INV-0023-5: ${GOOGLE_REQUIRED_TIER}.google.role must be one of {${[...ALLOWED_TIER3_GOOGLE_ROLES].join(", ")}} (got: ${JSON.stringify(tier3Google)}); ADR-0023 INV-0023-5 forbids Google as main generator default or reviewer — only search grounding / cost-effective fallback roles are allowed`,
    );
  }
}

// ---------------------------------------------------------------------------
// Aggregate entry point
// ---------------------------------------------------------------------------

/**
 * Run all three ADR-0023 config-level invariant checks against the YAML at
 * `path`. Throws on the first violation (fail-fast). Used by the test suite
 * `tests/policy/llm_routing_config_test.ts` and (optionally) by a future
 * CLI guard.
 */
export function checkLlmRoutingConfig(path: string): void {
  const config = loadLlmRoutingConfig(path);
  assertTier0VendorRoles(config);
  assertTiersCapabilityCanonical(config);
  assertGoogleScopeIsTier3Only(config);
}

if (import.meta.main) {
  const path = process.argv[2] ?? "data/llm_routing.yaml";
  try {
    checkLlmRoutingConfig(path);
    console.log(`OK: ${path} satisfies ADR-0023 INV-0023-2 + INV-0023-3 + INV-0023-5.`);
    process.exit(0);
  } catch (err) {
    console.error(`FAIL: ${(err as Error).message}`);
    process.exit(1);
  }
}
