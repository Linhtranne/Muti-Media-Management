# PLAN: US-002 Airtable Approved Webhook Workflow

## Overview

US-002 implements the first backend event entrypoint for MediaOps: when an Airtable `Posts` record becomes `Approved`, the middleware receives the webhook, records the event in the Operational Ledger, deduplicates it, reloads the current Airtable record, and starts the downstream workflow stub without publishing directly.

This story converts the US-001 handoff contract into a production-ready foundation for webhook ingestion, RabbitMQ routing, worker processing, and Postgres/InsForge ledger persistence. It does **not** implement real AI generation, Facebook MCP publishing, Slack commands, or final publish execution.

## Docs Read

| Priority | Document | Constraints Extracted |
|:---|:---|:---|
| P0 | `docs/architecture/06_Architecture_Composability.md` | Airtable is Control Plane; middleware owns webhook/reload/idempotency; RabbitMQ is async queue; Postgres is durable Ledger. |
| P0 | `docs/architecture/11_Coding_Convention.md` | TypeScript services; no raw tokens; references-only RabbitMQ payloads; every external event needs idempotency; workers ack only after Ledger update. |
| P1 | `docs/requirements/04_Product_Backlog.md` | US-002 AC/BR: record Approved event, prevent duplicates, ignore unrelated events with logs, failed events have clear status/message, no direct publish from webhook. |
| P1 | `docs/requirements/05_Function_Flow_Logic_Register.md` | FL-001 is the primary logic source for reload/reverify, ACK/NACK, idempotency, and error classification. |
| P2 | `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md` | D-003 Postgres Ledger, D-006 RabbitMQ deployment path, D-007 two-phase webhook receiver path, R-002 duplicate/missing webhook, R-005 token leakage. |
| P2 | `docs/requirements/03_SRS_MediaOps_Composability.md` | Webhook, queue, ledger, audit, idempotency, retry, and fail-closed security are MVP requirements. |
| P1 | `docs/requirements/13_Sprint_1_Backlog.md` | US-002 belongs to Sprint 1 event foundation; AI Composer and publish are out of scope. |
| P0 | `docs/plans/US-001/US-001-final-implementation-notes.md` | US-001 final Airtable schema, views, guardrails, and handoff boundary. |
| P0 | `docs/plans/US-001/US-001-middleware-handoff-contract.md` | Minimal event payload, references-only queue message, reload strategy, status/error taxonomy. |

## Skills and Specialist Knowledge Applied

| Skill / Agent Knowledge | Source | Applied Rules |
|:---|:---|:---|
| Project Planner | `.agent/agents/project-planner.md` | Plan-first workflow, verifiable tasks, explicit dependencies, rollback awareness. |
| Event Architect | `C:\Users\Hi\.spawner\skills\backend\event-architect\skill.yaml` + `sharp-edges.yaml` | Immutable event envelope, schema versioning, idempotent projections, correlation/causation IDs, at-least-once delivery. |
| Queue Workers | `C:\Users\Hi\.spawner\skills\backend\queue-workers\skill.yaml` + `sharp-edges.yaml` | Idempotency key, bounded retries, DLQ, graceful shutdown, timeouts, correlation IDs, no fire-and-forget. |
| API Design | `C:\Users\Hi\.spawner\skills\backend\api-design\skill.yaml` + `sharp-edges.yaml` | Stable `/api/v1` contract, consistent errors, idempotency, no leaking internals. |
| Postgres Wizard | `C:\Users\Hi\.spawner\skills\data\postgres-wizard\skill.yaml` + `sharp-edges.yaml` | Unique constraints for idempotency, indexes for hot paths, short transactions, connection pooling awareness. |

## Project Type

Backend / Event Foundation.

Primary implementation areas:

- TypeScript webhook receiver in `apps/orchestrator`.
- RabbitMQ topology and worker in `apps/workers`.
- Shared event contracts in `packages/shared-contracts`.
- Operational Ledger schema/migrations for webhook events, queue events, workflow runs, and audit logs.

## Scope

### In Scope

- Airtable webhook receiver endpoint for `airtable.post.approved`.
- Webhook payload normalization and source/config verification.
- Ledger persistence for received, ignored, duplicate, processing, failed, and workflow-started events.
- Production idempotency using server-side `record_id + approved_version`.
- Temporary compatibility with US-001 `record_id + approved_at` as an input hint only.
- RabbitMQ publish to `airtable.webhook.approved` with references-only payload.
- Worker reload of Airtable `Posts` record using `record_id`.
- Zero-trust revalidation of status, `is_valid_for_approval`, `approved_at`, target channels, and connected account stubs.
- Error classification using the US-001/T-006 taxonomy.
- Downstream workflow stub creation for AI Composer handoff, without AI execution.
- Unit/integration tests for webhook, idempotency, queue payload, and worker ACK/NACK behavior.

