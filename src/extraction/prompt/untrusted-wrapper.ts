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
 * Universally-safe chars-per-token ratio (PR #97 codex round 2 P2 —
 * 1.5 still allowed Chinese content (~1 char/token) to bypass the
 * INV-0029-3 cap at the canonical `wrapUntrustedForTier(..., 3)` path).
 *
 * Reference vendor tokenizer ratios:
 *   - English:               ~4 chars/token
 *   - Korean / Japanese:     ~1.5-2 chars/token
 *   - Chinese:               ~1-1.5 chars/token
 *   - Worst-case multi-byte: 1 char/token
 *
 * Using **1** is the smallest universal value that strictly caps every
 * supported language under INV-0029-3. The cap exists for prompt-
 * injection payload dilution + cost-ceiling enforcement; over-trim is
 * acceptable (any language) but under-trim is a violation. Callers
 * that need precise English tokenization (where 1 char/token over-trims
 * by ~4x) MAY pre-truncate with a vendor tokenizer and pass a large
 * `maxTokens` cap that does not bind here.
 */
export const CHARS_PER_TOKEN_HEURISTIC = 1;

const DEFAULT_OPEN_SENTINEL = "<untrusted>";
const DEFAULT_CLOSE_SENTINEL = "</untrusted>";

export interface WrapUntrustedOptions {
  /**
   * Token cap for the wrapped content. Content is truncated (via
   * `CHARS_PER_TOKEN_HEURISTIC = 1`) to exactly `maxTokens` characters
   * — universally-safe across English / CJK / multi-byte scripts.
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

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the bare tag name from a tag-form sentinel, e.g.
 * `<untrusted>` → `"untrusted"`, `</untrusted>` → `"untrusted"`.
 *
 * Returns `null` for sentinels that are not in single-tag form (e.g.
 * `<<MARK>>`, `===INPUT===`). In that case the caller falls back to
 * literal escape only.
 *
 * PR #97 codex round 5 P2 — needed so the whitespace/case-tolerant
 * tag-form escape can match `</untrusted >` etc. without affecting
 * non-tag custom sentinels.
 */
function tagNameFromSentinel(sentinel: string): string | null {
  const m = sentinel.match(/^<\s*\/?\s*([A-Za-z][A-Za-z0-9_-]*)\s*>$/);
  return m ? m[1] : null;
}

/**
 * Neutralize any occurrence of `openSentinel` or `closeSentinel` inside
 * `content` so an adversarial payload cannot close the wrapper early
 * and leak text outside the untrusted block (PR #97 codex review round
 * 1 P2 — INV-0029-1 isolation contract repair).
 *
 * Pipeline (PR #97 codex round 5 P2 — tag-form whitespace tolerance):
 *   1. **Tag-form whitespace-tolerant escape** — for sentinels in the
 *      `<NAME>` / `</NAME>` shape, match any whitespace/case variant
 *      that an HTML/XML parser or LLM would still treat as the
 *      closing tag (`</untrusted >`, `< /untrusted>`, `</UNTRUSTED >`,
 *      etc.). Non-tag custom sentinels skip this step.
 *   2. **Literal escape** — case-insensitive exact-string match for
 *      both tag-form and non-tag custom sentinels.
 *
 * Replacement form is a visibly distinct marker so prompt-engineering
 * inspection makes the substitution evident.
 */
export function escapeSentinelLiterals(
  content: string,
  openSentinel: string,
  closeSentinel: string,
): string {
  let out = content;

  // 1. Tag-form whitespace-tolerant escape (PR #97 codex round 5 P2).
  //    Replace closing first so a pair `<X>...</X>` becomes
  //    `[ESCAPED-OPEN]...[ESCAPED-CLOSE]` symmetrically.
  const closeTagName = tagNameFromSentinel(closeSentinel);
  if (closeTagName) {
    const closeTagRe = new RegExp(
      `<\\s*\\/\\s*${escapeForRegex(closeTagName)}\\s*>`,
      "gi",
    );
    out = out.replace(closeTagRe, "[ESCAPED-UNTRUSTED-CLOSE]");
  }
  const openTagName = tagNameFromSentinel(openSentinel);
  if (openTagName) {
    const openTagRe = new RegExp(
      `<\\s*${escapeForRegex(openTagName)}\\s*>`,
      "gi",
    );
    out = out.replace(openTagRe, "[ESCAPED-UNTRUSTED-OPEN]");
  }

  // 2. Literal exact-string escape (catches non-tag custom sentinels
  //    and any exact-form variant not already covered by step 1).
  const openRe = new RegExp(escapeForRegex(openSentinel), "gi");
  const closeRe = new RegExp(escapeForRegex(closeSentinel), "gi");
  out = out.replace(closeRe, "[ESCAPED-UNTRUSTED-CLOSE]");
  out = out.replace(openRe, "[ESCAPED-UNTRUSTED-OPEN]");
  return out;
}

/**
 * Wrap external-source content in the untrusted sentinel and enforce
 * the per-tier token cap.
 *
 * Steps (PR #97 codex round 1 P2):
 *   1. Escape any literal sentinel substring in content
 *      (`escapeSentinelLiterals`) — adversarial articles cannot close
 *      the wrapper early.
 *   2. Truncate to `maxTokens * CHARS_PER_TOKEN_HEURISTIC` characters
 *      (CJK-safe — see `CHARS_PER_TOKEN_HEURISTIC` docstring).
 *   3. Wrap in `<untrusted>\n{content}\n</untrusted>`.
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

  const open = opts.openSentinel ?? DEFAULT_OPEN_SENTINEL;
  const close = opts.closeSentinel ?? DEFAULT_CLOSE_SENTINEL;

  // 1. Escape embedded sentinel literals before truncation so length
  //    accounting reflects the safe form (escape replacement is longer
  //    than the original sentinel, so truncating after escape avoids
  //    over-budget output).
  const escaped = escapeSentinelLiterals(content, open, close);

  // 2. Truncate to per-language-safe chars cap.
  const maxChars = Math.floor(opts.maxTokens * CHARS_PER_TOKEN_HEURISTIC);
  const truncated =
    escaped.length <= maxChars ? escaped : escaped.slice(0, maxChars);

  // 3. Wrap.
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
