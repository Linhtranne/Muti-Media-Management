# Plan: US-010 Operational Ledger and Audit Log

**Version:** 1.2.0
**Status:** Draft / Ready for implementation
**Scope:** Standardization and hardening plan for Operational Ledger and Audit Log. This is a standardization + hardening plan, NOT a rewrite of entire business flows.

## 1. Docs Read + Constraints Extracted

**Required Documents Read:**
- `AGENTS.md`
- `docs/architecture/06_Architecture_Composability.md`
- `docs/architecture/11_Coding_Convention.md`
- `docs/requirements/04_Product_Backlog.md`
- `docs/requirements/05_Function_Flow_Logic_Register.md`
- `docs/requirements/03_SRS_MediaOps_Composability.md`
- `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md`

**Constraints Extracted:**
1. **Append-Only:** Audit log must be append-only. No UPDATE or DELETE allowed (BR1).
2. **Metadata Redaction:** Sensitive metadata must be masked (BR2). No raw token, secret_ref, bearer token, api key, OAuth token, provider key, or raw Graph API response in audit/log/Slack/Airtable. Nested objects/arrays must be checked.
3. **RLS Enforced:** Every audit row must be scoped by `workspace_id` and subject to RLS. Database role must not bypass RLS.
4. **Data Retention:** Minimum 12 months for production (BR3).
5. **Architectural Boundary:** Platform API code goes inside MCP server only. RabbitMQ messages carry references only.
6. **No Raw Tokens:** No raw token in logs, Airtable, Slack, or audit metadata.
7. **Idempotency:** Every external event needs an idempotency key to prevent duplication.

## 2. Current State Scan & Coverage Verification

Based on a direct scan of the codebase (`insertAuditLog` occurrences, `db/migrations/`, etc.):
- **Migration creating `audit_logs`:** `db/migrations/0001_us002_webhook_ledger.sql`
- **Current DB Schema of `audit_logs`:**
  - `id` UUID PRIMARY KEY
  - `workspace_id` TEXT NOT NULL
  - `actor_type` TEXT NOT NULL DEFAULT 'system'
  - `actor_id` TEXT NOT NULL DEFAULT 'system'
  - `action` TEXT NOT NULL
  - `entity_type` TEXT NOT NULL
  - `entity_id` TEXT NOT NULL
  - `metadata` JSONB NOT NULL DEFAULT '{}'::jsonb
  - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- **Current TS Repositories using `insertAuditLog`:**
  - `slackCommandRepository.ts`, `commentActionRepository.ts`, `mcpPublishWorkerRepository.ts`, `policyWorkerRepository.ts`, `mcpValidateWorkerRepository.ts`, `aiWorkerRepository.ts`, `workerRepository.ts`.
- **Mismatch Identified:** The DB schema uses `action`, but the TypeScript repositories are actually passing `event_type` and `correlation_id` in their `INSERT INTO audit_logs` statements.
- **Missing/Inconsistent fields:** It lacks `correlation_id`, `causation_id`, `idempotency_key`, and `severity` in the DB.

## 3. Backlog Summary

**Description:**
As an Admin/CMO, I want every webhook, AI run, policy result, publish job, and Slack command to be logged so that I can trace and report.

**User Flow:**
1. Each subsystem sends an event to the Ledger.
2. Ledger stores state, actor, entity, metadata.
3. Admin views audits by campaign/post/job.
4. CMO exports basic reports.

**Acceptance Criteria (AC):**
- AC1: Publish job has audit before/after.
- AC2: Slack command has audit.
- AC3: AI run has audit.
- AC4: No raw tokens in audit.

## 4. Scope / Out of Scope

**In Scope:**
- Canonical audit log schema/contract (ALTER additive).
- Standardized audit taxonomy (event_type).
- Append-only protection via Triggers (blocking UPDATE/DELETE for app roles).
- Row-Level Security (RLS) policy enforcement.
- Redaction utility/gate for metadata (including nested objects/arrays).
- Shared audit writer/repository.
- Gap remediation plan for existing modules (Webhooks, AI Runs, Policy, Publish Jobs, Slack Commands).
- Query/reporting foundations (SQL Views).

