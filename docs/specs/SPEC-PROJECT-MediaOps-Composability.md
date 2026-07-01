# SPEC-PROJECT: MediaOps Composability

**Status:** Approved project-level source of truth  
**Date:** 2026-06-29  
**Scope Level:** Full project  
**Primary Audience:** Maintainers, AI coding agents, technical reviewers, and interview/demo reviewers  
**Related Backlog:** US-001 to US-015  
**Validation Level:** Local build/lint/test evidence exists in project reports; production readiness requires runtime smoke and external integration evidence.

## 1. Product Goal

MediaOps Composability is a backend-centered, multi-channel media operations platform for planning, generating, reviewing, publishing, monitoring, and responding to social media content across multiple platforms.

The system uses a composable architecture:

- Airtable for structured editorial workflow and approval control.
- Notion for campaign briefs, brand guidelines, and long-form knowledge context.
- Node.js/TypeScript orchestrator for workflow coordination, validation, and async processing.
- MCP servers for platform API execution boundaries.
- RabbitMQ for asynchronous event routing and retry/DLQ behavior.
- Postgres/InsForge as the operational ledger and audit source of truth.
- Slack as the operations command and alert surface.

The project is not a single-platform Facebook tool. Facebook is the first fully developed platform slice. The architecture and data model intentionally support additional media and customer interaction channels such as Instagram, Zalo, Threads, WhatsApp, TikTok, LinkedIn, YouTube, X/Twitter, and future platform MCP servers.

## 2. Users And Roles

| Role | Responsibilities |
|:---|:---|
| Social Media Manager | Plans campaigns, reviews content, approves posts, manages channel readiness. |
| Content Creator | Drafts master copy, prepares assets, uses AI output as a draft aid. |
| Manager / Approver | Approves or rejects post variants, can act from Slack. |
| Support Agent | Replies to comments and direct messages, escalates risky interactions. |
| Admin | Configures platform accounts, tokens, feature flags, and workspace members. |
| CMO / Operations Lead | Reviews campaign reporting, publish health, failure trends, and response metrics. |
| AI Agent / Middleware | Generates variants, validates structured output, and routes work through safe tools. |

## 3. Product Scope

### 3.1 In Scope

- Campaign and post planning through Airtable.
- Approved-post webhook ingestion.
- Zero-trust Airtable reload before workflow side effects.
- AI content generation for platform-specific variants.
- Notion campaign brief loading with strict URL and response-size boundaries.
- Policy validation before publish.
- Platform account configuration and secret reference management.
- MCP-based platform validation, publish, comment sync, comment reply, and direct message operations.
- RabbitMQ event bus hardening with canonical events, retries, DLQs, and idempotency.
- Slack slash commands for approvals, comment handling, escalation, and DM reply.
- Operational Ledger with append-only audit logging and redaction.
- Campaign reporting and CSV export.
- Unified direct message inbox foundation for Facebook, Instagram, and Zalo, with future-ready platform expansion.
- AI-SDLC governance artifacts and validation gates.

### 3.2 Out Of Scope For Current Implementation

- Full frontend product UI beyond API and external tool surfaces.
- Full production OAuth review for every social network.
- Paid ad management automation.
- Cross-platform media asset transcoding.
- Advanced marketing attribution / ROI modeling.
- High-volume search/vector analytics store.
- Complete production deployment and runtime smoke evidence for every external integration.

### 3.3 Future-Compatible Scope

The domain model must remain platform-neutral where possible. New platforms should be added through:

- Shared event contracts.
- Platform-specific MCP server/tool implementation.
- Channel account metadata and secret references.
- Platform-specific policy rules.
- Worker routing through RabbitMQ topology.
- Ledger records scoped by `workspace_id`, `platform`, and external ids.

## 4. Platform Strategy

