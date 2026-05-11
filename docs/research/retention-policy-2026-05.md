# Data Retention / Lifecycle 정책 리서치 (2026-05)

- 대상: `k-world-monitor` (1인 research-content pipeline, docs-only stage 완료, code 없음)
- 목적: Q-027 lock + OPS-1A.4 `raw_cache_items` TTL worker design 입력
- 작성: 2026-05-11

---

## 1. Executive summary

- 데이터는 **4 분류** (영구 보존 / 시간 가치 감쇠 / TTL 한정 / Replaceable) 로 나누고, 각 분류에 명시적 R2 prefix와 lifecycle action을 1:1 매핑한다.
- **R2 native lifecycle** = age-based 단순 만료 (multipart abort, raw cache 만료, backup rotation 등 "blunt instrument") 에만 사용. **Application batch job** = 의미적 기준 (claim retraction, dedupe, dataset_vintage GC, scenario revision supersede) 처리.
- **항상 보존 목록**은 명시적으로 "GC 금지 (do-not-touch)"로 정책에 박아둔다: `permitted_artifact/derived/publication/`, JSONL audit export 12개월 이후의 cold archive, `access_interventions` ledger, `policy_decisions`. 이 목록을 건드리는 모든 batch는 reject한다.
- 1년 boundary 거친 추정 R2 비용은 **월 USD 0.20 ~ 1.50 수준** (storage ≤100 GB 가정 시 dominant cost는 operations가 아니라 storage). egress=0이라 1인 운영자 부담은 매우 낮음.
- 단, **5+1 trace retroactive verification** (publication preflight) 이 깨지지 않도록 모든 GC 결정은 `policy_decisions` 테이블에 reason+evidence-pointer로 logging해 두는 게 핵심. soft-delete → tombstone → hard-delete 2단계 패턴 권장.

---

## 2. Data classification matrix

| 데이터 종류 | 분류 | 1차 store | TTL 권장 | Trigger | 비고 |
|---|---|---|---|---|---|
| `Publication`, `ContentDraft` (자체 산출물 final) | 항상 보존 | Neo4j + R2 `derived/publication/` | 무기한 | n/a | 정정 cascade 시 supersede edge로 link, 원본 유지 (INV-0014-7) |
| `AccessIntervention` ledger | 항상 보존 | Neo4j + SQLite `access_interventions` | 무기한 | n/a | 법적 항변 evidence — 절대 hard-delete 금지 |
| `policy_decisions` (run ledger reason+evidence) | 항상 보존 | SQLite | 무기한 (SQLite) / 12mo+ → JSONL cold | monthly export | Right-to-be-forgotten보다 우선 (legitimate interest = audit) |
| JSONL audit export | 항상 보존 | R2 `audit/jsonl/{yyyy-mm}/` | 무기한 | monthly | 12mo 이후 IA tier로 transition |
| `Dossier` exports (EvidencePack v0 포함) | 시간 가치 감쇠 | Neo4j + R2 `derived/dossier/{id}/` | 1y hot → IA | quarterly access pattern review | 인용 가능성이 12mo 후 급감 |
| `Snapshot` (Source fingerprint) | 시간 가치 감쇠 | Neo4j + R2 `derived/snapshot/` | 신선 12mo, 그 이후 supersede되면 1 canonical만 keep | newer fingerprint for same Source | 단, publication에 cited된 snapshot은 lock (항상 보존으로 promote) |
| `Scenario`, `Thesis` revision history | 시간 가치 감쇠 | Neo4j | latest + last 5 revisions | revision count | head revision은 영구, deep history는 N>5에서 collapse |
| Neo4j dump | TTL 한정 | R2 `backups/neo4j/{date}/` | 30d | daily age | Q-027 제안 그대로 |
| SQLite snapshot | TTL 한정 | R2 `backups/sqlite/{date}/` | 90d | daily age | 단일 파일 → 작음 |
| `raw_cache_items` (third-party fetched raw) | TTL 한정 (강제) | SQLite (metadata) + local FS | TTL 24h~7d, finalize/abandon 시 즉시 삭제 | last_accessed_at + fetch_at + session 종료 신호 | ADR-0021 INV-0021-6 + ADR-0012 INV-0012-3/4 — **R2 진입 절대 금지**, 7d hard ceiling, 24h floor |
| `research_session` ephemeral | TTL 한정 | SQLite | 30d after `closed_at` | session close + age | 종료 안 된 세션은 보호 |
| Open-license dataset (versioned) | Replaceable but versioned | R2 `permitted_artifact/dataset/{publisher}/{vintage}/` | 무기한 hot 30d → IA | dataset_vintage `end_of_life` | EOL marked → 12mo grace → archive prefix로 이동 |
| Intermediate computation (regenerable) | Replaceable | local tmp | 24h | run completion | R2 진입 금지 |
| `metrics_*`, `evaluation_*`, `policy_learning_*` | 시간 가치 감쇠 | SQLite | rolling 12mo + monthly aggregated rollup | daily worker | raw row 12mo, aggregate 무기한 |

