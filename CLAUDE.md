# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Spawner Skills Integration

**Load specialist knowledge from `~/.spawner/skills/` when implementing.**

Before coding any domain-specific task:
1. Check if a matching Spawner skill exists at `~/.spawner/skills/<category>/<skill>/skill.yaml`
2. Read `skill.yaml` for patterns and anti-patterns
3. Read `sharp-edges.yaml` for pitfalls to avoid
4. Apply the knowledge silently — don't announce each skill load

Key mappings:
- Queue/worker tasks → `backend/queue-workers/`
- Event-driven design → `backend/event-architect/`
- Slack integration → `integrations/slack-bot-builder/`
- LLM/AI work → `ai/llm-architect/`
- PostgreSQL → `data/postgres-wizard/`
- Prompt engineering → `ai-agents/prompt-engineer/`

Windows path: `C:\Users\Hi\.spawner\skills\`

## 6. Pre-Work: Read Project Docs First

**Before implementing ANY task, read relevant project docs.**

Required reading:
1. `docs/architecture/06_Architecture_Composability.md` — system architecture, layer boundaries
2. `docs/architecture/11_Coding_Convention.md` — code rules, naming, file structure
3. `docs/requirements/04_Product_Backlog.md` — acceptance criteria for the User Story
4. `docs/requirements/05_Function_Flow_Logic_Register.md` — function-level logic and triggers
5. `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md` — decisions already made

If a `docs/plans/PLAN-{task-slug}.md` exists for the current task, read it FIRST.

Rules:
- Don't just open docs — extract constraints and apply them.
- If docs contradict: Architecture > Coding Convention > Backlog.
- Mention which docs you read and what constraints you extracted.

## 7. Post-Work: Generate Report

**After completing ANY task, generate a report file.**

File: `docs/reports/REPORT-{task-slug}-{YYYY-MM-DD}.md`

Report must include:
- **Summary**: What was accomplished
- **What Was Done**: Itemized list of changes
- **How It Was Done**: Technical approach, tools/skills used
- **Files Changed**: Table of file paths, actions (Create/Modify/Delete), descriptions
- **Impact & Purpose**: What the change achieves in the system
- **Decisions Made**: Rationale and alternatives considered
- **Verification**: Tests, docs updated, secrets check, ACs met
- **Open Items**: Remaining work or next steps

Rules:
- Report is NOT optional. Every completed task MUST have a report.
- Keep reports factual — no speculation, no filler.
- If task spans multiple sessions, update the same report file.


