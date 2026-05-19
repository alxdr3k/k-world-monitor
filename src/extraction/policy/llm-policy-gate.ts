/**
 * external_llm_policy gate for extraction layer LLM calls
 * (ADR-0029 INV-0029-4, ADR-0017 source policy gate compliance).
 *
 * Reads `source_material_policy.external_llm_policy` for a given
 * `source_id` and throws a typed error when the source is `prohibited`
 * or `manual_review_required`. Allows the caller to proceed only when
 * `external_llm_policy = 'allowed'`.
 *
 * EXTR-1A.0 prerequisite slice for EXTR-1A.1 extractor router
 * (PRE-0029-2). The extractor router MUST call `checkLlmPolicy` before
 * any LLM API invocation; linter / convention enforcement is the
 * EXTR-1A.1 concern.
 */

import type { Database } from "bun:sqlite";
import { getDb } from "../../storage/sqlite/connection";

export class LlmProhibitedError extends Error {
  readonly sourceId: string;
  constructor(sourceId: string) {
    super(
      `LLM call prohibited for source '${sourceId}' — source_material_policy.external_llm_policy = 'prohibited' (ADR-0029 INV-0029-4)`,
    );
    this.name = "LlmProhibitedError";
    this.sourceId = sourceId;
  }
}

export class LlmManualReviewRequiredError extends Error {
  readonly sourceId: string;
  constructor(sourceId: string) {
    super(
      `LLM call requires operator approval for source '${sourceId}' — source_material_policy.external_llm_policy = 'manual_review_required' (ADR-0029 INV-0029-4); auto LLM call blocked`,
    );
    this.name = "LlmManualReviewRequiredError";
    this.sourceId = sourceId;
  }
}

export class SourceNotRegisteredError extends Error {
  readonly sourceId: string;
  constructor(sourceId: string) {
    super(
      `source '${sourceId}' not found in source_material_policy — LLM call blocked fail-closed (ADR-0029 INV-0029-4 + ADR-0017 unregistered source default)`,
    );
    this.name = "SourceNotRegisteredError";
    this.sourceId = sourceId;
  }
}

/**
 * Allowed enum values for `source_material_policy.external_llm_policy`
 * mirroring the v1 SQLite CHECK constraint.
 */
export type ExternalLlmPolicy =
  | "allowed"
  | "manual_review_required"
  | "prohibited";

/**
 * Throws if the source's `external_llm_policy` blocks LLM auto-calls.
 *
 * - `prohibited`: throws `LlmProhibitedError`.
 * - `manual_review_required`: throws `LlmManualReviewRequiredError`.
 * - `allowed`: returns silently.
 * - source not registered: throws `SourceNotRegisteredError`
 *   (fail-closed — ADR-0017 unregistered source default mirrors
 *   `manual_review_required`).
 *
 * Defensive: any other enum value (should not happen due to SQLite
 * CHECK constraint) is treated as fail-closed via `LlmProhibitedError`.
 */
export function checkLlmPolicy(sourceId: string, db: Database = getDb()): void {
  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    throw new TypeError(
      `checkLlmPolicy: sourceId must be a non-empty string (got ${JSON.stringify(sourceId)})`,
    );
  }

  const row = db
    .query("SELECT external_llm_policy FROM source_material_policy WHERE source_id = ? LIMIT 1")
    .get(sourceId) as { external_llm_policy: string } | null;

  if (row === null) {
    throw new SourceNotRegisteredError(sourceId);
  }

  switch (row.external_llm_policy) {
    case "allowed":
      return;
    case "manual_review_required":
      throw new LlmManualReviewRequiredError(sourceId);
    case "prohibited":
      throw new LlmProhibitedError(sourceId);
    default:
      // Defensive — SQLite CHECK should prevent this, but if a future
      // migration loosens the constraint, fail-closed.
      throw new LlmProhibitedError(sourceId);
  }
}
