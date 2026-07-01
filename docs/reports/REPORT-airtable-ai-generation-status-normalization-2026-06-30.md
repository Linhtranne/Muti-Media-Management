# Report: Airtable AI Generation Status Normalization

**Date:** 2026-06-30
**Agent(s) Used:** Codex debugger/backend-specialist
**Related User Story:** US-003
**Status:** Completed

## Summary
Normalized the Airtable `ai_generation_status` value sent by the AI composer from the display label `Needs Review` to the machine-readable Airtable option `needs_review`.

## What Was Done
- [x] Changed successful AI draft sync to send `ai_generation_status = needs_review`.
- [x] Kept `Posts.status = Needs Review` unchanged for the human review workflow.
- [x] Updated tests to assert the normalized machine-readable value.

## How It Was Done
### Approach
Separated the user-facing post status from the machine-readable AI generation status so Airtable single-select options match the actual base schema.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| systematic-debugging | Verify the Airtable option mismatch before changing code |
| npm build/lint/test | Validate the TypeScript and targeted behavior |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `apps/orchestrator/src/workers/ai-composer-worker.ts` | Modified | Send `needs_review` for `ai_generation_status`. |
| `apps/orchestrator/src/__tests__/ai-composer-worker.test.ts` | Modified | Updated expected AI generation status. |
| `apps/orchestrator/src/__tests__/airtableClient.test.ts` | Modified | Updated retry test expected status value. |
| `docs/reports/REPORT-airtable-ai-generation-status-normalization-2026-06-30.md` | Created | Documented the normalization fix. |

## Impact & Purpose
Future AI draft syncs match the Airtable `ai_generation_status` options and no longer depend on adding a display-label option to that field.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Use `needs_review` for `ai_generation_status` | Existing Airtable field options are machine-readable. | Add `Needs Review` to Airtable; rejected because it mixes display labels with state enum values. |

## Verification
- [x] `npm run build` passed.
- [x] `npm run lint` passed.
- [x] `node --test apps/orchestrator/dist/__tests__/airtableClient.test.js apps/orchestrator/dist/__tests__/ai-composer-worker.test.js` passed.
- [x] Local orchestrator restarted and `/health` returned `ok`.
- [x] No secrets exposed.

## Open Items / Next Steps
- Airtable Automation still needs to be checked separately if webhook events do not appear automatically after status changes.
