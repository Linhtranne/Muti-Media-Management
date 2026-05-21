# US-003 / T-003: Shared AI Contracts

## 1. Docs Read

This Shared AI Contracts document is designed and aligned strictly with the following 10 mandatory read documents, analyzed in required order:

1. **`docs/architecture/06_Architecture_Composability.md` (P0)**
   - **Extracted Constraints:** Confirms the boundary between layers. AI Composer belongs strictly to the *Orchestration & AI Middleware* layer. Platform API complexity and direct platform interactions must be isolated inside the *MCP Execution Plane*. Middleware cannot directly invoke Facebook Graph API, nor should it bypass the MCP tool contract.
2. **`docs/architecture/11_Coding_Convention.md` (P0)**
   - **Extracted Constraints:** Enforces TypeScript usage for services, sharing contracts via `packages/shared-contracts`, and implementing policies in `packages/policy-engine`. Ensures absolutely no raw tokens are written to logs, Slack, Airtable, or audit metadata. All database operations must be scoped by `workspace_id`.
3. **`docs/requirements/04_Product_Backlog.md` (P1)**
   - **Extracted Constraints:** Mapped out Epic E02 (AI Orchestration) and specifically US-003 (AI Composer Facebook Variant). Aligned with all Acceptance Criteria (AC1-AC4) and Business Rules (BR1-BR3) for this story.
4. **`docs/requirements/05_Function_Flow_Logic_Register.md` (P1)**
   - **Extracted Constraints:** Analyzed the draft specification for `FL-002` (AI Composer Facebook Variant) and mapped out exact transitional states. Evaluated `FL-001` (Airtable Post Approved Webhook) to establish correct starting dependencies.
5. **`docs/plans/US-002/US-002-final-implementation-notes.md` (P2)**
   - **Extracted Constraints:** Mapped out the workflow stub creation (`workflow_runs`), server-side versioning (`approved_version`), zero-trust reload logic, safe `channel_account_refs`, and Postgres RLS.
6. **`docs/plans/US-002/US-002-shared-event-and-ledger-contracts.md` (P2)**
   - **Extracted Constraints:** Synced with event envelope schemas, webhook signal definitions, and safe stubs representing target accounts (`SafeChannelAccountRef`).
7. **`docs/plans/US-002/US-002-workflow-stub-creation.md` (P2)**
   - **Extracted Constraints:** Inherited safe `channel_account_refs`, composite unique indexes, and Transaction B concurrency boundaries.
8. **`docs/plans/US-003/PLAN-us-003-ai-composer-facebook-variant.md` (P2)**
   - **Extracted Constraints:** Analyzed the original work-breakdown structure, dependency routing, key risks, and tasks `T-001` to `T-013`.
9. **`docs/plans/US-003/US-003-scope-lock.md` (P2)**
   - **Extracted Constraints:** Locked the boundaries of US-003 strictly to AI draft variant generation.
10. **`docs/plans/US-003/US-003-ai-ledger-schema-and-idempotency.md` (P2)**
    - **Extracted Constraints:** Additive schemas, composite unique keys, transaction locks, and error taxonomy for AI generation runs and content variants.

---

## 2. Objective

The primary objective of **US-003 / T-003** is to design the physical TypeScript contracts, data models, validation schemas, and error types for the AI Composer. These contracts establish a uniform, frozen specification shared across:
1. **`packages/shared-contracts`** (the central repository of schemas).
2. **Worker Claim Flow (T-004)** (the job processing flow).
3. **Context Loading (T-005)** (Airtable + Notion loader boundaries).
4. **Prompt Templates (T-006)** (the AI engine system-input templates).
5. **Structured Output and Validation (T-007)** (runtime Zod schema + intent/UTM semantic evaluators).
6. **Persistence and Update (T-009)** (Ledger database commits + Airtable writes).

This is a **document-based contract design specification**. No runtime JavaScript or SQL migration is executed in this step; it serves to lock down compile-time typings and runtime shapes.

---

