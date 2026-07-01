# Report: Policy Handoff Publish Fix

**Date:** 2026-06-30
**Agent(s) Used:** Codex GPT-5, backend-specialist, debugger
**Related User Story:** US-003 / US-004 / US-006
**Status:** Completed

## Summary
Fixed the AI Composer, Policy, and MCP publish path so Airtable-approved records can publish to Facebook. Follow-up work changed the default flow to require a human review gate: AI now creates and syncs a draft first, then waits until the Airtable record is moved to `Approved for Publish` before policy and publish are queued.

## What Was Done
- [x] Added `publishPolicyEvaluateRequest()` to the RabbitMQ publisher.
- [x] Wired `AiComposerWorker` to persist the policy event after Ledger commit.
- [x] Removed AI redelivery policy republish recovery so duplicate AI queue messages cannot bypass human review.
- [x] Added regression coverage in the AI Composer happy path test.
- [x] Normalized `GEMINI_MODEL` values that include the `models/` prefix.
- [x] Tightened Policy Worker channel resolution to use active Facebook accounts with valid token status.
- [x] Fixed lint for the Facebook auth helper script by declaring Node global `fetch`.
- [x] Fixed MCP publish scheduler lookup to resolve `workflow_run_id` through `content_variants`.
- [x] Added publish job error columns and publish workflow enum statuses through additive migrations.
- [x] Fixed MCP publish input to pass the external Facebook Page ID instead of the internal Ledger channel account UUID.
- [x] Fixed Airtable post status callback to update the lowercase `status` field used by the actual Airtable schema.
- [x] Added a human approval gate: AI draft sync moves Airtable to `Needs Review` and policy/publish waits for `Approved for Publish`.

## How It Was Done

### Approach
The repository now returns the exact references-only `PolicyEvaluateRequestedEvent` created with the transactional handoff. AI Composer persists that handoff and syncs the generated draft to Airtable, then moves the record to `Needs Review`. When the human reviewer changes Airtable status to `Approved for Publish`, `ApprovedPostWorker` loads the queued handoff from Ledger and publishes it to the Policy queue. The downstream Policy and MCP publish path remains references-only.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| backend-specialist | Queue and worker boundary implementation |
| debugger | Root-cause tracing from runtime state |
| clean-code | Scoped code change |
| systematic-debugging | Reproduce, isolate and fix the stuck flow |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `apps/orchestrator/src/queue/rabbitmqPublisher.ts` | Modified | Added policy evaluate publisher and queue binding. |
| `apps/orchestrator/src/ledger/aiWorkerRepository.ts` | Modified | Returns persisted policy event and can load queued handoff events for `Approved for Publish`. |
| `apps/orchestrator/src/workers/ai-composer-worker.ts` | Modified | Holds generated drafts for Airtable review instead of auto-publishing policy, and moves Airtable status to `Needs Review`. |
| `apps/orchestrator/src/workers/approvedPostWorker.ts` | Modified | Handles `Approved for Publish` by publishing the existing queued policy handoff instead of creating another AI workflow. |
| `apps/orchestrator/src/ai/llmAdapter.ts` | Modified | Normalizes Gemini model names with optional `models/` prefix. |
| `apps/orchestrator/src/ledger/policyWorkerRepository.ts` | Modified | Resolves only active Facebook channel accounts with valid token status. |
| `apps/orchestrator/src/server.ts` | Modified | Injects queue publisher into AI Composer worker. |
| `apps/orchestrator/src/__tests__/ai-composer-worker.test.ts` | Modified | Asserts AI output is held for review and policy publish is not triggered until human approval. |
| `apps/orchestrator/src/__tests__/approvedPostWorker.test.ts` | Modified | Covers `Approved for Publish` handoff behavior. |
| `apps/orchestrator/src/__tests__/llmAdapter.test.ts` | Modified | Covers Gemini model prefix normalization. |
| `apps/orchestrator/src/__tests__/policyWorker.test.ts` | Modified | Covers active/valid channel account resolution. |
| `scripts/fb-auth-helper.mjs` | Modified | Declares global `fetch` for ESLint. |
| `apps/orchestrator/src/ledger/mcpPublishSchedulerRepository.ts` | Modified | Resolves due job workflow IDs through `content_variants`. |
| `apps/orchestrator/src/ledger/mcpPublishWorkerRepository.ts` | Modified | Updates workflow status through `content_variants` and passes external Page ID to MCP publish. |
| `apps/orchestrator/src/workers/__tests__/mcpPublishScheduler.test.ts` | Modified | Covers scheduler schema alignment. |
| `apps/orchestrator/src/workers/__tests__/mcpPublishWorker.test.ts` | Modified | Covers workflow status join and external Page ID boundary. |
| `apps/orchestrator/src/airtable/airtableClient.ts` | Modified | Uses the canonical lowercase Airtable `status` field for status updates. |
| `apps/orchestrator/src/__tests__/airtableClient.test.ts` | Modified | Covers lowercase `status` update payload. |
| `db/migrations/0017_us006_publish_job_error_columns.sql` | Created | Adds nullable sanitized publish failure columns. |
| `db/migrations/0018_us006_publish_workflow_statuses.sql` | Created | Adds publish completed/failed workflow enum states. |

