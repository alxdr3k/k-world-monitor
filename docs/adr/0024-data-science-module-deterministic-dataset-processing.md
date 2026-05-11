---
id: adr-0024
type: adr
title: Data Science Module — deterministic dataset processing layer (parser + derived metric computer)
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
deciders: [user]
supersedes: []
superseded_by: []

scope:
  in:
    - pipeline.extraction_layer.dataset
    - pipeline.extraction_layer.derived_metric_computer
    - pipeline.dossier_composer.dataset_input
    - storage.sqlite.derived_metric_ledger
  out:
    - pipeline.extraction_layer.article_llm
    - pipeline.extraction_layer.report_llm
    - pipeline.dossier_composer.claim_llm_synthesis

invariants:
  - id: INV-0024-1
    statement: Dataset 입력은 LLM 에 직접 전달하지 않는다. 항상 Data Science Module 의 deterministic transform (cleaning / aggregation / derived metric 산출) 을 거친 후 LLM 호출 (있다면)으로 derived metric 만 입력. ADR-0006 INV-0006-2 (dataset extractor = parser only) 의 강화.
    status: active
  - id: INV-0024-2
    statement: derived_metric 산출은 reproducible — input `dataset_vintage_id` + transformation `spec_sha256` + library `version_lock_sha256` (uv.lock / pip freeze 등) 3-tuple 로 bit-exact 재현 가능해야 한다. 운영자가 6개월 후 같은 3-tuple 로 동일 결과를 얻지 못하면 분석 reproducibility (NFR-002) 위반.
    status: active
  - id: INV-0024-3
    statement: Data Science Module 의 transformation spec 은 코드(Python script / DuckDB SQL) 로 명시되며 vault 또는 이 repo `data/transforms/<spec_id>.{py,sql}` 에 commit. run_ledger 에 `spec_sha256` + `dataset_vintage_id` + `library_version_lock_sha256` 함께 기록 (ADR-0006 INV-0006-5 확장).
    status: active
  - id: INV-0024-4
    statement: 토큰 폭발 차단 — **1000 행 이상 dataset 또는 50KB 이상 raw payload 는 LLM 에 raw 로 전달 금지**. 항상 derived metric (예 통계 요약, time series feature, anomaly flag, top-K row, cohort breakdown) 또는 aggregate 로 압축 후 LLM 입력. 위반 시 extract pipeline assertion fail.
    status: active
  - id: INV-0024-5
    statement: derived_metric 자체가 Claim 의 evidence 가 될 수 있다 — 단 `extraction_provenance.method = "data_science_module"` + `spec_sha256` + `dataset_vintage_id` 명시 의무. cite check 5+1 의 stale / horizon mismatch 정책은 derived metric 의 underlying dataset_vintage 기준으로 적용.
    status: active

preconditions:
  - id: PRE-0024-1
    statement: Python 3.12+ runtime (Polars / DuckDB / statsmodels / scipy / pandas / numpy) 또는 bun + DuckDB native 가 self-host 가능. v0 entry stack 선택은 INFRA-1A.2 시점에 commit.
  - id: PRE-0024-2
    statement: `dataset_vintage` SQLite 테이블 (ADR-0011 R9/Q4, ADR-0012) 이 모든 fetched dataset 에 대해 vintage_date + observation_date + source_id + checksum 을 기록. Data Science Module 이 이를 입력으로 사용.
  - id: PRE-0024-3
    statement: derived_metric ledger 테이블 (SQLite) 신규 — `metric_id`, `spec_sha256`, `dataset_vintage_id`, `library_version_lock_sha256`, `computed_at`, `value_json`, `claim_id_fk` 컬럼. INFRA-1A.2 schema migration 에 포함.

defines:
  - term: data_science_module
    role: primary
  - term: derived_metric
    role: primary
  - term: transformation_spec
    role: primary

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
reviewed_terms:
  - claim
  - snapshot
  - dossier
  - reliability_tier
  - extraction_confidence
reviewed_scopes:
  - pipeline.extraction_layer.dataset
  - pipeline.aggregation_layer.dossier_composer
  - storage.sqlite.dataset_vintage
  - storage.sqlite.derived_metric_ledger
  - storage.sqlite.run_table.cost_ledger

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0024: Data Science Module — deterministic dataset processing layer

## Status

accepted — 2026-05-11

## Context

ADR-0006 INV-0006-2 는 "dataset extractor = parser only, LLM 미사용" 으로
lock 했다. 그러나 v0 실제 운영에서 발생하는 문제:

1. **Dataset 형식이 다양** — Fed FRED API 의 time series (수만 행) /
   World Bank Open Data API 의 multi-country panel / KOSIS 의 cross-tab /
   IEA 의 monthly oil balance / OECD CLI 의 composite index 등. 단순
   parser 로는 column rename + type coercion 만 가능, **인사이트 추출 안 됨**.
2. **LLM 에 raw dataset 전달은 토큰 폭발** — Fed FRED 의 CPI time series
   30년치 = ~360 행. World Bank 의 panel data = 수천 행. raw 전달 시 prompt
   token 폭발 + LLM 의 numerical reasoning 신뢰도 매우 낮음 (≥ 30% hallucination
   on time series arithmetic per recent benchmarks).
