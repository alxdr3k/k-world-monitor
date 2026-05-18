---
id: adr-0028
type: adr
title: Safe-Fetch — SSRF / Redirect / Size / TLS / robots.txt 방어 계층 (Discovery Layer)
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
    - pipeline.policy.no_bot_bypass
    - storage.r2.permitted_artifacts
  out:
    - pipeline.extraction_layer
    - pipeline.aggregation_layer

invariants:
  - id: INV-0028-1
    statement: |
      Discovery worker 의 모든 outbound HTTP 요청은 `safe-fetch` 모듈을 통해야 한다.
      `fetch()` 직접 호출은 `src/discovery/` 및 `src/extraction/` 내에서 금지.
      safe-fetch 계약: scheme 허용목록(`https:` 기본 / `http:` 운영자 per-source opt-in),
      DNS pre-resolve + 사설/루프백/링크로컬 IP 거부, 리다이렉트 체인 ≤ 3 홉 + 매 홉 호스트
      재검증, `AbortSignal` 타임아웃 의무, 압축 해제 바이트 상한 의무.
    status: active
    cross_ref_code:
      - src/discovery/fetch/safe-fetch.ts:safeFetch
  - id: INV-0028-2
    statement: |
      SSRF 방어: safe-fetch 는 DNS 조회 결과가 RFC1918 사설 범위
      (10.x, 172.16–31.x, 192.168.x), 루프백(127.x, ::1), 링크로컬(169.254.x, fe80::/10),
      멀티캐스트, 메타데이터 주소(169.254.169.254)인 경우 요청을 즉시 거부하고
      `SsrfBlockedError` 를 throw 한다. `file:`, `data:`, `ftp:` 스킴도 거부한다.
    status: active
    cross_ref_code:
      - src/discovery/fetch/safe-fetch.ts:safeFetch
  - id: INV-0028-3
    statement: |
      리다이렉트 체인 방어: safe-fetch 는 `redirect: "manual"` 로 직접 핸들링한다.
      각 리다이렉트 홉에서 대상 호스트가 source 허용 목록(`source_material_policy`)에
      등록된 도메인 또는 운영자 승인 CDN 목록에 있는지 재검증한다.
      scheme downgrade(https → http) 가 발생하면 즉시 거부한다. 3홉 초과 시 거부.
    status: active
    cross_ref_code:
      - src/discovery/fetch/safe-fetch.ts:safeFetch
  - id: INV-0028-4
    statement: |
      바이트 상한: 컨텐츠 종류별 최대 허용 크기(압축 해제 기준)는 DEC-017에서 정의한다.
      safe-fetch 는 `Content-Length` 사전 검사 + 스트리밍 바이트 카운터로 상한을 강제한다.
      상한 초과 시 연결을 즉시 끊고 `BodyTooLargeError` 를 throw 한다.
      zip bomb 방어: 압축 해제 중 decompressed / compressed 비율이 100:1 초과 시 중단.
    status: active
    cross_ref_code:
      - src/discovery/fetch/safe-fetch.ts:safeFetch
  - id: INV-0028-5
    statement: |
      robots.txt 준수: ADR-0016 INV-0016-1 ("no bot bypass") 의 코드 레벨 구현.
      safe-fetch 는 각 호스트에 대해 robots.txt 를 최초 폴링 시 1회 fetch 하고
      24시간 in-process 캐시에 보관한다. 폴링 URL 이 `Disallow` 규칙에 해당하면
      fetch 를 거부하고 `RobotsDisallowedError` 를 throw 한다.
      User-Agent 는 운영자 설정 값(기본 `k-world-monitor/1.0`)을 사용한다.
    status: active
    cross_ref_code:
      - src/discovery/fetch/safe-fetch.ts:safeFetch
  - id: INV-0028-6
    statement: |
      컨텐츠 타입 검증: safe-fetch 는 응답 body 첫 512 바이트를 sniff 하여
      선언된 `Content-Type` 과 실제 컨텐츠 서명이 일치하는지 검증한다.
      RSS/Atom XML → `<?xml` 또는 `<rss` / `<feed` 접두사 필수.
      JSON API → `{` 또는 `[` 접두사 필수.
      실행 파일(ELF magic, PE header, Mach-O magic) 수신 시 즉시 거부.
    status: active
    cross_ref_code:
      - src/discovery/fetch/safe-fetch.ts:safeFetch

preconditions:
  - id: PRE-0028-1
    statement: |
      `src/discovery/fetch/safe-fetch.ts` 모듈이 INFRA-1B.2a 에서 구현되어야 한다.
      INFRA-1B.2 (Discovery worker) 는 이 모듈 없이 구현 금지.
  - id: PRE-0028-2
    statement: |
      `source_material_policy` 테이블의 `url` 및 `rss_url` 컬럼이 seed 시점에
      `new URL(...)` 파싱 + scheme 허용 검사를 통과해야 한다. `seed.ts` 에 URL
      유효성 검사 추가가 선행 조건 (INFRA-1B.1.x hotfix).

defines:
  - term: safe-fetch
    role: primary
  - term: SsrfBlockedError
    role: primary
  - term: BodyTooLargeError
    role: primary
  - term: RobotsDisallowedError
    role: primary

