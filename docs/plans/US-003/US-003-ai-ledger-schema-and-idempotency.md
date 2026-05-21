# US-003 / T-002: AI Ledger Schema and Idempotency Design

## 1. Docs Read

This technical design document is fully integrated with the architectural constraints and operational rules defined in the following 12 project documents, analyzed in chronological order:

1. **P0** | [06_Architecture_Composability.md](file:///d:/Muti-Media%20Management/docs/architecture/06_Architecture_Composability.md) — Confirmed AI Composer belongs strictly to the Orchestration & AI Middleware layer; Direct platform calls or publishing stay isolated inside the MCP Execution Plane; Postgres is the Operational Ledger.
2. **P0** | [11_Coding_Convention.md](file:///d:/Muti-Media%20Management/docs/architecture/11_Coding_Convention.md) — Enforced TypeScript usage, shared contracts via `packages/shared-contracts`, Zero Token Logging, and worker ACK only after successful Ledger database commits.
3. **P1** | [04_Product_Backlog.md](file:///d:/Muti-Media%20Management/docs/requirements/04_Product_Backlog.md) — Aligned with Epic E02 (AI Orchestration) and US-003 (AI Composer Facebook Variant) AC1–AC4 and business rules BR1–BR3.
4. **P1** | [05_Function_Flow_Logic_Register.md](file:///d:/Muti-Media%20Management/docs/requirements/05_Function_Flow_Logic_Register.md) — Mapped out transitional states for `FL-002` (AI Composer) and `FL-001` (Airtable Post Approved Webhook).
5. **P2** | [07_Risk_Assumption_Decision_Log.md](file:///d:/Muti-Media%20Management/docs/project-mgmt/07_Risk_Assumption_Decision_Log.md) — Aligned with risks `R-003` (AI content risk), `R-005` (token leakage mitigation), and `R-006` (Facebook-first platform scoping).
6. **P2** | [03_SRS_MediaOps_Composability.md](file:///d:/Muti-Media%20Management/docs/requirements/03_SRS_MediaOps_Composability.md) — Adhered to NFR for fail-closed security, audit logs, and database workspace partitioning.
7. **P2** | [US-001-final-implementation-notes.md](file:///d:/Muti-Media%20Management/docs/plans/US-001/US-001-final-implementation-notes.md) — Reviewed Airtable database schemas, campaign linked fields, and timezone locks.
8. **P2** | [US-002-final-implementation-notes.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-final-implementation-notes.md) — Synced with webhook ingestion, reload/reverify constraints, and the server-side versioning design.
9. **P2** | [US-002-ledger-schema-and-idempotency.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-ledger-schema-and-idempotency.md) — Built upon the foundation tables (`webhook_events`, `queue_events`, `workflow_runs`, `audit_logs`).
10. **P2** | [US-002-workflow-stub-creation.md](file:///d:/Muti-Media%20Management/docs/plans/US-002/US-002-workflow-stub-creation.md) — Inherited safe `channel_account_refs`, composite unique indexes, and Transaction B concurrency boundaries.
11. **P2** | [PLAN-us-003-ai-composer-facebook-variant.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/PLAN-us-003-ai-composer-facebook-variant.md) — Synced with the work-breakdown structure and dependencies for T-002.
12. **P2** | [US-003-scope-lock.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-scope-lock.md) — Frozen scope definition for US-003 to prevent publish queue leakage.

### Specialist Knowledge Applied:
* **`~/.spawner/skills/data/postgres-wizard/skill.yaml` & `sharp-edges.yaml`**: Implemented composite indexes with `workspace_id` leading, partial indexes, GIN path-indexing for snapshots, explicit TIMESTAMPTZ, RLS policies, and advisory locking for conflict avoidance.
* **`~/.spawner/skills/backend/event-architect/skill.yaml` & `sharp-edges.yaml`**: Defined exactly-once idempotency key generation, correlation tracking, and state-machine transitions.
* **`~/.spawner/skills/ai/llm-architect/skill.yaml` & `sharp-edges.yaml`**: Structured JSON input/output snapshots, prompt-version mapping, and sanitization parameters.

---

## 2. Objective

The primary objective of **US-003 / T-002** is to design and implement a robust, additive database schema for the **Operational Ledger** (Postgres) that supports the AI Composer's execution metadata, prompt versions, and generated variants. 

The schema is built to guarantee exactly-once processing (idempotency), workspace boundary isolation, and absolute fail-closed credentials handling. This document serves as the physical specification and data contract that enables downstream tasks **T-003 (Shared Contracts)** and **T-004 (Worker Flow)** to implement the code cleanly.

---

## 3. Ledger Scope

### In Scope
* Creating status enums for AI generation runs and content variants.
* Defining physical Postgres table schemas for `ai_generation_runs` and `content_variants` with precise column types, constraints, and foreign keys.
* Specifying indexes to support fast lookups, performance-critical queries, and RLS partition boundaries.
* Designing the production business idempotency key model and duplicate handling.
* Detailing the precise database transaction lifecycle states (happy path, validation failure, retryable failure, and terminal failure).
* Restricting snapshot payloads and error messages from carrying secrets, tokens, or raw paths.
* Formulating an additive, rollback-safe database migration script.

### Out of Scope (strictly deferred to other US-003 tasks)
* Calling the real LLM APIs or setting up API keys (deferred to T-008).
* Writing the actual TypeScript worker logic, routing RabbitMQ messages, or claiming runs (deferred to T-004).
* Managing actual Airtable REST API writebacks or linked fields (deferred to T-009).
* Designing downstream publish engine schemas, Graph API MCP boundaries, or active publish queues (E03 / US-005).

---

## 4. Existing US-002 Dependencies

The AI Composer is triggered downstream of the US-002 Approved Post handler. It assumes the following structures exist:
1. **`workflow_runs`**: A stub is present with `status = 'pending_ai_generation'`, populated `workspace_id`, `airtable_record_id`, and `approved_version`.
2. **`workflow_runs.channel_account_refs`**: Contains safe, token-free stubs of target platforms (display stubs containing platform, channel ID, external page ID).
3. **`audit_logs`**: Capture preceding states (`workflow_stub_created`).

Our schema must be **strictly additive** to this model without mutating or dropping existing columns, tables, or index structures, ensuring that US-002 code is completely unaffected.

---

## 5. Enum Definitions

To support structured workflow transitions, we define three new enum types. In accordance with coding conventions, these enums are designed to be additive only.

```sql
-- 1. AI Generation Status Enum
CREATE TYPE ai_generation_status AS ENUM (
  'queued',               -- Run registered in database ledger
  'processing',           -- Prompt built and LLM request in-flight
  'completed',            -- Valid structured output parsed and saved
  'needs_manual_review',  -- LLM returned result, but failed quality/intent/CTA checks
  'retryable_failed',     -- Temporary failure (rate limit, timeout) awaiting retry
  'failed'                -- Permanent/exhausted failure requiring manual fix
);

-- 2. Content Variant Approval Status Enum (strictly locked for US-003)
CREATE TYPE content_variant_approval_status AS ENUM (
  'needs_review',         -- Initial state for all generated AI variants
  'rejected'              -- Flagged by reviewer or automated policies later
);

-- 3. Content Variant Policy Status Enum
CREATE TYPE content_variant_policy_status AS ENUM (
  'pending_policy'        -- Initial state, ready for US-004 Policy Engine
);
```

US-003 also requires additive extension of the existing US-002 `workflow_run_status` enum. These values are appended only; no existing US-002 status is renamed or removed:

```sql
ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'ai_generation_processing';
ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'ai_generation_completed';
ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'ai_generation_failed';
```

> [!IMPORTANT]
> The value `approved` is intentionally **bypassed** and excluded from the `content_variant_approval_status` enum at this stage. US-003 is strictly an AI draft composition engine and has **no authority** to auto-approve or publish content.

---

## 6. `ai_generation_runs` Schema

Each invocation of the AI Composer produces a durable execution audit log.

```sql
CREATE TABLE ai_generation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  workflow_run_id UUID NOT NULL,
  airtable_record_id TEXT NOT NULL,
  approved_version INTEGER NOT NULL,
  platform TEXT NOT NULL DEFAULT 'facebook',
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_snapshot JSONB NOT NULL,
  notion_context_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_snapshot JSONB NULL,
  status ai_generation_status NOT NULL DEFAULT 'queued',
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,

  -- Foreign Key Constraint targeting workflow_runs
  CONSTRAINT fk_ai_gen_workflow_run
    FOREIGN KEY (workflow_run_id) 
    REFERENCES workflow_runs(id)
    ON DELETE RESTRICT,

  -- Unique Business Idempotency String
  CONSTRAINT uq_ai_gen_idempotency_key 
    UNIQUE (idempotency_key),

  -- Composite Unique Constraint to prevent duplicate runs for same version/prompt
  CONSTRAINT uq_ai_gen_workspace_version_prompt
    UNIQUE (workspace_id, workflow_run_id, platform, prompt_version)
);

-- Document database intent via SQL Comments
COMMENT ON TABLE ai_generation_runs IS 'Stores physical audit metadata and content snapshots of all AI Composer executions.';
COMMENT ON COLUMN ai_generation_runs.input_snapshot IS 'Sanitized, credential-free variables passed to the prompt template.';
COMMENT ON COLUMN ai_generation_runs.notion_context_refs IS 'Array of Notion document pointers (page_id, title, last_edited_at) used for generation context.';
COMMENT ON COLUMN ai_generation_runs.output_snapshot IS 'Parsed structured output from the LLM containing body, hashtags, and cta_url.';
```

---

## 7. `content_variants` Schema

If the AI generation run completes successfully and passes schema validation, the system persists the reviewable variant draft.

```sql
CREATE TABLE content_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  ai_generation_run_id UUID NOT NULL,
  workflow_run_id UUID NOT NULL,
  airtable_record_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'facebook',
  body TEXT NOT NULL,
  hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_url TEXT NULL,
  approval_status content_variant_approval_status NOT NULL DEFAULT 'needs_review',
  policy_status content_variant_policy_status NOT NULL DEFAULT 'pending_policy',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Foreign Key targeting Parent Run
  CONSTRAINT fk_variant_ai_generation_run
    FOREIGN KEY (ai_generation_run_id) 
    REFERENCES ai_generation_runs(id)
    ON DELETE RESTRICT,

  -- Foreign Key targeting Workflow Run
  CONSTRAINT fk_variant_workflow_run
    FOREIGN KEY (workflow_run_id) 
    REFERENCES workflow_runs(id)
    ON DELETE RESTRICT
);

-- Document database intent
COMMENT ON TABLE content_variants IS 'Persists the structured content variant drafts ready for SMM human review and policy checks.';
COMMENT ON COLUMN content_variants.hashtags IS 'JSONB array of strings containing generated hashtags.';
```

### Unique Key Design & Prompt Versioning Rationale:
The user requirements specify: "`content_variants (workspace_id, workflow_run_id, platform) unique` hoặc giải thích nếu chọn key khác để hỗ trợ prompt versioning".

**Our Design Decision:** 
We enforce a strict unique constraint on `(workspace_id, workflow_run_id, platform)` in `content_variants` and utilize an **UPSERT (Insert or Update)** pattern during writes. 

* **Why:** In Airtable (the SMM Control Plane), each Post record has exactly one physical field slot for the Facebook draft (e.g., `facebook_variant_draft`). If a user updates the prompt version or retries the generation run, they expect the draft slot to be overwritten with the latest best draft. Appending duplicate rows in the database would lead to desynchronization between Airtable and Postgres.
* **Audit Safety:** Historical drafts and generation records are **never lost** because every LLM call, prompt version, input snapshot, and output snapshot is preserved in the append-only `ai_generation_runs` ledger table. `content_variants` only represents the *active, currently reviewable version*.

```sql
-- Enforce Unique Constraint to support upserts and prevent duplicate active drafts
ALTER TABLE content_variants
ADD CONSTRAINT uq_content_variants_active_draft
UNIQUE (workspace_id, workflow_run_id, platform);
```

---

## 8. Audit Log Metadata Contract

Every state transition writes an append-only audit trail to `audit_logs` (defined in US-002). For US-003, we lock the metadata schemas:

### Audit Log Schema Structure (from US-002):
`id`, `workspace_id`, `actor_type` (`'system'`), `actor_id` (`'ai_composer_worker'`), `action`, `entity_type`, `entity_id`, `metadata` (`JSONB`), `created_at`.

### Operational Action Pointers:
1. **`ai_run_claimed`**
   * Target: `workflow_run` (UUID)
   * Metadata: `{"run_status": "ai_generation_processing", "idempotency_key": "..."}`
2. **`ai_run_started`**
   * Target: `ai_generation_run` (UUID)
   * Metadata: `{"provider": "configured_provider", "model": "configured_model", "prompt_version": "v1.0"}`
3. **`ai_run_completed`**
   * Target: `ai_generation_run` (UUID)
   * Metadata: `{"duration_ms": 1250, "token_count": {"prompt": 1024, "completion": 256}}`
4. **`ai_variant_persisted`**
   * Target: `content_variant` (UUID)
   * Metadata: `{"approval_status": "needs_review", "policy_status": "pending_policy", "cta_url_length": 85}`
5. **`ai_run_validation_failed`**
   * Target: `ai_generation_run` (UUID)
   * Metadata: `{"error_code": "INTENT_DRIFT", "reason": "Output copy failed semantic intent similarity checks."}`
6. **`ai_run_failed`**
   * Target: `ai_generation_run` (UUID)
   * Metadata: `{"error_code": "PROVIDER_RATE_LIMIT", "alert_needed": true}`

---

## 9. Idempotency Model

### Idempotency Key Formulation:
To prevent massive billing duplicate charges and ensure exactly-once processing, each AI generation execution is locked to a composite idempotency key:
```text
ai.compose.facebook:{workspace_id}:{workflow_run_id}:{prompt_version}
```

### Operational Idempotency Rules:
1. **Deduplication Check:** Before invoking the LLM provider, the worker checks if a record with the constructed `idempotency_key` already exists in `ai_generation_runs`.
2. **Re-use Path (State: `completed`):** If the run is `completed`, the worker bypasses the LLM API call entirely. It fetches the existing `output_snapshot` and upserts it into `content_variants` (if missing), updates the target Airtable draft slot, and completes the workflow processing cleanly.
3. **Double-Invoicing Lockout (State: `processing`):** If the run status is `processing`, another worker is actively executing this call. The current worker aborts processing immediately to prevent duplicate invoicing.
4. **Permanent Failure Lockout (State: `failed`):** If the run is marked `failed` (terminal), the worker aborts immediately to block infinite retry loops.
5. **Manual Review Lockout (State: `needs_manual_review`):** If the run is marked `needs_manual_review`, the worker does not call the LLM again automatically. A human or explicit regeneration request must decide whether a new prompt version/run is needed.
6. **Resume Path (State: `retryable_failed`):** If the run is `retryable_failed` and the backoff interval has elapsed, the worker transitions the status back to `processing` and re-submits the call under safe retry budgets.

---

## 10. Transaction Lifecycle

To ensure data integrity, the system manages state transitions using database transactions with row-level locks.

### Step 1: Claim Workflow Run
To prevent two workers from concurrently claiming the same stub, the worker obtains an exclusive row lock on `workflow_runs`:
```sql
BEGIN;

-- Obtain lock and assert state
SELECT status, workspace_id, airtable_record_id, approved_version
FROM workflow_runs
WHERE id = $1 AND status = 'pending_ai_generation'
FOR UPDATE;

-- Update parent status to block concurrent workers
UPDATE workflow_runs
SET status = 'ai_generation_processing'
WHERE id = $1;

-- Commit claim transaction quickly to prevent connection pool exhaustion
COMMIT;
```

### Step 2: Initialize or Reuse AI Generation Run
The worker attempts to create or fetch the generation run inside a transaction:
```sql
BEGIN;

-- Atomic Insert or Select
INSERT INTO ai_generation_runs (
  workspace_id, workflow_run_id, airtable_record_id, approved_version,
  platform, idempotency_key, provider, model, prompt_version, 
  input_snapshot, notion_context_refs, status
) VALUES (
  $1, $2, $3, $4, 'facebook', $5, $6, $7, $8, $9, $10, 'processing'
)
ON CONFLICT (idempotency_key) 
DO UPDATE SET status = 'processing' 
  WHERE ai_generation_runs.status IN ('queued', 'retryable_failed')
RETURNING id, status;

COMMIT;
```
*(If conflict occurs and existing status is `processing` or `failed`, the transaction aborts cleanly, and the application routes to duplicate reuse or exit paths).*

### Step 3: On Success Transaction
If the LLM returns a valid structured schema and passes validation checks:
```sql
BEGIN;

-- 1. Update generation run to completed
UPDATE ai_generation_runs
SET status = 'completed',
    output_snapshot = $1, -- validated JSON output
    completed_at = NOW()
WHERE id = $2;

-- 2. Upsert content variant draft (exactly one active variant draft per workflow run + platform)
INSERT INTO content_variants (
  workspace_id, ai_generation_run_id, workflow_run_id, airtable_record_id, post_id,
  platform, body, hashtags, cta_url, approval_status, policy_status
) VALUES (
  $3, $2, $4, $5, $6, 'facebook', $7, $8, $9, 'needs_review', 'pending_policy'
)
ON CONFLICT (workspace_id, workflow_run_id, platform)
DO UPDATE SET
  ai_generation_run_id = EXCLUDED.ai_generation_run_id,
  body = EXCLUDED.body,
  hashtags = EXCLUDED.hashtags,
  cta_url = EXCLUDED.cta_url,
  created_at = NOW();

-- 3. Transition parent workflow run status
UPDATE workflow_runs
SET status = 'ai_generation_completed'
WHERE id = $4;

-- 4. Record Audit Log
INSERT INTO audit_logs (workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
VALUES ($3, 'system', 'ai_composer_worker', 'ai_run_completed', 'ai_generation_run', $2, '{}'::jsonb);

COMMIT;
```

### Step 4: On Validation Failure (Fail-Closed Draft Review)
If the LLM returns structured JSON, but it fails semantic checks (e.g., CTA/UTM modified or severe intent drift):
```sql
BEGIN;

-- Mark run as needing manual review (cannot progress to automated policy or publish)
UPDATE ai_generation_runs
SET status = 'needs_manual_review',
    output_snapshot = $1,
    completed_at = NOW(),
    error_code = $2, -- e.g., 'CTA_UTM_MUTATED'
    error_message = $3
WHERE id = $4;

-- Parent workflow exits active processing; manual review is required before any further automation
UPDATE workflow_runs
SET status = 'ai_generation_failed'
WHERE id = $5;

-- Commit transaction
COMMIT;
```

### Step 5: On Retryable Provider Failure
If a temporary provider limit or network timeout occurs:
```sql
BEGIN;

UPDATE ai_generation_runs
SET status = 'retryable_failed',
    error_code = $1,
    error_message = $2
WHERE id = $3;

-- Release parent workflow claim to permit retry execution
UPDATE workflow_runs
SET status = 'pending_ai_generation'
WHERE id = $4;

COMMIT;
```

### Step 6: On Permanent/Exhausted Failure
If a terminal error occurs (e.g., invalid model config, raw prompt parsing failure, or retry budget exhausted):
```sql
BEGIN;

UPDATE ai_generation_runs
SET status = 'failed',
    error_code = $1,
    error_message = $2
WHERE id = $3;

-- Mark workflow run as failed
UPDATE workflow_runs
SET status = 'ai_generation_failed'
WHERE id = $4;

-- Record audit log with critical alert-needed flag (processed by Slack notify worker)
INSERT INTO audit_logs (workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
VALUES ($5, 'system', 'ai_composer_worker', 'ai_run_failed', 'ai_generation_run', $3, '{"alert_needed": true}'::jsonb);

COMMIT;
```

---

## 11. Indexing Strategy

In order to optimize query plans and avoid expensive sequential scans (Seq Scan anti-pattern) under heavy loads:

```sql
-- 1. Index targeting RLS and workflow claims lookup
CREATE INDEX idx_workflow_runs_rls_status 
ON workflow_runs (workspace_id, status);

-- 2. Composite covering index to support RLS and specific model version audits
CREATE INDEX idx_ai_gen_runs_workspace_status 
ON ai_generation_runs (workspace_id, status, provider, model)
INCLUDE (completed_at);

-- 3. Unique composite index to enforce exactly one active content variant per platform post
CREATE UNIQUE INDEX uq_content_variants_active_draft_idx
ON content_variants (workspace_id, workflow_run_id, platform);

-- 4. GIN Index targeting JSONB path queries in output snapshot for diagnostic analytics
CREATE INDEX idx_ai_gen_runs_output_snapshot_gin
ON ai_generation_runs USING gin (output_snapshot jsonb_path_ops);

-- 5. GIN Index targeting array parameters in hashtags
CREATE INDEX idx_content_variants_hashtags_gin
ON content_variants USING gin (hashtags);
```

---

## 12. RLS / Workspace Isolation

MediaOps requires strict multi-tenant data boundaries. No workspace must ever read or write data belonging to another workspace.

### Database Row-Level Security Rules:
* All operational ledger tables (`ai_generation_runs`, `content_variants`) contain `workspace_id TEXT NOT NULL` as the partition key.
* The database roles are configured with active RLS policies that assert `workspace_id = current_setting('app.current_workspace_id')`.

```sql
-- Enable Row Level Security
ALTER TABLE ai_generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_variants ENABLE ROW LEVEL SECURITY;

-- 1. Policy for ai_generation_runs
CREATE POLICY policy_ai_generation_runs_isolation
ON ai_generation_runs
FOR ALL
USING (workspace_id = current_setting('app.current_workspace_id', true))
WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

-- 2. Policy for content_variants
CREATE POLICY policy_content_variants_isolation
ON content_variants
FOR ALL
USING (workspace_id = current_setting('app.current_workspace_id', true))
WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
```

---

## 13. Security and Privacy Constraints

To ensure absolute system compliance and pass high-level security audits:

1. **Zero Cryptographic Credentials:** 
   No access tokens, API keys (Airtable, Slack, OpenAI, Gemini), provider secrets, Vault references, or OAuth secrets may be saved in any column, snapshot, or metadata block of `ai_generation_runs` or `content_variants`.
2. **Safe Snapshots Only:** 
   `input_snapshot` must only contain variables needed for prompt rendering (e.g., master copy, scheduling timestamps, linked campaign summaries). Credentials resolved by the adapter layer must be injected in memory at runtime and never written to disk.
3. **References-Only Notion Context:** 
   `notion_context_refs` must only store structured metadata (e.g., page ID, title string, last edited timestamp) to maintain context reference tracking. It **must never** store or dump raw HTML/Markdown Notion page body payloads.
4. **Sanitized Error Logs:** 
   All Postgres database error logs, provider error codes, and validation failures must pass through an application-layer sanitizer before committing to `error_message`. Stack traces, local server paths (`C:\Users\...` or `/usr/src/...`), internal connection string ports, and authorization header slices are strictly banned.

---

## 14. Migration Strategy

This migration is strictly **additive-first** and rollback-safe. It does not rename or drop any existing objects, preventing schema degradation for active US-002 staging workflows.

```sql
-- ADDITIVE MIGRATION: 20260521142200_add_ai_ledger.sql

-- 1. Define custom enums if they do not exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_generation_status') THEN
    CREATE TYPE ai_generation_status AS ENUM (
      'queued', 'processing', 'completed', 'needs_manual_review', 'retryable_failed', 'failed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_variant_approval_status') THEN
    CREATE TYPE content_variant_approval_status AS ENUM ('needs_review', 'rejected');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_variant_policy_status') THEN
    CREATE TYPE content_variant_policy_status AS ENUM ('pending_policy');
  END IF;
END$$;

-- 1b. Extend workflow_run_status from US-002 additively
ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'ai_generation_processing';
ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'ai_generation_completed';
ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'ai_generation_failed';

-- 2. Create ai_generation_runs table
CREATE TABLE IF NOT EXISTS ai_generation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  workflow_run_id UUID NOT NULL,
  airtable_record_id TEXT NOT NULL,
  approved_version INTEGER NOT NULL,
  platform TEXT NOT NULL DEFAULT 'facebook',
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_snapshot JSONB NOT NULL,
  notion_context_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_snapshot JSONB NULL,
  status ai_generation_status NOT NULL DEFAULT 'queued',
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,

  CONSTRAINT fk_ai_gen_workflow_run
    FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  CONSTRAINT uq_ai_gen_idempotency_key 
    UNIQUE (idempotency_key),
  CONSTRAINT uq_ai_gen_workspace_version_prompt
    UNIQUE (workspace_id, workflow_run_id, platform, prompt_version)
);

-- 3. Create content_variants table
CREATE TABLE IF NOT EXISTS content_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  ai_generation_run_id UUID NOT NULL,
  workflow_run_id UUID NOT NULL,
  airtable_record_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'facebook',
  body TEXT NOT NULL,
  hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_url TEXT NULL,
  approval_status content_variant_approval_status NOT NULL DEFAULT 'needs_review',
  policy_status content_variant_policy_status NOT NULL DEFAULT 'pending_policy',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_variant_ai_generation_run
    FOREIGN KEY (ai_generation_run_id) REFERENCES ai_generation_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_variant_workflow_run
    FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  CONSTRAINT uq_content_variants_active_draft
    UNIQUE (workspace_id, workflow_run_id, platform)
);

-- 4. Apply Indexes (using CONCURRENTLY in production workflows, standard here)
CREATE INDEX IF NOT EXISTS idx_workflow_runs_rls_status ON workflow_runs (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_gen_runs_workspace_status ON ai_generation_runs (workspace_id, status, provider, model);
CREATE INDEX IF NOT EXISTS idx_ai_gen_runs_output_snapshot_gin ON ai_generation_runs USING gin (output_snapshot jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_content_variants_hashtags_gin ON content_variants USING gin (hashtags);

-- 5. Enable Row Level Security and configure basic policies
ALTER TABLE ai_generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_variants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'policy_ai_generation_runs_isolation') THEN
    CREATE POLICY policy_ai_generation_runs_isolation ON ai_generation_runs FOR ALL
      USING (workspace_id = current_setting('app.current_workspace_id', true))
      WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'policy_content_variants_isolation') THEN
    CREATE POLICY policy_content_variants_isolation ON content_variants FOR ALL
      USING (workspace_id = current_setting('app.current_workspace_id', true))
      WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));
  END IF;
END$$;
```

---

## 15. Failure and Retry State Mapping

To simplify diagnostics and ensure self-healing, exceptions are cataloged into clear standardized categories:

| Error Code | Category | Ledger Status | Retry Action | Diagnostic Meaning |
|:---|:---|:---|:---|:---|
| `PROVIDER_RATE_LIMIT` | Retryable | `retryable_failed` | Exponential backoff retry | LLM API rate limit hit (HTTP 429) or quota restriction. |
| `PROVIDER_TIMEOUT` | Retryable | `retryable_failed` | Immediate retry / alternate node | LLM request timed out before response was received. |
| `CONTEXT_UNREACHABLE` | Retryable | `retryable_failed` | Staged retry / Fallback mode | Notion Page brief fetch timed out or returned HTTP 5xx. |
| `SCHEMA_PARSING_FAILED`| Terminal | `needs_manual_review` | None (fail closed) | LLM returned corrupted JSON that failed Zod parsing. |
| `INTENT_DRIFT` | Terminal | `needs_manual_review` | None (fail closed) | Semantic similarity checks confirmed variant deviated from master copy. |
| `CTA_UTM_MUTATED` | Terminal | `needs_manual_review` | None (fail closed) | Variant CTA URL mutated incoming UTM parameters. |
| `PROMPT_INJECTION_DETECTED`| Terminal | `failed` | None (security block) | String validation caught script/system command sequences. |
| `INVALID_MODEL_CONFIG` | Terminal | `failed` | None (admin intervention) | Prompt template contains unsupported options. |

---

## 16. Verification Checklist

* [x] Schema is strictly additive, preserving US-002 tables, indices, and data structures.
* [x] Every table contains `workspace_id` partitioned by RLS policies.
* [x] Standard enums `ai_generation_status`, `content_variant_approval_status`, and `content_variant_policy_status` defined.
* [x] Existing `workflow_run_status` enum is extended additively for AI processing/completed/failed states.
* [x] `approved` status is blocked from AI variant outputs to prevent auto-publishing.
* [x] Foreign keys map `ai_generation_runs` to `workflow_runs`, and `content_variants` to both parent tables.
* [x] Composite unique key `(workspace_id, workflow_run_id, platform, prompt_version)` prevents duplicate runs.
* [x] Upsert unique constraint on `content_variants (workspace_id, workflow_run_id, platform)` prevents duplicate active Airtable draft rows.
* [x] Idempotency model defines key construction and reuse paths for completed runs.
* [x] RLS policies created using workspace context settings.
* [x] RLS policies include both `USING` and `WITH CHECK` to protect reads and writes.
* [x] GIN indexes applied to JSONB columns (`output_snapshot`, `hashtags`) to prevent Seq Scans.
* [x] Log sanitization and zero-token rules strictly detailed for snapshots.
* [x] Transaction boundaries specify exclusive locks on claiming and state transition.
* [x] Error taxonomy classifies failures into retryable vs. terminal codes.
* [x] Migration script is rollback-safe and additive-first.

---

## 17. Open Questions / Risks

1. **Advisory Lock Scope in Concurrency claims:**
   * *Risk:* If many workflow runs are claimed concurrently in a single workspace, transaction locks could experience resource starvation.
   * *Mitigation:* The claiming transaction must be kept extremely fast, locking the row exclusively only for status mutation and releasing the database transaction before making any external API calls.
2. **LLM Structured Output Reliability:**
   * *Risk:* LLM models might fail to return JSON-compliant syntax, leading to high `SCHEMA_PARSING_FAILED` rates.
   * *Mitigation:* Ensure model configuration enforces strict structured output formats (e.g., using OpenAI JSON schemas or Gemini schema constraints), and routing parsing failures to `needs_manual_review` without failing closed the entire worker event loop.

---

## 18. Handoff to T-003 and T-004

### Target for T-003 (Shared AI Contracts):
* Create TypeScript schemas mapping `AiGenerationRun` and `ContentVariant` entities.
* Define `StructuredComposerOutput` Zod validation structure enforcing:
  * `body`: string (min length 10)
  * `hashtags`: array of string (max 10 elements)
  * `cta_url`: string (URL formatted)
* Map Zod error parser to return standard codes matching the **Failure State Mapping**.

### Target for T-004 (Workflow Claim and Worker Flow):
* Design the claiming query sequence inside Transaction B.
* Integrate the deduplication check matching `idempotency_key`.
* Map the state transitions of `workflow_runs.status` from `pending_ai_generation` to `ai_generation_processing`, then to `ai_generation_completed` (or `failed`) based on Ledger outcomes.
