---
id: ctx-future-implementation-inventory
type: context_artifact
title: Future-implementation Invariant Inventory (ADR design-stage / phase activation registry)
created_at: 2026-05-19
updated_at: 2026-05-19
owner_slice: INFRA-1A.11-future-implementation-inventory
operator_decision: D6 (2026-05-18)
related_systems:
  - docs/adr/
  - scripts/validate_invariants.ts
  - docs/decisions/DEC-020.md (Q-045 cross_ref_code semantic scope)
status: active
---

# Future-implementation Invariant Inventory

## Purpose

Per operator decision D6 (2026-05-18) — 19 design-stage ADRs are explicitly
**NOT to be treated as code-gap backfill targets**. They are
"future-implementation invariants" whose activation depends on the
roadmap phase that introduces the corresponding production subsystem.

The validator (`scripts/validate_invariants.ts`) must not flag these as
"fail" — they are documented as future activation inventory here, and
the `cross_ref_code` system is intentionally allowed to be absent until
the production wiring lands.

## How to read this inventory

Each ADR section lists:

- **Invariants**: IDs (frontmatter `invariants[]`).
- **activation_phase**: the milestone / slice / phase that is expected
  to introduce the production subsystem enforcing the invariants.
- **current_status**: one of `design-only` (no production code yet) /
  `partially-implemented` (some invariants have production code, others
  do not) / `superseded` (ADR replaced by a successor).
- **enforcement_status**: one of `not-yet-activated` /
  `partially-activated` / `historical (superseded)`.
- **reason**: brief justification for the classification.

`cross_ref_code` for these invariants is **optional**; absence is not a
violation. When a future slice lands the production wiring for an
invariant, that slice MUST add the `cross_ref_code` entry as part of the
same engineering PR (per AGENTS.md "engineering slice PR sync" rule).

## Inventory

### Inventory entry — ADR-0003 — 7-stage pipeline object model with 3-tier source layer

- **Invariants**: INV-0003-1, INV-0003-2, INV-0003-3, INV-0003-4, INV-0003-5, INV-0003-6, INV-0003-7
- **activation_phase**: superseded by ADR-0011 (9-stage) and ADR-0025 (10-stage)
- **current_status**: superseded
- **enforcement_status**: historical (superseded)
- **reason**: 7-stage model replaced by 9-stage (ADR-0011) and then by 10-stage (ADR-0025). No new code targets this ADR; invariants preserved as audit trail only.

### Inventory entry — ADR-0004 — Storage tiers (Markdown / SQLite+FTS5 / R2 bytes)

- **Invariants**: INV-0004-1, INV-0004-2, INV-0004-3, INV-0004-4
- **activation_phase**: superseded by ADR-0012 (non-archival storage with R2 as permitted-artifact store, not raw archive)
- **current_status**: superseded
- **enforcement_status**: historical (superseded)
- **reason**: ADR-0012 supersedes the "R2 = raw bytes store" framing with "R2 = permitted artifact store" (raw cloud upload prohibited). The 4 invariants here are kept as audit trail.

### Inventory entry — ADR-0005 — Confidence decomposition (reliability_tier / extraction_confidence / claim_status / scenario weight)

- **Invariants**: INV-0005-1, INV-0005-2, INV-0005-3, INV-0005-4, INV-0005-5, INV-0005-6
- **activation_phase**: P0-M3 (EXTR-1A.* extraction routing) + P0-M4 (AGG-1A.* claim status + dossier weight) + P0-M5 (scenario weight composition)
- **current_status**: design-only
- **enforcement_status**: not-yet-activated
- **reason**: extraction confidence and claim status are computed during extraction (EXTR-1A.*) which has not yet been wired. `reliability_tier` is a Source field (seeded today) but its consumption in confidence math lives in EXTR-1A.* / AGG-1A.* code paths.

### Inventory entry — ADR-0007 — Edge ledger (supports / contradicts / qualifies / updates / supersedes)

