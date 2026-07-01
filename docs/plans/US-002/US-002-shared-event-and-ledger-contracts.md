# AI-SDLC Retrofit Header for US-002

status: approved

## Goal

Maintain US-002 behavior for Airtable Approved Webhook Workflow Trigger according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-002` passes after retrofit artifacts are present.

# US-002 Shared Event and Ledger Contracts

## 1. Docs Read

Read and applied in required order:
1. `docs/architecture/06_Architecture_Composability.md`
2. `docs/architecture/11_Coding_Convention.md`
3. `docs/requirements/04_Product_Backlog.md`
4. `docs/requirements/05_Function_Flow_Logic_Register.md`
5. `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md`
6. `docs/requirements/03_SRS_MediaOps_Composability.md`
7. `docs/requirements/13_Sprint_1_Backlog.md`
8. `docs/plans/US-001/US-001-final-implementation-notes.md`
9. `docs/plans/US-001/US-001-middleware-handoff-contract.md`
10. `docs/plans/US-002/PLAN-us-002-airtable-approved-webhook.md`
11. `docs/plans/US-002/US-002-scope-lock.md`
12. `docs/plans/US-002/US-002-ledger-schema-and-idempotency.md`

Specialist knowledge applied silently:
- `C:\Users\Hi\.spawner\skills\backend\api-design\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\api-design\sharp-edges.yaml`
- `C:\Users\Hi\.spawner\skills\backend\event-architect\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\event-architect\sharp-edges.yaml`
- `C:\Users\Hi\.spawner\skills\backend\queue-workers\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\queue-workers\sharp-edges.yaml`
- `.agent/agents/backend-specialist.md`

Conflict priority enforced:
Architecture > Coding Convention > Product Backlog > Function Flow Register > US-002 Scope Lock > Ledger Schema > Plan.

## 2. Design Objective

Define shared TypeScript contracts in `packages/shared-contracts` for US-002 so webhook receiver, queue publisher, worker, ledger repository, and test fixtures use one stable schema baseline.

This task is contract design/spec only. No runtime receiver/worker implementation is included in T-003.

## 3. Contract Scope

In scope:
- common event envelope
- incoming Airtable webhook signal contract
- RabbitMQ references-only message contracts
- ledger status enum contract
- queue status enum contract
- workflow run status contract
- ledger error code contract
- forbidden fields guard contract
- validation strategy (runtime schema shape proposal)

Out of scope:
- runtime network calls (Airtable/Facebook/Slack)
- actual queue consume/publish implementation
- actual DB repository implementation

## 4. Event Envelope

Base envelope contract (shared for evented modules):

```ts
export interface EventEnvelope<TPayload> {
  event_id: string;
  event_type: string;
  event_version: number;
  source: string;
  occurred_at: string;   // ISO8601
  recorded_at: string;   // ISO8601
  correlation_id: string;
  causation_id: string;
  workspace_id: string;
  payload: TPayload;
}
```

Rules:
- `event_version` mandatory for schema evolution.
- `correlation_id` mandatory for cross-service trace.
- `causation_id` mandatory for causal chain.
- `payload` must be references-only for queue contracts in US-002.

## 5. Incoming Airtable Webhook Contract

Webhook signal contract (ingress, not source-of-truth payload):

```ts
export interface AirtableWebhookSignal {
  event_id: string;
  record_id: string;
  table_name: string;
  change_type: string;
  approved_at: string;   // ISO8601 hint
  base_id?: string;
  workspace_id?: string;
}
```

Interpretation rule:
- Payload is a trigger signal only.
- Middleware/worker must reload Airtable record and reverify state before workflow decision.

## 6. RabbitMQ Approved Post Message Contract

Important boundary from T-002:
- `approved_version` is server-side ledger value finalized after successful reload/reverify path.
- Therefore ingress queue message must not require `approved_version`.

For US-002, use two references-only queue contracts:

### 6.1 AirtableApprovedWebhookIngressMessage (pre-reload)

```ts
export interface AirtableApprovedWebhookIngressMessage {
  event_id: string;
  event_type: 'airtable.post.approved.ingress';
  event_version: 1;
  source: 'airtable.webhook_receiver';
  workspace_id: string;
  record_ref: string;
  approval_ref: string; // approved_at hint
  idempotency_key: string; // ingress-level dedupe
  correlation_id: string;
  causation_id: string;
}
```

Ingress idempotency key format:
- `airtable.webhook.ingress:{event_id}`

### 6.2 ApprovedPostWorkflowMessage (post-reload, validated)

```ts
export interface ApprovedPostWorkflowMessage {
  event_id: string;
  event_type: 'airtable.post.approved';
  event_version: 1;
  source: 'airtable.webhook_worker';
  workspace_id: string;
  record_ref: string;
  approval_ref: string;
  approved_version: number; // allocated/validated server-side
  idempotency_key: string;  // production workflow idempotency
  correlation_id: string;
  causation_id: string;
}
```

Production workflow idempotency key format:
- `airtable.post.approved:{workspace_id}:{record_ref}:{approved_version}`

Notes:
- Both contracts remain references-only.
- No `master_copy`, URL, asset list, or token-like fields.

## 7. Ledger Status Contracts

```ts
export const WEBHOOK_EVENT_STATUSES = [
  'received',
  'queued',
  'processing',
  'workflow_stub_created',
  'duplicate_ignored',
  'unrelated_ignored',
  'already_advanced_ignored',
  'state_changed_ignored',
  'unknown_status_ignored',
  'invalid_after_reload_ignored',
  'approval_version_mismatch_ignored',
  'channel_account_missing',
  'channel_account_inactive',
  'channel_account_unresolved',
  'retryable_failed',
  'failed'
] as const;

