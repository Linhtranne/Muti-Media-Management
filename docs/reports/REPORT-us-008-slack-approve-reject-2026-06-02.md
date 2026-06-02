# Report: US-008 Slack Approve/Reject Post

**Date:** 2026-06-02
**Agent(s) Used:** orchestrator
**Related User Story:** US-008
**Status:** Completed
## Summary
Implemented the MVP slash commands for Slack (`/approve_post` and `/reject_post`), allowing managers to review AI-generated posts directly from Slack without Notion or Airtable access.

## What Was Done
- [x] Created `slack_command_events` and `workspace_members` schema migrations.
- [x] Defined Zod schemas and types for Slack commands in `shared-contracts`.
- [x] Configured environment variables (SLACK_SIGNING_SECRET, SLACK_COMMANDS_ENABLED).
- [x] Built `SlackSignatureVerifier` to protect endpoints using `HMAC-SHA256` and 5-min timestamp window.
- [x] Built `SlackCommandParser` to cleanly extract post IDs and reasons, handling formatting variations.
- [x] Built `SlackCommandRepository` for zero-trust interactions with Ledger and `workspace_members` authorization.
- [x] Created Express webhook route using `express.raw` for signature verification and an outbox queue pattern.
- [x] Extended RabbitMQ publisher and created a consumer for the `slack.post_approval.requested` queue.
- [x] Developed `SlackPostApprovalWorker` to perform idempotent Airtable updates and synchronize state with Ledger.
- [x] Updated Function Flow Logic Register with `FL-009`.
- [x] Refined consumer to use Dead-Letter TTL for retries instead of `setTimeout` blocking.
- [x] Enforced `SLACK_SIGNING_SECRET` when commands are enabled in `env.ts`.
- [x] Created `seed_workspace_members.ts` script for seeding Role mapping.
- [x] Updated worker to use dynamic Airtable rejection field and dual-matching (`post_id` / `airtable_record_id`) for workflow consistency.

## How It Was Done
### Approach
We used the Composability Architecture, creating a zero-trust interface between the Communication Plane (Slack) and the Logic Plane (Orchestrator). The Slack endpoint performs rapid verification and idempotency checks before responding with an HTTP 200 and queuing the work via RabbitMQ. The worker later updates Airtable and the Ledger audit logs.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| `shared-contracts` | Type sharing between services |
| RabbitMQ | Event-driven decoupling of incoming webhooks and Airtable processing |
| `SlackSignatureVerifier` | Verify Slack origins using HMAC-SHA256 |
| `SlackPostApprovalWorker` | Process Slack events asynchronously with retries |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `db/migrations/0008_us008_slack_approve_reject.sql` | Created | Defined Slack events and workspace_members tables |
| `packages/shared-contracts/src/slack/slashCommand.ts` | Created | Zod schemas |
| `apps/orchestrator/src/config/env.ts` | Modified | Added SLACK env variables |
| `apps/orchestrator/src/services/slackSignatureVerifier.ts` | Created | Signature verification service |
| `apps/orchestrator/src/services/slackCommandParser.ts` | Created | Command parser |
| `apps/orchestrator/src/ledger/slackCommandRepository.ts` | Created | DB repository |
| `apps/orchestrator/src/routes/slackCommands.ts` | Created | Express route |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Modified | Added slack command publish |
| `apps/orchestrator/src/queue/slackCommandRabbitmqConsumer.ts` | Created | RabbitMQ consumer |
| `apps/orchestrator/src/workers/slackPostApprovalWorker.ts` | Created | Queue worker |
| `apps/orchestrator/src/server.ts` | Modified | Wired up components |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Added FL-009 |

## Impact & Purpose
Managers can now directly approve or reject drafted posts via Slack, drastically lowering the friction for content review and keeping the operations primarily in the Communication Plane.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Minimal role mapping table (`workspace_members`) | Ensures zero trust. Slack User IDs cannot bypass authorization arbitrarily. | Hardcoding Slack IDs or fetching dynamically from external systems. |
| Ephemeral immediate response | Slack requires response in 3s. Queue worker allows async execution. | Using Slack `response_url` (rejected for MVP simplicity). |
| Idempotency Key via hashing | Prevent double execution from Slack webhook retries. | Simple duplicate command checks (less reliable). |

## Verification
- [x] `npm run build` passed.
- [x] Slack-specific tests (contracts, parser, verifier, worker, route) were added to `run-tests.mjs`.
- [x] Full test suite passed (220/220).
- [x] Docs updated (FL-009 added)
- [x] No secrets exposed
- [x] Acceptance criteria met: The slash commands have been fully implemented with zero-trust verification and idempotency checks.

## Open Items / Next Steps
- Implement Slack App UI configuration to route slash commands to `/api/v1/slack/commands`.
- Add integration to automatically populate `workspace_members` when users are invited.
