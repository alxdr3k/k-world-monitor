/**
 * Text normalization utilities.
 * Used before SHA-256 hashing to ensure canonical form across all
 * evidence quotes, content hashes, and spec digests.
 */

/**
 * Canonical form: Unicode NFC + whitespace collapse + trim.
 * Apply before sha256Hex() whenever hashing user-supplied or scraped text.
 */
export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Truncate text to maxLen code points (not bytes).
 * Used to enforce the ≤ 200-character quote limit (AC-007).
 */
export function truncateCodePoints(s: string, maxLen: number): string {
  const chars = [...s];
  return chars.length <= maxLen ? s : chars.slice(0, maxLen).join("");
}

/**
 * Returns true if the normalized string is within the code-point limit.
 */
export function isWithinLimit(s: string, maxLen: number): boolean {
  return [...s].length <= maxLen;
}
