# US-002 RabbitMQ Topology for Approved Post Event

## 1. Docs Read

Read and applied in order:
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
13. `docs/plans/US-002/US-002-shared-event-and-ledger-contracts.md`
14. `docs/plans/US-002/US-002-webhook-receiver-api-design.md`

Specialist knowledge applied silently:
- `C:\Users\Hi\.spawner\skills\backend\queue-workers\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\queue-workers\sharp-edges.yaml`
- `C:\Users\Hi\.spawner\skills\backend\event-architect\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\event-architect\sharp-edges.yaml`
- `.agent/agents/backend-specialist.md`
- `.agent/agents/devops-engineer.md`

Conflict priority enforced:
Architecture > Coding Convention > Product Backlog > Function Flow Register > US-002 Scope Lock > Ledger Schema > Shared Contracts > Webhook API Design > Plan.

## 2. Design Objective

Define RabbitMQ topology v1 for US-002 Airtable Approved ingress flow:
Airtable webhook receiver -> references-only ingress message -> RabbitMQ exchange/queue -> approved-post worker -> bounded retry -> DLQ for terminal/operational failures.

This task defines topology + contract + policies only. No runtime RabbitMQ code implementation.

## 3. Topology Scope

In scope:
- Exchange, queue, routing keys for approved ingress.
- Retry strategy (bounded attempts + backoff).
- DLQ routing for terminal/operational failures.
- ACK/NACK behavior tied to Ledger durability.
- Timeout/TTL/attempt constraints.
- Worker graceful shutdown expectations.
- Observability/backpressure notes.

Out of scope:
- Airtable reload logic internals.
- `approved_version` allocation.
- AI/MCP/Slack/social publish calls.
- Business workflow implementation.

Source-of-truth rule:
- RabbitMQ = transport only.
- Ledger/Postgres = source of truth for lifecycle/idempotency/audit.

## 4. Exchange Design

### 4.1 Main Event Exchange
- Name: `mediaops.airtable.events`
- Type: `topic`
- Durable: `true`
- Auto-delete: `false`
- Purpose: ingress and retry return path for Airtable approved event flow.

### 4.2 Dead Letter Exchange (DLX)
- Name: `mediaops.airtable.dlx`
- Type: `topic`
- Durable: `true`
- Auto-delete: `false`
- Purpose: terminal and exhausted retry failures.

### 4.3 Retry Option Chosen
Chosen default for v1: TTL retry queues (no delayed-exchange plugin dependency).
- Rationale: deterministic behavior across Docker Compose dev and managed CloudAMQP without plugin assumptions.

## 5. Queue Design

### 5.1 Main Queue
- Name: `airtable.webhook.approved`
- Durable: `true`
- Exclusive: `false`
- Auto-delete: `false`
- Dead-letter exchange: `mediaops.airtable.dlx`
- Dead-letter routing key (terminal/exhausted): `airtable.post.approved.dead`

### 5.2 Retry Queues (TTL Pattern)
1) `airtable.webhook.approved.retry.1m`
- Durable: `true`
- x-message-ttl: `60000`
- x-dead-letter-exchange: `mediaops.airtable.events`
- x-dead-letter-routing-key: `airtable.post.approved.ingress`

2) `airtable.webhook.approved.retry.5m`
- Durable: `true`
- x-message-ttl: `300000`
- x-dead-letter-exchange: `mediaops.airtable.events`
- x-dead-letter-routing-key: `airtable.post.approved.ingress`

3) `airtable.webhook.approved.retry.15m`
- Durable: `true`
- x-message-ttl: `900000`
- x-dead-letter-exchange: `mediaops.airtable.events`
- x-dead-letter-routing-key: `airtable.post.approved.ingress`

4) `airtable.webhook.approved.retry.30m`
- Durable: `true`
- x-message-ttl: `1800000`
- x-dead-letter-exchange: `mediaops.airtable.events`
- x-dead-letter-routing-key: `airtable.post.approved.ingress`

5) `airtable.webhook.approved.retry.60m`
- Durable: `true`
- x-message-ttl: `3600000`
- x-dead-letter-exchange: `mediaops.airtable.events`
- x-dead-letter-routing-key: `airtable.post.approved.ingress`

