# Report: US-015 Unified Direct Message Inbox

**Date:** 2026-06-05
**Agent(s) Used:** Backend Specialist, Event Architect, Security Auditor, Debugger
**Related User Story:** US-015
**Status:** Completed

## Summary
Successfully implemented the Unified Direct Message Inbox feature for Facebook page messaging. This enables ingesting DMs from Facebook via the MCP server into the MediaOps Ledger, processing them asynchronously, and allowing support/manager roles to securely reply using the `/reply_dm` Slack command. The implementation strictly adheres to the zero-trust architecture, avoiding raw token exposure in the orchestrator layer and persisting DMs inside the isolated Postgres ledger with workspace boundaries.

## What Was Done
- [x] Item 1: Designed and executed the database migration for `conversations` and `conversation_messages` with row-level security (RLS).
- [x] Item 2: Implemented the `DirectMessageRepository` for ledger operations and conversation state management.
- [x] Item 3: Created shared contracts (`DirectMessageIngestEvent`, `DirectMessageReplyRequestedEvent`) for references-only message payloads.
- [x] Item 4: Configured new RabbitMQ topology for DM queues (`dm.facebook.ingest`, `dm.reply.requested`) and set up producers.
- [x] Item 5: Implemented `DirectMessageIngestWorker` and `DirectMessageReplyWorker` enforcing idempotency and terminal MCP error handling.
- [x] Item 6: Updated the Slack integration layer with the `/reply_dm` command parser, routing, and role-based access control.
- [x] Item 7: Created `dmRedactor.ts` helper and integrated it into the workers to ensure DM body preview in Slack alerts is properly stripped of secrets and truncated to 80 characters.
- [x] Item 8: Added comprehensive unit test coverage and updated `run-tests.mjs`.

## How It Was Done
### Approach
We followed the Composability and Event-Driven architecture patterns. Inbound messages are picked up by the MCP server and an event (`dm.facebook.ingest`) is dispatched to RabbitMQ. The orchestrator's `DirectMessageIngestWorker` claims the message, fetches the DM content via `get_direct_message` from the MCP server, and stores it in the Postgres Ledger (`conversations` and `conversation_messages` tables), and dispatches a sanitized alert to the Slack inbox channel. For outbound messages, the `/reply_dm` command parses user input, validates roles, and pushes a reply event to `dm.reply.requested`. The `DirectMessageReplyWorker` consumes this event, interacts with the MCP server to post the reply to Facebook, and records the outgoing message in the Ledger. Both paths are fully idempotent.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| event-architect | Used to design queue topology, schema contracts, and idempotency patterns for RabbitMQ. |
| security-auditor | Used to enforce RLS and zero-token strictness in logging and orchestration layers. |
| backend-specialist | Used to implement workers, API routes, parsing logic, and Postgres queries. |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `db/migrations/0015_us015_unified_direct_message_inbox.sql` | Created | Ledger schema for conversations and messages. |
| `packages/shared-contracts/src/events/directMessage.ts` | Created | Event schemas for Ingest and Reply. |
| `apps/orchestrator/src/ledger/directMessageRepository.ts` | Created | DB access methods. |
| `apps/orchestrator/src/queue/topologyConfig.ts` | Modified | Added queue topology constants. |
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Modified | Added publisher methods for ingest and reply queues. |
| `apps/orchestrator/src/workers/directMessageIngestWorker.ts` | Created | Ingestion worker. |
| `apps/orchestrator/src/workers/directMessageReplyWorker.ts` | Created | Reply worker. |
| `apps/orchestrator/src/queue/directMessageIngestRabbitmqConsumer.ts` | Created | RabbitMQ consumer for DM ingest. |
| `apps/orchestrator/src/queue/directMessageReplyRabbitmqConsumer.ts` | Created | RabbitMQ consumer for DM reply. |
| `apps/orchestrator/src/services/slackCommandParser.ts` | Modified | Added `/reply_dm` parser mapping. |
| `apps/orchestrator/src/routes/slackCommands.ts` | Modified | Added Slack command routing handler for `/reply_dm`. |
| `apps/orchestrator/src/server.ts` | Modified | Initialized workers and consumers in the orchestrator registry. |
| `apps/orchestrator/src/lib/dmRedactor.ts` | Created | Secret stripping and length limiting utility for Slack DM previews. |
| `run-tests.mjs` | Modified | Added DM test suites to CI run. |
| `docs/requirements/05_Function_Flow_Logic_Register.md` | Modified | Updated FL-014 status to Implemented. |

## Impact & Purpose
The feature integrates direct messaging directly into the MediaOps platform, enabling centralized multi-channel support. It safely delegates token-based API calls to the MCP layer, passing only an opaque `secret_ref` rather than raw Facebook tokens. This minimizes token exposure risks in the orchestrator layer. Customer data is safely enclosed within the RLS-enabled Postgres ledger.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Rely on `redact.ts` for Slack previews | Reuse existing battle-tested secret sweeping regex patterns instead of doing simplistic slicing. | Doing basic `slice(0, 80)` which might inadvertently truncate half a password or expose parts of tokens. |
| Terminal Error mapping in Reply Worker | Prevent retry loops on hard auth failures (e.g. invalid tokens) by moving them directly to `nack_dlq` or just `ack` with a failed state instead of spamming retries. | Nack requeue infinitely or rely entirely on default exponential backoff exhaustion. |
| Using canonical topic exchange | New events should follow the standard `mediaops.events.topic` exchange pattern while maintaining backward compatibility with older events. | Reusing the legacy direct exchange approach. |

## Verification
- [x] Tests passed
- [x] Docs updated
- [x] No secrets exposed
- [x] Acceptance criteria met: All ACs (MVP Facebook connection, slack interaction, queue, zero trust, plaintext RLS) satisfied.

## Open Items / Next Steps
- Production test deployment of Facebook MCP Server DM webhooks (outside the scope of US-015 orchestrator logic).
- Eventually implementing UI dashboard views for `conversations` and `conversation_messages` tables (out of scope for MVP).
