# 07 Questions Register

**구조 변경 (2026-05-09)**: Question entry는 이제 `docs/questions/Q-<NNN>.md`에 파일별로 저장된다.
이 파일은 historical reference + 향후 generated TOC가 들어올 위치 (Phase 3 future work).

자세한 마이그레이션 결정은 [`docs/adr/0002-invariant-tracking-system.md`](adr/0002-invariant-tracking-system.md) 참조.

## Per-file Q location

- 파일 패턴: `docs/questions/Q-<NNN>.md`
- 템플릿: `docs/templates/QUESTION_ENTRY.md`
- frontmatter required: `id`, `type`, `status`, `created_at`, `touches[]`, `term_effects[]`, `invariant_review`, `unresolved_warnings`

## How to add a new Q

1. 다음 ID는 `docs/questions/` 디렉토리 scan 결과 + 1
2. `docs/templates/QUESTION_ENTRY.md`를 `docs/questions/Q-<NNN>.md`로 복사
3. frontmatter `id`, `title`, `created_at` 채움
4. body Context / Discussion 작성
5. 작업 전 `touches[]` upstream invariant/scope/term을 read하고 frontmatter 채움 (`AGENTS.policy.md` 의무)
6. resolved 시 `status: resolved` + `resolution: DEC-### | ADR-####`

## Legacy entries (co-existence — Phase 1)

기존 채택 repo가 이 파일에 inline `### Q-XXX` 형태로 누적해 둔 entry는 그대로 둘 수 있다.
validator는 legacy entry를 ID 추적만 하고 invariant scope에서 제외 (warning suppressed).
사용자가 Phase 2 마이그레이션을 트리거하면 LLM이 entry 단위로 per-file로 분할.

마이그레이션 절차는 [`adr/0002-invariant-tracking-system.md`](adr/0002-invariant-tracking-system.md) "Migration phases" 결정 (Phase 0~3) 참조. 본 repo는 greenfield라 legacy entry 없음.

(아래에 legacy inline entry가 있다면 마이그레이션 시 제거)
