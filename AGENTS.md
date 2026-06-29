# AGENTS.md — GPT Codex Instructions

> This file instructs OpenAI Codex/GPT to follow project conventions and load specialist skills.

## 0. Mandatory Boot Sequence (FAIL-CLOSED)

Before answering implementation, planning, review, debugging, status, or readiness questions in this repository, you MUST read the boot files below in this order:

1. `.agents/rules/core-protocol.md`
2. `.agents/rules/request-routing.md`
3. `.agents/rules/quick-reference.md`
4. `.agents/rules/ai-sdlc-rules.md`
5. `.agents/memory/MEMORY.md`
6. `docs/ai-sdlc/00_PROJECT_MOC.md`
7. `docs/ai-sdlc/01_AI_WORKING_RULES.md`
8. `docs/ai-sdlc/02_VALIDATION_GATE.md`
9. `docs/ai-sdlc/03_STORY_STATUS_TEMPLATE.md`

If these files have not been read in the current session, STOP. Do not plan, code, review, debug, or answer readiness until the boot sequence is complete.

The first response for any task that touches this repo must include this boot proof:

```text
Boot files read: yes/no
Selected agent(s): ...
Selected skill(s): ...
Spec status: ...
Validation gate: ...
Next allowed action: ...
```

Rules:
- If `Boot files read` is `no`, the only allowed action is reading the missing boot files.
- For feature or behavior changes, no approved spec means no code.
- For implementation work, no plan means no implementation.
- For bug fixes or new behavior, no failing test/check means no production change.
- For completion claims, no command output means no "done" report.

## Project Context

MediaOps Composability — Multi-channel media operations platform. Architecture: Composability (Airtable + Notion + AI Middleware + MCP Server + RabbitMQ + Postgres + Slack).

## 1. Before Coding: Read Project Docs

Before any implementation:
1. Read `docs/architecture/06_Architecture_Composability.md` for system architecture
2. Read `docs/architecture/11_Coding_Convention.md` for code rules
3. Read `docs/requirements/05_Function_Flow_Logic_Register.md` for the function you're implementing
4. Check `docs/requirements/04_Product_Backlog.md` for acceptance criteria

## 2. Code Rules

- Use TypeScript for services.
- Platform API code goes inside MCP server only, NOT orchestrator.
- Shared contracts in `packages/shared-contracts`.
- Policy rules in `packages/policy-engine`.
- No raw token in logs, Airtable, Slack, or audit metadata.
- Every external event needs idempotency key.
- RabbitMQ messages: references only, not raw tokens or large payloads.
- Workers must ack only after Ledger state is updated.

## 3. Spawner Skills Integration

**Load specialist knowledge from `~/.spawner/skills/` before implementing.**

Before coding any domain-specific task:
1. Check if a matching Spawner skill exists at `~/.spawner/skills/<category>/<skill>/skill.yaml`
2. Read `skill.yaml` for patterns and anti-patterns
3. Read `sharp-edges.yaml` for pitfalls to avoid
4. Apply the knowledge silently

### Mapping Table

| Task Domain | Spawner Skill Path |
|:---|:---|
| Queue/workers/RabbitMQ | `~/.spawner/skills/backend/queue-workers/` |
| Event-driven architecture | `~/.spawner/skills/backend/event-architect/` |
| Slack bot/commands | `~/.spawner/skills/integrations/slack-bot-builder/` |
| LLM/AI integration | `~/.spawner/skills/ai/llm-architect/` |
| Prompt engineering | `~/.spawner/skills/ai-agents/prompt-engineer/` |
| PostgreSQL/database | `~/.spawner/skills/data/postgres-wizard/` |
| Drizzle ORM | `~/.spawner/skills/data/drizzle-orm/` |
| Content strategy | `~/.spawner/skills/marketing/content-strategy/` |
| API design | `~/.spawner/skills/backend/api-design/` |
| MCP server tools | `~/.spawner/skills/ai-agents/agent-tool-builder/` |
| Crisis/escalation | `~/.spawner/skills/communications/crisis-communications/` |
| Multi-agent orchestration | `~/.spawner/skills/ai-agents/multi-agent-orchestration/` |

### File Priority