- **Invariants**: INV-0007-1, INV-0007-2, INV-0007-3
- **activation_phase**: superseded by ADR-0013 (Neo4j-native edge ledger)
- **current_status**: superseded
- **enforcement_status**: historical (superseded)
- **reason**: ADR-0013 INV-0013-6 explicitly supersedes ADR-0007 INV-0007-1 (SQLite edges table replaced by Neo4j typed relationships). The 3 invariants here are kept as audit trail.

### Inventory entry — ADR-0013 — Edge ledger via Neo4j (supersedes ADR-0007)

- **Invariants**: INV-0013-1, INV-0013-2, INV-0013-3, INV-0013-4, INV-0013-5, INV-0013-6
- **activation_phase**: P0-M3 (EXTR-1A.4 edge writer) + P0-M4 (AGG-1A.* edge consumers — dossier composer / counterclaim aggregation)
- **current_status**: design-only
- **enforcement_status**: not-yet-activated
- **reason**: Neo4j schema for edges is defined (INFRA-1A.2 migration), but the edge WRITER (`MERGE (a)-[:SUPPORTS]->(b)` etc.) lives in EXTR-1A.4+ and AGG-1A.*. No production code yet creates edges.

### Inventory entry — ADR-0014 — Neo4j-native feature adoption (APOC + GDS + native vector + native FTS)

