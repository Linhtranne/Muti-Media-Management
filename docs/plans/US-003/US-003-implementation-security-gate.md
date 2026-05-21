# US-003 Implementation Security Gate

## 1. Purpose

This checklist is the mandatory implementation gate for US-003 before production release. US-003 design is approved, but implementation cannot be released until every P0/P1 gate below has concrete code and test evidence.

## 2. Gate Status

| Attribute | Value |
|:---|:---|
| User Story | US-003 |
| Feature | AI Composer Facebook Variant |
| Gate Type | Security and release readiness |
| Initial Status | Pending implementation evidence |
| Date Created | 2026-05-21 |

## 3. How to Use This Gate

For each gate item, the implementation owner must fill:

- implementation file(s);
- test file(s);
- test command;
- result;
- reviewer;
- final status: `Pending`, `Pass`, `Fail`, or `Blocked`.

No P0 or P1 item may remain `Pending`, `Fail`, or `Blocked` before production release.

## 4. Gate Checklist

| Gate ID | Priority | Requirement | Evidence Required | Implementation Files | Test Files / Command | Status | Reviewer Notes |
|:---|:---|:---|:---|:---|:---|:---|:---|
| SEC-001 | P0 | Every tenant-scoped Postgres transaction executes `SET LOCAL app.current_workspace_id = :workspace_id`. | Integration test proves tenant query fails closed without session context and succeeds with correct context. | TBD | TBD | Pending | Required by T-012 C-001. |
| SEC-002 | P0 | Normal US-003 worker code must not use a service role or connection that bypasses RLS. | Config/code review evidence proving worker DB user is RLS-governed; test or migration guard if available. | TBD | TBD | Pending | Administrative/migration service role must be isolated from tenant worker runtime. |
| SEC-003 | P0 | RLS policies for `ai_generation_runs`, `content_variants`, and `policy_handoff_events` include both `USING` and `WITH CHECK`. | Migration review plus DB tests for cross-workspace read/write denial. | TBD | TBD | Pending | Workspace isolation must be enforced by database, not only application code. |
| SEC-004 | P0 | RabbitMQ messages are references-only and contain no raw content, tokens, prompts, output bodies, CTA text blobs, or assets. | Contract test for US-003 queue envelope schema; fixture with forbidden fields rejected. | TBD | TBD | Pending | Required by architecture and coding convention. |
| SEC-005 | P0 | Worker ACKs RabbitMQ only after durable Ledger commit. | Worker integration test simulates DB failure before commit and proves ACK is not sent; success path proves ACK after commit. | TBD | TBD | Pending | Core at-least-once delivery invariant. |
| SEC-006 | P0 | US-003 cannot publish, create publish jobs, call Facebook Graph API, or invoke MCP publish tools. | Regression test or static boundary test proving no `publish_jobs` insert, Graph API call, or MCP `validate_post` / `enqueue_publish` / `publish_post` call. | TBD | TBD | Pending | Publish boundary belongs to downstream US-004/US-005/US-006. |
| SEC-007 | P0 | Notion URL loader blocks SSRF before network fetch. | Tests for private IP, loopback, link-local, AWS metadata IP, redirect, non-HTTPS, userinfo, nonstandard port, shortened URL, custom domain, and `*.notion.site` default block. | TBD | TBD | Pending | Required by T-012 H-001. |
| SEC-008 | P0 | Prompt injection hard failures do not persist raw malicious output. | Test with dangerous keys or injection text proves `output_snapshot` stores only `rawOutputHash` and sanitized metadata. | TBD | TBD | Pending | Applies to `PROMPT_INJECTION_DETECTED`. |
| SEC-009 | P0 | Logs, audit metadata, Airtable notes, queue payloads, and snapshots are redacted of secrets. | Secret scanner/unit tests for bearer tokens, API keys, vault refs, Airtable/Notion/provider credentials. | TBD | TBD | Pending | No raw token policy. |
| SEC-010 | P1 | Provider credentials are injected in memory only and never serialized into provider request payload logs/errors. | Adapter test proves auth headers are not present in serialized request/error objects. | TBD | TBD | Pending | Applies to all LLM providers. |
| SEC-011 | P1 | AI output is schema-validated before Ledger variant creation or Airtable draft sync. | Test proves malformed JSON, wrong field type, dangerous unknown keys, and corrupted hashtags do not create active `content_variants`. | TBD | TBD | Pending | Protects Airtable review plane. |
| SEC-012 | P1 | CTA URL validation preserves UTM parameters exactly. | Unit tests for valid UTM, missing CTA, invalid CTA, and mutated UTM mapping to expected `AiErrorCode`. | TBD | TBD | Pending | Required by BR3. |
| SEC-013 | P1 | Hashtag normalization lowercases before dedupe and handles unrecoverable corruption as `SCHEMA_PARSING_FAILED`. | Unit tests for missing `#`, duplicate casing, too many hashtags, and non-array corrupted output. | TBD | TBD | Pending | Closes GAP-002. |
| SEC-014 | P1 | Airtable sync failure after Ledger success uses compensation, not rollback. | Integration test proves Ledger success remains committed, `sync_retry_needed = true`, and sanitized audit is written. | TBD | TBD | Pending | Required by T-009. |
| SEC-015 | P1 | Policy handoff uses transactional outbox and references-only `policy.evaluate.requested` event. | DB/outbox test proves event is inserted in same transaction as success state and contains `idempotency_key`. | TBD | TBD | Pending | Required by T-010. |
| SEC-016 | P1 | Retryable provider failures use bounded delayed retry/scheduler, not hot NACK loops. | Worker test proves `retryable_failed` is committed and current delivery is ACKed after commit. | TBD | TBD | Pending | Required by T-004/T-008. |
| SEC-017 | P1 | `ai_generation_runs.error_code` is constrained to a bounded length. | Migration shows `VARCHAR(50)` or equivalent check constraint. | TBD | TBD | Pending | Closes GAP-001. |
| SEC-018 | P1 | Airtable sync uses optimistic locking/version check. | Test proves stale Airtable sync cannot overwrite a newer `approved_version` / variant state. | TBD | TBD | Pending | Closes GAP-004. |

## 5. Required Test Categories

Implementation must include, at minimum:

- database/RLS tests;
- worker ACK/redelivery tests;
- queue contract tests;
- Notion SSRF tests;
- provider adapter redaction tests;
- structured output validation tests;
- Airtable compensation tests;
- policy outbox tests;
- no-publish-boundary regression tests.

## 6. Release Decision Rule

| Condition | Release Decision |
|:---|:---|
| Any P0 gate is `Pending`, `Fail`, or `Blocked` | Block production release. |
| Any P1 gate is `Fail` or `Blocked` | Block production release. |
| Any P1 gate is `Pending` | Requires explicit Tech Lead + Security acceptance before staging only; production remains blocked unless documented as non-applicable. |
| All P0/P1 gates are `Pass` | US-003 may proceed to production release review. |

## 7. Approval Record

| Date | Reviewer | Decision | Notes |
|:---|:---|:---|:---|
| TBD | TBD | Pending | Fill after implementation evidence is attached. |

