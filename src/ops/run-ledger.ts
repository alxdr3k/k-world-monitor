// Run ledger — record every LLM call + cost in SQLite (OPS-1A.1).
// Implements ADR-0023 INV-0023-7 + ADR-0006 INV-0006-5 extension.
// Gate: AC-019 (daily cost aggregation for throttling by OPS-1A.2).
//
// ID: run_<ULID>

import { ulid } from "ulid";
import { getDb } from "../storage/sqlite/connection";

export type RunStage =
  | "discover"
  | "extract"
  | "dossier"
  | "scenario"
  | "thesis"
  | "cite_check"
  | "publication";

export type RunVendor = "openai" | "anthropic" | "google";

export type RunStatus = "running" | "completed" | "failed";

export interface StartRunInput {
  stage: RunStage;
  vendor: RunVendor;
  tier: 0 | 1 | 2 | 3;
  modelId: string;
  promptVersion?: string;
  systemPromptSha256?: string;
  batchId?: string;
  crossVendorReviewOf?: string;
  specSha256?: string;
  datasetVintageId?: string;
  libraryVersionLockSha256?: string;
  /** Required when vendor !== 'openai' — ADR-0023 audit invariant. */
  domainOverrideReason?: string;
  sessionId?: string;
}

export interface CompleteRunInput {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  /** Required — null cost silently disappears from SUM aggregation (AC-019). */
  totalCostUsd: number;
}

export interface DailyCostRow {
  date: string;
  vendor: RunVendor;
  totalCostUsd: number;
  runCount: number;
}

const VALID_TIERS = new Set([0, 1, 2, 3]);
const VALID_STAGES = new Set<string>([
  "discover", "extract", "dossier", "scenario", "thesis", "cite_check", "publication",
]);
const VALID_VENDORS = new Set<string>(["openai", "anthropic", "google"]);

export function startRun(input: StartRunInput): string {
  if (!VALID_TIERS.has(input.tier))
    throw new Error(`startRun: tier must be 0–3, got ${input.tier}`);
  if (!VALID_STAGES.has(input.stage))
    throw new Error(`startRun: unknown stage '${input.stage}'`);
  if (!VALID_VENDORS.has(input.vendor))
    throw new Error(`startRun: unknown vendor '${input.vendor}'`);
  if (!input.modelId?.trim())
    throw new Error("startRun: modelId must be a non-empty string");
  // ADR-0023: non-default vendor routing must record a non-blank override reason.
  if (input.vendor !== "openai" && !input.domainOverrideReason?.trim())
    throw new Error(
      `startRun: domainOverrideReason is required for non-openai vendor '${input.vendor}'`
    );

  const runId = `run_${ulid()}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO run_ledger
         (run_id, started_at, status, stage, vendor, tier, model_id,
          prompt_version, system_prompt_sha256, batch_id,
          cross_vendor_review_of, spec_sha256, dataset_vintage_id,
          library_version_lock_sha256, domain_override_reason, session_id,
          created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      runId,
      now,
      "running",
      input.stage,
      input.vendor,
      input.tier,
      input.modelId,
      input.promptVersion ?? null,
      input.systemPromptSha256 ?? null,
      input.batchId ?? null,
      input.crossVendorReviewOf ?? null,
      input.specSha256 ?? null,
      input.datasetVintageId ?? null,
      input.libraryVersionLockSha256 ?? null,
      input.domainOverrideReason ?? null,
      input.sessionId ?? null,
      now
    );
  return runId;
}

export function completeRun(runId: string, output: CompleteRunInput): void {
  // Runtime guard for JS callers that bypass TypeScript (no second arg, null, or missing totalCostUsd).
  if ((output as unknown) == null || (output.totalCostUsd as unknown) === undefined)
    throw new Error("completeRun: totalCostUsd is required");
  if (!Number.isFinite(output.totalCostUsd) || output.totalCostUsd < 0)
    throw new Error(
      `completeRun: totalCostUsd must be a finite non-negative number, got ${output.totalCostUsd}`
    );

  // Token fields must be non-negative integers.
  if (output.inputTokens !== undefined) {
    if (!Number.isInteger(output.inputTokens) || output.inputTokens < 0)
      throw new Error(
        `completeRun: inputTokens must be a non-negative integer, got ${output.inputTokens}`
      );
  }
  if (output.outputTokens !== undefined) {
    if (!Number.isInteger(output.outputTokens) || output.outputTokens < 0)
      throw new Error(
        `completeRun: outputTokens must be a non-negative integer, got ${output.outputTokens}`
      );
  }
  if (output.cachedTokens !== undefined) {
    if (!Number.isInteger(output.cachedTokens) || output.cachedTokens < 0)
      throw new Error(
        `completeRun: cachedTokens must be a non-negative integer, got ${output.cachedTokens}`
      );
  }

  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE run_ledger
       SET status = 'completed', completed_at = ?,
           input_tokens = ?, output_tokens = ?, cached_tokens = ?,
           total_cost_usd = ?
       WHERE run_id = ? AND status = 'running'`
    )
    .run(
      now,
      output.inputTokens ?? null,
      output.outputTokens ?? null,
      output.cachedTokens ?? null,
      output.totalCostUsd,
      runId
    );
  if (result.changes === 0) {
    throw new Error(`completeRun: no running row found for run_id=${runId}`);
  }
}