- **Invariants**: INV-0014-1, INV-0014-2, INV-0014-3, INV-0014-4, INV-0014-5, INV-0014-6, INV-0014-7
- **activation_phase**: P0-M3 (EXTR-1A.* vector + FTS) + P0-M4 (AGG-1A.* APOC + GDS for dossier composition / scenario composer)
- **current_status**: design-only
- **enforcement_status**: not-yet-activated
- **reason**: Neo4j Community Edition is required (INV-0012-1 covered, PR #88 cross_ref). Native vector / FTS / APOC / GDS usage is wired in EXTR-1A.* and AGG-1A.* slices, none of which have landed.

### Inventory entry — ADR-0015 — Evidence (nullable quote + quote_reason + storage_level) + cite check 5+1 (supersedes ADR-0008)

- **Invariants**: INV-0015-1, INV-0015-2, INV-0015-3, INV-0015-4, INV-0015-5, INV-0015-6, INV-0015-7, INV-0015-8
- **activation_phase**: P0-M3 (EXTR-1A.* evidence extraction with quote + quote_reason + storage_level) + P0-M6 (PUB-1A.2 cite check 5+1)
- **current_status**: design-only
- **enforcement_status**: not-yet-activated
- **reason**: `quote_reason` enum is in SQLite schema (INFRA-1A.5 landed) but cite check 5+1 (stale / retracted / horizon / unit / overclaim + intervention) and evidence storage_level wiring are PUB-1A.2 / EXTR-1A.* — not yet implemented.

### Inventory entry — ADR-0018 — Manual feedback inbound (manual_claim_entries + CLI)

- **Invariants**: INV-0018-1, INV-0018-2, INV-0018-3, INV-0018-4, INV-0018-5, INV-0018-6
- **activation_phase**: INFRA-1B.6 (CLI landed, P0-M3 cross-milestone early)
- **current_status**: partially-implemented
- **enforcement_status**: partially-activated
- **reason**: `pipeline feedback` + `pipeline intervention review` CLI landed via PR #22 (INFRA-1B.6). manual_claim_entries SQLite table + Neo4j ManualClaimEntry node implemented. cross_ref_code for landed invariants can be backfilled in a future slice; remaining invariants (intervention review flow + claim-tier deduplication) are EXTR-1A.* / AGG-1A.* phase.

### Inventory entry — ADR-0019 — Bidirectional framing (scenario.impact_targets[] / impact_direction_by_target / thesis.stance + market_stance / EvidencePack multi-layer)

- **Invariants**: INV-0019-1, INV-0019-2, INV-0019-3, INV-0019-4, INV-0019-5, INV-0019-6, INV-0019-7, INV-0019-8, INV-0019-9
- **activation_phase**: P0-M3 (EXTR-1A.5 evidence_role classification) + P0-M4 (AGG-1A.3 scenario composer with bidirectional framing) + P0-M5 (AGG-1A.4 thesis composer with stance + market_stance) + P0-M6 (PUB-1A.2 cite check one-sided thesis warning v1+)
- **current_status**: design-only (schema only)
- **enforcement_status**: not-yet-activated
- **reason**: Scenario / Thesis schema fields (impact_targets[], stance, market_stance, source_perspective) landed via INFRA-1A.7. Consumer code (composer + cite check) is AGG-1A.* / PUB-1A.* — not yet wired.

### Inventory entry — ADR-0020 — System metrics framework (6 categories + evaluation harness)

- **Invariants**: INV-0020-1, INV-0020-2, INV-0020-3, INV-0020-4, INV-0020-5, INV-0020-6
- **activation_phase**: OPS-1A.2+ (metrics_run / metrics_daily / metrics_alerts tables already in INFRA-1A.2 v1 schema) + P1-M1+ evaluation harness
- **current_status**: design-only (schema only)
- **enforcement_status**: not-yet-activated
- **reason**: metrics tables exist in SQLite v1 schema, but the WRITER (metrics computation + alert evaluation) lives in OPS-1A.2+. Evaluation harness (evaluation_runs / evaluation_cases) is P1+.

### Inventory entry — ADR-0021 — Policy learning framework (rule-based, auto-tighten allowed, auto-relax prohibited)

- **Invariants**: INV-0021-1, INV-0021-2, INV-0021-3, INV-0021-4, INV-0021-5, INV-0021-6
- **activation_phase**: P1+ (staged v0 → v1 → v2 → v3 patterns)
- **current_status**: design-only (schema only)
- **enforcement_status**: not-yet-activated
- **reason**: policy_learning_events SQLite table exists (INFRA-1A.2 landed) but the policy learning engine (rule evaluation + auto-tighten gate) is staged at P1+ per ADR-0021.

### Inventory entry — ADR-0022 — Publishing site (Astro 5.0 + Cloudflare Pages + vault publications/ as source)

- **Invariants**: INV-0022-1, INV-0022-2, INV-0022-3, INV-0022-4, INV-0022-5, INV-0022-6, INV-0022-7
- **activation_phase**: P0-M6 (PUB-1A.4 Astro skeleton + PUB-1A.5 첫 publication)
- **current_status**: design-only
- **enforcement_status**: not-yet-activated (partial scope guard via `scripts/check-vault-jsonl-policy.ts` from PR #94, covering vault content kinds + JSONL canonical-store guard only — the Astro Content Collection + Zod schema + 6-field build-fail policy belongs to PUB-1A.*)
- **reason**: Astro repo is not yet scaffolded. PUB-1A.4 is the activating slice.

### Inventory entry — ADR-0024 — Data Science Module (deterministic dataset processing)

- **Invariants**: INV-0024-1, INV-0024-2, INV-0024-3, INV-0024-4, INV-0024-5
- **activation_phase**: P0-M4 (AGG-1A.* dossier_composer dataset_input + extraction_layer derived_metric_computer)
- **current_status**: design-only
- **enforcement_status**: not-yet-activated
- **reason**: Data Science Module is not yet implemented. INV-0023-6 (large dataset → DSM mandatory) is enforced at the LLM call boundary in AGG-1A.* — not yet wired.

### Inventory entry — ADR-0025 — Editorial Intent layer (10-stage object model)

- **Invariants**: INV-0025-1, INV-0025-2, INV-0025-3, INV-0025-4, INV-0025-5, INV-0025-6, INV-0025-7, INV-0025-8
- **activation_phase**: P0-M6 (AGG-1A.5 EditorialIntent Composer + PUB-1A.1 ContentDraft uses EditorialIntent + PUB-1A.5 첫 publication with operator-locked EditorialIntent)
- **current_status**: design-only
- **enforcement_status**: not-yet-activated (vault content kind allowed via `scripts/check-vault-jsonl-policy.ts:PERMITTED_VAULT_KINDS` from PR #94 — preparation, not enforcement of INV-0025-* statements)
- **reason**: EditorialIntent composer + `:HAS_INTENT` / `:USES_INTENT` Neo4j relationships + `vault/editorial_intents/<eit_id>.md` writer are P0-M6 slices, not yet landed.

### Inventory entry — ADR-0026 — Active source subset vs Tier A seed universe

- **Invariants**: INV-0026-1, INV-0026-2, INV-0026-3, INV-0026-4, INV-0026-5, INV-0026-6
- **activation_phase**: P0-M6 (PUB-1A.5 첫 publication — active source scope 정의 + manual activation flag)
- **current_status**: design-only
- **enforcement_status**: not-yet-activated
- **reason**: 72-source Tier A seed exists (data/sources_seed.yaml, INFRA-1A.6 landed), but the active subset designation (operator-flagged) + activation flag schema is P0-M6 scope.

### Inventory entry — ADR-0027 — Claim-level evidence_role classification

- **Invariants**: INV-0027-1, INV-0027-2, INV-0027-3, INV-0027-4, INV-0027-5, INV-0027-6
- **activation_phase**: P0-M3 (EXTR-1A.5 evidence_role extraction) + P0-M4 (AGG-1A.3 dossier composer evidence_role minimum coverage) + P0-M6 (PUB-1A.2 EvidencePack v0 4-section grouping AC-044 (c))
- **current_status**: design-only
- **enforcement_status**: not-yet-activated
- **reason**: evidence_role is a claim-layer classification computed in EXTR-1A.5; dossier composer + EvidencePack consume it in AGG-1A.3 / PUB-1A.2.

### Inventory entry — ADR-0029 — LLM Prompt Injection containment (untrusted source content quarantine)

- **Invariants**: INV-0029-1, INV-0029-2, INV-0029-3, INV-0029-4, INV-0029-5
- **activation_phase**: EXTR-1A.0 (defensive infrastructure landed via Cycle 38) + EXTR-1A.1+ (extractor router wiring) + AGG-1A.* (dossier / scenario / thesis composers) + PUB-1A.* (publication preflight)
- **current_status**: partially-implemented (Cycle 38 EXTR-1A.0 landed defensive modules)
- **enforcement_status**: partially-activated
- **reason**: EXTR-1A.0 (Cycle 38) landed `src/extraction/sanitize/html-to-text.ts` (INV-0029-5), `src/extraction/prompt/untrusted-wrapper.ts` (INV-0029-1 + INV-0029-3), and `src/extraction/policy/llm-policy-gate.ts` (INV-0029-4) with cross_ref_code on 4/5 invariants. INV-0029-2 (no-eval pattern enforcement) remains a code-pattern invariant — separate static-check anchor pending. EXTR-1A.1+ extractor router must import the defensive helpers per PRE-0029-1 (linter / convention enforce).

### Inventory entry — ADR-0030 — Discovery Worker concurrency model (bounded pool / host rate limit / SQLite serialization / Neo4j pool)

- **Invariants**: INV-0030-1, INV-0030-2, INV-0030-3, INV-0030-4, INV-0030-5
- **activation_phase**: INFRA-1B.2b (semaphore + pool landed, P0-M2)
- **current_status**: partially-implemented
- **enforcement_status**: partially-activated
- **reason**: INFRA-1B.2b (PR #17, 0eec962) landed bounded semaphore (global 8 / per-host 1) + Neo4j pool env vars + crawl_state backoff. Discovery worker still has remaining hardening slices (INFRA-1B.2.h1 / INFRA-1B.2.h2 — planned). Backfill of `cross_ref_code` for landed invariants (INV-0030-1, INV-0030-2) is eligible in a future slice if operator promotes.

### Inventory entry — ADR-0031 — Research App /ops UI stack (Astro shell + React 18 island + Tailwind + shadcn/ui + Radix + TanStack Query v5 + SSE)

- **Invariants**: INV-0031-1, INV-0031-2, INV-0031-3, INV-0031-4, INV-0031-5, INV-0031-6, INV-0031-7
- **activation_phase**: P0-M6 (RESEARCH-1A.0 read-only /ops mobile minimum, RESEARCH-1A.1+ full UX)
- **current_status**: design-only
- **enforcement_status**: not-yet-activated
- **reason**: Astro /ops shell is not yet scaffolded. RESEARCH-1A.API0 (Hetzner Bun + Hono API skeleton) + RESEARCH-1A.0 (/ops read-only UI) are the activating slices.

## Summary table

| ADR | Invariants count | current_status | enforcement_status | activation_phase |
|-----|------------------|----------------|--------------------|------------------|
| ADR-0003 | 7 | superseded | historical | (replaced by ADR-0011 + ADR-0025) |
| ADR-0004 | 4 | superseded | historical | (replaced by ADR-0012) |
| ADR-0005 | 6 | design-only | not-yet-activated | P0-M3 / P0-M4 / P0-M5 |
| ADR-0007 | 3 | superseded | historical | (replaced by ADR-0013) |
| ADR-0013 | 6 | design-only | not-yet-activated | P0-M3 / P0-M4 |
| ADR-0014 | 7 | design-only | not-yet-activated | P0-M3 / P0-M4 |
| ADR-0015 | 8 | design-only | not-yet-activated | P0-M3 / P0-M6 |
| ADR-0018 | 6 | partially-implemented | partially-activated | INFRA-1B.6 landed; EXTR-1A.* / AGG-1A.* remaining |
| ADR-0019 | 9 | design-only (schema only) | not-yet-activated | P0-M3 / P0-M4 / P0-M5 / P0-M6 |
| ADR-0020 | 6 | design-only (schema only) | not-yet-activated | OPS-1A.2+ / P1+ |
| ADR-0021 | 6 | design-only (schema only) | not-yet-activated | P1+ (staged v0-v3) |
| ADR-0022 | 7 | design-only | not-yet-activated | P0-M6 (PUB-1A.4 / PUB-1A.5) |
| ADR-0024 | 5 | design-only | not-yet-activated | P0-M4 (AGG-1A.*) |
| ADR-0025 | 8 | design-only | not-yet-activated | P0-M6 (AGG-1A.5 + PUB-1A.*) |
| ADR-0026 | 6 | design-only | not-yet-activated | P0-M6 (PUB-1A.5) |
| ADR-0027 | 6 | design-only | not-yet-activated | P0-M3 / P0-M4 / P0-M6 |
| ADR-0029 | 5 | design-only | not-yet-activated | EXTR-1A.* / AGG-1A.* / PUB-1A.* |
| ADR-0030 | 5 | partially-implemented | partially-activated | INFRA-1B.2b landed; INFRA-1B.2.h1 / h2 remaining |
| ADR-0031 | 7 | design-only | not-yet-activated | P0-M6 (RESEARCH-1A.*) |
| **Total** | **117** | (mix) | (mix) | (various) |

## Validator policy

`scripts/validate_invariants.ts` MUST NOT escalate "missing
`cross_ref_code`" warnings for any invariant in this inventory.
The cross_ref_code system is a reachability heuristic for ALREADY-WIRED
production code (DEC-020 Q-045 — Cycle 27 PR #83 wording correction);
future-implementation invariants intentionally have no production code
yet, so `cross_ref_code` absence is the expected state.

When a future slice lands the production wiring for any invariant
listed here, the engineering PR for that slice MUST:

1. Add `cross_ref_code` to the invariant frontmatter (per AGENTS.md
   "engineering slice PR sync" rule).
2. Update this inventory entry's `current_status` and
   `enforcement_status` to reflect the new state.
3. Optionally split the ADR-level entry into invariant-level entries
   if some invariants are wired and others remain future.

## Drift history

- 2026-05-19 (Cycle 37, INFRA-1A.11-future-implementation-inventory): inventory established per operator decision D6 (2026-05-18). 19 ADRs / 117 invariants enumerated. 3 superseded ADRs (0003, 0004, 0007) classified as historical. 2 partially-implemented ADRs (0018 manual feedback, 0030 discovery worker concurrency) classified as partially-activated. Remaining 14 classified as design-only / not-yet-activated.
