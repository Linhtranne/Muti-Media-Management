# SPEC-US-010: Operational Ledger and Audit Log Hardening

**Status:** Approved  
**Retrofit Note:** Retrospec — US-010 implemented before AI-SDLC gate. Verified from FL-011 and code inspection.  
**FL Reference:** FL-011 (Operational Ledger & Audit Log Hardening) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 875  
**Backlog AC/BR:** US-010 AC1–AC4, BR1–BR3

---

## Goal

Harden the audit log system across all workers and routes by centralizing `AuditLogRepository`, enforcing `auditRedactor.sanitizeAuditMetadata` on every insert, adding an append-only Postgres trigger that blocks UPDATE and DELETE on `audit_logs`, enabling RLS workspace isolation, and supporting idempotent duplicate inserts via `(workspace_id, idempotency_key)` conflict ignore.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-010
- **FL-011:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 875–910
- **Repository:** `apps/orchestrator/src/ledger/auditLogRepository.ts`
- **Redactor:** `apps/orchestrator/src/lib/auditRedactor.ts`
- **Migration:** `apps/orchestrator/src/db/migrations/` — `0010_us010_audit_hardening.sql` (verify name)
- **Tests:** `apps/orchestrator/src/__tests__/auditLog.test.ts`, `apps/orchestrator/src/__tests__/redact.test.ts`

---

## In Scope

- `AuditLogRepository.insertAuditLog()`: canonical insert function used by all workers/routes.
- `auditRedactor.sanitizeAuditMetadata()`: recursive redactor that strips forbidden keys from nested objects/arrays, replaces values with `[REDACTED]`.
- Schema: canonical `audit_logs` table with all required fields.
- RLS: `audit_logs` enforces `workspace_id` isolation (`USING (workspace_id = current_setting('app.current_workspace_id'))`).
- Append-only trigger: Postgres trigger blocks `UPDATE` and `DELETE` on `audit_logs`.
- Idempotent insert: `ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`.

## Out of Scope

- Per-subsystem audit event types (defined by each story).
- Audit log viewer or reporting UI — that belongs to US-012.
- Performance query optimizations beyond what is needed for US-010 hardening.

---

## Functional Contract

Based on FL-011:

1. **Any worker/route calls `AuditLogRepository.insertAuditLog(params)`.**
2. **Redaction:** Pass `params.metadata` through `auditRedactor.sanitizeAuditMetadata(metadata)`.
   - Recursive redactor iterates nested objects and arrays.
   - Forbidden keys (e.g., `access_token`, `bearer`, `secret`, `password`, `token`, `api_key`) → value replaced with `[REDACTED]`.
   - Forbidden key matching: case-insensitive, substring match (e.g., `facebookToken` also redacted).
3. **Insert:** INSERT into `audit_logs` using canonical schema fields. Use `ON CONFLICT (workspace_id, idempotency_key) DO NOTHING` for duplicate safety.
4. **Constraints:** DB constraint error on missing required fields (`workspace_id`, `event_type`, `entity_type`, `entity_id`).

**`audit_logs` Canonical Schema:**
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_type TEXT,
  actor_id TEXT,
  correlation_id TEXT,
  causation_id TEXT,
  idempotency_key TEXT,
  severity TEXT DEFAULT 'info',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Unique constraint for idempotency
