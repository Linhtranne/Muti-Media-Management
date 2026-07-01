# SPEC-US-014: RabbitMQ Event Bus Hardening

**Status:** Approved  
**Retrofit Note:** Retrospec — US-014 designed before AI-SDLC gate; implementation in progress. Test evidence is Partial.  
**FL Reference:** FL-008 (RabbitMQ Event Bus Hardening) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 634  
**Backlog AC/BR:** US-014 AC1–AC4, BR1–BR3

---

## Goal

Standardize the RabbitMQ topology across all queues using a config-driven registry (`topologyConfig.ts`), enforce per-queue DLQ and TTL-retry patterns, add `ConfirmChannel` publish guarantees, and introduce `mediaops.events.topic` as the new canonical topic exchange — while preserving backward compatibility with all existing legacy exchanges.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-014
- **FL-008:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 634–675
- **Topology:** `apps/orchestrator/src/queue/topologyConfig.ts` (primary artifact for this US)
- **Publisher:** `apps/orchestrator/src/queue/rabbitmqPublisher.ts`
- **Base Consumer:** `apps/orchestrator/src/queue/rabbitmqConsumer.ts`
- **Tests:** `apps/orchestrator/src/queue/__tests__/topologyConfig.test.ts`, `rabbitmqPublisher.test.ts`, `rabbitmqConsumer.test.ts`

---

## In Scope

- Config-driven `QUEUE_TOPOLOGY: QueueTopologyEntry[]` registry in `topologyConfig.ts`.
- `QueueTopologyEntry` interface: `{exchange, exchangeType, queue, routingKey, dlq, retryTtlMs, maxRetries, prefetch, workerBinding, ownerUs}`.
- Per-queue DLQ naming: `<queue>.dlq`.
- TTL retry queues: `<queue>.retry.<ttlMs>` — created on demand by consumer.
- Canonical exchange `mediaops.events.topic` (type: topic) — additive only, does not rename existing.
- Legacy exchanges preserved: `airtable.webhooks`, `ai.workflows`, `publish.workflows`, `comments.workflows`, `slack.workflows`, `alerts`.
- `ConfirmChannel` on publisher to guarantee publish confirms before ACKing source.
- Idempotency guard in base consumer: check before executing worker logic.
- ACK policy: ACK original message ONLY after Ledger commit AND after DLQ publish confirms.

## Out of Scope

- Business logic changes to any worker — this US only changes infra/topology code.
- Adding new queues beyond what is registered in `topologyConfig.ts`.
- Renaming existing queues or exchanges — backward compatibility is mandatory.

---

## Functional Contract

1. **Producer side:** Call `rabbitmqPublisher.publish()` using `ConfirmChannel`. Validate payload schema (Zod) before publish — reject if token-like fields detected. Log `QUEUE_EVENT_PUBLISHED`.

2. **Broker routing:**
   - New events (US-015): use `mediaops.events.topic` canonical exchange.
   - Existing events (US-002 through US-014): use legacy exchanges (`airtable.webhooks`, `ai.workflows`, etc.) — no renaming.

3. **Consumer startup (self-declare topology):** On startup, consumer reads `QUEUE_TOPOLOGY` registry. For its assigned queue, self-declares: exchange, queue, DLQ, TTL retry queues. Binds via routing key. Sets prefetch from config.

4. **Idempotency guard (consumer):** Before executing any worker: check idempotency key against Ledger. If already processed → ACK no-op.

5. **Retry (per-queue TTL):** On transient failure: NACK original → publish to `<queue>.retry.<ttlMs>`. After TTL expires, message returns to main queue. After `maxRetries` exceeded → DLQ via ConfirmChannel.

6. **ACK discipline:** ACK original message ONLY after: (a) Ledger commit succeeds AND (b) any DLQ/retry publish confirmed by broker.

---

## Data / Queue / API Contract

### Queue Topology Registry (Key Entries)
| Queue | Exchange | DLQ | RetryTTL | Owner |
|:---|:---|:---|:---|:---|
| `airtable.webhook.approved` | `airtable.webhooks` | `airtable.webhook.approved.dlq` | [1s,2s,4s,8s,16s] | US-002 |
| `ai.compose.facebook.requested` | `ai.workflows` | `.dlq` | [2s,4s,8s,16s,32s] | US-003 |
| `policy.evaluate.requested` | `publish.workflows` | `.dlq` | [1s,2s,4s,8s,16s] | US-004 |
| `publish.facebook.requested` | `publish.workflows` | `.dlq` | [1s,2s,4s,8s,16s] | US-005 |
| `publish.facebook.validated` | `publish.workflows` | `.dlq` | [1s,2s,4s,8s,16s] | US-005 |
| `publish.facebook.execute` | `publish.workflows` | `.dlq` | [2s,4s,8s,16s,32s] | US-006 |
| `slack.post_approval.requested` | `slack.workflows` | `.dlq` | [1s,2s,4s,8s,16s] | US-008 |
| `slack.comment_action.requested` | `slack.workflows` | `.dlq` | [1s,2s,4s,8s,16s] | US-009 |
| `dm.facebook.ingest` | `mediaops.events.topic` | `.dlq` | [1s,2s,4s,8s] | US-015 |
| `dm.reply.requested` | `mediaops.events.topic` | `.dlq` | [1s,2s,4s,8s] | US-015 |
| `alerts.slack.send` | `alerts` | `.dlq` | [1s,2s,4s] | Shared |