| Platform | Current Project Status | Intended Capability |
|:---|:---|:---|
| Facebook Page | Primary implemented slice | Publish posts, sync comments, reply comments, ingest/reply DM through MCP/mock path. |
| Instagram | Schema/topology-compatible | DM ingestion and future media publishing/comment handling via dedicated MCP tools. |
| Zalo | Schema/topology-compatible | DM ingestion and customer support workflows for Vietnam-focused operations. |
| Threads | Future platform | Post publishing and engagement monitoring through a future MCP boundary. |
| WhatsApp | Future platform | Customer messaging and support workflows through business API/MCP. |
| TikTok | Future platform | Short-form content publishing/status tracking where API access allows. |
| LinkedIn | Future platform | B2B post publishing and campaign reporting. |
| YouTube | Future platform | Video publishing/status tracking and comment monitoring. |
| X/Twitter | Future platform | Post publishing and engagement monitoring if API access is available. |

Rules:

- Orchestrator must not call platform APIs directly.
- Platform credentials must be resolved inside the MCP/server-side secret boundary.
- Unsupported platforms can exist as Airtable stubs or Ledger rows, but must fail closed if no active MCP implementation exists.
- Queue messages must carry references only, not raw tokens or large content payloads.

## 5. Architecture Boundaries

### 5.1 Control Plane: Airtable

Airtable owns human-editable campaign/post workflow state:

- Campaign metadata.
- Post draft metadata.
- Target channel selection.
- Review and approval status.
- Calendar scheduling.
- Safe channel account stubs.

Airtable must not own:

- Long-lived platform credentials.
- RabbitMQ retry state.
- Operational audit source of truth.
- Full direct message bodies.
- Raw platform API responses.

### 5.2 Knowledge Plane: Notion

Notion owns long-form context:

- Campaign brief.
- Brand voice.
- Do/avoid terms.
- Legal notes.
- Guidelines and supporting context.

Notion is untrusted input for AI. The loader must:

- Fetch only allowlisted Notion resources.
- Validate page ids and URL boundaries.
- Enforce timeouts and maximum response bytes.
- Store references/sanitized summaries, not raw API responses.
- Wrap context in prompt boundaries so it cannot override system instructions.

### 5.3 Orchestration Plane

The orchestrator owns:

- HTTP routes.
- Webhook handling.
- Slack command verification.
- Workflow state transitions.
- Worker orchestration.
- Calls to MCP tools.
- Ledger repositories.
- RabbitMQ publishing/consuming.

The orchestrator must not:

- Hold raw long-lived platform tokens in queues/logs/audits.
- Call platform Graph/API endpoints directly.
- Treat Airtable webhook payloads as trusted source content.
- ACK queue messages before durable Ledger state is committed.

### 5.4 MCP Execution Plane

MCP servers own platform API details:

- Token resolution.
- Platform-specific API calls.
- Platform response normalization.
- Sanitized result contracts.

Current concrete MCP app:

- `apps/facebook-mcp-server`

Future MCP apps should follow the same contract style:

- `instagram-mcp-server`
- `zalo-mcp-server`
- `threads-mcp-server`
- `whatsapp-mcp-server`
- `linkedin-mcp-server`
- `youtube-mcp-server`

### 5.5 Event Bus

RabbitMQ owns asynchronous delivery, not long-term truth:

- Topic/direct exchange compatibility.
- Queue topology.
- Retry via TTL queues.
- Per-queue DLQs.
- Confirm publish before ACK where needed.

Postgres Ledger owns durable state.

### 5.6 Operational Ledger

Postgres/InsForge owns:

- Workflow state.
- Idempotency records.
- Publish jobs.
- AI generation runs.
- Policy results.
- Channel accounts.
- Conversations/messages.
- Slack command events.
- Audit logs.
- Reporting aggregates.

## 6. Core Workflow Specifications

### 6.1 Campaign And Post Setup

Related stories:

- US-001
- US-013

Flow:

