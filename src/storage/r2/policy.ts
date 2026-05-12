/**
 * R2 permitted-artifact prefix policy (ADR-0012 INV-0012-3, INV-0012-4).
 *
 * Raw third-party text MUST NEVER be written to R2 (raw_cloud_policy = always_prohibited).
 * Only keys under these prefixes are allowed at the application layer.
 * The prefix list is canonical — every write must pass checkPermittedPrefix().
 */

// Canonical permitted R2 prefixes (from docs/05_RUNBOOK.md DEC-007).
// Order matters for display only; enforcement uses startsWith.
export const PERMITTED_PREFIXES = [
  "backups/neo4j/",
  "backups/sqlite/",
  "audit/jsonl/",
  "tmp/multipart/",
  "permitted_artifact/dataset/",
  "permitted_artifact/derived/snapshot/",
  "permitted_artifact/derived/dossier/",
  "permitted_artifact/derived/publication/",
  "permitted_artifact/evidence-pack/",
] as const;

export type PermittedPrefix = (typeof PERMITTED_PREFIXES)[number];

export class PermittedPrefixViolation extends Error {
  constructor(key: string) {
    super(
      `R2 write blocked: key "${key}" does not match any permitted prefix. ` +
        `raw_cloud_policy=always_prohibited (ADR-0012 INV-0012-4). ` +
        `Permitted prefixes: ${PERMITTED_PREFIXES.join(", ")}`
    );
    this.name = "PermittedPrefixViolation";
  }
}

/**
 * Throws PermittedPrefixViolation if key does not start with a permitted prefix.
 * Call before every R2 write.
 */
export function checkPermittedPrefix(key: string): void {
  for (const prefix of PERMITTED_PREFIXES) {
    if (key.startsWith(prefix)) return;
  }
  throw new PermittedPrefixViolation(key);
}

/**
 * Returns the matched permitted prefix for a key, or null if not permitted.
 * Useful for diagnostics without throwing.
 */
export function matchedPrefix(key: string): PermittedPrefix | null {
  for (const prefix of PERMITTED_PREFIXES) {
    if (key.startsWith(prefix)) return prefix;
  }
  return null;
}

/**
 * Asserts sha256 hex of buf matches expected hash.
 * Use to verify content integrity after R2 round-trip.
 */
export async function assertSha256(buf: ArrayBuffer, expectedHex: string): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const actual = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expectedHex.toLowerCase()) {
    throw new Error(
      `SHA-256 mismatch: expected ${expectedHex.toLowerCase()}, got ${actual}`
    );
  }
}

/**
 * Compute sha256 hex of buf.
 */
export async function sha256HexBuf(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
