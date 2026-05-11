# 09 Traceability Matrix

Question ↔ Decision ↔ Requirement ↔ Gate/Test ↔ Milestone/Track/Phase/Slice 연결.

## How to use

- 한 줄 = 하나의 trace path.
- 새 결정이 무엇에 영향을 주는지 명확히 남기는 용도.
- 완료 slice와 gate evidence를 연결해 "landed"와 "accepted"의 근거를 남기는 용도.
- Weekly로 누락 없이 채워졌는지 점검.

## Matrix

| TRACE-ID | Question | Decision / ADR | Requirement | Gate / Test | Milestone | Track | Phase | Slice | Notes |
|---|---|---|---|---|---|---|---|---|---|
| TRACE-001 | — | ADR-0011 (supersedes 0003) | REQ-001 | AC-001 / TEST-001 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | 9-stage object model lock (Source + Thesis 추가) |
| TRACE-002 | Q-004 | ADR-0012 (supersedes 0004) | REQ-002, REQ-004 | AC-002, AC-004 / TEST-002, TEST-004 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.2 | Neo4j canonical (graph) + SQLite (relational) + Markdown promoted only |
| TRACE-003 | — | ADR-0012 (supersedes 0004) | REQ-003 | AC-003, AC-020 / TEST-003, TEST-020 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.3 | R2 permitted artifact only + raw_cloud_policy=always_prohibited + content_hash |
| TRACE-004 | — | ADR-0011 (supersedes 0003) | REQ-005 | AC-005 / TEST-005 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | ID 체계 (`src_/doc_/snap_/clm_/dos_/scn_/ths_/drf_/pub_/edge_/run_/aci_/mcl_`) |
| TRACE-005 | — | ADR-0005, ADR-0011, ADR-0016 | REQ-006 | AC-006 / TEST-006 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | confidence 분해 + collectability_score + claim_status 8-state |
| TRACE-006 | — | ADR-0015 (supersedes 0008) | REQ-007, NFR-005 | AC-007 / TEST-007 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.2 | evidence nullable quote + quote_reason + storage_level |
| TRACE-007 | — | ADR-0013 (supersedes 0007) | REQ-008 | AC-008 / TEST-008 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.4 | Neo4j typed edges (v0 5종) + frontmatter 배열 lint |
| TRACE-008 | — | ADR-0006 | REQ-009 | AC-009 / TEST-009 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.1 / EXTR-1A.5 | extractor router |
| TRACE-009 | SPIKE-002, SPIKE-003, Q-028 → DEC-008 → DEC-010 | ~~ADR-0006~~ (superseded) → ADR-0023 + ADR-0024 + DEC-010 | REQ-010, REQ-015 | AC-010, AC-015 / TEST-010, TEST-015 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.2 / EXTR-1A.3 / EXTR-1A.4 / EXTR-1A.5 / EXTR-1A.6 | LLM routing v2 4-tier × multi-vendor (OpenAI GPT default + Anthropic dual-vendor cross-review + Google exploration-only) + Data Science Module for dataset + auto-accept threshold + cost ceiling (soft $5/hard $7.5/weekly $25/Tier 0 cap 5회 + backfill bucket) + prompt caching layering + 강제 tool-use strict schema + cross_vendor_review_coverage ≥ 0.95 |
| TRACE-010 | — | (roadmap) | REQ-011 | AC-011 / manual review | P0-M1~M6 | (전 트랙) | (전 phase) | (전 slice) | 구현 순서 강제 |
| TRACE-011 | Q-001 | ADR-0009, ADR-0019 | REQ-012 | AC-012 / TEST-012 | P0-M5 | AGG | AGG-1A | AGG-1A.3 | scenario validate 5종 + counterclaim polarity-symmetric |
| TRACE-012 | Q-001, Q-003 | ADR-0015 (supersedes 0008) | REQ-013 | AC-013 / TEST-013 | P0-M6 | PUB | PUB-1A | PUB-1A.2 | cite check 5+1 block + v1+ warning |
| TRACE-013 | — | ADR-0009, ADR-0013 | REQ-014 | AC-014 / TEST-014 | P0-M5 | AGG | AGG-1A | AGG-1A.2 | scenario_revisions append-only + SUPERSEDES edge |
| TRACE-013b | — | ADR-0009 | NFR-002 | AC-017 / manual reproducibility | P0-M5 | AGG | AGG-1A | AGG-1A.2 / AGG-1A.3 | reproducibility는 manual gate (AC-017) — 자동 TEST 미정의 |
| TRACE-014 | Q-002 | ADR-0010 | REQ-016 | AC-016 / TEST-016 | P0-M5 | OPS | OPS-1B | OPS-1B.1 | stale 트리거 3종 |
| TRACE-015 | SPIKE-001 | ADR-0012, ADR-0014 | NFR-001 | AC-002 / TEST-002 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.2 | Neo4j Community + native FTS 검색 p95 < 1s |
| TRACE-016 | — | ADR-0011 (supersedes 0003) | NFR-003 | AC-018 / TEST-018 | P0-M6 | PUB | PUB-1A | PUB-1A.1 | 5-step trace (9-stage 안에서 5단계 이내) |
| TRACE-017 | Q-028 → DEC-008 → DEC-010 | ~~ADR-0006~~ (superseded) → ADR-0023 + DEC-010 | NFR-004 | AC-019 / TEST-019 | P0-M3 | OPS | OPS-1A | OPS-1A.1 / OPS-1A.2 | run ledger + cost throttling. run_ledger 확장 필드: prompt_version + system_prompt_sha256 + cached_tokens + batch_id + backfill_run_id + **vendor + tier + cross_vendor_review_of + domain_override_reason** (ADR-0023 INV-0023-7) |
| TRACE-018 | — | ADR-0006 | NFR-007 | AC-021 / TEST-021 | P0-M3 | EXTR | EXTR-1A | EXTR-1A.1 | extractor interface 확장 |
| TRACE-019 | Q-003 | ADR-0015 (supersedes 0008) | REQ-013 | AC-013 / TEST-013 | P0-M6 | PUB | PUB-1A | PUB-1A.3 | publication cascade — Q-003 결정 후 활성 |
| TRACE-020 | — | ADR-0012 (supersedes 0004) | NFR-006 | AC-020 / TEST-020 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.3 | Snapshot fingerprint + content_hash + R2 permitted artifact durability |
| TRACE-021 | Q-021 (reflow by DEC-004 + DEC-009; pending `data/sources_seed.yaml` commit in **this repo**) | ADR-0016 + DEC-004 + DEC-009 | REQ-017 | AC-022 / TEST-022 | P0-M2 | INFRA | INFRA-1B | INFRA-1A.6 / INFRA-1B.1 | Tier A-D + collectability_score + access_method. size cap 없음 — v0 entry 50 source proposed (경제 18 + 정책 12 + 사회 11 + 대중문화 9, 한국 소스 포함) `docs/research/source-seed-list-2026-05.md` |
| TRACE-022 | — | ADR-0017 | REQ-018 | AC-023 / TEST-023 | P0-M2 | INFRA | INFRA-1B | INFRA-1B.1 | source_policy 3 필드 + mode-aware policy gate + 8 위험 행동 트리거 |
| TRACE-023 | — | ADR-0017, ADR-0015 | REQ-019 | AC-024 / TEST-024 | P0-M2 | INFRA | INFRA-1B | INFRA-1B.5 | access_intervention Neo4j 노드 + severity 자동 산정 + batch report |
| TRACE-024 | — | ADR-0018 | REQ-020 | AC-025 / TEST-025 | P0-M3 | INFRA | INFRA-1B | INFRA-1B.6 | Manual feedback CLI + 3-way 분리 + 3-option intervention review |
| TRACE-025 | Q-029, Q-030 | ADR-0019 | REQ-021 | AC-026 / TEST-026 | P0-M5 ~ M6 | AGG | AGG-1A | AGG-1A.2 / AGG-1A.4 / INFRA-1A.7 | Scenario impact_targets + Thesis stance/market_stance |
| TRACE-026 | Q-021 (reflow by DEC-004 + DEC-009) | ADR-0019 + DEC-004 + DEC-009 | REQ-022 | AC-027 / TEST-027 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.6 | source_perspective 분포 균형은 **Tier A seed set 전체** 에 적용 (size cap 없음, REQ-022 / AC-027). 현재 `docs/research/source-seed-list-2026-05.md` 50 source 분포: risk_observer 9 (18%) ≤50% ✓ / **opportunity_observer 15 (30%) ≥25% ✓** / neutral 23 (46%) ≥15% ✓ — **AC-027 통과 (안전 마진 5%)**. 카테고리 subset 분포는 reference only (의무 아님): 경제 18 (4/6/8), 정책 12 (3/3/5+1mixed), 사회 11 (1/3/6+1mixed), 대중문화 9 (1/3/4+1mixed) |
| TRACE-027 | — | ADR-0019 | REQ-023 | AC-028 / TEST-028 | P0-M6 | PUB | PUB-1A | PUB-1A.2 | EvidencePack v0 4-section + LLM synthesis mode 분리 |
| TRACE-028 | — | ADR-0020 | REQ-024 | AC-029 / TEST-029 | P0-M3+ | OPS | OPS-1A | OPS-1A.3 | metrics 6 카테고리 + v0 9+ metrics + evaluation harness |
| TRACE-029 | — | ADR-0021 | REQ-025 | AC-030 / TEST-030 | P0-M3 | OPS | OPS-1A | OPS-1A.4 | Policy learning rule-based Pattern 1 v0 + auto-tighten/auto-relax 분리 |
| TRACE-030 | Q-022 → DEC-004 | DEC-004 (supersedes Q-022 proposed 8) | REQ-026 | AC-031 / TEST-031 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.6 | v0 4 메타 카테고리 (정책 / 경제 / 사회 / 대중문화) + 기존 8 enum + tag 5개는 `subtopic_tags[]` 로 강등 보존 |
| TRACE-031 | — | ADR-0012, ADR-0017 | NFR-008 | AC-032 / TEST-032 | P0-M1 ~ M3 | INFRA | INFRA-1A / INFRA-1B | INFRA-1A.3 / INFRA-1B.1 | raw_cloud_policy=always_prohibited 강제 + 0건 audit |
| TRACE-032 | — | ADR-0019, ADR-0020 | NFR-009 | AC-033 (v1+) / TEST-033 (v1+) | P0-M6+ (v1+) | OPS | OPS-1A | OPS-1A.3 (v1+) | thesis_polarity_distribution v1+ |
| TRACE-033 | — | DEC-003 | (reset 메타) | doc-governance lint 통과 | P0-M1 | INFRA | INFRA-1A | INFRA-1A.1 | INFRA-1A.1 재작성 결정 (Round 25 canonical) |
| TRACE-034 | Q-026 → DEC-006 | ADR-0022 + DEC-005 + DEC-006 | REQ-027, NFR-010 | AC-013, AC-018, AC-028, AC-034, AC-035 / TEST-034, TEST-035 | P0-M6 | PUB | PUB-1A | PUB-1A.4 | 자체 사이트 publishing site build (Astro 5.0 + Cloudflare Pages) + vault publications/ single source + Zod schema build-time cite gate (AC-035) + cite/retraction/correction 컴포넌트 |
| TRACE-035 | — | ADR-0022 + DEC-005 + DEC-009 | REQ-027, NFR-010 | AC-034 / TEST-034 | P0-M6 | PUB | PUB-1A | PUB-1A.5 | external cross-post canonical cite anchor lint (모든 외부 플랫폼 발행물의 footnote가 자체 사이트 도메인 URL을 가리킴) + 첫 publication blog_long 1건 = 경제 카테고리 (v0 turn-key MVP gate) |
| TRACE-036 | Q-027 → DEC-007 | DEC-007 | NFR-006, NFR-008 | AC-020, AC-032 / TEST-020, TEST-032 | P0-M1 ~ M3 | INFRA / OPS | INFRA-1A / OPS-1A | INFRA-1A.8 / OPS-1A.4 | retention / R2 lifecycle / backup schedule lock. expire 3개 + transition 6개 + 의미적 GC batch 3개 + soft-delete → tombstone → hard-delete + RETENTION_PROTECTED_KINDS 상수. raw_cache TTL 24h~7d ceiling enforce (ADR-0021 INV-0021-6) |
| TRACE-037 | Q-031, Q-032, Q-033, Q-034 | DEC-005 (v0 deferred boundary) | REQ-013 (v1+ warning), REQ-021, ADR-0011 | (v1+ AC pending) | v1+ | PUB / OPS | PUB-1B / OPS-1B | (v1+ slices) | v0 deferred items (TTS / 4-format auto-generate / 외부 플랫폼 auto cross-post / auto retraction trigger) — v1 PUB-1B 트랙 진입 시점에 별도 ADR/DEC lock |

