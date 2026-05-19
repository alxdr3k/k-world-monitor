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

import {
  LlmIncompleteResultError,
  type LlmClient,
  type LlmInvokeParams,
  type LlmInvokeResult,
  type LlmTier,
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
  // PR #100 codex round 4 F10 + round 6 F22 + Cycle 42 ratification —
  // OpenAI catalog SKUs with documented per-1M-token pricing
  // (2026-05). Pro tiers added with verified list rates (codex
  // citation https://platform.openai.com/docs/pricing): gpt-5-pro
  // $15/$120, gpt-5.2-pro $21/$168. Cached input billed at ~10%
  // standard per OpenAI prompt-caching policy.
  //
  // Tier 2/3 entries (gpt-5 / gpt-5-mini / gpt-5-nano) reflect
  // OpenAI list pricing for the GPT-5 family at the time of EXTR-
  // 1A.2b authoring; verify against catalog when ADR-0023 ratifies
  // the actual `data/llm_routing.yaml` snapshot for each tier.
  //
  // Pro SKUs live alongside Tier 2/3 in this table so a future
  // Responses API client (which is the only OpenAIClient path
  // permitted to invoke pro models — see
  // OPENAI_RESPONSES_API_ONLY_MODELS) can price them without
  // OpenAIPricingUnknownError. The current /chat/completions
  // client still rejects them at construction via F25.
  // Pro tier (PR #101 codex round 1 F31) — OpenAI docs list cached
  // input pricing as "-" for `gpt-5-pro` / `gpt-5.2-pro` (no
  // discount available). Omit `cachedInput` so `computeTotalCostUsd`
  // falls back to the standard input rate per cached token (no
  // discount), matching OpenAI's billing.
  "gpt-5-pro": { input: 15.0, output: 120.0 },
  "gpt-5.2-pro": { input: 21.0, output: 168.0 },
  "gpt-5": { input: 1.25, output: 10.0, cachedInput: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2.0, cachedInput: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cachedInput: 0.005 },
};

/**
 * OpenAI SKUs that route through the Responses API (not Chat
 * Completions). PR #100 codex round 6 F20 + Cycle 42 ratification —
 * curated against verified OpenAI catalog. `gpt-5-pro-extended-
 * thinking` was dropped because extended thinking is an effort
 * parameter (`reasoning_effort: high`) on `gpt-5-pro`, not a
 * separate SKU. The `gpt-5.5-*` entries remain because they
 * correspond to placeholder names in `data/llm_routing.yaml`
 * (pending operator ratification of the actual catalog SKU per
 * ADR-0023 INV-0023-3).
 */
export const OPENAI_RESPONSES_API_ONLY_MODELS = new Set<string>([
  "gpt-5-pro",
  "gpt-5.2-pro",
  "gpt-5.5-pro",
  "gpt-5.5-pro-extended-thinking",
]);

/**
 * Returns true when `model` is a documented Responses-API-only SKU
 * (exact match) OR a dated snapshot of one (e.g.
 * `gpt-5-pro-2026-01-01`). PR #100 codex round 7 F25 — without
 * the prefix check, dated overrides bypassed the exact-match set
 * and the broad `gpt-5-` pricing prefix accepted them, letting
 * Tier 0/1 callers post Responses-only models to
 * `/chat/completions` after the ledger row was opened.
 */
export function isResponsesApiOnlyModel(model: string): boolean {
  if (OPENAI_RESPONSES_API_ONLY_MODELS.has(model)) return true;
  for (const proAlias of OPENAI_RESPONSES_API_ONLY_MODELS) {
    if (model.startsWith(`${proAlias}-`)) return true;
  }
  return false;
}

export class OpenAIResponsesApiOnlyError extends Error {
  constructor(public readonly model: string) {
    super(
      `OpenAI model '${model}' uses the Responses API; OpenAIClient targets /chat/completions only. Pick a Chat-Completions-supported model or wait for the Responses API client (planned post EXTR-1A.2c).`,
    );
    this.name = "OpenAIResponsesApiOnlyError";
  }
}

/**
 * Thrown when `computeTotalCostUsd` is asked to price a model that
 * has no entry in `OPENAI_PRICING_USD_PER_1M_TOKENS` (exact or
 * prefix). PR #100 codex round 4 P2 (F10) — silent fallback to
 * `gpt-5-mini` previously undercounted the most expensive
 * (scenario / thesis) runs whenever callers passed a real pro SKU
 * ID the table did not yet know about. Operator must either add
 * the new SKU to the pricing table or pass a verified pricing
 * override before the client can charge for it.
 */
