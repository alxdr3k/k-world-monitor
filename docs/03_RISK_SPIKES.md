# 03 Risk Spikes

기술 가정을 실험으로 검증하는 짧은 탐색 작업.

## How to use

- PRD의 ASM-### 중 결과에 큰 영향을 주는 가정 → SPIKE-###로 승격.
- Spike는 시간 박싱 (예: 1~3일). 결과는 여기에 기록.
- 결과가 결정으로 굳어지면 `08_DECISION_REGISTER.md` 또는 ADR로 옮긴다.

## Spikes

### SPIKE-001: Neo4j Community + native FTS가 1만 graph object 시점에서 NFR-001 (검색 < 1초 p95) 충족하는가

- Hypothesis: self-host Neo4j Community Edition + native FTS(Lucene) + 적절한
  index policy로 Claim 1만 건 + Snapshot 1만 건 + Source/Document/Edge 부수
  fixture 위에서 단일 keyword 검색 + 1-hop traversal이 cold-cache p95 1s
  이하에서 수렴한다 (PRD ASM-004, ADR-0012/0014).
- Owner: user
- Time-box: 2~3일
- Start / End: TBD
- Status: open
- Note: 본 spike는 2026-05-11 reset(DEC-003)에서 SQLite+FTS5에서 Neo4j +
  native FTS로 대상 갱신됨. ADR-0007 Alternative D ("Neo4j discarded")는
  ADR-0013/0014로 supersede.

**Experiment**

- 1만 graph object 합성 fixture 생성:
  - Claim 1만 건 (한국어 body 200~400자) + Snapshot 1만 건 (fingerprint
    record) + Source 72+ (size cap 폐기 — DEC-009 reflow, v0 entry 72 in `docs/research/source-seed-list-2026-05.md`) + Document 1만 + Edge 1.5만 (평균 1.5 edges/claim)
- Neo4j schema: native FTS index on Claim.body / Snapshot.body /
  Dossier.summary / Thesis.body
- 검색 쿼리 3종:
  - (a) keyword FTS — `CALL db.index.fulltext.queryNodes("claim_fts",
    "keyword") YIELD node, score`
  - (b) FTS + claim_status filter — `MATCH (c:Claim) WHERE c.claim_status =
    'confirmed' AND ... RETURN c LIMIT 50`
  - (c) FTS + 1-hop edge traversal — `MATCH (c:Claim)-[:SUPPORTS|:CONTRADICTS]->
    (target) WHERE ... RETURN c, target`
- bench: 50 cold-cache 쿼리 p95, p99 측정 (3 query type 각각)
- Neo4j Community Edition standard config (heap 2-4G), APOC + GDS plugin

**Result**

(미실행)

**Decision / Next Step**

- 충족 시: ADR-0012 INV-0012-1 + ADR-0014 INV-0014-3 + NFR-001 lock,
  INFRA-1A.2 slice 진행
- 미충족 시:
  - native FTS index analyzer 재검토 (한국어 tokenizer)
  - Neo4j heap / cache config 튜닝
  - graph object 분할 (Claim → Statement sub-node 등) 재검토
  - 마지막 수단: ADR-0014 native vector index(v1 도입 시점) 또는 외부
    full-text search (Meilisearch) 검토 — ADR-0012/0014 supersede
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
