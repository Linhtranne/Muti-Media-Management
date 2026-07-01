# Report: Airtable Status Poller Fallback

**Date:** 2026-06-30
**Agent(s) Used:** Codex debugger/backend-specialist
**Related User Story:** US-002 / US-003 / US-006
**Status:** Completed

## Summary
Added a backend Airtable status poller fallback so local/demo flows do not depend solely on Airtable Automation firing a webhook after status changes.

## What Was Done
- [x] Added `AirtableClient.listPostRecordsByStatus()` for polling `Posts` records in `Approved` or `Approved for Publish`.
- [x] Added `AirtableStatusPoller` to route matching records through the existing `AirtableWebhookIngestor`.
- [x] Added env flags `AIRTABLE_STATUS_POLLER_ENABLED` and `AIRTABLE_STATUS_POLLER_INTERVAL_MS`.
- [x] Wired the poller into orchestrator startup and graceful shutdown.
- [x] Enabled the poller in local `.env.local` for demo use.
- [x] Added unit coverage for poller idempotent event generation.

## How It Was Done
### Approach
The poller preserves the original webhook pipeline. It does not bypass worker validation or publish rules. It creates deterministic event IDs from `record_id`, `approved_at`, and `status`, allowing existing idempotency checks to suppress duplicate polling events.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| systematic-debugging | Confirm missing Airtable webhook as the root cause |
| TypeScript build/lint/test | Verify integration safety |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `apps/orchestrator/src/airtable/airtableClient.ts` | Modified | Added status-based Airtable record listing. |
| `apps/orchestrator/src/scheduler/airtableStatusPoller.ts` | Created | Polls Airtable and feeds eligible records into existing webhook ingestion. |
| `apps/orchestrator/src/config/env.ts` | Modified | Added poller env flags. |
| `apps/orchestrator/src/server.ts` | Modified | Starts/stops the poller when enabled. |
| `apps/orchestrator/src/__tests__/airtableStatusPoller.test.ts` | Created | Verifies deterministic poller ingestion payload. |
| `run-tests.mjs` | Modified | Includes the new poller test in the static runner. |
| `.env.local` | Modified | Enabled local demo poller with 30 second interval. |

## Impact & Purpose
Changing Airtable `Posts.status` to `Approved` or `Approved for Publish` can now progress through the backend even if Airtable Automation does not send the webhook.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Poll Airtable as fallback | Airtable automation configuration cannot be reliably patched from the repo. | Rely only on manual webhook calls; rejected because it keeps demo flow brittle. |
| Use existing webhook ingestor | Preserves idempotency, queue, validation, and worker boundaries. | Directly publish from poller; rejected because it bypasses core pipeline safeguards. |

## Verification
- [x] `npm run build` passed.
- [x] `npm run lint` passed.
- [x] Targeted tests passed: `airtableStatusPoller`, `airtableClient`, `ai-composer-worker`.
- [x] `npm test` passed: all 66 test files passed.
- [x] Local orchestrator restarted and `/health` returned `ok`.
- [x] No secrets exposed.

## Open Items / Next Steps
- Airtable Automation can still be fixed in Airtable UI, but local demo no longer depends on it.
- Poll interval is currently local-demo configured to 30 seconds.
