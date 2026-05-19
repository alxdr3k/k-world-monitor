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
 * Asserts the Tier 0 vendor role mapping locked by ADR-0023 INV-0023-2:
 *   - tier_0.openai.role    = "default"
 *   - tier_0.anthropic.role = "cross_vendor_review_only"
 *   - tier_0.google.role    = "disabled" (or google omitted)
 *
 * Throws `LlmRoutingConfigError` on any deviation. Other tiers are out of
 * scope for this assertion (INV-0023-2 only locks Tier 0).
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

  const anthropicRole = tier0.anthropic?.role;
  if (anthropicRole !== "cross_vendor_review_only") {
    throw new LlmRoutingConfigError(
      `INV-0023-2: tier_0.anthropic.role must be 'cross_vendor_review_only' (got: ${JSON.stringify(anthropicRole)})`,
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
 * Asserts each tier entry has a non-empty `capability` string field
 * (canonical tier criterion per INV-0023-3) and contains no top-level
 * key from FORBIDDEN_TIER_PRICE_AXIS_KEYS.
 *
 * Vendor sub-blocks (tier.openai / tier.anthropic / tier.google) are
 * intentionally exempt from the forbidden-key scan — operational cost
 * metadata MAY live there, just not as a canonical tier criterion.
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
  }
}

// ---------------------------------------------------------------------------
// INV-0023-5 — Google scope = Tier 3 only
// ---------------------------------------------------------------------------

/**
 * Asserts Google vendor appears (with a non-disabled role) only at tier_3.
 *
 * - tier_0 / tier_1 / tier_2: `google.role` must be 'disabled' or google
 *   block omitted entirely.
 * - tier_3: `google.role` must be present and not 'disabled'.
 *
 * Unknown tiers (e.g. `tier_4` in a future config) are tolerated — only
 * the four documented tiers are checked.
 */
export const NON_GOOGLE_TIERS: readonly string[] = ["tier_0", "tier_1", "tier_2"];
export const GOOGLE_REQUIRED_TIER = "tier_3";

export function assertGoogleScopeIsTier3Only(config: LlmRoutingConfig): void {
  for (const tierKey of NON_GOOGLE_TIERS) {
    const tier = config.tiers[tierKey];
    if (!tier) continue; // tier may be omitted entirely; no Google to check
    const role = tier.google?.role;
    if (tier.google !== undefined && role !== "disabled") {
      throw new LlmRoutingConfigError(
        `INV-0023-5: ${tierKey}.google.role must be 'disabled' or google omitted (got: ${JSON.stringify(role)}); Google scope is Tier 3 only`,
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
  if (!tier3Google || tier3Google === "disabled") {
    throw new LlmRoutingConfigError(
      `INV-0023-5: ${GOOGLE_REQUIRED_TIER}.google.role must be present and not 'disabled' (got: ${JSON.stringify(tier3Google)}); ADR-0023 INV-0023-5 locks Google as Tier 3 fallback`,
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