---

## 3. "No longer needed" 식별 기준 — trigger + 위험

| 기준 | Trigger 정의 | Action | 주요 위험 |
|---|---|---|---|
| **dossier hot tier — access count + last_accessed_at** | `last_accessed_at < now - 90d AND access_count < 2` (dossier export hot 한정) | tier transition (hot → IA), soft-delete 아님 | 사용량 낮은 long-tail 인용물 누락 — publication에 cited 되었는지 cross-check 필수 |
| **raw_cache TTL + LRU (per-item clamped)** | `fetched_at < now - clamp(ttl_override ?? ttl_ceiling, ttl_floor=24h, ttl_ceiling=7d)` OR `last_accessed_at < now - clamp(...)` (raw_cache_items 한정, ADR-0021 INV-0021-6) | hard-delete (local FS unlink + sqlite row delete) + `policy_decisions` 발행 | **7d hard ceiling**. `ttl_override` 는 24h~7d 범위로 강제 clamp, LRU idle window도 동일 clamped TTL을 따른다 (운영자 명시 override의 효과를 LRU에서도 honor — INV-0021-6 위반 차단). R2 진입 절대 금지 |
| **upstream snapshot supersedes** | 동일 `Source.id`에 newer `content_hash` snapshot가 등장 + 구 snapshot이 어떤 Claim/Dossier에도 cited 안 됨 | 구 snapshot collapse (canonical만 keep) | cited 여부 누락 시 5단계 trace 단절 |
| **claim retraction** | `Claim.status = retracted` + downstream Dossier 없음 | soft-delete + tombstone | retraction 자체가 evidence — 절대 hard-delete 금지, tombstone 영구 |
| **scenario_revisions 상위 버전** | head revision N에 대해 N-6 이하 revision | collapse (delta만 keep) | 외부 발간된 revision은 보호 (publication FK check) |
| **publication 정정 cascade** | corrected_by edge 도착 | 원본 + 정정본 모두 영구 보존, derived dossier flag만 stale | 정정 cascade 누락이 평판 리스크 |
| **content_hash dedupe** | 동일 hash 2+ ref, ref_count 추적 가능 | canonical만 R2 keep, 나머지는 graph reference만 | ref_count 경쟁 조건 — write 시 mutex 또는 monotonic counter |
| **dataset_vintage EOL** | `dataset_vintage.end_of_life IS NOT NULL AND now > end_of_life + 12mo` | archive prefix 이동, hot 삭제 | EOL이 분석 사용 중인 dataset에 잘못 마킹되면 5+1 trace fail |
| **research_session closed + age** | `closed_at < now - 30d AND no_unresolved_question` | hard-delete | unresolved Q가 있는 세션 보호 누락 |

---

## 4. R2 lifecycle rule 초안

R2는 prefix별 lifecycle rule (최대 1000개) 을 지원하고, age-based expire/transition을 native로 처리한다. Standard → Infrequent Access (IA) transition 가능 (단, 역방향 불가, 30d minimum storage 의무).

