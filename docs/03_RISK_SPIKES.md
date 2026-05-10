# 03 Risk Spikes

기술 가정을 실험으로 검증하는 짧은 탐색 작업.

## How to use

- PRD의 ASM-### 중 결과에 큰 영향을 주는 가정 → SPIKE-###로 승격.
- Spike는 시간 박싱 (예: 1~3일). 결과는 여기에 기록.
- 결과가 결정으로 굳어지면 `08_DECISION_REGISTER.md` 또는 ADR로 옮긴다.

## Spikes

### SPIKE-001: SQLite + FTS5가 1만 건 시점에서 NFR-001 (검색 < 1초 p95) 충족하는가

- Hypothesis: SQLite + FTS5 + 적절한 인덱스 정책으로 claim 1만 건, snapshot 1만
  건 fixture 위에서 단일 keyword 검색이 cold-cache p95 1s 이하에서 수렴한다
  (PRD ASM-004).
- Owner: user
- Time-box: 2일
- Start / End: TBD
- Status: open

**Experiment**

- 1만 건 합성 fixture 생성 (claim body는 한국어 200~400자, snapshot 메타 + 5
  claim/snapshot 평균)
- 스키마: `claims_fts5(body, evidence_quote, snapshot_id, claim_status)` +
  `claims_meta(extraction_confidence, claim_status)` 보조
- 검색 쿼리: 키워드 + claim_status filter + reliability_tier join
- bench: 50 cold-cache 쿼리 p95, p99 측정

**Result**

(미실행)

**Decision / Next Step**

- 충족 시: ADR-0004 INV-0004-1 + NFR-001 그대로 lock, INFRA-1A.2 slice 진행
- 미충족 시:
  - chunking 정책 재검토 (chunk 단위를 claim에서 sentence로 좁히기)
  - duckdb / SQLite alternative 검토 (큰 변경 — ADR-0004 supersede)
- Follow-up: Slice `INFRA-1A.2`

---

### SPIKE-002: auto-confirm threshold (extraction_confidence ≥ 0.85) 보정

- Hypothesis: ADR-0006 INV-0006-4의 auto-confirm threshold 0.85는 reliability_tier=
  high 출처에서 false-positive 비율 ≤ 5%를 유지한다 (수용 가능 fp율).
- Owner: user
- Time-box: 1일 + 50건 reviewer 비교
- Start / End: TBD
- Status: open

**Experiment**

- 첫 50건 LLM 추출 결과를 reviewer가 직접 검증
- 각 claim에 대해: 자동 confirm 됐을 때 정확/오류 라벨링
- threshold 0.80 / 0.85 / 0.90 시뮬레이션 (false-positive vs reviewer queue 부담)

**Result**

(미실행)

**Decision / Next Step**

- fp ≤ 5% 충족: 0.85 lock, ADR-0006 INV-0006-4 그대로
- fp > 5%: threshold 상향(0.90) → reviewer 부담 증가 trade-off 평가, ADR-0006
  supersede 검토
- fp ≪ 5%: threshold 하향(0.80) 검토
- Follow-up: Slice `INFRA-1B.1` (extractor 1차 구현 직후)

---

### SPIKE-003: prompt caching cache hit rate가 비용 모델 유지

- Hypothesis: Anthropic prompt caching이 system prompt + extractor schema를
  cache prefix로 잡았을 때 cache hit rate ≥ 70% (claim 추출 일일 batch 기준)
  으로 NFR-004 비용 상한을 만족한다.
- Owner: user
- Time-box: 1일 (batch 1회 측정)
- Start / End: TBD
- Status: open

**Experiment**

- system prompt + extractor schema (≥ 1024 tokens)을 cached prefix로 구성
- 100~500 snapshot batch 1회 실행
- run ledger의 cached_tokens / tokens_in 비율 측정

**Result**

(미실행)

**Decision / Next Step**

- ≥ 70%: ADR-0006 prompt caching 정책 lock
- < 70%: prompt 구조 재설계 (system 더 크게 / extractor 안정화) 또는 cache TTL
  내 batch 빈도 조정
- Follow-up: Slice `INFRA-1B.2`
