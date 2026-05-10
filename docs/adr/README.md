# ADR (Architecture Decision Records)

이 폴더에 중요한 아키텍처 결정을 기록한다. 포맷은 Michael Nygard 스타일.

## 파일 이름

`ADR-<NNNN>-<kebab-title>.md`

예: `ADR-0001-use-postgres-for-metadata.md`

## 언제 ADR을 쓰는가

- 되돌리기 어려운 결정
- 여러 컴포넌트/팀에 영향
- 장기 운영 비용을 바꾸는 결정

더 작은 결정은 `../08_DECISION_REGISTER.md`.

## 상태

- `proposed` — 제안 중
- `accepted` — 채택
- `deprecated` — 더 이상 선호되지 않음
- `superseded` — 다른 ADR로 대체됨
- `rejected` — 기각

## Index

| ADR | 제목 | 상태 | 날짜 |
|---|---|---|---|
| 0001 | Example architecture decision (boilerplate placeholder) | rejected | 2026-05-11 |
| 0002 | Cross-document invariant tracking system | accepted | 2026-05-09 |
| 0003 | 7-stage pipeline object model with 3-tier source layer | accepted | 2026-05-11 |
| 0004 | Storage tiers — Markdown / SQLite+FTS5 / R2 | accepted | 2026-05-11 |
| 0005 | Confidence decomposition | accepted | 2026-05-11 |
| 0006 | LLM routing — Haiku 1차 + Sonnet escalate | accepted | 2026-05-11 |
| 0007 | Edge ledger — supports / contradicts / qualifies / updates / supersedes | accepted | 2026-05-11 |
| 0008 | Evidence quote and cite check coverage | accepted | 2026-05-11 |
| 0009 | Scenario validate and revisions ledger | accepted | 2026-05-11 |
| 0010 | Stale triggers and review queue throttling | accepted | 2026-05-11 |

## Template

새 ADR을 만들 때는 `../templates/ADR_TEMPLATE.md`를 복사한다.
