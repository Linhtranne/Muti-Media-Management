# AI-SDLC Retrofit Header for US-003

status: approved

## Goal

Maintain US-003 behavior for AI Composer Facebook Variant Generation according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-003` passes after retrofit artifacts are present.

# US-003 Final Implementation Notes: AI Composer Facebook Variant

## 1. Status

| Attribute | Value |
|:---|:---|
| User Story | US-003 |
| Feature | AI Composer Facebook Variant |
| Current Gate | Design approved |
| Release Decision | Approved for implementation with mandatory security conditions |
| Date | 2026-05-21 |

US-003 is approved to move from design to implementation. The implementation team must still satisfy the mandatory security and migration conditions listed in this document before any production release.

## 2. Documents Reviewed

The implementation baseline is composed from:

- `docs/plans/US-003/PLAN-us-003-ai-composer-facebook-variant.md`
- `docs/plans/US-003/US-003-scope-lock.md`
- `docs/plans/US-003/US-003-ai-ledger-schema-and-idempotency.md`
- `docs/plans/US-003/US-003-shared-ai-contracts.md`
- `docs/plans/US-003/US-003-ai-composer-worker-flow.md`
- `docs/plans/US-003/US-003-context-loading-boundary.md`
- `docs/plans/US-003/US-003-prompt-template-and-versioning.md`
- `docs/plans/US-003/US-003-structured-output-validation.md`
- `docs/plans/US-003/US-003-ai-provider-adapter-and-retry.md`
- `docs/plans/US-003/US-003-variant-persistence-and-airtable-update.md`
- `docs/plans/US-003/US-003-policy-handoff-boundary.md`
- `docs/plans/US-003/US-003-test-plan-and-evals.md`
- `docs/plans/US-003/US-003-security-and-privacy-review.md`

Project constraints were revalidated against:

- `docs/architecture/06_Architecture_Composability.md`
- `docs/architecture/11_Coding_Convention.md`
- `docs/requirements/04_Product_Backlog.md`
- `docs/requirements/05_Function_Flow_Logic_Register.md`
- `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md`
- `docs/requirements/03_SRS_MediaOps_Composability.md`

## 3. Scope Lock

US-003 starts only after US-002 has created a durable `workflow_runs` row with:

- `status = 'pending_ai_generation'`
- `workspace_id`
- `airtable_record_id`
- `approved_version`
- safe `channel_account_refs`

US-003 must not:

- process Airtable Approved webhooks directly;
- allocate or mutate `approved_version`;
- create publish jobs;
- call Facebook Graph API;
- call Facebook MCP tools such as `validate_post`, `enqueue_publish`, or `publish_post`;
- bypass human review or policy evaluation;
- store raw credentials in queues, logs, audit metadata, Airtable, Slack, prompts, or snapshots.

## 4. Implementation Components

| Component | Target Location | Notes |
|:---|:---|:---|
| Shared AI contracts | `packages/shared-contracts` | Zod schemas, TypeScript interfaces, error taxonomy. |
| AI Composer worker | `apps/workers` or orchestrator worker package | Claims `pending_ai_generation`, runs context loading, prompt, provider adapter, validation, persistence. |
| Prompt templates | Orchestrator-owned prompt registry | Versioned like code; first active version participates in idempotency. |
| Ledger schema migrations | Postgres migration layer | Add `ai_generation_runs`, `content_variants`, `policy_handoff_events`, enum extensions, RLS. |
| Policy handoff outbox | Worker / Ledger boundary | Transactional outbox only; no publish queue. |
| Airtable sync adapter | Orchestrator integration boundary | Uses mapping config, writes reviewable draft fields only. |

## 5. Final Ledger Contract

### `ai_generation_runs`

Minimum required fields:

- `id UUID PRIMARY KEY`
- `workspace_id TEXT NOT NULL`
- `workflow_run_id UUID NOT NULL`
- `airtable_record_id TEXT NOT NULL`
- `approved_version INTEGER NOT NULL`
- `platform TEXT NOT NULL DEFAULT 'facebook'`
- `idempotency_key TEXT NOT NULL`
- `provider TEXT NOT NULL`
- `model TEXT NOT NULL`
- `prompt_version TEXT NOT NULL`
- `input_snapshot JSONB NOT NULL`
- `notion_context_refs JSONB NOT NULL DEFAULT '[]'::jsonb`
- `output_snapshot JSONB NULL`
- `status ai_generation_status NOT NULL`
- `error_code VARCHAR(50) NULL`
- `error_message TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `completed_at TIMESTAMPTZ NULL`

