# Code Map

> Last verified against code: pending merge SHA (2026-05-19) — EXTR-1A.2b Real OpenAI Tier 2 default client + run_ledger 통합 landed (Cycle 41, **code change**: 1 신규 module `src/extraction/llm/openai-client.ts` + LlmClient interface extension + ArticleExtractor refactor + 2 신규/migrated tests, 1258 → 1286 tests). Previous code baseline = 5d037d3 (2026-05-19, Cycle 39 PR #98 EXTR-1A.1 Extractor router + interface contract). Earlier baselines: 49d4a79 (2026-05-19, Cycle 38 PR #97 EXTR-1A.0 Prompt Injection 방어 기반) → fdb847a (2026-05-17, Cycle 10 INFRA-1B.3.h7-gate-evidence-hardening) → 75706c4 (2026-05-14, INFRA-1B.3.x-audit) → 13d61af (2026-05-13, comprehensive review backfill).

## Runtime stack

- **bun** (JavaScript/TypeScript runtime + package manager)
- **TypeScript** (strict mode, `tsconfig.json`)
- **bun:sqlite** (SQLite driver, synchronous, native binding)
- **neo4j-driver** (Neo4j Bolt protocol, async)
- **Bun.S3Client** (R2 access, S3-compatible)
- **ulid** (monotonic ID generation)
- **js-yaml** (YAML parsing for invariant validator + seed)
- **fast-xml-parser** (XML/RSS/Atom parsing with XXE disabled, DEC-018)

## Entry points

| Path | Purpose |
|---|---|
| `scripts/migrate.ts` | Migration runner CLI (`bun run migrate`, `:neo4j`, `:sqlite`) |
| `scripts/validate_invariants.ts` | Invariant validator (`bun run invariant:check`) |
| `scripts/seed-sources.ts` | Source registry seed CLI (`bun run seed-sources`, `:dry-run`, `:neo4j`, `:preflight`, INFRA-1B.1 + AI-P1-2) |
| `scripts/check-secrets.ts` | Pre-commit secret scanner — pure `scanForSecrets()` + CLI entry (`bun run check-secrets`). 2-layer defense: filename guard (`.env` family reject, exempt `.env.example` / `.sample` / `.template`) + content pattern guard (OpenAI / Anthropic / Google / AWS / GitHub PAT / Doppler). Redacted preview (`first4...last4`) — no token re-leak in stderr. AI-P1-12 / INFRA-1B.5.h1-runbook-setup-hygiene |
| `scripts/git-hooks/pre-commit` | Bash shim invoking `scripts/check-secrets.ts`. Activated via `git config core.hooksPath = scripts/git-hooks` (`bun run hooks:install`). Operator override: `git commit --no-verify`. AI-P1-12 |
| `scripts/install-git-hooks.sh` | One-shot fresh-worktree installer — sets `core.hooksPath` + `chmod +x` all hooks. `bun run hooks:install`. AI-P1-12 |
| `scripts/check-llm-routing-config.ts` | Pure config validator for `data/llm_routing.yaml` (ADR-0023 INV-0023-2 / INV-0023-3 / INV-0023-5 — operator D3 2026-05-18). Exports `loadLlmRoutingConfig` + `assertTier0VendorRoles` (Tier 0 vendor role lock) + `assertTiersCapabilityCanonical` (capability mandatory; no `price`/`cost`/`cheap`/`budget` tier-canonical keys) + `assertGoogleScopeIsTier3Only` (Google only at Tier 3) + `checkLlmRoutingConfig` aggregate. CLI entry: `bun run scripts/check-llm-routing-config.ts data/llm_routing.yaml`. No runtime LLM wiring — pure policy validator. |
| `scripts/check-vault-jsonl-policy.ts` | Pure policy validator for ADR-0012 INV-0012-5 (Markdown vault content kinds + scenario citation) + INV-0012-6 (JSONL not canonical store) — operator D4 2026-05-18 + 1 codex round hardening. Exports `findVaultFiles` (walks `VAULT_FILE_EXTENSIONS = [".md", ".mdx"]` over `vault/` + `docs/vault/`; populates frontmatter + body) + `assertVaultContentKinds` (vault types must be one of `documenthub` / `dossier` / `scenario` / `thesis` / `contentdraft` / `publication` / `promotedclaim` / **`editorialintent`** [ADR-0025 added per codex P2]) + `assertPromotedClaimsAreCited` (every `promoted_claim` file's claim_id must appear in either some scenario's frontmatter `cited_claims[]` array OR as a whole-word match in some scenario body markdown — INV-0012-5 "scenario에 인용된 promoted claim만 둔다", codex P2) + `findJsonlFiles` + `assertJsonlIsNotCanonical` (every `*.jsonl` must be under allowlisted intermediate/log paths — `.dev-cycle/` / `docs/audit-export/` / `docs/_generated/` / `tests/fixtures/` family) + `checkVaultJsonlPolicy` aggregate. CLI entry: `bun run scripts/check-vault-jsonl-policy.ts [repoRoot]`. Vacuously true for vault while no vault root exists; JSONL guard is active over the live tree. |
| `src/discovery/worker/run-discovery.ts` | Discovery worker entry (`bun run discovery:run`, `:dry-run`, INFRA-1B.2) |
| `tests/bench/neo4j_fts_search_bench.ts` | SPIKE-001 FTS bench (`bun run bench:neo4j`) |

## Migrations

| Path | Purpose |
|---|---|
| `migrations/neo4j/v1_schema.cypher` | Neo4j graph schema v1: 13 node UNIQUE + 5 edge UNIQUE + 5 FTS + Scenario property schema (INFRA-1A.2 + INFRA-1A.7) |
| `migrations/sqlite/v1_schema.sql` | SQLite relational schema v1: 17 tables (INFRA-1A.2) |
| `migrations/sqlite/v2_enum_constraints.sql` | Enum-validating triggers for run_ledger / cross_vendor_review_ledger (INFRA-1A.5) |
| `migrations/sqlite/v3_source_registry_slug_map.sql` | Stable slug→source_id mapping for idempotent seed re-runs (INFRA-1B.1, DEC-015) |
| `migrations/sqlite/v4_run_ledger_completed_at_idx.sql` | Composite index on run_ledger(completed_at, vendor) for daily cost aggregation (OPS-1A.1) |
| `migrations/sqlite/v5_crawl_state.sql` | crawl_state table — discovery scheduler etag/Last-Modified + backoff (INFRA-1B.2b, ADR-0030 INV-0030-5) |
| `migrations/sqlite/v6_discovery_queue.sql` | discovery_queue table — discovered URLs pending fingerprint (INFRA-1B.2, INFRA-1B.3) |
| `migrations/sqlite/v7_policy_decisions_intended_action.sql` | policy_decisions ADD COLUMN intended_action — R2 upload audit ledger (INFRA-1B.3.x-audit, AC-032 / NFR-008, Q-044 → DEC-020 / TRACE-040) |
| `migrations/sqlite/v8_audit_hardening.sql` | policy_decisions audit hardening: ADD COLUMN upload_attempt_id (BEFORE/AFTER correlation key) + 3 BEFORE INSERT triggers (intended_action enum + r2_upload decision enum + r2_upload upload_attempt_id required). DB-level defense-in-depth for AC-032 / NFR-008 audit invariants (INFRA-1B.3.h3-audit-hardening, AI-P1-7) |

## Source

### Domain / utils

| Path | Purpose |
|---|---|
| `src/domain/ids.ts` | ID prefix constants + `validateIdPrefix()` (AC-005) |
| `src/domain/nodes.ts` | TypeScript interfaces: SourceNode, ScenarioNode, ThesisNode (INFRA-1A.7) |
| `src/domain/snapshot-id.ts` | Single source of truth for snap-prefixed identifiers + snapshot-stage R2 key prefix — `SNAPSHOT_ID_REGEX` / `RATIONALE_SNAP_ID_PREFIX_REGEX` / `SNAPSHOT_R2_KEY_PREFIX` + `snapshotR2Key()` / `validSnapIdOrNull()` / `assertValidSnapId(value, context?)` / `parseSnapIdFromRationale()` / `formatSnapIdRationalePrefix(snapId)` (writer-side prefix builder, closes symmetric drift surface for the `snap_id=` field name shared by writer and reader regex). Consumed by `src/storage/audit/policy-decisions.ts` (writer-boundary `assertValidSnapId` + `formatSnapIdRationalePrefix`), `src/ops/r2-invariant-scanner.ts` (reader-boundary re-export), `src/discovery/worker/snapshot-fingerprint.ts` (r2Put key construction), `src/storage/r2/policy.ts` (PERMITTED_PREFIXES). Closes the drift surface flagged by PR #66 Cycle 10 Finding 6 (INFRA-1A.x-shared-snapshot-id-constants, Cycle 12 + writer-helper follow-up Cycle 13, NOT gate-blocking refactor). |
| `src/utils/text.ts` | `normalizeText()` / `truncateCodePoints()` / `isWithinLimit()` (AC-007) |
| `src/utils/hash.ts` | `sha256Hex()` / `sha256Prefix()` (ADR-0025, AC-007) |
| `src/utils/enums.ts` | All domain enum const arrays + `is*()` validators (INFRA-1A.5/1A.7) |

### Storage

| Path | Purpose |
|---|---|
| `src/storage/neo4j/connection.ts` | Neo4j driver singleton + `withSession()` + `closeDriver()` (env pool config DEC-016) |
| `src/storage/sqlite/connection.ts` | SQLite DB singleton + WAL + FK + busy_timeout=5000 (DEC-014) + `closeDb()` + migration helper |
| `src/storage/r2/policy.ts` | PERMITTED_PREFIXES + `checkPermittedPrefix()` + sha256 helpers (ADR-0012 INV-0012-4, INFRA-1A.3) |
| `src/storage/r2/client.ts` | Bun.S3Client wrapper — `r2Put/r2Get/r2Delete` with policy enforcement (INFRA-1A.3) |
| `src/storage/source-registry/seed.ts` | Parse `data/sources_seed.yaml`, validate enums + URLs, upsert source_material_policy + slug map (INFRA-1B.1) |
| `src/storage/source-registry/neo4j-bootstrap.ts` | `bootstrapNeo4jSourceNodes()` UNWIND MERGE Neo4j Source nodes from resolved SQLite slug_map rows (`loadBootstrapRowsFromSqlite()` — YAML name preferred, historical slug-only rows fallback `name=slug`) + `preflightSourceRegistry()` SQLite policy / SQLite slug_map / Neo4j Source 3-way alignment check + null source_id detection (`neo4jNodesMissingSourceId`) + duplicate source_id detection (`neo4jDuplicateSourceIds[]`) + `assertSourceRegistryAligned()` fail-fast `BootstrapPreflightError` with remediation hints. Source node properties minimal (`source_id` / `slug` / `name` / `bootstrap_at` / `updated_at`); `was_created` via OPTIONAL MATCH query-local variable (NOT stored as Source property). (INFRA-1B.1.h1-source-bootstrap-neo4j, AI-P1-2) |
| `src/storage/audit/policy-decisions.ts` | `recordR2UploadDecision()` — immutable audit row INSERT into policy_decisions around every r2Put call site in snapshot-fingerprint (INFRA-1B.3.x-audit, AC-032 / NFR-008, ADR-0012 INV-0012-3). AI-P1-7 (INFRA-1B.3.h3-audit-hardening): `newUploadAttemptId()` 신규 export + `R2UploadAuditInput.uploadAttemptId` 의무 — BEFORE 'attempted' / AFTER outcome row 가 동일 `upload_attempt_id` (`uatt_<ULID>`) 공유, operator 가 `WHERE upload_attempt_id = '...'` 로 concurrent r2Put 사이에서 단일 attempt 의 BEFORE/AFTER pair 정확 추출. v8 SQLite trigger 가 r2_upload row 의 NULL upload_attempt_id reject. |

### Discovery

| Path | Purpose |
|---|---|
| `src/discovery/fetch/safe-fetch.ts` | `safeFetch()` — SSRF/redirect/size/robots/sniff defenses (ADR-0028 INV-0028-1..6, DEC-017, INFRA-1B.2a). Cycle 32: INV-0028-6 declared-vs-sniffed enforcement adds `classifyDeclaredContentType()` + `isContentTypeMismatch()` exports; Step 8 throws `ContentTypeMismatchError` when declared family (xml/json/html) and sniffed `ContentKind` resolve to incompatible groups (e.g. declared=application/json + body sniffs as HTML error page). Missing / unrecognized Content-Type pass through (operator D1 2026-05-18). |
| `src/discovery/parse/xml-safe.ts` | `RSS_PARSER` singleton — fast-xml-parser with XXE disabled (DEC-018, INFRA-1B.2a) |
| `src/extraction/sanitize/html-to-text.ts` | `htmlToText()` + `DANGEROUS_TAGS` — HTML → plain text sanitizer for LLM input (ADR-0029 INV-0029-5, EXTR-1A.0). Strips `<script>`/`<style>`/`<noscript>`/`<iframe>`/`<object>`/`<embed>` + content, removes HTML comments, decodes basic entities incl. numeric/hex, collapses whitespace. Regex-based defensive sanitizer (not a full DOM parser). |
| `src/extraction/prompt/untrusted-wrapper.ts` | `wrapUntrusted()` + `wrapUntrustedForTier()` + `TIER_TOKEN_CAPS` + `CHARS_PER_TOKEN_HEURISTIC` — untrusted-content sentinel wrapper (ADR-0029 INV-0029-1 + INV-0029-3, EXTR-1A.0). Wraps content in `<untrusted>...</untrusted>` and enforces per-tier token cap (Tier 3 = 4000 / Tier 2 = 8000 / Tier 1+ = 16000). Caller MUST emit the INV-0029-1 system-prompt warning. |
| `src/extraction/policy/llm-policy-gate.ts` | `checkLlmPolicy()` + `LlmProhibitedError` + `LlmManualReviewRequiredError` + `SourceNotRegisteredError` — external_llm_policy gate (ADR-0029 INV-0029-4 + ADR-0017 source policy compliance, EXTR-1A.0). Reads `source_material_policy.external_llm_policy` and throws fail-closed on `prohibited` / `manual_review_required` / unregistered source. |
| `src/extraction/router/types.ts` | `SOURCE_TYPE` enum + `SourceType` + `isSourceType()` type guard + `ExtractorInput` + `ExtractorOutput` + `Extractor` interface (REQ-009 / AC-009 / AC-021 / NFR-007, EXTR-1A.1). 3-way canonical source-type contract for article/dataset/report. |
| `src/extraction/router/registry.ts` | `ExtractorRegistry` + 3 typed errors (`ExtractorNotRegisteredError`, `ExtractorAlreadyRegisteredError`, `InvalidSourceTypeError`) — Map-backed extractor lookup with fail-closed unregistered slot + dup-prevent + off-canonical-defend (EXTR-1A.1). |
| `src/extraction/router/router.ts` | `routeAndExtract()` — pure dispatch function with envelope validation (input shape + sourceType + sourceId + rawContent) + post-dispatch envelope-consistency fail-closed (extractor wiring mistake defense) (EXTR-1A.1, AC-009). |
| `src/extraction/router/index.ts` | Public re-export of types/registry/router for the extractor router surface (EXTR-1A.1). |
| `src/extraction/llm/client.ts` | `LlmClient` interface (readonly `vendor`/`tier`/`model` + `invoke`) + `LlmInvokeParams` + `LlmInvokeResult` (incl. `totalCostUsd?` for OPS-1A.1 AC-019) + `LlmTier` type — vendor-agnostic LLM abstraction (EXTR-1A.2a/1A.2b). |
| `src/extraction/llm/openai-client.ts` | `OpenAIClient implements LlmClient` (fetch-based OpenAI Chat Completions REST, no `openai` npm dep) + `OPENAI_TIER_DEFAULT_MODEL` (Tier 2 = `gpt-5-mini` per ADR-0023) + `OPENAI_PRICING_USD_PER_1M_TOKENS` placeholder pricing (TODO ratification) + `computeTotalCostUsd()` + `OpenAIApiError` typed error (EXTR-1A.2b). Constructor fail-fast on missing `apiKey` / `OPENAI_API_KEY` env. |
| `src/extraction/article/article-extractor.ts` | `ArticleExtractor implements Extractor` + `ARTICLE_EXTRACTION_SYSTEM_PROMPT` mandatory INV-0029-1 caller-warning — article path with full INV-0029-* defensive pipeline (`checkLlmPolicy` fail-closed → `htmlToText` → `wrapUntrustedForTier` → `LlmClient.invoke`) + OPS-1A.1 run_ledger wrap (`startRun` BEFORE invoke + `completeRun` on success + `failRun` on throw; mock-vendor skips ledger). Supports `runStage` + `domainOverrideReason` deps for EXTR-1A.2c Anthropic Sonnet override forward (EXTR-1A.2a/1A.2b). |
| `src/discovery/scheduler/semaphore.ts` | Bounded semaphore primitive — async acquire/release (INFRA-1B.2b, ADR-0030 INV-0030-1) |
| `src/discovery/scheduler/pool.ts` | Global + per-host semaphore pool — 8 global / 1 per-host (INFRA-1B.2b, ADR-0030 INV-0030-1) |
| `src/discovery/scheduler/crawl-state.ts` | etag/Last-Modified + consecutive_failures + next_eligible_at upsert (INFRA-1B.2b) |
| `src/discovery/scheduler/scheduler.ts` | poll → fetch → write phases — fetch/write separation (INFRA-1B.2b, ADR-0030 INV-0030-2) |
| `src/discovery/worker/rss-worker.ts` | RSS/Atom item parse + discovery_queue enqueue (INFRA-1B.2) |
| `src/discovery/worker/snapshot-fingerprint.ts` | Fetcher → Snapshot fingerprint (URL + content_hash + locator) + R2 back-fill for permitted artifacts (INFRA-1B.3). AI-P1-3 (INFRA-1B.3.h2-queue-cli): new-path `createDocumentAndSnapshot()` Source-missing guard now throws `TypedQueueError("source_not_found_in_graph", ...)` — unified with dedup-path `ensureSourceLinkage()` error_code so operator alerts cover ONE code |
| `src/discovery/worker/chunker.ts` | Snapshot text → chunk + Neo4j FTS index write (INFRA-1B.4). AI-P1-1 (INFRA-1B.4.h1-chunker-policy-gate): `chunkSnapshot(input)` 의무 input 에 `sourceId` + `archivePolicy` 추가 — Q-053 D2 / DEC-024 D2 정합. `metadata_only` / `excerpt_only` / `do_not_collect` 는 `ChunkRejected` throw (Neo4j tx 미개시), `full_snapshot_allowed` 만 진행. empty text 는 `ChunkRejected("empty_text")` — 기존 DETACH DELETE 가 stale chunks 를 wipe 하던 문제 차단 (action-items "empty text 가 chunk 삭제 안 하게") |
| `src/discovery/worker/run-discovery.ts` | Discovery worker entry — orchestrates poll + fetch + fingerprint enqueue (INFRA-1B.2) |
| `src/discovery/worker/run-process-queue.ts` | `bun run discovery:process-queue` CLI — claim pending discovery_queue rows + safeFetch + snapshot fingerprint + R2 conditional upload. SQLite-backed `makeArchivePolicyLookup` (FK-protected, actionable diagnostics on missing rows) + `pendingSnapshot` dry-run summary. `import.meta.main` entry guard + `closeDriver()` / `closeDb()` finally cleanup. (INFRA-1B.3.h2-queue-cli, AI-P1-3) |

### Pipeline (access intervention + feedback)

| Path | Purpose |
|---|---|
| `src/pipeline/policy-gate/risk-triggers.ts` | ADR-0017 INV-0017-3/4 generic policy_gate evaluator — `RiskTriggerContext` + 8 detector + `detectRisks()` + `stageDefaultMode()` + `evaluatePolicyGate()` (pure function — INV-0017-4 mode-invariant override + INV-0017-3 stage-default mapping). v0 detection proxies: archive_policy = paywall/terms indicator (INFRA-1B.1.h2-source-profile = future hardening anchor), sourceName = wire-service hardcoded allowlist (Reuters / AP / AFP / Bloomberg / Yonhap / Kyodo / Xinhua / TASS / Interfax). image_inclusion = v0 conservative block (license tracking not yet implemented). (INFRA-1B.5.h2-policy-gate-risk-triggers, AC-023 / TEST-023) |
| `src/pipeline/policy-gate/decision-ledger.ts` | `recordPolicyGateDecision()` — generic policy_gate ledger writer (operator-gate namespace, intended_action=NULL, v8 r2_upload enum trigger 우회). `NON_RISK_TRIGGER_TYPE` sentinel for stage-default non-risk decisions. Writer-boundary defense-in-depth — triggerType / decision / gateMode enum 검증 (symmetric to assertValidSnapId in storage/audit/policy-decisions.ts Cycle 7 lesson). ADR-0017 INV-0017-5 policy_decisions ledger persistence. (INFRA-1B.5.h2-policy-gate-risk-triggers, AC-023 / TEST-023) |
| `src/pipeline/access-intervention/severity.ts` | `computeSeverity()` — deterministic: GateMode × importance_score × relatedAssumptionIds (INFRA-1B.5, AC-024) |
| `src/pipeline/access-intervention/recorder.ts` | `recordIntervention()` — AccessIntervention Neo4j node `aci_<ULID>` (INFRA-1B.5) |
| `src/pipeline/access-intervention/batch-report.ts` | `generateBatchReport()` — severity-bucketed Markdown + hasBlockers cite-check flag (INFRA-1B.5, AC-024) |
| `src/pipeline/feedback/manual-claim-entry.ts` | `pipeline feedback add` 3-way 분리 (user_written_claim / user_opinion / referenced_quote) — raw_text_stored=false 강제 (INFRA-1B.6, AC-025) |
| `src/pipeline/feedback/intervention-review.ts` | `pipeline intervention review <id>` 3-option (ignore / manual_claim / temp_text) (INFRA-1B.6, AC-025) |

### Ops

| Path | Purpose |
|---|---|
| `src/ops/run-ledger.ts` | `startRun()` / `completeRun()` / `failRun()` + daily cost aggregation (`getDailyCostUsd`, `getDailyCostBreakdown`). CAS gate (`WHERE status='running'`) on completeRun/failRun. ADR-0023 INV-0023-7 (OPS-1A.1, AC-019) |
| `src/ops/r2-invariant-scanner.ts` | Read-only 3-way reconciliation — Snapshot.r2_key (Neo4j) ↔ policy_decisions uploaded audit (SQLite) ↔ source_material_policy (SQLite). Pure `reconcile()` + Neo4j/SQLite fetchers + `scanR2Invariants()` orchestrator. 3 violation axes: `r2_key_without_audit` / `audit_uploaded_without_r2_key` / `r2_key_with_restricted_source` (retroactive policy tightening). ADR-0012 INV-0012-3 / INV-0012-4 runtime invariant enforcement. (OPS-1B.h1-runtime-invariant-scanner, AI-P1-6) |
| `src/ops/run-r2-invariants.ts` | `bun run audit:r2-invariants` CLI — read-only scanner entry. `--json` flag for machine-readable output. Per-violation operator-response hints. `parseArgs` allowlist + `UnknownArgumentError` fail-fast. `closeDriver()` + `closeDb()` finally. `import.meta.main` entry guard. exit 1 on any violation. (OPS-1B.h1-runtime-invariant-scanner, AI-P1-6) |

## Tests

| Path | Purpose | TEST id |
|---|---|---|
| `tests/lint/id_prefix_test.ts` | ID prefix validation for all domain types | TEST-005 |
| `tests/lint/no_frontmatter_relation_array_test.ts` | Frontmatter relation array lint | TEST-008 |
| `tests/unit/text_hash_test.ts` | normalizeText / sha256 / enum validator tests | — (AC-007) |
| `tests/unit/bidirectional_schema_test.ts` | Thesis stance / source perspective enum + AC-027 distribution | — (AC-026, AC-027) |
| `tests/unit/perspective_distribution_test.ts` | AC-027 Tier A seed distribution lint — reads data/sources_seed.yaml | TEST-027 |
| `tests/unit/r2_policy_test.ts` | R2 permitted-prefix + sha256 round-trip integrity | — (AC-003, AC-020, AC-032) |
| `tests/unit/source_registry_test.ts` | Source registry seed dry-run + enum validation + YAML structure | — (INFRA-1B.1) |
| `tests/unit/neo4j_bootstrap_test.ts` | Neo4j Source bootstrap idempotency + preflight (3-way SQLite policy / slug_map / Neo4j Source alignment) + fail-fast BootstrapPreflightError | — (INFRA-1B.1.h1-source-bootstrap-neo4j, AI-P1-2) |
| `tests/unit/run_process_queue_test.ts` | `discovery:process-queue` CLI internals — SQLite-backed `makeArchivePolicyLookup` enum validation + missing-row diagnostics + `pendingSnapshot` dry-run summary (total / per-source breakdown sorted by count DESC / stale-processing > 1h) | — (INFRA-1B.3.h2-queue-cli, AI-P1-3) |
| `tests/unit/check_secrets_test.ts` | Pre-commit secret scanner pure-function tests — `isStagedEnvFile` / `isEnvFileExempt` filename guard + `redactMatch` preview + `scanForSecrets` vendor patterns (OpenAI / Anthropic / Google / AWS / GitHub PAT classic+fine-grained+oauth / Doppler) + regex `g`-flag state isolation across files | — (INFRA-1B.5.h1-runbook-setup-hygiene, AI-P1-12) |
| `tests/unit/r2_invariant_scanner_test.ts` | R2 invariant scanner pure + integration tests — `parseSnapIdFromRationale` (5) + `reconcile` 3-axis + combined (9) + `fetchUploadedAuditRows` / `fetchSourcePolicies` SQLite integration (5) + `fetchR2BackedSnapshots` Neo4j-mock integration (2) + `scanR2Invariants` orchestrator aligned + Axis 3 (2) — 24 tests total | — (OPS-1B.h1-runtime-invariant-scanner, AI-P1-6) |
| `tests/unit/access_intervention_test.ts` | severity scoring + recorder integration + batch-report generation (26 tests) | TEST-024 (AC-024) |
| `tests/unit/safe_fetch_test.ts` | safe-fetch defense unit tests (158 tests — Cycle 32 INV-0028-6 declared-vs-sniffed enforcement: +17 `classifyDeclaredContentType` + 12 `isContentTypeMismatch` + 11 safeFetch integration) | — (ADR-0028, DEC-017) |
| `tests/unit/html_to_text_test.ts` | ADR-0029 INV-0029-5 HTML sanitizer tests (31 tests — basic stripping + DANGEROUS_TAGS removal incl. case-insensitive + self-closing + orphan + entity decoding incl. Korean codepoint + comment stripping + adversarial combined). Cycle 38 EXTR-1A.0. | (ADR-0029, EXTR-1A.0) |
| `tests/unit/untrusted_wrapper_test.ts` | ADR-0029 INV-0029-1 + INV-0029-3 sentinel wrapper tests (20 tests — basic sentinel + Korean preservation + custom sentinel + token cap truncation + per-tier caps + adversarial sentinel-in-content + injection payload preservation). Cycle 38 EXTR-1A.0. | (ADR-0029, EXTR-1A.0) |
| `tests/unit/llm_policy_gate_test.ts` | ADR-0029 INV-0029-4 + ADR-0017 source policy gate tests (12 tests — in-memory SQLite fixture: allowed-pass + each enum case throw + sourceId field on errors + fail-closed for unregistered + TypeError on empty/non-string + scoped per sourceId). Cycle 38 EXTR-1A.0. | (ADR-0029, ADR-0017, EXTR-1A.0) |
| `tests/unit/extractor_router_test.ts` | EXTR-1A.1 extractor router tests (25 tests — SOURCE_TYPE enum + isSourceType + ExtractorRegistry round-trip + 3 typed errors + TEST-009 article/dataset/report dispatch + envelope validation + envelope-consistency fail-closed + TEST-021 dry-run extensibility). Cycle 39 EXTR-1A.1. | (REQ-009, AC-009, AC-021, NFR-007, EXTR-1A.1) |
| `tests/unit/article_extractor_test.ts` | ArticleExtractor tests (29 tests — envelope + INV-0029-4 policy gate fail-closed + INV-0029-5 sanitization + INV-0029-1 sentinel + INV-0029-3 per-tier token cap + registry integration + multi-vector adversarial defense-in-depth + OPS-1A.1 run_ledger integration: mock-vendor skip + openai startRun→completeRun row + failRun on throw + anthropic domain_override_reason + policy-fail no ledger + undefined cost → 0). Cycle 40 + 41 EXTR-1A.2a/2b. Test fixture migrated to `process.env.SQLITE_PATH=:memory:` pattern matching run_ledger_test. | (ADR-0029, ADR-0023, AC-007, AC-009, AC-010, AC-019, EXTR-1A.2a/2b) |
| `tests/unit/openai_client_test.ts` | OpenAIClient tests (23 tests — constructor apiKey fail-fast/env fallback/vendor/tier defaults + per-tier model + explicit model override + LlmClient interface compliance + request shape POST URL/Bearer auth/baseUrl override/messages body + response parsing tokens/cached/cost/empty cases + error path 4xx/429/network throw + computeTotalCostUsd pricing math). Cycle 41 EXTR-1A.2b. All fetch mocked — no real OpenAI API call. | (ADR-0023, AC-007, AC-019, EXTR-1A.2b) |
| `tests/unit/xml_safe_test.ts` | xml-safe singleton + XXE block tests | — (DEC-018) |
| `tests/unit/semaphore_test.ts` | Bounded semaphore primitive | — (INFRA-1B.2b) |
| `tests/unit/pool_test.ts` | Global + per-host pool acquire/release | — (INFRA-1B.2b) |
| `tests/unit/crawl_state_test.ts` | crawl_state upsert + backoff + etag/Last-Modified | — (INFRA-1B.2b) |
| `tests/unit/rss_worker_test.ts` | RSS/Atom parse + discovery_queue enqueue + dedup | — (INFRA-1B.2) |
| `tests/unit/snapshot_fingerprint_test.ts` | Snapshot fingerprint + content_hash dedup + R2 back-fill (permitted) | TEST-020 (AC-003, AC-020) |
| `tests/unit/chunker_test.ts` | Snapshot text → chunk + Neo4j FTS index | — (INFRA-1B.4) |
| `tests/unit/feedback_test.ts` | manual_claim_entry 3-way + intervention review 3-option | TEST-025 (AC-025) |
| `tests/unit/run_ledger_test.ts` | startRun / completeRun / failRun + daily cost aggregation (29 tests) | TEST-019 (AC-019) |
| `tests/unit/audit_policy_decisions_test.ts` | recordR2UploadDecision audit ledger — IntendedAction + R2UploadDecision enum + canonical column INSERT + 4 lifecycle decisions + snap_id rationale anchor correlation (16 tests) | — (INFRA-1B.3.x-audit, AC-032 / NFR-008) |
| `tests/policy/gate_test.ts` | ADR-0017 INV-0017-3/4/5 policy_gate evaluator — stageDefaultMode (6) + detectRisks 8 trigger × fire/not-fire/mode-invariance/multi-trigger (24) + evaluatePolicyGate combined (8) + recordPolicyGateDecision intended_action=NULL namespace + writer-boundary guard (6) + TEST-023 E2E 8 trigger × ledger record × INV-0017-4 mode-invariance (9). 53 tests total. | TEST-023 (AC-023, INFRA-1B.5.h2-policy-gate-risk-triggers) |
| `tests/policy/llm_routing_config_test.ts` | ADR-0023 INV-0023-2 / INV-0023-3 / INV-0023-5 pure config validator tests (67 tests post-codex-rounds). Live integration (5) + assertTier0VendorRoles incl. effort enforcement (15) + assertTiersCapabilityCanonical incl. value scan + composite key token-boundary scan (21) + assertGoogleScopeIsTier3Only incl. unknown-tier reject + tier_3 role allowlist (21) + loader (1). Cycle 34 operator D3 2026-05-18 + 2 codex round hardening (PR #93). | (ADR-0023 config-level enforcement) |
| `tests/policy/vault_jsonl_policy_test.ts` | ADR-0012 INV-0012-5 (Markdown vault content kinds + scenario citation + MDX support) + INV-0012-6 (JSONL not canonical) pure policy validator tests (49 tests post-codex-round-1). Live integration (4) + assertVaultContentKinds positive/negative + EditorialIntent + MDX extension export coverage (12) + assertPromotedClaimsAreCited (9 — frontmatter cited_claims / body whole-word / claim_id frontmatter override / orphan reject / no-scenarios reject / multi-orphan reporting / prefix-substring word-boundary defense / MDX body citation) + assertJsonlIsNotCanonical allowlist/violation (12) + filesystem round-trip via tmpdir incl. MDX scan + orphan-claim throw + happy-path round-trip (12). Cycle 35 operator D4 2026-05-18 + 1 codex round hardening (PR #94). | (ADR-0012 vault / JSONL canonical-store guard) |
| `tests/test-helpers/neo4j-mock.ts` | Shared Neo4j mock helper | (test infra) |
| `tests/bench/neo4j_fts_search_bench.ts` | Neo4j FTS p95 < 1s bench (SPIKE-001) | TEST-002 (needs Neo4j) |

## Scripts

| Path | Purpose |
|---|---|
| `scripts/validate_invariants.ts` | ADR-0002 invariant checker (warning-level, exit 0) — Cycle 14 (INFRA-1A.9-validator-extension) adds `checkCrossRefCode()`: each invariant's optional `cross_ref_code[]` frontmatter list is parsed as `<file>:<exportName>` or `<file>:<line>`, files resolved relative to repo root, exports matched against `export <kw> <name>` declarations or `export { <name> }` re-export blocks, lines bounds-checked. Broken refs surface as warnings. INV-0012-3 backfilled (DEC-020 Q-045 priority); INV-0028-* / INV-0023-3 / INV-0017 backfill 다음 cycles. |
| `scripts/migrate.ts` | Applies Neo4j + SQLite migrations |
| `scripts/check-doc-governance.rb` | Doc governance lint (Ruby) |
| `scripts/seed-sources.ts` | Seed `source_material_policy` from `data/sources_seed.yaml` (`--dry-run` flag, INFRA-1B.1) |

## Config / Data

| Path | Purpose |
|---|---|
| `data/llm_routing.yaml` | LLM routing operational catalog (ADR-0023) |
| `data/sources_seed.yaml` | Tier A 72 source seed (INFRA-1A.6, AC-027) |
| `package.json` | bun scripts + dependencies |
| `tsconfig.json` | TypeScript compiler options |

## Planned (post-P0-M2)

| Path | Purpose |
|---|---|
| `src/cli/` | pipeline CLI namespace (M3+ — extraction / scenario / publish) |
| `src/extraction/` | Extractor + LLM router (P0-M3, EXTR-1A.*) |
| `src/scenario/` | Scenario composer + validate + revisions ledger (P0-M5) |
| `src/cite_check/` | 5+1 cite check (P0-M6) |
| `data/transforms/` | Data Science Module specs `<spec_id>.{py,sql}` (ADR-0024) |
| `docs/_generated/` | Invariant artifacts (scope_tree, term_usage, effective_invariant_policy) — regenerated by `bun run invariant:regen` |

---

Rules:

- Use actual paths once implementation exists.
- Mark uncertain modules as `needs audit`.
- Do not invent modules.