**Out of Scope:**
- Full Admin UI / CMO dashboard UI.
- Long-term data warehouse.
- Physical deletion of production audit rows.

## 5. Canonical Data Model

**Proposed Schema Migration (ALTER additive to `audit_logs`):**

To reconcile the TS code with the DB, we will migrate `action` to `event_type` and add the missing columns safely:
- `id` UUID PRIMARY KEY
- `workspace_id` TEXT NOT NULL
- `event_type` TEXT NOT NULL (Migrated from `action`)
- `actor_type` TEXT NULL CHECK actor_type IN ('system', 'user', 'admin', 'ai')
- `actor_id` TEXT NULL
- `entity_type` TEXT NOT NULL
- `entity_id` TEXT NOT NULL
- `correlation_id` TEXT NOT NULL (Added)
- `causation_id` TEXT NULL (Added)
- `idempotency_key` TEXT NULL (Added)
- `severity` TEXT CHECK severity IN ('info','warn','error','critical') DEFAULT 'info' (Added)
- `metadata` JSONB NOT NULL DEFAULT '{}'::jsonb
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()

**Migration Ordering Strategy:**
1. Add new columns.
2. Check if `event_type` already exists. If not, `ALTER TABLE audit_logs RENAME COLUMN action TO event_type;`.
3. If both exist somehow, safely migrate data `UPDATE audit_logs SET event_type = COALESCE(event_type, action) WHERE event_type IS NULL;` before dropping `action`.
4. **CRITICAL:** Create the Append-only trigger **AFTER** performing the backfill and `ALTER` commands. If created before, the trigger will block its own migration operations.

**Indexes:**
- `(workspace_id, created_at DESC)`
- `(workspace_id, entity_type, entity_id, created_at DESC)`
- `(workspace_id, event_type, created_at DESC)`
- `(workspace_id, correlation_id)`
- `UNIQUE (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL` (Prevents duplicate audits in retry flows)

**Row-Level Security (RLS):**
- `ENABLE RLS`
- `CREATE POLICY audit_logs_workspace_rls AS RESTRICTIVE FOR ALL`
- `USING (workspace_id = current_setting('app.current_workspace_id', true))`
- `WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true))`

**Append-Only Enforcement:**
- A PostgreSQL Trigger will be added to block `UPDATE` and `DELETE` operations entirely.
- `INSERT` is fully permitted.
- The trigger will block all app roles universally from updating or deleting rows.

## 6. Audit Event Taxonomy

Normalized categories and requirements based on existing repository taxonomy:

- `WEBHOOK_*` (e.g., `WEBHOOK_RECEIVED`, `WEBHOOK_PROCESSED`)
- `AI_RUN_*` (e.g., `AI_RUN_STARTED`, `AI_RUN_COMPLETED`, `AI_RUN_FAILED`)
- `POLICY_*` (e.g., `POLICY_CHECK_COMPLETED`, `POLICY_CHECK_BLOCKED`)
- `MCP_VALIDATION_*` (e.g., `MCP_VALIDATION_COMPLETED`, `MCP_VALIDATION_FAILED`)
- `PUBLISH_*` (e.g., `PUBLISH_STARTED`, `PUBLISH_SUCCEEDED`, `PUBLISH_FAILED`)
- `SLACK_COMMAND_*` (e.g., `SLACK_COMMAND_RECEIVED`, `SLACK_COMMAND_SUCCEEDED`)
- `COMMENT_ACTION_*` (e.g., `COMMENT_REPLY_SENT`, `COMMENT_ESCALATED`)

## 7. Metadata Redaction Rules

**Recursive Banned Keys:**
- `token`, `access_token`, `refresh_token`
- `secret`, `secret_ref`, `secretRef`
- `api_key`, `authorization`, `bearer`, `password`
- `raw_graph_response`, `raw_provider_response`