3. **데이터 클리닝 / 변환을 LLM 에 맡기면 일관성 / 신뢰도 ↓** — 같은
   dataset 을 같은 prompt 로 두 번 호출해도 다른 derived value 가 나옴.
   reproducibility (NFR-002) 위반.
4. **Dossier composer 가 dataset 인용 시 evidence locator 모호** — LLM 이
   "Fed CPI 2024-Q4 = 312.5" 라고 적으면 운영자가 그 숫자가 어디서 나왔는지
   재현하기 어려움.

본 ADR 은 **deterministic data science module 을 dataset 처리 layer 로
도입** — LLM 에 raw dataset 입력 금지, 항상 derived metric 으로 압축 후 LLM
호출. derived_metric 은 spec + vintage + library version 3-tuple 로
reproducible.

## Decision

### Layer 정의

```
Snapshot (dataset)
    │  (URL / API endpoint / file)
    ▼
Parser (ADR-0006 INV-0006-2 그대로)
    │  → typed DataFrame (Polars / DuckDB)
    │  → dataset_vintage row (SQLite)
    ▼
Data Science Module (신규, ADR-0024)
    │  transformation_spec (Python / SQL) 적용
    │   - cleaning (null, type, unit normalization)
    │   - aggregation (groupby / pivot / rolling window)
    │   - derived metric (YoY delta, M2 growth, ratio, z-score, anomaly flag,
    │                    cohort breakdown, time series decomposition)
    │  → derived_metric_ledger row (SQLite)
    │      + spec_sha256, dataset_vintage_id, library_version_lock_sha256
    ▼
LLM (선택적, Tier 2~3)
    │  입력 = derived metric value_json 또는 압축 요약
    │  출력 = Claim (statement + evidence)
    │      evidence.extraction_provenance.method = "data_science_module"
    │      evidence.extraction_provenance.spec_sha256 = ...
    ▼
Dossier / Scenario / Thesis 합성 단계
```

### transformation_spec 위치

- `data/transforms/<spec_id>.{py,sql}` (이 repo, INFRA-1A.6 ~ EXTR-1A.5
  slice 에서 누적 commit)
- 각 spec 은 single function `transform(df, params) -> derived_metric` 형식
- spec_sha256 = SHA256(spec 파일 본문). run_ledger 에 기록.

### Library stack lock (v0 entry, 2026-05-11 lock close)

**Lock 결정** (대안 5종 재검토 후 — A/B 섹션 참조):

| 도구 | 용도 | 버전 lock | 비고 |
|---|---|---|---|
| **Python** | runtime | 3.12.x | uv lock 의무 (PRE-0024-1 + INV-0024-2 reproducibility 3-tuple) |
| **Polars** | DataFrame primary | latest stable | Rust 기반 LazyFrame, pandas 대비 5~10x 빠름 + 메모리 효율 |
| **DuckDB** | SQL on parquet / CSV / API response | latest stable | embedded analytical DB, **R2 S3 native 지원** (httpfs extension) — R2 와 자연 정합 |
| **statsmodels** | time series (ARIMA / Granger causality / state-space / GARCH) | latest stable | macro / 계량경제 표준 라이브러리 |
| **scipy.stats** | distribution / hypothesis test / correlation | latest stable | |
| **numpy** | numerical primitive | latest stable | |
| **pandas** | **legacy compat 용으로만 유지** | latest stable | 신규 코드는 Polars 사용 — pandas 는 기존 외부 example / tutorial 호환만 |
| **jq** (Python `pyjq` 또는 CLI `jq`) | JSON 변환 (API response → row) | latest stable | |
| **uv** | Python 의존성 lock + 빠른 install | latest stable | `uv lock` → `library_version_lock_sha256` 산출 |

#### 대안 재검토 결과 (2026-05-11 lock close)

| 대안 stack | 결과 | 결정 근거 |
|---|---|---|
| **A. Polars + DuckDB + statsmodels + scipy (Python) — 본 ADR 권고** | **lock close** | Rust 기반 LazyFrame + R2 S3 native + macro/econ 통계 표준 + uv lock 으로 reproducibility 3-tuple 가능 |
| B. Polars JS + DuckDB Node + simple-statistics (100% bun, TypeScript) | reject | statsmodels 의 TS 동급 부재 (Granger / GARCH / state-space). simple-statistics basic only — macro 분석 부족 |
| C. R tidyverse + fable + forecast | reject | 1인 운영 학습 곡선 + LLM agent R 능숙도 ↓ + 3-stack 부담 (Python/TS/R) |
| D. Julia DataFrames.jl + StatsBase + StateSpaceModels | reject | 생태 빈약 + LLM agent 약함 |
| E. Pandas-only (legacy) | partial accept | Polars legacy compat 용으로만 유지 (신규 코드는 Polars) |
| F. DuckDB only (SQL-first, Python 통계 없이) | reject | 통계 분석 (ARIMA / GARCH) 부족 — statsmodels 없으면 macro/econ 분석 불가능 |

