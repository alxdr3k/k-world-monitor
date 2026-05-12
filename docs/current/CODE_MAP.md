# Code Map

> Last verified against code: f436e7a (2026-05-12) — INFRA-1B.1.x review-8 P2 fixes (scheme allowlist, field guard, NaN guard)

## Runtime stack

- **bun** (JavaScript/TypeScript runtime + package manager)
- **TypeScript** (strict mode, `tsconfig.json`)
- **better-sqlite3** (SQLite driver, synchronous)
- **neo4j-driver** (Neo4j Bolt protocol, async)
- **ulid** (monotonic ID generation)
- **js-yaml** (YAML parsing for invariant validator)

## Entry points

| Path | Purpose |
|---|---|
| `scripts/migrate.ts` | Migration runner CLI (`bun run migrate`, `:neo4j`, `:sqlite`) |
| `scripts/validate_invariants.ts` | Invariant validator (`bun run invariant:check`) |
| `tests/bench/neo4j_fts_search_bench.ts` | SPIKE-001 FTS bench (`bun run bench:neo4j`) |

## Migrations

| Path | Purpose |
|---|---|
| `migrations/neo4j/v1_schema.cypher` | Neo4j graph schema v1: constraints, indexes, FTS |
| `migrations/sqlite/v1_schema.sql` | SQLite relational schema v1: all 16 tables |

## Source

| Path | Purpose |
|---|---|
| `src/domain/ids.ts` | ID prefix constants + `validateIdPrefix()` (AC-005) |
| `src/domain/nodes.ts` | TypeScript interfaces: SourceNode, ScenarioNode, ThesisNode (INFRA-1A.7) |
| `src/utils/text.ts` | `normalizeText()` / `truncateCodePoints()` / `isWithinLimit()` (AC-007) |
| `src/utils/hash.ts` | `sha256Hex()` / `sha256Prefix()` (ADR-0025, AC-007) |
| `src/utils/enums.ts` | All domain enum const arrays + `is*()` validators (INFRA-1A.5/1A.7) |
| `src/storage/neo4j/connection.ts` | Neo4j driver singleton + `withSession()` |
| `src/storage/sqlite/connection.ts` | SQLite DB singleton + migration helper |
| `src/storage/r2/policy.ts` | PERMITTED_PREFIXES + `checkPermittedPrefix()` + sha256 helpers (ADR-0012 INV-0012-4, INFRA-1A.3) |
| `src/storage/r2/client.ts` | Bun.S3Client wrapper — `r2Put/r2Get/r2Delete` with policy enforcement (INFRA-1A.3) |
| `src/storage/source-registry/seed.ts` | Parse `data/sources_seed.yaml`, validate enums, upsert `source_material_policy` rows (INFRA-1B.1) |

## Tests

| Path | Purpose | TEST id |
|---|---|---|
| `tests/lint/id_prefix_test.ts` | ID prefix validation for all domain types | TEST-005 |
| `tests/lint/no_frontmatter_relation_array_test.ts` | Frontmatter relation array lint (TEST-008/AC-008) | TEST-008 |
| `tests/unit/text_hash_test.ts` | normalizeText / sha256 / enum validator tests (AC-007) | — |
| `tests/unit/bidirectional_schema_test.ts` | Thesis stance / source perspective enum + AC-027 distribution (AC-026, AC-027) | — |
| `tests/unit/perspective_distribution_test.ts` | AC-027 Tier A seed distribution lint — reads data/sources_seed.yaml (AC-027, REQ-022) | TEST-027 |
| `tests/unit/r2_policy_test.ts` | R2 permitted-prefix + sha256 round-trip integrity (AC-003, AC-020, AC-032) | — |
| `tests/unit/source_registry_test.ts` | Source registry seed dry-run + enum validation + YAML structure (INFRA-1B.1) | — |
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
| `package.json` | bun scripts + dependencies |
| `tsconfig.json` | TypeScript compiler options |

## Planned (INFRA-1B.2+)

| Path | Purpose |
|---|---|
| `src/cli/` | CLI entrypoints (INFRA-1B.1) |
| `src/domain/` | Full domain model types (INFRA-1B) |
| `src/discovery/` | RSS/API/sitemap discovery worker (INFRA-1B.1) |
| `src/extraction/` | Extractor + LLM router (P0-M3) |
| `src/scenario/` | Scenario composer + validate + revisions ledger (P0-M5) |
| `src/cite_check/` | 5+1 cite check (P0-M6) |
| `src/ops/` | Run ledger + cost throttling + stale worker |
| `data/transforms/` | Data Science Module specs `<spec_id>.{py,sql}` (ADR-0024) |
| `docs/_generated/` | Invariant artifacts (scope_tree, term_usage, effective_invariant_policy) |

---

Rules:

- Use actual paths once implementation exists.
- Mark uncertain modules as `needs audit`.
- Do not invent modules.
