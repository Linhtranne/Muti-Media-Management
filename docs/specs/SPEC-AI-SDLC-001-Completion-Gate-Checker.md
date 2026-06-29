# SPEC-AI-SDLC-001: Completion Gate Checker

**Status:** approved for pilot implementation  
**Approval Evidence:** User requested continuing with Step 5 after the validation gate fixes were pushed.  
**Risk:** Low - process automation script and tests only; no production runtime behavior.

## Goal

Add a lightweight local checker that validates whether a story has the minimum AI-SDLC artifacts before an agent claims completion.

## Users / Roles

- Backend developer using AI agents in this repository.
- AI coding agent preparing a completion report.
- Reviewer checking whether story evidence exists.

## In Scope

- Add a Node.js script that checks required artifact paths for a given story id.
- Add an npm script for running the checker.
- Add unit tests proving pass and fail behavior.
- Add pilot artifacts and an evidence report.

## Out of Scope

- No production service code changes.
- No deploy pipeline integration.
- No automatic Git commit or staging behavior.
- No validation of artifact content quality beyond file existence for this pilot.

## Current Context And Constraints

- The repository already has `docs/ai-sdlc/04_COMPLETION_GATE.md`.
- The project test runner is `node run-tests.mjs`.
- The repo uses ESM (`"type": "module"`).
- Scripts must be local, deterministic, and not require network access.
- The checker must not inspect or print secrets.

## Contract

Command:

```powershell
npm run ai-sdlc:check -- AI-SDLC-001
```

The checker also supports direct Node usage with `--story AI-SDLC-001`.

Required files for pilot story `AI-SDLC-001`:

- `docs/specs/SPEC-AI-SDLC-001-Completion-Gate-Checker.md`
- `docs/plans/AI-SDLC-001/PLAN-AI-SDLC-001-Completion-Gate-Checker.md`
- `docs/testing/AI-SDLC-001/BRAINSTORM-AI-SDLC-001-Completion-Gate-Checker.md`
- `docs/testing/AI-SDLC-001/APPROVAL-AI-SDLC-001-Completion-Gate-Checker.md`
- `docs/testing/AI-SDLC-001/BASELINE-AI-SDLC-001-Completion-Gate-Checker.md`
- `docs/testing/AI-SDLC-001/RED-AI-SDLC-001-Completion-Gate-Checker.md`
- `docs/testing/AI-SDLC-001/GREEN-AI-SDLC-001-Completion-Gate-Checker.md`
- `docs/testing/AI-SDLC-001/REFACTOR-AI-SDLC-001-Completion-Gate-Checker.md`
- `docs/reports/AI-SDLC-001/REPORT-AI-SDLC-001-Completion-Gate-Checker.md`

Exit behavior:

- Exit code `0` when all required files exist.
- Exit code `1` when any required file is missing.

## Happy Path

Given all required files exist  
When the checker is run for `AI-SDLC-001`  
Then it exits successfully  
And prints a summary that all required artifacts exist.

## Error Cases

Given one or more required files are missing  
When the checker is run for a story id  
Then it exits with failure  
And prints the missing file paths.

Given the story argument is missing  
When the checker is run  
Then it exits with failure  
And prints usage guidance.

## Security And Permission Rules

- The checker reads only deterministic artifact paths under `docs/`.
- The checker must not read `.env`, `.env.local`, tokens, databases, queues, or network resources.
- The checker must not modify files.

## Acceptance Criteria

- AC-001: Given all required files exist, when running the checker, then exit code is `0`.
- AC-002: Given a required file is missing, when running the checker, then exit code is `1` and the missing path is printed.
- AC-003: Given the story argument is missing, when running the checker, then exit code is `1` and usage guidance is printed.
- AC-004: The checker is available through an npm script.
- AC-005: Build, lint, and test pass after implementation.

## Tests To Write

- Unit test for successful artifact validation.
- Unit test for missing artifact validation.
- Unit test for missing story argument.
- Unit test for PowerShell/npm positional story argument compatibility.
- Unit test for full pilot evidence path coverage.

## Open Questions

- Should content-quality checks be added later? Deferred. This pilot checks existence only.
- Should this run in pre-commit? Deferred until the checker proves useful.