### Canonical Exchange
- **Name:** `mediaops.events.topic`
- **Type:** topic
- **Use:** US-015+ new events only; existing consumers use legacy exchanges

### Payload Envelope (all queues)
```typescript
{
  event_id: string;       // UUID
  event_type: string;     // e.g. "slack.post_approval.requested"
  workspace_id: string;
  idempotency_key: string;
  correlation_id: string;
  causation_id?: string;
  created_at: string;     // ISO 8601
  reference_id?: string;  // reference fields only (no tokens, no raw content)
}
```
- **content_type:** `application/json`
- **delivery_mode:** 2 (persistent)

---

## Security & Safety Rules

- **Zero token in any queue payload:** producer-side Zod schema must reject token-like fields.
- **Idempotency mandatory:** every consumer enforces idempotency check before worker execution.
- **ConfirmChannel required for DLQ publish:** broker must confirm DLQ write before ACK of original.
- **No queue renaming:** `RULES` comment in `topologyConfig.ts` is binding — backward compat required.
- **Canonical exchange additive only:** legacy consumers must not be migrated without explicit US approval.

---

## Error Cases

| Case | Action | ACK Policy |
|:---|:---|:---|
| Transient worker failure | NACK → TTL retry queue → main queue (max `maxRetries`) | No ACK until resolved |
| Exhausted retries | Publish to `<queue>.dlq` via ConfirmChannel | ACK original after DLQ confirm |
| Schema validation fail | Reject → DLQ directly | ACK original after DLQ confirm |
| Idempotency duplicate | ACK no-op | ACK |
| Ledger commit fail | NACK → retry | No ACK |

---

## Acceptance Criteria

**AC1 — Config-driven topology is the single source of queue configuration (Backlog AC1)**
- *Given* the `QUEUE_TOPOLOGY` array in `topologyConfig.ts`
- *When* a consumer starts
- *Then* it self-declares its exchange, queue, DLQ, and TTL retry queues from the registry without hardcoding queue names.
- *Trace evidence:* Test case `"should parse all configured queues in topology"` in [topologyConfig.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/topologyConfig.test.ts) and [REPORT-us-014-implementation-2026-06-03.md](file:///d:/Muti-Media%20Management/docs/reports/US-014/REPORT-us-014-implementation-2026-06-03.md).

**AC2 — Per-queue DLQ exists for every registered queue (Backlog AC2)**
- *Given* all entries in `QUEUE_TOPOLOGY`
- *When* `getAllDlqNames()` is called
- *Then* every main queue has a corresponding `<queue>.dlq` entry.
- *Trace evidence:* Test case `"should have a corresponding DLQ for every main queue"` in [topologyConfig.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/topologyConfig.test.ts).

**AC3 — ACK only after Ledger commit and DLQ confirm (Backlog AC3)**
- *Given* a worker that fails permanently after `maxRetries`
- *When* the consumer routes to DLQ
- *Then* the DLQ publish is confirmed via `ConfirmChannel` before the original message is ACKed.
- *Trace evidence:* Test case `"should confirm DLQ publish before ACKing original"` in [rabbitmqConsumer.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/rabbitmqConsumer.test.ts).

**AC4 — Canonical exchange does not break existing consumers (Backlog AC4)**
- *Given* all existing legacy exchanges in `QUEUE_TOPOLOGY` entries for US-002 through US-009
- *When* the topology is declared at startup
- *Then* all legacy queues are reachable with their existing routing keys, and no existing consumer throws a topology mismatch error.
- *Trace evidence:* Test case `"should bind legacy exchanges correctly without overlaps"` in [topologyConfig.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/topologyConfig.test.ts).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [topologyConfig.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/topologyConfig.test.ts) | `apps/orchestrator/src/queue/__tests__/topologyConfig.test.ts` | DLQ matching, retry queue configuration array validation, legacy routing keys mapping integrity |
| [rabbitmqPublisher.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/rabbitmqPublisher.test.ts) | `apps/orchestrator/src/queue/__tests__/rabbitmqPublisher.test.ts` | ConfirmChannel publish guarantees, token-like field validation checking before enqueue |
| [rabbitmqConsumer.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/queue/__tests__/rabbitmqConsumer.test.ts) | `apps/orchestrator/src/queue/__tests__/rabbitmqConsumer.test.ts` | Retry exponential TTL routing, DLQ publish confirms, base consumer idempotency guard execution |

### Verification Evidence Reports

TDD cycles and verification logs:
- [REPORT-us-014-implementation-2026-06-03.md](file:///d:/Muti-Media%20Management/docs/reports/US-014/REPORT-us-014-implementation-2026-06-03.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original RED stage execution outputs not captured. However, regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/queue/__tests__/topologyConfig.test.ts`

---

## Open Questions

- OQ-014-1: Is the `ConfirmChannel` publish confirm implemented? *Resolved:* Yes, `rabbitmqPublisher.ts` uses `ConfirmChannel` and awaits `waitForConfirms()` on publish to guarantee delivery.
- OQ-014-2: Do consumers self-declare topology at startup? *Resolved:* Yes, the base consumer initializes and self-declares its topology setup (including retry/DLQ) during channel startup.
