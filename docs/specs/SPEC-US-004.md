# SPEC-US-004: Policy Engine Pre-Publish Guardrail

**Status:** Approved  
**Retrofit Note:** Retrospec — US-004 implemented before AI-SDLC gate. Verified from FL-003, `policyWorker.test.ts`, `policyEngine.test.ts`.  
**FL Reference:** FL-003 (Policy Engine Publish Guardrail) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 378  
**Backlog AC/BR:** US-004 AC1–AC4, BR1–BR5

---

## Goal

Consume the `policy.evaluate.requested` event, reload content variant context from Ledger, execute 8 pure policy rule checks (no external I/O), persist result in `publish_rule_results`, transition `content_variants.policy_status` to `policy_approved` or `policy_rejected`, conditionally insert a `publish_jobs` stub for auto-publish, and emit `publish.facebook.requested` via transactional outbox — without calling Facebook Graph API, MCP publish tools, or AI providers.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-004
- **FL-003:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 378–478
- **Worker:** `apps/orchestrator/src/workers/policyWorker.ts`
- **Consumer:** `apps/orchestrator/src/queue/policyRabbitmqConsumer.ts`
- **Policy Engine:** `packages/policy-engine/src/evaluate.ts`
- **Policy Version:** `packages/policy-engine/src/version.ts` — constant `POLICY_VERSION = 'policy-facebook-v1'`
- **Repository:** `publish_rule_results`, `content_variants`, `publish_jobs`, `publish_handoff_events` tables
- **Queue topology:** `apps/orchestrator/src/queue/topologyConfig.ts` — `policy.evaluate.requested`
- **Schema:** `packages/shared-contracts/src/__tests__/policyContracts.test.ts`

---

## In Scope

- Consuming `policy.evaluate.requested` (exchange: `publish.workflows`, consumer: `PolicyWorker`).
- Idempotency check on `publish_rule_results` before any write.
- Reloading runtime context from Ledger: `content_variants`, `channel_account`, `token_reference`, workspace config, forbidden terms config.
- Running 8 policy rule checks as pure functions (no I/O).
- Atomic persist: `publish_rule_results` + `content_variants.policy_status` + `workflow_runs.status` + audit log + optional `publish_jobs` stub + `publish_handoff_events` outbox.
- On block: Airtable PATCH `Needs Review` + blockers + Slack alert (non-blocking after commit).
- Outbox relay: `publish.facebook.requested` for US-005.

## Out of Scope

- AI composition or LLM calls — belongs to US-003 / FL-002.
- Facebook validation (rate limit, platform rules) — belongs to US-005 / FL-004.
- Actual publishing — belongs to US-006 / FL-004b.
- Manual approval decision — Airtable-driven, not this worker.

---

## Functional Contract

Based on FL-003 (7 processing steps):

1. **Schema Validation (Consumer):** Validate `PolicyEvaluateRequestedEvent` via Zod. Invalid → DLQ (`policy.evaluate.requested.dlq`) + ACK.
2. **Idempotency Check:** Query `publish_rule_results` by `idempotency_key`. Exists → ACK, no-op. If `content_variants.policy_status != 'pending_policy'` → ACK, log `policy_ineligible`.
3. **Start Postgres Transaction:** `SET LOCAL app.current_workspace_id`. Lock `content_variants WHERE policy_status='pending_policy'`. Transition to `policy_evaluating`. COMMIT.
4. **Reload Context from Ledger:** Load `channel_account`, `token_reference`, workspace config (`auto_publish_enabled`, `auto_approve_enabled`), forbidden terms config.
5. **Run Policy Rule Checks (pure functions in `packages/policy-engine`, no I/O):**
   | Rule | Function | Code | Type |
   |:---|:---|:---|:---|
   | Approval status | `checkApprovalStatus(variant)` | `MISSING_APPROVAL` | Blocker |
   | Channel token valid | `checkChannelToken(channelAccount, tokenRef)` | `INVALID_CHANNEL_TOKEN` | Blocker |
   | Channel account active | `checkChannelAccountActive(channelAccount)` | `CHANNEL_ACCOUNT_INACTIVE` | Blocker |
   | Facebook text length | `checkFacebookTextLength(variant)` | `PLATFORM_TEXT_CONSTRAINT_VIOLATED` (>63,206 chars) | Blocker |
   | Forbidden terms | `checkForbiddenTerms(variant, config)` | `FORBIDDEN_TERM_DETECTED` | Blocker |
   | CTA URL | `checkCtaUrl(variant, sourcePost)` | `MISSING_CTA_URL` / `MISSING_UTM` | Blocker / Warning |
   | Auto-publish config | `checkAutoPublishConfig(workspaceConfig)` | `AUTO_PUBLISH_DISABLED` | Blocker |
   | Hashtag count | `checkHashtagCount(variant)` | `HASHTAG_COUNT_HIGH` (>10) | Warning |
   | Aggregate | `aggregateRuleResults(checks)` | → `{allowed, blockers, warnings, checks}` | — |
