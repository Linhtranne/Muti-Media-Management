# 04 - AI-SDLC Completion Gate

This gate prevents an agent from claiming a story or task is complete without traceable AI-SDLC evidence.

## 1. Gate Verdicts

Use only these verdicts:

| Verdict | Meaning |
|:---|:---|
| `Pass` | Required evidence exists and current validation matches the claim. |
| `Partial` | Some evidence exists, but at least one required item is missing or stale. |
| `Fail` | Required evidence is missing, validation failed, or the claim exceeds evidence. |
| `Not applicable` | The item truly does not apply to this task type; reason is documented. |

Do not use `Verified`, `done`, or `production-ready` unless the matching evidence level below has passed.

## 2. Required Evidence Before Completion Claim

| Gate | Required Evidence | Minimum Status |
|:---|:---|:---|
| Spec approved | Approved spec path, status, owner, and acceptance criteria. | `Pass` for feature/behavior work. |
| Plan approved | Plan path, approval status, target files, test strategy, risk level. | `Pass` for implementation work. |
| Baseline result | `git status --short`, build/lint/test baseline or documented reason. | `Pass` or documented `Partial`. |
| Red test evidence | Failing test/check name and failure output before production code change. | `Pass` for bug fixes/new behavior. |
| Green/refactor evidence | The smallest code change and post-change targeted evidence. | `Pass` for bug fixes/new behavior. |
| Build/lint/test evidence | Current command output for `npm run build`, `npm run lint`, and relevant/full tests. | `Pass` for local completion. |
| Report evidence | Report path updated with files changed, commands, pass/fail, open items. | `Pass`. |
| Open items | Remaining risk, runtime smoke gaps, external blockers, out-of-scope findings. | `Pass` when explicit. |
| Runtime smoke | Service/DB/RabbitMQ/Slack/MCP smoke result. | Required before `production-ready`. |

## 2.1 Official Local Story Gate

For story-level completion claims, run:

```powershell
npm run ai-sdlc:validate -- <STORY-ID>
```

This command is the Automated L2 local gate. It runs:

1. `npm run build`
2. `npm run lint`
3. `npm test`
4. `npm run ai-sdlc:check -- <STORY-ID>`

Rules:

- Do not require a story id for `npm run lint`; `lint` must stay useful during normal development.
- `ai-sdlc:validate` must fail fast if any command fails.
- If `<STORY-ID>` is missing, it must print `Usage: npm run ai-sdlc:validate -- <STORY-ID>`.
- Passing this command supports a local `Verified` claim for the story only when the report also maps acceptance criteria and open items.
- Passing this command does not allow `production-ready` without runtime/staging smoke evidence.

## 3. Claim Rules

### Local completion

Allowed only when:

- Spec/plan requirements for the task type are satisfied.
- Build/lint/test evidence is current.
- Report exists and lists open items.
- Worktree impact is scoped or dirty unrelated files are explicitly listed.

### Verified

Allowed only when:

- Acceptance criteria are mapped to evidence.
- Relevant local validation passed.
- No stale report/test-count conflict remains for the story.

### Production-ready

Allowed only when:

- Local validation passed.
- Runtime/staging smoke passed.
- Database migrations are applied or verified in the target environment.
- External integration constraints are resolved or explicitly mocked for non-production.
- Security/privacy gate passed for token, PII, queue, audit, and tenant scope.

## 4. Story Gate Template

Copy this block into story reports before final status:

```markdown
## AI-SDLC Completion Gate

| Gate | Evidence | Verdict |
|:---|:---|:---|
| Spec approved | `<path>` | Pass / Partial / Fail / N/A |
| Plan approved | `<path>` | Pass / Partial / Fail / N/A |
| Baseline result | `<commands and result>` | Pass / Partial / Fail / N/A |
| Red test evidence | `<test/check failure before code>` | Pass / Partial / Fail / N/A |
| Build/lint/test evidence | `<commands and result>` | Pass / Partial / Fail / N/A |
| Report evidence | `<path>` | Pass / Partial / Fail / N/A |
| Open items | `<items or none>` | Pass / Partial / Fail / N/A |
| Runtime smoke | `<commands/manual smoke>` | Pass / Partial / Fail / N/A |

**Allowed status:** Implemented / Verified / Staging only / Production-ready / Partial / Blocked
**Reason:** <one paragraph tied to evidence>
```

## 5. Fail-Closed Checklist For Agents

Before sending a completion response, answer:

- [ ] Did I read the required boot files for this session?
- [ ] Did I avoid production code changes during audit/docs-only phases?
- [ ] Did I identify the task type and required risk level?
- [ ] Does an approved spec exist when this is feature/behavior work?
- [ ] Does an approved plan exist when this is implementation work?
- [ ] For bug fixes/new behavior, did I capture a failing test/check before changing production code?
- [ ] Did I run the required validation commands after changes?
- [ ] For story-level implementation work, did I run `npm run ai-sdlc:validate -- <STORY-ID>` or explain why it was not applicable?
- [ ] Did I update the report with actual command results?
- [ ] Did I list open items instead of silently fixing or hiding out-of-scope issues?
- [ ] Did I avoid `done`, `verified`, or `production-ready` unless the evidence allows that exact claim?

If any required item is unchecked, the final status must be `Partial` or `Blocked`, not `Verified`.
