# 2026-05-15 Action Items — Claude 12-layer review + GPT cross-review 종합

본 문서는 [Claude adversarial review](../10_PROJECT_RETROSPECTIVE.md#adversarial-review--2026-05-15-multi-layer--multi-perspective--multi-stage) (208 finding) 와 [GPT cross-review](2026-05-15-gpt-cross-review.md) (~80 finding) 의 합리적 종합 결과를 운영자 action items 으로 정리한다.

상태: `Status: PROPOSED — retrospective artifact, not canonical register.`

**Q-052~Q-059 모두 [DEC-024](../decisions/DEC-024.md) 로 resolution / deferred lock**:
- **Resolved (6)** = Q-052 / Q-053 / Q-054 / Q-056 / Q-058 / Q-059
- **Deferred (2)** = Q-055 (re-entry: PUB-1A.5 retrospective) / Q-057 (re-entry: ADR-NNNN (다음 가용 ID) 가칭, EXTR-1A.1 진입 직전)

defer 자체가 명시 결정 (re-entry gate + 조건 lock) — doc drift 방지. 본 PR scope 안 commit 으로 Q files / register / DEC register / action-items 모두 갱신.

**slice ID (`INFRA-1B.3.h1-policy-fix` 등) 는 candidate identifier** — `docs/04_IMPLEMENTATION_PLAN.md` slice 표에 아직 미등록. 본격 canonical 등록은 별도 후속 PR (`PR-canonical-register-2026-05-15` 가칭) 에서:

- `docs/04_IMPLEMENTATION_PLAN.md` slice 표에 신규 slice row 추가
- `docs/context/current-state.md` next action = `INFRA-1B.3.h1-policy-fix` 반영
- 신규 slice 진입 시점 또는 lock 결정 시점에 별도 commit

본 PR (#40) 의 scope = retrospective artifact + Q-052~Q-059 decision package (DEC-024) + register 갱신. 코드 변경 0건.

## Execution rule (운영자 attention budget 보호)

본 review 가 발견한 208 + ~80 finding 의 backlog explosion 회피 의무. **[DEC-024 D8 lock](../decisions/DEC-024.md#d8--q-059-attention-budget--p2p3-backlog-처리-정책) 에 따라** 다음 rule 적용:

1. **engineering deliverables (즉시 진행 가능)** = `AI-P0-1` (R2 archive_policy guard) ~ `AI-P1-7` (policy_decisions DB enum + upload_attempt_id) — P0-M2 hardening 핵심.
2. **engineering doc-sync 보조 (Week 1 안 함께 진행 가능)** = `AI-P1-8` (frontmatter parse fix) ~ `AI-P1-12` (RUNBOOK setup hygiene) — Codex review 2026-05-15 inline #21 feedback: rule #1 의 boundary 와 Week 1 sequence 정합. 두 group 모두 engineering queue 안 active, P0-M2 gate evidence 조건.
3. **운영자 admin task (병렬)** = DEC-024 D1 의 GH branch protection 등록 + CLAUDE.md global 갱신 / SPIKE-001 실행 / Doppler secret rotation cadence — engineering queue 와 별도.
4. **`AI-P2-*` (~22 항목) / `AI-P3-batch-*` (3 batch ~80 finding)** = backlog only. P0-M2 gate accept 전까지 진입 금지. 운영자가 Q-059 resolve 시점 또는 PUB-1A.5 첫 발행 retrospective 시점 promotion 가능.
5. **L2-* batch (Claude 자체 governance / glossary)** = `INFRA-1A.9-validator-extension` + `INFRA-1A.10-glossary-backfill` slice 안에 묶음 — engineering queue 후반부 또는 P0-M3 entry 직전.

위반 시 attention budget 초과 + PUB-1A.5 2주 목표 (DEC-005) 위협.

## A. 우선순위 정렬 (수용 후)

| 우선 | ID | source | 항목 | type |
|---|---|---|---|---|
| **P0** | AI-P0-1 | GPT P0-1 (Claude L4-F miss) | R2 cross-source policy guard 가 `archive_policy` 검사 안 함 | **bug fix slice** |
| **P0** | AI-P0-2 | Claude L9-A | main branch protection 3중 mismatch (DEC-020 vs CLAUDE.md vs GH state) | **decision Q + admin task** |
| **P1** | AI-P1-1 | GPT Latent P1 | chunker raw text persistence 가 source policy 안 받음 — `metadata_only` source 의 full body 가 Neo4j Chunk 에 저장 가능 | **schema + code slice** |
| **P1** | AI-P1-2 | GPT P1-1 | Source Registry seed 후 Neo4j Source node bootstrap 부재 | **slice** |
| **P1** | AI-P1-3 | GPT 2부 P2-1 | fingerprint queue / chunker CLI entrypoint 부재 — operator 가 M2 e2e 실행 불가 | **slice** |
| **P1** | AI-P1-4 | GPT P1-2 + P1-3 + Claude L3-M | Source Registry 가 PRD/AC-022/AC-027/AC-031 의 필드 (collectability / access_method / source_perspective / meta_category / subtopic_tags) persist 안 함 + `data/categories.yaml` 부재 | **schema + validation slice** |
| **P1** | AI-P1-5 | GPT P1-4 | `migrate --dry-run` 이 실제 parse 검증 안 함 (CI 주석 / TESTING 가 검증처럼 명시) | **CI + script slice** |
| **P1** | AI-P1-6 | GPT P1-5 + GPT 4부 PR-5 | runtime invariant scanner 부재 — `Snapshot.r2_key ↔ policy/audit/R2 inventory` cross-check 불가 | **slice** |
| **P1** | AI-P1-7 | GPT P1-6 | `policy_decisions` DB-level enum trigger 부재 + `upload_attempt_id` correlation 부재 | **migration v8 slice** |
| **P1** | AI-P1-8 | Claude L2-A | ADR-0023/24/27 + DEC-009/10/11 frontmatter YAML parse fail → invariant validator 안 6 decision 의 INV 0건 등록 | **doc fix (1 commit)** |
| **P1** | AI-P1-9 | Claude L1-A + GPT P1-8 | `docs/context/current-state.md` (line 38 / 184-189 / 248) + `docs/04_IMPLEMENTATION_PLAN.md` Risks 섹션 stale (post-43c8178) | **doc sync (1 commit)** |
| **P1** | AI-P1-10 | Claude L8-C | SPIKE-001 (Neo4j FTS p95 < 1s, NFR-001 / AC-002) 미실행 | **운영자 manual task** |
| **P1** | AI-P1-11 | Claude L8-D | AC-023 (REQ-018 policy gate 8 위험 행동) test land 0건인데 P0-M2 게이트 검증 단계 진입 | **slice 또는 AC scope 후퇴 결정** |
| **P1** | AI-P1-12 | Claude L8-H + L9-K + L10-J | fresh worktree `bun install --frozen-lockfile` + Doppler boot + GH token revoke + pre-commit hook (env scrub) RUNBOOK 명시 부재 | **doc + hook 추가** |
| **P2** | AI-P2-1 | GPT P1-9 | HLD Data Model summary 가 current vs target design 섞음 | **doc fix** |
| **P2** | AI-P2-2 | GPT 2부 P2-2~11 batch | Discovery scheduler / queue / RSS 8 finding (active_v0 / daily cap / scheduler rejected / done URL re-enqueue / URL canonicalization / content_hash phase semantic / content-type rejection) | **batch slice** |
| **P2** | AI-P2-3 | GPT 2부 P2-22~24 | ManualClaimEntry validation (whitespace / attribution.url / retry idempotency) | **slice** |
| **P2** | AI-P2-4 | GPT 2부 P2-25 + P2-26 + Claude L6-B/C | Run Ledger failure reason + stale running run reaper + cost throttle (OPS-1A.2) | **slice** |
| **P2** | AI-P2-5 | Claude L2-C / L2-G / L2-H / L2-I / L3-M | invariant validator extension batch (relation_enum enforce / defines[] 권리 / glossary 50+ term backfill / term_effects[] empty + reviewed_terms 신규 term cross-check) | **slice** |
| **P2** | AI-P2-6 | GPT 2부 P2-32 + Claude L9-O | "policy-aware vs pure transform" 경계 architectural 정리 + TS validator + Ruby check + Runtime scanner 3 도구 분담 명시 | **doc + architectural cleanup** |
| **P2** | AI-P2-7 | GPT 2부 P2-34 | operator-facing observability — `kwm status / sources validate / discovery run / queue process / interventions report` unified CLI namespace | **slice** |
| **P2** | AI-P2-8 | GPT 2부 P2-7 | scheduler backoff outcome 별 분리 (timeout / http 5xx / http 4xx / robots_disallowed / parse_error) | **slice** |
| **P2** | AI-P2-9 | GPT 2부 P2-30 | end-to-end operator flow test (seed → bootstrap → discovery → queue → snapshot → chunk) | **test slice** |
| **P2** | AI-P2-10 | Claude L9-I | npm supply chain audit 자동화 (dependabot.yml + `bun audit` CI step) | **CI slice** |
| **P2** | AI-P2-11 | Claude L9-E + Claude L1-P | `.github/workflows/*.example` 4 file 처리 (삭제 vs boilerplate template 유지) | **CI cleanup** |
| **P3** | AI-P3-batch-1 | Claude L2-K / L7-J / L7-K / L7-R 등 | validator / migration script naming + dry-run 정확성 batch | **doc/script cleanup** |
| **P3** | AI-P3-batch-2 | Claude L1-C / L1-H / L1-K / L1-N / L1-O / L8-A 등 | doc inventory cleanup (AC row 순서 / TRACE-016/039 duplicate / IMPL_PLAN P0-M3 row codex review 회고 / TEST count stale 등) | **doc cleanup** |
| **P3** | AI-P3-batch-3 | GPT 2부 P3 multiple | 잔여 P3 cleanup (lint alias / dry-run idempotency preview / RSS author/summary / DNS rebinding RUNBOOK / Markdown escaping / chunk hash 등) | **mixed** |

## B. 신규 Q (operator decision required)

본 review 가 발견한 운영자 결정 필요 항목 → `docs/questions/` 에 per-file Q 등록 의무.

| Q ID | 제목 | source | blocks |
|---|---|---|---|
| **Q-052** | main branch protection 3중 정책 충돌 reconciliation — DEC-020 (PR-only) vs CLAUDE.md (k-world-monitor 직접 push 허용) vs GH state (Branch not protected) | Claude L9-A | AI-P0-2 / 향후 모든 PR governance |
| **Q-053** | chunker raw text persistence 정책 — `archive_policy` 기반 gate + 신규 `local_storage_policy` enum 도입 여부 (3 층 정책 `cloud_storage_policy` / `local_storage_policy` / `external_llm_policy`) | GPT Latent P1 + Claude L10-O | AI-P1-1 chunker slice |
| **Q-054** | Source profile canonicalization 방향 — Neo4j Source node projection 확장 (옵션 A) vs SQLite `source_profile` table 신설 (옵션 B) | GPT P1-2 | AI-P1-4 Source Registry slice |
| **Q-055** | Dataset ingestion MVP timing — M3 이전 dataset MVP (GPT 3부 권고) vs ADR-0024 EXTR-1A.5 lock 유지 | GPT 3부 (데이터 품질) | EXTR-1A.5 timing / P0-M3 진입 직전 |
| **Q-056** | 첫 publishable format 결정 — DEC-005/009/011 (v0 blog_long + 경제 + 한국 부동산) 유지 vs Weekly Scenario Watch 형식 (GPT 권고) reflow | GPT 3부 (콘텐츠) | PUB-1A.5 scope / P0-M6 MVP |
| **Q-057** | Claim promotion / semantic dedup 정책 — EXTR-1A.* 진입 직전 lock 의무 (promotion score / semantic claim key / claim_direction enum) | GPT 3부 (claim bloat 방지) | EXTR-1A.* entry |
| **Q-058** | Source reliability 단일 축 vs multi-dim — primary_data / official_policy / wire_news / expert_analysis / market_commentary / local_observer / opposition_view / think_tank / academic 의 `source_role` 추가 여부 | GPT 3부 (데이터 품질) | AI-P1-4 Source Registry slice 안 흡수 가능 |
| **Q-059** | 운영자 attention budget — Claude L12-H 의 "review 자체가 capacity 초과" + GPT 4부 의 PR-1~5 만 우선 path. P2/P3 batch (~120 finding) 의 처리 정책 (즉시 vs PUB-1A.5 후 archive) | Claude L12-H | 다음 4주 priority |

## C. 신규 slice (IMPL_PLAN 등록 의무)

본 review 가 발견한 새 slice — `docs/04_IMPLEMENTATION_PLAN.md` slice 표 (line 100~) 에 row 추가 의무.

| Slice ID | Milestone | Track | Goal | source action item | dependencies |
|---|---|---|---|---|---|
| `INFRA-1B.3.h1-policy-fix` | P0-M2-hardening | INFRA | R2 linked-source policy guard 에 `archive_policy` 추가 (`allLinkedSourcesAllowR2SnapshotUpload` rename + 6 regression tests) | AI-P0-1 | INFRA-1B.3.x-audit |
| `INFRA-1B.1.h1-source-bootstrap-neo4j` | P0-M2-hardening | INFRA | `seed-sources` 후 Neo4j Source node bootstrap + preflight (mismatch fail-fast) | AI-P1-2 | INFRA-1B.1 |
| `INFRA-1B.3.h2-queue-cli` | P0-M2-hardening | INFRA | `bun run discovery:process-queue` CLI + typed `source_not_found_in_graph` error 통일 | AI-P1-3 | INFRA-1B.3 |
| `INFRA-1B.4.h1-chunker-policy-gate` | P0-M2-hardening | INFRA | `chunkSnapshot(input)` 에 `sourceId + archivePolicy` 의무. `metadata_only` / `do_not_collect` reject, `excerpt_only` reject (limit 까지), `full_snapshot_allowed` allow. empty text 가 chunk 삭제 안 하게. | AI-P1-1 (Q-053 lock 후) | INFRA-1B.4 |
| `INFRA-1B.1.h2-source-profile` | P0-M2-hardening 또는 P0-M3 entry | INFRA | Source Registry 가 PRD/AC-022/AC-027/AC-031 의무 필드 persist (`data/categories.yaml` + `source_profile` table 또는 Neo4j projection 확장 + collectability/access_method/meta_category/subtopic_tags/active_v0 validation) | AI-P1-4 (Q-054 + Q-058 lock 후) | INFRA-1B.1 + INFRA-1B.1.h1-source-bootstrap-neo4j |
| `OPS-1B.h1-runtime-invariant-scanner` | P0-M2-hardening | OPS | `bun run audit:r2-invariants` — Snapshot.r2_key ↔ policy ↔ audit ledger consistency scan (read-only) | AI-P1-6 | INFRA-1B.3.h1-policy-fix + INFRA-1B.3.x-audit |
| `INFRA-1B.3.h3-audit-hardening` | P0-M2-hardening | INFRA | v8 migration — `policy_decisions.intended_action` enum trigger + `r2_upload` decision enum trigger + `upload_attempt_id` column + attempted/outcome correlation | AI-P1-7 | INFRA-1B.3.x-audit |
| `DEPLOY-1A.0-migration-validation` | P0-M2-hardening | OPS | `migrate:plan` / `migrate:sqlite:validate` / `migrate:neo4j:validate` 분리. CI 에 temp SQLite apply. TESTING test count fix. | AI-P1-5 | — |
| `INFRA-1A.9-validator-extension` | P0-M2-hardening | INFRA | invariant validator extension — relation_enum enforce / defines[] 권리 / supersede chain bidirectional / glossary cross-check 강화 (`cross_ref_code[]` 도입) | AI-P2-5 (Claude L2 batch) | — |
| `INFRA-1A.10-glossary-backfill` | P0-M2-hardening | INFRA | 50+ unique 신규 term glossary file 추가 (evidence_role / lifecycle_state / stance / market_stance / archive_policy / quote_reason / intervention_severity / chunk / scenario-revision + DEC-019~023 + Q-050/051 + ADR-0031 term) | AI-P2-5 (Claude L3-M) | INFRA-1A.9-validator-extension |
| `DOC-SYNC-2026-05-15` | P0-M2-hardening | (cross-cut) | doc batch fix — current-state line 38/184-189/248 / Risks Q-042~Q-048 / TRACE-040/041 / IMPL_PLAN Risks / HLD Data Model 분리 / PRD Open Questions Q-035/Q-050 추가 / 03_RISK_SPIKES SPIKE-002/003 ADR-0023+DEC-010 reflow / Milestones P0-M2-hardening row 추가 / TEST count fix | AI-P1-9 + AI-P2-1 + Claude L1 batch | AI-P1-8 (frontmatter parse fix 선행) |
| `INFRA-1B.2.h1-discovery-hardening` | P0-M2-hardening | INFRA | discovery scheduler / queue 8 finding batch (active_v0 validation / daily cap real-daily / scheduler rejected error / done URL re-enqueue / URL canonicalization / content_hash column 분리 / content-type rejection enum / backoff outcome 별 분리) | AI-P2-2 + AI-P2-8 | INFRA-1B.2 |
| `INFRA-1B.6.h1-feedback-hardening` | P0-M2-hardening 또는 P1-M3-hardening | INFRA | ManualClaimEntry whitespace/url/retry idempotency 강화 + `:RESOLVES` edge UNIQUE constraint | AI-P2-3 | INFRA-1B.6 |
| `OPS-1A.2` (existing planned) | P0-M3 | OPS | run ledger cost throttle + stale running run reaper + failure_code/detail (기존 planned slice 의 GPT P2-25/26 + Claude L6-B/C 흡수) | AI-P2-4 | OPS-1A.1 |
| `OPS-1A.5-unified-cli` | P0-M3 | OPS | `kwm status / sources validate / discovery run / queue process / interventions report / runtime-invariants check` unified CLI namespace | AI-P2-7 | INFRA-1B.* hardening 후 |
| `INFRA-1A.h1-supply-chain-audit` | P0-M2-hardening | INFRA | `.github/dependabot.yml` + CI 에 `bun audit` step | AI-P2-10 | — |
| `INFRA-1B.2.h2-end-to-end-test` | P0-M2-hardening | INFRA | seed → bootstrap → discovery → queue → snapshot → chunk e2e test | AI-P2-9 | 모든 P1 slice 완료 후 |

## D. 운영자 admin task (코드 land 아님)

| Task | source | priority |
|---|---|---|
| DEC-024 D1 후속 — GH branch protection 등록 (`gh api -X PUT /repos/.../branches/main/protection ...`) + CLAUDE.md global 의 k-world-monitor 직접 push 예외 제거 또는 break-glass 만 허용 으로 축소 | AI-P0-2 | P0 |
| SPIKE-001 Neo4j Community local docker setup + bench 실행 + 결과 commit | AI-P1-10 | P1 |
| Doppler secret rotation cadence 명시 + 4 vendor + Neo4j password rotation procedure RUNBOOK 추가 | Claude L10-K | P2 |
| `.env` pre-commit hook (env scrub) | AI-P1-12 의 일부 | P2 |
| GH access token revoke 절차 RUNBOOK 추가 | AI-P1-12 의 일부 | P2 |

## E. 다음 4주 권고 sequence (GPT 4부 + Claude L9-A + Claude L1/L2 우선)

**Week 1 — P0 unlock** (engineering queue 우선, DEC-024 D1 admin task 는 운영자 병렬):

운영자 admin task (병렬, engineering queue 비의존):
- **DEC-024 D1 admin task** — GH branch protection 등록 + CLAUDE.md global 갱신. 모든 향후 governance baseline anchor — engineering queue 와 별도로 즉시 진행. (Q-052 자체는 이미 DEC-024 D1 으로 resolved.)

Engineering queue (순서대로):
1. **AI-P0-1** — `INFRA-1B.3.h1-policy-fix` slice (R2 archive_policy guard + 6 regression tests). **legal-safety P0 — 가장 먼저**.
2. **AI-P1-8** — ADR-0023/24/27 + DEC-009/10/11 frontmatter parse fix (1 commit, invariant validator 안 6 decision INV 자동 등록 회복). **DOC-SYNC 의 baseline — 먼저**.
3. **AI-P1-9** — `DOC-SYNC-2026-05-15` slice 의 current-state + Risks fix 부분 (post-43c8178 + AI-P0-1 결과 + AI-P1-8 의 effective_invariant_policy regen 반영).

**Week 2 — P1 blocker resolution**:
5. **AI-P1-2** — `INFRA-1B.1.h1-source-bootstrap-neo4j` slice
6. **AI-P1-3** — `INFRA-1B.3.h2-queue-cli` slice (+ typed `source_not_found_in_graph` 통일)
7. **AI-P1-1** — Q-053 lock 후 `INFRA-1B.4.h1-chunker-policy-gate` slice
8. **AI-P1-12** — `bun install` / Doppler / pre-commit hook RUNBOOK 1 entry

**Week 3 — P0-M2 gate accept preparation**:
9. **AI-P1-10** — SPIKE-001 manual 실행
10. **AI-P1-11** — AC-023 test 추가 또는 scope 후퇴 (운영자 결정)
11. **AI-P1-6** — `OPS-1B.h1-runtime-invariant-scanner` slice
12. **AI-P1-7** — `INFRA-1B.3.h3-audit-hardening` slice (v8 migration)

**Week 4 — P0-M3 entry preparation**:
13. **AI-P1-5** — `DEPLOY-1A.0-migration-validation` slice
14. **AI-P1-4** — Q-054 lock 후 `INFRA-1B.1.h2-source-profile` slice
15. **AI-P2-1** — HLD Data Model section 분리 + RUNTIME/OPERATIONS 갱신
16. **AI-P2-10** — `INFRA-1A.h1-supply-chain-audit` slice
17. **AI-P2-5** — `INFRA-1A.9-validator-extension` + `INFRA-1A.10-glossary-backfill` slice batch (P1-8 + Q-057~058 일부 흡수)

**Deferred to PUB-1A.5 후**:
- Q-055 (dataset ingestion MVP timing) / Q-056 (format reflow) / Q-057 (claim promotion) — P0-M3 / M6 진입 직전 lock
- P2/P3 batch (~120 finding) — PUB-1A.5 첫 발행 후 retrospective 안에 archive 또는 selective fix

## F. 종합 — Claude review 의 자아비판 + GPT review 의 약점 반영

본 종합은 GPT review 를 **선택적 수용 + Claude review 의 unique angle 보강** 으로 진행. GPT review 의 한계 (3부 "Weekly Scenario Watch" 권고가 DEC-005/009/011 lock 과 충돌 / 3부 dataset MVP 권고가 ADR-0024 timing 과 충돌 / PR-7 너무 큼 / 일부 P2 가 v0 over-engineering 의심) 는 운영자 결정 Q (Q-055 / Q-056) 로 promote 또는 sub-PR 분리 (DOC-SYNC-2026-05-15) 로 흡수.

본 review 의 가장 큰 single output: **AI-P0-1 (R2 archive_policy guard) 가 P0-M2 gate accept 의 hard blocker**. PR-1 진입 즉시 의무.
