# Report: Facebook Media Publish and Prompt Length Refinement

**Date:** 2026-06-30
**Agent(s) Used:** Codex GPT-5
**Related User Story:** US-003 / US-006
**Status:** Completed

## Summary
Added support for carrying Airtable asset links from AI generation into the Facebook publish path, and updated the Facebook composer prompt to respect requested word/character length fields.

## What Was Done
- [x] Added optional Airtable length fields to the reloaded post contract.
- [x] Added a prompt length requirement block to the Facebook composer prompt.
- [x] Persisted normalized `asset_links` into `content_variants`.
- [x] Supported both Airtable Attachment arrays and URL text fields for `asset_links`.
- [x] Extended MCP publish contract with reference-only media URLs.
- [x] Added Facebook photo publishing path for image URLs.
- [x] Treated document URLs as feed links for MVP.

## How It Was Done
### Approach
The change keeps RabbitMQ payloads reference-only. Airtable `asset_links` are reloaded by the worker, normalized from either Attachment objects or URL text, stored in Ledger, and later converted to MCP publish media references. Image URLs use the Facebook Page photo endpoint; document/link URLs are published as feed links.

### Tools & Skills Used
| Tool/Skill | Purpose |
|:---|:---|
| backend-specialist | Backend boundary and test-focused change |
| brownfield-maintenance | Trace existing Airtable -> Ledger -> MCP publish flow |
| spec-driven-development | Keep behavior tied to existing US-003/US-006 scope |

### Files Changed
| File | Action | Description |
|:---|:---|:---|
| `packages/shared-contracts/src/airtable/reloadedRecord.ts` | Modified | Added optional target length fields. |
| `apps/orchestrator/src/ai/prompt-registry.ts` | Modified | Added `<length_requirement>` prompt block. |
| `apps/orchestrator/src/workers/ai-composer-worker.ts` | Modified | Parses length fields and normalizes `asset_links` from Attachment arrays or URL text. |
| `apps/orchestrator/src/ledger/aiWorkerRepository.ts` | Modified | Persists `asset_links` to content variants. |
| `db/migrations/0019_us003_asset_links_for_facebook_publish.sql` | Created | Adds `content_variants.asset_links`. |
| `packages/shared-contracts/src/mcp/publishPost.ts` | Modified | Adds media references to publish input schema. |
| `apps/orchestrator/src/ledger/mcpPublishWorkerRepository.ts` | Modified | Converts stored asset links to MCP media references. |
| `apps/facebook-mcp-server/src/tools/publishPost.ts` | Modified | Uses `/photos` for image URL publish, feed link for document/link URLs. |
| Test files | Modified | Added prompt, contract, worker, and MCP publish coverage. |

## Impact & Purpose
Users can now use an Airtable Attachment field or public image/document URLs in Airtable `asset_links`. Images are published as Facebook photo posts; documents are attached as links. AI copy generation can now follow explicit requested length fields instead of ignoring the requested word/character count.

## Decisions Made
| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Store media as URLs in Ledger | Keeps queue and MCP contracts reference-only. | Upload binary assets through orchestrator, rejected for boundary/risk. |
| Use Facebook photo endpoint for images | Correct endpoint for Page image publishing. | Feed `link` only, rejected because it does not publish image post. |
| Treat documents as links | Facebook Page feed does not support generic document upload in this current flow. | Build storage/upload layer, deferred. |

## Verification
- [x] `npm run build` passed.
- [x] `npm run lint` passed.
- [x] `npm test` passed: all 66 test files passed.
- [x] Targeted media/prompt tests passed: `mcpPublishWorker`, `publishPost`, `prompt-registry`, `mcpPublishContracts`, and `airtableContracts`.
- [x] Migration `0019_us003_asset_links_for_facebook_publish.sql` applied to the configured staging database; `content_variants.asset_links` exists.
- [x] No secrets exposed.
- [x] Acceptance criteria met: prompt receives length requirement; media references flow from Airtable to Ledger to MCP; images use photo endpoint.

## Open Items / Next Steps
- Multiple-image/carousel upload and binary file storage remain out of scope.
- Instagram/Zalo/TikTok publishing should be planned as separate platform stories.
