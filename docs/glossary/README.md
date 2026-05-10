# Glossary

Per-term file convention. 각 term은 `docs/glossary/<term-slug>.md`로 단일 파일.

## Index

| Term | Type | Defined in | Status |
|---|---|---|---|
| [`document`](document.md) | capability | ADR-0003 | active |
| [`snapshot`](snapshot.md) | capability | ADR-0003 | active |
| [`claim`](claim.md) | lifecycle | ADR-0003 | active |
| [`dossier`](dossier.md) | capability | ADR-0003 | active |
| [`scenario`](scenario.md) | capability | ADR-0003 | active |
| [`content_draft`](content-draft.md) | lifecycle | ADR-0003 | active |
| [`publication`](publication.md) | lifecycle | ADR-0003 | active |
| [`edge`](edge.md) | capability | ADR-0007 | active |
| [`reliability_tier`](reliability-tier.md) | capability | ADR-0005 | active |
| [`extraction_confidence`](extraction-confidence.md) | capability | ADR-0005 | active |
| [`evidence_quote`](evidence-quote.md) | capability | ADR-0008 | active |

## 규칙

- 한 term 한 파일. 파일명은 lowercase, 공백은 `-`로.
- 템플릿: `docs/templates/GLOSSARY_TERM.md` 복사
- frontmatter 스키마: `docs/templates/glossary_term_schema.yaml`
- term_type ∈ {`lifecycle`, `role`, `capability`} (확장 시 `glossary_term_schema.local.yaml`로 additive 추가)

## 정의 권리

- `defined_in: ADR-####` — 이 term의 의미를 정의하는 ADR
- 동일 term을 여러 ADR이 정의하려고 하면 validator가 hard warning
- 기존 term의 의미를 바꾸려면:
  1. 새 ADR 생성 (또는 기존 ADR supersede)
  2. 새 ADR이 `defines: [{term: "<term>", role: "primary"}]` 선언
  3. term file의 `last_changed_by`를 새 ADR로 업데이트
  4. Q/DEC가 term의 attribute를 바꾸려면 frontmatter `term_effects[]`로 명시 (Case 2 body-only drift 차단)

## Local extension

세 가지 경로:

- `docs/templates/relation_enum.local.yaml` — relation enum 추가/narrow
- `docs/templates/glossary_term_schema.local.yaml` — term_type 추가/narrow
- `docs/glossary/<term>.local.md` — per-term 추가 forbidden_paths/aliases (additive only)

`<term>.local.md` 동작 방식:

- parse.ts가 `*.local.md`를 base term과 별도 collection으로 인식
- main entry가 base term + overlay를 merge:
  - `forbidden_paths`: base ∪ overlay (더 엄격하게만 narrow 가능)
  - `aliases`: base ∪ overlay (paraphrase 추가 식별)
- 그 외 frontmatter 필드를 overlay에 담으면 `additive_violation` warning
- overlay에 frontmatter.term이 없으면 또는 base term 파일이 없으면 warning

term semantics 자체를 변경하려면 (`states[].release_paths` 같은 lifecycle 핵심 변경)
overlay가 아니라 ADR을 새로 작성해 supersede.

## Validator 체크 항목

1. frontmatter common_required 모두 채워졌는가
2. term_type별 required 필드 모두 채워졌는가
3. defined_in이 가리키는 ADR이 실재하는가 + 그 ADR의 `defines[]`에 이 term이 있는가
4. body에 detect_patterns / aliases가 등장하는데 reviewer가 cite 안 한 Q/DEC 있는가 (paraphrase detection)
5. 같은 term을 두 ADR이 동시에 defines[]로 선언하면 hard warning
