# AI-SDLC Retrofit Header for US-003

status: approved

## Goal

Maintain US-003 behavior for AI Composer Facebook Variant Generation according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-003` passes after retrofit artifacts are present.

# US-003 / T-008: AI Provider Adapter and Retry Policy Design

## 1. Docs Read

This AI Provider Adapter and Retry Policy specification is strictly integrated with the following 12 project documents, analyzed in mandatory order:

1. **`docs/architecture/06_Architecture_Composability.md` (P0)**
   - **Extracted Constraints:** Confirms the boundary between the *Orchestration & AI Middleware* layer (where the AI Composer lives) and the *MCP Execution Plane* (where direct platform APIs are isolated). The adapter must be agnostic, handling LLM connectivity without direct exposure to publishing networks or downstream platforms.
2. **`docs/architecture/11_Coding_Convention.md` (P0)**
   - **Extracted Constraints:** Enforces TypeScript usage, zero-token logging boundaries, and safe database boundaries partitioned strictly by `workspace_id`.
3. **`docs/requirements/04_Product_Backlog.md` (P1)**
   - **Extracted Constraints:** Aligned with Epic E02 (AI Orchestration) and US-003 (AI Composer Facebook Variant) Acceptance Criteria (AC1-AC4) and Business Rules (BR1-BR3).
4. **`docs/requirements/05_Function_Flow_Logic_Register.md` (P1)**
   - **Extracted Constraints:** Aligned with `FL-002` (AI Composer) transition states and error paths.
5. **`docs/plans/US-003/PLAN-us-003-ai-composer-facebook-variant.md` (P1)**
   - **Extracted Constraints:** Governs the overall work breakdown structure of US-003, highlighting T-008 as the abstraction layer separating model API mechanics from business flow execution.
6. **`docs/plans/US-003/US-003-scope-lock.md` (P1)**
   - **Extracted Constraints:** Reinforces draft-only boundaries for AI copy. Excludes and blocks the status `"approved"` inside all AI contracts.
7. **`docs/plans/US-003/US-003-ai-ledger-schema-and-idempotency.md` (P2)**
   - **Extracted Constraints:** Registers runs in `ai_generation_runs` and maps transient errors to `retryable_failed` status in the operational Ledger.
8. **`docs/plans/US-003/US-003-shared-ai-contracts.md` (P2)**
   - **Extracted Constraints:** Standardizes taxonomy codes (`AiErrorCode`) and specifies compile-time and runtime Forbidden Fields boundaries (`ScanForSensitiveFields`).
9. **`docs/plans/US-003/US-003-ai-composer-worker-flow.md` (P2)**
   - **Extracted Constraints:** Coordinates database row-level locking (Transaction A), separation of external I/O from active transactions, and non-blocking RabbitMQ ACK/NACK semantics.
10. **`docs/plans/US-003/US-003-context-loading-boundary.md` (P2)**
    - **Extracted Constraints:** Integrates allowlisted Notion brief retrieval and Campaign Objective fallbacks.
11. **`docs/plans/US-003/US-003-prompt-template-and-versioning.md` (P2)**
    - **Extracted Constraints:** Hydrates system/user prompts within clean XML security delimiters.
12. **`docs/plans/US-003/US-003-structured-output-validation.md` (P2)**
    - **Extracted Constraints:** Decouples structural Zod checking and UTM/CTA preservation checks from the provider adapter, establishing T-007 as the single validation source of truth.

### Specialist Knowledge Applied:
* **`C:\Users\Hi\.spawner\skills\ai\llm-architect\skill.yaml` & `sharp-edges.yaml`**: Defined provider-agnostic interfaces, native structured format switches, timeout controls, and robust error sanitization routines.
* **`C:\Users\Hi\.spawner\skills\backend\api-design\skill.yaml` & `sharp-edges.yaml`**: Designed clean API signatures, rate limit mapping, backoff strategies, and error taxonomies.
* **`C:\Users\Hi\.spawner\skills\backend\queue-workers\skill.yaml` & `sharp-edges.yaml`**: Structured retry boundaries to align with RabbitMQ ACK patterns, preventing hot CPU loops and consumer starvation.

---

## 2. Objective

The primary objective of **US-003 / T-008** is to design the robust **AI Provider Adapter and Retry Policy** specification for the AI Composer Facebook Variant.

This specification establishes a clean, unified, and highly resilient interface (`AiProviderAdapter`) that isolates the AI Composer worker flow from the internal details of configured LLM Provider APIs. It defines:
1. **Agnostic Contracts:** Standardized TypeScript interfaces for inputs, successful generation outputs, and sanitized failure outcomes.
2. **Model Boundary Rules:** Secure configuration resolution that prevents hardcoding, validating schemas, and failing fast with `INVALID_MODEL_CONFIG` on config defects.
3. **Structured Ingress Strategy:** Activating native provider JSON mode while leaving schema and semantic validations strictly to the downstream **T-007** boundary.
4. **Resilience Policies:** Implementing 30-second request timeouts, exponential backoff with full randomized jitter, and a per-provider tenant-isolated circuit breaker to prevent thundering herd queue stampedes.
5. **Zero-Token Telemetry:** Standardized error mapping and a secure regex redactor that sanitizes network error bodies before logging, ensuring absolutely zero API key or bearer token leaks.
6. **Mock Provider Mode:** A deterministic test fixture handler allowing comprehensive downstream testing without invoking live, non-deterministic LLM APIs.

---

## 3. Adapter Scope

### In Scope
- Designing the provider-agnostic TypeScript contract interfaces: `AiProviderAdapter`, `AiProviderGenerateInput`, `AiProviderGenerateResult`, `AiProviderSuccessResult`, and `AiProviderFailureResult`.
- Specifying the **Model Configuration Boundary** which validates provider settings and environment-sourced API keys, failing fast with `INVALID_MODEL_CONFIG`.
- Specifying native **Structured Output Activation** (e.g. `response_format: { type: "json_object" }` or equivalent schema modes) depending on model configuration.
- Designing the **Timeout Policy** using strict 30-second AbortController network caps.
- Designing the **Active Retry Policy** with **Exponential Backoff and Full Jitter** for transient exceptions (`PROVIDER_RATE_LIMIT`, `PROVIDER_TIMEOUT`, and transient HTTP 5xx/network errors).
- Aligning retries with the **T-004 Queue Worker ACK Policy**, committing retryable states to the Postgres Ledger before ACK-ing current deliveries and scheduling delayed retries via the broker scheduler.
- Designing the **Circuit Breaker Policy** (per provider + workspace) to fail-fast during prolonged outages, protecting upstream systems.
- Designing the **Sanitized Error Mapping Matrix** which strips headers, tokens, and system paths, converting raw exceptions into standardized `AiErrorCode` types.
- Specifying the **Mock Provider Fixture Mode** to read deterministic golden files in local development and testing environments.

### Out of Scope
- Performing live LLM HTTP requests or configuring live SDKs in this design task.
- Invoking the Meta/Facebook Graph API or social media publishing engines.
- Executing database persistence inside the adapter itself (the adapter returns results; the worker flow **T-004** and persistence layer **T-009** commit data to the Ledger).
- Running Zod schema validations, hashtag normalization, or semantic UTM matches (these belong exclusively to the **T-007 Validation Engine**).
- Persisting API keys, bearer tokens, or secret vault values inside the Ledger or system log files.

---

## 4. Provider-Agnostic Interface

The adapter isolates external provider dependencies behind a single TypeScript contract interface, ensuring the AI worker remains unaffected by changes to underlying SDKs.

```ts
import { AiErrorCode } from "./errors"; // From US-003 Shared Contracts (T-003)

