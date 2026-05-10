# Runtime Flow

> Last verified against code: n/a (no implementation yet — 2026-05-11)

## Current implemented flow

코드 구현이 아직 없다. 이 문서는 INFRA-1B 단계 첫 worker가 landed될 때부터
실제 flow로 갱신된다.

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
