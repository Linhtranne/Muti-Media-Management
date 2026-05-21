# US-003 / T-010: Policy Engine Handoff Boundary Design

## 1. Docs Read

This technical design document is fully integrated with the architectural constraints and operational rules defined in the following 11 mandatory read documents, analyzed in chronological order:

1. **P0** | [06_Architecture_Composability.md](file:///d:/Muti-Media%20Management/docs/architecture/06_Architecture_Composability.md) — Confirmed AI Composer belongs strictly to the *Orchestration & AI Middleware* layer. Direct platform interactions and publishing are isolated inside the *MCP Execution Plane*. Middleware cannot directly invoke Facebook Graph API, nor should it bypass the MCP tool contract. Operational Ledger (Postgres) is the source of truth.
2. **P0** | [11_Coding_Convention.md](file:///d:/Muti-Media%20Management/docs/architecture/11_Coding_Convention.md) — Enforced TypeScript usage, shared contracts via `packages/shared-contracts`, Zero Token Logging, and worker ACK only after successful Ledger database commits.
3. **P1** | [04_Product_Backlog.md](file:///d:/Muti-Media%20Management/docs/requirements/04_Product_Backlog.md) — Aligned with Epic E02 (AI Orchestration) and US-003 (AI Composer Facebook Variant) AC1–AC4 and business rules BR1–BR3.
4. **P1** | [05_Function_Flow_Logic_Register.md](file:///d:/Muti-Media%20Management/docs/requirements/05_Function_Flow_Logic_Register.md) — Mapped out transitional states for `FL-002` (AI Composer) and `FL-001` (Airtable Post Approved Webhook).
5. **P2** | [PLAN-us-003-ai-composer-facebook-variant.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/PLAN-us-003-ai-composer-facebook-variant.md) — Synced with the overall work-breakdown structure and task sequence of US-003.
6. **P2** | [US-003-scope-lock.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-scope-lock.md) — Frozen scope definition for US-003 to prevent publish queue leakage.
7. **P2** | [US-003-ai-ledger-schema-and-idempotency.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-ai-ledger-schema-and-idempotency.md) — Inherited schema definitions for `ai_generation_runs`, `content_variants`, custom enums, and indexing strategy.
8. **P2** | [US-003-shared-ai-contracts.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-shared-ai-contracts.md) — Synced with TypeScript typings, normalization helper contracts, and error structures.
9. **P2** | [US-003-ai-composer-worker-flow.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-ai-composer-worker-flow.md) — Integrated RabbitMQ claims, row locks, and non-blocking ACK/NACK semantics.
10. **P2** | [US-003-structured-output-validation.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-structured-output-validation.md) — Decoupled Zod schema parsing and UTM/CTA preservation boundaries.
11. **P2** | [US-003-variant-persistence-and-airtable-update.md](file:///d:/Muti-Media%20Management/docs/plans/US-003/US-003-variant-persistence-and-airtable-update.md) — Confirmed transactional boundaries, Airtable soft-mapping configs, and compensation strategies.

### Specialist Knowledge Applied:
* **`C:\Users\Hi\.spawner\skills\backend\event-architect\skill.yaml` & `sharp-edges.yaml`**: Leveraged immutable events, exactly-once delivery with deduplication, and strict correlation/causation tracking.
* **`C:\Users\Hi\.spawner\skills\backend\queue-workers\skill.yaml` & `sharp-edges.yaml`**: Handled durable consumer design, backpressure limits, and graceful shutdown patterns.
* **`C:\Users\Hi\.spawner\skills\data\postgres-wizard\skill.yaml` & `sharp-edges.yaml`**: Implemented strict ACID transaction boundaries, Postgres Outbox tables, optimal composite indexing, and Row-Level Security (RLS) enforcement.

---

## 2. Objective

The primary objective of **US-003 / T-010** is to specify the **Policy Engine Handoff Boundary** between the **AI Composer (US-003)** and the **Policy Engine (US-004)** for the MediaOps Composability platform.

This specification establishes the exact eligibility criteria for variants entering policy check, designs the event contract and event schemas, specifies the transactional boundary using the Transactional Outbox Pattern to solve distributed state consistency, implements strict idempotency rules, handles fail-closed behaviors, registers audit events, and maps the complete state transition matrix—all while maintaining absolute multi-tenant partitioning and security isolation.

This document serves as the high-fidelity design blueprint that enables clean, safe downstream development.

---

## 3. Handoff Scope

### In Scope
* Specifying exact variant eligibility and ineligibility conditions based on database states.
* Designing the references-only RabbitMQ event contract `policy.evaluate.requested` (Zero Data Leakage).
* Designing the additive Transactional Outbox table (`policy_handoff_events`) and its database schema.
* Mapping the SQL queries and multi-step transaction lifecycles under the Outbox Pattern.
* Formulating the handoff idempotency key structure and deduplication rules on both the producer and consumer sides.
* Defining fail-closed behaviors, security scanner bypass guards, and fallback rules for Airtable sync failures.
* Creating the state transition matrix for `workflow_runs`, `ai_generation_runs`, and `content_variants`.
* Registering a standardized Audit Events taxonomy table with concrete JSON metadata payload structures.
* Defining integration rules for how US-004 handles and resolves variant details from Ledger references.

### Out of Scope
* Implementing actual policy evaluation rules, forbidden keyword checks, or structural rules (owned strictly by US-004).
* Deciding the content's final safety status (`allow`/`block`/`warn`).
* Bypassing SMM human approval or auto-approving content (bypassing review is strictly banned).
* Creating social media `publish_jobs` or queue events for direct publishing (deferred to US-005).
* Invoking Meta Graph APIs or platform MCP server tools (e.g. `validate_post`, `enqueue_publish`, `publish_post`).

---

## 4. Eligibility & Ineligibility Conditions

To guarantee that only successfully drafted, validated, and persisted variants are subjected to policy checks, the handoff engine enforces strict eligibility criteria at the ledger boundary.

### 4.1. Eligibility Criteria (Must satisfy ALL)
An event handoff is triggered **only** when the operational ledger satisfies these state requirements:
1. **Parent Workflow Run Completed:** `workflow_runs.status = 'ai_generation_completed'`
2. **AI Generation Run Completed:** `ai_generation_runs.status = 'completed'`
3. **Variant Review Status:** `content_variants.approval_status = 'needs_review'`
4. **Variant Policy Status:** `content_variants.policy_status = 'pending_policy'`
5. **Content Validity:** The variant row in `content_variants` must contain a non-empty `body` copy (minimum 10 characters), a valid `hashtags` JSONB array (even if empty `[]`), and valid internal/external references (`workspace_id`, `workflow_run_id`, `airtable_record_id`, `post_id`).
6. **Airtable Sync State:** 
   * *Ideal Path:* `content_variants.sync_retry_needed = false` (Airtable writeback has succeeded).
   * *Fallback Path:* If Airtable sync is retrying (`sync_retry_needed = true`), the handoff **is still permitted to run**. Since the Postgres Ledger is the operational source of truth, the Policy Engine evaluates rules based on Postgres data; blocking the policy check because Airtable's API is temporarily slow/rate-limited creates an unnecessary cascading bottleneck. However, the system must write an audit record flagging `airtable_sync_pending_at_policy_handoff = true` for operational visibility.

### 4.2. Ineligibility Criteria (Immediate Block)
The handoff engine must **never** enqueue a policy event if any of the following apply:
1. **Invalid AI Run Status:** `ai_generation_runs.status` is `needs_manual_review`, `retryable_failed`, or `failed` (indicates generation did not complete successfully).
2. **Failed Workflow Run:** `workflow_runs.status = 'ai_generation_failed'`.
3. **Incomplete Content:** Variant lacks body, hashtags, or required references.
4. **Security Block:** Security scanner (T-007) detected a prompt injection or validation failure and blocked variant persistence.

---

## 5. Policy Handoff Event Contract (`policy.evaluate.requested`)

To maintain absolute data privacy, enforce system security, and minimize payload sizes in transit, the queue event utilizes a **References-Only Payload Pattern**.

> [!IMPORTANT]
> The RabbitMQ queue message **must not** contain the composed text body, hashtags, campaign details, or Notion brief extracts. The downstream Policy Engine (US-004) will reload the required variant copy directly from the Postgres Ledger using the references.

### 5.1. JSON Schema Specification
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PolicyEvaluateRequestedEvent",
  "type": "object",
  "properties": {
    "event_id": {
      "type": "string",
      "format": "uuid",
      "description": "Unique identifier for this specific event instance."
    },
    "event_type": {
      "type": "string",
      "enum": ["policy.evaluate.requested"],
      "description": "The routing key event classifier."
    },
    "workspace_id": {
      "type": "string",
      "description": "The tenant identifier for RLS query isolation."
    },
    "correlation_id": {
      "type": "string",
      "format": "uuid",
      "description": "Unique trace identifier spanning the entire campaign workflow."
    },
    "workflow_run_id": {
      "type": "string",
      "format": "uuid",
      "description": "Pointer to the parent workflow run stub."
    },
    "ai_generation_run_id": {
      "type": "string",
      "format": "uuid",
      "description": "Pointer to the specific LLM execution record."
    },
    "content_variant_id": {
      "type": "string",
      "format": "uuid",
      "description": "Pointer to the content variant to be evaluated."
    },
    "airtable_record_id": {
      "type": "string",
      "description": "Direct pointer to the SMM Control Plane Post record."
    },
    "platform": {
      "type": "string",
      "enum": ["facebook"],
      "description": "The target publishing platform."
    },
    "prompt_version": {
      "type": "string",
      "description": "Version identifier of the prompt used."
    },
    "approved_version": {
      "type": "integer",
      "minimum": 1,
      "description": "Immutable incremental version allocated by US-002."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Deterministic idempotency key for policy handoff deduplication."
    },
    "created_at": {
      "type": "string",
      "format": "date-time",
      "description": "Timestamp when this handoff event was constructed."
    }
  },
  "required": [
    "event_id",
    "event_type",
    "workspace_id",
    "correlation_id",
    "workflow_run_id",
    "ai_generation_run_id",
    "content_variant_id",
    "airtable_record_id",
    "platform",
    "prompt_version",
    "approved_version",
    "idempotency_key",
    "created_at"
  ],
  "additionalProperties": false
}
```

### 5.2. TypeScript Interface Contract
```typescript
/**
 * Policy Evaluate Requested Event payload.
 * Strictly holds references only.
 */
export interface PolicyEvaluateRequestedEvent {
  eventId: string;             // UUID v4
  eventType: 'policy.evaluate.requested';
  workspaceId: string;         // Partitioning Tenant Key
  correlationId: string;       // Trace Tracking
  workflowRunId: string;       // Parent Workflow Run UUID
  aiGenerationRunId: string;   // LLM Execution UUID
  contentVariantId: string;    // Target Variant UUID
  airtableRecordId: string;    // Airtable Reference
  platform: 'facebook';        // Platform Scope
  promptVersion: string;       // Prompt template tracker
  approvedVersion: number;     // Monotonic version integer
  idempotencyKey: string;      // policy.evaluate.requested:{workspace}:{variant}:{policy_version_or_pending}
  createdAt: string;           // ISO DateTime String
}
```

---

## 6. Transactional Outbox Pattern

To guarantee system reliability under the **composability model**, we adopt the **Transactional Outbox Pattern**. This solves the dual-write problem (writing to a database and publishing to a queue in different services) without requiring heavy distributed transactions (such as 2PC).

### 6.1. Additive DB Design: `policy_handoff_events` (Outbox Table)
We introduce an additive outbox table to queue pending RabbitMQ publications reliably.

```sql
-- Create Outbox Table for Policy Handoffs
CREATE TABLE policy_handoff_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL DEFAULT 'policy.evaluate.requested',
  correlation_id UUID NOT NULL,
  workflow_run_id UUID NOT NULL,
  ai_generation_run_id UUID NOT NULL,
  content_variant_id UUID NOT NULL,
  airtable_record_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'facebook',
  prompt_version TEXT NOT NULL,
  approved_version INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'published', 'failed'
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL,

  -- Foreign Key targeting content_variants
  CONSTRAINT fk_handoff_content_variant
    FOREIGN KEY (content_variant_id)
    REFERENCES content_variants(id)
    ON DELETE RESTRICT,

  -- Unique Event Constraint for tracing deduplication
  CONSTRAINT uq_handoff_event_id
    UNIQUE (event_id),

  -- Ensure only one pending policy evaluation event exists per active variant version
  CONSTRAINT uq_handoff_pending_variant_version
    UNIQUE (workspace_id, content_variant_id, approved_version, status),

  CONSTRAINT uq_handoff_idempotency_key
    UNIQUE (idempotency_key)
    DEFERRABLE INITIALLY IMMEDIATE
);

-- Indexing for high-performance Outbox Relay queries
CREATE INDEX idx_handoff_outbox_pending 
  ON policy_handoff_events (status, created_at)
  WHERE status = 'pending';

-- Apply Row-Level Security (RLS) consistent with Postgres Ledger
ALTER TABLE policy_handoff_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_handoff_events_workspace_isolation ON policy_handoff_events
  FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

COMMENT ON TABLE policy_handoff_events IS 'Durable outbox table for coordinating atomic RabbitMQ policy handoff events.';
```

### 6.2. Detailed Database Transaction: Atomic Success Path
During Transaction C (Happy Path Persistence in T-009), the outbox row is written inside the **same** Postgres transaction as the Ledger updates:

```sql
BEGIN;

-- 1. Update the AI Generation Run status and output snapshots
UPDATE ai_generation_runs
SET status = 'completed',
    output_snapshot = $1, -- parsed valid JSON containing body, hashtags, cta_url
    completed_at = NOW()
WHERE id = $2 AND workspace_id = $3;

-- 2. Upsert Content Variant draft
INSERT INTO content_variants (
  workspace_id, ai_generation_run_id, workflow_run_id, airtable_record_id, post_id,
  platform, body, hashtags, cta_url, approval_status, policy_status, sync_retry_needed
) VALUES (
  $3, $2, $4, $5, $6, 'facebook', $7, $8, $9, 'needs_review', 'pending_policy', $10
)
ON CONFLICT (workspace_id, workflow_run_id, platform)
DO UPDATE SET
  ai_generation_run_id = EXCLUDED.ai_generation_run_id,
  body = EXCLUDED.body,
  hashtags = EXCLUDED.hashtags,
  cta_url = EXCLUDED.cta_url,
  approval_status = 'needs_review',
  policy_status = 'pending_policy',
  sync_retry_needed = EXCLUDED.sync_retry_needed,
  created_at = NOW()
RETURNING id; -- Returns Content Variant UUID (used as $11 in subsequent steps)

-- 3. Transition parent workflow run status
UPDATE workflow_runs
SET status = 'ai_generation_completed'
WHERE id = $4 AND workspace_id = $3;

-- 4. INSERT INTO Transactional Outbox (Write Handoff Event)
INSERT INTO policy_handoff_events (
  workspace_id, event_id, correlation_id, workflow_run_id, ai_generation_run_id,
  content_variant_id, airtable_record_id, platform, prompt_version, approved_version,
  idempotency_key, metadata, status
) VALUES (
  $3, 
  $12, -- event_id (UUID generated client-side for deterministic tracking)
  $13, -- correlation_id
  $4,  -- workflow_run_id
  $2,  -- ai_generation_run_id
  $11, -- content_variant_id (returned by insert/update step)
  $5,  -- airtable_record_id
  'facebook',
  $14, -- prompt_version
  $15, -- approved_version
  $16, -- idempotency_key
  jsonb_build_object('airtable_sync_pending_at_policy_handoff', $10),
  'pending'
);

-- 5. Record Core Audit Log
INSERT INTO audit_logs (workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
VALUES ($3, 'system', 'ai_composer_worker', 'policy_handoff_prepared', 'content_variant', $11, 
        jsonb_build_object(
          'event_id', $12, 
          'correlation_id', $13, 
          'approved_version', $15,
          'airtable_sync_pending_at_policy_handoff', $10
        ));

COMMIT;
```

### 6.3. Outbox Relay Flow (Post-Commit Queue Publish)
Once the database transaction is successfully committed, the event publication is handled out-of-band to prevent blocking worker execution:

1. **Transaction Commit:** The AI Composer worker successfully commits the Postgres transaction.
2. **Worker ACK:** The AI Composer worker immediately ACKs the queue message (or responds successfully). The local Ledger and Outbox states are secure.
3. **Outbox Relay Consumption:**
   * A dedicated light-weight **Outbox Relay** process (or a post-commit transactional hook) queries pending outbox rows:
     ```sql
     SELECT * FROM policy_handoff_events 
     WHERE status = 'pending' 
     ORDER BY created_at ASC 
     LIMIT 50;
     ```
   * For each event, it constructs the references-only RabbitMQ payload and publishes it to the dedicated policy exchange/routing key for `policy.evaluate.requested`. It must not publish to any publish-oriented exchange or queue.
4. **Outbox State Update:**
   * **Publish Success:** If RabbitMQ acknowledges receipt, the relay marks the event as completed:
     ```sql
     UPDATE policy_handoff_events 
     SET status = 'published', published_at = NOW(), retry_count = retry_count + 1
     WHERE id = $1 AND workspace_id = $2;
     
     -- Write audit log
     INSERT INTO audit_logs (workspace_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
     VALUES ($2, 'system', 'outbox_relay', 'policy_handoff_published', 'content_variant', $3, 
             jsonb_build_object('event_id', $4));
     ```
   * **Publish Failure:** If RabbitMQ is down, the relay increments `retry_count` and updates `error_message`. A dedicated background scheduler will retry the execution exponentially. The Content Variant's draft and the workflow status remain intact.
     ```sql
     UPDATE policy_handoff_events 
     SET retry_count = retry_count + 1, error_message = $1
     WHERE id = $2 AND workspace_id = $3;
     ```

---

## 7. Idempotency & Concurrency Rules

To guarantee exactly-once policy evaluation requests and prevent thundering herd conditions during redeliveries, strict idempotency checks are locked at the boundary.

### 7.1. Handoff Idempotency Key Formula
Every policy request is bound to a unique, deterministic idempotency key string structure:
```text
policy.evaluate.requested:{workspace_id}:{content_variant_id}:{policy_version_or_pending}
```
* **Explanation:**
  * `workspace_id`: Tenant boundary protection.
  * `content_variant_id`: Points to the specific draft variant.
  * `policy_version_or_pending`: If a schema version for the policy engine is defined, it is appended here. If not, it defaults to the literal string `pending_policy`.
* **Example:** `policy.evaluate.requested:workspace-abc:550e8400-e29b-41d4-a716-446655440000:pending_policy`

### 7.2. Idempotent Deduplication Rules
1. **Outbox Insertion Block:** The unique constraint `uq_handoff_pending_variant_version` on the outbox table (`policy_handoff_events`) prevents inserting a duplicate `pending` outbox event for the same active `content_variant_id` and `approved_version`.
2. **Duplicate Ingestion Prevention (Consumer / Policy Engine Side):**
   * Before evaluating rules, the Policy Engine (US-004) checks if the incoming `event_id` or the composite `idempotency_key` has already been logged.
   * If a policy run is already in progress or completed for the active variant version, the Policy Engine ignores the redelivered event (de-duplication at consumer boundary).
3. **Active Status Lock (Duplicate Prevention):**
   * The AI Composer **must never** emit a secondary duplicate handoff event if `content_variants.policy_status` has transitioned out of `pending_policy` (e.g., if it is already in `policy_evaluating`, `policy_approved`, or `policy_rejected`).
   * This is checked in the transaction layer using optimistic locking on the `content_variants` status columns.

---

## 8. Fail-Closed Rules

To guarantee absolute security and structural compliance under the composability architecture, the system operates under a **Strict Fail-Closed Paradigm**.

1. **Eligibility Check Failure:** If any eligibility checks fail (e.g. `workflow_runs.status` is not completed, `ai_generation_runs.status` indicates error), the handoff is immediately aborted. No outbox entry is written, and no RabbitMQ event is enqueued. The run is locked.
2. **Missing Variant Copy:** If the variant record is physically missing from the ledger database, the handoff blocks immediately.
3. **Security Block Bypass Prevention:** If the security scanner catches a prompt injection or credential violation, the system marks `ai_generation_runs.status = failed` and does NOT persist a `content_variants` draft. Since there is no valid `content_variant_id`, the transaction prevents outbox generation. The workflow ends in `ai_generation_failed`.
4. **Handling Airtable Sync Retries (Non-Blocking Fallback):**
   * *The Problem:* Writing the draft variant back to Airtable may fail due to temporary network timeouts or Airtable API rate limits (forcing `sync_retry_needed = true`).
   * *The Solution:* The handoff **is permitted to continue** to US-004. Postgres is the operational ledger and primary source of truth. The policy check will proceed.
   * *Mitigation:* We write a specialized metadata flag `airtable_sync_pending_at_policy_handoff = true` into the `policy_handoff_events` outbox metadata and the audit log. The background sync worker continues retrying Airtable writes independently. This decouples user interface synchronization from backend execution checks, ensuring maximum system resilience.

---

## 9. Audit Events Taxonomy

Every stage of the policy handoff transition is monitored. We register four high-fidelity Audit Events into the Postgres Ledger (`audit_logs`):

| Audit Action | Trigger Condition | Target Entity | Key Metadata Payload Fields |
|:---|:---|:---|:---|
| `policy_handoff_prepared` | Committed the outbox row successfully inside the main transaction. | `content_variant` | `{"event_id": UUID, "correlation_id": UUID, "approved_version": Integer, "airtable_sync_pending_at_policy_handoff": Boolean}` |
| `policy_handoff_published` | Outbox Relay successfully publishes the references payload to RabbitMQ and receives ACK. | `content_variant` | `{"event_id": UUID, "correlation_id": UUID, "published_at": TIMESTAMPTZ}` |
| `policy_handoff_skipped_ineligible` | Generation process completed but variant is ineligible for policy checks (fails criteria). | `ai_generation_run` | `{"reason": String, "current_status": String, "correlation_id": UUID}` |
| `policy_handoff_publish_failed` | Outbox Relay exhausted immediate publishing retries to RabbitMQ. | `content_variant` | `{"event_id": UUID, "correlation_id": UUID, "retry_count": Integer, "error_message": String}` |

---

## 10. State Transition Matrix

The ledger state transitions are strictly governed by the following lifecycle rules to prevent state leakage and ensure atomic observability:

### 10.1. Workflow Runs (`workflow_runs`)
| Source State | Trigger Event | Condition | Target State |
|:---|:---|:---|:---|
| `pending_ai_generation` | Worker claims run | Advisory locks acquired | `ai_generation_processing` |
| `ai_generation_processing` | Main transaction commits (variant saved) | Success Path (Transaction C) | `ai_generation_completed` |
| `ai_generation_processing` | Quality checks or terminal LLM/config failure | Failure Paths (Transaction D, G) | `ai_generation_failed` |
| `ai_generation_processing` | Retryable provider/context failure | Retryable Path (Transaction F) | `pending_ai_generation` |
| `ai_generation_processing` | Security scanner blocks | Security Path (Transaction E) | `ai_generation_failed` |

### 10.2. AI Generation Runs (`ai_generation_runs`)
| Source State | Trigger Event | Condition | Target State |
|:---|:---|:---|:---|
| `queued` | Worker initiates API call | Run execution starts | `processing` |
| `processing` | LLM returns valid schema | Validation passes | `completed` |
| `processing` | Schema or intent drift caught | Validation fails (Transaction D) | `needs_manual_review` |
| `processing` | Scanner catches injection | Security breach (Transaction E) | `failed` |
| `processing` | Rate limit or Timeout | Retryable exception (Transaction F) | `retryable_failed` |
| `processing` | Server config error | Admin credential issue (Transaction G) | `failed` |

### 10.3. Content Variants (`content_variants`)
| Field | Source State | Trigger Event | Target State |
|:---|:---|:---|:---|
| `approval_status` | (None) | Initial variant creation | `needs_review` (Enforced default, no bypass allowed) |
| `policy_status` | (None) | Initial variant creation | `pending_policy` (Initial handoff state) |
| `policy_status` | `pending_policy` | Policy Engine (US-004) begins execution | `policy_evaluating` (Managed by US-004) |

---

## 11. Security & Privacy Rules

To protect corporate assets, client credentials, and prevent context leakage, the handoff layer strictly enforces these compliance boundaries:

1. **References-Only Queues:** Events enqueued onto RabbitMQ exchanges MUST NOT contain prompt instructions, post text, brand voice templates, or Notion file data. Only UUID refs are permitted.
2. **Zero-Token Storage:** No client tokens, Meta system tokens, Notion integration keys, or database passwords can be written to:
   * Outbox events payload.
   * Ledger audit logs or error messages.
   * Debugging console logs (e.g. Pino, Winston).
3. **Workspace Isolation (RLS):** Every SELECT, UPDATE, or INSERT query targeting `policy_handoff_events` or parent ledger tables must strictly isolate the database session via the partitioning key `workspace_id`.
4. **Log Redaction:** Log entries must carry ONLY references: `correlation_id`, `event_id`, `content_variant_id`, and `workspace_id`. Raw post copies are scrubbed prior to writing to console outputs.

---

## 12. Downstream Handoff Integration to US-004

To ensure standard, robust integration, we specify how the downstream **Policy Engine (US-004)** will consume and process this handoff boundary:

1. **Queue Subscription:** The Policy Engine worker subscribes to the RabbitMQ queue bound to `policy.evaluate.requested`.
2. **Deduplication Check:** Upon receiving the event, US-004 extracts `eventId` and `contentVariantId` and performs deduplication checking. If a policy run is already active or finished, it sends an immediate ACK and exits.
3. **Context Resolution (Ledger Reload):**
   * The Policy Engine queries the Postgres Ledger using `contentVariantId` to load the exact generated variant (`body`, `hashtags`, `cta_url`) and `workspaceId` (safely loaded under RLS):
     ```sql
     SELECT body, hashtags, cta_url, policy_status 
     FROM content_variants 
     WHERE id = $1 AND workspace_id = $2;
     ```
   * If `policy_status` is not `pending_policy`, it aborts processing (prevents processing state overrides).
4. **Policy Transition:**
   * The Policy Engine atomically transitions `policy_status` to `policy_evaluating` (or similar US-004 specific status enum) before launching rule evaluations, keeping the Ledger status transparent to observers and SMM coordinators.
5. **Rule Evaluation:** US-004 performs content evaluation against rules (compliance, brand safety, formatting).

---

## 13. Verification Checklist

The following gates must be successfully validated before this boundary design is considered complete:

* [ ] **References-Only Payload Verified:** RabbitMQ event schema carries exclusively UUIDs and structural references, guaranteeing zero data leakage.
* [ ] **Outbox ACID Isolation Checked:** The `INSERT INTO policy_handoff_events` query is executed inside the exact same database transaction block as Transaction C (Success Persistence Path), ensuring ledger consistency.
* [ ] **Workspace Partitioning Validated:** RLS policies are applied to the outbox table (`policy_handoff_events`) and scoped strictly under `workspace_id`.
* [ ] **Deduplication Rules Enforced:** The composite unique index `uq_handoff_pending_variant_version` prevents redundant queue publications.
* [ ] **Fallback Path Observability Checked:** The Airtable sync retry state (`sync_retry_needed = true`) does not block policy execution, and is monitored via the audit payload `airtable_sync_pending_at_policy_handoff = true`.
* [ ] **Audit Taxonomy Covered:** Four discrete audit events are successfully registered in the Ledger audit logs.

---

## 14. Open Items & Next Steps

1. **Define Policy Engine Queue Binding:** Confirm the exact RabbitMQ exchange topology and queue bindings for the `policy.evaluate.requested` event in the infrastructure setup.
2. **Review Concurrency Limits:** Evaluate optimal concurrency parameters (prefetch count) for the downstream US-004 worker to handle high volumes of parallel policy evaluation requests safely.
