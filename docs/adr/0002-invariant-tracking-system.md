---
id: adr-0002
type: adr
title: Cross-document invariant tracking system
status: accepted
created_at: 2026-05-09
updated_at: 2026-05-09
deciders: [opus]
supersedes: []
superseded_by: []

scope:
  in:
    - docs.governance.invariants
    - docs.governance.glossary
    - docs.governance.scope_tracking
    - frontmatter.q
    - frontmatter.dec
    - frontmatter.adr
    - frontmatter.glossary_term
    - tooling.validator
    - tooling.sync.invariant_coverage
  out:
    - body.prose.semantics            # 본문 prose 자체의 의미 추론은 out — frontmatter만 검증 대상
    - tooling.editor                   # IDE/editor 통합은 out — CLI/CI만 다룸
    - migration.automation             # 자동 invariant inference 도구는 future work (Round 2 폐기 사유)

invariants:
  - id: INV-0002-1
    statement: invariant validator는 warning level only — CI는 절대 hard-fail 하지 않는다 (exit 0 unconditional)
    status: active
  - id: INV-0002-2
    statement: --write-warnings 모드는 foreground 전용. CI는 doc frontmatter를 절대 수정하지 않는다
    status: active
  - id: INV-0002-3
    statement: .local 확장 (relation_enum.local.yaml / glossary_term_schema.local.yaml / scope_aliases.local.yaml / <term>.local.md) 은 additive only. boilerplate base의 required를 누락하거나 forbidden을 풀어주는 변경은 additive_violation warning
    status: active
  - id: INV-0002-4
    statement: per-file Q/DEC (`docs/questions/Q-XXX.md`, `docs/decisions/DEC-XXX.md`) 가 source of truth. register file (07/08_*.md) 은 Phase 1 co-existence 동안 stub pointer + ID 추적용. Phase 3에서 generated artifact로 이전
    status: active
  - id: INV-0002-5
    statement: glossary term의 attribute 변경은 frontmatter `term_effects[{term, attribute, operation, value, reason}]` 로만 인정. body prose만 변경하면 silent drift (Case 2 차단의 강제 메커니즘)
    status: active
  - id: INV-0002-6
    statement: ADR이 정의 권리 (`defines[]`) 를 가진 glossary term은 단 하나의 ADR이 primary로 선언. 동시 선언 시 hard warning (term_definition_conflict)
    status: active
  - id: INV-0002-7
    statement: warning escalation은 calendar days 기반 — warning (0-6) → stale (7+) → persistent (14+). source_fingerprint 변경 시 reset
    status: active

preconditions:
  - id: PRE-0002-1
    statement: 채택 repo가 Bun runtime 보유 (validator 가 .ts ESM 으로 직접 실행되어 raw node 로는 동작 X. Node 호환은 future work — tsx/loader 또는 compiled JS bundle 필요)
  - id: PRE-0002-2
    statement: 채택 repo의 package.json에 `yaml` npm package 의존 추가 (validator import용)
  - id: PRE-0002-3
    statement: my-skill의 boilerplate-sync-docs.sh가 5번째 컬럼 invariant_tracking을 지원 (Step 5 머지 완료 의존)

defines: []

invariant_review:
  status: pending
  reviewed_at: null
  fingerprint: null
unresolved_warnings: []
# boilerplate root 에는 glossary term 이 없으므로 reviewed_terms 비움.
# actwyn 사례에서 cite하는 critic_loop / pending 같은 term 은 docs/_examples/
# fixture 안에만 존재 — fixture 는 별도 repo 트리로 validator 가 검증.
reviewed_terms: []
# reviewed_scopes 는 이 ADR 자체가 scope.in/out 으로 선언하는 namespace 만 포함.
# control-plane.* / judgment-plane.* 등 actwyn 사례 cite 는 본문 prose 에만
# 등장 (descriptive context); boilerplate scope_tree 에 declared 되어 있지
# 않으므로 reviewed_scopes 에 적으면 reviewed_scope_unknown 으로 잡힘.
reviewed_scopes:
  - docs.governance.invariants
  - docs.governance.glossary
  - docs.governance.scope_tracking
  - frontmatter.q
  - frontmatter.dec
  - frontmatter.adr
  - frontmatter.glossary_term
  - tooling.validator
  - tooling.sync.invariant_coverage
  - body.prose.semantics
  - tooling.editor
  - migration.automation

provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true
---

# ADR-0002: Cross-document invariant tracking system

## Status

accepted — 2026-05-09

## Context

boilerplate template의 Q-ADR-DEC 문서 체계가 진화하면서 LLM이 cross-document invariant 위반을 감지하지 못하는 두 사례가 actwyn-q069 작업 중 발견됐다.

**Case 1 (scope creep)**: ``ADR-0012``가 critic_loop의 scope를 control-plane으로 한정하고 cheap inference model 권고를 그 위에 세움. ``Q-069`` working draft가 paraphrase로 critic_loop을 judgment-plane.promotion까지 silent하게 확장. ``ADR-0012``의 전제가 깨졌으나 본문 prose에만 정의된 scope는 자동 검출 불가능.

**Case 2 (glossary drift)**: Glossary "pending" 정의가 release_paths에 critic_loop을 잘못 가지고 있음. 별도 (a3) DEC가 critic_loop 제거를 결정했으나 본문 prose에만 적혀 있어 glossary 파일 미반영. 같은 개념이 두 문서에 별도 진술되어 drift 발생.

진단 (Round 1): 진짜 병명은 "분량 병"이 아니라 "rationale-bearing 부분(scope, invariant, 관계 종류)이 본문 prose에만 있어서 later doc이 invariant를 위반해도 자동 검출 불가능". 본문 전체 JSON 전환은 over-engineering이고 nuance 손실. rationale-bearing 부분만 frontmatter로 구조화하는 것이 본질.

제약:
- 채택 repo의 LLM-only editing (사람 편집 없음)
- CI는 warning level only (false positive 비용 회피)
- markdown body 유지 (자연어 본문이 LLM에게도 효율적)
- boilerplate-sync overlay 패턴(`*.policy.md` partner + Tier 1/2/3 + `/boilerplate migrate`)과 호환
- second-brain 영향 없음 (별도 purpose)

## Decision

다음 구성으로 cross-document invariant tracking system을 도입한다. 모든 자산은 boilerplate-owned이며 sync overlay로 채택 repo에 자동 전파.

**Frontmatter 확장**:
- ADR: `scope.in/out`, `invariants[{id, statement, status}]`, `preconditions[]`, `defines[]`, `reviewed_*` (4개 모두 강제)
- Q: `touches[{id, relation, ...payload}]`, `term_effects[]`, `invariant_review`, `unresolved_warnings` (강제), `reviewed_terms/reviewed_scopes` (옵션)
- DEC: `term_effects[]`, `invariant_review`, `unresolved_warnings` (강제)
- glossary term: per-term file (`docs/glossary/<term>.md`) + term_type별 schema (`lifecycle | role | capability`)

**Per-file Q/DEC 구조**: `docs/questions/Q-<NNN>.md`, `docs/decisions/DEC-<NNN>.md`. file-level frontmatter standard 준수. 기존 register file (07/08)은 stub pointer로 단축, legacy entry는 co-existence (validator는 ID 추적만, invariant scope에서 제외).

**Relation enum** (`docs/templates/relation_enum.yaml`): closed set `complies / extends_scope / challenges_invariant / depends_on / supersedes`. value별 required payload schema (`extended_to`, `parent_invariant`, `challenged_refs`, `depended_refs`, `superseded_id` 등). relation은 라벨이 아니라 evidence carrier.

**Glossary term schema** (`docs/templates/glossary_term_schema.yaml`): 3종 (`lifecycle / role / capability`). lifecycle은 states[].release_paths/forbidden_paths, capability는 applies_to_planes/forbidden_paths. drift detection의 cross-check 기반.

