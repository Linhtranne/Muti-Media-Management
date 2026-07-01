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

# Final Implementation Notes for US-002

## 1. Docs Read
- `docs/architecture/06_Architecture_Composability.md`
- `docs/architecture/11_Coding_Convention.md`
- `docs/requirements/04_Product_Backlog.md`
- `docs/requirements/05_Function_Flow_Logic_Register.md`
- `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md`
- `docs/requirements/03_SRS_MediaOps_Composability.md`
- `docs/requirements/13_Sprint_1_Backlog.md`
- `docs/plans/US-002/*` (T-001 to T-011)
- `docs/reports/US-002/*`

## 2. Final Scope
Implement the secure ingestion and processing of Airtable Post Approved Webhooks. This includes the receiver API, the queue topology, and the worker that re-verifies state with Airtable before orchestrating workflows.

## 3. Architecture Boundaries
- **Receiver**: Lightweight, ingress only. Does not contact Airtable, does not allocate versions.
- **Queue**: RabbitMQ. Carries references only. No sensitive data or large payloads.
- **Worker**: Holds business logic. Performs Zero-Trust reload from Airtable. Allocates versions and locks scope. Interacts with Ledger and downstreams.

## 4. Final Event Flow
1. Airtable triggers webhook on Post modified.
2. Receiver validates payload, deduplicates by `event_id`, and enqueues to RabbitMQ.
3. Worker dequeues message, makes API call to Airtable for current record state.
4. Worker verifies state is still `Approved` and valid.
5. Worker verifies channel account mappings.
6. Worker locks scope, allocates `approved_version`.
7. Worker commits initial `workflow_stub_created` state to Ledger.
8. Worker ACKs message in RabbitMQ.

## 5. Receiver Contract
- Zod/Pydantic strict validation on ingress payload.
- Deduplication based ONLY on `event_id`. Ignore unrelated with `unrelated_ignored`.
- NO Airtable API calls.
- NO `approved_version` allocation.
- Pushes references to RabbitMQ.

## 6. Queue Contract
- Messages contain `event_id`, `record_ref`, `workspace_id`.
- MUST NOT contain tokens, secrets, or raw content.
- MUST NOT contain `master_copy`, `cta_url`, or asset paths.

## 7. Worker Reload/Reverify Contract
- Worker performs `GET` to Airtable.
- Non-Approved states (`Draft`, `Scheduled`, etc.) are ignored (e.g. `already_advanced_ignored`, `state_changed_ignored`) and ACKed immediately.
- `approved_version` is ONLY allocated if the reloaded state is fresh and valid `Approved`.
- Ignore/stale branches DO NOT allocate version.

## 8. Channel Account Resolution Contract
- Channel account missing/inactive -> Worker logs and ACKs message. NO workflow created.
- Channel account unresolved -> Worker writes to Ledger. If Ledger write succeeds, send to DLQ. If Ledger write fails, let it retry.

## 9. Ledger Schema Summary
- Database operations must be scoped by `workspace_id`.
- `workflow_runs` stores the core execution state.
- `workflow_runs.channel_account_refs` contains safe metadata only. No raw tokens.
- Production `DELETE` operations are blocked. Rollbacks use compensating audit records instead.

## 10. Status Taxonomy
- Successful Workflow Creation: `workflow_stub_created`
- Initial Workflow Status: `pending_ai_generation`
- Duplicates (Conflict): `duplicate_ignored`
- Unrelated Ingress: `unrelated_ignored`

## 11. ACK/NACK Policy
- Worker ACKs the RabbitMQ message ONLY AFTER the Ledger commit succeeds.
- Non-retryable logic errors are ACKed and recorded in the Ledger.
- Temporary infrastructure errors are NACKed (or un-ACKed) for retry.

## 12. Idempotency Rules
- Production Idempotency Key: `airtable.post.approved:{workspace_id}:{airtable_record_id}:{approved_version}`
- Checked during workflow initialization. Reject as `duplicate_ignored` if it exists.

## 13. Security and Privacy Guardrails
- Global log sanitizer/redactor must be used across all components.
- No raw tokens, secrets, or vault references in logs, queue messages, audit trails, or test fixtures.
- Test cleanup is allowed ONLY for non-production environments with `workspace_id LIKE 'test_%'`.

## 14. Required Implementation Checklist
- [ ] Zod/Pydantic strict validation at receiver.
- [ ] Global log sanitizer/redactor implemented and integrated.
- [ ] Verify no raw tokens/secrets/vault refs in logs, queue, audit, fixtures.
- [ ] Verify no `master_copy`, CTA URL, asset bodies/image paths in queue/audit/workflow stub.
- [ ] Ensure all DB operations are scoped by `workspace_id`.
- [ ] Ensure ACK happens ONLY after Ledger commit.
- [ ] Implement `approval_versions` advisory lock per `(workspace_id, airtable_record_id)`.
- [ ] Limit `workflow_runs.channel_account_refs` to safe metadata only.
- [ ] Ensure Production `DELETE` is blocked for `workflow_runs`.
- [ ] Restrict Test cleanup to non-production + `workspace_id LIKE 'test_%'`.

## 15. Required Test Coverage
- Receiver rejects malformed payloads (Zod).
- Receiver deduplicates `event_id`.
- Worker skips and ACKs on `state_changed_ignored`.
- Worker successfully allocates version and idempotency key on valid `Approved`.
- Worker correctly handles DLQ vs Retry for channel account resolution.
- Ensure test cleanup scripts do not run on prod.

## 16. Out of Scope
- Actual AI composition (US-003).
- Publishing to Facebook (US-005/006).

## 17. Open Items / Carry-forward to Implementation
- Developer handoff for US-002 backend implementation.
- Setup test environments matching the constraints.
