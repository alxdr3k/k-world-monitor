/**
 * OpenAI Chat Completions API client implementing `LlmClient` (EXTR-
 * 1A.2b).
 *
 * Tier 2 default = GPT-5 mini (ADR-0023 §statement + DEC-010). The
 * client is intentionally thin — it issues a single HTTPS request
 * via `fetch` (no `openai` npm dependency, keeping the surface
 * controlled + avoiding optional SDK upgrade churn). Streaming /
 * tool-call / function-call paths are NOT exposed at this layer;
 * concrete extractors await a full response.
 *
 * Operator decision: EXTR-1A.2b (Cycle 41, operator option A "OpenAI
 * SDK 실제 wiring + run_ledger 한 PR" 2026-05-19).
 */

import type {
  LlmClient,
  LlmInvokeParams,
  LlmInvokeResult,
  LlmTier,
} from "./client";

/**
 * Per-tier default model identifiers (DEC-010 §Core lock item 1 +
 * ADR-0023 §statement). Operator decision wires these to real
 * OpenAI catalog names. Override at construction time when a
 * specific `model` is required.
 *
 * Mapping per DEC-010 routing table:
 *   - Tier 0: GPT-5.5 Pro extended thinking (scenario validate
 *     adversarial / high-stakes thesis)
 *   - Tier 1: GPT-5.5 Pro standard
 *   - Tier 2: GPT-5 mini (default extraction)
 *   - Tier 3: GPT-5 nano (publication preflight + cost-efficient
 *     structured)
 *
 * **TODO (ADR-0023 ratification)**: the canonical OpenAI model
 * identifiers for GPT-5 / GPT-5.5 family need verification against
 * the OpenAI catalog at integration time. Placeholders below match
 * the public OpenAI naming convention as of EXTR-1A.2b authoring
 * (2026-05); dated suffixes (`-YYYY-MM-DD`) arrive from
 * `response.model` at runtime and are handled by prefix-matching in
 * `computeTotalCostUsd` (PR #100 codex round 2 P2).
 */
export const OPENAI_TIER_DEFAULT_MODEL: Record<LlmTier, string> = {
  0: "gpt-5.5-pro-extended-thinking",
  1: "gpt-5.5-pro",
  2: "gpt-5-mini",
  3: "gpt-5-nano",
};

/**
 * Per-model USD pricing per 1 million tokens. Used by
 * `computeTotalCostUsd` to satisfy the OPS-1A.1 `completeRun`
 * contract (AC-019 — null cost is rejected).
 *
 * **TODO (ADR-0023 ratification)**: actual OpenAI list prices need
 * verification at integration time. Placeholders below derive from
 * public OpenAI list pricing for the GPT-5 / GPT-5.5 family at the
 * time of EXTR-1A.2b authoring (2026-05). Cached input tokens price
 * at 10% of standard input.
 *
 * Dated snapshots (e.g. `gpt-5-mini-2025-08-07`) returned in
 * `response.model` are routed to the matching alias via prefix
 * lookup in `computeTotalCostUsd` (PR #100 codex round 2 P2). Add
 * new aliases here for any future SKU; per-snapshot overrides can
 * be added with the full dated string if pricing diverges from the
 * undated alias.
 */
export const OPENAI_PRICING_USD_PER_1M_TOKENS: Record<
  string,
  { input: number; output: number; cachedInput?: number }
> = {
  "gpt-5.5-pro-extended-thinking": { input: 5.0, output: 40.0, cachedInput: 0.5 },
  "gpt-5.5-pro": { input: 2.5, output: 20.0, cachedInput: 0.25 },
  "gpt-5": { input: 1.25, output: 10.0, cachedInput: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2.0, cachedInput: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cachedInput: 0.005 },
};

/**
 * Resolve a model identifier to the pricing-table key, handling
 * dated OpenAI snapshots (PR #100 codex round 2 P2). OpenAI returns
 * `response.model` as the resolved dated snapshot (e.g.
 * `gpt-5-mini-2025-08-07`) even when the request used the alias
 * `gpt-5-mini`. Previously this fell through to the `gpt-5-mini`
 * fallback for ALL non-default models (including `gpt-5-...` and
 * `gpt-5-nano-...`), undercounting Tier 0/1 costs and overcounting
 * Tier 3 costs.
 *
 * Resolution order (longest alias wins so `gpt-5-mini-...` is not
 * eaten by the shorter `gpt-5-` prefix):
 *   1. Exact match on the input model identifier.
 *   2. Longest alias whose full string equals the input or is a
 *      `${alias}-` prefix of the input (matches OpenAI's dated
 *      suffix naming convention).
 *   3. `null` — caller decides fallback policy.
 */
export function resolveOpenAIPricingKey(model: string): string | null {
  if (model in OPENAI_PRICING_USD_PER_1M_TOKENS) return model;
  const aliases = Object.keys(OPENAI_PRICING_USD_PER_1M_TOKENS).sort(
    (a, b) => b.length - a.length,
  );
  for (const alias of aliases) {
    if (model === alias || model.startsWith(`${alias}-`)) return alias;
  }
  return null;
}