### Out of Scope

- Real AI Composer generation.
- Facebook MCP `validate_post`, `enqueue_publish`, or `publish_post` calls.
- Real Facebook Graph API publishing.
- Slack alerts or slash commands.
- Admin OAuth/token setup for Facebook Page.
- Direct message or comment ingestion.
- Adding `approved_version` to Airtable.
- Storing raw `master_copy`, `asset_links`, or tokens in RabbitMQ messages.

## Success Criteria

| Backlog AC / BR | US-002 Success Criteria |
|:---|:---|
| AC1 | Approved event is persisted in Operational Ledger with event status, timestamps, correlation ID, and sanitized metadata. |
| AC2 | Duplicate events do not create duplicate workflow runs or duplicate queue messages. |
| AC3 | Unrelated or stale events are ignored safely but still logged in Ledger. |
| AC4 | Processing failures are marked `failed` or `retryable_failed` with clear sanitized error message. |
| BR1 | Middleware only proceeds when reloaded Airtable status is exactly `Approved`. |
| BR2 | Each `record_id + approved_version` creates at most one workflow. |
| BR3 | Webhook receiver never publishes directly; it only records, queues, and starts a downstream workflow stub. |

## Key Design Decisions

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Use `record_id + approved_version` as production idempotency key | Server-side versioning is durable and cannot be tampered with from Airtable. | `record_id + approved_at`; kept only as transitional hint from US-001. |
| Treat webhook as signal, not command | Prevents stale/race-condition side effects. | Trust webhook payload directly; rejected as unsafe. |
| Persist Ledger state before queue ACK | Prevents invisible loss of consumed messages. | ACK first then write DB; rejected due to data loss risk. |
| RabbitMQ message carries references only | Keeps queue small and prevents content/token leakage. | Put full Airtable snapshot in message; rejected by architecture/coding rules. |
| Separate receiver and worker responsibilities | Receiver stays fast; worker owns reload/reverify and business classification. | Synchronous full processing in webhook request; rejected due to timeout/rate-limit risk. |

## Target Architecture

```text
Airtable Approved webhook
  -> apps/orchestrator POST /api/v1/webhooks/airtable
  -> normalize + verify source/config
  -> write webhook_event in Postgres Ledger
  -> publish references-only RabbitMQ message
  -> apps/workers approved-post worker
  -> reload Airtable Posts record
  -> reverify state and channel account stubs
  -> update Ledger status
  -> create workflow_run stub for US-003
  -> ACK only after Ledger transaction commits
```

## Proposed File Structure

```text
apps/
  orchestrator/
    src/
      routes/
        airtableWebhook.ts
      services/
        airtableWebhookIngestor.ts
        airtableEventNormalizer.ts
        ledgerWebhookEventRepository.ts
        queuePublisher.ts
      config/
        env.ts
      __tests__/
        airtableWebhook.test.ts
        airtableWebhookIdempotency.test.ts
  workers/
    src/
      approved-post/
        approvedPostWorker.ts
        approvedPostProcessor.ts
        airtablePostReloader.ts
        approvalRevalidator.ts
        channelAccountResolver.ts
      queue/
        rabbitmqConnection.ts
        retryPolicy.ts
      __tests__/
        approvedPostWorker.test.ts
        approvedPostRevalidation.test.ts
packages/
  shared-contracts/
    src/
      events/
        airtablePostApproved.ts
      ledger/
        webhookEventStatus.ts
        workflowRunStatus.ts
  policy-engine/
    src/
      approvalEligibility.ts
db/
  migrations/
    0001_us002_webhook_ledger.sql
docs/
  plans/
    US-002/
      PLAN-us-002-airtable-approved-webhook.md
  reports/
    US-002/
```

## Ledger Schema v1 Requirements

### `webhook_events`

Required fields:

- `id`
- `event_id`
- `source`
- `event_type`
- `event_version`
- `workspace_id`
- `airtable_record_id`
- `airtable_table_name`
- `approval_ref`
- `approved_version`
- `idempotency_key`
- `correlation_id`
- `causation_id`
- `status`
- `error_code`
- `error_message`
- `received_at`
- `processed_at`
- `metadata`

Required constraints:

- Unique `event_id`.
- Unique `idempotency_key` for processable approved workflow attempts.
- Index on `airtable_record_id`.
- Index on `status`.
- Index on `received_at`.

### `queue_events`

Required fields:

