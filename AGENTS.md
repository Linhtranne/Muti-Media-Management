# AGENTS.md — GPT Codex Instructions

> This file instructs OpenAI Codex/GPT to follow project conventions and load specialist skills.

## Project Context

MediaOps Composability — Multi-channel media operations platform. Architecture: Composability (Airtable + Notion + AI Middleware + MCP Server + RabbitMQ + Postgres + Slack).

## 1. Before Coding: Read Project Docs

Before any implementation:
1. Read `docs/06_Architecture_Composability.md` for system architecture
2. Read `docs/11_Coding_Convention.md` for code rules
3. Read `docs/05_Function_Flow_Logic_Register.md` for the function you're implementing
4. Check `docs/04_Product_Backlog.md` for acceptance criteria

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

Additional specialist knowledge lives in `.agent/agents/` and `.agent/skills/`. When these are relevant:

| Domain | Agent File |
|:---|:---|
| Backend/API | `.agent/agents/backend-specialist.md` |
| Database | `.agent/agents/database-architect.md` |
| Security | `.agent/agents/security-auditor.md` |
| DevOps | `.agent/agents/devops-engineer.md` |
| Debugging | `.agent/agents/debugger.md` |
| Planning | `.agent/agents/project-planner.md` |

## 5. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.
- If you write 200 lines and it could be 50, rewrite it.
- Touch only what you must. Don't "improve" adjacent code.