```
bucket: kwm-permitted-artifacts

prefix                                            lifecycle action
-----------------------------------------------------------------------
backups/neo4j/{YYYY-MM-DD}/                       expire after 30d
backups/sqlite/{YYYY-MM-DD}/                      expire after 90d
audit/jsonl/{YYYY-MM}/                            transition to IA after 365d  (절대 expire 없음)
permitted_artifact/dataset/{publisher}/{vintage}/  transition to IA after 30d  (expire 없음, EOL 시 batch job이 archive prefix로 copy 후 delete)
permitted_artifact/dataset-archive/{publisher}/{vintage}/  IA from start, expire 없음
permitted_artifact/derived/snapshot/{source_id}/{date}/    transition to IA after 365d, expire 없음 (batch가 supersede 시 처리)
permitted_artifact/derived/dossier/{id}/          transition to IA after 365d, expire 없음
permitted_artifact/derived/publication/{id}/      transition to IA after 730d, expire 절대 없음
permitted_artifact/evidence-pack/{publication_id}/  transition to IA after 365d, expire 없음
tmp/multipart/                                    abort incomplete multipart after 7d (R2 default)
```

설계 의도:
- **expire는 backup 2종 + tmp multipart뿐**. 그 외에는 lifecycle = transition only. "지우는 결정"은 100% application batch job 책임.
- IA transition은 `0.015 → 0.01 USD/GB·mo` 절감하나 retrieval fee `0.01 USD/GB` + 30d min duration → publication preflight retroactive verification은 1회/년 미만일 것으로 보고 IA가 합리.
- audit export, publication, access_interventions 관련 prefix는 **expire rule을 절대 만들지 않는다**.

---

## 5. Batch job 책임 분담 (lifecycle이 못 잡는 부분)

R2 lifecycle = age + prefix만 본다. 의미적 기준 (cited 여부, retraction, supersede, dedupe, EOL) 은 application batch가 처리.

### 5.1 일간 batch: `retention_daily.py` (의사코드)

```python
def daily_retention_job(now):
    # 1. raw_cache_items TTL evict (OPS-1A.4)
    # ADR-0021 INV-0021-6: TTL 24h~7d, ttl_override는 이 범위 내에서만 honor.
    expire_raw_cache(now,
                     ttl_floor=timedelta(hours=24),
                     ttl_ceiling=timedelta(days=7))
    # finalize/abandon 즉시 삭제는 session 종료 hook에서 동기 호출되며
    # 본 batch와 별도. (delete_raw_cache_on_session_finalize 참조)

    # 2. research_session GC
    expire_research_sessions(now, age_after_close=timedelta(days=30),
                             require_no_unresolved_questions=True)

    # 3. tmp computation purge
    purge_local_tmp(now, ttl=timedelta(hours=24))


def expire_raw_cache(now, ttl_floor, ttl_ceiling):
    """
    ADR-0021 INV-0021-6 enforcement:
      - per-item ttl_override must be clamped to [ttl_floor, ttl_ceiling]
        (24h ~ 7d). NULL override → ttl_ceiling 적용.
      - fetched_at 기반 hard ceiling = absolute age 만료.
      - LRU last_accessed_at 기반 evict = idle window. idle window 도
        per-item clamped effective_ttl 을 따른다 — ttl_override 가 7d 이면
        7d 미접근 시 evict, NULL/default 이면 ttl_ceiling(7d) 미접근 시
        evict. ttl_floor(24h) 를 idle window 로 쓰면 명시 override 가
        무력화되므로 금지.
      - finalize/abandon 즉시 삭제는 본 batch 밖에서 처리됨.
    """
    rows = sqlite.query("""
        SELECT id, cache_key, fetched_at, last_accessed_at, ttl_override
        FROM raw_cache_items
        WHERE
            -- per-item TTL on fetched_at (clamped to floor..ceiling):
            -- absolute age hard ceiling
            fetched_at < ? - MIN(MAX(COALESCE(ttl_override, ?), ?), ?)
            -- LRU on last_accessed_at: idle window = same clamped
            -- effective_ttl. 운영자 명시 ttl_override 의 효과를 LRU 에서도
            -- honor (INV-0021-6 의 per-item TTL 의미 보존)
            OR last_accessed_at < ? - MIN(MAX(COALESCE(ttl_override, ?), ?), ?)
    """, [
        now,
        ttl_ceiling,  # fetched_at: default if no override
        ttl_floor,    # fetched_at: lower clamp
        ttl_ceiling,  # fetched_at: upper clamp (hard ceiling)
        now,
        ttl_ceiling,  # last_accessed_at: default if no override
        ttl_floor,    # last_accessed_at: lower clamp
        ttl_ceiling,  # last_accessed_at: upper clamp (hard ceiling)
    ])
    for r in rows:
        # raw 파일은 local FS only (R2 진입 금지 INV-0012-3/4)
        os.unlink(local_path(r.cache_key))
        sqlite.execute("DELETE FROM raw_cache_items WHERE id = ?", [r.id])
        effective_ttl = clamp(r.ttl_override or ttl_ceiling, ttl_floor, ttl_ceiling)
        emit_policy_decision(
            kind="raw_cache_evict", target=r.id,
            reason="ttl_expired",
            evidence={
                "last_accessed_at": r.last_accessed_at,
                "fetched_at": r.fetched_at,
                "effective_ttl": effective_ttl,
                "ttl_override": r.ttl_override,
            },
        )


def delete_raw_cache_on_session_finalize(session_id, reason):
    """
    research_session.finalize() 또는 abandon() 호출 시 동기 실행.
    ADR-0021 INV-0021-6: finalize/abandon 즉시 삭제 의무.
    """
    rows = sqlite.query(
        "SELECT id, cache_key FROM raw_cache_items WHERE session_id = ?",
        [session_id],
    )
    for r in rows:
        os.unlink(local_path(r.cache_key))
        sqlite.execute("DELETE FROM raw_cache_items WHERE id = ?", [r.id])
        emit_policy_decision(
            kind="raw_cache_evict", target=r.id,
            reason=f"session_{reason}",  # session_finalize / session_abandon
            evidence={"session_id": session_id},
        )
```

