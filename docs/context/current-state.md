# Current State

This file is the first read for new AI/human sessions.

It is a compressed current operating view, not full history.

## Project mode

- mode: greenfield
- adopted on: n/a
- adoption notes: n/a

## Product / Project

`k-world-monitor`는 세계 경제·지정학·감염병 등 변동성 높은 주제에서 **세계
변화의 위험·기회·회복탄력성·비대칭 영향 4축을 병렬 추적하는 시나리오
인텔리전스 파이프라인**이다. **10-stage 객체 모델** (Source → Document →
Snapshot → Claim → Dossier → Scenario → **EditorialIntent** → Thesis →
ContentDraft → Publication, ADR-0025 supersedes ADR-0011) 로 구조화하고,
출판 콘텐츠의 한 문장을 Snapshot 까지 **5-hop 이내로 역추적** 가능하게
유지 (NFR-003, DEC-020 Q-042 resolution — EditorialIntent / Source / Document
는 metadata anchor 로 trace 계산에서 선택적 skip 허용) 하며, raw third-party
text 는 클라우드에 저장하지 않는 콘텐츠 생산 시스템이다.

이 repo는 second-brain ideation
[`research-content-pipeline-architecture`](../discovery/research-content-pipeline-ideation.md)
의 "Current Canonical Direction" 섹션(Round 1~25 누적 결론)을 구현하는 외부
코드 repo다. 부트스트랩 시 Round 3 lock만 반영했던 ADR-0003/0004/0007/0008은
2026-05-11 reset에서 R6/R8/R10/R14/R17/R18/R19/R23/R25의 후속 결정을 반영해
ADR-0011~0021로 supersede됐고, 2026-05-11 이후 추가로 ADR-0022~0025 (publishing
stack / LLM routing v2 / Data Science Module / EditorialIntent 10-stage),
ADR-0026~0031 (active source subset / evidence_role / safe-fetch / prompt
injection containment / discovery worker concurrency / research app stack)
이 누적됐다.

## Current roadmap position

