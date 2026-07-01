# SPEC-US-003: AI Composer — Facebook Content Variant Generation

**Status:** Approved  
**Retrofit Note:** Retrospec — US-003 designed before AI-SDLC gate. Implementation is design-complete with conditional security approval. Test evidence is Partial.  
**FL Reference:** FL-002 (AI Composer Facebook Variant Generation) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 134  
**Backlog AC/BR:** US-003 AC1–AC4, BR1–BR5

---

## Goal

Consume the `ai.compose.facebook.requested` event, reload Airtable post context, optionally load Notion brief, build a versioned prompt, call the AI provider, validate the structured output (body, hashtags, CTA/UTM), persist a Facebook `content_variants` draft in Ledger, sync reviewable fields to Airtable, and hand off to US-004 via `policy.evaluate.requested` transactional outbox — without publishing, without calling Graph API, and without exposing tokens or raw AI output beyond sanitized snapshots.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-003
- **FL-002:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 134–239
- **Worker:** `apps/orchestrator/src/workers/ai-composer-worker.ts` (consumed via `ai-composer-worker.test.ts`)
- **Consumer:** `apps/orchestrator/src/queue/aiComposerRabbitmqConsumer.ts`
- **Prompt registry:** `apps/orchestrator/src/ai/prompt-registry.ts`
- **LLM adapter:** `apps/orchestrator/src/ai/llmAdapter.ts`
- **Structured validator:** `apps/orchestrator/src/ai/structuredValidator.ts`
- **Notion loader:** `apps/orchestrator/src/ai/notion-context-loader.ts` (see SPEC-US-013)
- **Queue topology:** `apps/orchestrator/src/queue/topologyConfig.ts` — `ai.compose.facebook.requested`
- **Schema:** `packages/shared-contracts/src/__tests__/composer.test.ts`
- **Plan:** `docs/plans/US-003/US-003-test-plan-and-evals.md`

---

## In Scope

- Consuming `ai.compose.facebook.requested` (exchange: `ai.workflows`, consumer: `AiComposerWorker`).
- Ledger claim via `workflow_runs` transaction (workflow: `ai_generation_processing`).
- Airtable context reload + revalidation (not trusted from queue payload).
- Optional Notion context loading via `NotionContextLoader` (SSRF-guarded).
- Versioned Facebook composer prompt build (`prompt_registry`).
- AI provider call via `llmAdapter` with timeout + bounded retry.
- Structured output validation: body, hashtags (normalized, ≤10), CTA URL, UTM preservation.
- Prompt injection detection.
- Ledger persist: `ai_generation_runs`, `content_variants` (draft), `notion_context_refs`, transactional `policy.evaluate.requested` outbox.
- Airtable sync of reviewable draft fields (non-blocking: failure sets `sync_retry_needed`).
- Policy handoff: `policy.evaluate.requested` outbox event emitted post-commit.

## Out of Scope

- Publishing, creating publish jobs, calling MCP publish tools, calling Facebook Graph API — strictly prohibited.
- Policy evaluation — belongs to US-004 / FL-003.
- Manual approval decision — Airtable-driven; AI Composer only produces draft.

---

## Functional Contract

Based on FL-002 (10 processing steps):

1. **Schema Validation (Consumer):** Validate `ai.compose.facebook.requested` via Zod. Invalid → DLQ (`ai.compose.facebook.requested.dlq`) + ACK.
2. **Claim Workflow:** Transaction `SET LOCAL app.current_workspace_id`. Lock `workflow_runs WHERE status='pending_ai_generation'`. Transition to `ai_generation_processing`. Initialize `ai_generation_runs` with idempotency key `ai.compose.facebook:{workspace_id}:{workflow_run_id}:{prompt_version}`. COMMIT before external I/O.
3. **Reload Airtable Context:** Reload post by `airtable_record_id`. Verify: status compatible, `target_channels` contains `Facebook`, required fields present, channel account refs safe.
4. **Load Notion Context (Optional):** Only via `NotionContextLoader` with SSRF controls. Allowed hosts: `api.notion.com`, `www.notion.so`, `notion.so`. Block redirects, private IP, non-standard ports. Context treated as untrusted — delimited in prompt.
5. **Build Prompt:** Use active versioned Facebook composer prompt from `promptRegistry.getPrompt(platform, version)`. Delimit all Airtable/Notion content as untrusted data. No tokens, secret refs, or credentials in prompt.
6. **Call AI Provider:** Via `llmAdapter` with validated config. Enforce timeout. Bounded retry for transient provider failures. Sanitize provider errors before logs.
7. **Validate Structured Output:**
   - Require `body`, `hashtags[]`.
   - Normalize hashtags: trim → add `#` → lowercase → dedupe → limit 10.
   - Validate `cta_url` if present (must be valid URL, UTM params preserved exactly).
   - Detect intent drift and prompt-injection indicators.