export class OpenAIPricingUnknownError extends Error {
  constructor(public readonly model: string) {
    super(
      `OpenAI pricing unknown for model '${model}' — add to OPENAI_PRICING_USD_PER_1M_TOKENS (or a dated snapshot prefix) before invoking. Silent fallback removed to prevent AC-019 cost undercount.`,
    );
    this.name = "OpenAIPricingUnknownError";
  }
}

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
  // PR #100 codex round 4 F10 — silent `gpt-5-mini` fallback
  // removed. Unknown models now throw OpenAIPricingUnknownError so
  // explicit pro-tier calls (`gpt-5-pro` etc.) that the table does
  // not yet know about surface as a hard error instead of being
  // billed at mini rates. Operator must extend the pricing table
  // when adopting a new SKU. Dated snapshots are still resolved via
  // longest-prefix match in resolveOpenAIPricingKey.
  const key = resolveOpenAIPricingKey(model);
  if (key === null) throw new OpenAIPricingUnknownError(model);
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
   * `OPENAI_TIER_DEFAULT_MODEL[tier]`. PR #100 codex round 6 F23 —
   * constructor validates that the resolved model has a pricing
   * entry; unknown SKUs throw `OpenAIPricingUnknownError` BEFORE
   * any billable API call so failed-but-billable rows do not slip
   * into the ledger without cost.
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
  /**
   * Request timeout in milliseconds (PR #100 codex round 6 F18 —
   * unbounded `fetch` could leave run_ledger rows in `running`
   * forever on network stalls). Defaults to 60_000 (60s) — enough
   * for Tier 2/3 extraction; raise for slower reasoning tiers.
   * Tests override to a small value to exercise timeout paths.
   */
  readonly timeoutMs?: number;
}

export class OpenAIRequestTimeoutError extends Error {
  constructor(public readonly timeoutMs: number, public readonly model: string) {
    super(
      `OpenAI request timed out after ${timeoutMs}ms (model='${model}'). The run_ledger row will be marked failed.`,
    );
    this.name = "OpenAIRequestTimeoutError";
  }
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 60_000;

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
 * (safety filter omitted output). Extends `LlmIncompleteResultError`
 * so the extractor catch path can record the billable usage (PR
 * #100 codex round 4 F13) on the failed run_ledger row via the
 * vendor-agnostic `LlmIncompleteResultError.usage` payload.
 */
export class OpenAIIncompleteCompletionError extends LlmIncompleteResultError {
  constructor(
    finishReason: string,
    partialText: string,
    usage?: {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly cachedTokens?: number;
      readonly totalCostUsd?: number;
    },
  ) {
    super(finishReason, partialText, usage);
    this.name = "OpenAIIncompleteCompletionError";
  }
  get finishReason(): string {
    return this.reason;
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
  private readonly timeoutMs: number;

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
    // ADR-0023 ratification. Require explicit `model` for those
    // tiers so the operator owns the routing decision.
    if ((this.tier === 0 || this.tier === 1) && opts.model === undefined) {
      throw new Error(
        `OpenAIClient: tier=${this.tier} (DEC-010 pro tier) requires an explicit \`model\` option — defaults are placeholders pending ADR-0023 ratification. Pass \`model\` explicitly or use a Tier 2/3 default.`,
      );
    }
    this.model = opts.model ?? OPENAI_TIER_DEFAULT_MODEL[this.tier];

    // PR #100 codex round 6 F20 + round 7 F25 — reject known
    // Responses-API-only SKUs at construction, including dated
    // snapshot prefixes (e.g. `gpt-5-pro-2026-01-01`). Without the
    // prefix check, a dated override would bypass the exact-match
    // set and the broad `gpt-5-` pricing prefix would accept it,
    // routing a Responses-API-only model to /chat/completions
    // after the ledger row was opened.
    if (isResponsesApiOnlyModel(this.model)) {
      throw new OpenAIResponsesApiOnlyError(this.model);
    }

    // PR #100 codex round 6 F23 — pre-API pricing validation.
    // `computeTotalCostUsd` already throws OpenAIPricingUnknownError
    // post-response, but that fires AFTER the API call has been
    // billed. Validate at construction so the failure happens
    // before `ArticleExtractor` opens any ledger row.
    if (resolveOpenAIPricingKey(this.model) === null) {
      throw new OpenAIPricingUnknownError(this.model);
    }

    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        `OpenAIClient: timeoutMs must be a positive finite number, got ${timeoutMs}`,
      );
    }
    this.timeoutMs = timeoutMs;
  }

