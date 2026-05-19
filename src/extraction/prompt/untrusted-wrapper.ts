/**
 * Untrusted-content sentinel wrapper for LLM input (ADR-0029 INV-0029-1
 * + INV-0029-3).
 *
 * Wraps external-source content in a `<untrusted>...</untrusted>` block
 * and enforces the per-tier token cap from INV-0029-3:
 *
 *   - GPT-5 nano (Tier 3): 4,000 tokens
 *   - GPT-5 mini (Tier 2): 8,000 tokens
 *   - Tier 1+:            16,000 tokens
 *
 * The system prompt must include a warning that the `<untrusted>` block
 * may contain arbitrary instructions and is to be treated as analysis
 * data only (per INV-0029-1 caller contract). This module DOES NOT emit
 * the system-prompt warning; it only does the wrapping + truncation.
 *
 * Operator decision: EXTR-1A.0 prerequisite slice (PRE-0029-2).
 */

/**
 * Tier-indexed token caps mirroring ADR-0029 INV-0029-3. Indexing is by
 * the Tier number (0 / 1 / 2 / 3) — Tier 0 uses the same cap as Tier 1+.
 */
export const TIER_TOKEN_CAPS: Record<0 | 1 | 2 | 3, number> = {
  0: 16_000,
  1: 16_000,
  2: 8_000,
  3: 4_000,
};

/**
 * Heuristic chars-per-token ratio used when caller passes `maxTokens`
 * without pre-truncating. ~4 chars/token is the conventional English /
 * mixed-content approximation. Korean / CJK content runs hotter
 * (~1.5–2 chars/token), so this ratio is INTENTIONALLY conservative
 * (over-trimming rather than under-trimming) — the goal is prompt-
 * injection payload dilution, not maximum content density.
 *
 * For precise tokenization, the caller may pre-truncate using the
 * vendor's tokenizer and pass already-trimmed `content` plus a high
 * `maxTokens` cap that will not bind.
 */
export const CHARS_PER_TOKEN_HEURISTIC = 4;

export interface WrapUntrustedOptions {
  /**
   * Token cap for the wrapped content. Content is truncated (via
   * `CHARS_PER_TOKEN_HEURISTIC`) to roughly `maxTokens * 4` characters.
   * Pass one of `TIER_TOKEN_CAPS[tier]` for canonical caps.
   */
  maxTokens: number;
  /**
   * Optional opening / closing sentinel override. Default is
   * `<untrusted>` / `</untrusted>` per INV-0029-1.
   */
  openSentinel?: string;
  closeSentinel?: string;
}

/**
 * Wrap external-source content in the untrusted sentinel and enforce
 * the per-tier token cap.
 *
 * Returns the wrapped string suitable for inclusion in the LLM `user`
 * (or `tool`) message. The caller MUST include the INV-0029-1 system-
 * prompt warning so the LLM treats the block as data, not instruction.
 */
export function wrapUntrusted(
  content: string,
  opts: WrapUntrustedOptions,
): string {
  if (typeof content !== "string") {
    throw new TypeError(
      `wrapUntrusted: content must be a string (got ${typeof content})`,
    );
  }
  if (!Number.isFinite(opts.maxTokens) || opts.maxTokens <= 0) {
    throw new RangeError(
      `wrapUntrusted: maxTokens must be a positive finite number (got ${opts.maxTokens})`,
    );
  }

  const open = opts.openSentinel ?? "<untrusted>";
  const close = opts.closeSentinel ?? "</untrusted>";

  const maxChars = Math.floor(opts.maxTokens * CHARS_PER_TOKEN_HEURISTIC);
  const truncated =
    content.length <= maxChars ? content : content.slice(0, maxChars);

  return `${open}\n${truncated}\n${close}`;
}

/**
 * Convenience helper: wrap with the canonical tier cap.
 *
 * Example:
 *   wrapUntrustedForTier(text, 2)  // 8,000-token cap for GPT-5 mini
 */
export function wrapUntrustedForTier(
  content: string,
  tier: 0 | 1 | 2 | 3,
): string {
  return wrapUntrusted(content, { maxTokens: TIER_TOKEN_CAPS[tier] });
}
