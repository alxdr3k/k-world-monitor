# 2026-05-16 P0-M2-hardening engineering axis 회고

> **Reopen / hotfix follow-up (resolved)**: 본 retro 는 PR #51 (canonical
> register batch 2) merge 직후 "engineering axis 완료" 로 작성되었으나, 직후
> 정적 review 가 2 reopen-class blocker 를 발견했다:
> - **Blocker 1 (P0 legal-safety)** = PR #41 `INFRA-1B.3.h1-policy-fix` 가
>   close 한 INV-0012-3 enforcement layer 의 **sibling call site** (dedup-
>   link path inline guard, snapshot-fingerprint.ts line 490) 미수정. `archive_policy`
>   axis 가 빠진 채 `rawCloudPolicy === 'always_prohibited'` 만 검사하던 상태.
> - **Blocker 2 (P1 gate-blocker)** = PR #50 `OPS-1B.h1-runtime-invariant-scanner`
>   의 scanner SQL 이 `decision = 'uploaded'` 만 fetch → snapshot-fingerprint
>   `setSucceeded ? 'uploaded' : 'set_r2_key_failed_neo4j'` ternary 의 실패
>   branch (R2 object 존재 + Snapshot.r2_key NULL) 가 모든 axis 입력에서 제외.
>
> 두 blocker 모두 hotfix slice 로 종결:
> - **AI-P0-2 / `INFRA-1B.3.h4-dedup-r2-backed-link-policy-fix`** (PR #53 2f6ce43)
>   — line 490 guard 를 allowlist 로 broadening + 5 regression tests
> - **AI-P1-13 / `OPS-1B.h2-r2-invariant-scanner-orphan-axis`** (PR #54 f081e50)
>   — scanner SQL 확장 + Axis 4 `r2_object_without_graph_key` + Axis 5
>   `malformed_r2_upload_audit_row` + 10 tests (option B = scanner 변경, audit
>   lifecycle 보존 — PR #49 round 3 4-lifecycle-value lock 유지)
>
> 후속 hygiene + structural slice:
> - **AI-P1-14 / `INFRA-1B.1.h3-seed-sources-argv-allowlist`** (PR #56 01f029f)
>   — scripts/seed-sources.ts parseArgs allowlist + import.meta.main entry
>   guard + 12 tests. `--dryrun --neo4j` typo silent-write risk 종결.
> - **AI-P1-15 / `INFRA-1B.3.h5-policy-decisions-snap-id-column-v9`** (PR #57
>   cdd1faf, Codex 2 round review) — v9 migration: snap_id TEXT column +
>   partial INDEX + recordR2UploadDecision dual-write + scanner column-preferred
>   + `validSnapIdOrNull` shape guard + 10 tests. AI-P1-13 의 free-form
>   rationale regex 의존 구조적 해소. Codex round 1 P1 (schema_migrations
>   record 누락) + P2 (snap_id column shape 미검증) 둘 다 confirmed real bug
>   로 즉시 fix.
>
> 본 retro 의 lesson section (B.1~B.8) 은 모두 archival 가치 유지. AI-P0-2 /
> AI-P1-13 / AI-P1-14 / AI-P1-15 의 lesson 은 Section B.9~B.12 + Section
> E.5~E.7 에 추가.

본 문서는 [2026-05-15 action-items](2026-05-15-action-items.md) 의 Week
1~3 sequence (`AI-P0-1` → `AI-P1-8` → `AI-P1-9` → `AI-P1-2` → `AI-P1-3` →
`PR-canonical-register-2026-05-15` → `AI-P1-1` → `AI-P1-12` → `AI-P1-7` →
`AI-P1-6` → `PR-canonical-register-batch-2-2026-05-16`) + 정적 review
reopen sequence (`AI-P0-2` → `AI-P1-13` → `AI-P1-14` → `AI-P1-15` →
`PR-canonical-register-batch-3-2026-05-16`) 의 engineering axis 종료 보고 +
slice-별 lesson 정리 + 잔여 manual task obligations + Week 4 entry 조건 정리.

상태: `Status: PROPOSED — retrospective artifact, not canonical register. P0-M2-hardening engineering axis 12 slice (8 + 4 hotfix/hygiene) all landed 2026-05-16.`

P0-M2 gate accept 의 obligatory evidence 는 canonical
[`docs/04_IMPLEMENTATION_PLAN.md`](../04_IMPLEMENTATION_PLAN.md) milestones
표 (`P0-M2-hardening` row) + [`docs/context/current-state.md`](../context/current-state.md)
가 source of truth. 본 retro 는 engineering axis 종료의 회고용 artifact 로
canonical register 갱신 의무 없음.

## A. Engineering axis 종료 — 12 slice + 5 doc baseline PR landed

Week 1~3 의 engineering queue 12 항목 중 engineering land 대상 10 항목
(AI-P0-1 + AI-P1-8 + AI-P1-9 + AI-P1-2 + AI-P1-3 + AI-P1-1 + AI-P1-12 +
AI-P1-7 + AI-P1-6 + canonical register batch 2) 이 main 진입한 후,
정적 review 가 발견한 2 blocker + 2 follow-up hygiene/structural slice
(AI-P0-2 + AI-P1-13 + AI-P1-14 + AI-P1-15 + canonical register batch 3)
까지 추가로 main 진입.

### A.1 Code hardening (12 slice — P0-M2 gate evidence 후보)

| Slice ID | AI-item | PR | merged SHA | 핵심 |
|---|---|---|---|---|
| `INFRA-1B.3.x-audit` | (pre-Week-1) | #39 | 75706c4 | R2 upload audit ledger 도입 baseline (Q-044 → DEC-020, AC-032 / NFR-008) |
| `INFRA-1B.3.h1-policy-fix` | AI-P0-1 | #41 | 327f4b2 | R2 cross-source archive_policy guard (legal-safety P0, 4 call site + 6 regression tests) |
| `INFRA-1B.1.h1-source-bootstrap-neo4j` | AI-P1-2 | #44 | 861796a | Neo4j Source node bootstrap + 3-way preflight + `BootstrapPreflightError` fail-fast |
| `INFRA-1B.3.h2-queue-cli` | AI-P1-3 | #45 | 090ca5b | `bun run discovery:process-queue` CLI + new-path `source_not_found_in_graph` TypedQueueError 통일 + `parseArgs` allowlist |
| `INFRA-1B.4.h1-chunker-policy-gate` | AI-P1-1 | #47 | b09772a | Chunker archive_policy gate + empty-text preserve + `ChunkRejected` 5 reason enum (inverted allowlist) |
| `INFRA-1B.5.h1-runbook-setup-hygiene` | AI-P1-12 | #48 | 88d542d | RUNBOOK fresh-worktree setup + pre-commit secret scanner (9 vendor pattern + 256MB maxBuffer + execFileSync argv form) |
| `INFRA-1B.3.h3-audit-hardening` | AI-P1-7 | #49 | cc69261 | v8 audit hardening — `upload_attempt_id` correlation + 3 BEFORE INSERT 트리거 (explicit whitespace charset TRIM) |
| `OPS-1B.h1-runtime-invariant-scanner` | AI-P1-6 | #50 | 6500651 | R2 invariant scanner — Snapshot ↔ policy ↔ audit 3-way reconciliation (3 violation axis) |
| `INFRA-1B.3.h4-dedup-r2-backed-link-policy-fix` | AI-P0-2 | #53 | 2f6ce43 | **(reopen hotfix)** dedup-link path archive_policy guard hole 종결 — PR #41 sibling call site (line 490 inline guard) 미수정 hole, allowlist 양 axis 강제, 5 regression tests |
| `OPS-1B.h2-r2-invariant-scanner-orphan-axis` | AI-P1-13 | #54 | f081e50 | **(reopen hotfix)** scanner SQL `decision IN ('uploaded', 'set_r2_key_failed_neo4j')` 확장 + Axis 4 `r2_object_without_graph_key` + Axis 5 `malformed_r2_upload_audit_row`, 10 tests (option B = scanner 변경, audit lifecycle 보존) |
| `INFRA-1B.1.h3-seed-sources-argv-allowlist` | AI-P1-14 | #56 | 01f029f | seed-sources CLI `parseArgs` allowlist + `UnknownArgumentError` + `import.meta.main` entry guard, 12 tests. `--dryrun --neo4j` typo silent-write risk 종결 |
| `INFRA-1B.3.h5-policy-decisions-snap-id-column-v9` | AI-P1-15 | #57 | cdd1faf | v9 migration: `policy_decisions.snap_id TEXT` column + partial INDEX + recordR2UploadDecision dual-write + scanner column-preferred + `validSnapIdOrNull` shape guard, 10 tests. Codex round 1 P1 (schema_migrations 누락) + P2 (shape 미검증) 둘 다 fix 후 round 2 pass |

### A.2 Doc baseline (5 PR — sub-phase support, NOT code hardening)

| PR | AI-item | merged SHA | 핵심 |
|---|---|---|---|
| #42 | AI-P1-8 | 205aa7b | ADR-0023/24/27 + DEC-009/10/11 frontmatter YAML parse fix → invariant validator 안 6 decision INV 자동 등록 회복 |
| #43 | AI-P1-9 | 03a7ac9 | DOC-SYNC-2026-05-15 (current-state + IMPL_PLAN + HLD + PRD + SPIKES + TESTING 일괄 동기화) |
| #46 | PR-canonical-register-2026-05-15 | b702d3b | AI-P0-1 + AI-P1-2 + AI-P1-3 의 IMPL_PLAN slice 표 row 등록 (code 변경 0건) |
| #51 | PR-canonical-register-batch-2-2026-05-16 | 4c4bdb1 | AI-P1-1 + AI-P1-12 + AI-P1-7 + AI-P1-6 의 IMPL_PLAN slice 표 row 등록 (code 변경 0건) |
| 본 PR (#58) | PR-canonical-register-batch-3-2026-05-16 | self-reference (post-merge SHA in `git log`) | AI-P0-2 + AI-P1-13 + AI-P1-14 + AI-P1-15 의 IMPL_PLAN slice 표 row 등록 + sub-phase Milestones row landed list 8 → 12 + doc baseline list 4 → 5 + retro reopen section 본문 + action-items table row 4 추가 (code 변경 0건). 본 row 의 merged SHA 는 self-referential — squash merge 시점에 main commit SHA 가 결정되므로 placeholder 유지가 구조적 제약 (audit trail = git log 의 본 PR squash commit 으로 결정) |

### A.3 Test count + invariant 정합 baseline 추이

| Slice baseline | bun test cases | invariant errors / warnings |
|---|---|---|
| Pre-Week-1 (post-#39) | 490 | 0 / N |
| post-#41 (AI-P0-1) | 515 | 0 / N |
| post-#42 (AI-P1-8) | 515 | 0 / 5 (pre-existing AI-P2-5 backfill scope) |
| post-#43 (AI-P1-9) | 515 | 0 / 5 |
| post-#44 (AI-P1-2) | 544 | 0 / 5 |
| post-#45 (AI-P1-3) | 561 | 0 / 5 |
| post-#46 (canonical register) | 561 | 0 / 5 |
| post-#47 (AI-P1-1) | 569 | 0 / 5 |
| post-#48 (AI-P1-12) | 609 | 0 / 5 |
| post-#49 (AI-P1-7) | 623 | 0 / 5 |
| post-#50 (AI-P1-6) | 647 | 0 / 5 |
| post-#51 (canonical register batch 2) | 647 | 0 / 5 |
| post-#53 (AI-P0-2 dedup-link hotfix) | 652 | 0 / 5 |
| post-#54 (AI-P1-13 orphan-axis hotfix) | 662 | 0 / 5 |
| post-#56 (AI-P1-14 seed-sources argv) | 674 | 0 / 5 |
| post-#57 (AI-P1-15 v9 column + Codex round 1 P1/P2 fix) | **684** | 0 / 5 |
| post-this PR (canonical register batch 3) | 684 | 0 / 5 |

## B. Slice-별 lesson learned

### B.1 PR #41 / AI-P0-1 — R2 cross-source archive_policy guard

**Lesson 1 — bug 표면 vs 실제 가설 차이**. GPT P0-1 finding 은
`allLinkedSourcesAllowRawCloud()` 가 `archive_policy` 컬럼을 SQL 안에서
참조하지 않는다는 점만 지적. Code 안 들어가 보면 함수 이름이 가설을 잘못
유도 — "raw cloud 만 검증" 으로 읽혀 `archive_policy=metadata_only` Source
의 cross-source dedup 시 R2-backed Snapshot link 가능한 path 가 검토에서
누락. Fix 는 함수 rename (`allLinkedSourcesAllowR2SnapshotUpload`) + SQL
predicate 2축 강제 (`archive_policy='full_snapshot_allowed' AND
raw_cloud_policy='allowed_public_data_only'`). **가설 검증 시 함수명에
의존 금지** — 본문 + SQL + 모든 호출 site 직접 확인 의무.

**Lesson 2 — INV-0012-3 enforcement layer text 갱신 의무**. ADR-0012
invariant 의 enforcement layer 가 함수명 lock + archive_policy 검사 명시
부재 시 future drift 재발 risk. ADR text 갱신을 fix 와 같은 PR scope 안에
포함해야 함 — 분리 시 enforcement layer text 가 stale 로 남아 재발 가능.

### B.2 PR #44 / AI-P1-2 — Neo4j Source node bootstrap + 3-way preflight

**Lesson 1 — `seedSources` upsert-only 의 한계**. 초기 구현에서 bootstrap
target 을 seed yaml row 만 사용했다 (Codex P1 finding). 그러나 SQLite
`slug_map` 은 historical row (deprecated slug → 신규 slug 이동) 도 보존하
므로 yaml row 만으로는 Neo4j 의 historical Source node 누락. Fix —
`loadBootstrapRowsFromSqlite()` 가 SQLite slug_map 전체 row 를 bootstrap
target 으로 사용.

**Lesson 2 — Cypher `collect()` 의 null drop + Set 의 duplicate collapse**.
Codex P2 round 2: preflight 가 null source_id + duplicate source_id 를 못
잡았다. 이유 — Cypher `collect(s.source_id)` 가 null 자동 drop +
JavaScript `new Set()` 가 duplicate 자동 collapse → 두 anomaly 가 set
operation 안에서 invisible. Fix — `count(s)` vs collected-array length
diff 로 null 검출 + 별도 occurrence count map 으로 duplicate 검출.

**Lesson 3 — `was_created` 는 query-local 변수**. 초기 구현이 Source node
property 로 저장하려 했음 (운영자 review feedback). 그러나 `created` 는
transient (현재 transaction 의 MERGE 결과) — node property 저장 시 stale
+ 다음 bootstrap run 시 의미 모호. Fix — `OPTIONAL MATCH` 로 pre-MERGE
존재 여부 확인 후 query-local `was_created` boolean 만 emit.

### B.3 PR #45 / AI-P1-3 — discovery:process-queue CLI + error_code 통일

**Lesson 1 — `process.argv.includes()` 패턴은 typo 통과**. 초기 구현이
`process.argv.includes("--dry-run")` 사용 → `--dryrun` (hyphen typo) 가
silently 무시되고 default mode 로 실행. Codex P2 — `parseArgs` allowlist
+ `UnknownArgumentError` fail-fast 도입. 본 패턴이 본 retro 이후 모든
CLI entry 의 표준 (`run-process-queue.ts` + `run-r2-invariants.ts` 모두
이 패턴 적용).

**Lesson 2 — TypedError + error_code 단일화 가치**. snapshot-fingerprint
의 dedup-path 가 `TypedQueueError('source_not_found_in_graph')` 발행했지만
new-path 는 plain Error 발행 → operator alert table 의 `source_not_found_in_graph`
remediation 항목이 dedup-path 만 cover. Fix — new-path 도 동일
TypedQueueError 발행. **단일 error_code 가 단일 operator action 으로
mapping 되는 contract 유지** — runtime path 가 split 되어도 operator-facing
alert 의 surface 는 unified.

### B.4 PR #47 / AI-P1-1 — chunker archive_policy gate + empty-text preserve

**Lesson 1 — deny-list vs allowlist fail-closed semantics**. 초기 구현이
deny-list (`if (archivePolicy === metadata_only || excerpt_only || do_not_collect)
throw`) 였음. Codex P1 — `archive_policy` enum 에 신규 값이 추가되면
deny-list 가 통과시킨다 (fail-open). Fix — allowlist 로 inverted
(`if (archivePolicy !== 'full_snapshot_allowed') throw`) + 신규
`unknown_archive_policy` reason enum. **enum gate 는 항상 allowlist** —
deny-list 는 enum 확장 시점에 silent regression.

**Lesson 2 — silent DETACH DELETE 의 contract risk**. 초기 chunker 는
empty-text 시 기존 chunk DETACH DELETE 후 silent return → snapshot
revisit 시 ingestion 일시 fail 만으로 기존 dossier evidence pack 전체
wipe 가능. Fix — throw 로 변경 (chunk preserve). **destructive 동작은
조건 충족 시 emit 이 아니라 throw 가 default** — 호출자가 명시 의도로
DELETE 를 trigger 해야 함.

### B.5 PR #48 / AI-P1-12 — pre-commit secret scanner (6 round security review)

본 slice 가 가장 review 부담 큰 1건 — Codex P1×3 + P2×6 = 9 finding,
5 fix commit + 4 doc-only refresh commit. 보안 primitive 의 fail-closed
boundary 가 표면적으로 명확해도 edge case 누적 확인 필요.

| Round | Finding | Lesson |
|---|---|---|
| P1 round 1 | `execSync(cmd)` shell injection 가능 (filename 이 shell syntax 포함) | shell interpolation 가 없는 `execFileSync(file, [...args])` argv form 사용. **child_process API 선택 자체가 보안 결정**. |
| P1 round 1 | try/catch 안 console.warn 로 secret 통과 가능 | fail-closed = throw on read error. **silent log path 는 보안 boundary 위반**. |
| P1 round 2 | `--diff-filter=ACM` 가 R(ename) / T(ype-change) bypass | `ACMT` + `--no-renames` 명시. **git diff filter alphabet 의 default 가 cover 부족** — 보안 scan 시 full enumeration. |
| P2 round 2 | NUL-separated path parsing 가 staged file list 분해 실수 | `-z` output 명시 + `parseNulSeparatedPaths` 함수 분리 + 단위 test. |
| P2 round 3 | AWS STS `ASIA[0-9A-Z]{16}` 패턴 누락 (`AKIA` 만 cover) | `(?:AKIA|ASIA)[0-9A-Z]{16}` union 으로 확장. **vendor 의 multi-prefix 패턴 enumeration 의무** — single prefix assumption 금지. |
| P2 round 4 | `maxBuffer` default 1MB → 큰 staged file 시 ENOBUFS 로 scan skip + `--no-verify` 우회 path | `MAX_BUFFER_BYTES = 256 * 1024 * 1024` const 명시. **default 값에 의존하는 보안 boundary 는 explicit 화 의무**. |
| P2 round 5 | `/authorizations/{id}` API 2020-11 deprecated, doc 가 stale API 안내 | web-UI-only 명시 + 정확한 `git credential reject` 절차 분리. **GitHub REST API doc 의 deprecation history 직접 확인 의무**. |
| P2 round 6 | TESTING test count stale (593 vs 609), smoke command `/tmp/...` git add reject, GitHub token revoke section 불명확 | 3건 일괄 fix. **doc accuracy 도 보안 slice 의 round 6 까지 review 대상**. |

**총괄 lesson** — 보안 primitive slice 는 single-PR scope 안에서 **defense-in-depth
의 모든 boundary 가 review** 되어야 함. fail-closed boundary 가 1개라도
미완성 시 전체 primitive 가 보안 contract 위반.

### B.6 PR #49 / AI-P1-7 — v8 audit hardening (SQLite TRIM whitespace lesson)

**Lesson — SQLite default `TRIM(x)` 는 ASCII space 0x20 만 strip**. 초기
구현이 `TRIM(x) = ''` 로 upload_attempt_id required-when-r2_upload trigger
작성. Codex P2 round 1 — 이 패턴은 `"\t"` / `"\n"` / `"\r"` 통과
(whitespace 로 보이지만 trigger 검사 통과 → required-when-r2-upload
contract 위반). Fix — explicit charset `TRIM(x, ' ' || char(9) || char(10) ||
char(13)) = ''`. **SQL TRIM default 의 strip set 은 dialect 별로 다름** —
PostgreSQL default = whitespace 전체, SQLite default = ASCII space only.
**보안/validation trigger 안에서 TRIM 사용 시 strip set 명시 의무**.

### B.7 PR #50 / AI-P1-6 — R2 invariant scanner 3-way reconciliation

**Lesson 1 — read-only scanner 의 separation of concern**. 단일 함수에
fetch + reconcile + report 다 묶으면 unit test 가 integration test 됨.
Fix — `fetchR2BackedSnapshots()` (Neo4j) / `fetchUploadedAuditRows()`
(SQLite policy_decisions) / `fetchSourcePolicies()` (SQLite
source_material_policy) / pure `reconcile(snapshots, audits, policies)`
4 함수 분리. **read-only ops scanner = pure core + thin IO shell** —
core 가 test 의 main target, IO 는 fixture.

**Lesson 2 — `parseSnapIdFromRationale()` position-0 anchor**. rationale
prefix 안에서 `snap_<ULID>:` 패턴 추출 시 regex 가 mid-string 매칭 허용
하면 user-controlled rationale text 안의 false positive 가능. Fix —
position-0 anchor (`^snap_`) 강제. **parser 가 trust boundary 가로지를
때는 anchor 명시 의무**.

**Lesson 3 — INV-0012-3 의 cross-check enforcement layer**. INV-0012-3
이 정의되어 있어도 runtime 에 enforcement code 가 없으면 silent drift
가능. INFRA-1B.3.h1-policy-fix (PR #41) 가 ingestion-side enforcement
도입, 본 slice 가 audit-by-absence cross-check 추가. **invariant 의
enforcement layer 는 ingestion 시점 + offline scan 시점 2 axis 모두
필요** — 단일 axis 만 있으면 race condition 또는 historical drift 검출
불가.

### B.8 PR #46 / #51 — canonical register PR pattern

**Lesson — canonical ledger sync 는 engineering slice 와 분리한 별도 PR**.
PR #46 가 처음 도입한 패턴 — slice 1개 land 마다 IMPL_PLAN slice 표 row
를 즉시 등록하면 (1) slice PR 의 review burden 이 doc-heavy 로 confuse,
(2) review 후 slice scope 변경 시 row 도 같이 수정 obligation 추가. 분리
PR (코드 변경 0건, ledger sync 만) 로 처리 시 (a) slice PR 은 code review
에 집중, (b) ledger sync PR 은 multi-slice 일괄 등록 가능 (PR #46 = 3
slice, PR #51 = 4 slice batch, 본 PR = 4 slice batch). **doc-heavy
ledger sync = batch PR 패턴 유지 권고**.

### B.9 PR #53 / AI-P0-2 — dedup-link path archive_policy guard hole

**Lesson — 단일 invariant 의 multi-call-site enforcement enumeration 의무**.
PR #41 (AI-P0-1) 가 `allLinkedSourcesAllowR2SnapshotUpload()` rename + 4
call site 갱신으로 INV-0012-3 enforcement 의 양 axis (archive_policy +
raw_cloud_policy) 강제. 그러나 dedup-link path 의 **inline guard** (snapshot-
fingerprint.ts line 490) 는 별도 narrower check 로 PR #41 가 미수정.
PR #41 의 enforcement layer text 갱신이 "concept 으로는" dedup-link 도
cover 한다고 명시했으나 code change 가 line 490 에 닿지 않음.

**Process implication** — review 시 invariant fix 의 모든 enforcement site
를 systematic 으로 enumerate 의무. "renamed 함수의 call site" 만으로는
부족 — inline policy comparison (line 490 같은) 도 별도 site 임을 grep 필요.

**Defensive fix shape** — PR #47 의 inverted allowlist lesson 을 답습.
`if (existing.r2Key !== null && (input.archivePolicy !== 'full_snapshot_allowed' ||
input.rawCloudPolicy !== 'allowed_public_data_only')) throw` — 양 axis
allowlist. 향후 archive_policy enum 확장 시 자동 fail-closed.

### B.10 PR #54 / AI-P1-13 — scanner orphan-axis (happy-path-only design)

**Lesson — scanner / audit tool 은 lifecycle 의 모든 terminal outcome 입력
을 enumerate 의무**. PR #50 (AI-P1-6) scanner SQL `decision = 'uploaded'`
만 fetch. snapshot-fingerprint 의 `setSucceeded ? 'uploaded' :
'set_r2_key_failed_neo4j'` ternary 는 mutually exclusive — 즉
`set_r2_key_failed_neo4j` 경로 (r2Put 성공 + Neo4j SET 실패 → R2 object
존재 + Snapshot.r2_key NULL) 가 scanner 의 모든 fetcher 입력에서 제외
되어 3 axis 어느 것도 발화 안 함. "가장 critical 한 orphan 상태" 가 silent.

**Process implication** — scanner / audit tool 설계 시 decision enum 의
모든 value 를 명시 검토. ternary / mutually-exclusive outcome 이 있으면
양 branch 모두 scanner input 에 포함 의무.

**Defensive fix shape** — option (B) scanner 확장 (audit lifecycle 보존,
PR #49 round 3 lock 유지). 신규 axis `r2_object_without_graph_key` (orphan)
+ `malformed_r2_upload_audit_row` (parseSnapIdFromRationale null → violation
surface, throw 아님 — read-only scanner 의 defensive coding 원칙).
**malformed = throw 가 아닌 violation** — scanner 가 first anomaly 에서
abort 하면 후속 row 의 violation 누락 → audit 목적 무효화.

### B.11 PR #56 / AI-P1-14 — operator CLI safety pattern propagation

**Lesson — operator-facing CLI 의 parseArgs allowlist 는 모든 CLI 에 propagate**.
PR #45 (AI-P1-3) 가 `run-process-queue.ts` 에서 `process.argv.includes()`
silent-typo 위험을 fix. 그러나 `scripts/seed-sources.ts` 는 같은 패턴 미적용
— `--neo4j` 가 real graph write trigger 인 상황에서 typo `--dryrun --neo4j`
가 silent SQLite + Neo4j mutation 으로 진행 가능.

**Process implication** — operator CLI safety pattern 도입 시점에 동일 패턴
의 모든 CLI 에 즉시 propagate. PR-by-PR 으로 도입 지연되면 inconsistent
safety surface (operator 가 어떤 CLI 는 fail-fast, 어떤 CLI 는 silent typo
로 다른 모드 가정 가능).

**import.meta.main entry guard** — exported parseArgs/UnknownArgumentError
가 test 에서 import 가능하려면 CLI script 의 run() top-level invocation 을
`if (import.meta.main) run()` 으로 감싸야 함. PR #45 / #56 / r2-invariants
CLI 모두 동일 패턴. **CLI script 는 module + entry 모두** — test 가 module
import 시 entry side effect 차단 필요.

### B.12 PR #57 / AI-P1-15 — audit schema structural improvement + Codex 2 round

**Lesson 1 — 임시 우회 (rationale parsing) 를 영구화 위험 vs 구조적 fix**.
PR #54 (AI-P1-13) 가 scanner `malformed_r2_upload_audit_row` axis 로 free-form
rationale 파싱 의존을 surface 했으나, 의존 자체는 유지. v9 column add 가
structural fix — application-level guard (recordR2UploadDecision) +
schema-level handle (column) + reader-level fallback (rationale parsing
for legacy v8- rows) 의 3-layer 정합. **scanner-only fix 와 schema fix 의
경계** — scanner fix 는 anomaly 를 visible 하게, schema fix 는 anomaly
자체를 발생 안 하게 (구조적 보장).

**Lesson 2 — migration footer 의 schema_migrations record 가 lifecycle anchor**.
v9 migration SQL 끝에 `INSERT OR IGNORE INTO schema_migrations` 누락 시
- `getMigrationVersion()` stays at v8
- migrateSqlite() 가 v9 를 매번 pending 으로 treat
- ALTER 가 매번 duplicate-column error → recovery branch fire (noisy log)
- 운영자 audit 시 migration state tracking 부정확

Codex P1 round 1 finding. v7/v8 footer 와 동일 패턴 강제 — **모든 신규
migration SQL 의 closing line 은 schema_migrations INSERT**.

**Lesson 3 — `??` operator 가 만든 defensive coding 누수**.
`r.snap_id ?? parseSnapIdFromRationale(r.rationale)` 는 null/undefined
만 fallback trigger — non-NULL 이지만 malformed (empty string, garbage)
column 값은 silently 통과. **null check 와 shape check 는 다름** — validation
이 필요한 string-typed field 는 explicit shape validator 필요 (`validSnapIdOrNull`).
Codex P2 round 1 finding.

**Lesson 4 — Codex 2 round review 가 두 layer 잡음**. Round 1 = P1/P2
finding (위 2 lesson). Round 2 = "Didn't find any major issues". **single-PR
은 1 round 이상 review 보장**. 즉시 pass 받으면 surface depth 검증 부족
risk — security-relevant change 는 의도적으로 2 round 이상 round-trip.

## C. 잔여 manual task obligations

### C.1 AI-P1-10 — SPIKE-001 (Neo4j FTS p95 < 1s, NFR-001 / AC-002)

**Status**: pending — 운영자 manual task (로컬 docker 환경 필요).

**Procedure** (요구):
1. Neo4j Community Edition local docker container 기동
2. 1만 graph object (Source × Document × Snapshot × Chunk + FTS index) 시드
3. native FTS search call × N (warm-up 10 + measure 100) 후 p95 latency 측정
4. AC-002 (`p95 < 1s`) + NFR-001 cross-check
5. 결과를 `docs/spikes/SPIKE-001-neo4j-fts-bench.md` (가칭) artifact 로
   commit

**Risk**: 결과가 fail (p95 ≥ 1s) 시 P0-M1 gate accept 차단. INFRA-1A.2
schema design 또는 FTS index strategy revisit 필요할 수 있음.

### C.2 AI-P1-11 — AC-023 결정 (REQ-018 policy gate 8 위험 행동)

**Status**: **resolved 2026-05-17 (doc-only AI-P1-11 lock PR)** — D1a / D2a / D3a / D4a / D5b 결정 lock. 본 retrospective entry 작성 시점에 운영자에게 옵션 제안 (당시 List B candidate) 했으나, 후속 검증에서 ADR-0017 INV-0017-4 + `docs/glossary/policy-gate.md` 에 이미 canonical 8 위험 행동 list (List A — source-access 위험) 가 lock 되어 있고, 본 entry 가 제안한 List B 는 도메인이 다른 (콘텐츠 발화 위험) ad-hoc proposal 임이 밝혀짐. 운영자 결정: **List A 채택, List B 는 별도 axis 로 분리**.

**원래 entry 가 제안했던 List B (resolved — 미채택, content-production safety 도메인으로 분리)**:
1. `promise_or_implication`
2. `policy_advocacy_or_partisan_endorsement`
3. `legal_advice`
4. `medical_advice`
5. `financial_advice_specific`
6. `sensitive_attribute_inference`
7. `personal_identification`
8. `defamation_risk`

→ 위 list 는 ADR-0017 (Source Policy Gate Mode-aware) 의 source-access 위험 도메인이 아닌 **콘텐츠 발화 위험 도메인**. 본 entry 작성 시점에 운영자 옵션 제안용 ad-hoc list 로 작성되었으나 canonical 위치에 lock 된 적 없음. P0-M6 publication 슬라이스에서 별도 axis (신규 ADR 후보 — 가칭 content-production safety gate) 로 처리.

**원래 entry 가 제시한 옵션 (resolved — 옵션 (a) 변형 채택)**:
- 옵션 (a) 8개 전부 P0 유지 + detection test 진입 — 위임 시 제가 진입
  가능, 단 위험 행동 detection logic 의 source-of-truth (예 detection
  rule 이 prompt-based / regex-based / classifier-based 중 무엇) 명시
  필요.
- 옵션 (b) 일부 scope retreat (P0 → P1 또는 list 에서 제거) — 어떤 행동을
  retreat 할지 운영자 결정.
- 옵션 (c) AC-023 자체를 P0-M2 gate evidence 에서 제외 후 P0-M3 (EXTR-1A.*
  entry 시점) 으로 미루기 — REQ-018 detection 이 extractor 단계에서 발화
  하는 점 고려 시 EXTR-1A.0 (prompt injection 방어 기반) 와 함께 처리도
  defensible.

**Resolution (2026-05-17, doc-only AI-P1-11 lock PR)**:

| 결정 | 채택 | 내용 |
|---|---|---|
| D1 = D1a | ✅ | Canonical 8 위험 행동 = **ADR-0017 INV-0017-4 body §Decision + `docs/glossary/policy-gate.md` 의 List A** (source-access 위험 8개: 1. source policy unknown 또는 unauthorized 상태의 raw external LLM 전송 / 2. paywalled·proprietary full-text fetch / 3. terms violation (no scraping·no AI·no archive·no redistribution) / 4. wire-service full text / 5. article·report 원문 quote·cache / 6. 기사·리포트 도표·스크린샷 콘텐츠 추가 / 7. raw source embedding·indexing / 8. raw source cloud upload). 본 retrospective 의 List B (content-production safety) 는 별도 axis 로 P0-M6 publication 슬라이스에서 처리 (신규 ADR 후보, ADR-0017 범위 밖). **pre-PR-#68 frontmatter 의 'scraping ban / robots disallow' 표현은 stale compressed summary 였음 — 운영자 결정 옵션 D 2026-05-17** (GPT review post-PR-#68): body §Decision 이 canonical, frontmatter INV-0017-4 statement 도 body 와 일치하게 정정. robots.txt disallow 는 ADR-0028 safe-fetch boundary (`safe-fetch.ts` `isRobotsPathDisallowed()` + `RobotsDisallowedError`) 별도 enforcement, **본 ADR-0017 RiskTrigger 가 아님**. ledger coupling 은 `INFRA-1B.5.h3-robots-disallow-ledger-coupling` follow-up anchor (planned, NOT gate-blocking — safe-fetch 의 RobotsDisallowedError 를 policy_decisions 또는 access_intervention 에 어떻게 기록할지 정하는 별도 slice). `no scraping` 은 terms_violation 의 sub-class 로 유지 (`archive_policy='do_not_collect'` proxy). |
| D2 = D2a | ✅ | AC-023 detection 구현 slice 신규 신설 — **`INFRA-1B.5.h2-policy-gate-risk-triggers`** (P0-M2 hardening, status=planned). `docs/04_IMPLEMENTATION_PLAN.md` 의 INFRA-1B.1 row 의 "INFRA-1B.5/1B.6 으로 분리" stale 표기는 본 PR 에서 정정 완료. AC-023 의 8 위험 행동 trigger 구현은 신규 slice 안에서 detection rule + chunker · R2 upload · embed · external LLM call site 통합 + `tests/policy/gate_test.ts` 까지 한 slice 에서 닫는다 (partial evidence accept 회피). |
| D3 = D3a | ✅ | SPIKE-001 fixture = synthetic generator (`scripts/generate-spike-001-fixture.ts`, 10k graph object, fixed seed, idempotent reset) — operator manual seed 후퇴 안 함. reproducible baseline + commit 간 회귀 비교 가능. |
| D4 = D4a | ✅ | SPIKE-001 결과 기록 location = **`docs/context/PERF_RESULTS.md` 신설** — NFR evidence ledger 의 첫 사례. RUNBOOK 은 실행 절차, PR description 은 이벤트 로그, PERF_RESULTS 는 성능 evidence ledger 로 역할 분리. 향후 SPIKE-002 / NFR-### 검증도 동일 위치. |
| D5 = D5b | ✅ | 다음 PR scope 분할 = **4 단계** sliced PR. (1) **본 PR — doc-only AI-P1-11 lock PR**: List A canonical 확정 + List B defer + INFRA-1B.1 stale 표기 정정 + `INFRA-1B.5.h2-policy-gate-risk-triggers` 신규 row + AC-023 본문 layered contract 명료화 + retrospective AI-P1-11 resolved + Cycle 10 fdb847a/PR #66 placeholder backfill, 코드 변경 0건. (2) **PR 1b** — AC-023 engineering PR (`INFRA-1B.5.h2-policy-gate-risk-triggers` 구현). (3) **PR 2** — SPIKE-001 fixture + PERF policy PR. (4) **PR 3** — SPIKE-001 result + P0-M2 gate accept sync PR. |

**Resolution 의 변경 본문 anchor (본 doc-only PR 안에서 land)**:
- `docs/adr/0017-source-policy-gate-mode-aware.md` INV-0017-4 — List A canonical 유지 (변경 없음, 이미 lock).
- `docs/glossary/policy-gate.md` — List A 8개 enumerated (변경 없음, 이미 lock).
- `docs/04_IMPLEMENTATION_PLAN.md` INFRA-1B.1 row — "INFRA-1B.5/1B.6 으로 분리" stale 표기 정정 완료, AC-023 evidence pointer 를 신규 `INFRA-1B.5.h2-policy-gate-risk-triggers` 로 redirect.
- `docs/04_IMPLEMENTATION_PLAN.md` `INFRA-1B.5.h2-policy-gate-risk-triggers` 신규 row 신설 (P0-M2 hardening, status=planned). **slice ID rename note** (Codex PR #67 P2 + GPT 옵션 1 채택): 초기 안 `INFRA-1B.7-policy-gate-risk-triggers` 는 기존 P0-M4 Search/Query umbrella `INFRA-1B.7` 및 7a~e split 과 prefix 충돌 risk 가 있어 `INFRA-1B.5.h2-policy-gate-risk-triggers` 로 rename — INFRA-1B.5 (access_intervention + batch_report mode) 의 hardening 2 로 cohesive. D2a 의 본질 (= AC-023 구현 slice 신설) 은 보존, literal ID 만 정정.
- `docs/06_ACCEPTANCE_TESTS.md` AC-023 본문 layered contract 명료화 (위험 inline_block 고정 + 비위험 stage-default + 모든 결정 ledger 기록 + evidence source = `INFRA-1B.5.h2-policy-gate-risk-triggers`).
- `docs/context/current-state.md` Cycle 10 SHA placeholder backfill + AC-023 evidence pointer = `INFRA-1B.5.h2-policy-gate-risk-triggers` 명시.
- 본 retrospective C.2 entry (resolved 2026-05-17) + C.3 checklist 갱신.

### C.3 P0-M2 gate accept evidence checklist (운영자 작업)

P0-M2-hardening 종료 시점 obligatory evidence (canonical IMPL_PLAN
milestones 표 기준):
- ✓ INFRA-1B.3.x-audit (PR #39 — landed)
- ✓ INFRA-1B.3.h1-policy-fix (PR #41 — landed)
- ✓ INFRA-1B.1.h1-source-bootstrap-neo4j (PR #44 — landed)
- ✓ INFRA-1B.3.h2-queue-cli (PR #45 — landed)
- ☐ AC-022 / AC-024 evidence 확정 (운영자 검증). **AC-023 evidence = `INFRA-1B.5.h2-policy-gate-risk-triggers` landed via PR 1b engineering (AC-023 status 'defined' → 'passing' 정정, 53 tests pass, AI-P1-11 D2a 결정 적용 완료).**
- ☐ SPIKE-001 결과 (AI-P1-10 / 위 C.1). **결정 D3a / D4a: synthetic fixture generator + `docs/context/PERF_RESULTS.md` evidence ledger (2026-05-17 AI-P1-11 lock PR 안에서 일괄 결정). 별도 PR 2 (SPIKE-001 fixture + PERF policy) + PR 3 (SPIKE-001 result + gate accept sync) 으로 분리 진행.**
- ☑ AC-023 의 8 위험 행동 결정 (AI-P1-11 / 위 C.2) — **resolved 2026-05-17**, List A canonical (ADR-0017 INV-0017-4) + 신규 `INFRA-1B.5.h2-policy-gate-risk-triggers` slice 신설, retrospective List B 는 P0-M6 content-production safety axis 로 defer.

**P0-M2-hardening 의 추가 landed slice (지금까지 obligatory evidence 미등록
— 운영자 결정 시 promote 가능)**:
- INFRA-1B.4.h1-chunker-policy-gate (PR #47, AC-024 evidence)
- INFRA-1B.5.h1-runbook-setup-hygiene (PR #48, operator safety baseline —
  gate-blocking AC 없음)
- INFRA-1B.3.h3-audit-hardening (PR #49, AC-032 NFR-008 audit pair
  correlation 강화)
- OPS-1B.h1-runtime-invariant-scanner (PR #50, AC-032 NFR-008
  audit-by-absence cross-check)
- INFRA-1B.3.h4-dedup-r2-backed-link-policy-fix (PR #53, AC-032
  legal-safety + NFR-008 — PR #41 sibling site hole 종결, AI-P0-2)
- OPS-1B.h2-r2-invariant-scanner-orphan-axis (PR #54, AC-032 NFR-008
  audit-by-absence cross-check 확장 + Axis 5 defensive surface, AI-P1-13)
- INFRA-1B.1.h3-seed-sources-argv-allowlist (PR #56, operator CLI safety
  baseline — gate-blocking AC 없음, supporting evidence)
- INFRA-1B.3.h5-policy-decisions-snap-id-column-v9 (PR #57, AC-032 NFR-008
  audit schema structural — rationale regex 의존 종결, AI-P1-15)

본 8 slice 의 obligatory evidence promote 는 canonical register batch
2/3 의 scope 안에서 의도적 보류 — "구현 변경 금지, canonical ledger
sync + minimal current-state 정합성 보정만" operator directive 준수. P0-M2
gate accept 시점에 운영자가 일괄 결정.

## D. Week 4 (P1-MVP-prep) entry 조건

원 action-items Week 4 sequence:
- AI-P1-5 (`DEPLOY-1A.0-migration-validation`) — migrate dry-run 의 실제
  parse 검증 (CI 주석 / TESTING 가 검증처럼 명시되어 있으나 실제 parse
  없음)
- AI-P1-4 (`INFRA-1B.1.h2-source-profile`) — Q-054 lock 후 Source profile
  canonical store
- AI-P2-1 — HLD Data Model section 분리 + RUNTIME/OPERATIONS 갱신
- AI-P2-10 (`INFRA-1A.h1-supply-chain-audit`) — npm supply chain audit
  자동화
- AI-P2-5 (`INFRA-1A.9-validator-extension` + `INFRA-1A.10-glossary-backfill`
  batch) — invariant validator extension + glossary 50+ term backfill
  (data_science_module / cross_vendor_reviewer 포함)

**Entry 조건 (operator decision required)**:

1. **P0-M2 gate accept 완료 후 진입** (보수 옵션) — 위 C.3 checklist 의
   manual task 2건 + AC evidence 확정 완료 후 Week 4 start. 본 옵션은
   "milestone gate-accept first" 원칙 유지.
2. **Week 4 P1 slice 와 P0-M2 manual task 병렬** (적극 옵션) — engineering
   queue 는 Week 4 진입, 운영자 manual task (SPIKE-001 + AC-023) 은
   별도 axis 로 병렬. 본 옵션은 engineering throughput 우선.

권고: **옵션 1 (보수)**. 이유 — P0-M2-hardening 의 axis 종료 시점이
post-mortem 가치가 가장 높은 시점이고 (lesson 누적 충분), gate accept
전 Week 4 진입 시 P0-M2 evidence 확정과 Week 4 slice review 가 운영자
attention 안에서 경합. SPIKE-001 결과가 NFR-001 fail 시 INFRA-1A.2 revisit
의무 → Week 4 slice 가 그 위에 land 되면 rework 필요.

## E. P0-M2-hardening sub-phase 운영의 lesson

본 sub-phase 운영 (5-15 ~ 5-16 ~22 hour 안 11 PR land) 의 process-level
lesson.

### E.1 Canonical register PR 패턴의 효용

PR #46 + PR #51 의 batch ledger sync 패턴은 engineering slice 의 review
부담 분리에 효과적. **Engineering PR 4건당 canonical register batch 1건**
정도의 호흡이 운영자 review attention 안에서 balanced. 단 register PR
의 scope ("코드 변경 0건, ledger sync 만") 가 operator directive 로
명시되어야 review burden 이 예측 가능 (PR #46 review 시 operator 가
scope clarification 요청한 fact 가 본 패턴 정착의 trigger).

### E.2 Codex round review babysit pattern

PR #48 가 6 round + 9 finding 으로 최대 review burden. **single PR 안
보안 primitive 가 큰 surface 를 가질 때는 round count 가 예측 불가** —
round 4 의 ENOBUFS bypass, round 5 의 deprecated GitHub API doc 모두
"이미 fix 했다고 생각한" 시점 이후에 발견됨. **보안 primitive PR 은
"round 종료" 신호를 operator review 가 명시할 때까지 retry 의무**.

### E.3 SHA 갱신 의무 (thin-doc Last verified 헤더)

PR #41 round 1/2 codex review 가 발견한 thin-doc Last verified 헤더의
SHA 처리 rule (code-change commit 만 SHA 갱신, doc-only commit 은
`Thin-doc edits since` marker 만 추가) 가 본 sub-phase 안에서 11 PR
일관 적용. **Thin-doc 헤더의 SHA 가 verification baseline 의미를 lose
하면 doc 의 trust 가 무너진다** — rule 자체가 AGENTS.md 안에 lock 되어
있어 향후 retro 없이 enforced.

### E.4 Doc-heavy repo 에서 short summary 의 위험

CLAUDE.md 의 "Response style (overrides default agent system prompt)"
section 이 본 sub-phase 안에서 의도적으로 lock — 운영자가 ADR/DEC/Q/AC
결정 본문을 직접 review 하기 위해 짧은 summary self-censor 금지. Agent
가 "PR #48 round 4 fix 완료" 같은 jargon 으로 요약하면 운영자 review
가 deferred 상태에서 stuck — body / 결정 표 / 시나리오 / mapping 표 그대로
응답 안에 surface 의무. 본 lesson 은 다음 sub-phase (P1-MVP-prep)
sequence 안에서도 유지.

### E.5 정적 review reopen 이 fire 한 시점의 critical 평가 의무

PR #51 merge 직후 정적 review (operator-driven, GPT 같은 외부 reviewer)
가 발견한 2 blocker (Blocker 1 dedup-link hole / Blocker 2 scanner blind
spot) 는 본 sub-phase 의 "axis complete" 보고를 reopen 으로 전환. 본
상황의 lesson 은 **즉시 implement 진입 금지, 비판적 평가 우선**:

- reviewer claim 의 코드-level 정확성 직접 검증 (code 라인 read)
- invariant framing 확인 (PR #41 의 framing 채택 여부가 fix 형태 결정)
- 대안 옵션 vs 채택 옵션 trade-off 명시 (option A audit lifecycle 변경
  vs option B scanner 변경)
- reviewer 가 over-state / over-reach 한 부분 식별 (doc drift claim 이
  PR #51 미반영 review 의 false positive 였음)

본 평가 결과는 operator 결정 list 로 surface — 사용자 결정 (7건) 받은
후 implement 진입. **agent 가 reviewer 의 claim 을 work item 으로 즉시
수용하면 over-correction risk** (반대 방향 fix 또는 scope creep).

### E.6 reopen-driven slice 시퀀스의 sub-phase 종료 의미 재정의

본 sub-phase 가 PR #51 시점에 "engineering axis complete" 로 종료되었다가
2 blocker reopen 으로 4 slice 추가. 종료 의미를 다시 살펴보면:

- engineering axis complete = obligatory evidence 모두 land **+ 후속
  reopen 가능성 닫힘**
- 두 번째 조건이 정적 review 까지 거친 후에 비로소 충족 — 즉 reviewer
  attention 의 시간적 분포 가 axis 종료 기준의 일부

본 lesson 의 implication = **gate accept 직전 정적 review round 의도적
도입**. milestone gate accept 의 pre-condition 에 "외부 reviewer 1 round
이상 정적 review pass" 명시 권고 (단, 정적 review 가 어떤 reviewer 인지
는 별도 process 결정 — Codex / GPT / 다른 LLM / 사람 reviewer 모두 후보).

### E.7 hotfix slice 의 reasonable scope 분리 vs scope creep

AI-P1-13 (Blocker 2 scanner orphan-axis) 의 fix 가 자연스럽게 connect
되는 후속 작업 = (a) AI-P1-15 v9 snap_id column 으로 rationale parsing
의존 종결, (b) AI-P1-14 seed-sources argv (operator CLI safety pattern
propagation, AI-P1-13 fix 와 무관하지만 동일 review round 에서 surface).
운영자 결정 = 4 slice 분리 (AI-P0-2 + AI-P1-13 + AI-P1-14 + AI-P1-15).

**Lesson — reopen 이 트리거한 slice 시퀀스도 single-PR scope 유지 의무**.
AI-P0-2 + AI-P1-13 을 합쳐서 한 PR 로 처리할 수도 있었음 (둘 다 INV-0012-3
audit-axis). 그러나 분리 시:
- review burden 분리 (single-axis review 가 multi-axis review 보다
  쉬움)
- review feedback 적용 시 PR 단위 amend 가능 (AI-P1-15 의 Codex 2 round
  feedback 처리 시 다른 fix 와 entangle 안 됨)
- canonical register 시점 slice ID 별 row 가 명확

**vs scope creep** — AI-P1-14 (seed-sources) 가 AI-P1-13 (scanner) 과
무관해 보이지만 같은 review round 에서 surface. 별도 slice 분리가
correct — AI-P1-14 자체가 P0-M2 gate 의 supporting evidence (operator
CLI safety baseline) 이지 AI-P1-13 의 sub-task 아님.

## F. 종합 — P0-M2-hardening engineering axis 의 의의

본 sub-phase 의 결과 = P0-M2 milestone 자체의 MVP slice 일괄 landed
이후 **운영자 manual review (Claude 12-layer + GPT cross-review,
2026-05-15) 가 발견한 208 + ~80 finding 중 engineering-axis 우선항목
12건의 시퀀스 처리**.

P0-M2 milestone 의 gate accept 의 obligatory evidence (canonical
IMPL_PLAN milestones 표 line 80) 가 8 slice 중 4 slice (#39 + #41 + #44 +
#45) 만 명시 포함 — 나머지 4 slice (#47 + #48 + #49 + #50) 의 promote
는 P0-M2 gate accept 시점 운영자 결정. 본 retro 가 evidence 의 source
material 로 활용 가능.

다음 entry 후보 = P1-MVP-prep direction 의 Week 4 sequence (D 항목 참조)
또는 P0-M2 gate accept 의 운영자 manual task (C.1 / C.2). 운영자 결정
sequence 에 따라 다음 sub-phase 진입.

---

**Doc anchors**:
- canonical milestones row: [`docs/04_IMPLEMENTATION_PLAN.md`](../04_IMPLEMENTATION_PLAN.md)
  `P0-M2-hardening` row + 12 slice 표 row (`INFRA-1B.3.x-audit` ~
  `INFRA-1B.3.h5-policy-decisions-snap-id-column-v9`)
- current-state: [`docs/context/current-state.md`](../context/current-state.md)
  line 38 + line 53-63 + line 197-228 (line offsets reflect post-batch-3 expansion)
- prior retro: [2026-05-15 action-items](2026-05-15-action-items.md) Week 1~3 sequence
- prior retro (review source): [2026-05-15 GPT cross-review](2026-05-15-gpt-cross-review.md)
- DEC anchor: [DEC-024 D8](../decisions/DEC-024.md#d8--q-059-attention-budget--p2p3-backlog-처리-정책)
  (attention budget rule, P0/P1 only)