  async invoke(params: LlmInvokeParams): Promise<LlmInvokeResult> {
    const url = `${this.baseUrl}/chat/completions`;
    // Apply per-tier default output cap when caller omits an
    // explicit `maxOutputTokens` (PR #100 codex P2). Caller's
    // explicit value wins.
    const maxCompletionTokens =
      params.maxOutputTokens ?? OPENAI_TIER_DEFAULT_MAX_OUTPUT_TOKENS[this.tier];
    // PR #100 codex round 6 F19 — DEC-010 §8 requires temperature=0
    // for extract / cite_check / thesis. Default to 0 here so the
    // extract path is deterministic by default; scenario callers
    // override via LlmInvokeParams.temperature=0.3.
    const temperature = params.temperature ?? 0;

    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      max_completion_tokens: maxCompletionTokens,
      temperature,
    };
    // PR #100 codex round 6 F19 — when caller supplies a structured
    // response schema (e.g. ArticleExtractor's future strict JSON
    // schema per DEC-010 §8), pass it through as
    // `response_format: { type: "json_schema", json_schema: {...} }`.
    // Until callers wire schemas, requests fall back to free-form
    // text (current behavior).
    if (params.responseFormat !== undefined) {
      requestBody["response_format"] = params.responseFormat;
    }
    const body = JSON.stringify(requestBody);