- current milestone: `P0-M2` (Source Registry & Collection Queue) — M2 슬라이스 일괄 landed, 게이트 검증 단계 진입. **P0-M2-hardening engineering sequence: 17 code hardening PR landed (16 historical Cycle 7/8/9/10 post-#58 + post-#65 GPT review followup + `INFRA-1B.5.h2-policy-gate-risk-triggers` AC-023 / TEST-023 evidence engineering — landed via PR #68 squash merge 2026-05-18 408cf2e, AI-P1-11 D1a/D2a 결정 lock, 798 tests pass)** + **Cycle 12 NOT-gate-blocking refactor: `INFRA-1A.x-shared-snapshot-id-constants` (shared snap_id + R2 prefix constants module 신설, 4 site magic-string duplication 종결, drift surface single source 확정 — PR #66 Cycle 10 Finding 6 anchor consolidation; PR #69 squash merged 2026-05-18 c996775, 798 → 816 tests)** + **Cycle 13 follow-up: `formatSnapIdRationalePrefix` writer-side helper (Cycle 12 Opus review P3 informational defer 처리, symmetric drift surface 종결; PR #71 squash merged 2026-05-18 742af9b, 816 → 820 tests)** + **Cycle 14 NOT-gate-blocking validator extension: `INFRA-1A.9-validator-extension` (invariant validator `cross_ref_code` 검증 추가 + INV-0012-3 backfill — DEC-020 Q-045 / TRACE-041 resolution; 본 PR pending, 820 → 833 tests; INV-0028-* / INV-0023-3 / INV-0017 backfill 은 다음 cycles)** + **Cycle 34 NOT-gate-blocking config validator: `INFRA-1A.9.h4-llm-routing-config-validator` (operator D3 2026-05-18 — `scripts/check-llm-routing-config.ts` 신규 pure config validator for ADR-0023 INV-0023-2 (Tier 0 vendor + effort lock) + INV-0023-3 (capability canonical, NOT price-axis 키 또는 값) + INV-0023-5 (Google scope = Tier 3 only, all-tier scan + role allowlist). LLM 호출 0, runtime wiring 0 — pure validator. data/llm_routing.yaml `tier_3.capability` 가 `low_cost_high_volume_and_search_grounding` 에서 `high_volume_throughput_and_search_grounding` 으로 갱신 (codex review P2 round 1 — capability value 가 price-axis token 포함 금지 contract). 970 → 1037 tests post-codex-3-rounds (37 initial + 25 round-1 + 5 round-2 = 67 신규). PR #93 merged 2026-05-19 80182d5)** + **Cycle 35 NOT-gate-blocking policy validator: `INFRA-1A.9.h5-vault-jsonl-policy-validator` (operator D4 2026-05-18 + 1 codex round hardening — `scripts/check-vault-jsonl-policy.ts` 신규 pure policy validator for ADR-0012 INV-0012-5 (Markdown vault content kinds — Document hub / Dossier / Scenario / Thesis / ContentDraft / Publication / promoted_claim / **editorialintent** [ADR-0025 added per codex P2] 만 permit; codex P2 — MDX 확장자 walk 추가 `VAULT_FILE_EXTENSIONS = [".md", ".mdx"]`; codex P2 — `assertPromotedClaimsAreCited` 신규 enforce — promoted_claim 의 claim_id 가 scenario frontmatter `cited_claims[]` 또는 scenario body whole-word 에 존재해야 함, INV-0012-5 "scenario에 인용된" clause closure) + INV-0012-6 (JSONL not canonical store — ALLOWED_JSONL_PATH_PREFIXES allowlist 외 *.jsonl 거부). vault 디렉터리 부재로 INV-0012-5 는 현재 vacuously true (future-guard); INV-0012-6 는 live `.dev-cycle/*.jsonl` 2개에 대해 allowlist 통과. ADR-0012 INV backfill 7/7 완료 (INV-0012-5 는 cross_ref 2 targets — assertVaultContentKinds + assertPromotedClaimsAreCited). 1037 → 1086 tests post-codex-round-1 (49 신규: 4 live + 12 vault content + 9 assertPromotedClaimsAreCited + 12 JSONL allowlist + 12 filesystem round-trip incl. MDX scan + orphan throw + happy-path). PR #94 merged 2026-05-19 2f2430f)** + **Cycle 36 NOT-gate-blocking glossary backfill: `INFRA-1A.10-glossary-backfill` (operator D5 2026-05-18 defer-eligible filler — landed via PR #95 doc-only): 3 신규 glossary entry — `retention_protected_kinds` (DEC-007 enum lock, GC batch reject list) + `data_science_module` (ADR-0024 + DEC-010 + INV-0023-6, mandatory_for_dataset_over_1000_rows_or_50kb) + `cross_vendor_reviewer` (DEC-010 + INV-0023-4 enforcement_scope, 3 단계 lock). validator WARN 5 → 2 (3 glossary missing 종결; 잔존 2건 README frontmatter id 누락은 separate hygiene). pure docs-only — code baseline 2f2430f 유지 (AGENTS.md doc-only rule). tests 1086 pass / 0 fail no delta. AI-P2-5 anchor close)** + **Cycle 37 NOT-gate-blocking future-implementation inventory: `INFRA-1A.11-future-implementation-inventory` (operator D6 2026-05-18 — landed via 본 PR doc-only): `docs/context/future-implementation-inventory.md` 신설 — 19 design-stage ADRs (0003 / 0004 / 0005 / 0007 / 0013 / 0014 / 0015 / 0018 / 0019 / 0020 / 0021 / 0022 / 0024 / 0025 / 0026 / 0027 / 0029 / 0030 / 0031, 총 117 invariants) 를 ADR-level entries 로 분류: 3 superseded + 2 partially-implemented + 14 design-only. 각 entry 에 activation_phase + current_status + enforcement_status + reason 명시. validator policy 명시 — future-implementation invariant 의 `cross_ref_code` 부재는 violation 이 아님. 미래 production wiring slice land 시 해당 PR 이 cross_ref_code 추가 + inventory entry 갱신 의무. pure docs-only. tests 1086 pass / 0 fail no delta. D6 close)**. AC-031 source-side enum reject 는 `INFRA-1B.1.h4-category-enum-validation` planned follow-up anchor 로 등록되어 있으나 **blocked/sequence-dependent on `INFRA-1B.1.h2-source-profile` (categories.yaml owner) — P0-M2 gate accept evidence 에서 제외** (운영자가 명시적으로 AC-031 을 gate evidence 에 promote 하는 경우에만 변경). 세부 landed (`INFRA-1B.3.x-audit` PR #39 landed [R2 upload audit ledger, AC-032 / NFR-008] + `INFRA-1B.3.h1-policy-fix` PR #41 landed [R2 cross-source archive_policy guard, AI-P0-1 legal-safety P0] + `INFRA-1B.1.h1-source-bootstrap-neo4j` PR #44 landed [Neo4j Source node bootstrap + 3-way preflight, AI-P1-2] + `INFRA-1B.3.h2-queue-cli` PR #45 landed [`bun run discovery:process-queue` CLI + new-path `source_not_found_in_graph` TypedQueueError unification + `parseArgs` allowlist fail-fast, AI-P1-3] + `INFRA-1B.4.h1-chunker-policy-gate` PR #47 landed [chunker archive_policy gate + empty-text preserve + `ChunkRejected` 5 reason enum + fail-closed inverted allowlist, AI-P1-1 / Q-053 D2 / DEC-024 D2] + `INFRA-1B.5.h1-runbook-setup-hygiene` PR #48 landed [RUNBOOK fresh-worktree setup + pre-commit secret scanner — 9 vendor pattern + `execFileSync` argv form + 256MB maxBuffer + `--no-renames` `--diff-filter=ACMT`, AI-P1-12 operator safety baseline] + `INFRA-1B.3.h3-audit-hardening` PR #49 landed [v8 audit hardening — `policy_decisions.upload_attempt_id` + 3 BEFORE INSERT triggers with explicit whitespace charset TRIM, AI-P1-7 BEFORE/AFTER audit pair correlation key] + `OPS-1B.h1-runtime-invariant-scanner` PR #50 landed [R2 invariant scanner — Snapshot.r2_key ↔ policy_decisions uploaded audit ↔ source_material_policy 3-way reconciliation with 3 violation axes, AI-P1-6 INV-0012-3 audit-by-absence cross-check] + `INFRA-1B.3.h4-dedup-r2-backed-link-policy-fix` PR #53 landed [snapshot-fingerprint line 490 dedup-link guard allowlist 확장 — PR #41 sibling call site hole 종결, AI-P0-2 legal-safety P0 post-PR #51 review reopen] + `OPS-1B.h2-r2-invariant-scanner-orphan-axis` PR #54 landed [scanner SQL `decision IN ('uploaded', 'set_r2_key_failed_neo4j')` + Axis 4 `r2_object_without_graph_key` + Axis 5 `malformed_r2_upload_audit_row`, AI-P1-13 P1 gate-blocker — PR #50 set_r2_key_failed_neo4j orphan + defensive coding regression 종결] + `INFRA-1B.1.h3-seed-sources-argv-allowlist` PR #56 landed [scripts/seed-sources.ts `parseArgs` allowlist + `UnknownArgumentError` + `import.meta.main` entry guard, AI-P1-14 — `--dryrun --neo4j` typo silent-write risk 종결] + `INFRA-1B.3.h5-policy-decisions-snap-id-column-v9` PR #57 landed [v9 migration: snap_id TEXT column + partial INDEX + recordR2UploadDecision dual-write + scanner column-preferred + `validSnapIdOrNull` shape guard, AI-P1-15 + Codex round 1 P1/P2 fix — scanner 의 rationale regex 의존 구조적 해소] + `INFRA-1B.3.h6-policy-decisions-snap-id-schema-hardening` PR #62 landed [writer-boundary `assertValidSnapId` fail-fast at recordR2UploadDecision + v8→v9 migration integration test + DATA_MODEL.md v9 sync, Cycle 7 — post-#58 GPT review P1 finding 3건 (writer boundary / migration path / DATA_MODEL) 종결] + `OPS-1B.h3-r2-orphan-axis-repairability` PR #63 landed [scanner SQL `decision IN ('uploaded', 'set_r2_key_failed_neo4j', 'skipped_toctou')` 확장 + Axis 4 cause-qualified rename `r2_object_without_graph_key_set_failed` + 신규 Axis 4b `r2_object_without_graph_key_policy_recheck_skipped` + 양 orphan axis details 에 `expectedR2Key` 출력 + ScanCounts.skippedToctouAuditRows + RUNTIME.md scanner section 신설 (Codex P1) + TESTING SHA placeholder 교체 (Codex P2), Cycle 8 — post-#58 GPT review Issue 3 종결 + 정책 갱신 (AGENTS.md "engineering slice PR sync 의무")] + `OPS-1B.h4-r2-audit-column-rationale-drift-axis` PR #64 landed [scanner Axis 6 `r2_audit_column_rationale_drift` 신설 — column ↔ rationale dual-write contract violation surface (recordR2UploadDecision atomic dual-write 의 divergence 를 explicit violation 으로 노출, scanner column-preferred resolution 이 silently mask 하던 v8- legacy consumer-visible anomaly 종결); R2UploadOutcomeAuditRow shape 에 raw `columnSnapId` + `rationaleSnapId` field 노출; Cycle 9 — post-#58 GPT review Issue 6 (마지막 P2 finding) 종결] + `INFRA-1B.3.h7-gate-evidence-hardening` (PR #66 merged 2026-05-17, fdb847a — Cycle 10) landed [parseSnapIdFromRationale `(?=;|$)` delimiter strictness lookahead + invalid trailing char regression tests (7) + snapshot-fingerprint skipped_toctou rationale mergeMatchedExisting branch + regression test (2) + policy-decisions / scanner docstring 의 `snap_<ULID>` 표현을 실 정규식 매칭 표현으로 정정 + thin-doc drift sweep (TESTING / RUNTIME / DATA_MODEL header SHA backfill + RUNTIME 6-axis → 7-axis 운영자 CLI flow 정정), Cycle 10 — post-PR #65 GPT review Findings 1~5 종결 (Finding 6 `INFRA-1A.x-shared-snapshot-id-constants` 는 planned anchor 로 register)]). 세부 planned (gate evidence 제외, follow-up anchor): `INFRA-1B.1.h4-category-enum-validation` (AC-031 source-side enum reject, blocked-on-h2, planned anchor registered via PR #59 — operator 가 h2/h4 sequencing 결정 시 promote 가능). P0-M1 게이트도 별도 통과 필요 (SPIKE-001 미실시 — AC-032 audit ledger 코드 enforcement 는 INFRA-1B.3.x-audit 로 landed, Q-044 는 DEC-020 으로 resolved, TRACE-040 anchor → landed).
- active tracks: `INFRA` (primary — INFRA-1B collection pipeline 슬라이스 일괄 landed), `OPS` (cross-cutting — OPS-1A.1 run ledger landed)
- active phase: `INFRA-1B` (게이트 검증 단계); `OPS-1A` (게이트 검증 단계)
- active slice: **M2 own slices INFRA-1B.1 ~ INFRA-1B.5 landed** (P0-M2 gate accept evidence 대상) + **cross-milestone early landed** (P0-M3 slices, M2 phase 안에서 흡수): INFRA-1B.6 (feedback CLI) + OPS-1A.1 (run ledger). Landed PR 목록: #15 (INFRA-1B.1 source registry seed + 1B.1.x hotfix, c51b2ce — busy_timeout / slug-map migration / URL 파싱 / Neo4j pool env), #16 (INFRA-1B.2a safe-fetch, ed09aa5), #17 (INFRA-1B.2b scheduler, 0eec962), #18 (INFRA-1B.2 discovery worker, 896ddf2), #19 (INFRA-1B.3 snapshot fingerprint, 4dfa94f), #20 (INFRA-1B.4 chunker, 06c49d7), #21 (INFRA-1B.5 access-intervention, c3b19c4), #22 (INFRA-1B.6 feedback CLI early-land, 7f4e980), #23 (OPS-1A.1 run ledger early-land, 23de14c). M2 게이트 검증 미실시 evidence: SPIKE-001 (NFR-001 1만 graph object < 1s p95), AC-022/023/024 evidence 확정. 2026-05-13 comprehensive review 가 식별한 doc-code drift 일괄 backfill 됨 (본 retro entry 참조).
  `INFRA-1A.3` landed (PR #14 merged 2026-05-12): R2 permitted-artifact prefix policy + sha256 round-trip tests.
  `INFRA-1A.6` landed (PR #12 merged 2026-05-12): Tier A source seed 72 sources + TEST-027.
  `INFRA-1A.8` landed (PR #10 merged 2026-05-12): Backup runbook docs-only (AC-032).
  `INFRA-1A.7` landed (PR #9 merged 2026-05-12): Scenario/Thesis/Source bidirectional
  schema fields + enum validators + indexes (AC-026, AC-027).
  `INFRA-1A.5` landed (PR #8 merged 2026-05-12): text normalization + sha256 + enum validators.
- last accepted gate: none yet
- next gate (P0-M1 portion): `AC-001` (도메인 객체 **10-stage** 모델 +
  4-tier source layer + Neo4j graph store — ADR-0025 supersedes ADR-0011
  object model + ADR-0012 + ADR-0013); `AC-002` (Neo4j FTS p95 <1s,
  SPIKE-001 미실시 — INFRA-1A.2 소스 코드 위에서 검증 대기); `AC-005`
  (ID prefix lint, TEST-005 통과 ✓); `AC-032` (R2 upload audit ledger
  **code enforcement landed** — INFRA-1B.3.x-audit PR #39 + cross-source
  archive_policy guard INFRA-1B.3.h1-policy-fix PR #41 + dedup-link sibling
  site INFRA-1B.3.h4-dedup-r2-backed-link-policy-fix PR #53 (AI-P0-2 — PR
  #41 가 미수정한 line 490 inline guard) + audit pair correlation key
  INFRA-1B.3.h3-audit-hardening PR #49 (v8 — upload_attempt_id
  required-when-r2-upload trigger) + audit-by-absence cross-check
  OPS-1B.h1-runtime-invariant-scanner PR #50 (Snapshot ↔ policy ↔ audit
  3-way reconciliation, 3 violation axes) + orphan-axis 확장
  OPS-1B.h2-r2-invariant-scanner-orphan-axis PR #54 (AI-P1-13 — Axis 4
  `r2_object_without_graph_key` + Axis 5 `malformed_r2_upload_audit_row`)
  + v9 audit schema structural improvement
  INFRA-1B.3.h5-policy-decisions-snap-id-column-v9 PR #57 (AI-P1-15 —
  snap_id first-class column + scanner column-preferred + validSnapIdOrNull
  shape guard); TRACE-040 anchor → landed; Q-044 는 DEC-020 으로
  resolved. P0-M2-hardening code hardening = 17 slices landed (16 historical + `INFRA-1B.5.h2-policy-gate-risk-triggers` engineering — 본 PR, AC-023 / TEST-023 evidence + AI-P1-11 D1a/D2a 결정 lock 2026-05-17, ADR-0017 INV-0017-4 List A canonical, 53 tests pass).
  Implementation Plan 의 Risks Q-042~Q-048 entry 와 일치)
- next gate (P0-M2 portion): `AC-001`, `AC-020` (P0 fallback only —
  raw_body_hash diff; canonical_text_hash primary 는 P1+), `AC-022`,
  `AC-023`, `AC-024` (P0-M2 게이트 — INFRA-1B 슬라이스 일괄 landed 후
  evidence 확정 대기). **AC-009 (extractor 분기) 는 P0-M3 gate** (EXTR-1A.*
  미진입)
- canonical ledger: `docs/04_IMPLEMENTATION_PLAN.md` (gate set source of
  truth; current-state 는 mirror)

## External services / credentials

- **API key 발급 완료** (2026-05-11): OpenAI / Anthropic / Google AI Studio
  (Gemini) — v0 turn-key 진입 직전 Doppler 또는 환경 변수 등록 의무
  (`docs/05_RUNBOOK.md` Publishing Site Deployment 섹션).
- Cloudflare R2 + Cloudflare Pages: 발급 상태 확인 (P0-M2 ~ P0-M6 진입 직전).

## Implemented

### 코드 (INFRA-1A.2 landed 2026-05-12 via PR #4)
- `migrations/neo4j/v1_schema.cypher` — 13 node UNIQUE + 5 edge UNIQUE + 5 FTS index + lookup index
- `migrations/sqlite/v1_schema.sql` — 17 tables (run_ledger, cross_vendor_review_ledger, source_material_policy, policy_decisions, policy_learning_events, source_policy_rules, dataset_vintage, derived_metric_ledger, metrics_*, evaluation_*, research_session, raw_cache_items, schema_migrations)
- `scripts/migrate.ts` — idempotent migration CLI (--neo4j / --sqlite / --dry-run)
- `scripts/validate_invariants.ts` — ADR-0002 invariant validator (exit 0, warning-level)
- `src/domain/ids.ts` — ID_PREFIXES map + validateIdPrefix() / assertIdPrefix() (AC-005)
- `src/storage/neo4j/connection.ts`, `src/storage/sqlite/connection.ts` — driver singletons (bun:sqlite native)
- `tests/lint/id_prefix_test.ts` — 28 tests (TEST-005/AC-005) ✓
- `tests/bench/neo4j_fts_search_bench.ts` — SPIKE-001 bench scaffold (runs when NEO4J_PASSWORD set)

### 코드 (INFRA-1A.4 landed — PR #5)
- `tests/lint/no_frontmatter_relation_array_test.ts` — 9 tests (TEST-008/AC-008) ✓

### 코드 (INFRA-1A.5 landed — PR #8)
- `src/utils/text.ts` — normalizeText(), truncateCodePoints(), isWithinLimit() ✓
- `src/utils/hash.ts` — sha256Hex(), sha256Prefix() ✓
- `src/utils/enums.ts` — RunStatus/RunStage/LlmVendor/QuoteReason/ArchivePolicy + 8 validators ✓
- `migrations/sqlite/v2_enum_constraints.sql` — enum-validating triggers (run_ledger, cross_vendor_review_ledger) ✓
- `tests/unit/text_hash_test.ts` — 49 tests ✓

### 코드 (INFRA-1A.7 landed — PR #9)
- `migrations/neo4j/v1_schema.cypher` — Scenario property schema extended (impact_targets, impact_direction_by_target, transmission_channels); thesis_stance_idx + source_perspective_idx added ✓
- `src/utils/enums.ts` — THESIS_STANCE (6), THESIS_MARKET_STANCE (6), SOURCE_PERSPECTIVE (4: risk_observer/opportunity_observer/neutral/mixed) + validators ✓
- `src/domain/nodes.ts` — SourceNode, ScenarioNode, ThesisNode TypeScript interfaces ✓
- `tests/unit/bidirectional_schema_test.ts` — 27 tests (AC-026, AC-027) ✓

### 문서 기반 architecture 합의
- ADR 0001~0010 (boilerplate placeholder 1개 + 0002 invariant tracking +
  Round 3 lock 시점 0003~0010 8개. 0003/0004/0007/0008은 0011~0015로
  superseded)
- ADR 0011~0021 (Round 4~25 canonical) 11개 신규 작성
- **ADR 0022** (자체 사이트 publishing stack — Astro 5.0 + Cloudflare Pages
  + vault publications/ single source — v0 turn-key 결정)
- **DEC-004 / DEC-005 / DEC-006** (v0 4 메타 카테고리 / v0 turn-key publish
  scope / vault sync trigger 단일화)
- **DEC-007 / ~~DEC-008~~ (superseded by DEC-010) / DEC-009 / DEC-010**
  (retention/R2 lifecycle policy lock / v0 첫 발행 카테고리 = 경제 / LLM
  routing v2 multi-vendor + Data Science Module lock)
- **ADR-0023 (supersedes ADR-0006)** — LLM routing v2 GPT default +
  Anthropic dual-vendor + Google exploration-only + minimal cross-vendor
  review
- **ADR-0024** — Data Science Module (deterministic dataset processing,
  Polars + DuckDB + statsmodels + scipy, reproducibility 3-tuple, 1000
  rows / 50KB raw → LLM 직접 입력 금지). Stack lock close (2026-05-11).
- **ADR-0025 (supersedes ADR-0011 object model)** — Editorial Intent layer
  10-stage object model (Scenario → EditorialIntent → Thesis anchor 신설).
  운영자 명시 lock 의무, 4-format draft 재사용 anchor, NFR-002
  reproducibility 강화. ID prefix `eit_` 신규.
- **AC-031 갱신 + AC-034 + AC-035 신규 (TEST-034/035 포함)** (4 메타 카테고리
  validation + cross-post canonical cite anchor lint + Astro Content
  Collection Zod schema build-time gate)
- **09_TRACEABILITY_MATRIX TRACE-030/034/035/036/037 갱신 / 신규**
- **`docs/research/source-seed-list-2026-05.md`** (Tier A 72 source list
  proposed — Q-021 reflow, size cap 폐기, 한국 소스 24개 보강 + 글로벌
  보강. 분포 risk 19% / opportunity 29% / neutral 42% / mixed 10%.
  Tier B-C 강등 v0 비포함: a16z / Stratechery / McKinsey / GS·JPM
  Research. paywall abstract 정책: IEA WEO / IISS / MIT TR / Gates 본문은
  abstract 만 Tier A 유지)
- project delivery artifacts(PRD/HLD/Implementation Plan/Acceptance Tests/
  Glossary/Questions/Decisions/Traceability)

## Planned

- Schema & Bulk Store Bootstrap (`P0-M1`): Neo4j Community Edition + SQLite
  스키마, R2 permitted-artifact 정책 lock, Source policy gate + access_intervention
  스키마 lock
- Source Registry & Collection Queue (`P0-M2`): Tier A seed (size cap 폐기
  — DEC-009 reflow, v0 entry 72 source `docs/research/source-seed-list-
  2026-05.md`) +
  collectability_score (Q21), Discovery → 큐 적재 → fetch / fingerprint
  snapshot / chunk
- Extraction & Review (`P0-M3`): Haiku 1차 + Sonnet escalate, auto-accept
  threshold, review queue throttling, run ledger, metrics_run
- Search & Dossier (`P0-M4`): Neo4j native FTS 검색 + Dossier 합성 (counterclaim
  pool)
- Scenario Validate (`P0-M5`): assumptions / branches / falsifiers /
  counterclaim(polarity-symmetric) / impact_targets / transmission_channels
  검증 + scenario_revisions ledger
- Thesis & Content (`P0-M6`): Thesis(stance + market_stance) → ContentDraft
  **v0 blog_long only** (DEC-005, 나머지 3 format은 v1+ phasing Q-032) →
  Publication + cite check 5+1 + **자체 사이트 Astro skeleton(ADR-0022) +
  첫 publication = 경제 카테고리(DEC-009) v0 turn-key MVP gate**.
  Substack/YouTube/X manual cross-post (cite footnote는 자체 사이트
  canonical URL anchor — AC-034)
- Manual Feedback & Policy Learning (cross-cutting): `pipeline feedback` CLI,
  access_interventions batch report, policy_learning Pattern 1

### Planned follow-up anchors (NOT gate-blocking, registered for sequencing only)

- ~~`INFRA-1A.9.h1-safe-fetch-raw-fetch-static-check`~~ **landed (Cycle 32
  dev-cycle, Opus PR #66~#78 review F4 follow-up)** — ADR-0028 INV-0028-1
  ("Discovery worker 의 모든 outbound HTTP 요청은 safe-fetch 를 통해야 한다")
  의 static enforcement landed. `scripts/validate_invariants.ts:checkRawFetchBan`
  이 `src/discovery/**` + `src/extraction/**` 에서 raw `fetch(` token 을
  comment / string / regex-literal stripping 후 검출 (allowlist =
  `src/discovery/fetch/safe-fetch.ts` canonical wrapper). false-positive
  방어 = `(?<![.\p{ID_Continue}$])fetch\s*\(` Unicode-aware negative
  lookbehind → `.fetch(` / `$fetch(` / `prefetch(` / `한글fetch(` 모두 제외.
  warning-level (INV-0002-1 contract). `tests/lint/raw_fetch_ban_test.ts`
  +19 tests 가 production-code compliance 를 hard test failure 로 pin —
  validator 자체는 warning-level 이지만 repo-wide 위반 introduction 은
  CI fail. ADR-0028 INV-0028-1 cross_ref_code 에
  `scripts/validate_invariants.ts:checkRawFetchBan` 추가하여 reachability
  anchor + enforcement static check 가 statement 와 함께 명시. F4
  deferred → landed.
- `INFRA-1A.9.h2-cross-ref-semantic-level` (Opus PR #66~#78 adversarial
  review F3 + GPT 합의 2026-05-18, **NOT gate-blocking, P3 priority,
  defer 가능**): DEC-020 Q-045 semantic scope 명시 (cross_ref_code = reachability
  heuristic) 위에서 stronger semantic level 도입 — `callsite_exists` /
  `forbidden_call_absence` / `test_fixture_proved` 등 (cross_ref_code entry
  의 semantic_level 필드 추가). 현재 단계에서는 DEC-020 wording correction
  으로 reachability heuristic semantic 만 명시 (별도 semantic level 도입
  은 안 함). IMPL_PLAN slice 표에 정식 row 등록 완료 (status=planned).
- `INFRA-1A.9.h3-validator-self-strip-stability` (Cycle 32 PR #90
  에서 발견된 fragility 의 follow-up anchor, **NOT gate-blocking,
  P3 priority, defer 가능**): `scripts/validate_invariants.ts:checkRawFetchBan`
  을 ADR-0028 INV-0028-1 `cross_ref_code` 에 self-reference 로 추가 시도 시,
  validator 의 자체 stripCommentsAndStrings pass 가 자신의 regex-literal
  pattern body 들과 상호작용하여 running backtick parity shift 가 발생,
  새 `export function` declaration 이 stripped source 에서 사라지고
  `hasNamedDeclaration` 이 false `export not found` 를 emit 하는 fragility 가
  확인됨. 본 slice 의 옵션: (a) regex-literal stripping heuristic 을
  token-aware tokenizer 로 교체 (TS AST 사용), (b) self-validation path
  에 한해 multi-line eat 을 sentinel 로 차단, (c) cross_ref_code resolution
  이 self-references 인 entry 를 자체 module 의 export map 으로 별도 lookup,
  (d) hasNamedDeclaration 이 stripped + raw 양쪽에서 match 되면 OK 처리.
  옵션 선택은 운영자 결정. 본 slice 가 land 하기 전에는 validator 의
  self-cross_ref 는 ADR statement body prose 로만 표현. IMPL_PLAN slice
  표에 정식 row 등록 완료 (status=planned).
- `DOC-1A.1-testing-md-baseline-observability-hygiene` (Opus PR #66~#78
  adversarial review F11 followup, **NOT gate-blocking, P3 hygiene**):
  `docs/current/TESTING.md` top paragraph 가 매우 길어 (현재 한 paragraph
  안에 current baseline / thin-doc edits chain / Cycle history / local
  test claim / CI evidence 모두 섞임) operator 가 실제 현재 baseline 을
  구분하기 어려움. baseline observability risk. 본 slice 의 scope: (1)
  TESTING.md top 은 current baseline only — last verified SHA + date +
  test count + 1~2 sentence summary 만 짧게, (2) Cycle history 는 별도
  file `docs/context/TESTING_HISTORY.md` (또는 structured table) 로 분리,
  (3) AGENTS.md thin-doc sync rule 갱신 — short baseline + history 별도
  file append 로 분리, (4) test count 의 source / run environment /
  commit SHA structured 명시. GPT 의견 합의 — 길이 자체보다는 baseline /
  history / claim source 가 한 paragraph 에 섞이는 observability risk 가
  핵심. P3 hygiene 으로 downgrade. IMPL_PLAN slice 표에 정식 row 등록
  완료 (status=planned).

## Explicit non-goals

- 실시간 뉴스 피드 / 대시보드
- 일반 PKM 영역(Inbox / SlipBox 등) 재구조화
- 마크다운 본문에 모든 candidate claim을 자동 생성 (vault 무너뜨림)
- 단일 LLM extractor로 article + dataset + report 통합 처리
- 봇 감지 우회를 production dependency로 (ADR-0016)
- Raw third-party text의 클라우드 업로드 (ADR-0012, raw_cloud_policy=always_prohibited)
- 다양한 graph DB 동시 지원 / vendor-neutral 마이그레이션 자동화 (ADR-0014
  intentional lock-in)
- ML fine-tuning 기반 policy 학습 (ADR-0021 rule-based 한정)

## Current priorities

1. **P0-M2 게이트 검증** — **M2 own slices = INFRA-1B.1 ~ INFRA-1B.5**
   landed 상태. AC-001 / AC-020 (P0 fallback only) / AC-022 / AC-023 /
   AC-024 evidence 확정 (Tier 분류 / policy gate / access_intervention
   batch report 실 데이터 검증) 후 milestone accept. **참고**: INFRA-1B.6
   (manual feedback CLI) + OPS-1A.1 (run ledger) 은 P0-M3 slice 이나
   M2 phase 안에서 early-landed — **P0-M2 gate acceptance evidence 에는
   포함하지 않음** (각 slice 의 milestone row 에서 별도 평가).
2. **SPIKE-001 실행** — Neo4j Community + native FTS, 1만 graph object 시점
   p95 < 1초 (NFR-001 / AC-002). M1 gate accept 차단 risk.
3. ~~**Q-044 R2 upload audit code enforcement**~~ — **landed (8 slices = 7 audit-axis + 1 sibling hygiene)**: PR #39 `INFRA-1B.3.x-audit` + PR #41 `INFRA-1B.3.h1-policy-fix`
   + PR #53 `INFRA-1B.3.h4-dedup-r2-backed-link-policy-fix` (AI-P0-2 —
   PR #41 dedup-link sibling site hole 종결) + PR #49 `INFRA-1B.3.h3-audit-hardening`
   + PR #50 `OPS-1B.h1-runtime-invariant-scanner` + PR #54 `OPS-1B.h2-r2-invariant-scanner-orphan-axis`
   (AI-P1-13 — set_r2_key_failed_neo4j orphan + malformed audit row defensive
   surface) + PR #57 `INFRA-1B.3.h5-policy-decisions-snap-id-column-v9`
   (AI-P1-15 — v9 audit schema structural improvement + Codex round 1 P1/P2
   fix). Sibling hygiene slice: PR #56 `INFRA-1B.1.h3-seed-sources-argv-allowlist`
   (AI-P1-14 — operator CLI safety, `--dryrun --neo4j` typo silent-write 종결).
   `src/storage/audit/policy-decisions.ts` + `INTENDED_ACTION` + `R2_UPLOAD_DECISION`
   4 lifecycle values + snapshot-fingerprint r2Put 2 call site 전후 INSERT
   + cross-source archive_policy guard (AI-P0-1 6 regression tests + AI-P0-2
   5 dedup-link regression tests) + v8 audit hardening (AI-P1-7 —
   `policy_decisions.upload_attempt_id` + 3 BEFORE INSERT triggers:
   intended_action enum + r2_upload_decision enum + upload_attempt_id
   required-when-r2-upload with explicit whitespace charset TRIM) + R2
   invariant scanner (AI-P1-6 — 3-way reconciliation Snapshot.r2_key ↔
   policy_decisions uploaded audit ↔ source_material_policy with 5
   violation axes after AI-P1-13 extension: r2_key_without_audit /
   audit_uploaded_without_r2_key / r2_key_with_restricted_source +
   r2_object_without_graph_key (set_r2_key_failed_neo4j orphan) +
   malformed_r2_upload_audit_row defensive surface) + v9 audit schema
   improvement (AI-P1-15 — first-class snap_id column + dual-write +
   scanner column-preferred via validSnapIdOrNull shape guard).
   P0-M2-hardening code hardening = 17 slices landed (16 historical + `INFRA-1B.5.h2-policy-gate-risk-triggers` engineering — 본 PR, AC-023 / TEST-023 evidence + AI-P1-11 D1a/D2a 결정 lock 2026-05-17, ADR-0017 INV-0017-4 List A canonical, 53 tests pass).
   AC-032 / NFR-008 evidence = 7 audit-axis slice + 1 hygiene slice landed →
   gate accept 시점에서 evidence 확정.
4. **Q-050 운영자 결정 7 항목** (open) — AI search + repo 통합 architecture
   resolution 의 사용자 결정 잔여 (parent_round_id branching semantics /
   mode='mixed' validation profile / termination defaults / migration v8 ALTER
   범위 / ScenarioRevision FK 위치 / EditorialIntent.purpose lock 시점 / 신규
   ADR 발급 시점). resolution 후 INFRA-1B.7b ~ 1B.7e + AGG-1A.6 + DISCOVERY-
   EXT.1 + EXTR-1A.7 slice ready 가능.
5. **CI required check 등록** (DEC-020 Q-048 partial — admin task) —
   `.github/workflows/ci.yml` 가 main branch protection required check 으로
   등록. workflow 자체는 활성, branch protection admin 등록만 남음.

## Current risks / unknowns

- Q-001 scenario horizon enum 정의
- Q-002 Dossier `stale_after` 기본값
- Q-003 Publication 정정 ledger 트리거
- ~~Q-004~~ **resolved (INFRA-1A.2)** — SQLite는 k-world-monitor repo, vault jsonl은 second-brain vault 책임
- Q-008 Thesis ID 체계
- Q-012 Neo4j ↔ SQLite sync (CDC vs batch)
- ~~Q-020~~ **resolved (INFRA-1A.2)** — 1인 internal use 범위 lock; (a)(b)(c) 발생 시 별도 ADR
- ~~Q-021~~ **resolved (INFRA-1A.6, 2026-05-12)** — 72 source data/sources_seed.yaml commit. 분포 risk 19% / opportunity 29% / neutral 42% / mixed 10% (AC-027 통과). RSS endpoint 검증은 INFRA-1B.1에서.
- ~~Q-022~~ **resolved by DEC-004** (v0 4 메타 카테고리: 정책 / 경제 / 사회
  / 대중문화)
- ~~Q-024~~ **resolved (INFRA-1A.2)** — v0: APOC standard + Cypher 5.x core; v1+: GDS Community; Enterprise-only 별도 ADR
- Q-025 외부 repo 부트스트랩 cadence
- ~~Q-026~~ **resolved by DEC-006** (vault sync trigger = git push 단일,
  Cloudflare Pages git integration)
- ~~Q-027~~ **resolved by DEC-007** (retention / R2 lifecycle / backup
  schedule)
- ~~Q-028~~ **resolved by DEC-008 → re-resolved by DEC-010** (LLM routing v2
  multi-vendor + Data Science Module + cost ceiling 재산정. DEC-008 의
  Anthropic-only 라우팅은 supersede 됨 — DEC-010 의 GPT default + Anthropic
  dual-vendor + Google exploration-only + minimal cross-vendor review 가
  canonical)
- Q-029 ImpactAssessment v0 embedded vs v1 노드
- Q-030 counterclaim multi-relation v1 도입 우선순위
- Q-031 TTS v1 timing + provider (DEC-005 v0 TTS deferred 연장)
- Q-032 ContentDraft 4-format auto-generate phasing (v1+ newsletter →
  youtube_long → shorts)
- Q-033 외부 플랫폼 auto cross-post timing (Substack / YouTube / X)
- Q-034 Auto retraction trigger 정책 v1+
- ~~Q-037~~ **resolved by DEC-019** — apoc.lock.nodes 채택, INFRA-1B.6.x 슬라이스에서 implement
- ~~Q-038~~ **resolved by DEC-019** — worker_id CAS 채택, INFRA-1B.3.x 슬라이스에서 implement
- ~~Q-039~~ **resolved by DEC-019** — chunked allSettled 채택, INFRA-1B.2.x 슬라이스에서 implement
- ~~Q-040~~ **resolved by DEC-019** — v0 pre-deploy contract 명문화(docs/05_RUNBOOK.md) + P1-MVP-prep milestone + backfill 위치 lock; framework implement는 DEPLOY-1A.1
- ~~Q-041~~ **resolved by DEC-019** — millis-bearing 일관 통일 채택, DEPLOY-1A.2 슬라이스에서 implement
- ~~Q-042~Q-048~~ **resolved by DEC-020** — NFR-003 5-hop trace path / evidence_role /
  NFR-008 R2 audit code enforcement / invariant validator coverage extension / quota
  module / Doppler secret store / CI required check + branch protection. Implement
  slices: AGG-1A.1 (evidence_role 자동 검증) + **INFRA-1B.3.x-audit landed (PR #39)**
  + OPS-1A.2 (quota module, planned) + INFRA-1A.9-validator-extension (TRACE-041
  anchor, planned) + CI admin task (운영자, pending).
- ~~Q-049~~ **resolved by DEC-021** — revisit policy = TTL + event-driven hybrid;
  snapshot_diff = canonical_text_hash primary + raw_body_hash fallback. Implement
  slices: INFRA-1B.8/9/10.
- Q-050 AI 검색 + repo 통합 architecture — 7 운영자 결정 항목 pending
  (parent_round_id branching / mode='mixed' validation / termination defaults /
  v8 ALTER 범위 / ScenarioRevision FK 위치 / EditorialIntent.purpose lock /
  신규 ADR 발급). Implement slices: INFRA-1B.7a~e + AGG-1A.6 + DISCOVERY-EXT.1
  + EXTR-1A.7 (대부분 P1+; INFRA-1B.7a 만 P0-M6 흡수).
- ~~Q-051~~ **resolved by DEC-022 + DEC-023** — UI stack lock (Astro shell +
  React island + shadcn/Radix + Tailwind + TanStack + SSE) + Round 1 routing
  default 5 항목 lock. Implement slices: RESEARCH-1A.0/API0 (P0-M6) +
  RESEARCH-1A.1~5 (P1+). ADR-0031 accepted.
- ~~Q-052~Q-059~~ **resolved (6) + deferred (2) by DEC-024** — 2026-05-15 12-layer
  adversarial review + GPT cross-review 종합. Resolved: Q-052 (main branch protection
  3중 충돌) / Q-053 (chunker archive_policy gate) / Q-054 (Source profile canonical
  store) / Q-056 (첫 publishable format) / Q-058 (source_role multi-dim) / Q-059
  (attention budget). Deferred (re-entry gate 명시): Q-055 (dataset MVP timing,
  PUB-1A.5 retro) / Q-057 (claim promotion ADR, EXTR-1A.1 entry). Engineering
  AI-P0-1 + AI-P1-8 landed (PR #41 + #42).
- SPIKE-001 Neo4j Community + native FTS가 1만 graph object 시점 검색 < 1초
  NFR-001을 만족하는지 (SQLite+FTS5에서 대상 갱신)
- **Opus PR #66~#78 adversarial review (2026-05-18) follow-up — engineering** (본 세션 — `claude/new-session-sSzfg` branch):
  - **F2 — unregistered source fail-closed generalization (code, src/pipeline/policy-gate/risk-triggers.ts)**: `detectTermsViolation` 가 `sourceId=null` 인 모든 collection action (`extract_full_text` / `chunk_create` / `discovery_fetch` / `raw_cache` / `embed` / `r2_upload` / `quote_storage` / `external_llm_*`) 에서 fire 하도록 일반화 + `evaluatePolicyGate` 에 symmetric boundary throw 추가 (`sourceId=null` 이면 3 policy field 가 모두 `"unknown"` sentinel 이어야 함). 사전에는 `content_production` stage + `extract_full_text` + `sourceId=null` + `archive='unknown'` 조합이 stage-default `batch_report` → `decision='allow'` 로 fall-through 하던 silent bypass surface 가 있었으며, 본 fix 가 mode-invariant `inline_block` 로 닫음. tests/policy/gate_test.ts +7 cases (905 → 912 tests pass).
  - **F8 — ADR-0017 INV-0017-5 statement schema correction (doc, docs/adr/0017-source-policy-gate-mode-aware.md)**: frontmatter `statement` + body §Decision policy_decisions SQL 을 actual v1+v7+v9 schema 와 정합시킴 (`gate_mode` → `policy_gate_mode` / `reason` → `rationale` / `risk_level` + `intervention_id` 제거 + v0 partial coverage 명시 + future hardening anchor `policy_decisions_risk_level_intervention_id` 등록). `recordPolicyGateDecision` 의 v0 partial coverage comment 와 statement 간 drift 가 PR #76 cross_ref_code backfill 시도의 secondary drift surface 였음.
  - **F1 partial — production wiring scope clarification (doc, ADR-0017 INV-0017-5 statement)**: generic `evaluatePolicyGate()` 의 production caller (chunker / R2 upload / embed / external LLM call site) wiring 은 EXTR-1A.* (P0-M3+) scope 임을 statement 에 명시. v0 에서 chunker 는 INFRA-1B.4.h1 archive_policy gate 별도, R2 upload 는 INFRA-1B.3.x-audit `recordR2UploadDecision()` 별도 ledger writer 사용. INV-0017-5 의 v0 closure 는 `recordPolicyGateDecision()` operator-gate namespace ledger writer contract 만 해당.
  - **F5 — PR #76 metadata defect 기록 (doc, ADR-0017 drift history)**: PR #76 title/body 가 "INV-0017-5 cross_ref_code backfill" 이라고 명시했으나 actual merged patch 는 `docs/current/TESTING.md` 단일 변경 + backfill 시도 revert 였음. revert 자체는 valid (writer-only function 에 cross_ref_code 를 두면 false enforcement proof). metadata defect 만 known issue 로 명시 — future audit 이 PR-list 만 보고 INV-0017-5 enforcement closure 로 오해하는 risk 차단.
  - **F9 — snapshot-id helper validation hardening (code, src/domain/snapshot-id.ts)**: `snapshotR2Key()` + `formatSnapIdRationalePrefix()` 에 내부 `assertValidSnapId()` 호출 추가. pre-fix "caller obligation" 계약은 snapshot-fingerprint primary path (freshly generated `snap_${ulid()}`) 에는 안전했으나 Neo4j-stored / scanner-resolved snap_id 를 인자로 받는 r2-invariant-scanner / dedup-link path 에는 unsafe surface. recordR2UploadDecision PR #62 writer-boundary fail-fast 와 symmetric. tests/unit/snapshot_id_test.ts 의 "caller obligation" anything-goes 테스트 2건을 throw expectation 으로 update.
  - **Deferred (review finding 이나 본 세션 scope 밖)**: F1 full (production caller wiring — EXTR-1A.* roadmap scope), F3 (cross_ref_code semantic level — validator 확장), F4 (raw fetch ban static check — 별도 PR), F7 (multi-trigger junction table — schema migration v10+), F10 (wire-service source_role first-class field — INFRA-1B.1.h2-source-profile anchor 존재), F11 (TESTING.md header 축소 — subjective scope).
  - **GPT 의견 후속 반영 (2026-05-18 same-session followup)**: GPT 가 "기각이 아니라 severity/wording 조정" 으로 재평가한 finding 중 두 항목 추가 반영. (a) **F3 wording correction (doc, DEC-020 Q-045)**: `cross_ref_code` 가 **enforcement proof 가 아니라 reachability heuristic** 임을 DEC-020 Q-045 본문에 명시 + `file:exportName` = `export_exists` weak evidence / `file:line` = `line_exists` 더 weak evidence semantic 정의 + ADR / PR body 에서 "enforcement proven" / "invariant closed" 표현 금지. (b) **F4 follow-up anchor 등록 (doc, current-state.md Planned follow-up anchors)**: `INFRA-1A.9.h1-safe-fetch-raw-fetch-static-check` (raw `fetch(` 부재 static check, ADR-0028 INV-0028-1 enforcement) + `INFRA-1A.9.h2-cross-ref-semantic-level` (validator semantic level 확장, NOT gate-blocking) 2 anchor sequencing register.

## Current validation

- 문서 invariant validator (`bun run invariant:check`) — warning level only
  (ADR-0002 INV-0002-1)
- 코드 acceptance gate는 아직 없음 — `06_ACCEPTANCE_TESTS.md` AC 정의는 Round
  25 canonical(AC-022~AC-033 포함) 반영 완료, 코드 도입 후 자동화 단계 진입

## Needs audit

- `docs/05_RUNBOOK.md`: Pre-deploy schema migration contract 섹션 (DEC-019) +
  Backup/Retention 섹션 (INFRA-1A.8) + Doppler integration (DEC-020 Q-047) 모두
  landed. publish pipeline (PUB-1A.*) 은 P0-M6 진입 시 추가.
- `docs/current/{CODE_MAP,DATA_MODEL}.md`: 2026-05-13 comprehensive review
  backfill 로 13d61af 기준 갱신 완료. RUNTIME.md, OPERATIONS.md 는 다음
  thin-doc 갱신 사이클 (P0-M2 게이트 검증 후) 에 대상.
- `docs/current/TESTING.md`: 2026-05-15 갱신 완료 — test count 515 → 521
  (post-AI-P0-1 PR #41), Last verified SHA 75706c4 → 327f4b2 (AI-P1-9
  DOC-SYNC-2026-05-15 안에서 갱신).
- `docs/06_ACCEPTANCE_TESTS.md`: AC-001/018/020 본문이 Round 1~25 reflow
  이후 일부 stale 표현 (9-stage anchor / content_hash sha256 단일 hash)
  잔존 — 본 PR (claude/fix-doc-drift-5UskX) 에서 일괄 갱신.
- `docs/09_TRACEABILITY_MATRIX.md`: TRACE-001/004/005/016 등 초기 row 가
  9-stage / ADR-0011 표현 유지. Gaps 섹션이 Q-020/021/024 등 이미
  resolved 된 Q 를 미해결로 설명 — 본 PR 에서 일괄 갱신.
- AC-043 (ADR-0027 evidence_role schema) row 는 `06_ACCEPTANCE_TESTS.md`
  line 65 에 존재 — **acceptance criterion `defined` 상태** (ADR-0027 +
  DEC-020 Q-043 resolution 으로 schema lock 완료). 자동 검증 (TEST-043)
  은 AGG-1A.1 슬라이스 안에서 구현 예정 — 현재 AGG-1A.1 / TEST-043 /
  evidence_role enforcement 는 **planned, not landed**. AC-044 (minimum
  coverage) row 도 동일 — defined / planned (PUB-1A.5 운영자 manual
  verify + AGG-1A.1 자동 검증 의존).

## Links

- PRD: [`../01_PRD.md`](../01_PRD.md)
- HLD: [`../02_HLD.md`](../02_HLD.md)
- Roadmap / status ledger: [`../04_IMPLEMENTATION_PLAN.md`](../04_IMPLEMENTATION_PLAN.md)
- Acceptance tests: [`../06_ACCEPTANCE_TESTS.md`](../06_ACCEPTANCE_TESTS.md)
- Questions: [`../07_QUESTIONS_REGISTER.md`](../07_QUESTIONS_REGISTER.md) (per-file under `../questions/`)
- Decisions: [`../08_DECISION_REGISTER.md`](../08_DECISION_REGISTER.md) (per-file under `../decisions/`)
- ADRs: [`../adr/`](../adr/)
- Ideation source: [`../discovery/research-content-pipeline-ideation.md`](../discovery/research-content-pipeline-ideation.md) — "Current Canonical Direction" 섹션이 canonical view (Round 1~25 누적)

---

Rules:

- Keep this file short.
- Do not append full history.
- Do not copy the full roadmap / phase / slice ledger here.
- If historical reasoning matters, link to ADR/discovery/archive.
- If this file becomes long, compress it.
