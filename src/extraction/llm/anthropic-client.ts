/**
 * Anthropic Messages API client implementing `LlmClient` (EXTR-1A.2c).
 *
 * Tier 2 default = Sonnet 4.6 (DEC-010 §statement, Korean long-
 * context extraction override). The client mirrors `OpenAIClient`'s
 * design: thin `fetch`-based HTTPS request (no `@anthropic-ai/sdk`
 * dependency), no streaming, awaits full response, returns a single
 * `LlmInvokeResult` envelope.
 *
 * Operator decision: EXTR-1A.2c (Cycle 43 dev-cycle slice, 2026-05-19
 * — operator option (4) `/dev-cycle --loop` automated sequence; cut
 * from parent EXTR-1A.2c parent slice into 2c.1 skeleton + 2c.2
 * vendor swap per PR #99 / #100 precedent).
 *
 * DEC-010 §8 strict-schema mapping: when `LlmInvokeParams.responseFormat`
 * is the OpenAI-shaped `json_schema` payload (the canonical shape
 * carried by `ARTICLE_EXTRACTION_JSON_SCHEMA`), the client translates
 * it to Anthropic's strict tool-input contract — a single forced tool
 * call (`tool_choice: { type: "tool", name }`) with the schema lifted
 * into the tool's `input_schema`. The model's `tool_use` block
 * `input` is then `JSON.stringify`d so the extractor's downstream
 * `parseExtractedArticle()` receives the same wire form as the OpenAI
 * path.
 */

import {
  LlmIncompleteResultError,
  type LlmClient,
  type LlmInvokeParams,
  type LlmInvokeResult,
  type LlmTier,
} from "./client";

/**
 * Per-tier default Anthropic model identifiers (DEC-010 §Core lock
 * item 1 + ADR-0023 §statement). Operator decision wires these to
 * real Anthropic catalog names. Override at construction time when a
 * specific `model` is required.
 *
 * Mapping per DEC-010 routing table:
 *   - Tier 0: Opus 4.7 extended thinking (scenario validate
 *     adversarial / high-stakes thesis cross-vendor review)
 *   - Tier 1: Sonnet 4.6 (cross-vendor review companion to GPT-5.5
 *     Pro standard)
 *   - Tier 2: Sonnet 4.6 (Korean long-context extraction override —
 *     EXTR-1A.2c.2 wires the swap heuristic; this skeleton keeps the
 *     identifier consistent so callers can construct AnthropicClient
 *     today)
 *   - Tier 3: Haiku 4.5 (cost-efficient preflight cite check
 *     cross-vendor pair to GPT-5 nano)
 *
 * **TODO (ADR-0023 ratification)**: canonical Anthropic catalog
 * identifiers for Claude 4.x family need verification against the
 * Anthropic Messages API at integration time. Placeholders below
 * match Anthropic's public naming convention as of EXTR-1A.2c
 * authoring (2026-05); dated suffixes (`-YYYYMMDD`) arrive from
 * `response.model` at runtime and are handled by longest-prefix
 * matching in `resolveAnthropicPricingKey`.
 */
export const ANTHROPIC_TIER_DEFAULT_MODEL: Record<LlmTier, string> = {
  0: "claude-opus-4-7",
  1: "claude-sonnet-4-6",
  2: "claude-sonnet-4-6",
  3: "claude-haiku-4-5",
};

/**
 * Per-model USD pricing per 1 million tokens. Used by
 * `computeAnthropicTotalCostUsd` to satisfy the OPS-1A.1 `completeRun`
 * contract (AC-019 — null cost is rejected).
 *
 * **TODO (ADR-0023 ratification)**: actual Anthropic list prices need
 * verification at integration time (follow-up parallel to PR #101's
 * OpenAI pricing ratification). Placeholders below derive from
 * Anthropic's public list pricing for the Claude 4.x family as of
 * EXTR-1A.2c authoring (2026-05). `cachedInput` reflects Anthropic
 * prompt-caching read pricing (~10% of standard input); cache write
 * (cache_creation_input_tokens) is billed separately at ~125% of
 * standard input — this client treats cache_creation as standard
 * input for v1 cost calc and surfaces refinement as an ADR-0023
 * ratification follow-up so AC-019 aggregation does not undercount.
 *
 * Dated snapshots (e.g. `claude-sonnet-4-6-20260101`) returned in
 * `response.model` are routed to the matching alias via
 * longest-prefix lookup in `resolveAnthropicPricingKey`.
 */
