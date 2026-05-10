# Decisions

Per-file DEC convention. 각 작은~중간 결정은 `docs/decisions/DEC-<NNN>.md`로 단일 파일.
큰 결정은 `docs/adr/`로 escalate.

- 템플릿: [`../templates/DECISION_ENTRY.md`](../templates/DECISION_ENTRY.md)
- ID 발급: 디렉토리 scan 결과 + 1 (validator가 중복/skip 검사)
- 사용 방법: [`../08_DECISION_REGISTER.md`](../08_DECISION_REGISTER.md) 참조
- ADR escalation 기준: 새 invariant / 새 term / 다중 scope 영향 — [`../08_DECISION_REGISTER.md`](../08_DECISION_REGISTER.md) 의 "When to escalate to ADR" 섹션
- frontmatter 스키마 / invariant tracking 결정: [`../adr/0002-invariant-tracking-system.md`](../adr/0002-invariant-tracking-system.md)
