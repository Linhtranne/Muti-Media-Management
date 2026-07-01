# Report: Local Staging Startup Commands

**Date:** 2026-06-07
**Agent(s) Used:** Codex
**Related User Story:** US-015
**Status:** Completed

## Summary
Added repeatable commands and documentation for initializing and running the local staging environment.

## What Was Done
- [x] Added npm scripts for orchestrator, ngrok, DB verification, Slack member seeding, and RabbitMQ queue reset.
- [x] Added a local staging startup guide covering migrations, environment configuration, callbacks, and smoke checks.

## How It Was Done
### Approach
Used Node's `--env-file` support so local startup no longer requires manually setting `DOTENV_CONFIG_PATH`.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| Codex | Repository inspection and scoped edits |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `package.json` | Modified | Added local staging commands |
| `docs/setup/LOCAL-STAGING-STARTUP.md` | Created | Added end-to-end startup instructions |
| `docs/reports/REPORT-local-staging-startup-commands-2026-06-07.md` | Created | Recorded this task |

## Impact & Purpose
Developers can initialize and start the staging-connected local services with consistent commands.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Use `node --env-file=.env.local` | Supported by the project's Node version and avoids shell-specific environment setup | Manually setting `DOTENV_CONFIG_PATH` |

## Verification
- [x] Build passed
- [x] Lint passed
- [x] npm scripts registered
- [x] Docs updated
- [x] No secrets exposed
- [x] Acceptance criteria met: startup commands documented and accessible through npm

## Open Items / Next Steps
- Keep the current ngrok domain synchronized across Slack, Meta, and `.env.local`.
