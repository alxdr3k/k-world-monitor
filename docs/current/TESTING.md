# Testing

> Last verified against code: pending merge SHA (2026-05-18) — Cycle 13 / `INFRA-1A.x-shared-snapshot-id-constants` follow-up — writer-side `formatSnapIdRationalePrefix` helper (Cycle 12 Opus review P3 informational defer 처리, symmetric drift surface 종결). Previous code baseline = c996775 (PR #69 INFRA-1A.x-shared-snapshot-id-constants squash merge to main, 2026-05-18, 816 tests on main). **Cycle 13 changes (pending merge SHA)**: (1) `src/domain/snapshot-id.ts` 에 `formatSnapIdRationalePrefix(snapId): string` helper 추가 — return `\`snap_id=${snapId}\`` (bare field, no trailing delimiter; caller joins with `"; "` separator). (2) `src/storage/audit/policy-decisions.ts` `formatRationale()` 의 inline `\`snap_id=${input.snapId}\`` literal → helper 호출로 전환. writer 와 reader (`RATIONALE_SNAP_ID_PREFIX_REGEX`) 의 `snap_id=` 필드명을 같은 module 안에 정렬하여 한쪽 update without the other 의 silent drift 차단. (3) +4 tests `tests/unit/snapshot_id_test.ts` `formatSnapIdRationalePrefix` describe — build / round-trip via `parseSnapIdFromRationale` with `;` separator / round-trip end-of-string / no caller-side validation 명시 = 816 → 820 tests. **No behavior change** — helper is pure function returning byte-identical string. **Cycle 12 changes (landed via c996775)**: (1) `src/domain/snapshot-id.ts` 신규 — single source of truth `SNAPSHOT_ID_REGEX` + `RATIONALE_SNAP_ID_PREFIX_REGEX` + `SNAPSHOT_R2_KEY_PREFIX` + `snapshotR2Key()` + `validSnapIdOrNull()` + `assertValidSnapId(value, context?)` + `parseSnapIdFromRationale()` (zero imports, domain layer purity). (2) 4 consumer site refactor — `src/storage/audit/policy-decisions.ts` local `SNAP_ID_SHAPE` 제거 + `assertValidSnapId` thin wrapper passing `"recordR2UploadDecision"` context (byte-compatible error message preserved); `src/ops/r2-invariant-scanner.ts` 3 local const (`SNAPSHOT_R2_KEY_PREFIX` / `SNAP_ID_RATIONALE_PREFIX` / `SNAP_ID_SHAPE`) + 2 internal validator function 제거 + reader-boundary `parseSnapIdFromRationale` / `validSnapIdOrNull` re-export (downstream importers unchanged); `src/discovery/worker/snapshot-fingerprint.ts` 2 inline `permitted_artifact/derived/snapshot/${snapId}` template → `snapshotR2Key()`; `src/storage/r2/policy.ts` `PERMITTED_PREFIXES[5]` literal → `SNAPSHOT_R2_KEY_PREFIX` import. (3) +18 tests `tests/unit/snapshot_id_test.ts` — shape regex (2) + R2 prefix literal + slash-termination (2) + `snapshotR2Key` (2) + `validSnapIdOrNull` (2) + `assertValidSnapId` 4 variants (well-formed / malformed regex / context-prefix / no-context) + `parseSnapIdFromRationale` (6 — canonical + end-of-string + null/empty + non-anchored + 5 invalid-trailing-char regression + space-no-semicolon) + `RATIONALE_SNAP_ID_PREFIX_REGEX` capture (1) = 798 → 816 tests. **No behavior change** — Opus adversarial review NO ACTIONABLE FINDINGS (7 obligation pass: behavior drift / layering / drift-surface scan / re-export pattern / stale comment scan / test coverage / import path arithmetic). Informational defer: writer-side `formatRationale()` 의 `\`snap_id=${input.snapId}\`` literal (5번째 잠재 consolidation 후보, 본 slice scope 외 — 별도 `formatSnapIdRationalePrefix()` helper 추출 후속 cycle 가능). **Cycle 11 changes (pending merge SHA)**: (1) `src/pipeline/policy-gate/risk-triggers.ts` 신규 — `RiskTriggerContext` + 8 detector (`detectExternal LlmRawTextUnauthorized` / `detectPaywalledSourceFetch` / `detectTermsViolation` / `detectWireServiceFullText` / `detectArticleRawQuoteOrCache` / `detectImageInclusionWithoutLicense` / `detectRawEmbedding` / `detectRawCloudUpload`) + `detectRisks()` + `stageDefaultMode()` + `evaluatePolicyGate()` (pure function, no SQLite I/O); (2) `src/pipeline/policy-gate/decision-ledger.ts` 신규 — `recordPolicyGateDecision()` generic writer (operator-gate namespace, intended_action=NULL, v8 r2_upload enum trigger bypass via WHEN clause) + `NON_RISK_TRIGGER_TYPE` sentinel + writer-boundary enum guards; (3) `src/utils/enums.ts` 확장 — `POLICY_GATE_MODE` (3) + `GATE_DECISION` (3: allow/warn/block) + `RISK_TRIGGER` (8 = ADR-0017 INV-0017-4 List A canonical) + `PIPELINE_ACTION` (11) + `PIPELINE_STAGE` (5 = ADR-0017 INV-0017-3 default mode mapping); (4) `tests/policy/gate_test.ts` 신규 — 53 tests (6 stageDefaultMode + 24 detectRisks 8 trigger fire/not-fire/mode-invariance/multi-trigger + 8 evaluatePolicyGate combined + 6 recordPolicyGateDecision namespace + writer-boundary + 9 TEST-023 E2E 8 trigger × ledger × INV-0017-4 mode-invariance). +53 tests initial + 3 tests Codex PR #68 round 1 P1 fix (wire-service bare AP alias + AFP / TASS word-boundary regex + 5 false-positive defense cases) + 3 tests Codex PR #68 round 2 fix (P2 detectExternalLlmRawTextUnauthorized sourceId=null fail-closed even when externalLlmPolicy='allowed' + P1 detectTermsViolation extended to external_llm_call_with_raw_text + external_llm_call_with_excerpt — terms 'no AI / no redistribution' clause coverage) + 6 tests Codex PR #68 round 3 fix (P1 detectExternalLlmRawTextUnauthorized intended_action 확장 = external_llm_call_with_raw_text + external_llm_call_with_excerpt 둘 다 enforce + P2 detectWireServiceFullText sourceName missing fail-closed when sourceId registered) + 5 tests GPT review post-PR-#68 옵션 D fix (Reuters Institute negative lookahead + `Reuters` / `Reuters News` / `Reuters Wire` positive regression + 3 runtime fail-closed boundary guards: stageDefaultMode + evaluatePolicyGate invalid stage / invalid intendedAction) = 717 → 787. Previous code baseline = fdb847a (Cycle 10 INFRA-1B.3.h7-gate-evidence-hardening, post-#65 review followup). Earlier baseline = 17a31ef (2026-05-17) — Cycle 9 / `OPS-1B.h4-r2-audit-column-rationale-drift-axis` (post-#58 GPT review 의 Issue 6 finding 종결, backward-compat contract hygiene). **Cycle 10 changes (landed via fdb847a)**: (1) `parseSnapIdFromRationale` regex 에 `(?=;|$)` delimiter lookahead 추가 — pre-Cycle-10 partial match 가 invalid trailing char (`@`, `.`, `/`, `=`) 통과시켜 Axis 5 silent + Axis 6 truncated comparison 의 root cause; (2) snapshot-fingerprint.ts `skipped_toctou` rationale 의 `mergeMatchedExisting` 분기 (first-create vs MERGE-matched 정확 attribution); (3) `assertValidSnapId` docstring 정정 — "snap_<ULID>" over-claim → "weak token shape, strong ULID guarantee at generation site"; (4) doc drift sweep 5 위치 (본 header / RUNTIME / DATA_MODEL / current-state / IMPL_PLAN). +7 tests (Finding 1 regression). Cycle 9 = AI-P1-15 의 v9 column 도입 + Cycle 8 의 cause-qualified naming 위에서 **column ↔ rationale dual-write contract violation surface** 추가 — `r2_audit_column_rationale_drift` (Axis 6) 가 `recordR2UploadDecision` dual-write 의 divergence 를 explicit violation 으로 노출. 발화 조건 = column + rationale 둘 다 well-formed 인데 서로 다른 snap_id (manual SQL repair / writer format regression / fixture mistake 등). column-only / rationale-only / both-null cases 는 silent (axis 5 or column-preferred resolution 영역). R2UploadOutcomeAuditRow shape 확장 = `columnSnapId` + `rationaleSnapId` raw fields 노출 (`snapId` resolved 값은 backward-compat). +6 tests = 704 → 710 tests total. Tests breakdown: 1 drift detection (column ≠ rationale 둘 다 well-formed) + 1 same-value silent + 1 column-null v8- legacy silent + 1 rationale-null column-preferred silent + 1 both-null Axis 5-only + 1 fetchR2UploadOutcomeAuditRows integration through SQLite read path. 16 existing tests 가 columnSnapId/rationaleSnapId field 로 갱신 (python script 로 일괄 — snapId === rationaleSnapId === columnSnapId canonical happy path 채택). Previous code baseline = 116c9ed (Cycle 8 PR #63 — 700 → 704 + Codex P1/P2 round 1 fix + 옵션 a/c 합산). Cycle 8 = AI-P1-13 의 narrow-scope axis naming + missing skipped_toctou coverage 종결: (1) `R2InvariantViolationType` rename `r2_object_without_graph_key` → `r2_object_without_graph_key_set_failed` (cause-qualified naming — scanner all-clear 의 의미를 정확히 좁힘); (2) 신규 Axis 4b `r2_object_without_graph_key_policy_recheck_skipped` 추가 (skipped_toctou audit row 도 R2 object orphan 상태 surface — 운영자 remediation 이 다름: 단순 rerun-SET 금지); (3) 두 orphan axis details 에 `expectedR2Key = permitted_artifact/derived/snapshot/${snapId}` 출력 (repair-CLI / 운영자 cleanup 직접 사용); (4) CLI formatter + counts 출력에 skipped_toctou 분리. +4 tests = 700 → 704 tests total. Tests breakdown: +1 in Axis 4 describe ("does NOT flag skipped_toctou rows" 정리) + 3 new in Axis 4b describe (skipped_toctou → orphan + does NOT mix with Axis 4 + malformed skipped_toctou → Axis 5). 4 기존 test 가 cause-qualified naming + expectedR2Key assertion 으로 갱신. Previous code baseline = d3ae654 (Cycle 7 PR #62 — 684 → 700). Earlier baselines: 8ac999b (Cycle 6 PR #61), cdd1faf (AI-P1-15 PR #57), 01f029f (AI-P1-14 PR #56), f081e50 (AI-P1-13 PR #54), 2f6ce43 (AI-P0-2 PR #53). Tests breakdown: 2 in audit_policy_decisions_test.ts (snap_id column dual-write + attempted/outcome pair sharing snap_id) + 4 in r2_invariant_scanner_test.ts (v9 column preferred over rationale, legacy v8- rationale fallback, malformed legacy row surfaces Axis 5, mixed v8/v9 resolves via own path). Previous code baseline = 01f029f (AI-P1-14 / INFRA-1B.1.h3-seed-sources-argv-allowlist PR #56 — 662 → 674). Earlier baselines: f081e50 (AI-P1-13 PR #54 — 652 → 662), 2f6ce43 (AI-P0-2 PR #53 — 647 → 652), 6500651 (AI-P1-6 PR #50 — 623 → 647), b660f46 (AI-P1-7 PR #49 — 609 → 623), 31abe60 (AI-P1-12 PR #48 — 569 → 609), AI-P1-1 PR #47 (561 → 569), 090ca5b (AI-P1-3 PR #45 — 544 → 561), 861796a (AI-P1-2 PR #44 — 521 → 544), 327f4b2 (AI-P0-1 PR #41 — 515 → 521), 75706c4 (INFRA-1B.3.x-audit PR #39 — 490 → 515). **Pre-merge SHA reachability**: `git fetch origin <branch>` resolves the branch SHA while the PR is open; post-squash-merge, the merge commit on main is the canonical reference and the next slice's baseline advances.

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
| unit tests | `bun test` | ci.yml test job | yes (after Q-048 resolution) | 26 file / **798 cases** — Bun native runner (post-Cycle-10 INFRA-1B.3.h7-gate-evidence-hardening pending: +7 tests in r2_invariant_scanner_test.ts parseSnapIdFromRationale describe — invalid trailing char (`@` / `.` / `/` / `=`) + whitespace-no-semicolon + end-of-string lone snap_id + canonical happy path; previous baseline 710 = Cycle 9 OPS-1B.h4-r2-audit-column-rationale-drift-axis). |
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
| `.github/workflows/ci.yml` | PR + push | **policy: required (DEC-020 Q-048 accepted) — branch protection admin task 미실시** (3-state 분리, 본 표 아래 "CI required check 등록 3-state" 참조) | bun install + typecheck + bun test (798 cases) + migrate dry-run (pending migration listing only — actual parse/apply validation is `DEPLOY-1A.0-migration-validation` slice 영역, Cycle 10 Finding 4 claim correction) |
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
- 코드 테스트 (`bun test`) 는 26 file / **798 케이스** — Bun native runner
  1 분 이내 expected. History: 490 → 515 (INFRA-1B.3.x-audit PR #39) →
  521 (INFRA-1B.3.h1-policy-fix PR #41, AI-P0-1) → 544 (INFRA-1B.1.h1-
  source-bootstrap-neo4j PR #44, AI-P1-2) → 561 (INFRA-1B.3.h2-queue-cli
  PR #45, AI-P1-3) → 569 (INFRA-1B.4.h1-chunker-policy-gate PR #47,
  AI-P1-1) → 609 (INFRA-1B.5.h1-runbook-setup-hygiene PR #48, AI-P1-12)
  → 623 (INFRA-1B.3.h3-audit-hardening PR #49: +12 tests v8 audit
  hardening + +2 Codex P2 round 1 whitespace TRIM trigger, AI-P1-7)
  → 647 (OPS-1B.h1-runtime-invariant-scanner landed 2026-05-16:
  +24 tests in r2_invariant_scanner_test.ts for 3-axis reconciliation
  Snapshot↔policy↔audit — parseSnapIdFromRationale 5 + reconcile axes
  9 + SQLite fetchers 5 + Neo4j fetcher 2 + scanR2Invariants
  orchestrator 2 + combined 1, AI-P1-6)
  → 652 (INFRA-1B.3.h4-dedup-r2-backed-link-policy-fix landed
  2026-05-16: +5 tests in snapshot_fingerprint_test.ts cross-source
  archive_policy guard dedup-link path describe block — 3 archive_policy
  reject (metadata_only / excerpt_only / do_not_collect with
  allowed_public_data_only) + 1 raw_cloud_policy=always_prohibited
  preserve regression + 1 positive case, AI-P0-2 P0 legal-safety
  hotfix closing the dedup-link call site missed by PR #41)
  → 662 (OPS-1B.h2-r2-invariant-scanner-orphan-axis landed
  2026-05-16: +10 tests in r2_invariant_scanner_test.ts — 3
  fetchR2UploadOutcomeAuditRows (broadened SQL + malformed surfacing +
  backward-compat wrapper) + 3 Axis 4 r2_object_without_graph_key
  (set_r2_key_failed_neo4j orphan emit + recovery defensive emit +
  uploaded-no-emit) + 3 Axis 5 malformed_r2_upload_audit_row (uploaded
  malformed + set_r2_key_failed_neo4j malformed + rationale prefix
  truncation) + 1 orchestrator integration with ScanCounts new fields,
  AI-P1-13 P1 gate-blocker hotfix for PR #50 scanner blind spot)
  → 674 (INFRA-1B.1.h3-seed-sources-argv-allowlist landed
  2026-05-16: +12 tests in new file seed_sources_argv_test.ts — 5
  accept (empty + --dry-run + --neo4j + --preflight + all-3 combined)
  + 5 reject (--dryrun typo, --dry_run typo, --Neo4j capitalization,
  --dryrun mixed with --neo4j critical silent-write risk, positional
  arg) + 1 multi-unknown reporting + 1 KNOWN_FLAGS export shape,
  AI-P1-14 hygiene PR applying PR #45 parseArgs allowlist pattern to
  seed-sources CLI to close the silent-write risk of typoed
  `--dryrun --neo4j`)
  → 684 (INFRA-1B.3.h5-policy-decisions-snap-id-column-v9 landed
  2026-05-16: +10 tests = +2 in audit_policy_decisions_test.ts
  (snap_id column dual-write + attempted/outcome pair sharing snap_id)
  + +4 in r2_invariant_scanner_test.ts (v9 column preferred over
  rationale, legacy v8- rationale fallback, malformed legacy row
  surfaces Axis 5, mixed v8/v9 resolves via own path) + Codex PR #57
  P2 round 1 +4 validSnapIdOrNull guard (shape validator + empty-string
  column → rationale fallback + garbage column → rationale fallback +
  both anchors bad → Axis 5 surface preserved); AI-P1-15 v9 migration
  adds policy_decisions.snap_id TEXT column + partial INDEX + Codex
  PR #57 P1 schema_migrations record fix; closes AI-P1-13 follow-up
  where scanner depended on free-form rationale regex — structural
  column makes future format changes safe)
  → **700** (INFRA-1B.3.h6-policy-decisions-snap-id-schema-hardening
  Cycle 7 landed 2026-05-17: +16 tests = +8 in audit_policy_decisions
  _test.ts (assertValidSnapId shape validator × 4 [canonical / empty /
  missing prefix / invalid chars] + error-message JSON-stringify × 1 +
  recordR2UploadDecision writer-boundary integration × 3 [malformed →
  no INSERT / empty → reject / canonical → INSERT]) + +9 in new file
  migrate_v9_integration_test.ts (v9 fresh-apply column / partial
  index / schema_migrations row / post-v9 INSERT × 4 + re-apply
  duplicate-column [full SQL throws / migrate.ts recovery branch
  clean] × 2 + version ordering [description anchor + prior-version
  preserve] × 2 + 1 description-pattern lock); Cycle 7 closes the
  AI-P1-15 "first-class structured handle" contract by adding
  writer-boundary shape fail-fast at recordR2UploadDecision entry
  + migration path integration test that v8→v9 ALTER works + DATA_MODEL
  sync. Reader-side validSnapIdOrNull stays as defense-in-depth for
  legacy / out-of-band SQL writes).
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