    // PR #100 codex round 6 F18 + round 7 F26 — bounded request via
    // AbortSignal so network stalls cannot leave run_ledger rows in
    // `running` forever. Keep the timer alive through the BODY read:
    // `fetch()` can resolve as soon as response headers arrive while
    // the body is still streaming, so a stall in `response.json()`
    // or `response.text()` after a fast header phase could still
    // wedge the extractor indefinitely. Clear only after the body
    // has been consumed (or on early throw).
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.timeoutMs);
    const onAbortThrow = (err: unknown): never => {
      if (abortController.signal.aborted) {
        throw new OpenAIRequestTimeoutError(this.timeoutMs, this.model);
      }
      throw err;
    };
    let response: Response;
    let data: OpenAIChatResponseShape;
    try {
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body,
          signal: abortController.signal,
        });
      } catch (err) {
        onAbortThrow(err);
        throw err; // unreachable but appeases TS narrowing
      }

      if (!response.ok) {
        let errBody = "";
        try {
          errBody = await response.text();
        } catch (err) {
          onAbortThrow(err);
        }
        throw new OpenAIApiError(response.status, errBody);
      }

      try {
        data = (await response.json()) as OpenAIChatResponseShape;
      } catch (err) {
        onAbortThrow(err);
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }

    // Prefer resolved snapshot from response.model (e.g. dated
    // `gpt-5-mini-2025-08-07`) over the request-time alias
    // `this.model`, so consumers writing to run_ledger.model_id
    // record the reproducibility anchor (PR #100 codex P2). Fall
    // back to `this.model` only if the response omits it (defensive
    // — OpenAI Chat Completions always returns it in practice).
    const resolvedModel =
      data.model && data.model.trim().length > 0 ? data.model : this.model;

    // PR #100 codex round 4 F12 + round 5 F16 + round 6 F21 —
    // `usage` MUST be present with BOTH `prompt_tokens` AND
    // `completion_tokens`, and both must be non-negative integers.
    // Round 6 F21 tightens the check from `!== undefined` to
    // `Number.isInteger(...) >= 0`: a malformed response with
    // `completion_tokens: null` previously passed the existence
    // check, then `buildBillableUsage` carried `null` to failRun
    // whose validation threw, leaving the ledger row stuck in
    // `running` (no terminal state). Strict-integer check at the
    // source means `buildBillableUsage` only emits payloads
    // failRun accepts.
    const usageBlock = data.usage;
    const inputTokensRaw = usageBlock?.prompt_tokens;
    const outputTokensRaw = usageBlock?.completion_tokens;
    const cachedTokensRaw = usageBlock?.prompt_tokens_details?.cached_tokens;
    const isCounter = (n: unknown): n is number =>
      typeof n === "number" && Number.isInteger(n) && n >= 0;
    const inputTokens = isCounter(inputTokensRaw) ? inputTokensRaw : undefined;
    const outputTokens = isCounter(outputTokensRaw)
      ? outputTokensRaw
      : undefined;
    const cachedTokens = isCounter(cachedTokensRaw) ? cachedTokensRaw : undefined;
    // PR #100 codex round 8 F29 — reject impossible accounting where
    // `cached_tokens > prompt_tokens`. Without this guard, a
    // malformed provider response would bill cached tokens beyond
    // the actual input total, inflating cost. Treat the response
    // as malformed (incomplete usage) so the ledger row goes
    // through failRun for retry / manual review. The
    // `usage_inconsistent` reason is distinct from
    // `missing_usage` so operators can distinguish provider bugs
    // from missing fields.
    const usageInconsistent =
      cachedTokens !== undefined &&
      inputTokens !== undefined &&
      cachedTokens > inputTokens;
    const usagePresent =
      usageBlock !== undefined &&
      inputTokens !== undefined &&
      outputTokens !== undefined &&
      !usageInconsistent;

    // PR #100 codex round 3 P2 — reject malformed responses where
    // `choices` is empty or the first choice lacks `message.content`.
    // PR #100 codex round 4 F13 — when usage is present (even on
    // truncated / filtered completions), carry it through to the
    // incomplete-error payload so the extractor can record the
    // billable cost on the failed ledger row instead of NULLing it.
    // PR #100 codex round 5 F15 — every incomplete-error usage
    // payload includes the resolved snapshot so the failRun path
    // can rewrite `run_ledger.model_id` from the request-time
    // alias to the actual snapshot that produced the billable
    // call. Without this, failed billable rows would keep the
    // alias and lose the reproducibility anchor that completed
    // rows already preserve via completeRun.modelId.
    const buildBillableUsage = () =>
      usagePresent
        ? {
            inputTokens,
            outputTokens,
            cachedTokens,
            totalCostUsd: computeTotalCostUsd(resolvedModel, {
              inputTokens,
              outputTokens,
              cachedTokens,
            }),
            modelId: resolvedModel,
          }
        : undefined;

    const firstChoice = data.choices?.[0];
    if (firstChoice === undefined) {
      throw new OpenAIIncompleteCompletionError(
        "missing_choice",
        "",
        buildBillableUsage(),
      );
    }
    // PR #100 codex round 7 F27 — strict-string validation. Round 3
    // F8 rejected only `undefined`/`null`. A malformed
    // OpenAI-compatible response with `content` as an array (the
    // newer multi-part shape) or an object would have surfaced as
    // a successful `LlmInvokeResult.text` of the wrong type,
    // letting `ArticleExtractor` mark the row `completed` while
    // downstream consumers received a non-string. Treat any
    // non-string shape as an incomplete provider response so the
    // ledger goes to failRun.
    const rawContent = firstChoice.message?.content;
    if (typeof rawContent !== "string") {
      throw new OpenAIIncompleteCompletionError(
        "missing_content",
        "",
        buildBillableUsage(),
      );
    }
    const text = rawContent;

    // PR #100 codex round 2 P2 — reject truncated / filtered
    // completions instead of silently returning empty / partial
    // content. `tool_calls` / `function_call` are also rejected —
    // this layer does not support tool execution.
    const finishReason = firstChoice.finish_reason;
    const incompleteReasons = new Set([
      "length",
      "content_filter",
      "tool_calls",
      "function_call",
    ]);
    if (finishReason && incompleteReasons.has(finishReason)) {
      // F13 + F15: preserve billable usage + resolved snapshot.
      throw new OpenAIIncompleteCompletionError(
        finishReason,
        text,
        buildBillableUsage(),
      );
    }

    // Success path requires usage present (F12 + round 8 F29) —
    // silent zero-cost success would let billable calls disappear
    // from AC-019; inconsistent usage (cached > input) would
    // inflate cost. Both cases route through failRun without a
    // usage payload (no half-credible accounting on the failed
    // row).
    if (!usagePresent) {
      throw new OpenAIIncompleteCompletionError(
        usageInconsistent ? "usage_inconsistent" : "missing_usage",
        text,
        undefined,
      );
    }

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
