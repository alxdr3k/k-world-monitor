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

## TOC (manually curated, regenerate when adding Q)

> 본 TOC 는 frontmatter 기반 manual snapshot — Phase 3 generated TOC 도입
> 전까지는 새 Q 추가 시 같은 PR 안에서 직접 갱신. 정렬은 ID 순.

### Open (operator decision pending)

| ID | Title | Block |
|---|---|---|
| [Q-001](questions/Q-001.md) | scenario horizon enum 정의 (1Q / 1Y / 5Y / generational?) | AGG-1A.3 |
| [Q-002](questions/Q-002.md) | Dossier `stale_after` 기본값 정책 (주제별로 다른가?) | OPS-1B.1 |
| [Q-003](questions/Q-003.md) | Publication 정정(correction) ledger 트리거 정의 | PUB-1A.3 |
| [Q-008](questions/Q-008.md) | Thesis ID 체계 (`ths_<sha256[0:10]>` vs draft 내부 thesis_text) | AGG-1A.4 / PUB-1A.1 |
| [Q-012](questions/Q-012.md) | Neo4j ↔ SQLite sync 정책 (CDC vs batch) | v1+ multi-store research session |
| [Q-025](questions/Q-025.md) | 외부 repo 부트스트랩 cadence (week 1-9 reference) | post-P0-M2 gate accept |
| [Q-029](questions/Q-029.md) | ImpactAssessment v0 embedded dict vs v1 별도 Neo4j 노드 | AGG-1A.2 |
| [Q-030](questions/Q-030.md) | counterclaim multi-relation v1 도입 우선순위 (weakens/strengthens/mitigates/amplifies) | v1 진입 시 |
| [Q-031](questions/Q-031.md) | TTS v1 timing + provider (외주 vs 자체) | v1+ PUB-1B |
| [Q-032](questions/Q-032.md) | ContentDraft 4-format auto-generate phasing | v1+ PUB-1B |
| [Q-033](questions/Q-033.md) | 외부 플랫폼 auto cross-post timing (Substack / YouTube / X) | v1+ PUB-1B + Q-032 |
| [Q-034](questions/Q-034.md) | Auto retraction trigger 정책 v1+ | v1 OPS-1B |
| [Q-035](questions/Q-035.md) | Google Gemini 사용 scope 확장 시점 (v1+ 메인/리뷰 포함 검토) | v1+ EXTR |
| [Q-050](questions/Q-050.md) | AI 웹 검색 + repo 통합 architecture — 7 operator decisions pending | INFRA-1B.7b~e / AGG-1A.6 |
| [Q-052](questions/Q-052.md) | main branch protection 3중 정책 충돌 — DEC-020 vs CLAUDE.md vs GH state | AI-P0-2 / DOC-SYNC-2026-05-15 |
| [Q-053](questions/Q-053.md) | chunker raw text persistence 정책 — archive_policy gate + local_storage_policy enum 도입 여부 | INFRA-1B.4.h1-chunker-policy-gate |
| [Q-054](questions/Q-054.md) | Source Registry canonical store — Neo4j projection vs SQLite source_profile table | INFRA-1B.1.h2-source-profile |
| [Q-055](questions/Q-055.md) | Dataset ingestion MVP timing — M3 이전 vs ADR-0024 EXTR-1A.5 lock 유지 | EXTR-1A.5 / PUB-1A.5 |
| [Q-056](questions/Q-056.md) | 첫 publishable format — DEC-005/009/011 유지 vs Weekly Scenario Watch reflow | PUB-1A.5 |
| [Q-057](questions/Q-057.md) | Claim promotion / semantic dedup 정책 — promotion score / semantic claim key / claim_direction / importance scoring | EXTR-1A.1 |
| [Q-058](questions/Q-058.md) | Source reliability multi-dim — source_role enum (9 값) 추가 여부 | INFRA-1B.1.h2-source-profile |
| [Q-059](questions/Q-059.md) | 운영자 attention budget — P2/P3 batch (~160 finding) 처리 정책 | 다음 4주 sequence |

### Resolved (audit anchor)

