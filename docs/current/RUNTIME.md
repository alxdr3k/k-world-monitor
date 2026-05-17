# Runtime Flow

> Last verified against code: (pending Cycle 9 code commit on branch `claude/r2-audit-column-rationale-drift-axis`) — Cycle 9 / OPS-1B.h4-r2-audit-column-rationale-drift-axis. Previous baseline = 116c9ed (Cycle 8 PR #63). Cycle 9 adds **Axis 6 `r2_audit_column_rationale_drift`** — column vs rationale dual-write contract violation surface. 7 axis total (post-Cycle-9).

## Current implemented flow

대부분의 P0-M2 pipeline (Discovery / Snapshot / Chunker / Access Intervention)
는 landed 상태로 INFRA-1B.* slice 들의 합으로 실제 코드가 동작한다. 본 thin
doc 의 핵심 runtime contract 정리:

### R2 invariant scanner (post-Cycle 9, 7 violation axes)

`bun run audit:r2-invariants` (또는 `--json`) 가 read-only 로 3 store (Neo4j
`Snapshot.r2_key` ↔ SQLite `policy_decisions` ↔ SQLite `source_material_policy`)
를 reconcile 한다. 본 scanner 는 AC-032 / NFR-008 의 audit-by-absence
cross-check evidence — write path (snapshot-fingerprint r2Put 전후 audit
INSERT) 가 강제하는 invariant 가 retroactive policy change / Neo4j SET 실패 /
TOCTOU 등의 edge case 에서도 유지됨을 read time 에 검증한다.

| Axis | 발화 조건 | 운영자 remediation |
|---|---|---|
| `r2_key_without_audit` | `Snapshot.r2_key IS NOT NULL` + 대응하는 `policy_decisions(intended_action='r2_upload', decision='uploaded')` row 부재 | pre-v7 historical snapshot (informational); post-v7 라면 audit hook regression — `recordR2UploadDecision()` 호출 site 점검 |
| `audit_uploaded_without_r2_key` | `decision='uploaded'` audit row 존재 + Snapshot `r2_key=NULL` (또는 Snapshot 부재) | `decision='uploaded'` 는 r2Put + Neo4j SET 모두 성공 의미 (ternary lock). 대부분 Snapshot DETACH DELETE 가 r2 정리 없이 진행된 운영 ops — manual r2 cleanup |
| `r2_key_with_restricted_source` | `Snapshot.r2_key IS NOT NULL` + linked Source 중 `archive_policy != 'full_snapshot_allowed'` 또는 `raw_cloud_policy != 'allowed_public_data_only'` | 운영자가 upload 후 `source_material_policy` tightening — repair-CLI 로 r2 object 제거 (별도 slice) 또는 source policy rollback |
| `r2_object_without_graph_key_set_failed` (Axis 4) | `decision='set_r2_key_failed_neo4j'` audit row — r2Put 성공 + Neo4j SET 실패 | violation `details.expectedR2Key` (= `permitted_artifact/derived/snapshot/${snapId}`) 사용. **Recovery**: rerun SET (dedup 보존). **Cleanup**: r2 object 제거. 모두 repair-CLI scope |
| `r2_object_without_graph_key_policy_recheck_skipped` (Axis 4b) | `decision='skipped_toctou'` audit row — r2Put 성공 + post-recheck 가 restricted source 검출 후 SET skip | **Do NOT blindly rerun SET** (recheck 결정 재위반). r2 object cleanup 또는 source policy rollback (recheck rejection 이 의도치 않았다면). `expectedR2Key` 사용 |
| `malformed_r2_upload_audit_row` | r2_upload outcome row 의 rationale 이 `snap_id=snap_...;` canonical prefix 미충족 + v9 `snap_id` column 도 NULL/garbage | `recordR2UploadDecision` format regression 점검 → row 수정 또는 parser 갱신. v9 column 도입 (AI-P1-15) 이후 신규 row 는 column 우선이므로 발화 시 audit ledger 의 manual write 가능성 점검 |
| `r2_audit_column_rationale_drift` (Axis 6, Cycle 9) | v9 `snap_id` column 과 rationale prefix 가 **둘 다 well-formed 인데 서로 다른 snap_id 값** | Dual-write contract violation. `recordR2UploadDecision` 가 column + rationale prefix 를 atomic 으로 같은 값으로 write 하도록 설계됨 — divergence 의 likely 원인: manual SQL UPDATE / repair script 가 한 쪽만 수정, writer format regression (`formatRationale()` ≠ column write), fixture / backfill 이 한 쪽만 populate. Column 이 canonical handle (scanner column-preferred) — reconciliation 시 column 값을 truth 로 채택 권고 |

scanner 는 `aligned=true / false` boolean + violation array + ScanCounts
6 field (`r2BackedSnapshots`, `uploadedAuditRows`, `setR2KeyFailedNeo4jAuditRows`,
`skippedToctouAuditRows`, `malformedR2UploadAuditRows`, `sourcePolicyRows`)
를 반환한다. CLI 는 violation 0 이면 exit 0, 1 이상이면 exit 1 (operator
alert hook). Cycle 9 의 Axis 6 추가는 새 ScanCounts field 를 늘리지 않음 —
column / rationale 의 raw 값을 row 안에 다 보유하므로 reconcile() 가
read-time 에 detect.

### r2_upload audit lifecycle (post-AI-P1-7 v8 + AI-P1-15 v9)

`src/discovery/worker/snapshot-fingerprint.ts` 의 r2Put 2 call site (dedup
back-fill + new path) 가 audit row 를 BEFORE/AFTER pair 로 INSERT:

- **BEFORE r2Put**: `decision='attempted'` + `upload_attempt_id='uatt_<ULID>'`
  + `snap_id='snap_<ULID>'` (v9 column + rationale prefix dual-write).
  network 실패 시에도 audit trail 보존.
- **AFTER r2Put 성공**:
  - Neo4j `SET s.r2_key` 성공 → `decision='uploaded'`
  - Neo4j SET 실패 → `decision='set_r2_key_failed_neo4j'` (Axis 4 발화 대상)
  - post-r2-put recheck 가 restricted linked source 검출 → `decision='skipped_toctou'`
    (Axis 4b 발화 대상)

각 outcome 은 mutually exclusive 로 같은 `upload_attempt_id` 의 BEFORE/AFTER
pair 1쌍만 형성. 운영자 audit query 는 `WHERE upload_attempt_id = '...'`
로 단일 attempt 의 lifecycle 전체 추출 가능.

### 운영자 CLI flow (current)

```text
[operator]
  └→ bun run seed-sources [--dry-run] [--neo4j] [--preflight]
       └→ SQLite source_material_policy seed
       └→ (--neo4j) Neo4j Source MERGE bootstrap
       └→ (--preflight) 3-way alignment 검증 → BootstrapPreflightError fail-fast

[operator / cron]
  └→ bun run discovery:run [--dry-run]
       └→ RSS / sitemap / API → discovery_queue enqueue

[operator / cron]
  └→ bun run discovery:process-queue [--dry-run]
       └→ queue claim → safeFetch → snapshot-fingerprint → chunker (post-AI-P1-1 archive_policy gate)
       └→ 6 error_code 분류 + per-row mark done/error

[operator]
  └→ bun run audit:r2-invariants [--json]
       └→ 6-axis read-only invariant scan (위 표 참조)
       └→ exit 0 (aligned) or 1 (violations) — operator alert hook
```

## Planned flow (ADR-0003 기반 의도)

## Planned flow (ADR-0003 기반 의도)

```text
[cron / manual]
  └→ Discovery (RSS / API / sitemap)
       └→ Source Registry update + Collection Queue enqueue (SQLite)
            └→ Fetcher (queue dequeue)
                 ├→ R2 upload (sha256 dedupe)
                 └→ Snapshot row 생성 (SQLite)
                      └→ Chunker (snapshot text → chunks → FTS5 index)
                           └→ Extractor router (article / dataset / report)
                                ├→ article: Haiku 4.5 1차 → result
                                ├→ dataset: parser → result (LLM 미사용)
                                └→ report: Haiku 4.5 with structure → result
                                     └→ Confidence gate
                                          ├→ high reliability ∧ ≥0.85 → auto-confirm
                                          ├→ <0.85 confidence → Sonnet 4.6 escalate → reviewer
                                          └→ medium/low reliability → reviewer
                                               └→ Claim row + evidence(quote/locator/quote_hash)
                                                    └→ Run ledger 기록 (model/tokens/cost)

[manual / cron]
  └→ Stale Worker (time / snapshot_diff / counterclaim 트리거)
       └→ Claim status: confirmed → stale
            └→ Edge ledger cascade (인용 dossier/scenario/draft/publication 알림)

[manual]
  └→ Dossier Composer (주제별 promoted claim + counterclaim 합성)
       └→ Scenario Composer (drivers/assumptions/branches/falsifier/counterclaim/monitoring)
            └→ scenario_revisions append (in-place mutation 금지)
                 └→ Scenario Validator (5종 검사 — assumption weight / branches / falsifier / counterclaim / monitoring)
                      └→ ContentDraft Composer (Dossier + Scenario revision → draft + 인용 ledger)
                           └→ Cite Check (stale / retracted / horizon / unit / overclaim)
                                ├→ pass → ContentDraft state=ready → Publication 승격
                                └→ fail → ContentDraft state=reviewing
```

## Failure modes

| Failure | Expected handling |
|---|---|
| Fetcher 실패 (네트워크 / 4xx / 5xx) | Run ledger status=failed, queue requeue with backoff (max retries — INFRA-1B.3 slice에서 결정) |
| R2 upload 실패 | Snapshot row 미생성, queue 재시도 |
| sha256 collision (이미 존재하는 동일 bytes) | Snapshot dedupe — 기존 snap_id 재사용, 중복 row 미생성 |
| Extractor JSON parse 실패 | extraction_confidence=0 + claim_status=draft + reviewer queue 강제 진입 |
| LLM cost 일별 상한 초과 | OPS-1A.2 throttling worker가 Extractor batch 등록 일시 중단 |
| Scenario validate 실패 | ContentDraft compose 차단 (이전 scenario revision 사용 또는 운영자 결정) |
| Cite check 실패 (stale 등) | ContentDraft state=reviewing, Publication 승격 차단 |
| 인용 claim retracted (live Publication) | cascade alert + Publication state=corrected (Q-003 결정 후 enforce) |

## Debug path

- LLM run 추적: SQLite `runs` 테이블 → `run_id`로 grep
- Snapshot 추적: SQLite `snapshots` 테이블 → `r2_key` → R2 object
- Claim 추적: SQLite `claims` 테이블 → `evidence(quote_hash)` → Snapshot text
  (R2 cache)
- Edge 추적: SQLite `edges` 테이블 → `from_id` / `to_id` 양방향 query
- Publication 5-step trace: `pub_id` → `drf_id` → 인용 `clm_id` → `snap_id` →
  `r2_key` (NFR-003 5단계)