### 5.2 주간 batch: `retention_weekly.py`

```python
def weekly_retention_job(now):
    # 1. snapshot supersede collapse
    collapse_superseded_snapshots(now, grace=timedelta(days=365),
                                  protect_if_cited=True)

    # 2. content_hash dedupe canonical 확보
    dedupe_canonical_collapse()

    # 3. scenario/thesis revision collapse (N>5 → delta only)
    collapse_revision_history(keep_head=1, keep_recent=5)


def collapse_superseded_snapshots(now, grace, protect_if_cited):
    # newer fingerprint same source → 구 snapshot 정리
    candidates = neo4j.query("""
        MATCH (old:Snapshot)<-[:SNAPSHOT_OF]-(s:Source)-[:SNAPSHOT_OF]->(new:Snapshot)
        WHERE old.fingerprint_at < new.fingerprint_at - duration($grace)
        AND NOT EXISTS { MATCH (c:Claim)-[:CITES]->(old) }
        AND NOT EXISTS { MATCH (p:Publication)-[:CITES]->(old) }
        RETURN old
    """, grace=grace)
    for snap in candidates:
        soft_delete(snap, reason="superseded_by_newer_fingerprint")
        # R2 derived/snapshot/{source_id}/{date}/  → archive prefix 이동
```

### 5.3 월간 batch: `retention_monthly.py`

```python
def monthly_retention_job(now):
    # 1. dataset_vintage EOL processing
    archive_eol_datasets(now, grace_after_eol=timedelta(days=365))

    # 2. metrics/evaluation rollup → aggregate, raw 12mo expire
    rollup_metrics(window="monthly")

    # 3. JSONL audit export
    export_audit_jsonl(now)  # to R2 audit/jsonl/{yyyy-mm}/

    # 4. publication 정정 cascade integrity check
    verify_publication_correction_links()

    # 5. tombstone GC report (NEVER hard-delete tombstones)
    report_tombstone_count_by_kind()
```

핵심 패턴: **모든 delete는 soft-delete → tombstone (graph node `:Tombstone` + reason + 14d grace) → hard-delete**. 2단계 사이에 `policy_decisions` row 1개씩 발행.

---

## 6. Recovery / audit 보존 의무 — 절대 GC 금지 목록