- `id`
- `webhook_event_id`
- `queue_name`
- `routing_key`
- `message_id`
- `idempotency_key`
- `status`
- `attempt_count`
- `last_attempt_at`
- `last_error`
- `created_at`
- `updated_at`

### `workflow_runs`

US-002 only creates a stub row.

Required fields:

- `id`
- `workspace_id`
- `airtable_record_id`
- `approved_version`
- `idempotency_key`
- `status = pending_ai_generation`
- `created_from_webhook_event_id`
- `created_at`

### `audit_logs`

Required fields:

- `id`
- `workspace_id`
- `actor_type = system`
- `actor_id`
- `action`
- `entity_type`
- `entity_id`
- `metadata`
- `created_at`

## Event Contracts

### Incoming Webhook Signal

```json
{
  "event_id": "evt_...",
  "record_id": "rec...",
  "table_name": "Posts",
  "change_type": "update",
  "approved_at": "2026-05-20T07:45:00.000Z"
}
```

Receiver must reject or ignore any raw content fields such as `master_copy`, `asset_links`, or token-like fields.

### RabbitMQ Message

```json
{
  "event_id": "evt_...",
  "event_type": "airtable.post.approved.ingress",
  "event_version": 1,
  "source": "airtable.webhook_receiver",
  "workspace_id": "workspace_...",
  "record_ref": "rec...",
  "approval_ref": "2026-05-20T07:45:00.000Z",
  "idempotency_key": "airtable.webhook.ingress:evt_...",
  "correlation_id": "corr_...",
  "causation_id": "evt_..."
}
```

This is the ingress message before worker reload/reverify. It must not include `approved_version`; production workflow idempotency is assigned later after a fresh valid Approved reload.

Forbidden in queue payload:

- `approved_version` in the ingress message
- `master_copy`
- `cta_url`
- `asset_links`
- `access_token`
- `secret_ref`
- full Airtable snapshots

## Error and State Taxonomy

| Case | Ledger Status | Queue Action | Retry |
|:---|:---|:---|:---|
| Valid approved event accepted | `queued` then `processing` then `workflow_stub_created` | ACK after Ledger update | No |
| Duplicate event | `duplicate_ignored` | ACK | No |
| Reloaded status `Scheduled` or `Published` | `already_advanced_ignored` | ACK | No |
| Reloaded status `Draft`, `Review`, or `Failed` | `state_changed_ignored` | ACK | No |
| Unknown status | `unknown_status_ignored` | ACK | No |
| `is_valid_for_approval != 1` | `invalid_after_reload_ignored` | ACK | No |
| `approved_at` mismatch | `approval_version_mismatch_ignored` | ACK | No |
| Missing Facebook account stub | `channel_account_missing` | ACK | No |
| Inactive/expired account stub | `channel_account_inactive` | ACK | No |
| Stub cannot map to server-side channel account | `channel_account_unresolved` | NACK `requeue=false` to DLQ if configured; otherwise ACK + Ledger exception | No |
| Airtable 429/503 or network timeout | `retryable_failed` | NACK/retry with exponential backoff | Yes |
| Unexpected internal error | `failed` | NACK/retry until max attempts, then DLQ | Bounded |

## Task Breakdown

### T-001: US-002 Scope Lock and Contract Baseline

- Agent: Project Manager
- Skills: project-planner, event-architect
- Priority: P0
- Dependencies: none
- Input: US-002 backlog, FL-001, US-001 final notes, US-001 middleware handoff contract
- Output: US-002 scope lock document with in-scope/out-of-scope, final AC mapping, and glossary
- Verify: scope explicitly excludes AI Composer, Facebook MCP publish, Slack, and adding `approved_version` to Airtable
- Rollback: keep scope document as draft and block implementation prompts until approved

### T-002: Ledger Schema and Idempotency Design

- Agent: Database Architect
- Skills: postgres-wizard, event-architect
- Priority: P0
- Dependencies: T-001
- Input: US-002 AC/BR, FL-001, coding convention
- Output: schema design for `webhook_events`, `queue_events`, `workflow_runs`, `audit_logs`; unique keys and indexes
- Verify: unique constraints cover `event_id` and `record_id + approved_version`; no raw token/content fields; transactions define "write Ledger before ACK"
- Rollback: migration can be reverted before data exists; after data exists, use additive migration

### T-003: Shared Event and Ledger Contracts

- Agent: Backend Specialist
- Skills: api-design, event-architect
- Priority: P0
- Dependencies: T-002
- Input: event schema, Ledger statuses, queue payload rules
- Output: TypeScript shared contracts for incoming webhook, queue message, event envelope, status enum, error codes
- Verify: contracts include `event_version`, `correlation_id`, `causation_id`, `idempotency_key`; queue contract rejects content/token fields
- Rollback: version new contracts additively; do not break event version 1 consumers