## 3. Contract Scope

### In Scope
- Designing shared TypeScript typings and interfaces for:
  - Enums mapping execution status, workflow state extensions, and variant status.
  - Workflow run claim inputs and outputs.
  - AI Generation Run audit records (`ai_generation_runs` equivalents).
  - Source context input snapshots (`AiInputSnapshot`).
  - Notion campaign brief and guideline context references (`NotionContextRef`).
  - Structured output schemas from the LLM adapter.
  - Persistent content variant entities (`content_variants` equivalents).
  - Centralized Error Taxonomy codes (`AiErrorCode`).
- Specifying concrete validation constraints (body limits, hashtag formats, target channel scopes).
- Specifying business validation utilities (UTM/CTA parameter matching, hashtag normalization).
- Defining strict compile-time and runtime validation boundaries for credentials (Forbidden Fields).
- Defining rules for contract schema evolution.

### Out of Scope
- Designing contracts for the publish engine (`publish_jobs` or social media publishing events).
- Designing MCP tool call inputs/outputs or Meta Graph API integration schemas.
- Incorporating an "approved" status into the content variant approval workflow (AI must remain draft-only).
- Passing large raw text bodies inside the RabbitMQ claim queue events (must use reference-based identifiers).
- Mutating or incrementing the `approved_version` allocated by the US-002 workflow stub.

---

## 4. Design Principles

Our API and type contracts are guided by five core architectural tenets:
1. **Fail-Closed Security:** System interfaces must enforce zero trust. Security, schema, model configuration, and business verification failures block publishing and move the workflow into the mapped Ledger failure state. Optional Notion outages may use the agreed Airtable Campaign Objective fallback only when the fallback is explicitly recorded in `NotionContextRef`.
2. **Workspace Isolation:** Every data interface and query boundary must carry a non-nullable `workspace_id`. Tenant boundaries are strict and enforced via compile-time typings and Row-Level Security (RLS).
3. **Zero Credential Leaks:** Typings must explicitly exclude API keys, tokens, OAuth scopes, or vault paths. Metadata snapshots carry references only.
4. **Resiliency over Rigidness (Normalization):** Rather than throwing terminal errors on minor LLM formatting inaccuracies, our interfaces specify a post-generation normalization layer (e.g. hashtag sanitization).
5. **Traceability:** Correlation IDs, prompt versions, and causation tracking must be embedded in all processing contracts to ensure an auditable trace from Airtable webhook signals to generated variants.

---

## 5. Shared Type Locations

To ensure strict compliance with `docs/architecture/11_Coding_Convention.md`, all shared typings will be physically implemented in `packages/shared-contracts` under a structured module tree:

```text
packages/
  shared-contracts/
    src/
      ai/
        enums.ts                    # AiGenerationStatus, ContentVariant enums
        claims.ts                   # ClaimAiWorkflow Input & Output
        snapshots.ts                # AiInputSnapshot context types
        notion.ts                   # NotionContextRef refs and fallbacks
        composer.ts                 # StructuredComposerOutput shape
        variants.ts                 # ContentVariant entity
        errors.ts                   # AiErrorCode and taxonomic types
      validation/
        guards.ts                   # Forbidden fields list & runtime rejector
        helpers.ts                  # Zod shapes & business utilities
      index.ts                      # Clean entrypoint exports
```

---

## 6. Workflow Claim Contracts

When a worker claims a workflow run ready for AI generation, it interacts with Transaction boundaries using these typed inputs and outputs:

### Safe Channel Account Reference (from US-002/T-008)
Represents a token-free display and routing reference of target social platform accounts:
```ts
export interface SafeChannelAccountRef {
  platform: "Facebook";                         // Inherited Airtable/US-002 channel label
  channel_account_id: string;                   // Postgres UUID referencing channel_accounts.id
  airtable_channel_account_record_id: string;   // Physical Airtable record ID
  external_account_id?: string;                 // Safe external account/page identifier
  token_status?: "valid" | "expired" | "missing" | "unknown"; // Token-free account health metadata
}
```