1. SMM creates a campaign and optional Notion brief.
2. SMM/Creator creates a post in Airtable.
3. Creator enters master copy, CTA URL, assets, target channels, and schedule.
4. Airtable enforces workflow fields and channel stubs.
5. Manager moves eligible post into approval flow.

Acceptance:

- Posts have required fields before approval.
- Target channels are explicit.
- Channel account stubs exist for selected platforms.
- Notion remains context only, not operational state.

### 6.2 Approved Webhook To Workflow Run

Related stories:

- US-002

Flow:

1. Airtable sends approved-post webhook.
2. Orchestrator validates and records event.
3. Receiver enqueues references-only message.
4. Worker reloads Airtable record.
5. Worker revalidates current status and required fields.
6. Worker allocates approved version and creates workflow run.
7. Worker ACKs only after Ledger commit.

Acceptance:

- Duplicate webhooks do not create duplicate workflows.
- Stale status changes are ignored safely.
- No source content or token is placed in queue payload.

### 6.3 AI Variant Generation

Related stories:

- US-003
- US-013

Flow:

1. AI worker claims a pending workflow run.
2. Worker reloads Airtable context.
3. Worker loads Notion context if configured.
4. Prompt is assembled with untrusted context boundaries.
5. AI provider returns structured output.
6. Output is validated and persisted as a platform-specific content variant.
7. Policy evaluation event is emitted.

Acceptance:

- AI cannot approve or publish by itself.
- Output must preserve campaign intent and CTA/UTM constraints.
- Prompt injection and SSRF boundaries fail closed.
- Platform variant records must include platform id.

### 6.4 Policy Evaluation

Related stories:

- US-004

Flow:

1. Policy worker loads content variant and workflow context.
2. Rules validate approval, forbidden terms, CTA/UTM, platform readiness, and auto-publish eligibility.
3. Passing result creates publish job/outbox event.
4. Failing result updates review state and alerts operators.

Acceptance:

- Policy results are auditable.
- Publish jobs are not created on failing policy.
- Platform-specific rules can be extended without rewriting orchestration.

### 6.5 Publish Validation And Execution

Related stories:

- US-005
- US-006
- US-011

Flow:

1. Publish validation worker consumes `publish.<platform>.requested`.
2. Worker reloads job, variant, workflow, channel account, and token reference.
3. MCP validates platform constraints and rate limits.
4. Validated publish event is emitted.
5. Publish worker calls MCP publish tool.
6. MCP resolves token internally and calls platform API.
7. Worker persists external post id and final job state.

Acceptance:

- Same idempotency key cannot publish duplicate posts.
- Platform auth/permission errors fail terminally with admin-visible alerts.
- Transient API failures retry with bounded behavior.
- Raw token and raw platform response are never logged.

### 6.6 Comment Sync And Comment Actions

Related stories:

- US-007
- US-009

Flow:

1. Scheduler or event enqueues comment sync request.
2. MCP fetches comments for the platform/post.
3. Worker upserts interactions into Ledger.
4. Risk classification routes Slack alerts.
5. Support uses Slack command to reply or escalate.
6. Reply worker calls MCP and updates interaction status.

Acceptance:

- Duplicate comments do not duplicate interactions.
- Risk interactions escalate to the correct channel.
- Reply actions are authorized and auditable.
- Token resolution stays in MCP.

### 6.7 Slack Approval Commands

Related stories:

- US-008

Flow:

1. User runs `/approve_post` or `/reject_post`.
2. Orchestrator verifies Slack signature and replay window.
3. Orchestrator parses command and validates role.
4. Valid command is recorded and queued.
5. Worker updates Airtable/Ledger and writes audit log.

Acceptance:

- Unauthorized roles cannot approve/reject.
- Invalid command arguments return safe ephemeral messages.
- Route must not respond with success before authorization outcome is known.

### 6.8 Campaign Reporting

Related stories:

- US-012

Flow:

1. Authorized user requests campaign report.
2. Repository aggregates publish jobs and pre-aggregated interactions.
3. API returns JSON or CSV.
4. Access/export is audited.

Acceptance:

- Metrics avoid double-counting interactions.
- Report uses Ledger, not Slack messages.
- Sensitive customer message body is not exposed in aggregate reports.

### 6.9 Admin Channel Configuration

Related stories:

- US-011

Flow:

1. Admin starts platform OAuth or connection flow.
2. State is persisted server-side to prevent replay.
3. MCP exchanges code and lists assets/pages/accounts where supported.
4. Admin connects a platform account.
5. Token is stored via secret store and referenced in Ledger.
6. Health check validates scopes/status.

Acceptance:

- Only admin can connect/disconnect channel accounts.
- Secret refs are opaque and scoped.
- Runtime implementation must match provider-specific OAuth requirements.
- Unsupported platform permissions are explicit open items, not hidden success.

### 6.10 Unified Direct Message Inbox

Related stories:

- US-015

Flow:

1. Platform MCP receives or fetches direct message metadata.
2. Ingest event is published to `dm.<platform>.ingest`.
3. Worker loads full body through MCP where required.
4. Ledger upserts conversation and message.
5. Slack alert uses redacted preview only.
6. Support replies through `/reply_dm`.
7. Reply worker loads reply body by job id and calls MCP send tool.

Acceptance:

- Conversation/message uniqueness is scoped by workspace/platform/thread/message ids.
- Full DM body is stored only in Ledger under RLS, not in Slack/Airtable/Notion.
- Queue payloads must not contain full reply body.
- Reply job must be claimed atomically before send.

### 6.11 Event Bus Hardening

Related stories:

- US-014

Flow:

1. Producers build canonical event envelopes.
2. Publisher rejects forbidden fields.
3. Consumer validates schema and idempotency.
4. Worker commits durable state.
5. Consumer ACKs only after state/audit/DLQ publish rules are satisfied.

Acceptance:

- Event envelopes are references-only.
- Idempotency is scoped by workspace.
- Retry/DLQ behavior is consistent per queue.
- Queue topology remains backward compatible.

### 6.12 Operational Audit And Ledger

Related stories:

- US-010

Flow:

1. Subsystems call shared audit repository.
2. Metadata is recursively redacted.
3. Audit row is inserted with correlation/causation/idempotency identifiers.
4. Append-only DB constraints prevent mutation.

Acceptance:

- No raw secrets/tokens in audit metadata.
- Audit entries are workspace-scoped.
- Critical same-transaction audit failures fail the parent transaction.
- Non-critical post-commit audit failures are captured as open operational issues.

## 7. Data Model Overview

Core logical entities:

- `workspace_members`
- `webhook_events`
- `approval_versions`
- `workflow_runs`
- `ai_generation_runs`
- `content_variants`
- `publish_rule_results`
- `publish_jobs`
- `publish_handoff_events`
- `publish_execution_events`
- `channel_accounts`
- `token_references`
- `secret_references`
- `facebook_oauth_sessions`
- `facebook_oauth_states`
- `interactions`
- `comments`
- `comment_sync_events`
- `comment_action_events`
- `slack_command_events`
- `slack_comment_alerts`
- `conversations`
- `conversation_messages`
- `direct_message_reply_jobs`
- `event_bus_messages`
- `queue_events`
- `audit_logs`

Data rules:

- Every tenant-owned table must carry or derive `workspace_id`.
- RLS must enforce workspace isolation where supported.
- External ids are never trusted globally without workspace and platform context.
- Human-facing systems receive redacted previews unless full content is explicitly required and authorized.

## 8. API And Command Surface

### 8.1 HTTP APIs

Representative routes:

- Airtable webhook ingress.
- Slack command receiver.
- Admin platform connection routes.
- Campaign report routes.
- Health check route.

Rules:

- Validate every request body/query/header.
- Verify external signatures where available.
- Do not trust role claims from client headers alone; resolve through workspace membership.
- Return safe messages to Slack/external callers.

