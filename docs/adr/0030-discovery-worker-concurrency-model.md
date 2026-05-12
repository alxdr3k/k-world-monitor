---
id: adr-0030
type: adr
title: Discovery Worker 동시성 모델 — 바운드 풀 / 호스트 레이트리밋 / SQLite 직렬화 / Neo4j 풀 설정
status: accepted
created_at: 2026-05-12
updated_at: 2026-05-12
deciders: [user]
supersedes: []
superseded_by: []

scope:
  in:
    - pipeline.discovery_layer
    - pipeline.discovery_layer.tier_a
    - pipeline.discovery_layer.active_polling_filter
    - storage.sqlite
    - storage.neo4j
  out:
    - pipeline.extraction_layer
    - storage.r2

invariants:
  - id: INV-0030-1
    statement: |
      Discovery worker 의 동시 outbound fetch 수는 전역 세마포어(bounded concurrency pool)로
      제한한다. 초기 상한: 전역 8, 호스트당 1. 이 값은 `DISCOVERY_MAX_CONCURRENCY`
      (기본 8) / `DISCOVERY_MAX_PER_HOST` (기본 1) 환경변수로 조정 가능.
      `Promise.all(sources.map(fetch))` 방식의 무제한 병렬 fetch 금지.
    status: active
  - id: INV-0030-2
    statement: |
      SQLite write 는 event loop 에서 직렬화된다. Discovery fetch 와 SQLite write 를
      같은 async task 안에서 섞으면 안 된다.
      패턴: fetch 작업은 진짜 async (네트워크 바운드), write 작업은 fetch 완료 후
      별도 직렬 큐로 처리. 단일 SQLite 트랜잭션은 50ms 초과 불가 — 트랜잭션 안에서
      네트워크 I/O, LLM 호출, R2 호출 금지.
    status: active
  - id: INV-0030-3
    statement: |
      Neo4j 연결 풀 크기와 획득 타임아웃은 환경변수로 설정 가능해야 한다.
      기본값: `NEO4J_MAX_POOL_SIZE=10`, `NEO4J_ACQ_TIMEOUT_MS=5000`.
      `src/storage/neo4j/connection.ts` 의 하드코딩 값을 환경변수로 교체한다 (DEC-016).
      poolSize 소진 시 `withSession()` 에서 `Neo4jPoolExhaustedError` 를 구조화 로그에 기록한다.
    status: active
  - id: INV-0030-4
    statement: |
      모든 Discovery fetch 작업은 `AbortSignal` 타임아웃을 가져야 한다.
      기본 타임아웃: `DISCOVERY_FETCH_TIMEOUT_MS` (기본 30_000ms).
      타임아웃 시 해당 소스는 `crawl_state.last_status = "timeout"` 으로 기록하고
      `consecutive_failures` 카운터를 증가시킨다. 연속 5회 실패 시 해당 소스를
      24시간 backoff (`next_eligible_at = now + 24h`).
    status: active
  - id: INV-0030-5
    statement: |
      `crawl_state` SQLite 테이블이 INFRA-1B.2b 에서 마이그레이션으로 추가된다.
      필수 컬럼: `source_id PK`, `last_polled_at`, `last_etag`, `last_modified_header`,
      `last_status`, `consecutive_failures`, `next_eligible_at`.
      Discovery worker 는 `next_eligible_at IS NULL OR next_eligible_at <= now` 인
      소스만 폴링 대상으로 선택한다.
    status: active

preconditions:
  - id: PRE-0030-1
    statement: |
      DEC-015 (runtime `CREATE TABLE IF NOT EXISTS` 금지) 가 먼저 적용되어야 한다.
      `crawl_state` 테이블은 `migrations/sqlite/v3_crawl_state.sql` 로 추가된다.
  - id: PRE-0030-2
    statement: |
      DEC-014 (`PRAGMA busy_timeout=5000`) 가 `getDb()` 에 적용되어 있어야 한다.

defines:
  - term: crawl_state
    role: primary
  - term: bounded-concurrency-pool
    role: primary

touches:
  - id: adr-0016
    relation: complies
    rationale: INV-0030-1 의 호스트당 1 동시 요청 제한은 ADR-0016 의 collectability/anti_bot_friction 정책과 정합
  - id: adr-0023
    relation: complies
    rationale: Discovery fetch 결과가 extraction layer 로 전달될 때 DEC-013 의 daily_candidate_item_count cap 과 연동

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - source
  - snapshot
reviewed_scopes:
  - pipeline.discovery_layer
  - storage.sqlite
  - storage.neo4j
---

# ADR-0030: Discovery Worker 동시성 모델

## Context

Opus 아키텍처 리뷰 (2026-05-12) Q1/Q2/Q3 종합:

**Q1** — 현재 codebase 에 동시성 프리미티브가 없다. `Promise.all(72 sources)` 는
72개 동시 outbound fetch → anti-bot 트리거, rate limit 위반 (ADR-0016 INV-0016-1).