### Claim AI Workflow Input
Input payload used to atomically claim a workflow run from the pending status pool:
```ts
export interface ClaimAiWorkflowInput {
  workspace_id: string;                       // Mandatory tenant boundary
  workflow_run_id: string;                     // UUID targeting target run
  expected_status: "pending_ai_generation";     // Guard state assertion
  correlation_id: string;                     // Distributed trace identifier
}
```

### Claim AI Workflow Output
Returned data upon successfully acquiring the exclusive row lock on the workflow stub:
```ts
export interface ClaimAiWorkflowOutput {
  workflow_run_id: string;
  workspace_id: string;
  airtable_record_id: string;                 // Points to Airtable target record
  approved_version: number;                   // Server-side allocated read-only version
  channel_account_refs: SafeChannelAccountRef[]; // Safe stubs allocated in US-002
  status: "ai_generation_processing";         // Transitional state confirmation
}
```

---

## 7. Source Context Snapshot Contracts

The `AiInputSnapshot` defines the exact structured JSON schema committed to the operational Ledger. It represents the point-in-time state of Airtable post data, campaigns, and versions loaded at processing time.

```ts
export interface AiInputSnapshot {
  post: {
    post_id: string;                          // Primary field text reference
    airtable_record_id: string;               // Physical record key
    title?: string;                           // Nullable plain text title
    master_copy: string;                      // Core text body to compose from
    cta_url?: string;                         // Nullable target CTA URL
    asset_links?: string[];                   // List of attached media asset links
    target_channels: ["Facebook"];            // Hard-locked target channels list
    scheduled_at?: string;                    // ISO8601 GMT-locked date string
    approved_at?: string;                     // ISO8601 Webhook approval time
  };
  campaign?: {
    campaign_id?: string;                     // Campaign primary identifier
    name?: string;                            // Campaign name
    objective?: string;                       // Campaign objectives text
    notion_brief_url?: string;                // Campaign link to retrieve context from
  };
  workflow: {
    workflow_run_id: string;
    approved_version: number;                 // Immutable version marker
  };
}
```

---

## 8. AI Generation Run Contracts

The operational ledger tracks LLM invocations using the `AiGenerationRun` object. It maps directly to columns in the `ai_generation_runs` table:

```ts
export interface AiGenerationRun {
  id: string;                                 // UUID primary key
  workspace_id: string;                       // Strict tenant scoping
  workflow_run_id: string;                     // Link to target workflow run
  airtable_record_id: string;                 // Linked post record reference
  approved_version: number;                   // Read-only server-side version
  platform: "facebook";                       // Hard-locked to facebook
  idempotency_key: string;                    // Formulated idempotency string
  provider: string;                           // Configured LLM provider identifier
  model: string;                              // Configured LLM model identifier
  prompt_version: string;                     // Prompt template semantic version
  input_snapshot: AiInputSnapshot;            // Sanitized input payload
  notion_context_refs: NotionContextRef[];    // References of documents used
  output_snapshot?: StructuredComposerOutput; // Validated LLM output (if completed)
  status: AiGenerationStatus;                 // Operational Ledger Status
  error_code?: AiErrorCode;                   // Nullable error code
  error_message?: string;                     // Sanitized diagnostic string
  created_at: string;                         // Timestamptz string (ISO8601)
  completed_at?: string;                      // Timestamptz string (ISO8601)
}
```

---

## 9. Workflow Run Status Extensions

We define four custom enums representing the states of processing, execution progress, and draft variant controls:

```ts
/**
 * Tracing status of the execution ledger run
 */
export type AiGenerationStatus =
  | "queued"                  // Run registered in database ledger
  | "processing"              // Prompt built and LLM request in-flight
  | "completed"               // Valid structured output parsed and saved
  | "needs_manual_review"     // Output exists, but failed business checks (intent/UTM/CTA)
  | "retryable_failed"        // Temporary failure (rate limit, timeout) awaiting retry
  | "failed";                 // Permanent failure requiring developer/admin fix

/**
 * AI Processing status applied to the parent workflow run (workflow_runs.status)
 */
export type WorkflowRunAiStatus =
  | "pending_ai_generation"      // Initial status created by US-002
  | "ai_generation_processing"   // claimed by AI worker and actively invoking provider
  | "ai_generation_completed"    // Variant generated, validated, persisted, and synced
  | "ai_generation_failed";      // Terminal failure of AI generation run (blocks publishing)
```

---

## 10. Notion Context Reference Contracts

When loading Campaign guidelines from Notion, security and data integrity require that **no raw body content** is saved to the Ledger. Instead, the `NotionContextRef` stores only high-fidelity metadata audit traces, modified specifically to track fallback paths:

```ts
export type NotionContextLoadStatus =
  | "loaded"          // Page parsed successfully and passed into the prompt boundary
  | "fallback_used"   // Notion API failed or is missing; fallback used (Campaign Objective)
  | "failed";         // Terminal parsing / allowlist check failure

export type NotionContextErrorType =
  | "CONTEXT_UNREACHABLE"       // HTTP timeouts or API failures
  | "NOTION_NOT_ALLOWLISTED"   // Notion domain mismatch (security block)
  | "NOTION_NOT_AI_READY";     // Missing standard page structure or properties

export interface NotionContextRef {
  page_id: string;                                    // Physical page UUID or "notion_page_id_or_unknown"
  title?: string;                                     // Page title
  source_url?: string;                                // Clean URL string pointing to source
  last_edited_at?: string;                            // ISO8601 edit timestamp
  context_type:
    | "campaign_brief"
    | "brand_guideline"
    | "content_guideline"
    | "legal_note";
  ai_ready?: boolean;                                 // Security verification flag
  load_status: NotionContextLoadStatus;               // Ingress loading outcome
  error_code?: NotionContextErrorType;                // Nullable error code for debugging
  fallback_source?: "airtable_campaign_objective";    // Explicit indicator of fallback context
}
```

---

## 11. Structured Composer Output Contract

The JSON output returned by the LLM Provider adapter is parsed against this structural contract:

```ts
export interface StructuredComposerOutput {
  body: string;                               // Clean composed draft copy
  hashtags: string[];                         // Normalized tag strings (starts with '#')
  cta_url?: string;                           // Nullable CTA URL
}
```

---

## 12. Content Variant Contract

If the generation run succeeds and passes structured validation checks, a child content variant record is saved to the database:

```ts
export type ContentVariantApprovalStatus =
  | "needs_review"                            // Initial state for all generated variants
  | "rejected";                               // Flagged by manual check or policy engine later

export type ContentVariantPolicyStatus =
  | "pending_policy";                         // Initial state, ready for US-004 Policy Engine

export interface ContentVariant {
  id: string;                                 // UUID primary key
  workspace_id: string;                       // Strict tenant scoping
  ai_generation_run_id: string;               // Links to parent execution run
  workflow_run_id: string;                     // Links to target workflow run
  airtable_record_id: string;                 // Reference Airtable record ID
  post_id: string;                            // Airtable primary record identifier
  platform: "facebook";                       // Hard-locked target platform
  body: string;                               // Safe copy text
  hashtags: string[];                         // Validated, normalized tag strings
  cta_url?: string;                           // Safe CTA URL
  approval_status: ContentVariantApprovalStatus;
  policy_status: ContentVariantPolicyStatus;
  created_at: string;                         // Timestamptz commitment time
}
```

> [!IMPORTANT]  
> The status value `"approved"` is strictly **bypassed** and **excluded** from `ContentVariantApprovalStatus`. Under the zero-bypass policy, the AI Composer is strictly restricted to draft variant creation. Only human reviewers or designated downstream ledger handlers have authorization to set approval flags.

---

## 13. Error Taxonomy Contract

System and provider exceptions must map to standardized, non-leaking taxonomy codes. These classifications allow workers to isolate retryable transient errors from terminal failures:

```ts
export type AiErrorCode =
  | "PROVIDER_RATE_LIMIT"       // LLM Provider returned HTTP 429 / quota limit
  | "PROVIDER_TIMEOUT"          // LLM Provider request timed out
  | "CONTEXT_UNREACHABLE"       // Notion/Airtable API lookup timed out or failed (HTTP 5xx)
  | "SCHEMA_PARSING_FAILED"     // LLM response failed basic JSON / Zod schema checks
  | "INTENT_DRIFT"              // Business check: Variant deviated too far from source copy
  | "CTA_UTM_MUTATED"           // Business check: UTM parameters altered, stripped, or added
  | "PROMPT_INJECTION_DETECTED" // Security block: String check caught instruction overrides
  | "INVALID_MODEL_CONFIG";     // System error: Unsupported model params or templates
```

---

## 14. Hashtags Normalization Utility Contract

Rather than failing the entire workflow due to small formatting variances from the LLM, the shared contracts design establishes a permissive post-processing normalizer:

```ts
export interface HashtagNormalizationOptions {
  maxHashtags?: number;      // Default to 10
  forceLowercase?: boolean;  // Optional case-matching
}

export interface HashtagNormalizationResult {
  normalizedHashtags: string[];
  warnings?: string[];
  isFailed: boolean;         // True if the array contains severely corrupted data
}

/**
 * Normalization Algorithm Contract:
 * 1. Trim leading and trailing whitespace from each item.
 * 2. Prepend '#' if the hashtag is missing the prefix.
 * 3. Remove duplicate items.
 * 4. Truncate array to max 10 elements.
 * 5. Reject (isFailed = true) if any item is empty or contains whitespace.
 */
export function normalizeHashtags(
  rawHashtags: string[],
  options?: HashtagNormalizationOptions
): HashtagNormalizationResult;
```

---

## 15. UTM / CTA Validation Utility Contract

Following the user's decision to decouple business-level validation from basic structural Zod schemas, the UTM/CTA parameter validation is defined as an isolated utility contract:

```ts
export type CtaValidationStatus =
  | "VALID"                  // URL parsed cleanly and UTM parameters match exactly
  | "CTA_URL_INVALID"        // URL is malformed or failed standard parser structures
  | "CTA_URL_MISSING"        // CTA URL is present in source, but missing in variant output
  | "CTA_UTM_MUTATED";       // UTM query parameters were added, modified, or removed

export interface CtaValidationResult {
  status: CtaValidationStatus;
  details?: string;          // Detailed mismatch diagnostic description
}

/**
 * UTM Preservation Rules:
 * 1. If source cta_url is undefined, generated cta_url must be undefined (or empty).
 * 2. If source cta_url is present, generated cta_url is required.
 * 3. Both URLs must parse cleanly into native URL objects.
 * 4. Extracted query parameter sets must be compared. Every key-value pair in source
 *    must exist exactly as-is in the generated URL.
 * 5. Mismatches, deletions, or unauthorized additions of parameters triggers "CTA_UTM_MUTATED".
 */
export function validateCtaUtmMatch(
  sourceUrl?: string,
  generatedUrl?: string
): CtaValidationResult;
```

---

## 16. Forbidden Fields Contract Guard

To guarantee absolute compliance with the zero-token leakage policies, all shared contracts must implement compile-time type omissions and runtime rejectors:

### Compile-Time Omission Guard
Typings must explicitly prevent the inclusion of the following security-sensitive properties:
```ts
// Compile-time assertion: Assert that key strings are omitted from objects
export type SecureInputSnapshot<T> = Omit<
  T,
  | "access_token"
  | "refresh_token"
  | "app_secret"
  | "provider_api_key"
  | "airtable_api_key"
  | "slack_token"
  | "secret_ref"
>;
```