**Redactor Behavior:**
- The redactor will deeply scan nested objects and arrays within `metadata`.
- If a sensitive key is found, its value is redacted.
- When redaction occurs, the following markers are appended to `metadata`:
  - `metadata_redacted: true`
  - `redacted_keys: [...]`
- **CRITICAL:** `redacted_keys` MUST ONLY contain the bare key name (e.g., `"token"`, `"secret_ref"`). It must **NOT** contain full object paths or values, as the path itself could reveal sensitive data shapes.
- We do NOT reject the audit log insert when sensitive data is detected. We redact and insert to preserve the event history.

## 8. Audit Insert Failure Boundary

Audit failures must be handled differently depending on the context:

- **Critical same-transaction events:** 
  *(e.g., webhook accepted, workflow state changes, publish started/succeeded/failed, Slack command accepted/succeeded/failed).*
  Failure to write the audit log MUST fail the entire transaction. These events are the source of truth for state progression.
  
- **Non-critical post-commit notifications:** 
  *(e.g., Slack alert delivery, report sync, optional telemetry).*
  Failure to write the audit log should NOT fail the business operation. The error should be caught and optionally recorded as a compensating metric/alert.

## 9. Shared Audit Writer / Repository Plan

Create `apps/orchestrator/src/ledger/auditLogRepository.ts`.

Minimal API:
- `insertAuditLog(client, input)`
- `sanitizeAuditMetadata(metadata)`

Refactor existing per-repository `insertAuditLog` implementations (`slackCommandRepository.ts`, `commentActionRepository.ts`, etc.) to call this shared utility to centralize redaction and schema compliance.

## 10. Query/Reporting Foundation

To satisfy US-010's Admin/CMO reporting ACs, we will build backend SQL views/helpers:
- `audit_timeline_by_correlation_id`: Timeline of a full workflow run.
- `audit_timeline_by_entity`: Groups by `entity_type` and `entity_id`.
- `audit_publish_job_timeline`: Specific view tracking a publish job before/after.
- `audit_slack_command_timeline`: Slack command audit trail.
- `audit_ai_run_timeline`: AI composition history.

## 11. Test Plan

- **Sanitizer:** Unit test `sanitizeAuditMetadata` with nested arrays and objects to ensure deep redaction and correct `metadata_redacted` flags (and safe `redacted_keys`).
- **RLS:** Integration test denying cross-workspace select.
- **Append-only:** Attempt `UPDATE` and `DELETE` on `audit_logs` and assert exception for app roles.
- **Idempotency:** Verify that inserting a duplicate `idempotency_key` is caught by the unique index and ignored/handled gracefully.
- **Repository Mismatch Fix:** Write a specific test verifying that an existing repository using `insertAuditLog(..., eventType, ...)` executes perfectly against the migrated DB schema.
- **AC1-AC4 Coverage:** Integration tests verifying that Webhooks, AI Runs, Publish Jobs, and Slack Commands produce the correct audit taxonomy without tokens.

## 12. Implementation Task Breakdown

- **T-001:** DB Migration: Rename `action` -> `event_type` safely (COALESCE if both exist), add `correlation_id`, `idempotency_key`, `severity`, `causation_id`. Add Unique partial index.
- **T-002:** DB Migration: Add Append-only trigger (block UPDATE/DELETE) **AFTER** backfill completes.
- **T-003:** Create `AuditLogRepository` and the recursive metadata redactor utility.
- **T-004:** Refactor existing repositories to use the central `AuditLogRepository`.
- **T-005:** Implement transaction boundary rules (fail vs non-fail).
- **T-006:** Add SQL Query views/helpers for timeline reporting.
- **T-007:** Add comprehensive test suite.
- **T-008:** Update Function Flow Register (`FL-011`).
- **T-009:** Write Report.

## 13. Open Questions
*(All Open Questions resolved as per review on 2026-06-02. Plan locked for Implementation.)*