**Q2** — `bun:sqlite` 는 동기적이고 event loop 을 블로킹한다. 단일 프로세스 내에서
여러 async task 가 SQLite write 를 호출할 때 JS 단일 스레드 특성상 실제 경쟁은
없지만, 긴 트랜잭션이 모든 네트워크 I/O 를 블로킹한다. 멀티 프로세스 시나리오
(worker 분리)에서는 `SQLITE_BUSY` 가 발생할 수 있으며 현재 `busy_timeout` 이 없다.

**Q3** — `src/storage/neo4j/connection.ts:14` 의 `maxConnectionPoolSize: 10` 가
하드코딩되어 있다. 72개 병렬 worker 가 `withSession()` 을 호출하면 11번째부터
5초 타임아웃 후 실패한다.

**추가** — `crawl_state` 테이블이 없어 etag / Last-Modified 기반 조건부 fetch 가
불가하며 매 폴링마다 전체 feed 를 재다운로드해야 한다.

## Decision

### 1. 전역 바운드 세마포어 (INV-0030-1)

```typescript
// src/discovery/worker/pool.ts (계약 스케치)
import { Semaphore } from "..";  // 또는 inline implementation

const globalPool = new Semaphore(
  parseInt(process.env["DISCOVERY_MAX_CONCURRENCY"] ?? "8")
);
const perHostPool = new Map<string, Semaphore>(); // per-hostname

export async function fetchWithPool(url: string, opts: SafeFetchOptions) {
  const host = new URL(url).hostname;
  const hostSem = perHostPool.get(host) ?? new Semaphore(
    parseInt(process.env["DISCOVERY_MAX_PER_HOST"] ?? "1")
  );
  perHostPool.set(host, hostSem);
  await globalPool.acquire();
  await hostSem.acquire();
  try {
    return await safeFetch(url, opts);  // ADR-0028
  } finally {
    hostSem.release();
    globalPool.release();
  }
}
```

### 2. fetch / write 분리 패턴 (INV-0030-2)

```
[Discovery scheduler]
  → batched fetch phase (all async, network-bound, ≤ DISCOVERY_MAX_CONCURRENCY)
  → serial write phase (SQLite upsert, no network I/O inside transaction)
```

긴 트랜잭션 금지 규칙: 트랜잭션 안에서 `fetch()`, LLM API 호출, R2 I/O 금지.
`docs/current/RUNTIME.md` 에 "event-loop hygiene" 섹션으로 문서화 (DEC-014/015 follow-up).

### 3. Neo4j 풀 환경변수화 (INV-0030-3)

`src/storage/neo4j/connection.ts` 수정:
```typescript
maxConnectionPoolSize: parseInt(process.env["NEO4J_MAX_POOL_SIZE"] ?? "10"),
connectionAcquisitionTimeout: parseInt(process.env["NEO4J_ACQ_TIMEOUT_MS"] ?? "5000"),
```

### 4. crawl_state 마이그레이션 (INV-0030-5)

`migrations/sqlite/v3_crawl_state.sql` 추가 (INFRA-1B.2b slice).

## Rationale

- 바운드 세마포어는 가장 단순한 동시성 제어 프리미티브 — 외부 의존성 없이 구현 가능
- fetch/write 분리는 async 코드의 event-loop 블로킹을 구조적으로 방지
- crawl_state 테이블은 etag/LM 지원으로 불필요한 재다운로드를 제거 (bandwidth + cost)
- Neo4j 풀 환경변수화는 운영 조정 없이 코드 변경이 가능

## Consequences

- 긍정:
  - 72개 소스 동시 fetch → anti-bot 트리거 위험 제거
  - SQLite 트랜잭션이 항상 짧아져 event loop 블로킹 최소화
  - Neo4j 풀 소진 시 운영자가 env 조정 가능 (재배포 불필요)
  - crawl_state 로 조건부 fetch → 대역폭 절감
- 부정:
  - Semaphore 구현 추가 (또는 `p-limit` 의존성 추가) 필요
  - fetch/write 분리 패턴이 구현 복잡도 증가 — 명시적 batch 단위 필요
- Follow-ups:
  - DEC-014 — busy_timeout PRAGMA
  - DEC-015 — 마이그레이션 규율 (source_registry_slug_map 이전)
  - DEC-016 — Neo4j 풀 설정 환경변수화
  - Slice `INFRA-1B.2b` — crawl_state migration + scheduler
  - docs/current/RUNTIME.md event-loop hygiene 섹션 추가 (OPS slice)

## References

- Opus 아키텍처 리뷰 Q1/Q2/Q3 (2026-05-12, session_01DrSftZd3mZv3GYwUA2Dmg2)
- ADR-0016 (collectability / polite-crawl 정책)
- DEC-013 (active source cap 20/일)