## Invariants

- 모든 `must` REQ는 최소 한 개의 AC를 가져야 한다. ✓ (REQ-001~REQ-027 모두
  AC-001~AC-031 + AC-034 + AC-035 매핑; NFR-008 → AC-032, NFR-009 → AC-033,
  NFR-010 → AC-034. REQ-027 의 build-time Zod schema gate (ADR-0022
  INV-0022-3) 는 AC-035)
- 모든 accepted DEC/ADR은 영향받는 REQ/HLD/Runbook을 갖는다. ✓ (ADR-0003~0021
  전부 REQ + HLD 컴포넌트 매핑; 0003/0004/0007/0008은 superseded, 0011~0021로
  대체)
- 모든 완료 Slice는 적어도 하나의 TRACE row와 연결된다. (현재 INFRA-1A.1만
  landed — Round 25 reset 후 TRACE-001/004/005/007/021/022/023/024/025/026/
  030/033 매핑)
- 모든 `accepted` milestone은 gate / test evidence를 갖는다. (현재 accepted
  milestone 없음 — DoD 충족 시 갱신)

## Gaps

- Q-001 (horizon enum) 미해결 → AC-012(scenario validate), AC-013(cite check
  horizon mismatch) 부분 검증만 가능
- Q-002 (stale_after) 미해결 → AC-016 시간 트리거 placeholder 30일 사용 중
- Q-003 (publication 정정 트리거) 미해결 → AC-013 cascade 완전 구현 차단
- Q-008 (Thesis ID 체계) 미해결 → AGG-1A.4 / PUB-1A.1 진입 전 lock
- Q-012 (Neo4j ↔ SQLite sync 정책) 미해결 → INFRA-1A.2 commit 전 lock 권고
- Q-020 (Neo4j GPL v3 boundary) 미해결 → INFRA-1A.2 commit 전 lock 권고
- Q-021 (Tier A seed — size cap 없음) — `docs/research/source-seed-list-
  2026-05.md` 50 source proposed (경제 18 + 정책 12 + 사회 11 + 대중문화 9,
  한국 소스 보강 포함). 분포 충족: risk 18% / opportunity 30% / neutral
  46% — AC-027 통과. 사용자 list review + accept 후 **이 repo** `data/
  sources_seed.yaml` 또는 SQLite migration INSERT commit 시 resolved
  (외부 repo 의존성 없음 — `alxdr3k/k-world-monitor` 자체가 canonical)
