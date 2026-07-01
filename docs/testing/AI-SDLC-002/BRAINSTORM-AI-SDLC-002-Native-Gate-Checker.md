# Brainstorming: AI-SDLC-002 Native Gate Checker

## 1. Pre-commit Hook Strategy
- **Option A (Husky)**: Install Husky, write custom hooks under `.husky/`.
  - *Pros*: Standard in JS ecosystem.
  - *Cons*: Adds devDependencies, adds config complexity, requires npm script installation.
- **Option B (Custom Node.js Script)**: Write a simple script `scripts/install-hooks.mjs` that directly writes `.git/hooks/pre-commit` and runs `scripts/pre-commit-gate.mjs`.
  - *Pros*: Zero dependencies, works natively on Windows (via Git Bash) and Unix-like OS, completely tailored to our workspace.
  - *Verdict*: Option B. Keep it simple and dependency-free.

## 2. Content Quality Parsing
- We need to parse markdown and check for:
  - Required sections: e.g. `# SPEC-<ID>`, `Status: Approved`, `Acceptance Criteria`, `Tasks`, etc.
  - Placeholders: Search for `...`, `TBD`, `TODO`, `One sentence.`, `SPEC-000`, `US-000`, `YYYY-MM-DD`.
  - Status fields: Verify they are marked as approved/completed.
- *Implementation*: Read the file content as UTF-8 string, use Regex to match header levels (e.g. `/^##? .*Goal/im`) and search for placeholders.

## 3. AC Tracing (Spec -> Plan -> Test -> Report)
- **Tracing logic**:
  - Spec: Find AC codes like `AC-001` or `AC1` via regex `/AC[-_]?\d+/gi`.
  - Plan: Check if the same codes exist in the plan file text.
  - Test: Check if the same codes exist in the test files (`scripts/__tests__` or `docs/testing/`).
  - Report: Parse the report markdown table and find if all AC codes are mapped to `Pass` status.
- *Trade-offs*: Simple regex matching is highly effective. We don't need a heavy markdown AST parser.

## 4. Staging Smoke Gate
- Check dependencies:
  - **Postgres**: Use `pg` client to query `SELECT 1`.
  - **RabbitMQ**: Use `amqplib` client to connect.
  - **Notion**: Fetch `api.notion.com` via standard `fetch` with timeout.
  - **Slack/MCP**: Check if health ping endpoint is alive.
- If mock mode is active (`FACEBOOK_MOCK_MODE=true`), we bypass Graph API checks but verify mock setup.
