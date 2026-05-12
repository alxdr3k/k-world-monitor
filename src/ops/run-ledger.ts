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
  domainOverrideReason?: string;
  sessionId?: string;
}

export interface CompleteRunInput {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  totalCostUsd?: number;
}

export interface DailyCostRow {
  date: string;
  vendor: RunVendor;
  totalCostUsd: number;
  runCount: number;
}

export function startRun(input: StartRunInput): string {
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

export function completeRun(runId: string, output: CompleteRunInput = {}): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE run_ledger
       SET status = 'completed', completed_at = ?,
           input_tokens = ?, output_tokens = ?, cached_tokens = ?,
           total_cost_usd = ?
       WHERE run_id = ?`
    )
    .run(
      now,
      output.inputTokens ?? null,
      output.outputTokens ?? null,
      output.cachedTokens ?? null,
      output.totalCostUsd ?? null,
      runId
    );
}

export function failRun(runId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE run_ledger
       SET status = 'failed', completed_at = ?
       WHERE run_id = ?`
    )
    .run(now, runId);
}

// Returns total cost in USD for all completed runs on a UTC calendar date (YYYY-MM-DD).
// Optional vendor filter.
export function getDailyCostUsd(date: string, vendor?: RunVendor): number {
  const like = `${date}%`;
  const row = vendor
    ? (getDb()
        .prepare(
          `SELECT COALESCE(SUM(total_cost_usd), 0) AS total
           FROM run_ledger
           WHERE started_at LIKE ? AND vendor = ? AND status = 'completed'`
        )
        .get(like, vendor) as { total: number })
    : (getDb()
        .prepare(
          `SELECT COALESCE(SUM(total_cost_usd), 0) AS total
           FROM run_ledger
           WHERE started_at LIKE ? AND status = 'completed'`
        )
        .get(like) as { total: number });
  return row.total;
}

// Returns per-vendor daily cost breakdown for a UTC calendar date.
export function getDailyCostBreakdown(date: string): DailyCostRow[] {
  const like = `${date}%`;
  return getDb()
    .prepare(
      `SELECT substr(started_at, 1, 10) AS date,
              vendor,
              COALESCE(SUM(total_cost_usd), 0) AS totalCostUsd,
              COUNT(*) AS runCount
       FROM run_ledger
       WHERE started_at LIKE ? AND status = 'completed'
       GROUP BY vendor`
    )
    .all(like) as DailyCostRow[];
}