/**
 * High-fidelity token-free configuration reference.
 * Resolves to actual API credentials securely in memory.
 */
export interface SecureProviderConfigRef {
  provider_config_id: string;                 // Postgres UUID pointing to provider_configs
  provider: string;                           // Supported provider identifier from validated config
  model: string;                              // Configured model identifier from validated config
  temperature?: number;                       // Range 0.0 to 2.0 (optional)
  top_p?: number;                             // Optional sampling parameter
  max_tokens?: number;                        // Optional token ceiling
  enable_native_json?: boolean;               // Enable structured JSON output if supported
}

/**
 * Standard input payload accepted by the AI Provider Adapter.
 * Scoped by workspace and correlation IDs for distributed tracing.
 */
export interface AiProviderGenerateInput {
  workspace_id: string;                       // Tenant partition boundary
  workflow_run_id: string;                     // Links execution to workflow run
  correlation_id: string;                     // Distributed trace correlation identifier
  prompt_version: string;                     // Semantic version of the template used
  system_prompt: string;                      // Fully hydrated, security-isolated system instructions
  user_prompt: string;                        // Fully hydrated, XML-delimited user prompt
  provider_config_ref: SecureProviderConfigRef; // Validated token-free model configurations
  timeout_ms?: number;                        // Default to 30,000ms
}