### Runtime Security Scanner
```ts
export const BANNED_KEYS = [
  "access_token",
  "refresh_token",
  "app_secret",
  "provider_api_key",
  "airtable_api_key",
  "slack_token",
  "secret_ref"
] as const;

export interface SanitizationResult {
  isValid: boolean;
  detectedKeys: string[];
}

/**
 * Runtime Guard:
 * Recursively scans input_snapshot, output_snapshot, notion_context_refs, and error_message.
 * If any key string matches BANNED_KEYS or value contains "vault://" or "bearer ",
 * returns isValid = false and prevents database write operations.
 */
export function scanForSensitiveFields(obj: unknown): SanitizationResult;
```

---

## 17. Schema Evolution Rules

To manage downstream modifications smoothly, these shared AI contracts must adhere to three strict evolution guidelines:
1. **Additive Compatibility:** No existing required field may be deleted or renamed in-place. If an entity requires modifications (e.g., supporting a new social channel), the new fields must be marked optional (`?`) in V1.
2. **Version Discriminated Typings:** If a breaking payload change is unavoidable, the contract version must be updated. Data models must leverage discriminated unions keying off `event_version` or `prompt_version` to keep older entities parsable.
3. **Fail-Closed Defaulting:** If an evolutionary field is missing in older persisted records, the validation schemas must default to safe, closed values (e.g. defaulting to `approval_status: "needs_review"` and `load_status: "failed"`).

---

## 18. Verification Checklist

- [x] All TypeScript contract interfaces have been defined conceptually in markdown blocks.
- [x] Every database-linked contract includes the non-nullable partitioning field `workspace_id`.
- [x] The `approved_version` field is represented as an immutable read-only integer inherited from US-002.
- [x] Typings for `SafeChannelAccountRef` are clean and include only non-credential metadata references.
- [x] Custom enums (`AiGenerationStatus`, `WorkflowRunAiStatus`, `ContentVariantApprovalStatus`, `ContentVariantPolicyStatus`) are accurately represented.
- [x] The status string `"approved"` is completely excluded from all AI composer contracts.
- [x] Notion references `NotionContextRef` are extended with `load_status`, `error_code`, and `fallback_source` as agreed in the Socratic Gate, and contain absolutely no raw context bodies.
- [x] Zod parsing boundaries are restricted to basic structural shape checking.
- [x] The business-critical UTM/CTA parameter validation is decoupled into a dedicated `validateCtaUtmMatch` utility contract returning `CTA_UTM_MUTATED` on parameter drift.
- [x] Hashtags contract is supplemented with the permissive, deduplicating `normalizeHashtags` contract.
- [x] Strict Forbidden Fields are listed, and both compile-time and runtime sanitization bounds are mapped.
- [x] Schema evolution principles are documented to guide future model releases.

---

## 19. Handoff to T-004/T-005/T-006/T-007

This Shared AI Contracts specification provides a complete blueprint for the downstream tasks:

- **Handoff to T-004 (Worker Flow):**
  - Implement `ClaimAiWorkflowInput` and `ClaimAiWorkflowOutput` within the transactional update sequence.
  - Coordinate the transitions of `workflow_runs.status` based on `WorkflowRunAiStatus` outcomes.
- **Handoff to T-005 (Context Loading):**
  - Construct the zero-trust loading boundary. When loading Notion URLs, format the retrieved page metadata as a `NotionContextRef` record.
  - If Notion context loading fails, record `load_status: "fallback_used"`, write the corresponding `error_code`, set `fallback_source: "airtable_campaign_objective"`, and pass only Campaign Objective from Airtable.
- **Handoff to T-006 (Prompt Templates):**
  - Utilize the safe fields defined in `AiInputSnapshot` to build prompt templates. Ensure untrusted guidelines retrieved from Notion are wrapped inside strict XML boundaries.
- **Handoff to T-007 (Structured Output and Validation):**
  - Implement Zod schema boundaries mapping `StructuredComposerOutput` to enforce shape constraints.
  - Write concrete implementations of `normalizeHashtags` and `validateCtaUtmMatch` to safeguard output consistency and UTM parameters without corrupting the worker queue.