**Validator** (`scripts/validate_invariants.ts` + `scripts/lib/`):
- canonicalize step (`docs/_generated/scope_tree.yaml` 재생성)
- relation payload check
- term integrity (정의 충돌 / orphan / common+type-specific required)
- term_effects vs glossary cross-check (Case 2 drift)
- coverage gap (body cite vs reviewed_*)
- scope creep detect (capability forbidden_paths + body namespace 동시 등장)
- ID 중복/skip detect
- timeout escalation (calendar days, 7/14일, source_fingerprint reset)
- generated artifacts (scope_tree, term_usage, effective_invariant_policy)

**CI workflow** (`.github/workflows/invariant-check.yml.example`): pull_request + push trigger, paths-filtered. `--ci` 모드 (annotation only, 절대 doc 수정 안 함). 채택 repo가 .yml로 rename + 활성화.

**AGENTS.policy.md** 갱신: Q/DEC/ADR 작성 전 read 의무 — `_generated/` artifacts + 상위 cite ADR/Q + glossary term 파일. 작성 후 reviewed_* 채우기. `--write-warnings`는 foreground only.

**Sync 통합** (`my-skill/codex/skills/boilerplate/`):
- `targets.tsv`에 `invariant_tracking ∈ {none, policy_only, partial, full, auto}` 컬럼 추가
- `boilerplate-sync-docs.sh coverage` 서브커맨드 (declared/detected/effective 3-way 비교, --update / --report 플래그)
- aggregation: `boilerplate/docs/_generated/adoption_report.md` (사용자가 redirect로 작성)

**Migration phases** (마이그레이션 전략 — 사용자 hub note 추적):
- Phase 0 (active): boilerplate 자체 신구조 도입. 이 ADR 본문이 그 결과물
- Phase 1: 채택 repo 자동 sync. boilerplate-owned 자산을 `/boilerplate sync`로 도입. legacy register entry는 co-existence
- Phase 2 (deferred, user-triggered): 채택 repo의 기존 register entry를 per-file로 분할. 사용자 명시 요청 시작. invariant 채우기는 별도 task (자동 invariant inference 회피 — Round 2 폐기 사유)
- Phase 3 (deferred, 장기): register file이 fully generated artifact로 진화. validator/build가 rebuild 책임

**Local extension**: `*.local.*` additive only. boilerplate base의 required 누락 또는 forbidden 완화는 hard warning (additive_violation). project가 더 엄격한 forbidden_paths를 추가하는 등 narrowing은 허용.

**Residual risk 수용**: Case 1 paraphrase ("control critique stage" 같이 정확한 term 회피)는 LLM-only + markdown body 제약 안에서 100% 검출 불가능. 세 겹 mitigation (term file `aliases`/`detect_patterns`, validator generic proximity, AGENTS.policy.md read 의무)으로 줄이되 residual risk 인정.

## Alternatives Considered

- **A** (chosen): 위 frontmatter 확장 + per-file Q/DEC + warning validator + sync overlay 통합
  - pros: cross-doc invariant 자동 검출, sync overlay 패턴 그대로 활용, markdown body 유지로 nuance 보존, validator는 warning level이라 CI 마찰 적음, additive .local로 도메인 특수성 표현
  - cons: validator/yaml 의존 채택 repo에 추가 부담, paraphrase 100% 검출 불가, frontmatter 분량 증가
- **B** (discarded — Round 1): 본문 전체 JSON/스키마 전환
  - pros: machine readability 극대화
  - cons: nuance 손실, edit 비용, LLM-only라도 자연어 본문이 효율적, 채택 repo migration 비용 폭발
- **C** (discarded — Round 1): 현상 유지 + AGENTS.md instruction 강화
  - pros: 변경 비용 0
  - cons: instruction 강제는 검증 불가능 — Round 3 codex가 circular 문제로 reframe (frontmatter `reviewed_*` artifact가 검증 가능한 대안)
- **D** (discarded — Round 1): pre-commit hook으로 hard-fail
  - pros: 즉각적 차단
  - cons: LLM 환경 의존성 + 우회 쉬움 + false positive 비용 — warning level로 결정
