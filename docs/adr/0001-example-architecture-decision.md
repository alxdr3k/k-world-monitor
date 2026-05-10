---
id: adr-0001
type: adr
title: Example architecture decision (boilerplate placeholder)
status: rejected
created_at: 2026-05-09
updated_at: 2026-05-11
deciders: []
supersedes: []
superseded_by: []

# Cross-document invariant tracking — see ADR-0002.
scope:
  in: []
  out:
    - boilerplate.placeholder.example_only

invariants: []
preconditions: []
defines: []

invariant_review:
  status: acknowledged
  reviewed_at: 2026-05-11
  fingerprint: null
unresolved_warnings: []
reviewed_terms: []
reviewed_scopes:
  - boilerplate.placeholder.example_only

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: false
---

# ADR-0001: Example architecture decision (boilerplate placeholder)

## Status

rejected — 2026-05-11 — boilerplate placeholder. 실제 결정 내용 없음.

## Context

이 파일은 boilerplate(`alxdr3k/boilerplate`)가 부트스트랩 시 생성한 예시 ADR
이다. 실제 프로젝트 결정을 담고 있지 않으며, ADR template 형식 참고용으로
존재한다. 본 repo의 실제 architecture 결정은 ADR-0003 ~ ADR-0010에 있다.

## Decision

이 파일은 결정을 담지 않는다. status를 `rejected`로 표시해 active ADR 인덱스
에서 제외한다. 형식 참고가 필요한 경우 `docs/templates/ADR_TEMPLATE.md`를
사용한다.

## Alternatives Considered

- **A** (chosen): rejected 상태로 placeholder 유지
  - pros: ADR 번호 시퀀스 유지 (0001 자리), boilerplate 참고용으로 남김
  - cons: index 표에 한 줄 추가 부담
- **B** (discarded): 파일 삭제
  - pros: 깔끔
  - cons: ADR 번호 시퀀스 깨짐, boilerplate sync 시 다시 생성됨
- **C** (discarded): `docs/adr/examples/`로 이동
  - pros: active ADR 디렉토리에서 분리
  - cons: boilerplate sync overlay 패턴과 충돌, 향후 sync 시 동기화 어려움

## Consequences

- 긍정:
  - active ADR 인덱스(`docs/adr/README.md`)에서 status `rejected`로 명시되어
    혼동 없음
  - ADR 번호 시퀀스(0001 ~ 0010) 유지
- 부정 / trade-off:
  - ADR 폴더에 비어있는 파일이 한 개 남음
- 후속 작업 / follow-ups:
  - 향후 boilerplate sync 정책에서 example placeholder를 어떻게 처리할지 결정
    필요 (별도 DEC 또는 ADR — 현재 deferred)

## References

- Related issues / PRs: —
- Related ADRs (supersedes / superseded_by): —
- External sources: `alxdr3k/boilerplate` ADR template
