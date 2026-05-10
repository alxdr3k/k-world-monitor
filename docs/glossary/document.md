---
id: glossary-document
type: glossary_term
term: document
term_type: capability
defined_in: ADR-0003
last_changed_by: ADR-0003
status: active
created_at: 2026-05-11
updated_at: 2026-05-11
aliases:
  - 문서
  - source document
detect_patterns:
  - "(?i)source\\s+document"
  - "(?i)원\\s*문서"
related_invariants:
  - INV-0003-1
  - INV-0003-2
provenance: user_confirmed
sensitivity: private
retention: long_term
ai_include: true

applies_to_planes:
  - pipeline.source_layer
  - storage.markdown.document_hub
  - storage.sqlite.document_table
forbidden_paths:
  - storage.r2.bytes              # Document는 메타 entity, 원본 bytes는 Snapshot.r2_key가 가리킨다
  - pipeline.publication_layer    # Document는 publication 단계에 직접 쓰이지 않는다 (Claim → Dossier → Scenario → Draft → Publication 경유)
---

# document

## Definition

`Document`는 동일한 실체로 식별되는 출판물 1건이다. 같은 보고서가 PDF와 HTML로
동시에 제공되거나 통계 페이지가 시간에 따라 갱신되는 경우, URL이 여럿이어도
하나의 `Document`로 묶고 그 아래 시간별 `Snapshot`을 가진다.

`SourceNote = URL 1:1` 모델은 동일 문서 다중 URL / 시간 변동 / PDF+HTML 짝 /
통계 갱신을 다룰 수 없어 폐기되었다 (ADR-0003 Round 2 비판 R1).

## Why this term exists

ADR-0003에서 7-stage 파이프라인의 source layer를 Document / Snapshot / Claim
3-tier로 분리하기로 결정한 이유는 Round 2 GPT 비판이 제시한 "동일 문서 다중
URL" 케이스가 단일 SourceNote 모델로는 표현 불가능하기 때문이다. Document는
publisher 정보(필드)를 보유하고, 실제 시간별 bytes는 Snapshot이 R2 키로
가리킨다.

## Examples

- 긍정 예: IMF World Economic Outlook 2026년 4월호 (PDF + HTML 두 URL을 가짐) →
  Document 1개, Snapshot 2개 이상
- 긍정 예: WHO 주간 감염병 동향 보고 (매주 갱신) → Document 1개, 주차별 Snapshot
- 부정 예: 같은 신문사의 다른 기사 두 건 → Document 2개 (실체가 다름)
- 부정 예: PDF의 단일 표 데이터 → Document가 아니라 Snapshot 안의 chunk 단위로
  추출된 dataset claim

## Drift history

- 2026-05-11 ADR-0003 — Document/Snapshot/Claim 3-tier 도입 (initial definition)