touches:
  - id: adr-0016
    relation: implements
    rationale: ADR-0016 INV-0016-1 "no bot bypass" 를 코드 레벨 safe-fetch 모듈로 구현
  - id: adr-0012
    relation: complies
    rationale: R2 raw_cloud_policy=always_prohibited 와 safe-fetch 바이트 제한 정합 — raw body 는 R2에 올리지 않으므로 safe-fetch 의 size cap 이 유일한 메모리 방어선

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
  - pipeline.policy.no_bot_bypass
  - storage.r2.permitted_artifacts
---

# ADR-0028: Safe-Fetch — SSRF / Redirect / Size / TLS / robots.txt 방어 계층

## Context

Opus 아키텍처 리뷰 (2026-05-12) Q4 결과: Discovery worker (INFRA-1B.2) 가 임의 웹
페이지를 fetch 할 때 다음 공격 클래스에 대한 방어가 **전혀** 설계/구현되어 있지 않다.

1. **SSRF** — URL 에 사설 IP, 루프백, 클라우드 메타데이터 엔드포인트 삽입 가능
2. **악의적 리다이렉트** — Tier A 허용 호스트가 off-allowlist 호스트로 리다이렉트 가능
3. **zip bomb / 무제한 body** — 10GB 응답으로 OOM 가능 (INV-0028-4 참조)
4. **Content-Type 스푸핑** — 실행 파일을 RSS/JSON 으로 위장 가능
5. **robots.txt 미준수** — ADR-0016 INV-0016-1 이 doc-only 로만 존재 (코드 없음)

`src/storage/r2/client.ts` 의 `checkPermittedPrefix()` 가 R2 write 레벨 방어를
제공하지만, 이는 raw body 가 메모리에 로드된 **이후** 에 작동한다. 메모리 소비 자체를
막으려면 fetch 단계에서 size cap 이 필요하다.

현재 fetch 레이어가 존재하지 않는 시점이므로, INFRA-1B.2 구현 **전**에 safe-fetch
계약을 ADR 로 lock 한다.

## Decision

`src/discovery/fetch/safe-fetch.ts` 모듈을 INFRA-1B.2a (선행 slice) 에서 구현한다.
이 모듈은 INV-0028-1 ~ INV-0028-6 의 모든 방어를 구현해야 하며,
Discovery worker 의 모든 outbound HTTP 요청은 이 모듈만을 통한다.

### safe-fetch 계약 (구현 명세)

```typescript
// src/discovery/fetch/safe-fetch.ts (계약 스케치)
export interface SafeFetchOptions {
  maxBytes: number;           // DEC-017 기준값
  timeoutMs: number;          // 기본 30_000
  allowHttp?: boolean;        // 기본 false; per-source opt-in
  userAgent?: string;         // 기본 "k-world-monitor/1.0"
}

export async function safeFetch(
  url: string,
  opts: SafeFetchOptions
): Promise<SafeFetchResponse>
// throws: SsrfBlockedError | BodyTooLargeError | RobotsDisallowedError | Error
```

### 방어 레이어 처리 순서

1. URL 파싱 + scheme 허용 검사 (INV-0028-2)
2. DNS pre-resolve + 사설/루프백 IP 거부 (INV-0028-2)
3. robots.txt 캐시 조회 + Disallow 검사 (INV-0028-5)
4. `fetch()` 호출 with `redirect: "manual"`, `AbortSignal.timeout(timeoutMs)`
5. 리다이렉트 발생 시 매 홉 호스트 재검증 + scheme downgrade 거부 (INV-0028-3)
6. `Content-Length` 사전 검사 (INV-0028-4)
7. 스트리밍 읽기 + 압축 해제 바이트 카운터 + zip bomb 비율 검사 (INV-0028-4)
8. body 첫 512바이트 content-type sniff (INV-0028-6)

## Rationale

- Discovery layer 가 없는 현재 시점에 ADR 로 계약을 선 lock 함으로써
  INFRA-1B.2 구현자(LLM/사람)가 방어를 빠뜨리지 않도록 강제한다.
- safe-fetch 를 독립 모듈로 캡슐화하면 테스트 doubles (mock DNS, mock redirect)
  로 단위 테스트가 가능하고, 추후 업그레이드 시 caller 변경 없이 교체 가능.
- robots.txt 준수는 ADR-0016 INV-0016-1 의 코드 레벨 구현 — doc-only 상태에서
  code-enforced 상태로 격상.

## Consequences

- 긍정:
  - SSRF, redirect, size, robots 방어 4종이 단일 진입점에서 강제됨
  - ADR-0016 INV-0016-1 이 실제 코드로 구현됨
  - safe-fetch 없이는 INFRA-1B.2 구현 불가 → 방어 생략 불가
- 부정:
  - DNS pre-resolve 추가 왕복 지연 (~수 ms) — async 이므로 event loop 영향 없음
  - robots.txt fetch 비용 (1회/24h/호스트) — 캐시로 완화
  - allowlist 기반 리다이렉트 검증이 CDN 체인 있는 대형 미디어에서 false positive
    가능 → CDN 허용 목록을 별도 config 로 관리 필요
- Follow-ups:
  - Slice `INFRA-1B.2a` — safe-fetch.ts 구현 + 방어별 단위 테스트
  - Slice `INFRA-1B.1.x` — seed.ts URL 유효성 검사 (PRE-0028-2)
  - DEC-017 — 컨텐츠 종류별 maxBytes 값 결정

## References

- ADR-0016 (collectability / no_bot_bypass invariant)
- ADR-0012 (R2 raw_cloud_policy=always_prohibited)
- Opus 아키텍처 리뷰 Q4 (2026-05-12, session_01DrSftZd3mZv3GYwUA2Dmg2)