## Impact & Purpose
The approved-post flow no longer forces AI output directly into publish. It now supports the intended human-in-the-loop path: Airtable `Approved` creates an AI draft; Airtable `Approved for Publish` releases that draft to Policy Engine and then to the MCP publish path.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Hold policy publish until human approval | Preserves Ledger-first queue semantics while preventing AI redelivery from bypassing review. | Publish immediately after AI commit, rejected because it skips review. |
| Keep payload references-only | Matches architecture and shared contract security rules. | Include body/variant content in queue, rejected. |
| Accept both `gemini-...` and `models/gemini-...` env values | Prevents valid Gemini model values copied from the model listing endpoint from becoming `/models/models/...`. | Require users to manually remove the prefix, rejected as fragile. |
| Select active/valid channel accounts only | Prevents inactive mock accounts from blocking real Facebook publish policy checks. | Keep latest connected account by timestamp, rejected because mock records can be newer. |
| Pass external Page ID to MCP publish | Facebook Graph needs the platform Page ID, while the queue and Ledger use the internal channel account UUID. | Use internal UUID in Graph path, rejected after runtime validation failed. |
| Use lowercase Airtable `status` | The live Posts table field is `status`; sending `Status` returns Airtable `UNKNOWN_FIELD_NAME`. | Keep uppercase `Status`, rejected after live Airtable 422 evidence. |
| Require `Approved for Publish` before policy/publish | Gives the user a real review step after AI draft generation. | Auto-publish immediately after `Approved`, rejected because it bypasses human review. |

## Verification
- [x] `npm run build` passed.
- [x] `node --test apps/orchestrator/dist/__tests__/ai-composer-worker.test.js apps/orchestrator/dist/queue/__tests__/rabbitmqPublisher.test.js apps/orchestrator/dist/__tests__/policyRabbitmqConsumer.test.js` passed.
- [x] `node --test apps/orchestrator/dist/__tests__/policyWorker.test.js apps/orchestrator/dist/__tests__/llmAdapter.test.js` passed.
- [x] `node --test apps/orchestrator/dist/workers/__tests__/mcpPublishWorker.test.js apps/orchestrator/dist/workers/__tests__/mcpPublishScheduler.test.js` passed.
- [x] `node --test apps/orchestrator/dist/__tests__/ai-composer-worker.test.js apps/orchestrator/dist/__tests__/approvedPostWorker.test.js` passed.
- [x] `npm run lint` passed.
- [x] `npm test` passed: all 65 listed test files passed.
- [x] Runtime smoke: Airtable webhook through ngrok queued, Gemini completed, Policy approved, MCP validation passed, scheduler emitted execute event, MCP publish posted to Facebook, publish job reached `published`.
- [x] Runtime evidence: publish job `692dcb69-44ca-4a0b-8dc8-6fb1eebaa73e` published with external post id `1148572968338785_122114885313357020` at `2026-06-30T04:57:14.146Z`.
- [x] Runtime evidence: Airtable record `recr0ZiULDoymZ012` updated to `status = Published`; publish job compensation flag cleared.
- [x] Runtime smoke after human-gate code deploy: orchestrator restarted and `GET /health` returned `ok`.
- [x] Docs updated.
- [x] No secrets exposed.
- [x] Acceptance criteria met: AI Composer hands off to Policy Engine with references-only queue event, and validated publish jobs can execute through MCP.

## Open Items / Next Steps
- Manual review demo now requires the Airtable `status` option `Approved for Publish`; if the single-select option is missing, add it in Airtable before testing the release step.
- Slack alert queue still has no active delivery consumer in this local smoke setup, so alert delivery remains outside this publish-path verification.