### T-004: Webhook Receiver API Design

- Agent: Backend Specialist
- Skills: api-design, security-auditor
- Priority: P0
- Dependencies: T-003
- Input: shared contracts, US-002 source verification requirements
- Output: `POST /api/v1/webhooks/airtable` design with request validation, sanitized errors, source/config verification, correlation ID behavior
- Verify: unrelated events are logged and ignored; invalid payload gets consistent 4xx; internal errors return sanitized 5xx; no stack traces or secrets
- Rollback: endpoint remains disabled behind env flag until verified

### T-005: RabbitMQ Topology for Approved Post Event

- Agent: Backend Specialist
- Skills: queue-workers, event-architect
- Priority: P0
- Dependencies: T-003
- Input: queue naming from architecture and FL-001
- Output: exchange, queue, routing key, retry, DLQ, max attempts, timeout, and graceful shutdown policy for `airtable.webhook.approved`
- Verify: message is references-only; DLQ path exists for permanent operational failures; retry is bounded; correlation ID preserved
- Rollback: topology can be recreated in dev/staging; use separate env-specific virtual host if available

### T-006: Webhook Ingestion Flow

- Agent: Backend Specialist
- Skills: api-design, postgres-wizard, queue-workers
- Priority: P1
- Dependencies: T-002, T-003, T-004, T-005
- Input: receiver API design, Ledger repo, queue publisher
- Output: receiver flow design: normalize event, persist Ledger `received`, perform ingress dedupe by `event_id`, publish references-only ingress queue message, mark `queued`; do not allocate/increment `approved_version` in receiver
- Verify: duplicate event returns success without duplicate queue publish; Ledger transaction is atomic; failures are marked `failed` or `retryable_failed`
- Rollback: disable queue publishing feature flag while keeping event logging active

### T-007: Approved Post Worker Reload and Reverify

- Agent: Backend Specialist
- Skills: queue-workers, event-architect
- Priority: P1
- Dependencies: T-006
- Input: queue message, Airtable API config, US-001 final field definitions
- Output: worker processing design for Airtable reload, status check, approval validity check, approval ref check, channel account stub revalidation
- Verify: all taxonomy cases map to exact Ledger statuses and ACK/NACK behavior; Airtable 429/503 is retryable; business-invalid cases ACK after Ledger update
- Rollback: worker can be paused while receiver continues recording events

### T-008: Channel Account Resolution Boundary

- Agent: Database Architect / Security Auditor
- Skills: postgres-wizard, security-auditor
- Priority: P1
- Dependencies: T-002, T-007
- Input: Airtable `connected_channel_accounts` stubs, future US-011 credential boundary
- Output: safe resolver contract that maps Airtable display stub/record ref to server-side `channel_account` metadata without loading raw tokens
- Verify: unresolved/missing/inactive states produce `channel_account_missing`, `channel_account_inactive`, or `channel_account_unresolved`; no token lookup occurs in US-002 unless safe metadata is required
- Rollback: resolver can be stubbed with deterministic test fixtures until US-011 is implemented

### T-009: Workflow Stub Creation

- Agent: Backend Specialist
- Skills: event-architect, postgres-wizard
- Priority: P1
- Dependencies: T-007, T-008
- Input: verified approved event and idempotency key
- Output: `workflow_runs` stub with status `pending_ai_generation`, linked to webhook event and Airtable record
- Verify: duplicate approved version reuses existing workflow stub; no AI call is made; no publish job is created
- Rollback: delete only test workflow stubs in non-production; production uses compensating audit entry

### T-010: Test Plan and Fixtures

- Agent: QA Engineer
- Skills: test-engineering, queue-workers
- Priority: P1
- Dependencies: T-003 through T-009
- Input: contracts, taxonomy, sample Airtable records
- Output: test fixtures and scenarios for valid, duplicate, unrelated, stale, missing account, inactive account, unresolved account, Airtable retryable failure
- Verify: every US-002 AC/BR has at least one test; queue payload snapshots prove references-only; ACK/NACK cases are tested
- Rollback: test fixtures are isolated from production env variables

### T-011: Security and Privacy Review

- Agent: Security Auditor
- Skills: security-auditor, api-design
- Priority: P1
- Dependencies: T-004, T-006, T-007, T-008
- Input: API design, logging design, Ledger metadata, queue payloads
- Output: security review notes and remediation checklist
- Verify: no raw tokens, Slack signatures, Airtable API keys, `master_copy`, or asset bodies appear in logs/queue/audit metadata
- Rollback: block implementation until high/critical issues are resolved