export const ANTHROPIC_PRICING_USD_PER_1M_TOKENS: Record<
  string,
  { input: number; output: number; cachedInput?: number }
> = {
  // Placeholders — ratification follow-up tracked alongside the
  // OpenAI pricing ratification pattern (PR #101). Operator must
  // verify each value against the Anthropic Messages API catalog
  // before EXTR-1A.2c.2 wires the real-vendor swap into
  // ArticleExtractor's billable path.
  "claude-opus-4-7": { input: 15.0, output: 75.0, cachedInput: 1.5 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cachedInput: 0.3 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0, cachedInput: 0.08 },
};

/**
 * Thrown when `computeAnthropicTotalCostUsd` is asked to price a
 * model that has no entry in `ANTHROPIC_PRICING_USD_PER_1M_TOKENS`
 * (exact or longest-prefix). Mirrors `OpenAIPricingUnknownError` — a
 * silent fallback would undercount the most expensive (scenario /
 * thesis) runs whenever callers passed a real SKU ID the table did
 * not yet know about. Operator must add the new SKU to the pricing
 * table before the client can charge for it.
 */
export class AnthropicPricingUnknownError extends Error {
  constructor(public readonly model: string) {
    super(
      `Anthropic pricing unknown for model '${model}' — add to ANTHROPIC_PRICING_USD_PER_1M_TOKENS (or a dated snapshot prefix) before invoking. Silent fallback removed to prevent AC-019 cost undercount.`,
    );
    this.name = "AnthropicPricingUnknownError";
  }
}

/**
 * Resolve a model identifier to the pricing-table key, handling
 * dated Anthropic snapshots. Anthropic returns `response.model` as
 * the resolved dated snapshot (e.g. `claude-sonnet-4-6-20260101`)
 * even when the request used the alias. Longest-alias-wins so
 * `claude-sonnet-4-6-...` is not eaten by a shorter `claude-sonnet-`
 * prefix.
 */
export function resolveAnthropicPricingKey(model: string): string | null {
  if (model in ANTHROPIC_PRICING_USD_PER_1M_TOKENS) return model;
  const aliases = Object.keys(ANTHROPIC_PRICING_USD_PER_1M_TOKENS).sort(
    (a, b) => b.length - a.length,
  );
  for (const alias of aliases) {
    if (model === alias || model.startsWith(`${alias}-`)) return alias;
  }
  return null;
}

/**
 * Compute total USD cost for an Anthropic invocation. Unknown models
 * throw `AnthropicPricingUnknownError` so explicit Opus / new-SKU
 * calls that the table does not yet know about surface as a hard
 * error instead of being billed at Sonnet (or other) rates.
 */
export function computeAnthropicTotalCostUsd(
  model: string,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
  },
): number {
  const key = resolveAnthropicPricingKey(model);
  if (key === null) throw new AnthropicPricingUnknownError(model);
  const pricing = ANTHROPIC_PRICING_USD_PER_1M_TOKENS[key]!;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cached = usage.cachedTokens ?? 0;
  const nonCached = Math.max(0, input - cached);
  const inputCost = (nonCached / 1_000_000) * pricing.input;
  const cachedCost =
    (cached / 1_000_000) * (pricing.cachedInput ?? pricing.input);
  const outputCost = (output / 1_000_000) * pricing.output;
  return inputCost + cachedCost + outputCost;
}

