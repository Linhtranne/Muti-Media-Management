# 02 - Validation Gate

File này định nghĩa các cổng kiểm tra trước khi một agent được phép nói task đã hoàn tất.

## 1. Validation levels

Không phải task nào cũng cần chạy toàn bộ test. Chọn gate theo risk.

| Level | Khi dùng | Validation tối thiểu |
|:---|:---|:---|
| L0 - Docs only | Chỉ tạo/sửa docs | Kiểm tra file tồn tại, link/path hợp lệ, không sửa code production |
| L1 - Type/schema only | Sửa shared contracts, types, config nhỏ | `npm run build` hoặc `npm run typecheck` |
| L2 - Unit scope | Sửa service/worker/repository nhỏ | Build + targeted tests |
| L3 - Integration boundary | Sửa route, queue, DB, MCP, Slack, Airtable | Build + targeted route/worker/queue tests + relevant contract tests |
| L4 - System critical | Sửa idempotency, token, RLS, migration, ACK/DLQ | Build + full relevant suite + security negative tests + migration review |
| L5 - Runtime/staging | Deploy/config/external integration | Smoke test against running service + DB/RabbitMQ/Slack/InsForge verification |

## 2. Standard commands

Root commands:

```powershell
npm run build
npm run lint
npm test
npm run ai-sdlc:validate -- <STORY-ID>
npm run verify:db
```

`npm run ai-sdlc:validate -- <STORY-ID>` is the official Automated L2 local quality gate for story completion claims. It runs build, lint, full tests, and the AI-SDLC artifact checker for the provided story id.

Do not wire the story-aware gate directly into `npm run lint`. Keeping `lint` story-agnostic preserves normal development flow while still allowing reviewers and agents to run the full story gate before reporting completion.

If the story id is missing, the command must fail with:

```text
Usage: npm run ai-sdlc:validate -- <STORY-ID>
```

Helpful operational commands:

```powershell
npm run start:orchestrator
npm run start:ngrok
npm run seed:slack-admin -- <SLACK_USER_ID> admin
npm run rabbitmq:reset-slack
npm run db:apply -- db/migrations/<file>.sql
```

Use targeted tests where possible:

```powershell
node --test apps/orchestrator/dist/__tests__/<test-file>.js
node --test apps/orchestrator/dist/workers/__tests__/<test-file>.js
node --test apps/orchestrator/dist/queue/__tests__/<test-file>.js
node --test apps/facebook-mcp-server/dist/__tests__/<test-file>.js
node --test packages/shared-contracts/dist/__tests__/<test-file>.js
node --test packages/policy-engine/dist/__tests__/<test-file>.js
```

## 3. Gate by change type

### Documentation-only change

Required:

- Confirm files created/modified under requested docs path.
- Confirm no production code changed.
- Confirm document references actual repo paths/modules.
- If docs define process, ensure it does not conflict with `AGENTS.md` or architecture docs.

Suggested:

```powershell
git diff -- docs/ai-sdlc
git status --short
```

### Shared contracts change

Required:

- Build.
- Contract tests.
- Search all producers and consumers for schema usage.
- Update `run-tests.mjs` if new test files are added.

Checklist:

- `.strict()` where security-sensitive.
- Forbidden fields still rejected.
- Event version convention preserved.
- No raw token/body/secret fields introduced.

### Route/API change

Required:

- Build.
- Targeted route tests.
- Validation/error-path tests.
- Authorization tests.
- Audit behavior review.

Extra for Slack:

- Raw body signature verification still works.
- Response stays within Slack timeout expectation.
- Role lookup uses `workspace_members`.

Extra for Facebook admin:

- Token never returns to client.
- OAuth state/session is single-use.
- Mock mode cannot run in production.

### Worker change

Required:

- Build.
- Targeted worker tests.
- Verify state transitions.
- Verify retryable vs terminal errors.
- Verify idempotency/duplicate path.

Checklist:

- No external API call while holding long DB transaction unless justified.
- ACK only after commit or confirmed DLQ/retry publish.
- No raw sensitive data in logs/audit.

### Queue change

Required:

- Build.
- Queue tests for schema invalid, success, retry and DLQ.
- Confirm exchange, queue, routing key and DLQ compatibility.
- Confirm confirm-channel or publish confirmation where required.

Checklist:

- Existing queue declarations are backward-compatible.
- Retry count is bounded.
- DLQ payload is sanitized.
- Idempotency updates are workspace-scoped.

### Database migration change

Required:

- Read current migrations order.
- Ensure filename number is next in sequence unless intentionally modifying un-applied local migration.
- Review additive/backfill/drop order.
- Check RLS policies include correct tenant isolation.
- Check indexes for new polling/reporting paths.

Do not:

- Drop data without explicit user approval.
- Add `NOT NULL` before backfill.
- Rename columns without compatibility plan.
- Disable RLS to “make tests pass”.

### MCP/server tool change

Required:

- Build.
- MCP contract tests.
- Tool handler tests.
- Secret redaction tests.

Checklist:

- Orchestrator does not receive raw token.
- Tool result is strict and sanitized.
- Platform errors are mapped to domain errors.
- `FACEBOOK_MOCK_MODE=true` remains staging-only.

## 4. Security gate

Run this checklist for any sensitive path:

- [ ] No `access_token`, `refresh_token`, `authorization`, `bearer`, `api_key`, `secret`, `secret_ref` leaks in queue payload, Slack text, Airtable update or audit metadata.
- [ ] `AuditLogRepository` or equivalent redactor is used.
- [ ] Payload schemas reject forbidden fields.
- [ ] DB queries are scoped by `workspace_id`.
- [ ] Role checks do not trust client-provided role headers.
- [ ] External errors are sanitized before logs and responses.
- [ ] Raw provider response is not stored unless explicitly sanitized and justified.

Useful search:

```powershell
rg -n "access_token|refresh_token|authorization|bearer|api_key|secret_ref|raw_response|raw_payload" apps packages docs
```

Search findings are not automatically bugs; inspect context before changing.

## 5. Runtime smoke tests

### Orchestrator health

```powershell
npm run start:orchestrator
curl.exe http://localhost:3000/health
```

Expected:

```json
{"status":"ok"}
```

### InsForge

```powershell
npm run verify:db
npx @insforge/cli db tables
```

### Slack/ngrok

```powershell
npm run start:ngrok
curl.exe -H "ngrok-skip-browser-warning: true" https://<ngrok-domain>/health
```

Slack slash command Request URL:

```text
https://<ngrok-domain>/api/v1/slack/commands
```

### Facebook mock mode

For local/staging demos when Meta permission is blocked:

```env
FACEBOOK_MOCK_MODE=true
NODE_ENV=staging
```

Never use in production:

```env
NODE_ENV=production
FACEBOOK_MOCK_MODE=true
```

must fail.

## 6. Evidence standard

A final answer/report must state:

- Commands run.
- Pass/fail result.
- If not run, why not.
- Which behavior was verified by tests vs by inspection.
- Remaining risk/open item.

Before using `Verified`, `done`, or `production-ready`, also apply:

```text
docs/ai-sdlc/04_COMPLETION_GATE.md
```

For implementation or behavior work with a story id, prefer the combined command:

```powershell
npm run ai-sdlc:validate -- <STORY-ID>
```

This command is additive. It does not replace targeted tests, runtime smoke tests, or external integration checks when those are required by risk level.

That file is the fail-closed completion checklist for spec approval, plan approval, baseline, red test evidence, build/lint/test evidence, report evidence, open items, and runtime smoke.

Example:

```text
Verified:
- npm run build: pass
- node --test apps/orchestrator/dist/__tests__/slackCommandsRoute.test.js: pass

Not run:
- Full npm test, because task changed docs only.

Open:
- No runtime staging smoke test was required for docs-only change.
```

## 7. When validation fails

If validation fails:

1. Do not hide the failure.
2. Identify if failure is caused by your change, existing unrelated issue, or environment.
3. Fix if in scope.
4. If unrelated, document exact failing test/command and why it is not addressed.
5. Never mark task completed solely because code compiles if relevant tests fail.