export function failRun(runId: string): void {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE run_ledger
       SET status = 'failed', completed_at = ?
       WHERE run_id = ? AND status = 'running'`
    )
    .run(now, runId);
  if (result.changes === 0) {
    throw new Error(`failRun: no running row found for run_id=${runId}`);
  }
}

function validateDate(date: string, caller: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`${caller}: date must be YYYY-MM-DD, got '${date}'`);
  // Semantic validation: parse and round-trip to reject impossible dates like 2026-99-99.
  // Date.UTC parses the components; if the month/day are out-of-range JS wraps them,
  // so we verify the formatted result matches the input.
  const parts = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
  const roundTrip = parsed.toISOString().slice(0, 10);
  if (roundTrip !== date)
    throw new Error(`${caller}: date '${date}' is not a valid calendar date`);
}

// Returns total cost in USD for all completed runs on a UTC calendar date (YYYY-MM-DD).
// Filters by completed_at so cross-midnight runs are attributed to the day they billed.
// Uses a half-open range (>= date AND < next-day) to allow the composite index on
// (completed_at, vendor) to be used efficiently — LIKE does not reliably use B-tree indexes.
// Optional vendor filter.
export function getDailyCostUsd(date: string, vendor?: RunVendor): number {
  validateDate(date, "getDailyCostUsd");
  if (vendor !== undefined && !VALID_VENDORS.has(vendor))
    throw new Error(`getDailyCostUsd: unknown vendor '${vendor}'`);
  const nextDay = nextDateString(date);
  const row = vendor
    ? (getDb()
        .prepare(
          `SELECT COALESCE(SUM(total_cost_usd), 0) AS total
           FROM run_ledger
           WHERE completed_at >= ? AND completed_at < ? AND vendor = ? AND status = 'completed'`
        )
        .get(date, nextDay, vendor) as { total: number })
    : (getDb()
        .prepare(
          `SELECT COALESCE(SUM(total_cost_usd), 0) AS total
           FROM run_ledger
           WHERE completed_at >= ? AND completed_at < ? AND status = 'completed'`
        )
        .get(date, nextDay) as { total: number });
  return row.total;
}

// Returns per-vendor daily cost breakdown for a UTC calendar date.
export function getDailyCostBreakdown(date: string): DailyCostRow[] {
  validateDate(date, "getDailyCostBreakdown");
  const nextDay = nextDateString(date);
  return getDb()
    .prepare(
      `SELECT substr(completed_at, 1, 10) AS date,
              vendor,
              COALESCE(SUM(total_cost_usd), 0) AS totalCostUsd,
              COUNT(*) AS runCount
       FROM run_ledger
       WHERE completed_at >= ? AND completed_at < ? AND status = 'completed'
       GROUP BY vendor`
    )
    .all(date, nextDay) as DailyCostRow[];
}

/** Returns the ISO date string for the day after `date` (YYYY-MM-DD). */
function nextDateString(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
