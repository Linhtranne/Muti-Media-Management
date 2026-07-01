# US-002 Scope Lock and Contract Baseline

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

Specialist knowledge applied silently:
- `C:\Users\Hi\.spawner\skills\backend\event-architect\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\event-architect\sharp-edges.yaml`
- `C:\Users\Hi\.spawner\skills\backend\queue-workers\skill.yaml`
- `C:\Users\Hi\.spawner\skills\backend\queue-workers\sharp-edges.yaml`
- `.agent/agents/project-planner.md`

Conflict priority used: Architecture > Coding Convention > Product Backlog > Function Flow Register > Plan.

## 2. Story Objective

US-002 (Airtable Approved Webhook Workflow) locks the event-ingestion and workflow-stub foundation:
- Receive Airtable webhook signal when a `Posts` record transitions to `Approved`.
- Normalize signal, persist event to Operational Ledger, apply dedupe, and enqueue a references-only message to RabbitMQ.
- Worker reloads Airtable by `record_id`, re-verifies current state and approval validity, then creates downstream workflow stub for US-003.
- No direct publish from webhook path.

## 3. In Scope

1. Webhook receiver for `airtable.post.approved` signal.
2. Minimal signal normalization and correlation metadata.
3. Ledger write for received/ignored/duplicate/failed/retryable/workflow-stub states.
4. Production idempotency boundary using server-side `record_id + approved_version`.
5. RabbitMQ publish with references-only contract.
6. Worker reload from Airtable using `record_id` (zero-trust payload handling).
7. Revalidation logic and classification taxonomy (status, approval hint mismatch, account-stub validity).
8. Workflow stub creation only (handoff point for US-003).
9. Audit/logging with sanitized metadata (no raw secrets/token/content).

## 4. Out of Scope

US-002 explicitly excludes:
- Real AI Composer execution.
- Real Facebook MCP publishing.
- Any final social publish action.
- Slack integration/notifications/commands.
- Adding `approved_version` field into Airtable.
- Storing raw tokens/secrets in Airtable, queue payloads, logs, or audit metadata.
- Sending full Airtable snapshot or post body data through RabbitMQ.

## 5. Acceptance Criteria Mapping

| AC | Requirement | US-002 Scope Mapping |
|:---|:---|:---|
| AC1 | Approved event được ghi vào Operational Ledger | Webhook receiver writes ingestion + processing lifecycle into Ledger; every branch has explicit status. |
| AC2 | Event trùng không tạo workflow trùng | Dedupe via `idempotency_key = airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}`; duplicate path => `duplicate_ignored`, no new stub. |
| AC3 | Event không liên quan bị bỏ qua nhưng vẫn có log | Unrelated ingress events are classified as `unrelated_ignored`; non-actionable reload outcomes are classified (`already_advanced_ignored`, `state_changed_ignored`, `unknown_status_ignored`, etc.) and logged in Ledger. |
| AC4 | Lỗi xử lý webhook có trạng thái failed và message rõ | Retryable external failures => `retryable_failed`; permanent internal failures => `failed`; both must persist clear sanitized error reason. |

## 6. Business Rules Mapping

| BR | Rule | US-002 Contract Lock |
|:---|:---|:---|
| BR1 | Middleware chỉ xử lý Post `Approved` | Worker reloads Airtable and proceeds only when current status is `Approved`; other statuses are ignored with explicit classification. |
| BR2 | Mỗi `record_id + approved_version` chỉ tạo một workflow | `approved_version` is server-side ledger sequence; one idempotency key => one workflow stub max. |
| BR3 | Không publish trực tiếp từ webhook | Webhook path stops at queue + worker + workflow stub; no platform publish call in US-002. |

## 7. Contract Baseline

### 7.1 Incoming webhook signal (minimum)

```json
{
  "event_id": "evt_...",
  "record_id": "rec...",
  "table_name": "Posts",
  "change_type": "update",
  "approved_at": "2026-05-20T07:45:00.000Z"
}
```

Rules:
- Treat as signal only; do not trust as source of truth.
- `approved_at` is temporary `approval_ref` hint for mismatch detection.

### 7.2 RabbitMQ message (references-only)

```json
{
  "event_id": "evt_...",
  "event_type": "airtable.post.approved.ingress",
  "event_version": 1,
  "source": "airtable.webhook_receiver",
  "record_ref": "rec...",
  "approval_ref": "2026-05-20T07:45:00.000Z",
  "idempotency_key": "airtable.webhook.ingress:evt_...",
  "correlation_id": "corr_...",
  "causation_id": "evt_..."
}
```