Required idempotency:

- `ai.compose.facebook:{workspace_id}:{workflow_run_id}:{prompt_version}`
- Unique key on `(workspace_id, workflow_run_id, platform, prompt_version)`
- Duplicate redelivery must reuse or short-circuit the existing run, never create a second active draft for the same workflow and prompt version.

### `content_variants`

Minimum required fields:

- `id UUID PRIMARY KEY`
- `workspace_id TEXT NOT NULL`
- `ai_generation_run_id UUID NOT NULL`
- `workflow_run_id UUID NOT NULL`
- `airtable_record_id TEXT NOT NULL`
- `post_id TEXT NOT NULL`
- `platform TEXT NOT NULL`
- `body TEXT NOT NULL`
- `hashtags JSONB NOT NULL DEFAULT '[]'::jsonb`
- `cta_url TEXT NULL`
- `approval_status TEXT NOT NULL DEFAULT 'needs_review'`
- `policy_status TEXT NOT NULL DEFAULT 'pending_policy'`
- `sync_retry_needed BOOLEAN NOT NULL DEFAULT false`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Required indexes:

- Unique active draft key on `(workspace_id, workflow_run_id, platform)`
- Partial sync retry index:

```sql
CREATE INDEX idx_content_variants_sync_retry
ON content_variants (workspace_id, id)
WHERE sync_retry_needed = true;
```

### `policy_handoff_events`

US-003 writes a transactional outbox row only after successful variant persistence.

The outbox event must include:

- `event_id`
- `event_type = 'policy.evaluate.requested'`
- `workspace_id`
- `correlation_id`
- `workflow_run_id`
- `ai_generation_run_id`
- `content_variant_id`
- `airtable_record_id`
- `platform = 'facebook'`
- `prompt_version`
- `approved_version`
- `idempotency_key`
- sanitized `metadata`

## 6. Final Status Machine

### `workflow_runs`

| Status | Meaning |
|:---|:---|
| `pending_ai_generation` | US-002 handoff is ready for Composer. |
| `ai_generation_processing` | US-003 worker has claimed the workflow. |
| `ai_generation_completed` | Valid variant saved and policy handoff prepared. |
| `ai_generation_failed` | Composer failed or was review-blocked; no policy/publish handoff. |

### `ai_generation_runs`

| Status | Meaning |
|:---|:---|
| `queued` | Run initialized but not executed. |
| `processing` | Context loading, prompt construction, provider call, or validation is in progress. |
| `completed` | Valid output stored and variant persisted. |
| `needs_manual_review` | Soft fail: quality/schema/CTA/intent issue; no active variant draft. |
| `retryable_failed` | Temporary provider/context failure; delayed retry allowed. |
| `failed` | Terminal or security failure. |

### `content_variants`

| Field | Required Value on Success |
|:---|:---|
| `approval_status` | `needs_review` |
| `policy_status` | `pending_policy` |
| `platform` | `facebook` |

## 7. Worker Flow

1. Consume a references-only queue message or poll/select eligible `workflow_runs`.
2. Start a Postgres transaction.
3. Set tenant context:

```sql
SET LOCAL app.current_workspace_id = :workspace_id;
```

4. Claim one `workflow_runs.status = 'pending_ai_generation'` row using row locking such as `FOR UPDATE SKIP LOCKED`.
5. Transition parent workflow to `ai_generation_processing`.
6. Initialize or resume `ai_generation_runs` using the idempotency key.
7. Commit before external I/O.
8. Reload Airtable source by reference and revalidate that:
   - source status is still compatible with US-003 processing;
   - `target_channels` explicitly contains `Facebook`;
   - required fields are present;
   - channel refs from US-002 are present and safe.
9. Load Notion context only through the hardened allowlist boundary.
10. Build the versioned prompt and call the provider adapter.
11. Validate structured output.
12. Persist final success/failure state in Ledger.
13. ACK RabbitMQ only after the durable Ledger state is committed.

Retryable failures must be committed as durable `retryable_failed` state and ACK the current delivery; retries should be scheduled through delayed retry or scheduler, not hot NACK loops.

## 8. Context Loading Rules

Airtable remains the source of operational state. Notion is optional knowledge context only.

Notion URL loading must enforce:

- `https` only;
- allowed hosts: `api.notion.com`, `www.notion.so`, `notion.so`;
- `*.notion.site`, shortened links, custom domains, redirects, userinfo, and nonstandard ports blocked by default;
- `maxRedirects = 0`;
- DNS post-resolve IP range checks blocking loopback, private, link-local, and metadata IP ranges.

If Notion is unavailable, fallback is allowed only when the Airtable campaign objective is sufficient. The fallback must be recorded in `notion_context_refs` with `load_status`, `ai_ready = false`, `fallback_source`, and an error code such as `CONTEXT_UNREACHABLE`.

## 9. Prompt and Provider Rules

- Prompt templates are production code and must be versioned.
- `prompt_version` participates in idempotency.
- The first prompt should use a version such as `fb_composer_v1.0.0`.
- Untrusted Notion and Airtable text must be delimited and treated as data, not instructions.
- No concrete provider/model is hardcoded in contracts. Provider and model are selected from validated runtime config.
- Provider credentials are injected in memory only and never serialized into request payload logs, snapshots, errors, or audit metadata.
- Provider timeout baseline: 30 seconds.
- Retry only transient provider errors such as timeout or rate limit.

## 10. Structured Output and Validation

Required structured output:

```ts
type StructuredComposerOutput = {
  body: string;
  hashtags: string[];
  cta_url?: string;
};
```

Validation rules:

- `body` must preserve the source intent and avoid phantom claims.
- `hashtags` normalize permissively by trimming, adding `#`, lowercasing before dedupe, and limiting to 10 items.
- malformed or non-array hashtags map to `SCHEMA_PARSING_FAILED`.
- `cta_url` must preserve source UTM parameters exactly.
- UTM validation is a dedicated utility, not just Zod parsing.
- dangerous output keys such as `approved`, `publish`, `platform_override`, or `policy_bypass` trigger `PROMPT_INJECTION_DETECTED`.
- non-dangerous unknown keys may be stripped.

## 11. Error Taxonomy

The implementation must support these `AiErrorCode` values at minimum:

- `PROVIDER_RATE_LIMIT`
- `PROVIDER_TIMEOUT`
- `CONTEXT_UNREACHABLE`
- `SCHEMA_PARSING_FAILED`
- `INTENT_DRIFT`
- `CTA_UTM_MUTATED`
- `CTA_URL_INVALID`
- `CTA_URL_MISSING`
- `PROMPT_INJECTION_DETECTED`
- `INVALID_MODEL_CONFIG`
- `AIRTABLE_CONTEXT_UNREACHABLE`
- `AIRTABLE_CONTEXT_INVALID`
- `STALE_SOURCE_STATUS_CHANGED`
- `NOTION_NOT_ALLOWLISTED`
- `NOTION_NOT_AI_READY`

Failure handling:

| Class | Example Codes | Ledger State | Active Variant? | Airtable Feedback |
|:---|:---|:---|:---|:---|
| Retryable | `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMIT`, temporary context outage | `ai_generation_runs.retryable_failed`; parent eventually reopens to `pending_ai_generation` through scheduler policy | No | Optional sanitized pending/retry note |
| Soft fail | `SCHEMA_PARSING_FAILED`, `INTENT_DRIFT`, `CTA_UTM_MUTATED`, `CTA_URL_INVALID`, `CTA_URL_MISSING` | `ai_generation_runs.needs_manual_review`; parent `ai_generation_failed` | No | `Review Blocked` with sanitized reason |
| Hard fail | `PROMPT_INJECTION_DETECTED`, credential leak, unsafe override keys | `ai_generation_runs.failed`; parent `ai_generation_failed` | No | `Failed` or security-blocked note |
| Terminal config/source | `INVALID_MODEL_CONFIG`, `STALE_SOURCE_STATUS_CHANGED`, unrecoverable Airtable context | `ai_generation_runs.failed`; parent `ai_generation_failed` | No | Sanitized operational note |

Hard security failures must not store raw provider output; persist only a hash and sanitized metadata.

## 12. Airtable Sync Rules

Airtable field names must be abstracted behind a mapping config, for example:

```ts
type AirtableVariantFieldMapping = {
  variant_draft: string;
  variant_hashtags: string;
  variant_cta_url: string;
  ai_generation_status: string;
  ai_review_notes: string;
  ledger_variant_id: string;
};
```

Rules:

