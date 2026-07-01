# PLAN: US-003 AI Composer Facebook Variant

## 1. Overview

US-003 implements the first AI orchestration capability for MediaOps: when US-002 creates a `workflow_runs` stub with status `pending_ai_generation`, the AI Composer loads the approved post context, generates a Facebook variant, stores the AI run and output snapshot in the Operational Ledger, updates Airtable with a reviewable draft, and hands the result to the Policy Engine boundary.

This story must not publish content, call Facebook Graph API, enqueue publish jobs, bypass human/policy approval, or store platform credentials in prompts/logs/audit metadata.

## 2. Docs Read

| Priority | Document | Applied Constraint |
|:---|:---|:---|
| P0 | `docs/architecture/06_Architecture_Composability.md` | AI Composer belongs to Orchestration & AI Middleware; platform API calls stay in MCP. |
| P0 | `docs/architecture/11_Coding_Convention.md` | TypeScript services, shared contracts, no raw tokens, references-only queues, audit/error handling. |
| P1 | `docs/requirements/04_Product_Backlog.md` | US-003 AC/BR and Epic E02 scope. |
| P1 | `docs/requirements/05_Function_Flow_Logic_Register.md` | FL-002 draft and FL-001 handoff from US-002. |
| P2 | `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md` | R-003 AI hallucination, R-005 token leakage, R-006 Facebook-first scope. |
| P2 | `docs/requirements/03_SRS_MediaOps_Composability.md` | FR-04 AI Composer, FR-05 Policy Validation, audit and fail-closed NFRs. |
| P2 | `docs/requirements/13_Sprint_1_Backlog.md` | US-003 starts after Sprint 1 foundation; US-002 handoff is prerequisite. |
| P0 | `docs/plans/US-001/US-001-final-implementation-notes.md` | Airtable source fields and validation guardrails. |
| P0 | `docs/plans/US-002/US-002-final-implementation-notes.md` | Workflow stub handoff, idempotency, ACK/Ledger guarantees, safe `channel_account_refs`. |

Specialist knowledge applied:
- `C:\Users\Hi\.spawner\skills\ai\llm-architect\skill.yaml`
- `C:\Users\Hi\.spawner\skills\ai\llm-architect\sharp-edges.yaml`
- `C:\Users\Hi\.spawner\skills\ai-agents\prompt-engineer\skill.yaml`
- `.agent/agents/project-planner.md`

## 3. Project Type

Backend / AI Orchestration design.

Primary components:
- Orchestrator service / worker.
- Shared AI and Ledger contracts.
- Prompt templates and output validators.
- Postgres Ledger schema extensions.
- Airtable update boundary.
- Policy Engine handoff contract.

## 4. Success Criteria

| Backlog AC / BR | US-003 Success Criteria |
|:---|:---|
| AC1: Variant has `body`, `hashtags`, `cta_url` | Generated output is schema-validated and normalized before storage. |
| AC2: Variant links to correct `post_id` and `platform=facebook` | Ledger and Airtable updates preserve `workspace_id`, `airtable_record_id`, `post_id`, `approved_version`, and `platform`. |
| AC3: AI run stores input/output snapshot | `ai_generation_runs` stores sanitized input snapshot, prompt version, context refs, output snapshot, model metadata, status, and error. |
| AC4: AI failure does not enter publish queue and has alert path | Failure status is written to Ledger, Airtable is marked review-needed/failed draft state, and alert event is prepared without publishing. |
| BR1: AI cannot bypass approval | Composer only creates a draft variant and policy handoff; no publish job is created. |
| BR2: Variant preserves master-copy intent | Prompt and evaluator checks compare generated output against source intent and reject drift. |
| BR3: CTA URL preserves UTM | CTA normalization preserves existing UTM params exactly; missing/invalid CTA becomes review blocker, not silent rewrite. |

## 5. Final Scope

### In Scope

