# Coding Convention

## 1. Repository Structure

Recommended when code starts:

```text
apps/
  orchestrator/
  facebook-mcp-server/
  workers/
packages/
  shared-contracts/
  policy-engine/
docs/
  ...
```

## 2. Branch Naming

- `feature/US-001-airtable-schema`
- `feature/US-002-webhook-handler`
- `feature/US-003-ai-composer`
- `hotfix/BUG-001-token-mask`

## 3. Commit Message

Format:

```text
<type>(<scope>): <summary>
```

Types:

- `docs`
- `feat`
- `fix`
- `test`
- `refactor`
- `chore`
- `security`

Examples:

- `docs(backlog): add Airtable webhook user story`
- `feat(orchestrator): handle approved post webhook`
- `security(slack): verify command signature`

## 4. Pull Request Checklist

- Backlog story linked.
- AC covered.
- Tests added or reason documented.
- Function Logic Register updated.
- Secrets are not logged or committed.
- Error handling and audit behavior covered.

## 5. Code Rules

- Use TypeScript for services where possible.
- Keep platform API code inside MCP server, not orchestrator.
- Shared contracts live in `packages/shared-contracts`.
- Policy rules live in `packages/policy-engine`.
- No raw token in logs, Airtable, Slack messages or audit metadata.
- Every external event should have idempotency key or dedupe strategy.
- RabbitMQ messages must contain references, not raw tokens or large payloads.
- Workers must ack only after Ledger state is updated.
- DLQ handling must create an admin-visible alert.

## 6. Environment Variables

Never commit real secrets.

Expected examples:

```text
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
INSFORGE_URL=
INSFORGE_ANON_KEY=
RABBITMQ_URL=
```

## 7. Testing Convention

- Unit test policy engine.
- Integration test webhook handler with sample payload.
- Contract test MCP tool input/output.
- Queue test RabbitMQ retry/DLQ behavior.
- Security test Slack signature verification.
- Regression test duplicate webhook/publish idempotency.