| ID | Resolution | Title |
|---|---|---|
| [Q-004](questions/Q-004.md) | INFRA-1A.2 | SQLite + vault jsonl 책임 분담 |
| [Q-020](questions/Q-020.md) | INFRA-1A.2 | Neo4j Community GPL v3 boundary (1인 internal use scope) |
| [Q-021](questions/Q-021.md) | INFRA-1A.6 | Tier A 72 source seed + perspective 분포 (AC-027) |
| [Q-022](questions/Q-022.md) | [DEC-004](decisions/DEC-004.md) | v0 4 메타 카테고리 (정책 / 경제 / 사회 / 대중문화) |
| [Q-024](questions/Q-024.md) | INFRA-1A.2 | APOC standard + Cypher 5.x core / GDS Community v1+ |
| [Q-026](questions/Q-026.md) | [DEC-006](decisions/DEC-006.md) | Vault sync trigger = git push 단일 |
| [Q-027](questions/Q-027.md) | [DEC-007](decisions/DEC-007.md) | Retention / R2 lifecycle / backup schedule |
| [Q-028](questions/Q-028.md) | [DEC-008](decisions/DEC-008.md) → [DEC-010](decisions/DEC-010.md) | LLM routing v2 multi-vendor + cost ceiling |
| [Q-036](questions/Q-036.md) | [DEC-011](decisions/DEC-011.md) | v0 turn-key 첫 발행 sub-topic — 한국 부동산 폭락 시나리오 |
| [Q-037](questions/Q-037.md) | [DEC-019](decisions/DEC-019.md) | AccessIntervention resolveIntervention multi-reviewer race — apoc.lock.nodes |
| [Q-038](questions/Q-038.md) | [DEC-019](decisions/DEC-019.md) | discovery_queue worker_id CAS — heartbeat/markQueueItemDone TOCTOU |
| [Q-039](questions/Q-039.md) | [DEC-019](decisions/DEC-019.md) | pollEligibleSources Promise.allSettled 메모리 — Phase 1/2 streaming |
| [Q-040](questions/Q-040.md) | [DEC-019](decisions/DEC-019.md) | v0→production schema migration framework — in-place vs ALTER-only contract |
| [Q-041](questions/Q-041.md) | [DEC-019](decisions/DEC-019.md) | updated_at 형식 CHECK constraint — future writer drift 방지 (millis-bearing ISO) |
| [Q-042](questions/Q-042.md) | [DEC-020](decisions/DEC-020.md) | NFR-003 5-hop trace 의무를 ADR-0025 10-stage 도입 이후 reflow |
| [Q-043](questions/Q-043.md) | [DEC-020](decisions/DEC-020.md) | AC-044 (Dossier evidence_role minimum coverage, ADR-0027) row 정식 정의 |
| [Q-044](questions/Q-044.md) | [DEC-020](decisions/DEC-020.md) | NFR-008 audit log (raw text 0건 cloud 저장) 의 코드 enforcement 위치 |
| [Q-045](questions/Q-045.md) | [DEC-020](decisions/DEC-020.md) | invariant validator scope 확장 — ADR INV ↔ 코드 enforcement cross-ref |
| [Q-046](questions/Q-046.md) | [DEC-020](decisions/DEC-020.md) | Tier 0 호출 일일 quota 5회 (DEC-010 cap) 의 코드 enforcement 위치 |
| [Q-047](questions/Q-047.md) | [DEC-020](decisions/DEC-020.md) | Secret management — Doppler vs `.env` (OpenAI / Anthropic / Google / R2 API key 4종) |
| [Q-048](questions/Q-048.md) | [DEC-020](decisions/DEC-020.md) | CI branch protection — invariant-check / ci workflow 를 advisory → required check |
| [Q-049](questions/Q-049.md) | [DEC-021](decisions/DEC-021.md) | revisit policy + canonical_text_hash semantic diff |
| [Q-051](questions/Q-051.md) | [DEC-022](decisions/DEC-022.md) + [DEC-023](decisions/DEC-023.md) | Research App UI stack + Round 1 routing default 5항 |
