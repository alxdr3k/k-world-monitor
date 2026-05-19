/**
 * Extractor router — dispatches `ExtractorInput` to the registered
 * `Extractor` for the input's `sourceType` (EXTR-1A.1, AC-009).
 *
 * The router is intentionally thin — it does NOT sanitize content,
 * apply policy gates, or call LLMs. Each concrete extractor
 * implementation (EXTR-1A.2 article, EXTR-1A.5 dataset / report)
 * owns its own pre-processing pipeline including the ADR-0029
 * INV-0029-* defenses (`htmlToText` / `wrapUntrusted` / etc.) and
 * INV-0029-4 LLM policy gate.
 *
 * Operator decision: EXTR-1A.1 (Cycle 39, 본 PR, operator standing
 * directive "계속 진행" 2026-05-19 — D7 sequence).
 */

import {
  InvalidSourceTypeError,
  type ExtractorRegistry,
} from "./registry";
import {
  isSourceType,
  type ExtractorInput,
  type ExtractorOutput,
} from "./types";

/**
 * Defensive validation of the `ExtractorInput` envelope. Rejects:
 *   - off-canonical `sourceType` (InvalidSourceTypeError)
 *   - non-string `sourceId` / empty `sourceId` (TypeError)
 *   - non-string `rawContent` (TypeError)
 *
 * The validation runs BEFORE the registry lookup so a missing
 * extractor never sees malformed input. Pure validation — no side
 * effects.
 */
function validateInput(input: ExtractorInput): void {
  if (!input || typeof input !== "object") {
    throw new TypeError(
      `routeAndExtract: input must be an object (got ${typeof input})`,
    );
  }
  if (!isSourceType(input.sourceType)) {
    throw new InvalidSourceTypeError(input.sourceType);
  }
  if (typeof input.sourceId !== "string" || input.sourceId.length === 0) {
    throw new TypeError(
      `routeAndExtract: sourceId must be a non-empty string (got ${typeof input.sourceId})`,
    );
  }
  if (typeof input.rawContent !== "string") {
    throw new TypeError(
      `routeAndExtract: rawContent must be a string (got ${typeof input.rawContent})`,
    );
  }
}

/**
 * Route the input to the registered extractor for its `sourceType`
 * and return the extractor's `ExtractorOutput`. Fails closed if:
 *   - input envelope is malformed (TypeError / InvalidSourceTypeError)
 *   - no extractor is registered for the sourceType
 *     (`ExtractorNotRegisteredError` from registry — propagated)
 *   - the extractor returns an output whose `sourceType` /
 *     `sourceId` does not match the input (envelope-mismatch fail-
 *     closed — defends against extractor wiring mistakes).
 */
export async function routeAndExtract(
  registry: ExtractorRegistry,
  input: ExtractorInput,
): Promise<ExtractorOutput> {
  validateInput(input);

  // Snapshot the envelope fields BEFORE the await so a misbehaving
  // extractor that mutates the input object cannot retroactively
  // change the post-dispatch consistency comparison. ExtractorInput
  // is declared `readonly` at the type level, but TypeScript does
  // not enforce immutability at runtime.
  const inputSourceType = input.sourceType;
  const inputSourceId = input.sourceId;

  const extractor = registry.get(inputSourceType);
  const output = await extractor.extract(input);

  // Envelope-consistency fail-closed — defend against an extractor
  // that returns a result tagged with the wrong sourceType / sourceId.
  if (output.sourceType !== inputSourceType) {
    throw new Error(
      `routeAndExtract: extractor returned sourceType=${output.sourceType} for input.sourceType=${inputSourceType}`,
    );
  }
  if (output.sourceId !== inputSourceId) {
    throw new Error(
      `routeAndExtract: extractor returned sourceId=${output.sourceId} for input.sourceId=${inputSourceId}`,
    );
  }

  return output;
}
