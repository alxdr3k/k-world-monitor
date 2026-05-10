# Operations

Status: template.

## Local run

## Environment variables

## Database

## Logs / observability

## Background jobs

## Deployment

### Environments

| Environment | Purpose | Trigger | Owner | Gate | Rollback / recovery |
|---|---|---|---|---|---|
| local |  |  |  |  |  |
| preview |  |  |  |  |  |
| staging |  |  |  |  |  |
| production |  |  |  |  |  |

### CD / release pipeline

- CD owner:
- Workflow / platform:
- Release source: main / tag / release branch / package registry / external
- Artifact identity: commit SHA / tag / image digest / package version / other
- Production approval:
- Post-deploy smoke check:

### Secrets / configuration

- Secret storage:
- Rotation owner:
- Build-time config:
- Deploy-time config:

### Rollback / recovery

- Rollback owner:
- Rollback trigger:
- Rollback command or platform action:
- Data recovery assumptions:

## Troubleshooting

---

Rules:

- Include only verified operations.
- If deployment is owned by CI/CD, say so.
- Remove environment rows that do not exist.
- If no deployment pipeline exists, write "No deployment pipeline currently defined."
- Do not invent manual deployment steps.
- Do not document secret values.
- Link detailed step-by-step procedures to `docs/05_RUNBOOK.md`.
