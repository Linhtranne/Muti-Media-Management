# 03 - Story Status Template

Use this template to review or hand off a User Story in this repo.

Copy into a new report, planning note, or status update as needed.

```markdown
# Story Status: US-XXX - <Story Title>

**Date:** YYYY-MM-DD
**Agent:** <agent/model/name>
**Status:** Not Started / Planned / In Progress / Implemented / Verified / Partial / Blocked
**Scope:** <one-sentence scope>

## 1. Source Documents Reviewed

- [ ] `docs/architecture/06_Architecture_Composability.md`
- [ ] `docs/architecture/11_Coding_Convention.md`
- [ ] `docs/requirements/04_Product_Backlog.md`
- [ ] `docs/requirements/05_Function_Flow_Logic_Register.md`
- [ ] `docs/plans/<US>/...`
- [ ] `docs/reports/<US>/...`
- [ ] `db/migrations/...`
- [ ] Relevant `apps/**` and `packages/**` code

Notes:
- <What mattered from the docs>

## 2. Acceptance Criteria Mapping

| AC | Requirement | Evidence | Status |
|:---|:---|:---|:---|
| AC1 | <text> | <file/test/runtime evidence> | Pass / Partial / Fail / Not checked |
| AC2 | <text> | <file/test/runtime evidence> | Pass / Partial / Fail / Not checked |
| AC3 | <text> | <file/test/runtime evidence> | Pass / Partial / Fail / Not checked |
| AC4 | <text> | <file/test/runtime evidence> | Pass / Partial / Fail / Not checked |

## 3. Implementation Surface

### Files Created

| File | Purpose |
|:---|:---|
| `<path>` | <purpose> |

### Files Modified

| File | Purpose |
|:---|:---|
| `<path>` | <purpose> |

### Files Deleted

| File | Reason |
|:---|:---|
| `<path>` | <reason> |

## 4. Runtime Flow

```text
<trigger>
 -> <route/consumer>
 -> <worker/service>
 -> <repository/MCP/external dependency>
 -> <Ledger state>
 -> <ACK/audit/output>
```

Explain:
- Trigger:
- Input:
- Processing:
- Output:
- Error handling:
- Audit:

## 5. Data and Schema

### Database

- Migration(s):
  - `<migration.sql>`: <what it adds/changes>

### Shared Contracts

- Schema(s):
  - `<schema>`: <purpose>

### Queue Topology

| Exchange | Queue | Routing key | DLQ | Retry |
|:---|:---|:---|:---|:---|
| `<exchange>` | `<queue>` | `<routing_key>` | `<dlq>` | `<strategy>` |

## 6. Security and Privacy Review

- [ ] No raw token in logs.
- [ ] No raw token in queue payload.
- [ ] No raw token in Slack/Airtable/Notion/audit.
- [ ] `workspace_id` scoped in DB paths.
- [ ] Role/permission checks are server-side.
- [ ] Idempotency key exists and is workspace-scoped.
- [ ] Worker ACK happens after Ledger commit or confirmed DLQ/retry publish.
- [ ] Audit metadata is redacted.
- [ ] External platform code stays inside MCP server if applicable.

Notes:
- <security notes>

## 7. Validation Evidence

### Commands Run

```powershell
<command>
```

Result:
- Pass / Fail
- Evidence:

### Tests

| Test | Result | Notes |
|:---|:---|:---|
| `<test>` | Pass / Fail / Not run | <notes> |

### Runtime Smoke

| Check | Result | Notes |
|:---|:---|:---|
| Health | Pass / Fail / Not run | <notes> |
| DB | Pass / Fail / Not run | <notes> |
| RabbitMQ | Pass / Fail / Not run | <notes> |
| Slack | Pass / Fail / Not run | <notes> |
| MCP/Facebook | Pass / Fail / Mock only / Not run | <notes> |

## 8. Known Limitations

- <limitation>

## 9. Production Readiness

**Verdict:** Ready / Not Ready / Ready with blockers / Staging only

Required before production:

- [ ] <item>
- [ ] <item>

## 10. Open Questions

| ID | Question | Owner | Needed Before Coding? |
|:---|:---|:---|:---|
| OQ-XXX-1 | <question> | <owner> | Yes / No |

## 11. Decision Log

| Decision | Rationale | Alternatives |
|:---|:---|:---|
| <decision> | <why> | <alternatives> |

## 12. Final Summary

<Short factual summary. Separate verified facts from assumptions.>
```

## Status definitions

| Status | Meaning |
|:---|:---|
| Not Started | No plan or implementation exists. |
| Planned | Plan exists, no implementation committed. |
| In Progress | Implementation started, not fully verified. |
| Implemented | Code/docs written, but full validation may be pending. |
| Verified | Acceptance criteria mapped to evidence and validation passed. |
| Partial | Some ACs done, some missing or unverified. |
| Blocked | Cannot proceed without external decision, credential, platform permission, or dependency. |

## Minimum status update format

Use this shorter format for quick handoffs:

```markdown
## US-XXX Quick Status

**Verdict:** <one line>

**Verified**
- <file/command/test evidence>

**Not Verified**
- <what has not been checked>

**Risks**
- <risk>

**Next Action**
- <single concrete next action>
```