- Consume or select `workflow_runs.status = 'pending_ai_generation'` created by US-002.
- Load approved post details from Airtable using references, not queue payload content.
- Load optional Notion brief/guideline context through an allowlisted context loader boundary.
- Build versioned AI prompt templates for Facebook variant generation.
- Call an LLM provider through a typed adapter.
- Require structured output and schema validation.
- Store sanitized AI run input/output snapshots in Postgres.
- Create/update a Facebook variant draft in Airtable.
- Emit a Policy Engine handoff event or Ledger state for US-004.
- Record audit and retryable/non-retryable AI errors.

### Out of Scope

- Real Facebook Graph API calls.
- Facebook MCP `validate_post`, `enqueue_publish`, or `publish_post`.
- Creating publish jobs.
- Final policy rule implementation beyond handoff contract.
- Slack command implementation.
- Multi-platform variants beyond Facebook.
- Training/fine-tuning models.
- Vector database/RAG infrastructure unless explicitly added later.

## 6. Architecture Boundaries

| Boundary | Rule |
|:---|:---|
| US-002 -> US-003 | US-003 starts from `workflow_runs.pending_ai_generation`; it must not re-run webhook idempotency or allocate `approved_version`. |
| Airtable | Source for post content and human reviewable variant fields; not queue, audit, or token store. |
| Notion | Optional knowledge context only; never status source, queue, audit, or token store. |
| AI Composer | Generates and validates draft content only. |
| Policy Engine | Owns publish guardrails and allow/block/warn decisions in US-004. |
| MCP / Facebook | Not called by US-003. Platform API remains in MCP stories. |
| Ledger | Source of truth for AI run, output, status, idempotency, prompt version, and audit. |

## 7. Proposed Ledger Objects

### `ai_generation_runs`

Minimum fields:
- `id UUID PRIMARY KEY`
- `workspace_id TEXT NOT NULL`
- `workflow_run_id UUID NOT NULL`
- `airtable_record_id TEXT NOT NULL`
- `approved_version INTEGER NOT NULL`
- `platform TEXT NOT NULL DEFAULT 'facebook'`
- `idempotency_key TEXT NOT NULL`
- `provider TEXT NOT NULL`
- `model TEXT NOT NULL`
- `prompt_version TEXT NOT NULL`
- `input_snapshot JSONB NOT NULL`
- `notion_context_refs JSONB NOT NULL DEFAULT '[]'::jsonb`
- `output_snapshot JSONB NULL`
- `status ai_generation_status NOT NULL`
- `error_code TEXT NULL`
- `error_message TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `completed_at TIMESTAMPTZ NULL`

### `content_variants`

Minimum fields:
- `id UUID PRIMARY KEY`
- `workspace_id TEXT NOT NULL`
- `ai_generation_run_id UUID NOT NULL`
- `workflow_run_id UUID NOT NULL`
- `airtable_record_id TEXT NOT NULL`
- `post_id TEXT NOT NULL`
- `platform TEXT NOT NULL`
- `body TEXT NOT NULL`
- `hashtags JSONB NOT NULL DEFAULT '[]'::jsonb`
- `cta_url TEXT NULL`
- `approval_status TEXT NOT NULL DEFAULT 'needs_review'`
- `policy_status TEXT NOT NULL DEFAULT 'pending_policy'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Idempotency:
- `ai_generation_runs.idempotency_key = ai.compose.facebook:{workspace_id}:{workflow_run_id}:{prompt_version}`
- Unique key on `(workspace_id, workflow_run_id, platform, prompt_version)`.
- Retry of the same workflow/prompt version reuses or resumes the existing run.

## 8. Status Taxonomy