/**
 * Compute total USD cost for an OpenAI invocation. Returns `0` if
 * no usage information is available (allowed by AC-019 since `0` is
 * a valid non-null cost). Unknown models charge at `gpt-5-mini`
 * prices fail-closed (operator should add the model to the table).
 */
export function computeTotalCostUsd(
  model: string,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
  },
): number {
  // PR #100 codex round 2 P2 — resolve dated snapshots (e.g.
  // `gpt-5-mini-2025-08-07`) to their pricing-table alias via
  // prefix lookup. Falls back to `gpt-5-mini` only for truly
  // unknown models (no exact + no prefix match), preserving the
  // operator-safe fail-closed default for forward compatibility.
  const key = resolveOpenAIPricingKey(model) ?? "gpt-5-mini";
  const pricing = OPENAI_PRICING_USD_PER_1M_TOKENS[key]!;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cached = usage.cachedTokens ?? 0;
  // Cached input tokens are billed separately at a discount; the
  // non-cached portion of input is `input - cached`.
  const nonCached = Math.max(0, input - cached);
  const inputCost = (nonCached / 1_000_000) * pricing.input;
  const cachedCost =
    (cached / 1_000_000) * (pricing.cachedInput ?? pricing.input);
  const outputCost = (output / 1_000_000) * pricing.output;
  return inputCost + cachedCost + outputCost;
}

export interface OpenAIClientOptions {
  /**
   * OpenAI API key. If omitted, falls back to
   * `process.env.OPENAI_API_KEY`. Throws if neither resolves to a
   * non-empty string (fail-fast on misconfiguration).
   */
  readonly apiKey?: string;
  readonly tier?: LlmTier;
  /**
   * Explicit model identifier override. Defaults to
   * `OPENAI_TIER_DEFAULT_MODEL[tier]`.
   */
  readonly model?: string;
  /**
   * Injectable fetch implementation for tests. Defaults to
   * `globalThis.fetch`. Tests pass a mock that records request
   * params + returns predetermined Response objects.
   */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Override the API base URL. Defaults to
   * `https://api.openai.com/v1`. Tests use this to point fetch at
   * a local mock if needed.
   */
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface OpenAIChatResponseShape {
  /**
   * Resolved model snapshot returned by OpenAI (e.g.
   * `gpt-5-mini-2025-08-07` when the request used the alias
   * `gpt-5-mini`). Preferred over `OpenAIClient.model` for the
   * ledger model_id so the row records the dated snapshot that
   * actually produced the result (PR #100 codex P2).
   */
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    /**
     * OpenAI completion termination reason. Values seen in the
     * Chat Completions API: `stop` (natural completion), `length`
     * (max_completion_tokens hit — output truncated), `content_filter`
     * (provider safety filter omitted output), `tool_calls` /
     * `function_call` (model wants to call a tool — not supported
     * at this layer). PR #100 codex round 2 P2 requires us to
     * reject `length` / `content_filter` instead of silently
     * marking the run completed with truncated/empty content.
     */
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

/**
 * Thrown when OpenAI returns a 200 response whose first choice did
 * NOT terminate naturally — e.g. `finish_reason: "length"` (token
 * cap hit, output truncated) or `finish_reason: "content_filter"`
 * (safety filter omitted output). The extractor caller catches
 * this and propagates → `failRun` writes a `failed` row to
 * `run_ledger` so the run is surfaced for retry / manual review
 * rather than silently published as a `completed` extraction with
 * empty or partial structured output (PR #100 codex round 2 P2).
 */
export class OpenAIIncompleteCompletionError extends Error {
  constructor(
    public readonly finishReason: string,
    public readonly partialText: string,
  ) {
    super(
      `OpenAI completion did not terminate naturally: finish_reason='${finishReason}' (partial text length=${partialText.length})`,
    );
    this.name = "OpenAIIncompleteCompletionError";
  }
}

/**
 * Per-tier default `max_completion_tokens` cap. Bounds OpenAI
 * output regardless of caller (PR #100 codex P2 — Tier 2 default
 * extraction had no output cap, allowing prompt-injected article
 * bodies to drive unbounded generation cost before run_ledger
 * captured it).
 *
 * Values chosen as conservative envelopes for the extraction stage —
 * extractor outputs are short JSON envelopes, not free-form prose.
 * Callers may still override via `LlmInvokeParams.maxOutputTokens`
 * for stages that legitimately need more (dossier / scenario).
 */
export const OPENAI_TIER_DEFAULT_MAX_OUTPUT_TOKENS: Record<LlmTier, number> = {
  0: 4_000,
  1: 4_000,
  2: 2_000,
  3: 1_000,
};

export class OpenAIApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`OpenAI API error: status=${status} body=${responseBody.slice(0, 500)}`);
    this.name = "OpenAIApiError";
  }
}