8. **Persist Result in Ledger (Transaction):**
   - On success: INSERT `content_variants` (`approval_status='needs_review'`, `policy_status='pending_policy'`), INSERT `ai_generation_runs` with sanitized snapshots, INSERT `notion_context_refs`, INSERT `policy.evaluate.requested` outbox. Transition `workflow_runs → ai_generation_completed`. COMMIT.
   - On validation fail (`SCHEMA_PARSING_FAILED`, `INTENT_DRIFT`, `CTA_UTM_MUTATED`): `ai_generation_runs.status = 'needs_manual_review'`, `workflow_runs → ai_generation_failed`. No active variant.
   - On security fail (`PROMPT_INJECTION_DETECTED`): hard fail, persist only `rawOutputHash`, no raw output stored.
9. **ACK RabbitMQ** ONLY after COMMIT.
10. **Post-Commit (async):** Airtable PATCH reviewable fields via field mapping config (not hardcoded field names). If Airtable stale → skip PATCH, set `sync_retry_needed = true`. Outbox relay publishes `policy.evaluate.requested`.

---

## Data / Queue / API Contract

### Queue: Input
- **Queue:** `ai.compose.facebook.requested`
- **Exchange:** `ai.workflows` (topic)
- **DLQ:** `ai.compose.facebook.requested.dlq`
- **Retry:** 5 retries with slow TTL backoff [2s, 4s, 8s, 16s, 32s]
- **Payload (references-only):** `{event_id, event_type: "ai.compose.facebook.requested", workspace_id, workflow_run_id, prompt_version, idempotency_key, correlation_id, causation_id}`
- **Forbidden:** source copy, tokens, prompts, AI output, CTA text, assets

### Queue: Output (policy handoff)
- **Queue:** `policy.evaluate.requested`
- **Exchange:** `publish.workflows` (topic)
- **Via:** transactional outbox relay

### Ledger Entities
- **`workflow_runs`:** status: `pending_ai_generation` → `ai_generation_processing` → `ai_generation_completed` | `ai_generation_failed`
- **`ai_generation_runs`:** `{id, workspace_id, workflow_run_id, idempotency_key, status, prompt_version, provider, model, input_snapshot (sanitized), output_snapshot (sanitized), raw_output_hash (hard-fail only), needs_manual_review_reason}`
- **`content_variants`:** `{id, workspace_id, workflow_run_id, platform: 'facebook', body, hashtags, cta_url, approval_status: 'needs_review', policy_status: 'pending_policy', sync_retry_needed}`
- **`notion_context_refs`:** `{ai_generation_run_id, notion_page_id, loaded_at, fallback_used}`

### Idempotency Key
`ai.compose.facebook:{workspace_id}:{workflow_run_id}:{prompt_version}` → `ai_generation_runs` UNIQUE

### Audit Events
`ai_run_claimed`, `ai_run_completed`, `ai_run_retryable_failed`, `ai_run_validation_failed`, `ai_run_failed`, `airtable_variant_synced`, `airtable_variant_sync_failed`, `policy_handoff_enqueued`

---

## Security & Safety Rules

- **AI Composer must NOT publish, create publish jobs, call Graph API, or invoke MCP publish tools.** This boundary is absolute.
- **No tokens, API keys, vault refs, or credentials in prompts, queue payload, logs, snapshots, Slack, or Airtable.**
- **Notion URLs must pass SSRF guard** before any fetch — no free URL loading.
- **Prompt injection hard failures** must not persist raw malicious output — only `rawOutputHash`.
- **RLS:** `SET LOCAL app.current_workspace_id = :workspace_id` in every transaction.
- **Airtable sync is non-blocking:** Ledger commit is never rolled back for Airtable failure.
- **`input_snapshot` and `output_snapshot`** are sanitized (no raw token, no provider credential).

---

## Error Cases

| Case | Detection | `ai_generation_runs.status` | `workflow_runs.status` | Queue |
|:---|:---|:---|:---|:---|
| Schema invalid | Zod fail | N/A | Unchanged | DLQ + ACK |
| Already claimed (idempotency) | key exists | Unchanged | Unchanged | ACK |
| Airtable context unreachable | HTTP fail | `needs_manual_review` | `ai_generation_failed` | ACK |
| Target channel not Facebook | `target_channels` missing | `needs_manual_review` | `ai_generation_failed` | ACK |
| Provider timeout/rate limit | Timeout | `retryable_failed` | — | Retry via scheduler |
| Structured output fail | Schema parsing error | `needs_manual_review` | `ai_generation_failed` | ACK |
| CTA/UTM mutation | `CTA_UTM_MUTATED` | `needs_manual_review` | `ai_generation_failed` | ACK |
| Prompt injection | `PROMPT_INJECTION_DETECTED` | `failed` (hash only) | `ai_generation_failed` | ACK |
| Airtable sync fail (post-commit) | HTTP error | Committed | Committed | ACK; `sync_retry_needed = true` |

---

## Acceptance Criteria