/**
 * Token metrics payload returned upon successful generation.
 */
export interface AiTokenUsage {
  prompt_tokens: number;                      // Number of tokens consumed in request
  completion_tokens: number;                  // Number of tokens produced in output
  total_tokens: number;                       // Total transaction tokens
}

/**
 * Success outcome contract returned by the adapter.
 * Contains the raw text and safe metadata.
 */
export interface AiProviderSuccessResult {
  success: true;
  provider: string;                           // Configured provider identifier
  model: string;                              // Configured model identifier
  raw_output: string;                         // Raw, unvalidated LLM output string
  usage?: AiTokenUsage;                       // Token consumption statistics (if provided by LLM)
  latency_ms: number;                         // Complete HTTP request roundtrip time
  provider_trace_id?: string;                 // Safe provider-returned execution ID (token-free)
}

/**
 * Failure outcome contract returned by the adapter.
 * Maps raw provider errors to safe, standardized taxonomy codes.
 */
export interface AiProviderFailureResult {
  success: false;
  error_code: AiErrorCode;                    // Standardized system taxonomy enum
  sanitized_error_message: string;            // Clean, non-leaking diagnostic message
  retryable: boolean;                         // True if failure is temporary (Timeout, 429, 5xx)
  latency_ms: number;                         // Roundtrip time before failure occurred
  provider_trace_id?: string;                 // Safe provider-returned trace ID (if available)
}

/**
 * Union result shape returned by the generate method.
 */
export type AiProviderGenerateResult = AiProviderSuccessResult | AiProviderFailureResult;

/**
 * Unified, provider-agnostic adapter interface.
 * Implemented by concrete provider handlers (OpenAI, Anthropic, Google, Mock).
 */
export interface AiProviderAdapter {
  /**
   * Invokes the target AI model with the safe prompt payload.
   * Enforces timeouts, handles transient retries, maps errors, and redacts tokens.
   */
  generate(input: AiProviderGenerateInput): Promise<AiProviderGenerateResult>;
}
```

---

## 5. Model Configuration Boundary

To prevent unauthorized model sprawl and protect the security perimeter, the adapter enforces a strict **Model Configuration Boundary** prior to initiating any network connection:

### Configuration Validation sequence
1. **Workspace Scope Lock:** The incoming `provider_config_ref` must match the `workspace_id` from the input payload. The system must verify that this workspace is authorized to utilize the specified provider and model.
2. **Missing/Malformed Config:** If the `SecureProviderConfigRef` is undefined, contains an unsupported provider/model, or references a missing database configuration row, the adapter immediately halts execution.
3. **Secret Store Resolution:** The adapter retrieves the API credentials (API key, endpoint, organization ID) from the system's secure environment or a vaulted manager in memory. 
4. **Credential Presence Verification:** If the credentials required to invoke the API are missing or empty in memory, the adapter must not proceed.
5. **Fail-Closed Outcome:** For any validation anomaly during this boundary check, the adapter **fails closed immediately**, returning:
   - `error_code`: `"INVALID_MODEL_CONFIG"`
   - `sanitized_error_message`: *"Model configuration for workspace is invalid or missing required API keys."*
   - `retryable`: `false`
   - `latency_ms`: `0`
   - **Persistence Hook:** This terminal failure prevents unnecessary API requests and alerts system administrators via the ledger.

---

## 6. Prompt Input Contract

The prompt input contract defines the safe, non-leaking inputs prepared by upstream templates (**T-006**) and loaded contexts (**T-005**) that are received by the provider adapter:

```ts
export interface AiPromptInputPayload {
  workspace_id: string;                       // Strict tenant scoping
  workflow_run_id: string;                     // Reference workflow run id
  correlation_id: string;                     // Distributed causality tracker
  prompt_version: string;                     // Active prompt registry version
  
  // Clean instructions, fully resolved, devoid of vault credentials or tokens
  system_prompt: string;                      // System instruction template
  user_prompt: string;                        // XML-bounded user context briefing
  
  timeout_ms: number;                         // Configured execution timeout (30,000ms default)
}
```

---

## 7. Provider Request Contract

The provider request contract outlines the physical, non-leaking structure compiled by concrete adapter instances before invoking the underlying LLM Provider SDKs or HTTP endpoints:

```ts
/**
 * Unified representation of the payload transmitted to provider endpoints.
 * All keys and organization secrets are injected at runtime in memory, never serialized in data objects.
 */