6. **Persist Result (Atomic Transaction):**
   - INSERT `publish_rule_results` (idempotency_key UNIQUE).
   - UPDATE `content_variants.policy_status` → `policy_approved` or `policy_rejected`.
   - UPDATE `workflow_runs.status` → `policy_evaluation_completed` or `policy_evaluation_blocked`.
   - INSERT `audit_logs`.
   - **If PASS AND auto_publish_enabled AND auto_approve_enabled:**
     - INSERT `publish_jobs` stub (`status='queued'`, idempotency_key: `publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{POLICY_VERSION}`).
     - INSERT `publish_handoff_events` outbox (idempotency_key: `publish.facebook.handoff:{workspace_id}:{job_id}`).
   - COMMIT.
7. **ACK RabbitMQ** ONLY after COMMIT.
8. **Post-Commit (async):**
   - Outbox relay publishes `publish.facebook.requested` (US-005 trigger).
   - If BLOCKED: Airtable PATCH `Needs Review` + blocker list. Publish Slack alert to `alerts.slack.send`. Airtable failure → `airtable_sync_retry_needed = true` + audit — Ledger NOT rolled back.
   - If `POLICY_BLOCK_SLACK_CHANNEL_ID` missing → graceful degradation (audit `alert_pending_config`, no fail).

---

## Data / Queue / API Contract

### Queue: Input
- **Queue:** `policy.evaluate.requested`
- **Exchange:** `publish.workflows` (topic)
- **DLQ:** `policy.evaluate.requested.dlq`
- **Retry:** 5 retries with TTL [1s, 2s, 4s, 8s, 16s]
- **Payload (references-only):** `{event_id, event_type: "policy.evaluate.requested", workspace_id, workflow_run_id, ai_generation_run_id, content_variant_id, airtable_record_id, platform: "facebook", prompt_version, approved_version, idempotency_key, correlation_id, created_at}`
- **Forbidden:** body text, hashtags, CTA, token, credentials

### Queue: Output (pass path)
- **Queue:** `publish.facebook.requested`
- **Exchange:** `publish.workflows`
- **Via:** `publish_handoff_events` transactional outbox relay

### Ledger Entities
- **`publish_rule_results`:** `{id, content_variant_id, workspace_id, policy_version, allowed, blockers, warnings, checks, idempotency_key (UNIQUE)}`
- **`content_variants`:** `policy_status: "pending_policy" → "policy_evaluating" → "policy_approved" | "policy_rejected"`
- **`publish_jobs`:** `{id, workspace_id, post_id, variant_id, channel_account_id, status: "queued", idempotency_key (UNIQUE), scheduled_at}`
- **`publish_handoff_events`:** outbox `{job_id, workspace_id, idempotency_key}`

### Idempotency Keys
| Scope | Key Format | Column |
|:---|:---|:---|
| Policy evaluation | `policy.evaluate.requested:{workspace_id}:{content_variant_id}:{POLICY_VERSION}` | `publish_rule_results.idempotency_key` |
| Publish job | `publish.facebook.job:{workspace_id}:{post_id}:{approved_version}:{POLICY_VERSION}` | `publish_jobs.idempotency_key` |
| Handoff outbox | `publish.facebook.handoff:{workspace_id}:{job_id}` | `publish_handoff_events.idempotency_key` |

- **`POLICY_VERSION`** constant: `'policy-facebook-v1'` from `packages/policy-engine/src/version.ts` — never hardcoded inline.

---

## Security & Safety Rules

- **Policy Engine is pure functions:** `packages/policy-engine` must not call platform API, MCP tools, or external HTTP.
- **`SET LOCAL app.current_workspace_id`** required for every tenant-scoped transaction.
- **`checkForbiddenTerms`:** NFC normalize + lowercase before compare — never log raw matched term.
- **`publish_handoff_events` payload** is references-only — no body text, token, or credentials.
- **Fail closed on unknown token status:** if `token_status` is not `active`, produce `INVALID_CHANNEL_TOKEN` blocker.
- **`POLICY_BLOCK_SLACK_CHANNEL_ID` missing:** graceful degradation — Ledger and Airtable still commit; only audit entry `alert_pending_config` written.
- **Audit metadata** contains no forbidden term raw value, no raw token.

---

## Error Cases

| Case | `content_variants.policy_status` | `workflow_runs.status` | Queue |
|:---|:---|:---|:---|
| Schema invalid | N/A | Unchanged | DLQ + ACK |
| Idempotency duplicate | Unchanged | Unchanged | ACK |
| Wrong status (`not pending_policy`) | Unchanged | Unchanged | ACK |
| PASS + auto-publish | `policy_approved` | `policy_evaluation_completed` | ACK; publish job queued |
| PASS + manual | `policy_approved` | `policy_evaluation_completed` | ACK; no publish job |
| BLOCKED (≥1 blocker) | `policy_rejected` | `policy_evaluation_blocked` | ACK; Slack alert |
| DB fail before commit | Unchanged | Unchanged | NACK |
| Airtable PATCH fail (post-commit) | Committed | Committed | ACK; `sync_retry_needed = true` |
| Exhausted retries | `policy_evaluation_failed` | — | DLQ |