### 5.3 DLQ
- Name: `airtable.webhook.approved.dlq`
- Durable: `true`
- Exclusive: `false`
- Auto-delete: `false`
- Bound to: `mediaops.airtable.dlx`

## 6. Routing Keys

Main and DLQ routing keys:
- `airtable.post.approved.ingress` -> main queue `airtable.webhook.approved`
- `airtable.post.approved.retry.1m` -> retry queue `airtable.webhook.approved.retry.1m`
- `airtable.post.approved.retry.5m` -> retry queue `airtable.webhook.approved.retry.5m`
- `airtable.post.approved.retry.15m` -> retry queue `airtable.webhook.approved.retry.15m`
- `airtable.post.approved.retry.30m` -> retry queue `airtable.webhook.approved.retry.30m`
- `airtable.post.approved.retry.60m` -> retry queue `airtable.webhook.approved.retry.60m`
- `airtable.post.approved.dead` -> DLQ `airtable.webhook.approved.dlq`

## 7. Message Contract

Ingress message contract (references-only) for queue payload:

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

Contract rules:
- `event_version = 1`.
- Immutable message after publish.
- References-only, compact payload.
- Preserve `correlation_id` and `causation_id` across retries and DLQ.
- No `approved_version` in ingress message.
- No `master_copy`, `cta_url`, `asset_links`, raw content, tokens, secrets, or full Airtable snapshot.

## 8. Retry Policy

Bounded retry policy:
- max retry transitions: 5
- max processing opportunities: 6 total (1 initial attempt + 5 retry attempts)
- processing attempt 1 failure -> `retry.1m`
- processing attempt 2 failure -> `retry.5m`
- processing attempt 3 failure -> `retry.15m`
- processing attempt 4 failure -> `retry.30m`
- processing attempt 5 failure -> `retry.60m`
- processing attempt 6 failure -> DLQ (`airtable.post.approved.dead`)

Retry eligibility (transient only):
- Airtable 429
- Airtable 503
- Network timeout / transient DNS/connectivity
- Temporary DB lock/timeout
- Temporary RabbitMQ publish/consume channel issues

Non-retry business-invalid states (ACK after Ledger update):
- `already_advanced_ignored`
- `state_changed_ignored`
- `unknown_status_ignored`
- `invalid_after_reload_ignored`
- `approval_version_mismatch_ignored`
- `channel_account_missing`
- `channel_account_inactive`

Terminal operational handling:
- `channel_account_unresolved` -> write Ledger terminal status, then NACK `requeue=false` to DLQ if DLQ active.
- If DLQ temporarily not active: ACK + Ledger exception fallback path per US-001/US-002 governance.

Attempt metadata:
- Track attempt count in RabbitMQ header `x-retry-attempt` (or equivalent consumer-managed header) and mirror into Ledger event metadata.

## 9. DLQ Policy

DLQ routing triggers:
1. Retry exhausted (attempt > 5).
2. Terminal operational failure (`channel_account_unresolved`).
3. Consumer marks unrecoverable processing fault.

DLQ handling expectations:
- Message retained for operator triage/replay tooling.
- Must preserve original payload + correlation metadata.
- Replay must respect idempotency via `event_id` and `idempotency_key` checks against Ledger.

## 10. ACK / NACK Policy

Hard rule:
- ACK only after Ledger state update commits successfully.

Policy matrix:
1. Success path:
   - Persist lifecycle state transition in Ledger.
   - ACK.

2. Duplicate ingress:
   - Write/confirm `duplicate_ignored` in Ledger.
   - ACK.

3. Business-invalid/ignored:
   - Write corresponding ignored status in Ledger.
   - ACK.

4. Retryable infra/API failure:
   - Write `retryable_failed` with attempt metadata in Ledger.
   - Route to retry queue (preferred publish + ACK original) OR NACK with controlled requeue strategy that lands in retry path.

5. Terminal operational failure:
   - Write terminal status in Ledger.
   - NACK `requeue=false` to DLQ (or ACK + fallback when DLQ unavailable by policy exception).

Never ACK before durable Ledger persistence.

## 11. Timeout and TTL Policy

Consumer timeout policy:
- Per-message processing timeout target: 30s soft budget.
- Hard operation timeout for external calls: 10s connect + 20s response (configurable).