### 8.2 Slack Commands

Current commands:

- `/approve_post <post_id>`
- `/reject_post <post_id> <reason>`
- `/reply_comment <interaction_id> <message>`
- `/escalate <interaction_id> [reason]`
- `/reply_dm <conversation_id> <message>`

Rules:

- Verify Slack request signature.
- Enforce replay window.
- Parse command deterministically.
- Role-check against `workspace_members`.
- Queue async work when processing may exceed Slack response window.

### 8.3 MCP Tools

Current/Facebook-oriented tools include:

- `validate_post`
- `get_rate_limit_status`
- `publish_post`
- `sync_comments`
- `reply_comment`
- `generate_oauth_url`
- `exchange_code_and_list_pages`
- `connect_page`
- `health_check_token`
- `get_direct_message`
- `send_direct_message`

Future platform MCP tools should preserve the same boundary:

- Input references and sanitized content only.
- Raw token resolution inside MCP server.
- Sanitized result output.
- No raw platform API response returned to orchestrator.

## 9. Security Requirements

### 9.1 Token And Secret Handling

- No raw platform token in Airtable, Slack, RabbitMQ, audit logs, reports, or Notion.
- Secret references must be opaque and scoped.
- MCP resolves credentials internally.
- Logs and audit metadata must be redacted recursively.

### 9.2 Tenant Isolation

- All tenant data must be scoped by `workspace_id`.
- RLS must be fail-closed.
- Cross-workspace assignment and role lookups must check workspace membership.
- Idempotency keys should be unique within workspace scope unless explicitly global.

### 9.3 Queue Privacy

- Queue payloads must be references-only.
- Large bodies, raw customer DMs, raw post bodies, raw Graph responses, and tokens are forbidden in queue messages.
- DLQ payloads must not introduce data exposure beyond the original safe event.

### 9.4 Prompt And Knowledge Safety

- Airtable and Notion content are untrusted input.
- Notion loading must prevent SSRF and oversized response DoS.
- AI prompts must isolate untrusted context.
- Prompt injection indicators must hard fail or route to manual review according to story rules.

### 9.5 Audit Safety

- Audit logs are append-only.
- Redacted metadata should preserve operational usefulness without secret leakage.
- Retention policy is an operational item for production.

## 10. Reliability And Idempotency

Requirements:

- Every external ingress event must have idempotency or dedupe strategy.
- Workers must be safe under redelivery.
- ACK must happen only after durable state commit or confirmed DLQ handling.
- Transient failures retry with bounded backoff.
- Terminal validation/auth/permission failures fail closed and alert operators.

Idempotency examples:

- Airtable event id.
- Approved version idempotency.
- Publish job idempotency key.
- Slack command idempotency key.
- Comment external id.
- Direct message external message id.
- Event bus workspace + idempotency key.

## 11. Reporting Requirements

Campaign reporting must support:

- Filter by campaign/date/channel.
- Published/failed post counts.
- Total comments and risk comments.
- Average response time for resolved interactions.
- CSV export.
- Audit event for report access/export.

Reporting must not expose:

- Raw secrets.
- Full customer DM body unless the endpoint is explicitly designed and authorized for message viewing.
- Raw platform responses.

## 12. AI-SDLC And Governance Requirements

Every material story should have:

- Project-level spec link.
- Story spec or plan.
- Baseline evidence.
- RED evidence for behavior changes or bug fixes.
- GREEN/refactor evidence.
- Build/lint/test evidence.
- Report with open items.
- Runtime smoke evidence before production-ready claims.

Agents must not claim:

- `Verified` without current validation evidence.
- `Production-ready` without runtime/staging smoke and external integration evidence.
- Completion if acceptance criteria are not mapped to evidence.

## 13. Current Implementation Status

Project status:

- **Local verified backend prototype / staging candidate.**

Strong local evidence:

- TypeScript build passes.
- ESLint passes.
- Node test runner passes with hundreds of tests.
- Major backend flows have plans/reports/tests.
- AI-SDLC completion gate pilot exists.

Known limits:

- Production runtime smoke is not complete for every external integration.
- Some platform integrations are schema/topology-compatible rather than fully implemented.
- Facebook OAuth/API production access depends on Meta app permissions and business configuration.
- Zalo, Instagram, WhatsApp, TikTok, LinkedIn, YouTube, Threads, and X/Twitter require dedicated MCP tool implementation before production use.
- External deployment/operations runbooks need final hardening.

## 14. Acceptance Criteria For The Whole Project

### AC-PROJ-001: Multi-Channel Architecture

Given a new platform is added  
When platform-specific MCP tools and channel account configuration exist  
Then orchestration should route through MCP and RabbitMQ without direct platform API calls from the orchestrator.

### AC-PROJ-002: Approved Content Pipeline

Given an Airtable post is approved  
When the webhook is received  
Then the system reloads Airtable, creates a workflow once, generates AI content, validates policy, and creates publish work only when safe.

### AC-PROJ-003: Safe Publish Boundary

Given a publish job is ready  
When the worker executes it  
Then platform API calls happen inside MCP and no raw token appears in queue/log/audit/Slack/Airtable.

### AC-PROJ-004: Engagement Handling

Given a comment or DM arrives  
When it is ingested  
Then the Ledger stores the durable state, Slack receives only safe previews, and authorized users can reply/escalate through command flows.

### AC-PROJ-005: Operational Auditability

Given any external event, AI run, policy decision, publish job, command, comment action, or DM action  
When it changes state  
Then an audit entry or durable event record exists with sanitized metadata.

### AC-PROJ-006: Reliability Under Redelivery

Given RabbitMQ redelivers a message  
When the worker processes it  
Then idempotency prevents duplicate side effects.

### AC-PROJ-007: Tenant Safety

Given two workspaces exist  
When users/workers query or mutate tenant data  
Then workspace-scoped RLS and repository checks prevent cross-tenant leakage.

### AC-PROJ-008: Governance

Given a story is claimed complete  
When the AI-SDLC gate is applied  
Then required spec/plan/test/report evidence must exist and match the claim.

## 15. Test Strategy

Required test layers:

- Shared contract tests for event/API schemas.
- Unit tests for policy rules, parsers, redactors, and repositories.
- Worker tests for idempotency and ACK ordering.
- Route tests for auth, validation, and transaction safety.
- MCP tool tests with mock platform responses.
- Queue topology and retry/DLQ tests.
- Migration/schema tests for RLS, constraints, and append-only audit.
- AI-SDLC gate tests for process automation.

Required runtime smoke before production:

- Database migration apply and verification.
- RabbitMQ topology declaration on target broker.
- Orchestrator health check.
- Slack command request through public tunnel/domain.
- MCP server startup and tool call smoke.
- At least one end-to-end mock or sandbox publish/engagement flow per claimed platform.

## 16. Source-Of-Truth Hierarchy

When documents conflict:

1. This project-level spec.
2. Architecture documents.
3. Coding convention.
4. Product backlog.
5. Function Flow Logic Register.
6. Story plans/specs/reports.
7. Code and tests, when validated and reported.

If code behavior differs from this spec, either:

- Update code through a scoped story with tests, or
- Update this spec with explicit rationale and report evidence.

## 17. Open Items

- Decide whether content-quality checks should be added to the AI-SDLC checker.
- Add CI/pre-commit enforcement for the AI-SDLC gate if desired.
- Produce public demo runbook separated from internal production gaps.
- Add dedicated MCP specs for Instagram, Zalo, WhatsApp, TikTok, LinkedIn, YouTube, Threads, and X/Twitter before implementing those production integrations.
- Add runtime smoke reports for any platform claimed as staging or production ready.