export interface ProviderHttpRequestPayload {
  url: string;                                // Clean model endpoint URL
  headers: {
    "Content-Type": "application/json";
    // Authorization and provider credentials are injected by the HTTP client from secret memory.
    // They must not be represented in serializable request payload objects or logs.
  };
  method: "POST";
  body: {
    model: string;                            // Configured model identifier
    messages: [
      { role: "system"; content: string },    // Ingests system_prompt
      { role: "user"; content: string }       // Ingests user_prompt (xml enclosed Notion/Airtable data)
    ];
    temperature: number;                      // Resolved from SecureProviderConfigRef (default 0.7)
    top_p?: number;                           // Optional sampling param
    max_tokens?: number;                      // Hard token ceiling (default 1000)
    
    // Injected only when native JSON mode is configured
    response_format?: {
      type: "json_object";
    };
  };
}
```

---

## 8. Provider Response Contract

The provider response contract defines the raw network payload returned by LLM endpoints, representing the starting point for adapter mapping and redaction sequences:

```ts
/**
 * Generic shape of successful provider responses before sanitization and mapping
 */
export interface ProviderRawHttpResponse {
  id: string;                                 // E.g., "chatcmpl-12345"
  object: "chat.completion";
  created: number;
  model: string;                              // Verifies model utilized
  choices: [
    {
      index: number;
      message: {
        role: "assistant";
        content: string;                      // Raw output JSON string containing variant draft
      };
      finish_reason: "stop" | "length" | "content_filter" | null;
    }
  ];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  headers?: Record<string, string>;           // Raw headers parsed to read safe trace IDs and rate limits
}
```

---

## 9. Structured Output Mode Strategy

To maximize the probability of receiving clean, structured JSON from the model, the adapter dynamically configures Native JSON Mode depending on provider capabilities:

```
                            AI WORKER EXECUTING T-004
                                       │
                                       ▼
                       ┌──────────────────────────────┐
                       │  Context Load & Prompt Built  │
                       └───────────────┬──────────────┘
                                       │
                         Does Model Config enable JSON?
                         ├── YES ──► Configure native JSON mode parameters
                         │           (e.g., response_format: { type: "json_object" })
                         │
                         └── NO  ──► Configure standard chat body
                                       │
                                       ▼
                       ┌──────────────────────────────┐
                       │  Adapter Invokes LLM API     │
                       └───────────────┬──────────────┘
                                       │
                         Did API call execute successfully?
                         ├── YES ──► Return raw string in success payload
                         │           (Leave Zod parse & UTM checks to T-007)
                         │
                         └── NO  ──► Map to transient/terminal AiErrorCode