| 항목 | 근거 | 보존 기간 |
|---|---|---|
| `Publication` 노드 + `derived/publication/{id}/` R2 객체 | 5+1 trace, INV-0014-7 | 무기한 |
| `AccessIntervention` ledger 전체 row | 법적 항변 evidence | 무기한 |
| `policy_decisions` SQLite + 월별 JSONL audit export | run ledger lineage | SQLite 12mo 핫 + R2 무기한 cold |
| `Claim` `status=retracted` tombstone | retraction 자체가 evidence | 무기한 |
| Publication에 cited된 `Snapshot` | preflight 5-check retroactive verify | 무기한 (cited flag로 lock) |
| `dataset_vintage` row (EOL 처리 후에도 metadata만) | 인용된 vintage의 재현성 | 무기한 (raw blob은 archive prefix에서 IA로) |
| `Tombstone` 노드 전체 | "what was deleted, when, why" 자체가 audit artifact | 무기한 |

운영 안전장치:
- batch job은 위 목록의 entity에 대해 `--dry-run` default. hard-delete는 explicit confirm flag (`--allow-delete-protected=false`).
- nightly integrity check: 각 `Publication`에 대해 cited `Snapshot` 모두 reachable 한지 verify. fail → alert.

---

## 7. Cost 시뮬레이션 (1년 boundary, R2 2026 pricing 기준)

가정 (1인 운영자, 보수적 상한):
- Snapshot fingerprint: 일 50건 × 평균 50 KB = 2.5 MB/일 → **0.9 GB/년**
- Dossier export: 주 5건 × 평균 200 KB = 1 MB/주 → **52 MB/년**
- Publication: 월 8건 × 평균 500 KB (PDF + JSON) → **48 MB/년**
- EvidencePack: publication 1건당 평균 2 MB → **192 MB/년**
- Neo4j dump: 일 1건 × 평균 200 MB × 30d retention = **6 GB rolling**
- SQLite snapshot: 일 1건 × 평균 50 MB × 90d retention = **4.5 GB rolling**
- JSONL audit export: 월 1건 × 평균 20 MB = **240 MB/년**
- Open-license dataset cache: 누적 **30 GB/년** 가정 (큰 가정, 보수적 상한)

**1년 누적 R2 storage**: 30 + 6 + 4.5 + 0.9 + 0.05 + 0.05 + 0.19 + 0.24 ≈ **42 GB**

**월 비용 추정**:
- Standard storage (42 GB × USD 0.015/GB) = **USD 0.63/월**
- IA transition 후 (publication+evidence+dossier+audit 약 0.7 GB × 0.01) → 사실상 변화 없음
- Class A operations (writes): 일 ~100건 × 30일 = 3,000건/월 → 0.003M × USD 4.50 = **USD 0.014/월**
- Class B operations (reads, preflight 등): 월 1,000건 가정 → **USD 0.0004/월**
- **합계 약 USD 0.65/월, 연 USD 8** (egress=0 덕)

**Boundary 시나리오** (dataset cache가 폭증해서 100 GB):
- Standard 100 GB × 0.015 = USD 1.50/월
- IA transition 후 cold portion 80 GB × 0.01 + hot 20 × 0.015 = **USD 1.10/월**

→ **1인 운영자 부담은 1년 USD 10~20 수준**. R2 free tier 10 GB도 거의 1차년도 backup만 쓰면 흡수 가능.

---

## 8. Sweet-spot 추천

**1인 운영, audit 강함, 비용 합리** 기준 권장 정책:

1. **R2 lifecycle은 단 3개 expire rule만 둔다**: `backups/neo4j/` 30d, `backups/sqlite/` 90d, `tmp/multipart/` 7d.
2. **모든 의미적 GC는 batch job**. 일/주/월 cadence 3개 cron.
3. **soft-delete + tombstone + 14d grace + policy_decisions log**를 모든 delete 경로의 기본 패턴.
4. **항상 보존 목록은 코드에 list로 박고 batch job에서 reject**. 단일 `RETENTION_PROTECTED_KINDS` 상수.
5. **IA transition은 1년 이상 cold-ish data만**. retrieval cost 미미해서 retroactive verification에 부담 없음.
6. **raw_cache_items는 R2 진입 절대 금지** (ADR-0012). local FS + SQLite metadata only, **TTL 24h~7d 범위 (ADR-0021 INV-0021-6)** — ttl_override는 이 범위로 clamp, fetched_at hard ceiling + last_accessed_at LRU 둘 다 같은 clamped effective_ttl 을 사용 (ttl_floor 를 LRU idle window 로 쓰면 명시 override 가 무력화됨 — 금지), finalize/abandon 시 동기 즉시 삭제.
7. **Q-027 lock 권장값** (변경 없음, 추가 명시): Neo4j dump 30d + SQLite 90d + JSONL audit 1y hot → 무기한 IA + derived publication 무기한 + dataset versioned + EOL grace 12mo.
8. **연 1회 retention drill**: 임의 publication 하나 골라서 5+1 trace 전부 reachable한지 수동 verify. 깨지면 batch 정책 재검토.

