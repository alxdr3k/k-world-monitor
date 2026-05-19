/**
 * LLM client abstraction for the extraction layer (EXTR-1A.2a).
 *
 * Vendor-agnostic interface that concrete clients (OpenAI Tier 2 in
 * EXTR-1A.2b, Anthropic Sonnet override in EXTR-1A.2c, plus a mock
 * for tests) implement. Keeps the article / report extractors free
 * of vendor-specific wiring.
 *
 * The interface is intentionally small — the extractor assembles the
 * full prompt (system + user, where `userPrompt` is already wrapped
 * in `<untrusted>...</untrusted>` per ADR-0029 INV-0029-1) and passes
 * it through. Streaming is not exposed at this layer (extractors
 * await the full response to return a single `ExtractorOutput`
 * envelope per AC-009).
 *
 * Operator decision: EXTR-1A.2a (Cycle 40, operator delegated cut
 * "그럼 몇 개의 슬라이스로 나눠서 작업해" 2026-05-19).
 */

import type { LlmVendor } from "../../utils/enums";

/**
 * Tier index aligned to ADR-0023 + INV-0029-3 caps. Mirrors
 * `TIER_TOKEN_CAPS` in `src/extraction/prompt/untrusted-wrapper.ts`.
 */
export type LlmTier = 0 | 1 | 2 | 3;

export interface LlmInvokeParams {
  /**
   * Pre-built system prompt. INV-0029-1 contract requires the system
   * prompt to warn the model that the `<untrusted>...</untrusted>`
   * block in `userPrompt` is data, not instructions. Concrete
   * extractors own this warning (see `ARTICLE_EXTRACTION_SYSTEM_PROMPT`).
   */
  readonly systemPrompt: string;
  /**
   * Pre-built user prompt. MUST already be wrapped in
   * `<untrusted>...</untrusted>` (or the caller's configured
   * sentinel) per INV-0029-1. The client does NOT wrap or escape —
   * that obligation is on the extractor calling `wrapUntrusted()`.
   */
  readonly userPrompt: string;
  /**
   * Tier hint — concrete clients use this to pick model + per-tier
   * limits (ADR-0023). Mock clients ignore it.
   */
  readonly tier: LlmTier;
  /**
   * Optional output token cap. If omitted, the concrete client uses
   * its own per-tier default.
   */
  readonly maxOutputTokens?: number;
  /**
   * Sampling temperature override (DEC-010 §8 + PR #100 codex
   * round 6 F19). Concrete clients default to `0` for extract /
   * cite_check / thesis stages; scenario branch passes `0.3`. Mock
   * clients ignore it.
   */
  readonly temperature?: number;
  /**
   * Structured-output schema (DEC-010 §8 strict schema invariant).
   * When supplied, concrete clients map it to the vendor's native
   * structured-output API (OpenAI `response_format: json_schema`,
   * Anthropic `tool_choice` with strict input schema, Google
   * `responseSchema`). PR #100 codex round 6 F19 — surface added
   * so future ArticleExtractor schema can flow through without
   * client changes. Caller owns the schema definition. Free-form
   * text remains the default when omitted.
   */
  readonly responseFormat?: Record<string, unknown>;
}

export interface LlmInvokeResult {
  readonly text: string;
  readonly vendor: LlmVendor | "mock";
  /**
   * Concrete model identifier (e.g. `gpt-5-mini-2025-08-07`). Mock
   * clients return a stable placeholder.
   */
  readonly model: string;
  readonly tier: LlmTier;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /**
   * Cached input tokens (OpenAI prompt caching / Anthropic prompt
   * caching). Optional — not all vendors expose this.
   */
  readonly cachedTokens?: number;
  /**
   * Total cost in USD for this invocation. Required by the OPS-1A.1
   * run_ledger (AC-019 — `completeRun` rejects null cost to prevent
   * silent SUM aggregation loss). Concrete clients compute this from
   * per-token pricing × token counts (PR #99 codex round 2 + EXTR-
   * 1A.2b).
   */
  readonly totalCostUsd?: number;
}

/**
 * LLM client contract. Vendor-agnostic. Concrete clients (OpenAI
 * Responses API, Anthropic Messages, etc.) declare their canonical
 * `vendor` + `tier` + `model` at construction time so the calling
 * extractor can issue `startRun` ledger rows BEFORE invoke completes
 * (EXTR-1A.2b run_ledger integration — the ledger row needs vendor +
 * tier + modelId up front; the per-call counters arrive via
 * `LlmInvokeResult` post-invoke).
 */
export interface LlmClient {
  readonly vendor: LlmVendor | "mock";
  readonly tier: LlmTier;
  readonly model: string;
  invoke(params: LlmInvokeParams): Promise<LlmInvokeResult>;
}

/**
 * Vendor-agnostic incomplete-invocation error (PR #100 codex round
 * 4). Concrete vendor clients extend this when they detect that the
 * response did not produce a usable result but the API call was
 * billable (e.g. OpenAI `finish_reason: "length"` with non-zero
 * usage). The optional `usage` payload allows the caller (extractor)
 * to record the billable cost on the failed run_ledger row instead
 * of recording a NULL cost that would disappear from AC-019 daily
 * aggregation.
 */
export class LlmIncompleteResultError extends Error {
  constructor(
    public readonly reason: string,
    public readonly partialText: string,
    public readonly usage?: {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly cachedTokens?: number;
      readonly totalCostUsd?: number;
      /**
       * Resolved model snapshot (e.g. `gpt-5-mini-2025-08-07`) for
       * the failed billable call. When provided, the extractor's
       * failRun path rewrites `run_ledger.model_id` from the
       * request-time alias to this snapshot so failed billable rows
       * retain the same reproducibility anchor as completed rows
       * (PR #100 codex round 5 F15).
       */
      readonly modelId?: string;
    },
  ) {
    super(
      `LLM invocation incomplete: reason='${reason}' (partial text length=${partialText.length})`,
    );
    this.name = "LlmIncompleteResultError";
  }
}