```

### Strategy Principles
1. **Native Activation:** 
   - **Providers with Native JSON Mode:** If the configured provider/model supports JSON output, the adapter injects the provider-specific structured output option.
   - **Providers without Native JSON Mode:** If JSON mode is not natively supported, the adapter relies on strict prompt formatting guidelines and system prompt directives without raising configuration exceptions.
2. **Strict Decoupling from Validation:**
   - The adapter **must not** run Zod validations, hashtag normalizations, or semantic CTA matching. 
   - If the model returns a raw, unparseable non-JSON string, the adapter **does not raise an error** at the transport layer. It packages the raw string into `raw_output` and returns a successful `AiProviderSuccessResult` payload.
   - Decoupling ensures that structural validation errors are isolated at the **T-007 Validation Engine** boundary, allowing them to map cleanly into manual review states (`needs_manual_review`) in the Ledger rather than being treated as transient transport failures.

---

## 10. Timeout Policy

To safeguard worker execution pools and prevent database connection starvation (as connection pools are released during remote API calls), the adapter enforces a hard request timeout limit:

### Timeout Specification
- **Default Limit:** **30,000ms** (aligned with the T-004 worker flow).
- **Implementation Mechanism:** The adapter implements a strict promise race utilizing the native JavaScript `AbortController` API to terminate the HTTP socket directly.
- **Handling Sequence:**
  1. The adapter instantiates an `AbortController` and starts the HTTP request, passing the controller's `signal`.
  2. A local timer is set for the designated `timeout_ms`.
  3. If the API request resolves before the timer expires, the timer is cleared and the result is returned.
  4. If the timer expires before the API resolves:
     - The adapter invokes `controller.abort()`, forcing the socket to close immediately and freeing up runtime threads.
     - The roundtrip duration is recorded.
     - The exception is mapped to `PROVIDER_TIMEOUT`.
     - The adapter returns an `AiProviderFailureResult` with `retryable: true`.

---

## 11. Retry / Backoff Policy

When a transient transport or rate limit exception occurs, the system utilizes a tiered, highly resilient retry strategy that coordinates the provider adapter and the RabbitMQ worker flow.

### 1. Local Retry (Adapter Layer)
For immediate, very brief network fluctuations, the adapter executes a limited **local retry loop** utilizing **Exponential Backoff with Full Jitter** to prevent client synchronization and API thundering herds.

#### Backoff Algorithm
$$t_{\text{backoff}} = \min\left(t_{\text{max}}, t_{\text{base}} \times 2^{\text{attempt}}\right) \times \text{random}(0, 1)$$

*Where:*
- $t_{\text{base}}$ (Base Backoff) = `1,000ms`
- $t_{\text{max}}$ (Maximum Ceiling) = `10,000ms`
- `max_attempts` (Local Attempt Budget) = `3`

#### Retry Decision Matrix

| Encountered Error Code | Local Retry? | Rationale |
|:---|:---|:---|
| `PROVIDER_RATE_LIMIT` (HTTP 429) | **Yes** (Max 3 attempts) | Temporary quota limit. Respect backoff. |
| `PROVIDER_TIMEOUT` (HTTP Timeout / socket close) | **Yes** (Max 3 attempts) | Socket timeout. Retry in case of route fluctuation. |
| **HTTP 502 / 503 / 504** (Gateway errors) | **Yes** (Max 3 attempts) | Temporary gateway outage. Safe to retry. |
| `INVALID_MODEL_CONFIG` (Auth, bad config parameters) | **No** (Fail-fast) | Permanent config error. Retries will not resolve this. |
| `SCHEMA_PARSING_FAILED` (Bad output text) | **No** (Fail-fast) | Validation boundary error. Handled via ledger state. |
| `CTA_UTM_MUTATED` / `INTENT_DRIFT` (Semantic failures) | **No** (Fail-fast) | Business logic failure. Awaiting manual review. |
| `PROMPT_INJECTION_DETECTED` (Security violation) | **No** (Fail-fast) | Security block. Terminal lock applied. |

---

### 2. Distributed Queue Retry (T-004 Alignment)
If local retry attempts are completely exhausted, or if the API continues to return rate-limit states over a prolonged window, the system must **transition the retry flow out of the active worker execution thread** to prevent rabbitMQ channel blockages.

```
                           LOCAL RETRIES EXHAUSTED
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │  Adapter returns retryable=true│
                      └───────────────┬───────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │  Transaction: Write to Ledger  │
                      │  - Set Run status to          │
                      │    'retryable_failed'         │
                      │  - Set Parent state to        │
                      │    'pending_ai_generation'    │
                      └───────────────┬───────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │   Worker ACKs current RabbitMQ│
                      │   message (Zero channel block)│
                      └───────────────┬───────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │  Schedule delayed redelivery  │
                      │  via Delayed Queue / DLX      │
                      └───────────────────────────────┘
```

- **Ledger Persistence Priority:** The worker commits the `retryable_failed` status and writes the diagnostic log to the Ledger database.
- **Zero-Block ACK:** Once the Ledger transaction commits successfully, the worker **ACKs the current RabbitMQ message**. The active queue thread is cleanly released, preventing consumer starvations.
- **Delayed Redelivery Schedule:** The worker schedules the next retry through the configured delayed scheduler (using Dead Letter Exchanges `DLX` or delayed message plugins) with an escalated cool-down timer (e.g., 60 seconds), ensuring no hot loops occur.

---

## 12. Circuit Breaker Policy

To defend both the internal worker queue and the upstream provider endpoints during extended API outages, the adapter implements a tenant-isolated **Circuit Breaker Policy**.

```
              ┌───────────────────────────────────────────────────┐
              │                                                   │
              ▼                                                   │
     ┌─────────────────┐   Consecutive Transient Failures > 5     ┌───────────────┐
     │     CLOSED      ├─────────────────────────────────────────►│     OPEN      │
     │ (Normal Operations)│                                       │ (Fail-Fast)   │
     └────────▲────────┘                                          └───────┬───────┘
              │                                                           │
              │                                                           │
              │             Test Request Succeeds                         │ Cool-down
              │                                                           │ Elapsed
              │                                                           │ (60s)
              │                                                           │
              │                    ┌───────────────┐                      │
              └────────────────────┤   HALF-OPEN   │◄─────────────────────┘
                                   │ (Test Ingress)│
                                   └───────────────┘
