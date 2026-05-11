---
term: editorial_intent
type: glossary
status: accepted
created_at: 2026-05-11
updated_at: 2026-05-11
attributes:
  category: capability
  release_paths: [v0, v1]
defined_by: [adr-0025]
---

# editorial_intent

## Definition

운영자의 **발행 의도** (authorial / editorial intent) 를 명시적으로 캡처
하는 10-stage object model (ADR-0025) 의 7번째 stage. Scenario revision
과 Thesis 사이의 anchor 로, 같은 source + scenario 로도 운영자가 어떤
의도로 어떤 주장을 어떤 audience 에게 전달하려 하는지가 thesis stance /
market_stance 선택에 표면화되도록 한다.

## Fields

- `eit_id` (str, PK) — `eit_<sha256[0:10]>` prefix
- `purpose` (str) — 발행 목적 한 줄
- `audience` (str) — 타겟 독자
- `tone` (enum) — informational / cautionary / explainer / opinion / debate_trigger
- `call_to_action` (str, nullable)
- `alignment_criteria` (str[]) — claim / scenario branch 선택 기준선
- `exclusion_criteria` (str[]) — 의도적으로 제외할 axis
- `bidirectional_weight_intent` (enum) — risk_observer / opportunity_observer
  / resilience / asymmetric / balanced (ADR-0019 4축 중 운영자 weight)
- `related_dossier_ids` (str[])
- `related_scenario_revision_ids` (str[])
- `decided_by_operator` (bool) — 운영자 명시 승인 (INV-0025-4, false 면
  ContentDraft composer reject)
- `created_at` (iso datetime)

## Storage

- Neo4j `EditorialIntent` 노드 + `:HAS_INTENT` (Thesis → EditorialIntent)
  + `:USES_INTENT` (ContentDraft → EditorialIntent) relationship
- Markdown vault `vault/editorial_intents/<eit_id>.md` (사람용 view)
- 자체 사이트 비노출 (ADR-0022 INV-0022-4 internal canonical 보존)

## Workflow

1. LLM 자동 propose (선택, Tier 1 GPT-5.5 Pro standard, ADR-0023)
2. 운영자 명시 lock (CLI `pipeline intent lock <eit_id>`)
3. Thesis composer 진입 (`pipeline thesis compose <scn_rev_id> --intent <eit_id>`)
4. ContentDraft composer 진입 (`pipeline draft compose <ths_id> --format
   blog_long --intent <eit_id>`)
5. Publication preflight cite check 5+1 trace path 에 포함

## Notes

- ADR-0025 가 정의 권한 보유 (defined_by)
- ADR-0019 의 4축 (risk / opportunity / resilience / asymmetric) bidirectional
  framing 의 운영자 weight 표면화
- NFR-002 reproducibility 강화 — 같은 source + scenario revision + intent
  면 동일 thesis + draft 도달
