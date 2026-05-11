---
title: GPT 메타 리뷰 (2026-05-11) + Claude 비판적 리뷰 + 영향 결정
created_at: 2026-05-11
status: discovery
provenance: external_review_synthesis
sensitivity: private
retention: long_term
ai_include: true
---

# GPT 메타 리뷰 + Claude 비판적 리뷰

## Part 1 — GPT 메타 리뷰 raw (사용자 paste 그대로, 2026-05-11)

> Q. 이젠 정합성 말고 좀 더 높은 레벨에서 검토해봐. 프로젝트의 당위성,
> 방향성이 잘 정렬되어있나? 이게 진짜 동작할까? 목표에 맞는 수준의 품질의
> 데이터와 컨텐츠를 만들 수 있을까? 병목은 뭘까? 숨겨진 잠재력은?

GPT 답변 (10 섹션 요약):

### A. 결론

- 당위성 강함
- "세계 경제 자동 모니터링 + 좋은 콘텐츠 자동 생산" 으로 보면 실패 확률 높음
- "1인 운영자의 판단을 증폭시키는 근거 추적형 시나리오·콘텐츠 생산 시스템"
  으로 보면 방향성 맞음
- 기술적으로는 동작, 운영적으로는 축소 필요, 콘텐츠 품질은 자동화 X 운영자
  thesis 판단력

### B. 당위성

- 출처 추적 약함 / 반대 증거 빠짐 / stale·retracted 정정 cascade 없음 →
  본 프로젝트가 정면 대응
- 9-stage 모델 + ADR-0022 자체 사이트 canonical anchor + Zod build gate
- "world monitor" 이름이 오해 → 더 정확한 정체성:
  - "근거 추적 가능한 세계 경제 시나리오 브리프 생산 시스템"
  - "1인 운영자를 위한 claim-to-publication intelligence pipeline"

### C. 방향성

가장 잘한 결정 3 가지:
1. v0 blog_long 1개 (DEC-005)
2. 첫 publication = 경제 (DEC-009)
3. 자체 사이트 canonical (ADR-0022)

단 문서·아키텍처가 제품 검증보다 앞서가는 경향. 가장 중요한 것은 "첫 경제
글 1 개가 독자에게 유의미한가?".

### D. 동작 가능성

- 기술 가능 (Neo4j + SQLite + R2 + Markdown + Astro + CF Pages 책임 분리)
- 운영 축소 필요 — 72 source 모두 active ingestion 하면 운영 폭발
- 해법: universe (72) vs active subset (8~12) 분리

### E. 데이터 품질

- factual reliability 강함 (Tier A 공식 source)
- 단 insight 자동 X
- `source_perspective` (source-level) 만으로 부족 — 나중에는
  `claim_perspective` / `evidence_role` 필요
- 권장 evidence_role enum:
  - supporting_evidence / opposing_evidence / mitigating_factor /
    amplifying_factor / monitoring_signal / base_rate_context

### F. 콘텐츠 품질

- 자동 생성 X — 운영자-주도 분석 콘텐츠
- 좋은 thesis / 반대 증거 실제 포함 / narrative arc 필요
- 좋은 blog_long 9-step 구조:
  1. 한 문장 thesis
  2. 왜 지금 중요한가
  3. 핵심 claim 3개
  4. 반대 증거 2개
  5. transmission channel
  6. winners / losers (upside / downside target 분리)
  7. monitoring signal
  8. 정정 가능성 / 불확실성
  9. source notes

### G. 병목 5종

1. **운영자 thesis 판단** (1순위)
2. Dossier → Scenario 전환 (causal model)
3. source ingestion 과범위
4. acceptance 가 technical 만, editorial quality gate 부재
5. correction workflow 의 심리적 부담

### H. 잠재력 5종

1. "출처 추적 가능한 경제 콘텐츠" 자체가 차별화
2. Scenario revision ledger 가 장기 IP
3. EvidencePack 의 멀티포맷 확장 기반
4. AccessIntervention / manual feedback 이 source strategy signal
5. 한국어 / 한국 관점 차별화

### I. 전략적 위험 4종

1. "시스템 만들다가 글 못 쓰는" 상태
2. source 수집이 insight 대체 착각
3. balance metric 의 기계적 균형 변질
4. 자체 사이트 build gate 가 editorial gate 로 오해

### J. v0 운영 권고

