/**
 * Shared canonical constants and parsers for snap-prefixed identifiers
 * and the snapshot-stage R2 object-key prefix.
 *
 * INFRA-1A.x-shared-snapshot-id-constants (anchor registered as PR #66
 * Cycle 10 GPT review Finding 6 — silent-drift surface for the
 * snapshot ID shape regex, the canonical rationale prefix, and the
 * `permitted_artifact/derived/snapshot/` R2 key prefix that previously
 * lived as independent magic literals in 4 sites:
 *
 *   - src/storage/audit/policy-decisions.ts (writer-boundary shape guard)
 *   - src/ops/r2-invariant-scanner.ts (reader-boundary shape guard +
 *     rationale parser + expectedR2Key builder)
 *   - src/discovery/worker/snapshot-fingerprint.ts (r2Put key construction
 *     on dedup back-fill + new-path branches)
 *   - src/storage/r2/policy.ts (canonical PERMITTED_PREFIXES list)
 *
 * Consolidating here closes the drift surface noted in PR #66 review:
 * a regex/prefix change in one site without atomic propagation to the
 * others silently corrupts audit reconciliation (PR #66 Finding 1 was
 * the `(?=;|$)` delimiter strictness fix — exactly this class of issue).
 */

/**
 * Canonical shape for snap-prefixed identifiers. Weak contract by design:
 * the writer (snapshot-fingerprint.ts) generates `snap_<ULID>` via the
 * ulid library, but this regex accepts the broader `snap_[A-Za-z0-9_-]+`
 * so legacy/test fixtures (`snap_001`, `snap_test`, etc.) remain valid
 * for migration paths and reader-boundary validators.
 */
export const SNAPSHOT_ID_REGEX = /^snap_[A-Za-z0-9_-]+$/;

/**
 * Canonical rationale prefix regex for the
 * `policy_decisions.rationale` field. recordR2UploadDecision writes
 * `snap_id=<snap_id>; archive_policy=...; raw_cloud_policy=...; ...`
 * and the scanner parses the snap_id back via this regex's capture group.
 *
 * The `(?=;|$)` lookahead is the Cycle 10 strictness fix (PR #66
 * Finding 1): without it, `snap_id=snap_A@bad; ...` silently parses
 * as `snap_A` (truncation at the invalid char). The delimiter assertion
 * ensures invalid trailing chars surface as Axis 5
 * (malformed_r2_upload_audit_row) instead of truncated-drift.
 */
export const RATIONALE_SNAP_ID_PREFIX_REGEX =
  /^snap_id=(snap_[A-Za-z0-9_-]+)(?=;|$)/;

/**
 * Canonical R2 object-key prefix for Snapshot-stage permitted artifacts
 * (ADR-0012 INV-0012-3 / INV-0012-4). The full permitted-prefix list
 * lives in src/storage/r2/policy.ts PERMITTED_PREFIXES, which imports
 * this constant so the single literal is shared with every consumer
 * (snapshot-fingerprint r2Put key construction, scanner expectedR2Key
 * builder, and permitted-prefix policy gate).
 */
export const SNAPSHOT_R2_KEY_PREFIX = "permitted_artifact/derived/snapshot/";

/**
 * Build the deterministic R2 object key for a snapshot. Used by
 * snapshot-fingerprint on r2Put and by r2-invariant-scanner when
 * emitting repair-actionable `expectedR2Key` payloads.
 */
export function snapshotR2Key(snapId: string): string {
  return `${SNAPSHOT_R2_KEY_PREFIX}${snapId}`;
}

/**
 * Returns `value` if it matches SNAPSHOT_ID_REGEX, otherwise null.
 * Cheap nullable accessor for reader boundaries that tolerate malformed
 * legacy / out-of-band data and surface it elsewhere (Axis 5 in
 * r2-invariant-scanner.ts).
 */
export function validSnapIdOrNull(
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return SNAPSHOT_ID_REGEX.test(value) ? value : null;
}

/**
 * Throws if `value` does not match SNAPSHOT_ID_REGEX. Used at writer
 * boundaries (recordR2UploadDecision) to fail-fast on shape regression.
 * Optional `context` prefix lets the caller identify the failing site
 * in the error message (e.g. "recordR2UploadDecision").
 */
export function assertValidSnapId(value: string, context?: string): void {
  if (!SNAPSHOT_ID_REGEX.test(value)) {
    const prefix = context ? `${context}: ` : "";
    throw new Error(
      `${prefix}invalid snap_id shape (must match ^snap_[A-Za-z0-9_-]+$): ${JSON.stringify(value)}`
    );
  }
}

/**
 * Parse the canonical `snap_id=<snap_id>; ...` prefix that
 * recordR2UploadDecision formats. Returns null on missing or malformed
 * input (including invalid trailing chars after the snap_id — the
 * `(?=;|$)` delimiter lookahead rejects those rather than truncating).
 */
export function parseSnapIdFromRationale(
  rationale: string | null | undefined
): string | null {
  if (!rationale) return null;
  const match = RATIONALE_SNAP_ID_PREFIX_REGEX.exec(rationale);
  return match ? match[1]! : null;
}

/**
 * Format the canonical `snap_id=<snap_id>` rationale prefix part that
 * recordR2UploadDecision joins into policy_decisions.rationale. The
 * caller is responsible for joining this part with the rest of the
 * rationale segments (canonical separator is `"; "`); this helper
 * intentionally returns the bare field without a trailing delimiter
 * so existing `parts.join("; ")` writer flows stay readable.
 *
 * Defines the writer half of the prefix that RATIONALE_SNAP_ID_PREFIX_REGEX
 * parses on the reader side — keeping both in the same module closes the
 * symmetric drift surface (writer changes `snap_id` field name without
 * updating the regex, or vice versa).
 */
export function formatSnapIdRationalePrefix(snapId: string): string {
  return `snap_id=${snapId}`;
}
