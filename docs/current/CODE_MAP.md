# Code Map

> Last verified against code: 75706c4970ca094c1c56e15a92beaf165c03fc38 (2026-05-14) — INFRA-1B.3.x-audit landed (R2 upload audit ledger, AC-032 / NFR-008 evidence, Q-044 → DEC-020 / TRACE-040). Previous code baseline = 13d61af (2026-05-13) — comprehensive review backfill.

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
| `scripts/seed-sources.ts` | Source registry seed CLI (`bun run seed-sources`, `:dry-run`, INFRA-1B.1) |
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

## Source

### Domain / utils

| Path | Purpose |
|---|---|
| `src/domain/ids.ts` | ID prefix constants + `validateIdPrefix()` (AC-005) |
| `src/domain/nodes.ts` | TypeScript interfaces: SourceNode, ScenarioNode, ThesisNode (INFRA-1A.7) |
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
| `src/storage/source-registry/neo4j-bootstrap.ts` | `bootstrapNeo4jSourceNodes()` UNWIND MERGE Neo4j Source nodes from SQLite seed rows + `preflightSourceRegistry()` SQLite policy / SQLite slug_map / Neo4j Source set 3-way alignment check + `assertSourceRegistryAligned()` fail-fast (INFRA-1B.1.h1-source-bootstrap-neo4j, AI-P1-2) |
| `src/storage/audit/policy-decisions.ts` | `recordR2UploadDecision()` — immutable audit row INSERT into policy_decisions around every r2Put call site in snapshot-fingerprint (INFRA-1B.3.x-audit, AC-032 / NFR-008, ADR-0012 INV-0012-3) |

### Discovery

| Path | Purpose |
|---|---|
| `src/discovery/fetch/safe-fetch.ts` | `safeFetch()` — SSRF/redirect/size/robots/sniff defenses (ADR-0028 INV-0028-1..6, DEC-017, INFRA-1B.2a) |
| `src/discovery/parse/xml-safe.ts` | `RSS_PARSER` singleton — fast-xml-parser with XXE disabled (DEC-018, INFRA-1B.2a) |
| `src/discovery/scheduler/semaphore.ts` | Bounded semaphore primitive — async acquire/release (INFRA-1B.2b, ADR-0030 INV-0030-1) |
| `src/discovery/scheduler/pool.ts` | Global + per-host semaphore pool — 8 global / 1 per-host (INFRA-1B.2b, ADR-0030 INV-0030-1) |
| `src/discovery/scheduler/crawl-state.ts` | etag/Last-Modified + consecutive_failures + next_eligible_at upsert (INFRA-1B.2b) |
| `src/discovery/scheduler/scheduler.ts` | poll → fetch → write phases — fetch/write separation (INFRA-1B.2b, ADR-0030 INV-0030-2) |
| `src/discovery/worker/rss-worker.ts` | RSS/Atom item parse + discovery_queue enqueue (INFRA-1B.2) |
| `src/discovery/worker/snapshot-fingerprint.ts` | Fetcher → Snapshot fingerprint (URL + content_hash + locator) + R2 back-fill for permitted artifacts (INFRA-1B.3) |
| `src/discovery/worker/chunker.ts` | Snapshot text → chunk + Neo4j FTS index write (INFRA-1B.4) |
| `src/discovery/worker/run-discovery.ts` | Discovery worker entry — orchestrates poll + fetch + fingerprint (INFRA-1B.2) |

### Pipeline (access intervention + feedback)

| Path | Purpose |
|---|---|
| `src/pipeline/access-intervention/severity.ts` | `computeSeverity()` — deterministic: GateMode × importance_score × relatedAssumptionIds (INFRA-1B.5, AC-024) |
| `src/pipeline/access-intervention/recorder.ts` | `recordIntervention()` — AccessIntervention Neo4j node `aci_<ULID>` (INFRA-1B.5) |
| `src/pipeline/access-intervention/batch-report.ts` | `generateBatchReport()` — severity-bucketed Markdown + hasBlockers cite-check flag (INFRA-1B.5, AC-024) |
| `src/pipeline/feedback/manual-claim-entry.ts` | `pipeline feedback add` 3-way 분리 (user_written_claim / user_opinion / referenced_quote) — raw_text_stored=false 강제 (INFRA-1B.6, AC-025) |
| `src/pipeline/feedback/intervention-review.ts` | `pipeline intervention review <id>` 3-option (ignore / manual_claim / temp_text) (INFRA-1B.6, AC-025) |

### Ops

| Path | Purpose |
|---|---|
| `src/ops/run-ledger.ts` | `startRun()` / `completeRun()` / `failRun()` + daily cost aggregation (`getDailyCostUsd`, `getDailyCostBreakdown`). CAS gate (`WHERE status='running'`) on completeRun/failRun. ADR-0023 INV-0023-7 (OPS-1A.1, AC-019) |

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
| `tests/unit/access_intervention_test.ts` | severity scoring + recorder integration + batch-report generation (26 tests) | TEST-024 (AC-024) |
| `tests/unit/safe_fetch_test.ts` | safe-fetch defense unit tests (117 tests) | — (ADR-0028, DEC-017) |
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
| `tests/test-helpers/neo4j-mock.ts` | Shared Neo4j mock helper | (test infra) |
| `tests/bench/neo4j_fts_search_bench.ts` | Neo4j FTS p95 < 1s bench (SPIKE-001) | TEST-002 (needs Neo4j) |

## Scripts

| Path | Purpose |
|---|---|
| `scripts/validate_invariants.ts` | ADR-0002 invariant checker (warning-level, exit 0) |
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
