# 00 Project Delivery Playbook

이 프로젝트의 문서화/의사결정/전달 방식 요약.

## Philosophy

```text
Question
 → Proposed Answer
  → Decision / ADR
   → PRD / HLD / Runbook / Acceptance Tests / CI/CD
    → Traceability Matrix
     → Retrospective
      → Extraction packet
       → external knowledge-base review / promotion
```

질문을 먼저 남기고, 답이 정해지면 결정으로 승격하고, 결정은 요구사항/설계/운영 문서에 반영하고, 연결은 Traceability로 추적한다. 회고에서 reusable 지식이 도출되면 extraction packet 으로 정리하여 외부 knowledge base 의 review / 승격 프로세스에 넘긴다. 승격 자체는 외부 knowledge base 가 결정한다.

## Source-of-truth

| Artefact | File |
|---|---|
| 열린 질문 | `07_QUESTIONS_REGISTER.md` |
| 가벼운 결정 | `08_DECISION_REGISTER.md` |
| 중대한 결정 | `adr/ADR-####.md` |
| 요구사항 | `01_PRD.md` |
| 설계 | `02_HLD.md` |
| 가정 검증 | `03_RISK_SPIKES.md` |
| Roadmap / status ledger | `04_IMPLEMENTATION_PLAN.md` |
| 운영 절차 | `05_RUNBOOK.md` |
| 검증 기준 | `06_ACCEPTANCE_TESTS.md` |
| 연결 매트릭스 | `09_TRACEABILITY_MATRIX.md` |
| 회고 | `10_PROJECT_RETROSPECTIVE.md` |
| CI/CD guidance | `11_CI_CD.md` |

## ID 규약

```text
Q-001        Question
DEC-001      Decision Register entry
ADR-0001     Architecture Decision Record
REQ-001      Requirement
NFR-001      Non-functional requirement
AC-001       Acceptance criterion
TEST-001     Test
SPIKE-001    Risk spike
P0-M1        Milestone
TRK          Track code (example)
TRK-1B       Phase inside a track
TRK-1B.5     Commit-sized slice
TRACE-001    Traceability row
```

Roadmap taxonomy:

```text
Milestone = 제품 / 사용자 관점의 delivery gate
Track     = 기술 영역 / 큰 흐름
Phase     = track 안의 구현 단계
Slice     = 커밋 가능한 구현/검증 단위
Gate      = 검증 / acceptance 기준
Evidence  = code / tests / PR / docs 같은 완료 근거
```

## Cadence

- **Daily**: 질문을 `07_`에, 새 결정 후보를 `08_` 또는 `adr/`에.
- **Weekly**: roadmap/status ledger, Traceability matrix, acceptance gate 상태 점검.
- **Milestone**: Retrospective 갱신, lesson 승격 후보 식별.
- **Project end**: 최종 retrospective → extraction packet 준비 → 외부 knowledge base review / 승격.

## Implementation-stage docs

위의 numbered 문서들은 project-stage delivery artifacts (의도/계획/검증)이다.
구현이 시작된 이후에는 implementation-stage 문서들이 추가로 필요하다.

- `docs/context/current-state.md` 를 첫 read로 사용한다 — 새 세션의 압축된 진입점.
- `docs/04_IMPLEMENTATION_PLAN.md` 를 roadmap / status ledger로 사용한다 — milestone, track, phase, slice, gate, evidence의 canonical 위치.
- `docs/current/` 를 implementation-state 네비게이션 문서로 사용한다 (CODE_MAP, DATA_MODEL, RUNTIME, TESTING, OPERATIONS).
- `docs/11_CI_CD.md` 는 stack-neutral CI/CD 설계 / 문서화 / migration guide로
  사용한다. 실제 명령은 `docs/current/TESTING.md`, 실제 배포 절차는
  `docs/current/OPERATIONS.md` 와 `docs/05_RUNBOOK.md` 에 둔다.
- numbered 문서들 (`01_PRD` ~ `11_CI_CD`) 은 project delivery artifacts 로 유지한다.
- `docs/discovery/` 는 ongoing exploration / 임시 분석에 사용한다.
- `docs/design/archive/` 는 과거 design 노트 보관용이다.
- `docs/generated/` 는 코드/스키마에서 파생된 generated reference 용이다.

규칙:

- current-state 는 짧게 유지한다.
- 모든 history 를 current-state 에 누적하지 않는다.
- roadmap / phase / slice inventory는 `04_IMPLEMENTATION_PLAN.md`에 두고 current-state나 current docs에 복제하지 않는다.
- 코드 변경이 behavior/schema/runtime 에 영향을 주면 같은 PR 에서 current 문서들을 업데이트한다.
- discovery / archive 는 implementation authority 가 아니다.
- generated 문서는 손으로 편집하지 않는다.

상세 정책은 `docs/DOCUMENTATION.md` 와 `AGENTS.md` 를 참고한다.

## Extraction and external knowledge-base promotion

회고, discovery, Q/DEC/SPIKE 종료에서 reusable 지식이 생기면
[`templates/EXTRACTION_TEMPLATE.md`](templates/EXTRACTION_TEMPLATE.md)로 승격
후보만 정리한다. Boilerplate는 project-side packet만 만든다. 외부 knowledge
base가 최종 위치, schema, sensitivity, ingestion을 결정한다.

언제 작성하는가:

- Final retrospective: 항상.
- Major milestone/discovery/register 종료: cross-project lesson, ADR 후보,
  resource 후보가 있을 때.

규칙:

- Project-specific 결정은 project repo의 DEC/ADR에 둔다.
- Raw Q&A, stale plan, rejected recommendation, sensitive content는 그대로
  promote하지 않는다. 필요하면 distill한다.
- 모든 row는 candidate다. Promotion은 외부 knowledge base가 accept한 뒤에만
  promoted라고 부른다.
- `Do not promote`를 비우지 않는다. 검토 후 없을 때만 `None — reviewed`.
- Source anchor를 보존한다. 모르면 `anchor missing`; 추측하지 않는다.