### T-012: Documentation and FL-001 Update

- Agent: Technical Writer / Project Manager
- Skills: documentation, project-planner
- Priority: P2
- Dependencies: T-001 through T-011
- Input: final US-002 design outputs
- Output: updated FL-001, US-002 implementation notes, and report file
- Verify: Function Flow Logic Register matches final contracts, statuses, ACK/NACK policy, and test evidence
- Rollback: keep previous FL-001 change history; append corrections instead of deleting history

## Dependency Graph

```text
T-001
  -> T-002
    -> T-003
      -> T-004
      -> T-005
        -> T-006
          -> T-007
            -> T-008
              -> T-009
                -> T-010
                  -> T-011
                    -> T-012
```

Parallelizable after T-003:

- T-004 Webhook Receiver API Design
- T-005 RabbitMQ Topology

Parallelizable after T-007:

- T-008 Channel Account Resolution Boundary
- T-010 initial QA fixture drafting
- T-011 preliminary security review

## RACI

| Workstream | Responsible | Accountable | Consulted | Informed |
|:---|:---|:---|:---|:---|
| Scope and acceptance | Project Manager | Product Owner | Tech Lead, SMM | Team |
| Ledger schema | Database Architect | Tech Lead | Security Auditor, Backend | PM |
| Webhook receiver | Backend Specialist | Tech Lead | API Designer, Security Auditor | PM |
| RabbitMQ topology | Backend Specialist | Tech Lead | DevOps, Database Architect | PM |
| Worker reload/reverify | Backend Specialist | Tech Lead | Security Auditor, QA | PM |
| Channel account boundary | Security Auditor / Database Architect | Tech Lead | Admin/IT | PM |
| QA evidence | QA Engineer | Project Manager | Backend, Database | Team |
| Documentation | Technical Writer / PM | Project Manager | All owners | Team |

## Environment Variables

Required examples only; no real secrets in docs or commits:

```text
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_WEBHOOK_SECRET=
DATABASE_URL=
RABBITMQ_URL=
WEBHOOK_RECEIVER_PUBLIC_URL=
NODE_ENV=
LOG_LEVEL=
```

## Risks and Mitigations

| Risk | Severity | Mitigation |
|:---|:---|:---|
| Airtable sends duplicate or delayed webhooks | Medium | Server-side `record_id + approved_version` idempotency and zero-trust reload. |
| Receiver times out while doing too much work | Medium | Receiver only normalizes, logs, dedupes, and queues; worker does reload/reverify. |
| Queue message leaks content or credentials | Critical | Shared contract forbids raw content/token fields; tests assert references-only payload. |
| Worker ACKs before Ledger update | High | Transactional processing rule: update Ledger first, ACK after commit. |
| Airtable rate limits during reload | Medium | Retry with exponential backoff and bounded attempts. |
| Channel account stub cannot map to server metadata | High | Fail closed with `channel_account_unresolved`, DLQ if configured, admin-visible Ledger exception. |
| Postgres idempotency race under concurrent workers | High | Unique constraints and transaction-level conflict handling. |

## Phase X: Verification Checklist

- [ ] Plan approved before implementation begins.
- [ ] Ledger schema migration reviewed for idempotency constraints and indexes.
- [ ] Shared contracts compile and reject forbidden queue fields.
- [ ] Webhook receiver integration test records valid event in Ledger.
- [ ] Duplicate webhook test proves no duplicate workflow or queue message.
- [ ] Unrelated event test proves ignored-with-log behavior.
- [ ] Worker reload test handles `Approved`, `Scheduled`, `Published`, `Draft`, `Review`, `Failed`, and unknown statuses.
- [ ] Channel account tests cover missing, inactive, and unresolved stubs.
- [ ] Queue tests cover bounded retry, DLQ path, and ACK-after-Ledger-update.
- [ ] Security review confirms no raw tokens, raw post content, or asset bodies in queue/log/audit.
- [ ] `docs/requirements/05_Function_Flow_Logic_Register.md` updated with final US-002 implementation evidence.
- [ ] Report created in `docs/reports/US-002/`.

## Approval Gate Before Coding

US-002 should not move to implementation until these are explicitly accepted:

1. Production idempotency key is `record_id + approved_version`, generated in Postgres only.
2. Webhook receiver does not call AI/MCP/publish directly.
3. RabbitMQ payload is references-only.
4. Worker ACK happens only after Ledger status is written.
5. DLQ behavior is available for non-retryable operational failures, or the no-DLQ fallback is explicitly documented for the first implementation pass.