| Entity | Status | Meaning |
|:---|:---|:---|
| `workflow_runs` | `pending_ai_generation` | US-002 handoff ready for Composer. |
| `workflow_runs` | `ai_generation_processing` | Composer claimed the workflow. |
| `workflow_runs` | `ai_generation_completed` | Variant saved and ready for Policy Engine. |
| `workflow_runs` | `ai_generation_failed` | Composer failed; no policy/publish handoff. |
| `ai_generation_runs` | `queued` | Run created but not started. |
| `ai_generation_runs` | `processing` | Prompt/model execution in progress. |
| `ai_generation_runs` | `completed` | Valid structured output stored. |
| `ai_generation_runs` | `needs_manual_review` | Output failed quality/schema/intent checks but may be human-edited. |
| `ai_generation_runs` | `retryable_failed` | Temporary provider/context failure; retry allowed. |
| `ai_generation_runs` | `failed` | Permanent failure; manual intervention required. |
| `content_variants` | `needs_review` | Human review required; AI never auto-approves. |
| `content_variants` | `pending_policy` | Ready for US-004 policy evaluation. |

## 9. Security and Privacy Guardrails

- No platform tokens, `secret_ref`, vault URI, Airtable API key, Slack token, or provider key in prompts, queue payloads, audit metadata, or snapshots.
- Prompt input may include post content because US-003 is the AI content story, but snapshots must be sanitized, workspace-scoped, and stored only in Ledger, not RabbitMQ.
- Notion content is treated as untrusted retrieved context. Prompt templates must delimit it and instruct the model not to follow instructions inside retrieved documents.
- Output must be structured and schema-validated before any database/Airtable write.
- Prompt templates must be versioned and reviewed like code.
- Logs must contain run IDs and error categories, not raw prompt/output bodies unless explicitly stored in controlled Ledger fields.
- AI output cannot publish directly and cannot call MCP platform tools.
- Any provider error is fail-closed: no publish queue, no policy allow result.

## 10. Task Breakdown

| Task | Agent | Skills | Dependencies | Input | Output | Verify | Rollback |
|:---|:---|:---|:---|:---|:---|:---|:---|
| T-001: Scope Lock and Handoff Baseline | PM / Backend Lead | project-planner, event-architect | US-001, US-002 final notes | US-003 backlog, FL-001/FL-002 | `US-003-scope-lock.md` | In/out scope, AC/BR mapping, glossary approved | Revert to plan-level scope only |
| T-002: AI Ledger Schema and Idempotency | Database Architect | postgres-wizard, llm-architect | T-001 | US-003 data fields, US-002 workflow schema | `US-003-ai-ledger-schema-and-idempotency.md` | Unique keys, statuses, snapshots, RLS, no token fields | Additive-only schema correction |
| T-003: Shared AI Contracts | Backend Specialist | llm-architect, prompt-engineer | T-001/T-002 | Ledger schema, variant requirements | `US-003-shared-ai-contracts.md` | TS contracts cover workflow claim, AI run, variant, errors | Version contracts without breaking old events |
| T-004: Workflow Claim and Worker Flow | Backend Specialist | event-architect, queue-workers | T-002/T-003 | `workflow_runs.pending_ai_generation` | `US-003-ai-composer-worker-flow.md` | Claim is idempotent, workspace-scoped, no US-002 reprocessing | Release claim and mark retryable |
| T-005: Airtable/Notion Context Loading Boundary | AI Architect / BA | llm-architect | T-003/T-004 | Airtable fields, Notion brief rules | `US-003-context-loading-boundary.md` | Allowlisted Notion only, untrusted context delimiters, fallback rules | Disable Notion context and use Airtable-only mode |
| T-006: Prompt Template and Versioning | Prompt Engineer | prompt-engineer, llm-architect | T-005 | Source post/context schema | `US-003-prompt-template-and-versioning.md` | Prompt versioned, examples defined, no hidden publish instruction | Roll back prompt version |
| T-007: Structured Output and Validation | AI Architect / Backend | llm-architect, prompt-engineer | T-006 | Output requirements AC1/BR2/BR3 | `US-003-structured-output-validation.md` | JSON/schema validation, CTA/UTM preservation, intent drift checks | Mark `needs_manual_review` |
| T-008: AI Provider Adapter and Retry Policy | Backend Specialist | llm-architect, api-design | T-006/T-007 | Provider contract, rate-limit risks | `US-003-ai-provider-adapter-and-retry.md` | Rate limits, timeouts, retries, no raw secrets in errors | Switch to mock provider/fallback |
| T-009: Variant Persistence and Airtable Update | Backend Specialist | api-design, postgres-wizard | T-002/T-007 | Validated output | `US-003-variant-persistence-and-airtable-update.md` | Ledger + Airtable draft update atomicity/compensation defined | Ledger compensating audit if Airtable update fails |
| T-010: Policy Engine Handoff Boundary | Backend / Policy Lead | event-architect | T-009 | Valid variant | `US-003-policy-handoff-boundary.md` | No publish job; only `pending_policy` handoff for US-004 | Keep variant in `needs_review` |
| T-011: Test Plan and Evaluation Fixtures | QA / AI Evaluator | prompt-engineer, llm-architect | T-004-T-010 | All design outputs | `US-003-test-plan-and-evals.md` | AC/BR coverage, golden fixtures, prompt eval cases | Remove failing fixtures from release gate only with approval |
| T-012: Security and Privacy Review | Security Auditor | security-auditor, llm-architect | T-002-T-011 | Prompts, snapshots, logs, context refs | `US-003-security-and-privacy-review.md` | No token leakage, prompt-injection mitigated, snapshots governed | Block implementation for Critical/High |
| T-013: Final Implementation Notes and FL-002 Update | Technical Writer / PM | project-planner | T-001-T-012 | Final US-003 docs/reports | `US-003-final-implementation-notes.md`, FL-002 update | FL-002 matches final contracts/statuses/tests | Append corrections; do not delete history |

