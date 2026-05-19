/**
 * Extractor router interface contract (ADR-0023 + ADR-0024 — EXTR-1A.1
 * extractor router slice, NFR-007 maintainability + AC-009 +
 * AC-021).
 *
 * Three source types branch into distinct extractor implementations
 * (REQ-009 / ADR-0006 §statement, superseded by ADR-0023 + ADR-0024):
 *
 *   - article: LLM-based (Tier 2 GPT-5 mini default — EXTR-1A.2)
 *   - dataset: Data Science Module — Polars + DuckDB + statsmodels +
 *     scipy deterministic transform → derived_metric_ledger row
 *     (ADR-0024, EXTR-1A.5). Raw payload over 1000 rows / 50 KB MUST
 *     compress to derived metric before LLM input (INV-0024-4 / INV-
 *     0023-6 — enforcement deferred to EXTR-1A.5).
 *   - report: LLM with structure prompt + section page locator
 *     (EXTR-1A.5).
 *
 * **AC-021 contract (NFR-007 maintainability)**: adding a new source
 * type requires (a) extending `SOURCE_TYPE` const + `SourceType` type,
 * (b) registering one new `Extractor` implementation, and (c) adding
 * one dry-run test. Existing branches are not touched — the router
 * looks up by sourceType in `ExtractorRegistry`.
 *
 * Operator decision: EXTR-1A.1 (Cycle 39, operator standing directive
 * "계속 진행" 2026-05-19 — D7 sequence).
 */

/**
 * Canonical extractor source-type enum. Matches REQ-009 statement.
 * Adding a new value extends the router contract (NFR-007 / AC-021).
 */
export const SOURCE_TYPE = ["article", "dataset", "report"] as const;
export type SourceType = (typeof SOURCE_TYPE)[number];

export function isSourceType(v: unknown): v is SourceType {
  return (
    typeof v === "string" && (SOURCE_TYPE as readonly string[]).includes(v)
  );
}

/**
 * Caller-provided input to the extractor router. The router does NOT
 * read the raw payload itself — it dispatches to the registered
 * `Extractor` for the given `sourceType`, which owns content-specific
 * sanitization / LLM-call / Data Science Module concerns.
 *
 * `sourceId` MUST be a registered source per ADR-0017 INV-0017-1
 * (unregistered → manual_review_required at the LLM policy gate —
 * `checkLlmPolicy()`). The router itself does NOT call the policy
 * gate; that obligation lies with the extractor implementations
 * (EXTR-1A.2 onward).
 */
export interface ExtractorInput {
  readonly sourceType: SourceType;
  readonly sourceId: string;
  readonly url?: string;
  /**
   * Raw fetched payload (HTML / JSON / CSV / etc.). The extractor
   * applies its own type-specific sanitization. For HTML article
   * payloads this typically routes through
   * `htmlToText` + `wrapUntrusted` (ADR-0029 INV-0029-1/3/5).
   */
  readonly rawContent: string;
  /**
   * Optional content metadata such as Content-Type header, charset,
   * row count for dataset payloads, etc. Schema is intentionally
   * open — each extractor reads its own keys.
   */
  readonly contentMetadata?: Readonly<Record<string, unknown>>;
}

/**
 * Common extractor output envelope. Type-specific result payload
 * lives in `result` and is shaped by each extractor (article →
 * structured claim set, dataset → derived metric pointer, report →
 * section-page-locator structured output).
 */
export interface ExtractorOutput {
  readonly sourceType: SourceType;
  readonly sourceId: string;
  readonly extractedAt: string; // ISO-8601 UTC
  /**
   * Extractor-specific result. Shape is owned by each concrete
   * `Extractor` implementation — the router contract is structural
   * (envelope + dispatch correctness), not schema-validating.
   */
  readonly result: unknown;
}

/**
 * Concrete extractor implementation contract. Each implementation
 * declares the `sourceType` it handles and exposes a pure async
 * `extract()` operation.
 */
export interface Extractor {
  readonly sourceType: SourceType;
  extract(input: ExtractorInput): Promise<ExtractorOutput>;
}