---

## 9. Open question / 추가 사용자 결정 필요

1. **Q-A**: `Snapshot` cited lock 판정의 시점 — 한 번 cited되면 영구 lock인가, 아니면 publication 자체가 retracted되면 unlock 가능한가? (retraction cascade의 의미적 기본값 필요)
2. **Q-B**: `metrics_*` raw row 12mo 보존 vs aggregated rollup — rollup 정밀도 (daily? weekly?) 사용자 선호 필요. evaluation reproducibility와 trade-off.
3. **Q-C**: JSONL audit export의 IA transition 시점 — 1년 후 vs 영구 Standard? 1인 운영자가 audit replay를 얼마나 자주 할 의향인지에 달림.
4. **Q-D**: `dataset_vintage` EOL 후 grace 12mo 이후 archive prefix로 옮긴 dataset의 최종 운명 — 무기한 IA vs 5년 후 delete? 5-10년 horizon 시나리오에서 어떤 빈티지가 다시 필요해질 가능성이 있는지.
5. **Q-E**: `raw_cache_items` TTL override의 floor/ceiling — ADR-0021 INV-0021-6은 24h~7d로 lock하나, default를 7d로 둘지 더 짧게(예: 48h)로 두고 운영자가 명시 override 시에만 7d까지 늘릴지. 분석 효율 vs 정책 보수성 trade-off.
6. **Q-F**: tombstone retention — 모든 tombstone을 무기한 보존하면 ledger가 빠르게 커진다. 10년 boundary에서 millions row 가능 → tombstone 자체에도 aggregate rollup 필요한가?
7. **Q-G**: R2 object versioning을 on/off 할 것인가? on이면 안전망이지만 추가 storage 비용 + lifecycle 동작이 noncurrent version에도 적용되어야 함.

---

## Sources

- [Object lifecycles — Cloudflare R2 docs](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare R2 Storage classes (Infrequent Access)](https://developers.cloudflare.com/r2/buckets/storage-classes/)
- [Introducing Object Lifecycle Management for Cloudflare R2 (Cloudflare blog)](https://blog.cloudflare.com/introducing-object-lifecycle-management-for-cloudflare-r2/)
- [Managing the lifecycle of objects — Amazon S3 docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [Audit deleted or missing objects from an Amazon S3 bucket — AWS re:Post](https://repost.aws/knowledge-center/s3-audit-deleted-missing-objects)
- [How to Build an Immutable Audit Log Pipeline (OneUptime, 2026-02)](https://oneuptime.com/blog/post/2026-02-06-immutable-audit-log-pipeline-otel/view)
- [Immutable Audit Trails: A Complete Guide (Hubifi)](https://www.hubifi.com/blog/immutable-audit-log-basics)
- [The Right To Be Forgotten vs Audit Trail Mandates (Axiom)](https://axiom.co/blog/the-right-to-be-forgotten-vs-audit-trail-mandates)
- [GDPR Data Retention: Long-Term Storage Compliance Explained (Archon)](https://www.archondatastore.com/blog/gdpr-data-retention/)
- [Neo4j — Backup and restore planning](https://neo4j.com/docs/operations-manual/current/backup-restore/planning/)
- [Cache Eviction Policies (Codecademy)](https://www.codecademy.com/article/cache-eviction-policies)
- [Staying out of TTL hell (Cal Paterson)](https://calpaterson.com/ttl-hell.html)
- [The Logic of Physical Garbage Collection in Deduplicating Storage (USENIX FAST'17)](https://www.usenix.org/system/files/conference/fast17/fast17-douglis.pdf)