Queue payload must NOT include:
- `approved_version` in the ingress message before worker reload/reverify
- `master_copy`
- `cta_url`
- `asset_links`
- `access_token`
- `secret_ref`
- full Airtable snapshot

## 8. Idempotency Boundary

1. Production idempotency key is locked to `record_id + approved_version`.
2. `approved_version` is allocated and managed server-side in Postgres/Operational Ledger.
3. `approved_version` MUST NOT be added to Airtable schema.
4. `approved_at` is a reload/reconciliation hint (`approval_ref`), not the production dedupe key.
5. Ingress dedupe uses `event_id`; production workflow idempotency uses `record_id + approved_version` only after worker reload/reverify confirms a fresh valid approval.
6. Duplicate detection outcome is `duplicate_ignored` and must not create a second workflow stub.

## 9. Event / Queue / Ledger Boundaries

- Airtable (Control Plane): status transition source and editable business workspace.
- Webhook receiver: ingest signal, normalize metadata, write ledger, dedupe gate, enqueue references-only message.
- RabbitMQ: asynchronous transport of immutable references.
- Worker: reload Airtable via `record_id`, reverify state, classify branch, and update ledger.
- Ledger (Postgres): source of truth for lifecycle state, dedupe decisions, retries, and audit trail.
- ACK rule: worker ACK only after ledger state has been persisted for the current processing branch.
- Webhook receiver does not publish to channel APIs and does not execute AI generation.

## 10. Error Taxonomy Baseline

| Scenario | Classification | Action |
|:---|:---|:---|
| Duplicate event by idempotency key | `duplicate_ignored` | ACK, no workflow stub |
| Reloaded status = `Scheduled` or `Published` | `already_advanced_ignored` | ACK, no workflow stub |
| Reloaded status = `Draft`, `Review`, `Failed` | `state_changed_ignored` | ACK, no workflow stub |
| Reloaded status unknown/invalid enum | `unknown_status_ignored` | ACK (fail-closed), no workflow stub |
| `is_valid_for_approval != 1` after reload | `invalid_after_reload_ignored` | ACK, no workflow stub |
| `approved_at` mismatch with `approval_ref` | `approval_version_mismatch_ignored` | ACK, no workflow stub |
| Missing account stub | `channel_account_missing` | ACK after Ledger update, no workflow stub |
| Account stub inactive/expired | `channel_account_inactive` | ACK after Ledger update, no workflow stub |
| Stub cannot be resolved server-side | `channel_account_unresolved` | NACK with `requeue=false` to DLQ if configured; otherwise ACK after Ledger exception, no workflow stub |
| Temporary Airtable/API/network failure | `retryable_failed` | retry policy + ledger update |
| Permanent internal failure | `failed` | terminal failure + ledger update |

## 11. Glossary

- Control Plane: Airtable workspace where humans manage campaign/post states.
- Operational Ledger: Postgres persistence for event lifecycle, idempotency, audit, and retry state.
- `record_id`: Airtable record identifier for `Posts` row.
- `approved_at` / `approval_ref`: timestamp hint from approval event used for mismatch detection.
- `approved_version`: server-side monotonic version for each approval cycle of a record.
- Idempotency Key: unique processing key `airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}`.
- References-only payload: queue message carrying only identifiers/metadata, never full content or secrets.
- Workflow stub: placeholder downstream orchestration artifact for US-003; no AI/publish side effects.

## 12. Approval Gate

Implementation for US-002 must be blocked until this scope lock is approved.

Approval checklist:
- [ ] In-scope/out-of-scope accepted by Product + Tech Lead.
- [ ] AC mapping accepted (AC1-AC4).
- [ ] BR mapping accepted (BR1-BR3).
- [ ] Contract baseline accepted (incoming + queue schema).
- [ ] Explicit exclusions accepted: no real AI Composer, no real Facebook MCP, no Slack.
- [ ] `approved_version` boundary accepted (server-side only; not in Airtable).
- [ ] Error taxonomy baseline accepted.

Rollback rule:
- If not approved, keep this document in Draft and block implementation prompts for US-002.

## 13. Open Questions / Risks

1. Account-stub failure routing: confirm whether `channel_account_unresolved` has DLQ configured in the first implementation pass or uses the documented ACK + Ledger exception fallback.
2. Retry profile: finalize max retries/backoff/jitter for `retryable_failed` aligned with Airtable rate limits.
3. Event ordering risk: multiple close-in-time approvals may race; confirm ledger transaction strategy for `approved_version` allocation.
4. Correlation standards: confirm global format for `correlation_id` and cross-service tracing fields.
5. Operational dashboard: confirm minimum observability view for ignored/error taxonomy before implementation.
