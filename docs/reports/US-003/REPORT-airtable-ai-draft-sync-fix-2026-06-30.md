# Report: Airtable AI Draft Sync Fix

**Date:** 2026-06-30
**Agent(s) Used:** Codex debugger/backend-specialist
**Related User Story:** US-003
**Status:** Completed

## Summary
Investigated why an Airtable approved post did not receive AI-generated draft fields. The AI worker completed generation in Ledger, but Airtable rejected the draft sync because `facebook_hashtags` was a text field while the client sent an array.

## What Was Done
- [x] Traced the record from Airtable webhook ingress through workflow, AI run, content variant, and Airtable patch.
- [x] Identified an invalid `cta_url` value containing a base64 image data URL and reran the record without CTA.
- [x] Fixed Airtable draft sync to serialize hashtag arrays as a space-separated text string.
- [x] Patched the generated draft content back to the Airtable record.

## How It Was Done
### Approach
Queried Postgres Ledger tables for the affected Airtable record, reproduced the Airtable PATCH failure directly, then changed only the Airtable client serialization boundary.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| systematic-debugging | Trace root cause before changing code |
| PowerShell / Node scripts | Query DB, Airtable, and local health endpoint |
| npm build/lint/test | Verify code quality after the fix |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `apps/orchestrator/src/airtable/airtableClient.ts` | Modified | Convert generated hashtag arrays to a text string before patching Airtable. |
| `docs/reports/REPORT-airtable-ai-draft-sync-fix-2026-06-30.md` | Created | Document investigation, root cause, and validation evidence. |

## Impact & Purpose
AI-generated drafts can now sync into Airtable text/rich-text hashtag fields without Airtable rejecting the payload.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Serialize hashtags as text | Airtable field is text/rich text in the current demo base. | Recreate the field as multi-select; this requires Airtable schema write permission and is less suitable for arbitrary hashtags. |

## Verification
- [x] `npm run build` passed.
- [x] `npm run lint` passed.
- [x] `node --test apps/orchestrator/dist/__tests__/airtableClient.test.js` passed.
- [x] `npm test` passed: all 65 test files passed.
- [x] Airtable record `recxHlfx9rAMMWwEC` received `facebook_body`, `facebook_hashtags`, `ai_review_notes`, and `ledger_variant_id`.
- [x] No secrets exposed.

## Open Items / Next Steps
- Add the missing Airtable single-select option `Needs Review` to the relevant status fields so the worker can update status automatically.
- Image publishing remains out of MVP scope; `cta_url` must not contain `data:image/...` payloads.