export interface AnthropicClientOptions {
  /**
   * Anthropic API key. If omitted, falls back to
   * `process.env.ANTHROPIC_API_KEY`. Throws if neither resolves to a
   * non-empty string (fail-fast on misconfiguration).
   */
  readonly apiKey?: string;
  readonly tier?: LlmTier;
  /**
   * Explicit model identifier override. Defaults to
   * `ANTHROPIC_TIER_DEFAULT_MODEL[tier]`. Constructor validates that
   * the resolved model has a pricing entry; unknown SKUs throw
   * `AnthropicPricingUnknownError` BEFORE any billable API call so
   * failed-but-billable rows do not slip into the ledger without
   * cost.
   */
  readonly model?: string;
  /**
   * Injectable fetch implementation for tests. Defaults to
   * `globalThis.fetch`.
   */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Override the API base URL. Defaults to
   * `https://api.anthropic.com/v1`.
   */
  readonly baseUrl?: string;
  /**
   * Anthropic Messages API version pinning. Defaults to
   * `2023-06-01` (the current `anthropic-version` header value as of
   * EXTR-1A.2c authoring). Override only when adopting a new API
   * version contract.
   */
  readonly anthropicVersion?: string;
  /**
   * Request timeout in milliseconds. Unbounded `fetch` could leave
   * run_ledger rows in `running` forever on network stalls.
   * Defaults to 60_000 (60s).
   */
  readonly timeoutMs?: number;
}

export class AnthropicRequestTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly model: string,
  ) {
    super(
      `Anthropic request timed out after ${timeoutMs}ms (model='${model}'). The run_ledger row will be marked failed.`,
    );
    this.name = "AnthropicRequestTimeoutError";
  }
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Per-tier default `max_tokens` cap. Bounds Anthropic output
 * regardless of caller. Values mirror the OpenAI client's conservative
 * envelopes for the extraction stage — extractor outputs are short
 * JSON envelopes, not free-form prose. Callers may override via
 * `LlmInvokeParams.maxOutputTokens` for stages that legitimately need
 * more.
 */
export const ANTHROPIC_TIER_DEFAULT_MAX_OUTPUT_TOKENS: Record<LlmTier, number> = {
  0: 4_000,
  1: 4_000,
  2: 2_000,
  3: 1_000,
};

interface AnthropicMessagesResponseShape {
  /**
   * Resolved model snapshot returned by Anthropic (e.g.
   * `claude-sonnet-4-6-20260101` when the request used the alias
   * `claude-sonnet-4-6`). Preferred over `AnthropicClient.model` for
   * the ledger model_id so the row records the dated snapshot that
   * actually produced the result.
   */
  model?: string;
  /**
   * Anthropic Messages API termination reason. Values: `end_turn`
   * (natural completion), `max_tokens` (output truncated by
   * `max_tokens` cap), `stop_sequence` (custom stop sequence
   * matched — not used by this client), `tool_use` (model invoked a
   * tool — the strict-schema path).
   */
  stop_reason?: string | null;
  content?: Array<
    | { type: "text"; text?: string }
    | {
        type: "tool_use";
        id?: string;
        name?: string;
        input?: unknown;
      }
  >;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    /**
     * Tokens served from a prior prompt-cache hit. Mirrors OpenAI's
     * `prompt_tokens_details.cached_tokens` for cost accounting.
     */
    cache_read_input_tokens?: number;
    /**
     * Tokens written into the prompt cache on this call. Billed at
     * ~125% of standard input by Anthropic. v1 cost calc folds this
     * into the standard input total via the `input_tokens` field
     * (Anthropic includes cache_creation in `input_tokens` already);
     * surfacing here is informational. ADR-0023 ratification will
     * decide whether to break the write out into a separate priced
     * bucket.
     */
    cache_creation_input_tokens?: number;
  };
}

export class AnthropicApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(
      `Anthropic API error: status=${status} body=${responseBody.slice(0, 500)}`,
    );
    this.name = "AnthropicApiError";
  }
}

