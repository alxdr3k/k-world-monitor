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

## TOC (manually curated, regenerate when adding DEC)

> 본 TOC 는 frontmatter 기반 manual snapshot — Phase 3 generated TOC 도입
> 전까지는 새 DEC 추가 시 같은 PR 안에서 직접 갱신. 정렬은 ID 순.
> 모든 DEC 는 `status: accepted` (DEC-008 만 superseded by DEC-010). superseded
> column 이 있는 경우 명시.

| ID | Status | Resolves | Title |
|---|---|---|---|
| [DEC-001](decisions/DEC-001.md) | accepted | — | 외부 코드 repo 형으로 운영 (vault 내 형 결정 진화) |
| [DEC-002](decisions/DEC-002.md) | accepted | — | second-brain ideation settled (2)(3)(4) — vault 측 결정의 본 repo 적용 boundary |
| [DEC-003](decisions/DEC-003.md) | accepted | — | INFRA-1A.1 재작성 — Round 25 canonical 반영 |
| [DEC-004](decisions/DEC-004.md) | accepted | Q-022 | v0 4 메타 카테고리 (정책 / 경제 / 사회 / 대중문화) |
| [DEC-005](decisions/DEC-005.md) | accepted | — | v0 turn-key publish scope — blog_long only, TTS deferred, manual cross-post, manual correction approve |
| [DEC-006](decisions/DEC-006.md) | accepted | Q-026 | Vault sync trigger — git push 가 자체 사이트 build trigger |
| [DEC-007](decisions/DEC-007.md) | accepted | Q-027 | Retention / R2 lifecycle / backup schedule lock |
| [DEC-008](decisions/DEC-008.md) | superseded by DEC-010 | Q-028 | LLM cost / quality discipline lock (Anthropic-only routing — superseded) |
| [DEC-009](decisions/DEC-009.md) | accepted | — | v0 turn-key first publication category = 경제 (economy) |
| [DEC-010](decisions/DEC-010.md) | accepted | — | LLM routing v2 lock — GPT default + Anthropic dual-vendor + Google exploration-only + minimal cross-vendor review + Data Science Module |
| [DEC-011](decisions/DEC-011.md) | accepted | Q-036 | v0 turn-key 첫 발행 sub-topic — 한국 부동산 폭락 시나리오 |
| [DEC-012](decisions/DEC-012.md) | accepted | — | Editorial Quality Rubric — AC-036~042 (PUB-1A.5 운영자 manual verify checklist) |
| [DEC-013](decisions/DEC-013.md) | accepted | — | Active source ingestion cap + v0 운영 원칙 |
| [DEC-014](decisions/DEC-014.md) | accepted | — | SQLite busy_timeout=5000ms PRAGMA — getDb() 표준 |
| [DEC-015](decisions/DEC-015.md) | accepted | — | SQLite 마이그레이션 규율 — 런타임 CREATE TABLE IF NOT EXISTS 금지 |
| [DEC-016](decisions/DEC-016.md) | accepted | — | Neo4j 연결 풀 설정 환경변수화 — NEO4J_MAX_POOL_SIZE / NEO4J_ACQ_TIMEOUT_MS |
| [DEC-017](decisions/DEC-017.md) | accepted | — | Safe-Fetch 컨텐츠 종류별 최대 바이트 상한 |
| [DEC-018](decisions/DEC-018.md) | accepted | — | RSS/XML 파서 선택 — fast-xml-parser + XXE 비활성화 표준 |
| [DEC-019](decisions/DEC-019.md) | accepted | Q-037 ~ Q-041 | PR #25 회고 deferred findings 처분 (apoc.lock / worker_id CAS / chunked stream / pre-deploy migration framework / millis-bearing timestamp) |
| [DEC-020](decisions/DEC-020.md) | accepted | Q-042 ~ Q-048 | 2026-05-13 comprehensive review 일괄 resolution (NFR-003 5-hop reflow / evidence_role / R2 audit / validator coverage / quota / Doppler / CI required) |
| [DEC-021](decisions/DEC-021.md) | accepted | Q-049 | 재방문 정책 + canonical_text_hash semantic diff + ADR-0010 snapshot_diff 정의 |
| [DEC-022](decisions/DEC-022.md) | accepted | Q-051 (#6 UI stack partial) | Research App `/ops` UI stack — Astro + React island + shadcn/Radix + Tailwind + TanStack + SSE |
| [DEC-023](decisions/DEC-023.md) | accepted | Q-051 (Round 1 routing default 5항) | no-context error / classifier deferred / advisory-only / fork inheritance / .kwm deferred |
| [DEC-024](decisions/DEC-024.md) | accepted | Q-052 / Q-053 / Q-054 / Q-056 / Q-058 / Q-059 (resolve) + Q-055 / Q-057 (defer) | 2026-05-15 adversarial review action decisions — PR-only main branch + chunker archive_policy gate + SQLite source_profile canonical + dataset MVP timing 유지 + DEC-005/009/011 유지 + source_role 흡수 + hybrid prioritization |
| [DEC-025](decisions/DEC-025.md) | accepted | — | 2026-05-19 article extraction strict JSON schema v1 — minimum field set lock (title + summary + key_claims[{claim, evidence_quote}]) + run_ledger ordering invariant (missing-cost guard → schema parse) + extended field / quote substring 검증 deferred (DEC-010 §8 ratification) |
