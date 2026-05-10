# 08 Decision Register

**구조 변경 (2026-05-09)**: Decision entry는 이제 `docs/decisions/DEC-<NNN>.md`에 파일별로 저장된다.
큰 결정은 그대로 `docs/adr/`. 이 파일은 historical reference + 향후 generated TOC가 들어올 위치 (Phase 3 future work).

자세한 마이그레이션 결정은 [`docs/adr/0002-invariant-tracking-system.md`](adr/0002-invariant-tracking-system.md) 참조.

## Per-file DEC location

- 파일 패턴: `docs/decisions/DEC-<NNN>.md`
- 템플릿: `docs/templates/DECISION_ENTRY.md`
- frontmatter required: `id`, `type`, `status`, `created_at`, `resolves`, `term_effects[]`, `invariant_review`, `unresolved_warnings`

## How to add a new DEC

1. 다음 ID는 `docs/decisions/` 디렉토리 scan 결과 + 1
2. `docs/templates/DECISION_ENTRY.md`를 `docs/decisions/DEC-<NNN>.md`로 복사
3. frontmatter `id`, `title`, `created_at`, `resolves` 채움
4. body Context / Decision / Rationale / Consequences 작성
5. term의 attribute 변경 시 frontmatter `term_effects[]` 명시 (Case 2 body-only drift 차단)
6. supersede 시 이전 DEC/ADR의 frontmatter `superseded_by` 함께 갱신

## When to escalate to ADR

- 결정 영향이 여러 invariant + 여러 scope에 걸치면 ADR로
- 새 invariant를 도입하면 ADR (DEC는 기존 invariant 안에서만 결정)
- 새 glossary term을 정의하면 ADR (`defines[]` 권리는 ADR만)

## Legacy entries (co-existence — Phase 1)

기존 채택 repo가 이 파일에 inline `### DEC-XXX` 형태로 누적해 둔 entry는 그대로 둘 수 있다.
validator는 legacy entry를 ID 추적만 하고 invariant scope에서 제외 (warning suppressed).
사용자가 Phase 2 마이그레이션을 트리거하면 LLM이 entry 단위로 per-file로 분할.

(아래에 legacy inline entry가 있다면 마이그레이션 시 제거)