export class OpenAIClient implements LlmClient {
  readonly vendor = "openai" as const;
  readonly tier: LlmTier;
  readonly model: string;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(opts: OpenAIClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
    if (!apiKey || apiKey.trim() === "") {
      throw new Error(
        "OpenAIClient: apiKey required (pass via constructor option or set OPENAI_API_KEY env var)",
      );
    }
    this.apiKey = apiKey;
    this.tier = opts.tier ?? 2;
    // PR #100 codex round 3 P1 — Tier 0/1 default IDs in
    // OPENAI_TIER_DEFAULT_MODEL are placeholders pending DEC-010 /
    // ADR-0023 ratification and the actual OpenAI pro SKUs
    // (`gpt-5-pro` / `gpt-5.2-pro` per OpenAI catalog) are
    // Responses-API-only — this client posts to `/chat/completions`,
    // so silently shipping a default for those tiers would
    // unconditionally fail at runtime. Require callers to supply
    // `model` explicitly when picking Tier 0/1 until the routing +
    // endpoint pairing is ratified.
    if ((this.tier === 0 || this.tier === 1) && opts.model === undefined) {
      throw new Error(
        `OpenAIClient: tier=${this.tier} (DEC-010 pro tier) requires an explicit \`model\` option — defaults are placeholders pending ADR-0023 ratification, and OpenAI pro SKUs use the Responses API which this client does not yet target. Pass \`model\` explicitly or use a Tier 2/3 default.`,
      );
    }
    this.model = opts.model ?? OPENAI_TIER_DEFAULT_MODEL[this.tier];
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  }

  async invoke(params: LlmInvokeParams): Promise<LlmInvokeResult> {
    const url = `${this.baseUrl}/chat/completions`;
    // Apply per-tier default output cap when caller omits an
    // explicit `maxOutputTokens` (PR #100 codex P2). Caller's
    // explicit value wins (including `0` is rejected by OpenAI as
    // invalid — left to the API).
    const maxCompletionTokens =
      params.maxOutputTokens ?? OPENAI_TIER_DEFAULT_MAX_OUTPUT_TOKENS[this.tier];
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      max_completion_tokens: maxCompletionTokens,
    });

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new OpenAIApiError(response.status, text);
    }

    const data = (await response.json()) as OpenAIChatResponseShape;
    // PR #100 codex round 3 P2 — reject malformed responses where
    // `choices` is empty or the first choice lacks `message.content`
    // (string). Without this, `choices: []` or a missing content
    // field would surface as a successful "" extraction that
    // `ArticleExtractor` happily marks `completed` on the ledger —
    // indistinguishable from a legitimate empty article result and
    // bypassing retry / manual review. A legitimate empty result
    // still surfaces normally via `finish_reason: "stop"` with
    // `content: ""`.
    const firstChoice = data.choices?.[0];
    if (firstChoice === undefined) {
      throw new OpenAIIncompleteCompletionError("missing_choice", "");
    }
    const rawContent = firstChoice.message?.content;
    if (rawContent === undefined || rawContent === null) {
      throw new OpenAIIncompleteCompletionError("missing_content", "");
    }
    const text = rawContent;
    // PR #100 codex round 2 P2 — reject truncated / filtered
    // completions instead of silently returning empty / partial
    // content. ArticleExtractor's try/catch converts this to
    // `failRun` on the ledger row, so the failure is surfaced for
    // retry / manual review. `tool_calls` / `function_call` are
    // also rejected — this layer does not support tool execution,
    // so a model that requests a tool call is effectively
    // incomplete for extraction purposes.
    const finishReason = firstChoice.finish_reason;
    const incompleteReasons = new Set([
      "length",
      "content_filter",
      "tool_calls",
      "function_call",
    ]);
    if (finishReason && incompleteReasons.has(finishReason)) {
      throw new OpenAIIncompleteCompletionError(finishReason, text);
    }
    // Prefer resolved snapshot from response.model (e.g. dated
    // `gpt-5-mini-2025-08-07`) over the request-time alias
    // `this.model`, so consumers writing to run_ledger.model_id
    // record the reproducibility anchor (PR #100 codex P2). Fall
    // back to `this.model` only if the response omits it (defensive
    // — OpenAI Chat Completions always returns it in practice).
    const resolvedModel =
      data.model && data.model.trim().length > 0 ? data.model : this.model;
    const inputTokens = data.usage?.prompt_tokens;
    const outputTokens = data.usage?.completion_tokens;
    const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens;
    // Cost computation prefers the resolved snapshot so dated
    // models get their own pricing row if present in the table;
    // unknown-model fallback still applies for forward compatibility.
    const totalCostUsd = computeTotalCostUsd(resolvedModel, {
      inputTokens,
      outputTokens,
      cachedTokens,
    });

    return {
      text,
      vendor: "openai",
      model: resolvedModel,
      tier: this.tier,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalCostUsd,
    };
  }
}
