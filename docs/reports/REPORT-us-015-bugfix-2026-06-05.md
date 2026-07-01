# Report: US-015 DM Inbox — Fix 5 Critical Bugs

**Date:** 2026-06-05
**Agent(s) Used:** backend-specialist + security-auditor + debugger
**Related User Story:** US-015
**Status:** Completed

## Summary

5 critical bugs được phát hiện và fix sau khi implementation US-015 ban đầu. Tất cả bugs đều liên quan đến security, data integrity, hoặc reliability của DM Inbox feature.

## What Was Done

- [x] Bug #1: Fix MCP tools token resolution — dùng `input.secret_ref` thay vì `env:FACEBOOK_CHANNEL_<ID>_TOKEN`
- [x] Bug #2: Remove `reply_body` khỏi queue event — thay bằng `reply_job_id` only (references-only policy)
- [x] Bug #3: Fix `claimReplyJob` WHERE clause: `IN ('received','queued')` + xóa unsafe fallback
- [x] Bug #4: Fix FK fallback — query existing message khi INSERT conflicts
- [x] Bug #5: Thêm `DM_INBOX_ENABLED` feature flag, gate consumers trong `server.ts`
- [x] Build clean (0 TypeScript errors)
- [x] 415 tests passed (0 fail)

## How It Was Done

### Approach

1. **Bug #1** — `getDirectMessage.ts` và `sendDirectMessage.ts` trước đây build secret ref là `env:FACEBOOK_CHANNEL_<ID>_TOKEN`. `DatabaseSecretStore` chỉ resolve `dbsecret:<workspaceId>:<uuid>`. Fix: thêm `secret_ref: z.string()` vào input schemas, tools dùng `secretStore.resolveSecret(input.secret_ref)`. Orchestrator ingest worker và reply worker load `secret_ref` từ `channel_accounts.secret_ref` trong DB.

2. **Bug #2** — `DirectMessageReplyRequestedEventSchema` payload bỏ `reply_body` và `conversation_id`, thêm `reply_job_id: z.string().uuid()`. Route chỉ publish job ID. Worker load `reply_body` từ `replyJob` (Ledger) đã được claim. DLQ không còn chứa message body.

3. **Bug #3** — `claimReplyJob` đổi WHERE `status = 'received'` thành `status IN ('received', 'queued')`. Worker xóa fallback `claimed || existingJob` — nếu claim trả về null, kiểm tra status: `succeeded/failed` → ACK (idempotent), `processing` → `nack_requeue` (consumer khác đang xử lý), `null` → `nack_dlq` (không tồn tại).

4. **Bug #4** — Sau `insertMessageIdempotently` (ON CONFLICT DO NOTHING), nếu `insertedMsg` null, gọi `getMessageByExternalId()` để lấy existing `conversation_messages.id`. `markReplyJobSucceeded` đổi signature nhận `messageId: string | null`.

5. **Bug #5** — Thêm `DM_INBOX_ENABLED: z.enum(["true","false"]).default("false")` vào `env.ts`. `server.ts` gate cả 2 consumers trong `if (env.DM_INBOX_ENABLED === "true")`.

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| TypeScript compiler | Type safety validation |
| node:test | Test runner |
| Zod schemas | Runtime contract validation |
| pg.PoolClient | Database queries |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| `packages/shared-contracts/src/events/directMessage.ts` | Modified | Bug #1+2: remove `reply_body` from queue event; add `secret_ref` to MCP input schemas; MCP schemas now use `z.object().strict()` (not `refineForbiddenFields`) |
| `packages/shared-contracts/src/events/envelope.ts` | Unchanged | `secret_ref` remains in FORBIDDEN_FIELDS for queue events only |
| `apps/facebook-mcp-server/src/tools/getDirectMessage.ts` | Modified | Bug #1: use `input.secret_ref` |
| `apps/facebook-mcp-server/src/tools/sendDirectMessage.ts` | Modified | Bug #1: use `input.secret_ref` |
| `apps/facebook-mcp-server/src/tools/__tests__/directMessage.test.ts` | Modified | Add `secret_ref` to all test fixtures |
| `apps/orchestrator/src/workers/directMessageIngestWorker.ts` | Modified | Bug #1: lookup `channel_accounts.secret_ref` before MCP call |
| `apps/orchestrator/src/workers/directMessageReplyWorker.ts` | Rewritten | Bug #1+2+3+4: load `secret_ref` from Ledger; load `reply_body` from claimed job; safe claim logic; fix FK fallback |
| `apps/orchestrator/src/ledger/directMessageRepository.ts` | Modified | Bug #3: WHERE `IN ('received','queued')`; add `getReplyJobById()`, `getMessageByExternalId()`; fix `markReplyJobSucceeded` signature |
| `apps/orchestrator/src/routes/slackCommands.ts` | Modified | Bug #2: publish `reply_job_id` only |
| `apps/orchestrator/src/config/env.ts` | Modified | Bug #5: add `DM_INBOX_ENABLED` flag |
| `apps/orchestrator/src/server.ts` | Modified | Bug #5: gate DM consumers |
| `packages/shared-contracts/src/__tests__/directMessageContracts.test.ts` | Modified | Update fixtures and assertions for new schema |
| `apps/orchestrator/src/__tests__/directMessageRepository.test.ts` | Modified | Bug #3: update `claimReplyJob` assertion |

## Impact & Purpose

- **Security**: Queue và DLQ không còn chứa message body hoặc raw secret refs. Đảm bảo references-only policy (US-014).
- **Reliability**: Job claim atomic-safe, không còn duplicate send khi nhiều consumer chạy song song.
- **Data Integrity**: `direct_message_reply_jobs.message_id` FK luôn trỏ tới valid `conversation_messages.id`.
- **Production Safety**: Production sẽ resolve token qua `DatabaseSecretStore` (`dbsecret:` refs) thay vì env vars.
- **Deployment Safety**: `DM_INBOX_ENABLED=false` cho phép deploy lên production mà không kích hoạt consumers.

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| MCP input schemas không dùng `refineForbiddenFields` | `secret_ref` là opaque pointer cần thiết cho MCP call; forbidden field guard chỉ áp dụng cho queue events | Thêm exception vào `isForbiddenKey` — rejected (quá invasive) |
| `getReplyJobById` nằm trong transaction với `claimReplyJob` | Đảm bảo read-after-failed-write consistent | Hai queries riêng — rejected (race condition window) |
| `markReplyJobSucceeded` nhận `messageId: string | null` | ON CONFLICT DO NOTHING có thể khiến insert không trả về row; cần fallback query | Require non-null — rejected (gây throw trên idempotent path) |
| `DM_INBOX_ENABLED` default `"false"` | Safe-by-default; phải explicit opt-in | Default `"true"` — rejected (không an toàn) |

## Verification

- [x] Build passed: `tsc -b` clean, 0 errors
- [x] Tests passed: 415/415 pass, 0 fail
- [x] No secrets exposed in queue events
- [x] Contract tests verify: `reply_body` bị reject, `reply_job_id` accepted
- [x] Contract tests verify: `secret_ref` required trong MCP input schemas
- [x] Acceptance criteria: production token resolution, references-only queue, atomic job claim, valid FK, feature flag

## Open Items / Next Steps

- [ ] Set `DM_INBOX_ENABLED=true` trong production `.env` khi sẵn sàng kích hoạt
- [ ] Verify `channel_accounts.secret_ref` được populate đúng khi onboard channel qua US-011 flow
- [ ] E2E test với Facebook Graph API sandbox sau khi enable flag
