/**
 * SHA-256 hashing utilities.
 * Used for content_hash (Snapshot), quote_hash (Claim evidence),
 * spec_sha256 and library_version_lock_sha256 (derived_metric_ledger).
 */

import { createHash } from "crypto";

/**
 * Returns the SHA-256 hex digest of the input string (UTF-8 encoded).
 * Always normalize text with normalizeText() before hashing user content.
 */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Returns the first `prefixLen` hex characters of the SHA-256 digest.
 * Matches the eit_id format: `eit_<sha256[0:10]>` (ADR-0025).
 */
export function sha256Prefix(s: string, prefixLen: number): string {
  return sha256Hex(s).slice(0, prefixLen);
}
