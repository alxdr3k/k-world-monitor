# Testing

> Last verified against code: b660f46 (2026-05-16) — AI-P1-7 / `INFRA-1B.3.h3-audit-hardening` code commit on branch `claude/audit-hardening-v8`. Following commits are doc-only (TESTING SHA refresh) and do NOT advance the code baseline — this SHA is the latest CODE-touching commit on the branch. AI-P1-7 = v8 audit hardening (policy_decisions ADD COLUMN upload_attempt_id + 3 BEFORE INSERT triggers: intended_action enum / r2_upload decision enum / r2_upload upload_attempt_id required) + `newUploadAttemptId()` export + `R2UploadAuditInput.uploadAttemptId` required field + snapshot-fingerprint threads ONE upload_attempt_id per r2Put attempt through BEFORE/AFTER row pair; +12 tests = 609 → 621 tests total. Tests breakdown: 10 new in `audit_policy_decisions_test.ts` (newUploadAttemptId 2 + upload_attempt_id verbatim 1 + BEFORE/AFTER correlation isolated from concurrent attempts 1 + intended_action trigger reject+allow 2 + r2_upload decision trigger reject+operator-gate untouched 2 + upload_attempt_id required trigger reject+operator-gate NULL allowed 2) + 2 new in `snapshot_fingerprint_test.ts` (new-path attempted+uploaded share one uatt + dedup back-fill attempted+uploaded share one uatt distinct from new-path). All 16 existing audit-policy-decisions tests updated to pass `uploadAttemptId: freshAttemptId()` (v8 trigger requires it). Previous code baseline = (AI-P1-12 INFRA-1B.5.h1-runbook-setup-hygiene PR #48 squash — 569 → 609). Earlier baselines: AI-P1-1 PR #47 (561 → 569), 090ca5b (AI-P1-3 PR #45 — 544 → 561), 861796a (AI-P1-2 PR #44 — 521 → 544), 327f4b2 (AI-P0-1 PR #41 — 515 → 521), 75706c4 (INFRA-1B.3.x-audit PR #39 — 490 → 515). **Pre-merge SHA reachability**: branch-local commits (`b660f46`, ...) ARE reachable while the branch exists but will NOT survive squash-merge to main; the merge commit on main is the post-merge canonical reference and the next slice's baseline header advances to that SHA. For reproducibility while the PR is open, `git fetch origin <branch>` + `git checkout b660f46` resolves correctly.

## Testing policy

- Behavior changes need verification evidence.
- Prefer test-first for bug fixes and clear behavior changes when a concise
  failing test can express the target behavior.
- Otherwise add or update tests in the same slice as the implementation.
- Bug fixes should leave regression coverage unless impractical.
- If automated coverage is not practical, record the manual check, eval, or
  reason.

## Install

```bash
bun install
```

bun + TypeScript + native bun:sqlite + neo4j-driver + Bun.S3Client.

Ruby lint (pre-INFRA-1A.2 doc governance — 별도):

```bash
ruby scripts/check-doc-governance.rb           # default mode (CI에서 실행)
ruby scripts/check-doc-governance.rb --strict  # placeholder remnant 검출 (옵션)
```

## Invariant validator (primary doc check)

```bash
# Read-only validation — exits 0 by design (warning level only)
bun run invariant:check

# Fixture regression tests — verify Case 1 / Case 2 detection
bun run invariant:fixture:scope-creep
bun run invariant:fixture:glossary-drift

# Regenerate docs/_generated/ artifacts (writes scope_tree.yaml / term_usage.yaml / effective_invariant_policy.yaml)
bun run invariant:regen
```

## Foreground recovery (write mode)

```bash
# Foreground LLM only — persists unresolved_warnings into doc frontmatter
# AND orphan_warnings.yaml. Never run from CI; ADR-0002 INV-0002-2.
bun run invariant:write
```

## Code tests (landed, M1~M2)

| Check | Local command | CI workflow / job | Required? | Notes |
|---|---|---|---|---|
| install | `bun install` | ci.yml install job | yes | bun is mandatory runtime |
| typecheck | `bun run typecheck` | ci.yml typecheck job | yes (after Q-048 resolution) | tsc --noEmit --pretty false |
| unit tests | `bun test` | ci.yml test job | yes (after Q-048 resolution) | 22 file / **621 cases** — Bun native runner (post-AI-P1-7 INFRA-1B.3.h3-audit-hardening landed: +12 tests — 10 in audit_policy_decisions_test.ts for v8 enum triggers + upload_attempt_id correlation + 2 in snapshot_fingerprint_test.ts for BEFORE/AFTER attempt id sharing; previous baseline 609 = AI-P1-12 INFRA-1B.5.h1-runbook-setup-hygiene) |
| migration dry-run | `bun run migrate --dry-run` | (manual) | recommended | verifies all v1~v8 schema files parse (v7 = policy_decisions ADD COLUMN intended_action / INFRA-1B.3.x-audit; v8 = policy_decisions ADD COLUMN upload_attempt_id + 3 enum/required triggers / INFRA-1B.3.h3-audit-hardening AI-P1-7) |
| invariant validation | `bun run invariant:check` | invariant-check.yml | no (warning only) | INV-0002-1: never hard-fails |
| fixture regression | `bun run invariant:fixture:scope-creep` | (manual / pre-PR) | recommended | Case 1 detection |
| fixture regression | `bun run invariant:fixture:glossary-drift` | (manual / pre-PR) | recommended | Case 2 detection |
| regenerate artifacts | `bun run invariant:regen` | invariant-check.yml (post-validate) | yes | writes docs/_generated/ |
| Neo4j FTS bench | `bun run bench:neo4j` | (manual, SPIKE-001) | spike only | needs Neo4j running; AC-002 p95 < 1s |
| Discovery dry-run | `bun run discovery:dry-run` | (manual) | recommended | RSS parse + queue enqueue dry-run |
| seed sources dry-run | `bun run seed-sources:dry-run` | (manual) | recommended | validates data/sources_seed.yaml |
| reproducibility manual | n/a (manual) | n/a | yes (P0-M5 gate) | AC-017 NFR-002 |

## CI / required checks

Workflow files (활성):

| File | Trigger | Required? | Notes |
|---|---|---|---|
| `.github/workflows/doc-governance.yml` | PR + workflow_dispatch | yes (required, 기존) | Ruby doc lint — duplicate / dangling / must-REQ-AC-link checks |
| `.github/workflows/ci.yml` | PR + push | **policy: required (DEC-020 Q-048 accepted) — branch protection admin task 미실시** (3-state 분리, 본 표 아래 "CI required check 등록 3-state" 참조) | bun install + typecheck + bun test (621 cases) + migrate dry-run |
| `.github/workflows/invariant-check.yml` | PR + push (paths-scoped) | advisory (warning-level by ADR-0002 INV-0002-1, never required) | bun run invariant:regen + invariant:check + fixture regression (boilerplate fixture 부재 시 informational skip) |
| `.github/workflows/doc-freshness.yml` | PR | advisory (soft warning) | DEC-020 Q-048 활성. src/scripts/tests/migrations 변경 시 thin docs / IMPLEMENTATION_PLAN / current-state / 06_ACCEPTANCE_TESTS / ADR 동반 갱신 누락 PR 코멘트 |

비활성 (rename 대기):

| File | Reason |
|---|---|
| `.github/workflows/cd.yml.example` | publishing pipeline 도입 시점 활성 (P0-M6) |

## CI required check 등록 3-state

DEC-020 Q-048 resolution 안에서 CI required check 활성은 3 단계로 분리되어
있다. 단계가 섞이면 "이미 required 인지 / 사용자 결정만 끝났는지" 가 모호해
지므로 본 표로 명시.

| Stage | 의미 | 현재 상태 (2026-05-14) | 책임 |
|---|---|---|---|
| (1) workflow exists | `.github/workflows/ci.yml` 파일이 활성 trigger 로 등록되어 PR / push 마다 실행 | ✓ done (PR #32 0a76d31, `claude/comprehensive-code-review-FE0w3` 가 rename) | repo (코드) |
| (2) policy decision accepted | 운영자가 ci.yml 을 required 로 promote 한다는 정책 결정 | ✓ done (DEC-020 Q-048 resolution, 2026-05-13) | 운영자 (DEC) |
| (3) branch protection admin task applied | GitHub repo settings → branch protection → require status check 에 `ci.yml` 명시 등록 | ✗ pending — admin task 미실시 (현재 main 은 PR-only protection 만 적용, required check 등록은 별도 admin step) | 운영자 (admin) |

(3) 이 완료되기 전까지는 ci.yml fail 이 PR merge 를 차단하지 않는다.
(1)+(2) 가 완료되었다는 사실 만으로 "required" 로 보고하는 표현은 stage
(3) 까지 lock 된 후 가능. 현재 표 column "Required?" 값은 (2) 정책 기준
("policy: required") + (3) admin 미적용 함께 명시.

invariant-check.yml 은 ADR-0002 INV-0002-1 warning-level contract 이므로
(2) policy decision = "advisory only" 로 lock — (3) 진입 대상 아님 (영구
advisory).

## CI notes (history)

- PR `claude/comprehensive-code-review-FE0w3` 가 `ci.yml.example` →
  `ci.yml` + `invariant-check.yml.example` → `invariant-check.yml` rename
  으로 (1) workflow exists stage 진입.
- 코드 테스트 (`bun test`) 는 22 file / **621 케이스** — Bun native runner
  1 분 이내 expected. History: 490 → 515 (INFRA-1B.3.x-audit PR #39) →
  521 (INFRA-1B.3.h1-policy-fix PR #41, AI-P0-1) → 544 (INFRA-1B.1.h1-
  source-bootstrap-neo4j PR #44, AI-P1-2) → 561 (INFRA-1B.3.h2-queue-cli
  PR #45, AI-P1-3) → 569 (INFRA-1B.4.h1-chunker-policy-gate PR #47,
  AI-P1-1) → 609 (INFRA-1B.5.h1-runbook-setup-hygiene PR #48, AI-P1-12)
  → **621** (INFRA-1B.3.h3-audit-hardening landed 2026-05-16: +12 tests
  for v8 audit hardening — 10 in audit_policy_decisions_test.ts
  (newUploadAttemptId + upload_attempt_id correlation + 3 v8 trigger
  enforcements: intended_action enum / r2_upload decision enum /
  upload_attempt_id required) + 2 in snapshot_fingerprint_test.ts
  (new-path + dedup back-fill BEFORE/AFTER share one upload_attempt_id),
  AI-P1-7).
- External CI owner: same repo (.github/workflows/)

## Before opening a PR

- `bun run typecheck`
- `bun test`
- `bun run invariant:check`
- update relevant docs if behavior/schema/runtime changed (AGENTS.md L46-60)

---

Rules:

- List only real commands once project has code.
- If no command exists, write "No command currently defined."
- Do not invent commands.
- If CI runs a command that cannot be run locally, explain where it runs and why.
- If a check is required for merge, name the exact workflow / job.