- Ledger commit happens before Airtable sync.
- Airtable sync failure must not roll back a completed Ledger transaction.
- On Airtable sync failure, write sanitized audit metadata and set `content_variants.sync_retry_needed = true`.
- Airtable sync must never mutate the main Post status to `Approved`, `Scheduled`, `Published`, or any publish-driving state.
- Airtable receives only validated draft fields or sanitized review notes, never raw provider output or stack traces.

## 13. Policy Handoff Boundary

US-003 hands off to US-004 only when all conditions are true:

- `workflow_runs.status = 'ai_generation_completed'`
- `ai_generation_runs.status = 'completed'`
- `content_variants.approval_status = 'needs_review'`
- `content_variants.policy_status = 'pending_policy'`
- structured content is valid

`sync_retry_needed = true` does not block policy handoff. The handoff metadata should record that Airtable sync is pending.

The handoff must use the transactional outbox pattern and a references-only event. It must not create publish jobs or invoke Graph API/MCP.

## 14. Security Conditions Before Coding

Implementation is conditionally approved only if these controls are implemented:

1. Every tenant-scoped DB transaction executes `SET LOCAL app.current_workspace_id = :workspace_id`.
2. Normal worker code does not use service roles that bypass RLS.
3. All RLS policies include both `USING` and `WITH CHECK`.
4. Notion SSRF controls are implemented before network fetches are enabled.
5. Global log redaction blocks tokens, bearer strings, API keys, vault refs, and provider credentials.
6. RabbitMQ payloads contain references only.
7. Workers ACK only after durable Ledger state commits.
8. Prompt injection hard failures do not persist raw malicious output.

The implementation evidence must be tracked in `docs/plans/US-003/US-003-implementation-security-gate.md`.

## 15. Test and Release Gates

Implementation must include tests for:

- successful happy path from `pending_ai_generation` to variant + policy outbox;
- duplicate/redelivered worker message;
- ACK-after-Ledger behavior;
- timeout/rate-limit retryable provider failures;
- malformed JSON and schema parsing failures;
- hashtag normalization and unrecoverable hashtag corruption;
- CTA missing, invalid, and UTM-mutated cases;
- Notion unavailable fallback;
- Notion SSRF blocked URLs;
- prompt injection dangerous keys;
- Airtable sync compensation and retry flag;
- RLS `SET LOCAL` fail-closed behavior;
- no Graph API, MCP publish tool, or publish queue side effect in US-003.

Release remains blocked for production if any test shows token leakage, publish-boundary breach, missing RLS tenant context, unsafe Notion URL fetch, or ACK before Ledger commit.

## 16. Carry-Forward Items

| ID | Item | Required Action |
|:---|:---|:---|
| GAP-001 | `ai_generation_runs.error_code` size uncapped | Use `VARCHAR(50)` or equivalent migration constraint. |
| GAP-002 | Hashtag dedupe case behavior | Lowercase before dedupe in `normalizeHashtags`. |
| GAP-003 | Notion fallback status | Do not add a workflow fallback status; record fallback in `notion_context_refs`. |
| GAP-004 | Airtable sync race | Use optimistic locking based on Postgres version/timestamps when syncing Airtable. |
| SEC-001 | RLS session context | Enforce `SET LOCAL app.current_workspace_id` at transaction start. |
| SEC-002 | SSRF hardening | Enforce URL allowlist, no redirects, DNS/IP checks. |
| GATE-001 | Implementation security gate | Complete `US-003-implementation-security-gate.md` with code and test evidence before production release. |

## 17. Definition of Done for US-003 Implementation

- TypeScript contracts exist in `packages/shared-contracts`.
- Ledger migrations are additive, RLS-protected, and workspace-scoped.
- AI Composer worker implements claim, idempotency, context loading, prompt, provider, validation, persistence, Airtable sync, and policy outbox.
- Prompt registry supports versioning and rollback.
- All provider errors are sanitized and classified.
- Airtable sync uses mapping config and compensation.
- Policy handoff outbox emits references-only `policy.evaluate.requested`.
- Tests cover AC1-AC4 and BR1-BR3.
- Security review conditions are verified before production release.

## 18. Design Approval Record

| Date | Decision | Notes |
|:---|:---|:---|
| 2026-05-21 | US-003 design approved | Approved to proceed into implementation planning/coding. Production release remains blocked until mandatory security conditions and carry-forward gaps are implemented and verified. |
