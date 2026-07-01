# AI-SDLC Retrofit Header for US-009

status: approved

## Goal

Maintain US-009 behavior for Slack Reply or Escalate Comment Command according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-009` passes after retrofit artifacts are present.

# PLAN: US-009 Reply and Escalate Facebook Comment via Slack

**Version:** 1.0  
**Date:** 2026-06-02  
**Status:** Draft — Pending approval  
**Related:** US-009, Epic E04 Communication Plane

---

## 1. Overview
US-009 enables Support to reply to or escalate Facebook comments directly from Slack. It integrates with the MCP server to communicate with the Facebook Graph API.

## 2. Architecture Position & Boundaries
- Orchestrator handles Slack slash commands and parses them.
- Role checks via Ledger `workspace_members`.
- Orchestrator delegates Facebook interaction to the Facebook MCP Server (`reply_comment` tool).
- Queue decouples command parsing from external API calls.

## 3. Docs Read
- `06_Architecture_Composability.md`
- `11_Coding_Convention.md`
- `04_Product_Backlog.md`
- `05_Function_Flow_Logic_Register.md`
- `07_Risk_Assumption_Decision_Log.md`

## 4. Skills and Specialist Knowledge Applied
- `integrations/slack-bot-builder/skill.yaml`: fast HTTP ack, no token exposure.
- `backend/queue-workers/skill.yaml`: idempotent queue processing.
- `ai-agents/agent-tool-builder/skill.yaml`: MCP client integrations.

## 5. Current Implementation Context
- US-008 already established `/approve_post` and `/reject_post` slash commands.
- `workspace_members` stub exists.
- Facebook MCP server MVP needs `reply_comment` implementation.
- **Critical Dependency:** US-007 (Comment Sync) provides the `interactions` and `comments` structure. If US-007 is not implemented yet, US-009 MUST create a minimal compatible schema for `interactions` or fail clearly and block.

## 6. Scope (In Scope)
- `/reply_comment` and `/escalate` slash command parsing.
- Slack command routing reuse from US-008.
- RabbitMQ queues for reply and escalate actions.
- Reply worker calling MCP `reply_comment` tool.
- Escalate worker updating Ledger status to `escalated` and publishing alert to crisis channel.

## 7. Scope (Out of Scope)
- Automatic resolution of comments.
- Full Slack OAuth user linking.
- Direct Facebook Graph API calls from Orchestrator (must go through MCP).

## 8. Architecture Flow
1. Slack sends HTTP POST (command).
2. Reuse US-008 Signature Verifier.
3. Parse command: `/reply_comment <interaction_id> <message>` or `/escalate <interaction_id> [reason]`.
4. Role check against `workspace_members` (must be `support`, `manager`, or `admin`).
5. Check if `interaction_id` exists in Ledger.
6. Insert `comment_action_events` row in Ledger with `status='queued'` and idempotent key.
7. Enqueue RabbitMQ message (references-only).
8. Return ephemeral success message to Slack.
9. Worker picks up job, loads intent from Ledger.
10. Worker calls MCP client to reply/escalate.
11. Update Ledger `comment_action_events` and `interactions` status.
12. Audit logging and Slack alert if escalated.

## 9. Proposed Files (New/Modified)
- `packages/shared-contracts/src/slack/slashCommand.ts` (Modify)
- `apps/orchestrator/src/services/slackCommandParser.ts` (Modify)
- `apps/orchestrator/src/routes/slackCommands.ts` (Modify)
- `apps/orchestrator/src/workers/slackReplyWorker.ts` (New)
- `apps/orchestrator/src/workers/slackEscalateWorker.ts` (New)
- `db/migrations/0009_us009_slack_reply_escalate_comment.sql` (New)
- `apps/orchestrator/src/ledger/slackCommandRepository.ts` (Modify)

## 10. Ledger Schema Requirements
Migration `0009_us009_slack_reply_escalate_comment.sql`:
- Extend `workspace_members.role` to include `support`.
- **Interactions Dependency**: If `interactions` table is missing (US-007 missing), create a minimal schema: `id (UUID)`, `workspace_id`, `external_id`, `platform`, `status`. 
- **Status Enum for Interactions**: The implementation must inspect the existing migration for US-007. If the `interactions` table exists, use its enum (e.g., `new`, `acknowledged`, `resolved`, `escalated`). If not, explicitly align to `new`, `acknowledged`, `resolved`, `escalated` and map a successful reply to `resolved`. Do not break existing constraints.
- **`comment_action_events` table**: (Covers both reply and escalate actions)
  - `id` (UUID PRIMARY KEY)
  - `workspace_id` (TEXT NOT NULL)
  - `interaction_id` (UUID FK)
  - `action` (TEXT NOT NULL) - Enum: `reply`, `escalate`
  - `actor_id` (TEXT)
  - `message` (TEXT) - Used for reply content or escalate reason
  - `status` (TEXT) - Enum: `queued`, `processing`, `succeeded`, `failed`
  - `external_reply_id` (TEXT)
  - `idempotency_key` (TEXT UNIQUE)
  - `created_at` (TIMESTAMPTZ)
- **Idempotency Key Formulation**: `sha256(workspace_id + actor_id + action + interaction_id + message_hash)`
- **Indexes**: 
  - `idx_comment_action_events_workspace_status` on `(workspace_id, status)`
  - `idx_comment_action_events_interaction` on `(interaction_id)`
- **RLS**:
  - USING `workspace_id = current_setting('app.current_workspace_id', true)`
  - WITH CHECK `workspace_id = current_setting('app.current_workspace_id', true)`

## 11. Event Contracts
- RabbitMQ Event: `slack.reply_comment.requested`, `slack.escalate_comment.requested`.
- Payload: `reply_action_id` (UUID), `workspace_id` (TEXT), `interaction_id` (UUID). (Note: References only, no full message).

## 12. Command Parsing Rules
- `/reply_comment <interaction_id> <message>`
- `/escalate <interaction_id> [reason]`
- `interaction_id` parsed as UUID.

## 13. Security Constraints
- Role validation: `support`, `manager`, `admin`.
- MCP token encapsulation: Orchestrator never holds Facebook token.
- Reason and message sanitization. Avoid executing scripts inside the message.

## 14. Error Handling Matrix
- Interaction not found -> Fast Fail, HTTP 200 with ephemeral error message.
- Unauthorized role -> Fast Fail, HTTP 200 with ephemeral error message.
- Duplicate command -> Fast Pass, HTTP 200 with "Already processing".
- MCP Failure (Transient) -> NACK via RabbitMQ, Retry backoff.
- MCP Failure (Permanent) -> Status `failed`, DLQ, Slack Audit Alert.

## 15. Queue & Slack Response Behavior
- **Queue Topology**:
  - Exchange: `slack.workflows` (topic)
  - Routing Keys: `slack.reply_comment.requested`, `slack.escalate_comment.requested`
  - Queues: `slack.reply_comment.requested`, `slack.escalate_comment.requested`
  - DLQs: `slack.reply_comment.requested.dlq`, `slack.escalate_comment.requested.dlq`
  - Retry Strategy: Exponential backoff (1s, 2s, 4s, 8s, 16s), max 5 retries. Must use **retry TTL queues + ConfirmChannel** pattern as established in US-008. Do NOT rely on the RabbitMQ delayed-message plugin.
- **Slack Response**: Ephemeral response in < 3s indicating success queueing or immediate error.

## 16. Task Breakdown
- T-001 plan setup and docs verification
- T-002 migration (`0009_us009_slack_reply_escalate_comment.sql`)
- T-003 shared contracts
- T-004 parser extension/reuse
- T-005 route integration/reuse US-008 route
- T-006 repository
- T-007 MCP client/tool contract (Implement `reply_comment` MCP tool if missing)
- T-008 reply worker
- T-009 escalate worker or unified worker
- T-010 RabbitMQ publisher/consumer setup
- T-011 server wiring/env
- T-012 tests
- T-013 report/update run-tests

## 17. Acceptance Criteria Mapping
- AC1: Support/Manager/Admin reply được. -> Implemented via Role verification.
- AC2: Creator không reply được nếu không có quyền support. -> Role lookup.
- AC3: Reply fail có error rõ và không đánh dấu resolved. -> DLQ and status tracking in Ledger.
- AC4: Escalate gửi crisis channel. -> Alert worker integration.

## 18. Production Readiness Checklist
- [ ] Slack signature verified
- [ ] Role check enforced
- [ ] No tokens in RabbitMQ or logs
- [ ] Idempotency implemented
- [ ] RLS enabled with USING/WITH CHECK
- [ ] Dependency checks on US-007 schema
- [ ] Tests cover happy path and error paths

## 19. Open Questions
- OQ-009-1: Command names chính xác là `/reply_comment` và `/escalate`, hay dùng một command chung như `/comment_action`?
  - *MVP Decision:* Use `/reply_comment <interaction_id> <message>` and `/escalate <interaction_id> [reason]`.
- OQ-009-2: `interaction_id` người dùng nhập là Ledger UUID, external comment id, hay Slack alert short id?
  - *MVP Decision:* It will be the **Ledger UUID**. The orchestrator and Slack commands should operate strictly on internal Ledger IDs. The worker will resolve the UUID to the Facebook `external_id` before invoking the MCP.
- OQ-009-3: Reply message có được lưu trong queue payload không, hay bắt buộc lưu vào Ledger trước rồi queue chỉ gửi `reply_action_id`?
  - *MVP Decision:* Store reply/escalation action row in Ledger first; RabbitMQ event should carry `reply_action_id` only, not full reply body.
- OQ-009-4: MCP `reply_comment` tool đã tồn tại chưa? Nếu chưa, US-009 plan có bao gồm tạo MCP tool hay chỉ declare dependency/blocker?
  - *MVP Decision:* Chưa có. The tool needs to be implemented in `apps/facebook-mcp-server` as part of US-009 (or US-007 if decided). Orchestrator worker will call this new MCP tool.
- OQ-009-5: Escalate chỉ update Ledger + Slack crisis alert, hay cần tạo task/assign owner?
  - *MVP Decision:* For escalate MVP, update interaction status to `escalated`, insert audit, publish `alerts.slack.send` to crisis channel.
- OQ-009-6: Status sau reply thành công là `resolved`, `replied`, hay giữ `open`?
  - *MVP Decision:* Transitions to `resolved`. This is inferred from AC3 which specifies that a failed reply should "not mark it as resolved".
- OQ-009-7: Support role mapping dùng lại `workspace_members.role = support/manager/admin` hay cần bảng riêng?
  - *MVP Decision:* Extend `workspace_members.role` to include `support` if chưa có.

## 20. Test Matrix
| Feature | Happy Path | Negative Path | Edge Case |
|---------|------------|---------------|-----------|
| **Slack Parsing** | Parse `/reply_comment UUID message` successfully | Missing message, invalid UUID | Message > 500 chars, special characters in message |
| **Role Verification**| `support` or `admin` triggers command | `viewer` triggers command (rejects) | User not found in `workspace_members` |
| **Idempotency** | First request succeeds, enqueues | Second request with same params returns success but doesn't enqueue | Concurrent requests |
| **Queue Topology** | Message enqueued to `slack.reply_comment.requested` | Invalid payload goes to DLQ | Consumer disconnects mid-processing |
| **MCP Integration**| MCP `reply_comment` tool succeeds -> `resolved` | MCP token error -> `failed`, DLQ | MCP timeout -> retry backoff |
| **DB / RLS** | Updates `comment_action_events` and `interactions` | `workspace_id` mismatch fails | US-007 schema missing (fails gracefully) |

**Additional Notes:** 
- Use Function Flow code `FL-010` (as FL-009 is duplicated) for US-009 logic updates later.
- This plan will act as the blueprint. Code implementation will wait for open question resolution.


## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: Planned and defined.
- AC2: Planned and defined.
- AC3: Planned and defined.
- AC4: Planned and defined.
