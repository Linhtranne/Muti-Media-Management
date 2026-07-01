# Documentation Map

This repository uses story-scoped AI-SDLC artifacts. Keep files in predictable folders so agents and humans can trace requirements, plans, tests, and reports without searching the whole tree.

## Core Folders

| Folder | Purpose | Convention |
|:---|:---|:---|
| `docs/requirements` | Product backlog, SRS, function flow register | Source-of-truth product requirements |
| `docs/architecture` | System architecture and coding conventions | Source-of-truth technical constraints |
| `docs/specs` | Approved story specs | `SPEC-US-XXX.md` or `SPEC-AI-SDLC-XXX-Name.md` |
| `docs/plans` | Story implementation plans | `docs/plans/US-XXX/PLAN-US-XXX-Name.md` |
| `docs/testing` | RED/baseline/evidence artifacts | `docs/testing/US-XXX/RED-US-XXX.md` |
| `docs/reports` | Post-work reports | `docs/reports/US-XXX/REPORT-...md` |
| `docs/ai-sdlc` | AI-SDLC rules and gate templates | Project governance |
| `docs/interview` | Interview and portfolio notes | Non-production learning material |
| `docs/setup` | Local/staging setup notes | Runtime setup guidance |

## Story Artifact Set

Each production story should have:

```text
docs/specs/SPEC-US-XXX.md
docs/plans/US-XXX/PLAN-US-XXX-Name.md
docs/testing/US-XXX/RED-US-XXX.md
docs/reports/US-XXX/REPORT-US-XXX-Name-YYYY-MM-DD.md
```

## Root-Level Rule

Avoid adding loose story files directly under `docs/reports`, `docs/plans`, or `docs/testing`. Use the story folder. The only expected root files in these folders are indexes such as `README.md`.

## Validation

Run the AI-SDLC checker before claiming a story artifact is ready:

```powershell
npm run ai-sdlc:check -- US-XXX
```