**AC1 — Facebook variant generated with correct structure (Backlog AC1)**
- *Given* a valid `ai.compose.facebook.requested` event for a post with `target_channels = ["Facebook"]`
- *When* `AiComposerWorker` processes the event successfully
- *Then* one `content_variants` row is inserted with `platform='facebook'`, `approval_status='needs_review'`, `policy_status='pending_policy'`, and `hashtags` are normalized (≤10, all lowercase with `#`).
- *Trace evidence:* Test case `"should normalize hashtags and preserve UTM on success"` in [ai-composer-worker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/ai-composer-worker.test.ts) and [REPORT-us-003-ai-composer-worker-flow-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-ai-composer-worker-flow-2026-05-21.md).

**AC2 — AI Composer never calls publish or Graph API (Backlog AC2, BR4)**
- *Given* any AI composition run
- *When* the worker completes (success or failure)
- *Then* no MCP publish tool is called, no `publish_jobs` row is inserted, and no Facebook Graph API request is made from orchestrator.
- *Trace evidence:* Verified via negative boundary check in [ai-composer-worker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/ai-composer-worker.test.ts) (ensuring no mock publishers or MCP calls are made).

**AC3 — Prompt injection fails hard without storing raw output (Backlog AC3)**
- *Given* AI provider returns output that triggers `PROMPT_INJECTION_DETECTED`
- *When* the worker processes the result
- *Then* `ai_generation_runs.status = 'failed'`, `raw_output_hash` is stored instead of raw output, `workflow_runs.status = 'ai_generation_failed'`, and no `content_variants` row is inserted.
- *Trace evidence:* Test case `"should reject and fail workflow on prompt injection"` in [structuredValidator.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/structuredValidator.test.ts) and [REPORT-us-003-structured-output-validation-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-structured-output-validation-2026-05-21.md).

**AC4 — Policy handoff emitted on success (Backlog AC4)**
- *Given* a successful composition
- *When* the Ledger transaction commits
- *Then* a `policy.evaluate.requested` outbox event is inserted and eventually relayed to the `policy.evaluate.requested` queue for US-004.
- *Trace evidence:* Test case `"should enqueue policy evaluate request on success"` in [ai-composer-worker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/ai-composer-worker.test.ts) and [REPORT-us-003-policy-handoff-boundary-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-policy-handoff-boundary-2026-05-21.md).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [ai-composer-worker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/ai-composer-worker.test.ts) | `apps/orchestrator/src/__tests__/ai-composer-worker.test.ts` | Happy path variant creation, duplicate processing prevention, outbox policy evaluate handoff |
| [aiComposerRabbitmqConsumer.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/aiComposerRabbitmqConsumer.test.ts) | `apps/orchestrator/src/__tests__/aiComposerRabbitmqConsumer.test.ts` | Invalid incoming payload schema → DLQ routing |
| [structuredValidator.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/structuredValidator.test.ts) | `apps/orchestrator/src/__tests__/structuredValidator.test.ts` | Hashtag parsing/normalization, UTM extraction, intent drift, prompt injection check |
| [llmAdapter.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/llmAdapter.test.ts) | `apps/orchestrator/src/__tests__/llmAdapter.test.ts` | Model configurations, timeout, rate limit, exception sanitization |
| [prompt-registry.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/prompt-registry.test.ts) | `apps/orchestrator/src/__tests__/prompt-registry.test.ts` | Version prompt lookup, template token compilation |
| [notion-context-loader.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/notion-context-loader.test.ts) | `apps/orchestrator/src/__tests__/notion-context-loader.test.ts` | Notion SSRF protection checks (allowed list and private IP blocks) |
| [composer.test.ts](file:///d:/Muti-Media%20Management/packages/shared-contracts/src/__tests__/composer.test.ts) | `packages/shared-contracts/src/__tests__/composer.test.ts` | Queue schema validation contracts |

### Verification Evidence Reports

TDD runs and validation reports:
- [REPORT-us-003-ai-composer-worker-flow-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-ai-composer-worker-flow-2026-05-21.md)
- [REPORT-us-003-structured-output-validation-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-structured-output-validation-2026-05-21.md)
- [REPORT-us-003-policy-handoff-boundary-2026-05-21.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-policy-handoff-boundary-2026-05-21.md)
- [REPORT-us-003-implementation-security-gate-audit-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-003/REPORT-us-003-implementation-security-gate-audit-2026-06-01.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original red-stage execution outputs not captured. However, the regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/__tests__/ai-composer-worker.test.ts`

---

## Open Questions

- OQ-003-1: Is `target_channels` a multi-select field? *Resolved:* Yes, in Airtable it is defined as a multi-select field, and the worker reloads it as an array to verify if it contains `"Facebook"`.
- OQ-003-2: Is provider retry via delayed scheduler or NACK loop? *Resolved:* AI Composer uses a delayed scheduler queue (with exponential backoff) for provider retries to avoid blocking the primary RabbitMQ thread or creating a hot loop.