```

### Circuit Breaker Specification
1. **Isolation Boundary:** Performed **per Provider + Workspace** (tenant-isolated circuit stats) with a fallback **per Provider Global** threshold. Isolation ensures that a credential issue or high usage rate-limiting in one tenant workspace does not block AI compositions across unrelated tenants.
2. **State Definitions:**
   - **CLOSED:** Normal operational state. All generation requests are forwarded to the provider APIs.
   - **OPEN:** Triggered when consecutive transient failures (`PROVIDER_RATE_LIMIT`, `PROVIDER_TIMEOUT`, Gateway 5xx) exceed a limit of **5 failures** in a sliding window. 
     - **Fail-Fast Action:** The circuit breaker blocks all outgoing network traffic to that provider for the workspace. It immediately fails fast, returning `AiProviderFailureResult` with `error_code: "PROVIDER_TIMEOUT"` or `"PROVIDER_RATE_LIMIT"`, setting `retryable: true` and `latency_ms: 0`.
     - **Impact:** The worker commits this fail-fast retryable status to the Ledger, ACKs the message, and delays reprocessing without wasting networking threads or aggravating the provider's API.
   - **HALF-OPEN:** Entered after a cool-down timer of **60 seconds** has expired in the OPEN state.
     - **Test Mechanism:** The adapter permits a single generation request to execute.
     - **Success Transition:** If the test request succeeds, the consecutive failure counter is reset, and the circuit transitions back to **CLOSED**.
     - **Failure Transition:** If the test request fails, the circuit returns to **OPEN**, doubling the cool-down timer (up to a max ceiling of 10 minutes).

---

## 13. Rate Limit Handling

Under HTTP 429 or provider-returned quota exhaustion exceptions, the adapter standardizes operational telemetry:

### Rate Limit Protocol
- **Detection:** Inspects HTTP response headers for rate limit details:
  - `x-ratelimit-remaining`
  - `retry-after` / `x-ratelimit-reset`
- **Mapping:** Translates the raw network error directly to `PROVIDER_RATE_LIMIT` with `retryable: true`.
- **Backoff Tuning:** If the provider returns a `retry-after` header value (e.g. 5 seconds), the adapter's local retry loop overrides the computed exponential backoff, pausing execution for precisely the requested duration before retrying.
- **Ledger Telemetry:** If local attempts are exhausted, the mapped `AiErrorCode` (`PROVIDER_RATE_LIMIT`) is committed to the Ledger run row.
- **Worker Integration:** Committing retryable status and scheduling delayed retry is owned by T-004/T-009. The adapter only returns `retryable: true` plus sanitized metadata.

---

## 14. Error Mapping

To ensure security audit compliance and absolute privacy control, the adapter translates raw networking objects through a rigorous sanitization and mapping framework.

### 1. Error Mapping Matrix

| Raw Exception / HTTP Status | System Taxonomy (`AiErrorCode`) | `retryable` | Diagnostic Sanitization Rule |
|:---|:---|:---|:---|
| **HTTP 429** | `PROVIDER_RATE_LIMIT` | `true` | Standard rate limit message. Strip all API usage stats. |
| **HTTP 408 / Socket Timeout** | `PROVIDER_TIMEOUT` | `true` | *"Request timed out after 30,000ms."* |
| **HTTP 502 / 503 / 504** | `PROVIDER_TIMEOUT` | `true` | Gateway error. Scrub server hostnames and raw route URLs. |
| **HTTP 401 / 403** | `INVALID_MODEL_CONFIG` | `false` | Authentication failure. Scrub credential values and API details. |
| **HTTP 400 (Bad Request)** | `INVALID_MODEL_CONFIG` | `false` | Parameter mismatch. Scrub prompt segments and system inputs. |
| **HTTP 404 (Model missing)** | `INVALID_MODEL_CONFIG` | `false` | Model unsupported. Map to invalid config. |
| **Safety Refusal / Filter Block** | `SCHEMA_PARSING_FAILED` | `false` | Provider content safety block. Map to permanent schema fail. |
| **Network Reset / Connection refused** | `PROVIDER_TIMEOUT` | `true` | Connection drop. Scrub target IP ports and proxy configs. |

---

### 2. Leak Redactor (Zero-Token Leakage Guard)
Raw network exception objects (e.g., from Axios or Fetch) frequently contain headers, request configurations, authorization parameters, or error dumps that contain private credentials. The adapter executes a recursive **Leak Redactor** on every error object before logging or saving:

```ts
/**
 * Strict regex patterns used to scrub and redact raw text payloads.
 */
