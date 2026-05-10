# Extraction Template

Use this when closing a milestone, final retrospective, discovery note, or
register entry that produced reusable knowledge.

This packet only proposes candidates. The external knowledge base decides final
placement, schema, sensitivity, ingestion, and promotion.

## Scope

- Project:
- Source document: <path inside project repo>
- Milestone / document:
- Date:
- Related PR:
- Related ADR / DEC / Q:
- External knowledge base target:
- Extraction owner:

## Candidate Table

| ID | Kind | Candidate | Evidence / source | Proposed target | Action | Confidence | Notes |
|---|---|---|---|---|---|---|---|
| EX-001 | lesson_candidate |  |  |  | promote | low / medium / high |  |
| EX-002 | do_not_promote |  |  |  | drop | low / medium / high |  |

Allowed `Kind` values:

- `project_hub_update`
- `adr_candidate`
- `lesson_candidate`
- `resource_candidate`
- `do_not_promote`
- `open_question`
- `current_state_update`
- `negative_knowledge`
- `other`

Allowed `Action` values:

- `create` - create a project or knowledge-base artifact.
- `modify` - update an existing artifact.
- `promote` - propose distilled content for the external curated knowledge base.
- `drop` - deliberately do not promote into the external curated knowledge base.

Rules:

- Every row is a candidate until the target knowledge base accepts it.
- `drop` means "not promoted"; it does not delete the source.
- Do not promote raw Q&A, drafts, temporary comparison tables, stale plans,
  rejected recommendations, sensitive content, or project-only details.
- Distill raw material into a lesson, resource note, ADR candidate, or project
  hub update before proposing promotion.
- Do not duplicate project-specific decisions already captured in DEC/ADR.

## Do Not Promote

Do not leave this blank. Use `None — reviewed` only after explicit review.

| Item | Reason | Keep where? |
|---|---|---|
|  |  | project repo / artifact store / transcript / nowhere |

## Source Anchors

Preserve anchors so downstream readers can trace candidates back to source.
If an anchor is missing, write `anchor missing`; do not fabricate it.

| Candidate ID | Repo | Path | Commit | PR | ADR / DEC / Q | Notes |
|---|---|---|---|---|---|---|
| EX-001 | `<owner/project>` | `docs/...md` | `<SHA>` | `<PR URL>` | `ADR-####` / `DEC-###` / `Q-###` |  |

## Report

After preparing or applying a packet, report only non-empty groups:

```text
Created:
- <path or artifact> - what was created and why.

Modified:
- <path or artifact> - what changed and why.

Promoted:
- <source> -> <target> - why this was promoted.

Dropped:
- <item> - why this was not promoted.
```