---

## Acceptance Criteria

**AC1 — Forbidden term in body blocks the post (Backlog AC1)**
- *Given* a `content_variants` row with body containing a configured forbidden term
- *When* `policyEngine.evaluate(variant, config)` runs
- *Then* `allowed = false`, blockers contains `FORBIDDEN_TERM_DETECTED`, `publish_rule_results` is inserted with `allowed = false`, and `content_variants.policy_status = 'policy_rejected'`.
- *Trace evidence:* Test case `"should block if body contains forbidden term"` in [policyEngine.test.ts](file:///d:/Muti-Media%20Management/packages/policy-engine/src/__tests__/policyEngine.test.ts) and [REPORT-us-004-implementation-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-004/REPORT-us-004-implementation-2026-06-01.md).

**AC2 — Approved policy with auto-publish creates publish job (Backlog AC2)**
- *Given* a variant that passes all 8 rules and `workspace.auto_publish_enabled = true, auto_approve_enabled = true`
- *When* the atomic transaction commits
- *Then* `publish_jobs` row is inserted with `status = 'queued'` and `publish_handoff_events` outbox row is inserted; `workflow_runs.status = 'policy_evaluation_completed'`.
- *Trace evidence:* Test case `"should create publish_job on auto-publish match"` in [policyWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/policyWorker.test.ts) and [REPORT-us-004-implementation-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-004/REPORT-us-004-implementation-2026-06-01.md).

**AC3 — Policy version is from constant, not hardcoded (Backlog AC3, BR3)**
- *Given* `POLICY_VERSION` constant from `packages/policy-engine/src/version.ts`
- *When* `publish_rule_results.idempotency_key` is computed
- *Then* the key format is `policy.evaluate.requested:{workspace_id}:{content_variant_id}:policy-facebook-v1` — not a hardcoded string in the worker.
- *Trace evidence:* Verified in [policyWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/policyWorker.test.ts) (checking that version matches import).

**AC4 — Slack alert missing config does not fail the transaction (Backlog AC4)**
- *Given* `POLICY_BLOCK_SLACK_CHANNEL_ID` is not configured AND a policy block occurs
- *When* the post-commit side effects run
- *Then* the Ledger transaction has already committed, `audit_logs` contains `alert_pending_config`, and no exception propagates to the worker.
- *Trace evidence:* Test case `"should complete gracefully if Slack block channel config is missing"` in [policyWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/policyWorker.test.ts).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [policyWorker.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/policyWorker.test.ts) | `apps/orchestrator/src/__tests__/policyWorker.test.ts` | Pass auto-publish stub creation, manual pass, policy rejection block, idempotency duplicate handling, schema fail |
| [policyEngine.test.ts](file:///d:/Muti-Media%20Management/packages/policy-engine/src/__tests__/policyEngine.test.ts) | `packages/policy-engine/src/__tests__/policyEngine.test.ts` | 8 pure rule functions validation, empty values, character boundary limits |
| [policyRabbitmqConsumer.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/policyRabbitmqConsumer.test.ts) | `apps/orchestrator/src/__tests__/policyRabbitmqConsumer.test.ts` | Schema parsing failure → DLQ routing, consumer initialization |
| [policyContracts.test.ts](file:///d:/Muti-Media%20Management/packages/shared-contracts/src/__tests__/policyContracts.test.ts) | `packages/shared-contracts/src/__tests__/policyContracts.test.ts` | Zod schema structures for topic payloads |

### Verification Evidence Reports

TDD cycles and manual verification are logged in:
- [REPORT-us-004-implementation-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-004/REPORT-us-004-implementation-2026-06-01.md)
- [REPORT-us-004-documentation-2026-06-01.md](file:///d:/Muti-Media%20Management/docs/reports/US-004/REPORT-us-004-documentation-2026-06-01.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original red-stage execution outputs not captured. However, the regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/__tests__/policyWorker.test.ts`

---

## Documentation Conflict

**Orphan block in FL Register (lines 480–508):** An unnamed processing steps block (`1. Verify Slack signature…` through `Test Evidence: Pending`) appears in the FL Register between FL-003 (line 378) and FL-005 (line 510) without a `### FL-xxx` header. This is a duplicate of the generic Slack Command Handler content that was superseded by FL-009 and FL-010. It has **no impact on US-004 or US-003** — it is a documentation artifact. Severity: Low. No code change needed.

---

## Open Questions

- OQ-004-1: Does `checkChannelToken` also check scopes? *Resolved:* No, the MVP only checks `token_status = 'active'` and token expiry buffers.
- OQ-004-2: Is `auto_approve_enabled` a workspace DB setting? *Resolved:* Yes, it is fetched from the `workspace_settings` table at runtime.