const BANNED_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /x-api-key\s*:\s*[a-zA-Z0-9_\-\.]+/gi,
  /authorization\s*:\s*[a-zA-Z0-9_\-\.]+/gi,
  /vault:\/\/[a-zA-Z0-9_\-\.\/]+/gi,
  /api[-_]?key\s*=\s*[a-zA-Z0-9_\-\.]+/gi
];

/**
 * Recursively cleans and sanitizes error objects or strings.
 * Guarantees zero credential leakage in system logs or Ledger columns.
 */
export function redactErrorPayload(error: unknown): string {
  if (!error) return "Unknown provider error";

  let rawMessage = "";

  if (error instanceof Error) {
    rawMessage = `${error.name}: ${error.message}\n${error.stack || ""}`;
  } else if (typeof error === "object") {
    try {
      // Stringify object while removing potential credential-heavy parameters
      const scrubbedObj = JSON.parse(JSON.stringify(error, (key, value) => {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes("key") ||
          lowerKey.includes("token") ||
          lowerKey.includes("secret") ||
          lowerKey.includes("auth") ||
          lowerKey.includes("cookie") ||
          lowerKey.includes("headers")
        ) {
          return "[REDACTED_PROPERTY]";
        }
        return value;
      }));
      rawMessage = JSON.stringify(scrubbedObj);
    } catch {
      rawMessage = String(error);
    }
  } else {
    rawMessage = String(error);
  }

  // Apply regex sweeps to redact string values
  let redacted = rawMessage;
  for (const pattern of BANNED_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }

  // Scrub file paths to prevent directory listing disclosures
  redacted = redacted.replace(/[a-zA-Z]:\\[\\\w\s\-\.]+/g, "[FILE_PATH_REDACTED]");
  redacted = redacted.replace(/\/usr\/src\/app\/[^\s]*/g, "[FILE_PATH_REDACTED]");

  return redacted.substring(0, 1000); // Truncate payload to limit log footprints
}
```

---

## 15. Mock Provider / Local Fixture Mode

To support disconnected local development, CI/CD testing pipeline boundaries, and robust automated evaluations (**T-011**), the adapter implements a deterministic **Mock Provider Fixture Mode**.

### Fixture Mode Specification
1. **Trigger:** Activated when environment variables set `AI_FIXTURE_MODE = "true"` or the provider is explicitly defined as `"mock"` inside the configuration.
2. **Behavioral Integrity:** The Mock Provider implements the exact same `AiProviderAdapter` contract interface. It must not bypass Zod shape validation or CTA UTM match checks.
3. **Deterministic Retrieval:** Rather than querying remote APIs, the Mock Provider generates a unique hash based on the incoming `user_prompt` (which contains unique Campaign Objectives and Airtable post IDs). It looks up a matching JSON test fixture stored in:
   - `docs/plans/US-003/fixtures/happy_path.json`
   - `docs/plans/US-003/fixtures/utm_mutated_error.json`
   - `docs/plans/US-003/fixtures/prompt_injection_error.json`
4. **Mock Responses:**
   - **Happy Path:** Returns a mock `AiProviderSuccessResult` containing the deterministic structured text, a mock token usage payload, 50ms simulated latency, and a safe mock trace ID.
   - **Failure Vectors:** If the user prompt contains specific debug flags (e.g. `"[trigger_timeout]"`, `"[trigger_rate_limit]"`, or `"[trigger_injection]"`), the Mock Provider simulates the corresponding transient or terminal failure, allowing developers to test retry scheduling and circuit breakers offline.

---

## 16. Security & Privacy Rules

The adapter acts as a security gateway, enforcing five core data privacy constraints:
1. **Zero Secret Storage:** API keys, organization IDs, and system credentials must never be written to Ledger columns, stored in snapshots, or added as raw fields.
2. **Credential Redaction:** The Leak Redactor recursively sweeps error objects to redact authorization headers, bearer values, and vault references before logging or persistence.
3. **Safe Trace ID Verification:** The `provider_trace_id` returned in success/failure outcomes must strictly represent non-sensitive execution IDs. If the trace ID contains prompt material or token fragments, it must be discarded.
4. **No Raw Content in Application Logs:** Winston/Pino logs must **never** record system prompts, user prompts, Notion campaign briefs, or the full `raw_output` body text. Only metadata parameters (token count, latency, workspace partitioning) may be written to output streams.
5. **Untrusted Data Isolation:** The adapter must process Notion guide texts strictly as untrusted parameters, wrapping strings in security-enforced XML blocks.

---

## 17. Observability Rules

To maintain high diagnostic visibility while complying with zero-token leakage policies, the system implements a strict logging filter.

### 1. Log Allowlist (Safe for Output)
The following properties must be written to console outputs and APM telemetry tracers:
- `workspace_id` (strict tenant boundary trace)
- `workflow_run_id` (parent execution run trace)
- `correlation_id` (distributed transaction trace)
- `prompt_version` (template audit trace)
- `provider` (LLM platform trace)
- `model` (model ID trace)
- `latency_ms` (latency roundtrip tracking)
- `error_code` (standardized taxonomy trace)
- `retry_attempt` (current retry counter)
- `token_usage` (safe count metrics)

### 2. Log Blocklist (Banned from Output)
The following parameters are **forbidden** from appearing in any console stdout, file logging, or metrics reporting system:
- `system_prompt` (banned)
- `user_prompt` (banned)
- Notion campaign brief and brand guideline texts (banned)
- `raw_output` full response body text (banned)
- HTTP authorization headers, Bearer tokens, API keys, vault refs (banned)

---

## 18. Handoff to T-009/T-011/T-012

This specification provides a complete integration blueprint for adjacent downstream development tasks:

- **Handoff to T-009 (Persistence & Airtable Sync):**
  - The persistence layer receives the successful `AiProviderSuccessResult` only after T-007 has produced a validated `StructuredComposerOutput`.
  - The raw provider output may be stored only in the controlled Ledger `ai_generation_runs.output_snapshot` or diagnostic fields after validation/sanitization rules allow it. Airtable receives only the validated draft fields (`body`, `hashtags`, `cta_url`) or a sanitized review-block message.
  - If the adapter returns `success: false` and `retryable: true`, the persistence layer transitions the ledger run to `'retryable_failed'` and releases the parent workflow run back to `'pending_ai_generation'`.
- **Handoff to T-011 (Integration Tests & Golden Fixtures):**
  - Implement golden fixtures representing happy and failure paths. Configure the Mock Provider to serve these fixtures deterministically during integration test suites.
- **Handoff to T-012 (Verification & Playground Run):**
  - Provide test triggers and custom playground configurations enabling developers to manually evaluate the adapter's retry loops and error logging sanitizers.

---

## 19. Verification Checklist

Implementers of **T-008** must satisfy these validation gates before completing the task:

- [ ] **Interface Conformance:** Verify that `AiProviderAdapter` and all input/output TypeScript contracts are implemented strictly as specified.
- [ ] **Fail-Closed Configuration Boundary:** Verify that execution halts and returns a non-retryable `INVALID_MODEL_CONFIG` if model settings are missing or workspace partitioning is violated.
- [ ] **Timeout Enforcement:** Verify that remote requests are aborted and return `PROVIDER_TIMEOUT` if latency exceeds **30,000ms**.
- [ ] **Backoff and Jitter Mathematical Correctness:** Verify that the backoff duration increments exponentially and includes randomized jitter to prevent client synchronization.
- [ ] **Queue Worker Retry Integration:** Verify that retryable failures commit state to the Ledger, ACK the current RabbitMQ message, and schedule delayed redelivery to avoid hot consumer loops.
- [ ] **Circuit Breaker State Machine:** Verify that tenant-isolated circuit breakers transition to OPEN on consecutive failures, immediately failing fast and protecting upstream systems.
- [ ] **Leak Redactor Sanitization:** Ensure the recursive Leak Redactor successfully strips bearer tokens, API keys, vault references, and file paths from raw error payloads.
- [ ] **Zero-Token Logging Guard:** Assert that system prompts, user prompts, Notion briefs, and raw outputs are completely excluded from Winston/Pino console logs.
- [ ] **Mock Fixture Mode:** Verify that mock provider executions serve deterministic mock results and simulate timeout/rate-limit exceptions offline.