export type WebhookEventStatus = typeof WEBHOOK_EVENT_STATUSES[number];
```

Queue status enum (neutral, no social-publish ambiguity):

```ts
export const QUEUE_EVENT_STATUSES = [
  'enqueue_pending',
  'enqueue_succeeded',
  'enqueue_failed_retryable',
  'enqueue_failed_terminal',
  'consumed',
  'acked',
  'nacked_requeue',
  'nacked_dlq'
] as const;

export type QueueEventStatus = typeof QUEUE_EVENT_STATUSES[number];
```

Workflow run status (US-002 stub only):

```ts
export const WORKFLOW_RUN_STATUSES = ['pending_ai_generation'] as const;
export type WorkflowRunStatus = typeof WORKFLOW_RUN_STATUSES[number];
```

## 8. Error Code Contracts

Suggested shared, stable error code constants:

```ts
export const LEDGER_ERROR_CODES = [
  'duplicate_event',
  'already_advanced',
  'state_changed',
  'unknown_status',
  'invalid_after_reload',
  'approval_version_mismatch',
  'channel_account_missing',
  'channel_account_inactive',
  'channel_account_unresolved',
  'airtable_api_retryable',
  'queue_enqueue_retryable',
  'queue_enqueue_terminal',
  'internal_failed'
] as const;

export type LedgerErrorCode = typeof LEDGER_ERROR_CODES[number];
```

Mapping guideline:
- `retryable_failed` must use retryable code variants.
- `failed` must use terminal/internal code variants.
- ignored statuses should still persist explicit code for observability.

## 9. Runtime Validation Strategy

Use runtime schema validation in `packages/shared-contracts` (zod recommended):
- compile-time TypeScript types + runtime parse/validate.
- strict object mode to reject unknown keys on queue contracts.
- enforce required fields: `event_version`, `correlation_id`, `causation_id`, `idempotency_key` where applicable.
- branded string helpers for IDs/timestamps optional but recommended.

Example strategy (shape only):
- `EventEnvelopeSchema<TPayload>`
- `AirtableWebhookSignalSchema`
- `AirtableApprovedWebhookIngressMessageSchema`
- `ApprovedPostWorkflowMessageSchema`
- `WebhookEventStatusSchema`
- `QueueEventStatusSchema`
- `WorkflowRunStatusSchema`

## 10. Forbidden Fields and Security Guards

Forbidden in queue payloads and audit metadata:
- `master_copy`
- `cta_url`
- `asset_links`
- `access_token`
- `refresh_token`
- `secret_ref`
- `app_secret`
- full Airtable record snapshot
- raw Facebook/Page token
- raw Slack signing secret

Contract guard requirements:
1. Do not define these fields in any queue interface.
2. Runtime validator rejects objects containing forbidden keys.
3. Metadata contracts must use sanitized diagnostic fields only.
4. Log/error contracts must avoid token-like raw values.

## 11. Schema Evolution Rules

1. Keep v1 event contracts backward compatible.
2. Add fields as optional first; do not rename/remove existing required fields in-place.
3. Bump `event_version` only for breaking payload changes.
4. Keep discriminated `event_type` + `event_version` pairs stable.
5. New queue messages must be additive to existing consumer contracts.
6. Maintain dual-phase contract model (ingress vs validated workflow) to avoid forcing `approved_version` before reload/reverify.

## 12. Proposed File Layout

```text
packages/
  shared-contracts/
    src/
      events/
        eventEnvelope.ts
        airtableWebhook.ts
        airtableApprovedMessages.ts
      ledger/
        webhookEventStatus.ts
        queueEventStatus.ts
        workflowRunStatus.ts
        ledgerErrorCode.ts
      validation/
        forbiddenFields.ts
      index.ts
```

Optional additions (non-breaking):
- `src/validation/schemas/*.ts` for zod runtime validators
- `src/testing/fixtures/*.ts` for test contract fixtures

## 13. Verification Checklist

- [x] File path and scope are for shared contracts (`packages/shared-contracts`) only.
- [x] Event envelope includes `event_version`.
- [x] Event envelope includes `correlation_id`.
- [x] Event envelope includes `causation_id`.
- [x] Queue/workflow contract includes `idempotency_key`.
- [x] Distinguishes ingress dedupe vs production workflow idempotency.
- [x] Does not require `approved_version` in ingress message before reload/reverify.
- [x] Includes full Ledger status enum set.
- [x] Queue status enum is neutral (`enqueue_*`) and not confused with social publish.
- [x] Includes forbidden fields list.
- [x] No raw token/content fields in contract payloads.
- [x] Includes schema evolution rules.

## 14. Open Questions / Risks

1. Confirm whether `workspace_id` should be required in ingress payload or always derived server-side.
2. Confirm exact `source` value for post-reload message (`airtable.webhook_worker` vs another canonical service name).
3. Decide whether `approved_version` can be nullable in intermediate ledger typings or represented by two separate event types only.
4. Confirm if strict-reject unknown keys is globally acceptable for all producers immediately, or requires rollout flag.
5. Align error code namespace with future US-003 workflow domains to avoid churn.