- ~~Q-022~~ **resolved by DEC-004** (v0 4 메타 카테고리)
- Q-024 (Neo4j-specific 기능 활용 boundary) 미해결 → INFRA-1A.2 commit
  전 lock 권고
- Q-025 (이 repo = second-brain vault 기준 "외부 repo" 부트스트랩 cadence)
  미해결 → INFRA-1A.1 완료 후 재평가
- ~~Q-026~~ **resolved by DEC-006** (vault sync trigger = git push 단일)
- ~~Q-027~~ **resolved by DEC-007** (retention / R2 lifecycle / backup
  schedule)
- ~~Q-028~~ **resolved by DEC-008** (LLM cost / quality discipline)
- Q-029 (ImpactAssessment v0 embedded vs v1 노드) 미해결 → AGG-1A.2
  진입 전 lock
- Q-030 (counterclaim multi-relation v1 도입 우선순위) 미해결 → v1 진입
  시점 lock
- Q-031 (TTS v1 timing) / Q-032 (4-format auto-generate phasing) / Q-033
  (외부 플랫폼 auto cross-post) / Q-034 (auto retraction trigger) 모두 v1+
  PUB-1B / OPS-1B 트랙 진입 시점 lock (TRACE-037)
- 모든 TEST 위치는 `(planned)` 상태 — 코드 도입 시 실제 위치로 갱신
- staging/production 환경 미정의 → AC-017 reproducibility는 local manual로만
  실행 가능 (P1 검토)