- Active source 경제 8~12 만
- 첫 콘텐츠 주제 "전파 경로 보이는 질문" (예 "미국 고금리 → 한국 수출 회복
  3 경로")
- 첫 글 semi-manual
- 첫 publication 성공 기준 6 종:
  1. thesis 10초 이해
  2. claim 3~5 source trace
  3. 반대 증거 2 개 이상
  4. 한국/특정 target 비대칭
  5. monitoring signal 구체적
  6. 글이 source summary 아니라 판단 제공

### K. 운영 원칙 권고

> v0 의 목표는 자동화된 world monitor 가 아니라, 경제 카테고리에서 근거
> 추적 가능한 좋은 글 1 개를 끝까지 발행하는 것이다.

---

## Part 2 — Claude 비판적 리뷰 (본 repo)

| GPT 의견 | 분류 | 본 repo 결정 / 근거 |
|---|---|---|
| 정체성 = "근거 추적형 시나리오·콘텐츠 생산 시스템" 으로 좁히기. "world monitor" 이름 오해 | **부분 수용** | repo 이름 `k-world-monitor` 는 DEC-001 lock — 변경 비용 큼. PRD overview / current-state system identity 본문 보강 (ADR-0012/0019 표현 강화)으로 흡수 |
| v0 thin slice (blog_long, 경제, 자체 사이트) 잘 정렬 | 수용 | DEC-005 / DEC-009 그대로 |
| 72 source universe vs active subset 분리 (v0 = 경제 8~12) | **수용 (신규 ADR)** | **ADR-0026** 신규 — universe (75 source, KAB/MOLIT/HF 추가 후) vs active subset (13~14). active_v0 flag + active_since/until. INV-0026-6: REQ-022/AC-027 분포 enforcement 는 universe 기준 |
| claim-level evidence_role 분류 (6 enum) | **수용 (신규 ADR)** | **ADR-0027** 신규 — source_perspective 와 evidence_role 독립 두 차원. EvidencePack v0 4-section 자연 매핑. Dossier composer minimum coverage (supporting ≥3 / opposing ≥2 / monitoring ≥3) 의무. operator_lock 강제 |
| Editorial Quality Rubric CQ-001~007 | **수용 (신규 DEC + AC)** | **DEC-012** + AC-036~042 신규 (thesis 명확 / 새 관점 / supporting+opposing / target 비대칭 / monitoring 구체 / 과장 없음 / correction 가능성). v0 manual / v1+ LLM judge |
| Active source cap (일일 candidate 20 / promoted 5~10 / weekly dossier 1 / publication 1) | **수용 (신규 DEC)** | **DEC-013** — cap + 4 신규 metric (REQ-024 확장) |
| 첫 발행 전 새 ADR/DEC/Q 최소화 원칙 | **수용** | DEC-013 안 운영 원칙으로 명시. 본 batch (DEC-011~013 + ADR-0026/0027 + AC-036~042 + Q-036 resolve) 가 첫 발행 전 마지막 의무 결정. 이후 ADR/DEC 도입은 첫 발행 retrospective 후 |
| 첫 글 semi-manual 권장 | **수용** | DEC-013 운영 원칙 3 으로 명시 |
| Dossier 단계 운영자 강제 UX (가장 강한 반론 2개) | **수용** | ADR-0027 INV-0027-4 minimum coverage (opposing ≥ 2) 구현 |
| Dossier → Scenario 전환이 2 순위 병목 | 인식만 (변경 X) | 별도 ADR 불필요. IMPL plan AGG-1A.2 / .3 가 이미 cover. PRD overview 에 병목 인식 메모 추가 |
| balance metric 의 기계적 균형 변질 우려 | **부분 수용** | REQ-022 본문은 그대로. 단 "반대 증거를 알고도 왜 이 thesis 를 채택했는지 설명 의무" 를 AC-038 / DEC-012 안에서 enforce |
| correction workflow 심리적 부담 | 인식만 (변경 X) | DEC-005 manual approve 그대로 |
| Scenario revision ledger 가 장기 IP | 잠재력 인식 | ADR-0009 그대로. 변경 X |
| 한국어 / 한국 관점 차별화 | **수용 (자연 정합)** | 첫 발행 주제 DEC-011 = 한국 부동산 폭락 — 자연 정합. active subset 13~14 중 한국 source 5~6 개 (BOK / KOSIS / KDI / KIEP / 금융위 / 외교부 / KIHASA + KAB/MOLIT/HF) |
| "글이 evidence ledger dump 처럼 보이면 안 됨 — narrative arc 필요" | 운영자 prompt 가이드로 흡수 | DEC-012 AC-037 (새 관점 제공) 안에 흡수. 별도 ADR 불필요 |

### Part 3 — 신규 결정 batch (본 commit 에서 일괄)

신규 ADR (2):
- ADR-0026 Active source subset vs Tier A seed universe
- ADR-0027 Claim-level evidence_role 분류

신규 DEC (3):
- DEC-011 한국 부동산 폭락 시나리오 sub-topic lock + Q-036 resolve
- DEC-012 Editorial Quality Rubric + AC-036~042
- DEC-013 Active source cap + v0 운영 원칙

신규 AC (8):
- AC-036~042 Editorial Quality Rubric (DEC-012)
- AC-044 evidence_role minimum coverage (ADR-0027)

신규 TEST (8):
- TEST-036~042, TEST-044

신규 metric (4, REQ-024 확장):
- daily_candidate_item_count
- daily_promoted_claim_count
- weekly_dossier_count
- weekly_publication_count

### Part 4 — 첫 발행 전 의무 잔여 작업

본 batch 이후 첫 발행 (PUB-1A.5) 차단 항목만 lock 의무. 그 외는 retrospective
후 도입.

차단 항목:
1. **INFRA-1A.2 Cypher schema migration** — Source `active_v0` / Claim
   `:EVIDENCE_FOR.evidence_role` / Thesis `:HAS_INTENT` / ContentDraft
   `editorial_intent_id` / derived_metric_ledger / cross_vendor_review_ledger
2. **Q-021 universe 72 → 75** (KAB / MOLIT / HF 추가 등록)
3. **OpenAI / Anthropic / Google AI Studio API key wiring** (이미 발급,
   Doppler 등록만)
4. **PUB-1A.5 진입 시 운영자 명시 작업**:
   - EditorialIntent 작성/lock (sample 참고, DEC-011)
   - active subset 13~14 source 의 source_policy / collectability_score
     설정 + RSS endpoint 검증
   - Dossier 합성 — evidence_role 분류 (operator_lock)
   - Thesis composer — intent reference + cross-vendor review (high-stakes
     flag 권고)
   - ContentDraft blog_long
   - Editorial Quality Rubric (AC-036~042) manual verify
