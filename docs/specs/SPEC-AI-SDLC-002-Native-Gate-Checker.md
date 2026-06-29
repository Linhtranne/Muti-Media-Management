# SPEC-AI-SDLC-002: Native Completion Gate Checker

**Status:** Approved  
**Approval Evidence:** User approved the implementation plan on 2026-06-29.  
**Risk:** Medium - adds pre-commit hooks, content quality checks, traceability audits, and runtime smoke testing for external services.

## Goal

Automate and elevate the AI-SDLC verification process to a "Native" level:
1. Enforce validation automatically via Git pre-commit hooks and CI.
2. Verify content quality of AI-SDLC artifacts (templates/placeholders rejection).
3. Automate Acceptance Criteria (AC) traceability matching from Spec to Plan, Tests, and Report.
4. Establish a separate staging/runtime smoke test gate for external services.

## Users / Roles

- Backend developer: wants automatic feedback on compliance before committing.
- CI Pipeline: runs the same check in a headless fashion.
- AI Agent: uses the checker to verify its work before handing off.

## In Scope

- **Pre-commit / CI gate**: Parse staged files or branch name for STORY-ID, run validation, block commits on failure.
- **Content Quality Checks**: Verify markdown files, check for template section headings, and reject template placeholders (such as TO-DO, T-B-D, One-sentence description, SPEC-zeros, US-zeros, YYYY_MM_DD, or standalone dots).
- **Traceability Engine**: Extract ACs from Spec, verify references in Plan, verify references in Tests (or test/evidence files), and verify Pass/Completed mapping in Report.
- **Runtime Smoke Gate**: Run active health/connectivity checks for external services required by the story (`postgres`, `rabbitmq`, `facebook`, `slack`, `notion`).

## Out of Scope

- Auto-repairing malformed artifacts.
- Modifying production runtime APIs or business logic.

## Contract / CLI Commands

1. **Gate Check Command**:
   ```powershell
   npm run ai-sdlc:check -- <STORY-ID>
   ```
   Runs artifact presence, content quality, and AC tracing checks.

2. **Validation Command**:
   ```powershell
   npm run ai-sdlc:validate -- <STORY-ID>
   ```
   Runs build, lint, tests, and `ai-sdlc:check`.

3. **Staging Smoke Check Command**:
   ```powershell
   npm run ai-sdlc:smoke -- <STORY-ID>
   ```
   Verifies connectivity to required external services for the story.

4. **Hook Installation Command**:
   ```powershell
   npm run prepare
   ```
   Installs the Git pre-commit hook.

## Acceptance Criteria

- **AC-001: Pre-commit Hook Integration**
  - Git pre-commit hook automatically triggers on commit.
  - Resolves active STORY-ID from staged changes (e.g. file paths containing the story ID) or from the current git branch name.
  - If a STORY-ID is found, invokes `npm run ai-sdlc:validate`. Blocks commit (exit code 1) on failure.
  - If no STORY-ID is found, allows the commit to proceed.

- **AC-002: Content Quality Check**
  - Fails gate checking if any required artifact is empty or missing required sections (e.g. `Goal` in SPEC/PLAN, `Acceptance Criteria` in SPEC, `Tasks` in PLAN, `AI-SDLC Completion Gate` table in REPORT).
  - Fails gate checking if artifacts contain standard template placeholders or empty sections.
  - Ensures Spec status is `Approved` or `approved`.
  - Ensures Plan status is `Approved` or `approved`.

- **AC-003: Traceability Engine**
  - Extracts AC codes matching `/AC[-_]?\d+/gi` from the story's Spec.
  - Fails check if any AC is not mentioned in the Plan, test/evidence files, or is not mapped to a passing status in the Report.

- **AC-004: Runtime Smoke Check**
  - Automatically identifies required external services for a story by scanning for keywords in the Spec or Plan.
  - Probes live connections for:
    - **Postgres**: Verifies query execution.
    - **RabbitMQ**: Verifies channel connection.
    - **Notion**: Pings Notion API domain.
    - **Slack**: Pings ngrok/health server.
    - **Facebook**: Verifies facebook/mcp server status or mock mode staging flag.
  - Returns `0` if all required services are online; `1` otherwise.

## Security Rules

- Hook installation and checking must not write or read private environment secrets to logs.
- External service connectivity checks must use standard configuration environment variables (`.env.local`).

## Tests To Write

- Unit tests for git status / branch parsing logic in the hook.
- Unit tests for markdown quality verification (headings presence, placeholder check).
- Unit tests for AC traceability extraction and cross-check.
- Unit tests for runtime smoke checker mock connections.

## Links
- Requirement: [[US-AI-SDLC-002-Native-Gate-Checker]]
- Plan: [[PLAN-AI-SDLC-002-Native-Gate-Checker]]