- **E** (discarded — Round 2): 자동 invariant inference 마이그레이션 도구
  - pros: 채택 repo의 기존 register entry 자동 분할 + invariant 추론
  - cons: LLM의 invariant 추론 신뢰도 낮음 — Phase 2를 사용자 명시 트리거로, invariant 채우기는 별도 task로 분리
- **F** (discarded — Round 5): codex `.boilerplate/adoption.yaml` per-repo marker
  - pros: 채택 상태가 repo 안에 명시
  - cons: per-repo marker 분산 — 사용자 카운터로 `targets.tsv` 컬럼 + `coverage` 서브커맨드 통합 채택 (중앙집중 owner 유지)
- **G** (discarded — implementation gap, 2026-05-09): Q/DEC를 register file 안 inline `### Q-XXX` entry로 유지하면서 entry당 fenced YAML block
  - pros: register 단일 파일 유지
  - cons: 표준 frontmatter validator 재사용 불가, parsing 복잡 — per-file 분리 (옵션 B) 채택

## Consequences

- **긍정**:
  - cross-doc invariant 위반의 자동 검출 가능 (Case 1·Case 2 모두 dry-run fixture로 regression 검증)
  - LLM이 작업 시작 시 generated artifacts (`scope_tree.yaml`, `term_usage.yaml`)를 read해서 invariant context를 구조화된 형태로 받음
  - `reviewed_*` artifact가 AGENTS instruction의 circular 문제 회피 — 측정 가능한 self-check
  - relation/term schema가 evidence carrier로 silent miss 방지
  - sync overlay (`.policy.md` + Tier 1/2/3 + `/boilerplate migrate`) 패턴으로 1회 sync에 모든 채택 repo에 전파
  - Phase 분리로 채택 repo 마이그레이션 부담을 사용자가 repo별로 결정

- **부정 / trade-off**:
  - 채택 repo가 `yaml` npm package + Bun/Node runtime 의존
  - frontmatter 분량 증가 — Q/DEC당 ~20 lines, ADR당 ~30 lines metadata
  - validator complexity (10+ 모듈) — 유지보수 비용
  - paraphrase residual은 100% 검출 불가 (수용)
  - Phase 1 co-existence 동안 validator가 두 형식 (per-file + legacy register) 모두 인식 — 일시적 복잡성
  - register file을 stub으로 단축하는 변경이 기존 채택 repo의 internal link를 일부 깨뜨릴 수 있음 (Phase 1에서 사용자가 점진 정리)

- **후속 작업**:
  - Phase 1: 채택 repo 자동 sync trigger (`/boilerplate sync` repo별)
  - Phase 2 (deferred): 사용자 트리거 시 actwyn 등 기존 register entry 분할
  - Phase 3 (deferred): register → generated artifact 진화
  - `bun run scripts/validate_invariants.ts --regenerate` 으로 ADR-0002 자기 검증 (이 ADR이 신구조의 첫 self-check 사례)
  - `coverage --report` 첫 실행 후 boilerplate `docs/_generated/adoption_report.md` commit
  - migration helper 스킬 (Phase 2 가속) 검토는 future work — 자동화 회피 사유 그대로 유지

## References

- ideation 출처: `~/ws/second-brain/02. Ideation/boilerplate-doc-invariant-tracking.md` (Round 1~5, 2026-05-05~05-08)
- project hub: `~/ws/second-brain/05. Projects/boilerplate-invariant-tracking.md` (Phase 0~3 추적)
- 발견 컨텍스트 (do not touch): `~/ws/actwyn-q069-wip` worktree, branch `docs/q-069-wip`
- 관련 인프라 ideation: `~/ws/second-brain/02. Ideation/boilerplate-sync-overlay-architecture.md`
- Codex adversarial review (Round 3·4·5): ideation 노트 Revision log 참조
- 관련 스키마 인프라 (참고용, 다른 purpose): `~/ws/second-brain/_System/Schemas/json/*.schema.json`
- Sync infra 변경: `alxdr3k/my-skill@017c047` (`targets.tsv` + `boilerplate-sync-docs.sh coverage`)