#### bun / TypeScript 메인 stack 과 hybrid

본 프로젝트의 메인 stack 은 bun + TypeScript 이고 Data Science Module 은
Python. hybrid 통신 방식 (subprocess invoke / Python REPL via stdio / bun-py
bridge) 의 최종 선택은 INFRA-1A.2 (Cypher schema + SQLite migration) commit
직전에 lock. 권장 default = **subprocess invoke (`bun spawn` → `python -m
transforms.<spec_id>` → stdin JSON / stdout derived metric JSON)**, derived
metric ledger row 는 SQLite 에 직접 INSERT (Python ↔ TypeScript 양쪽
read).

### Reproducibility 3-tuple

derived_metric 1건당 기록:
- `dataset_vintage_id` — 어떤 vintage (publish date + observation date) 의 dataset
- `spec_sha256` — 어떤 transformation spec 코드
- `library_version_lock_sha256` — 어떤 library 버전 (uv.lock / requirements.lock 의 sha256)

6개월 후 운영자가 동일 3-tuple 로 호출 → bit-exact 동일 결과.

### 1000 행 / 50KB 한도

- 1000 행 또는 50KB raw payload 초과하는 dataset 은 LLM 에 raw 전달 금지
  (assertion fail).
- 항상 derived metric / aggregate / top-K / cohort 로 압축 후 LLM 입력.
- 작은 dataset (≤ 1000 행 또는 ≤ 50KB) 은 raw 전달 가능 (단 일관성 위해
  Data Science Module 통과 권고).

## Alternatives Considered

- **A** (chosen) — Polars + DuckDB + statsmodels + scipy 기반 deterministic
  Data Science Module:
  - pros: reproducible (spec + vintage + lib version), 토큰 폭발 차단,
    bit-exact 재현 가능, evidence locator 명확 (spec_sha256), R2 와 정합
  - cons: stack 학습 비용 (1인 운영자), library version drift 관리 부담
- **B** — LLM 에 raw dataset 직접 입력 (현재 ADR-0006 INV-0006-2 위반):
  - pros: 코드 작성 부담 ↓
  - cons: 토큰 폭발, numerical reasoning 신뢰도 ↓, reproducibility 위반,
    cost 폭증. **rejected**.
- **C** — Pandas only:
  - pros: 표준
  - cons: Polars / DuckDB 보다 메모리 비효율, lazy eval 부재. legacy compat
    용으로만 유지.
- **D** — R / Julia 별도 runtime:
  - pros: 통계 분석 우위
  - cons: Python / TypeScript 생태 분리, 1인 운영 부담 ↑. **rejected**.

## Consequences

- 긍정:
  - 토큰 폭발 차단 (1000 행 / 50KB 한도) → cost 보호
  - reproducibility 3-tuple 로 NFR-002 강화
  - derived metric 이 Claim 의 evidence locator 로 직접 사용 가능 → 5+1
    cite check 의 trace depth 단축
  - LLM 호출 빈도 ↓ → DEC-010 cost ceiling 안에서 더 많은 dataset 처리 가능
  - 통계 분석 인사이트 자동화 (YoY / rolling / Granger causality 등) 가
    v0 진입부터 가능
- 부정:
  - Python stack 도입 (이전 TypeScript / bun 중심에서 hybrid) — INFRA-1A.2
    Cypher schema commit 직전 stack 결정 lock 필요
  - library version drift 관리 부담 — uv / pip lock 의무
  - transformation spec 작성 시간 (1 spec ≈ 30분~2시간) — 운영 초기 부담
  - reproducibility 검증 cost (dataset_vintage / spec_sha256 / lib version
    3-tuple 보관)
- 후속 작업:
  - INFRA-1A.2 (Cypher schema commit) — `derived_metric_ledger` 테이블
    + Python runtime 결정 (Polars / DuckDB / statsmodels / scipy 의무)
  - INFRA-1A.5 (text normalization util) — derived metric 의 numeric
    formatting / unit 표기 표준
  - EXTR-1A.5 (Dataset parser + report extractor) scope 확장 — parser →
    Data Science Module 본격 도입
  - 신규 slice `EXTR-1A.6` (Data Science Module bootstrap) — Polars +
    DuckDB + statsmodels stack lock + 첫 transformation spec (예 Fed
    CPI YoY) commit + reproducibility test
  - 신규 SPIKE — derived_metric 의 reproducibility 검증 (6개월 후 재현)
  - PRD REQ-009 갱신 — extractor 분리에 Data Science Module 명시
  - HLD Extractor (dataset) 컴포넌트 → Data Science Module 로 표시

## References

- ADR-0006 (LLM routing — dataset = parser only, ADR-0024 가 확장)
- ADR-0011 (dataset_vintage R9/Q4)
- ADR-0012 (R2 dataset versioned)
- DEC-010 (LLM routing v2 — Data Science Module 통과 후 derived metric 만 LLM)
- Polars docs: https://pola.rs/
- DuckDB docs: https://duckdb.org/