CREATE UNIQUE INDEX audit_logs_idempotency ON audit_logs (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Append-only trigger (blocks UPDATE and DELETE)
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION raise_append_only();
-- RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_workspace_isolation ON audit_logs USING (workspace_id = current_setting('app.current_workspace_id'));
```

---

## Data / API Contract

### `AuditLogRepository.insertAuditLog(params)` Interface

```typescript
interface InsertAuditLogParams {
  workspaceId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType?: string;
  actorId?: string;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  metadata?: Record<string, unknown>;
}
```

### `auditRedactor.sanitizeAuditMetadata(metadata)` Contract
- **Input:** Any nested object or array
- **Output:** Deep copy with forbidden-key values replaced by `[REDACTED]`
- **Forbidden key patterns (case-insensitive, substring):** `token`, `secret`, `bearer`, `password`, `api_key`, `access_token`, `signing_key`
- **Never throws:** Malformed input returns `{ error: "sanitization_failed" }` safely

---

## Security & Safety Rules

- **Append-only enforced at DB level:** Postgres trigger raises exception on UPDATE or DELETE — cannot be bypassed by application code.
- **RLS on `audit_logs`:** Queries filtered by `app.current_workspace_id`. Workers must `SET LOCAL app.current_workspace_id` before query.
- **Redactor runs before insert:** No raw token, secret, or signing key can reach `audit_logs.metadata`.
- **Redactor does not throw on malformed input** — must be safe to call from error-handling paths.
- **Compensating audit entries** (used by Airtable sync failures, etc.) must also pass through redactor.

---

## Error Cases

| Case | Behavior |
|:---|:---|
| Duplicate `idempotency_key` | `ON CONFLICT DO NOTHING` — silent success |
| Missing required field | Postgres constraint error → caller must handle |
| Forbidden key in metadata | Redactor replaces with `[REDACTED]` before insert |
| Redactor throws on malformed input | Redactor catches, returns `{error: "sanitization_failed"}` |
| UPDATE attempted on `audit_logs` | Postgres trigger raises exception |
| DELETE attempted on `audit_logs` | Postgres trigger raises exception |

---

## Acceptance Criteria

**AC1 — Raw token in metadata is redacted before insert (Backlog AC1)**
- *Given* a call to `insertAuditLog` with `metadata: { user_data: { access_token: "EAABz-token" } }`
- *When* the insert completes
- *Then* `audit_logs.metadata` contains `{ user_data: { access_token: "[REDACTED]" } }` — the raw token is never persisted.
- *Trace evidence:* Test case `"should redact tokens in metadata"` in [redact.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/redact.test.ts) and [REPORT-us-010-implementation-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-010-implementation-2026-06-02.md).

**AC2 — Append-only trigger prevents modification (Backlog AC2)**
- *Given* an existing row in `audit_logs`
- *When* `UPDATE audit_logs SET severity = 'critical' WHERE id = :id` is executed
- *Then* Postgres raises an exception and the row is unchanged.
- *Trace evidence:* Test case `"should fail on update or delete trigger violation"` in [auditLog.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/auditLog.test.ts).

**AC3 — Duplicate idempotency_key is silently ignored (Backlog AC3)**
- *Given* two calls to `insertAuditLog` with the same `workspace_id` and `idempotency_key`
- *When* both calls execute
- *Then* only one row is inserted and neither call throws an error.
- *Trace evidence:* Test case `"should ignore duplicate insert on conflict"` in [auditLog.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/auditLog.test.ts).

**AC4 — RLS isolates audit logs by workspace (Backlog AC4)**
- *Given* two workspaces `ws_a` and `ws_b` with audit logs in each
- *When* a query runs with `app.current_workspace_id = 'ws_a'`
- *Then* only `ws_a` audit logs are returned — `ws_b` logs are not visible.
- *Trace evidence:* Test case `"should enforce row-level security isolation"` in [auditLog.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/auditLog.test.ts).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [auditLog.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/auditLog.test.ts) | `apps/orchestrator/src/__tests__/auditLog.test.ts` | Happy path log insertion, duplicate key ignores, append-only trigger constraint violations, tenant RLS isolation queries |
| [redact.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/redact.test.ts) | `apps/orchestrator/src/__tests__/redact.test.ts` | Redactor sanitization of secrets/keys, substring case-insensitive checks, empty/nested objects, array structures |

### Verification Evidence Reports

TDD runs and verification notes:
- [REPORT-us-010-implementation-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-010-implementation-2026-06-02.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original RED stage execution outputs not captured. However, regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/__tests__/auditLog.test.ts`

---

## Open Questions

- OQ-010-1: Does `sanitizeAuditMetadata` use exact key-name matching? *Resolved:* Substring matching, case-insensitive. Any key containing `token`, `secret`, `bearer`, `password`, `key` is redacted.
- OQ-010-2: Is the append-only trigger `BEFORE` or `AFTER`? *Resolved:* It is a `BEFORE UPDATE OR DELETE` database trigger.