/**
 * Thrown when Anthropic returns a 200 response whose first content
 * block did NOT terminate with a usable result — e.g.
 * `stop_reason: "max_tokens"` (token cap hit), missing content,
 * forced tool call with no `tool_use` block in `content[]`, or
 * present `tool_use` block whose `input` is not a JSON object.
 * Extends `LlmIncompleteResultError` so the extractor catch path can
 * record the billable usage on the failed run_ledger row.
 */
export class AnthropicIncompleteCompletionError extends LlmIncompleteResultError {
  constructor(
    reason: string,
    partialText: string,
    usage?: {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly cachedTokens?: number;
      readonly totalCostUsd?: number;
      readonly modelId?: string;
    },
  ) {
    super(reason, partialText, usage);
    this.name = "AnthropicIncompleteCompletionError";
  }
  get stopReason(): string {
    return this.reason;
  }
}

/**
 * Detect whether a caller's `responseFormat` is the OpenAI-shaped
 * `json_schema` envelope (the canonical shape carried by
 * `ARTICLE_EXTRACTION_JSON_SCHEMA`). When true, the client lifts the
 * inner `json_schema.schema` into an Anthropic `tools[].input_schema`
 * and forces the tool call via `tool_choice`. Detection is
 * intentionally strict — unrecognized shapes pass through unchanged
 * so future vendor-native shapes do not silently route through the
 * tool path.
 */
function isJsonSchemaResponseFormat(rf: unknown): rf is {
  type: "json_schema";
  json_schema: { name: string; schema: Record<string, unknown> };
} {
  if (rf === null || typeof rf !== "object") return false;
  const obj = rf as Record<string, unknown>;
  if (obj["type"] !== "json_schema") return false;
  const js = obj["json_schema"];
  if (js === null || typeof js !== "object") return false;
  const jsObj = js as Record<string, unknown>;
  return (
    typeof jsObj["name"] === "string" &&
    jsObj["schema"] !== null &&
    typeof jsObj["schema"] === "object"
  );
}

export class AnthropicClient implements LlmClient {
  readonly vendor = "anthropic" as const;
  readonly tier: LlmTier;
  readonly model: string;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly anthropicVersion: string;
  private readonly timeoutMs: number;