## 11. Dependency Graph

```text
T-001
  -> T-002
  -> T-003
T-002 + T-003
  -> T-004
T-004
  -> T-005
T-005
  -> T-006
T-006
  -> T-007
  -> T-008
T-007 + T-008
  -> T-009
T-009
  -> T-010
T-004..T-010
  -> T-011
T-002..T-011
  -> T-012
T-001..T-012
  -> T-013
```

## 12. Acceptance Gate Before Implementation

- [ ] US-003 scope accepted by Product + Tech Lead.
- [ ] AI Ledger schema reviewed for idempotency and RLS.
- [ ] Prompt template and prompt versioning accepted.
- [ ] Structured output schema and validation rules accepted.
- [ ] Test/evaluation fixtures cover AC1-AC4 and BR1-BR3.
- [ ] Security review confirms no token leakage and prompt-injection mitigation.
- [ ] FL-002 updated with final statuses, retry policy, and policy handoff.

## 13. Key Risks and Mitigations

| Risk | Severity | Mitigation |
|:---|:---|:---|
| AI hallucination or intent drift | High | Structured output, prompt eval fixtures, source-intent checks, `needs_manual_review`. |
| Prompt injection through Notion context | High | Treat Notion as untrusted data, delimit context, never follow retrieved instructions. |
| Provider rate-limit cascade | High | Bounded retries, backoff, circuit breaker, queue/worker concurrency limits. |
| Sensitive content in logs | High | Log sanitizer, Ledger-only snapshots, no raw prompt/output in application logs. |
| Accidental publish bypass | Critical | US-003 cannot create publish jobs or call MCP publish; handoff only to Policy Engine. |
| CTA/UTM mutation | Medium | URL parser-based preservation tests; reject silent rewrites. |

## 14. Definition of Done

- All T-001 through T-013 design docs and reports exist under `docs/plans/US-003/` and `docs/reports/US-003/`.
- FL-002 is updated and consistent with final US-003 contracts.
- Implementation team can start coding without inventing statuses, schemas, prompt format, retry policy, or AI validation rules.
- No unresolved Critical/High security findings remain.