Queue TTL policy:
- Retry queue TTLs fixed by stage: 1m, 5m, 15m, 30m, 60m.
- Main queue message TTL: unset by default in v1 (avoid premature expiry); rely on monitoring/alerts for stuck backlog.
- DLQ retention: environment-configured policy (recommended >= 7 days for forensics in non-prod/prod depending storage budget).

Attempt ceiling:
- Max retry transitions: 5.
- Max processing opportunities: 6 total, including the first attempt.

## 12. Worker Concurrency and Graceful Shutdown

Concurrency guidance (v1 baseline):
- Start with worker concurrency 5-10 messages/consumer process (tune by DB load and Airtable API limits).
- Set prefetch to match or slightly below concurrency to control in-flight work.

Graceful shutdown expectations:
1. Stop consuming new messages.
2. Continue processing in-flight messages until timeout window.
3. For unfinished work, persist `retryable_failed` (if applicable) before process exit.
4. ACK/NACK each in-flight message deterministically (no silent drops).
5. Close channels/connections cleanly.

## 13. Observability and Backpressure

Required metrics:
- Main queue depth (`airtable.webhook.approved`)
- Retry queue depths by stage
- DLQ message count
- Retry rate and retry-attempt distribution
- End-to-end processing latency (ingress publish -> final ledger terminal/success)
- Oldest message age in main and retry queues
- Worker heartbeat and consumer count
- ACK/NACK counts by reason

Logging/tracing:
- Structured logs include: `event_id`, `idempotency_key`, `correlation_id`, `causation_id`, `attempt`, `queue`, `status`.
- Correlation ID must be present in every retry and DLQ-related log line.

Backpressure/alert suggestions:
- Alert when main queue depth > threshold for >5m.
- Alert when oldest message age exceeds SLA threshold.
- Alert on DLQ non-zero sustained growth.
- Alert on retry ratio spike (transient dependency incident signal).

## 14. Security and Payload Privacy

Security constraints:
- Queue payload must remain references-only.
- No raw post content or media links in message.
- No credentials/secrets/tokens in message or queue headers.
- Enforce payload schema validation pre-publish and pre-consume.
- Redact sensitive fields in logs.

Explicitly forbidden in message payload:
- `master_copy`
- `cta_url`
- `asset_links`
- `access_token`
- `refresh_token`
- `secret_ref`
- `app_secret`
- full Airtable snapshot blobs

## 15. Environment Deployment Notes

Environment topology policy:
- Dev/staging: RabbitMQ via Docker Compose is acceptable.
- Production: managed CloudAMQP (per decision log direction).
- Use environment-specific vhost and/or deterministic prefix (e.g., `dev.`, `stg.`, `prod.`) to isolate traffic.
- Topology declarations must be idempotent at startup.
- Secrets handled via secret manager/env vars only; no real secrets in docs.

Rollback notes:
- Topology can be dropped/recreated safely in dev/staging.
- For production rollback, drain/pause consumers, preserve DLQ, then switch producer binding by config flag.

## 16. Verification Checklist

- [x] Exchange design defined (main + DLX).
- [x] Queue design defined (main + retry + DLQ).
- [x] Routing keys defined.
- [x] Ingress message contract included.
- [x] Message is references-only.
- [x] No `approved_version` in ingress message.
- [x] No raw token/content/asset fields in payload contract.
- [x] Bounded retry policy defined (5 retry transitions + staged backoff).
- [x] DLQ path exists for terminal/operational failures.
- [x] ACK-after-Ledger-update rule explicitly defined.
- [x] Timeout/TTL policy defined.
- [x] Graceful shutdown expectation defined.
- [x] Observability/backpressure notes included.
- [x] Environment deployment notes included.

## 17. Open Questions / Risks

1. Confirm whether CloudAMQP plan in production enables any plugin options; current design intentionally avoids delayed-exchange plugin dependency.
2. Finalize exact consumer timeout and prefetch defaults after load testing.
3. Define authoritative DLQ replay SOP and operator ownership model.
4. Confirm whether `x-retry-attempt` header naming is already standardized in shared contracts.
5. Validate alert thresholds against expected volume baseline after first staging soak.