  constructor(opts: AnthropicClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    if (!apiKey || apiKey.trim() === "") {
      throw new Error(
        "AnthropicClient: apiKey required (pass via constructor option or set ANTHROPIC_API_KEY env var)",
      );
    }
    this.apiKey = apiKey;
    this.tier = opts.tier ?? 2;
    // Tier 0 default (Opus 4.7) is a placeholder pending DEC-010 /
    // ADR-0023 ratification — require explicit `model` so the
    // operator owns the routing decision (matches OpenAIClient's
    // tier=0/1 explicit-model guard).
    if (this.tier === 0 && opts.model === undefined) {
      throw new Error(
        `AnthropicClient: tier=${this.tier} (DEC-010 cross-vendor reviewer tier) requires an explicit \`model\` option — defaults are placeholders pending ADR-0023 ratification. Pass \`model\` explicitly or use a Tier 1/2/3 default.`,
      );
    }
    this.model = opts.model ?? ANTHROPIC_TIER_DEFAULT_MODEL[this.tier];

    // Pre-API pricing validation. computeAnthropicTotalCostUsd
    // already throws post-response, but that fires AFTER the call
    // has been billed. Validate at construction so the failure
    // happens before any ledger row is opened.
    if (resolveAnthropicPricingKey(this.model) === null) {
      throw new AnthropicPricingUnknownError(this.model);
    }

    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.anthropicVersion = opts.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        `AnthropicClient: timeoutMs must be a positive finite number, got ${timeoutMs}`,
      );
    }
    this.timeoutMs = timeoutMs;
  }

  async invoke(params: LlmInvokeParams): Promise<LlmInvokeResult> {
    const url = `${this.baseUrl}/messages`;
    const maxTokens =
      params.maxOutputTokens ?? ANTHROPIC_TIER_DEFAULT_MAX_OUTPUT_TOKENS[this.tier];
    // DEC-010 §8 requires temperature=0 for extract / cite_check /
    // thesis. Default to 0 here; scenario callers override via
    // LlmInvokeParams.temperature=0.3.
    const temperature = params.temperature ?? 0;

    const requestBody: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.userPrompt }],
      temperature,
    };

    // DEC-010 §8 strict-schema mapping. When the caller passes the
    // OpenAI-shaped `{ type: "json_schema", json_schema: {...} }`
    // envelope, translate to Anthropic's forced-tool contract: one
    // tool whose input_schema is the lifted schema, plus
    // `tool_choice: { type: "tool", name }` so the model MUST emit
    // the structured payload via tool_use. Unrecognized shapes pass
    // through unchanged (vendor-native shapes can be added in
    // follow-up slices).
    let toolName: string | null = null;
    if (params.responseFormat !== undefined) {
      if (isJsonSchemaResponseFormat(params.responseFormat)) {
        toolName = params.responseFormat.json_schema.name;
        requestBody["tools"] = [
          {
            name: toolName,
            input_schema: params.responseFormat.json_schema.schema,
          },
        ];
        requestBody["tool_choice"] = { type: "tool", name: toolName };
      } else {
        // Vendor-native shapes (future): forward unchanged so callers
        // can opt into Anthropic-specific knobs without going through
        // the json_schema translation.
        Object.assign(requestBody, params.responseFormat);
      }
    }

    const body = JSON.stringify(requestBody);

    // Bounded request via AbortSignal. Keep the timer alive through
    // the body read (response.json()/text() can stall after headers
    // arrive).
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.timeoutMs);
    const onAbortThrow = (err: unknown): never => {
      if (abortController.signal.aborted) {
        throw new AnthropicRequestTimeoutError(this.timeoutMs, this.model);
      }
      throw err;
    };
    let response: Response;
    let data: AnthropicMessagesResponseShape;
    try {
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": this.anthropicVersion,
          },
          body,
          signal: abortController.signal,
        });
      } catch (err) {
        onAbortThrow(err);
        throw err;
      }

      if (!response.ok) {
        let errBody = "";
        try {
          errBody = await response.text();
        } catch (err) {
          onAbortThrow(err);
        }
        throw new AnthropicApiError(response.status, errBody);
      }

      try {
        data = (await response.json()) as AnthropicMessagesResponseShape;
      } catch (err) {
        onAbortThrow(err);
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }

    const resolvedModel =
      data.model && data.model.trim().length > 0 ? data.model : this.model;

    // Strict usage validation — both input_tokens and output_tokens
    // must be present non-negative integers. cache_read is optional.
    // Mirrors OpenAIClient round 6 F21: silent acceptance of
    // missing/null counters would let buildBillableUsage emit
    // payloads failRun rejects, leaving rows stuck in `running`.
    const usageBlock = data.usage;
    const inputTokensRaw = usageBlock?.input_tokens;
    const outputTokensRaw = usageBlock?.output_tokens;
    const cachedTokensRaw = usageBlock?.cache_read_input_tokens;
    const isCounter = (n: unknown): n is number =>
      typeof n === "number" && Number.isInteger(n) && n >= 0;
    const inputTokens = isCounter(inputTokensRaw) ? inputTokensRaw : undefined;
    const outputTokens = isCounter(outputTokensRaw)
      ? outputTokensRaw
      : undefined;
    const cachedTokens = isCounter(cachedTokensRaw)
      ? cachedTokensRaw
      : undefined;
    // Reject impossible accounting where cached > input (matches
    // OpenAIClient round 8 F29 — protects AC-019 against inflated
    // cost from malformed provider responses).
    const usageInconsistent =
      cachedTokens !== undefined &&
      inputTokens !== undefined &&
      cachedTokens > inputTokens;
    const usagePresent =
      usageBlock !== undefined &&
      inputTokens !== undefined &&
      outputTokens !== undefined &&
      !usageInconsistent;

    const buildBillableUsage = () =>
      usagePresent
        ? {
            inputTokens,
            outputTokens,
            cachedTokens,
            totalCostUsd: computeAnthropicTotalCostUsd(resolvedModel, {
              inputTokens,
              outputTokens,
              cachedTokens,
            }),
            modelId: resolvedModel,
          }
        : undefined;

    // Extract text. Two paths:
    //   - tool_use (forced-tool strict-schema path): find the
    //     content block whose `name` matches the forced tool, JSON-
    //     stringify its `input` so the extractor's downstream
    //     `parseExtractedArticle()` receives a string identical in
    //     wire form to the OpenAI json_schema path.
    //   - text (free-form path): concat content[].text blocks.
    const contentBlocks = Array.isArray(data.content) ? data.content : [];

    if (toolName !== null) {
      const toolUseBlock = contentBlocks.find(
        (b): b is { type: "tool_use"; name?: string; input?: unknown } =>
          b.type === "tool_use" && b.name === toolName,
      );
      if (toolUseBlock === undefined) {
        throw new AnthropicIncompleteCompletionError(
          "missing_tool_use",
          "",
          buildBillableUsage(),
        );
      }
      // Anthropic delivers `input` as a parsed JSON object on the
      // tool_use block. Reject non-object inputs (string / array /
      // null) so the extractor never sees a malformed strict-schema
      // payload masquerading as success.
      const toolInput = toolUseBlock.input;
      if (
        toolInput === null ||
        typeof toolInput !== "object" ||
        Array.isArray(toolInput)
      ) {
        throw new AnthropicIncompleteCompletionError(
          "malformed_tool_input",
          "",
          buildBillableUsage(),
        );
      }
      // Reject truncated tool calls (max_tokens hit while emitting
      // tool_use) explicitly — Anthropic stops mid-JSON and may have
      // delivered a partial object. The strict-schema invariant
      // depends on completion.
      if (data.stop_reason === "max_tokens") {
        throw new AnthropicIncompleteCompletionError(
          "max_tokens",
          JSON.stringify(toolInput),
          buildBillableUsage(),
        );
      }
      const text = JSON.stringify(toolInput);

      if (!usagePresent) {
        throw new AnthropicIncompleteCompletionError(
          usageInconsistent ? "usage_inconsistent" : "missing_usage",
          text,
          undefined,
        );
      }

      const totalCostUsd = computeAnthropicTotalCostUsd(resolvedModel, {
        inputTokens,
        outputTokens,
        cachedTokens,
      });

      return {
        text,
        vendor: "anthropic",
        model: resolvedModel,
        tier: this.tier,
        inputTokens,
        outputTokens,
        cachedTokens,
        totalCostUsd,
      };
    }

    // Free-form text path (no strict schema forced).
    const textBlocks = contentBlocks.filter(
      (b): b is { type: "text"; text?: string } => b.type === "text",
    );
    if (textBlocks.length === 0) {
      throw new AnthropicIncompleteCompletionError(
        "missing_content",
        "",
        buildBillableUsage(),
      );
    }
    // Reject non-string text fields — a malformed provider response
    // could send `text: null` or `text: []`; treat as incomplete so
    // the ledger goes to failRun.
    for (const block of textBlocks) {
      if (typeof block.text !== "string") {
        throw new AnthropicIncompleteCompletionError(
          "missing_content",
          "",
          buildBillableUsage(),
        );
      }
    }
    const text = textBlocks.map((b) => b.text as string).join("");

    // Reject truncated free-form completions (max_tokens hit).
    if (data.stop_reason === "max_tokens") {
      throw new AnthropicIncompleteCompletionError(
        "max_tokens",
        text,
        buildBillableUsage(),
      );
    }

    if (!usagePresent) {
      throw new AnthropicIncompleteCompletionError(
        usageInconsistent ? "usage_inconsistent" : "missing_usage",
        text,
        undefined,
      );
    }

    const totalCostUsd = computeAnthropicTotalCostUsd(resolvedModel, {
      inputTokens,
      outputTokens,
      cachedTokens,
    });

    return {
      text,
      vendor: "anthropic",
      model: resolvedModel,
      tier: this.tier,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalCostUsd,
    };
  }
}