1. **`skill.yaml`** — Core patterns (always read)
2. **`sharp-edges.yaml`** — Gotchas and pitfalls (always for implementation)
3. **`validations.yaml`** — Code checks (when reviewing code)
4. **`collaboration.yaml`** — Cross-domain insights (multi-component tasks)

Windows path: `C:\Users\Hi\.spawner\skills\`

## 4. AG Kit Agent Knowledge

Additional specialist knowledge lives in `.agents/agent/` and `.agents/skills/`. When these are relevant, read the matching agent file and the relevant skill `SKILL.md` before implementation.

| Domain | Agent File |
|:---|:---|
| Backend/API | `.agents/agent/backend-specialist.md` |
| Database | `.agents/agent/database-architect.md` |
| Security | `.agents/agent/security-auditor.md` |
| DevOps | `.agents/agent/devops-engineer.md` |
| Debugging | `.agents/agent/debugger.md` |
| Planning | `.agents/agent/project-planner.md` |

### AI-Driven SDLC Skills

Use these course-specific skills when the task touches the AI-SDLC workflow:

| Need | Skill |
|:---|:---|
| Project source of truth / vault | `.agents/skills/obsidian-vault/SKILL.md` |
| Spec-first work | `.agents/skills/spec-driven-development/SKILL.md` |
| AI output review | `.agents/skills/ai-output-verification/SKILL.md` |
| Governance / quality gate | `.agents/skills/sdlc-governance/SKILL.md` |
| Existing-codebase maintenance | `.agents/skills/brownfield-maintenance/SKILL.md` |
| New tool / method evaluation | `.agents/skills/tech-evaluation/SKILL.md` |
| Capstone readiness | `.agents/skills/capstone-sdlc/SKILL.md` |

## 5. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.
- If you write 200 lines and it could be 50, rewrite it.
- Touch only what you must. Don't "improve" adjacent code.

## 6. Pre-Work: Read Project Docs First (MANDATORY)

**Before implementing ANY task, you MUST read relevant project docs.**

Required reading (in order):

| Priority | Document | What to look for |
|:---|:---|:---|
| **P0** | `docs/architecture/06_Architecture_Composability.md` | Which layer? What boundaries? |
| **P0** | `docs/architecture/11_Coding_Convention.md` | Code rules, naming, file structure |
| **P1** | `docs/requirements/04_Product_Backlog.md` | Acceptance criteria for the User Story |
| **P1** | `docs/requirements/05_Function_Flow_Logic_Register.md` | Function-level logic, triggers, flow |
| **P2** | `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md` | Decisions made, risks to avoid |
| **P2** | `docs/requirements/03_SRS_MediaOps_Composability.md` | NFRs, security constraints |

**Rules:**
- If a `docs/plans/PLAN-{task-slug}.md` exists for the task, read it FIRST.
- Don't just open docs — extract constraints and apply them.
- If docs contradict: Architecture > Coding Convention > Backlog.
- Mention which docs you read before starting implementation.

## 7. Post-Work: Generate Report (MANDATORY)

**After completing ANY task, create a report file.**

**File:** `docs/reports/REPORT-{task-slug}-{YYYY-MM-DD}.md`

**Report MUST include these sections:**

```markdown
# Report: {Task Title}

**Date:** {YYYY-MM-DD}
**Agent(s) Used:** {agent/model names}
**Related User Story:** {US-XXX}
**Status:** Completed / Partial / Blocked

## Summary
Brief description of what was accomplished.

## What Was Done
- [ ] Item 1: description
- [ ] Item 2: description

## How It Was Done
### Approach
Description of the technical approach taken.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| {tool name} | {what it was used for} |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| {path} | Created/Modified/Deleted | {what changed} |

## Impact & Purpose
What does this change achieve? How does it fit into the system?

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| {decision} | {why} | {other options} |

## Verification
- [ ] Tests passed
- [ ] Docs updated
- [ ] No secrets exposed
- [ ] Acceptance criteria met: {list which ACs}

## Open Items / Next Steps
- {any remaining work}
```

**Rules:**
- Report is NOT optional. Every completed task MUST have a report.
- Report file must be committed alongside the code changes.
- If task spans multiple sessions, update the same report file.
- Keep reports factual — no speculation, no filler.

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **muti-media-management** (API base `https://etev3zve.us-east.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
