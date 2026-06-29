---
id: US-AI-SDLC-001
status: approved
priority: medium
owner: AI Orchestrator
updated: 2026-06-29
---

# US-AI-SDLC-001 - Completion Gate Checker

## User

As an AI-driven SDLC developer / reviewer

## Need

I want to validate that all required completion artifacts exist for a story ID before declaring it complete.

## Value

So that we guarantee that all required process document evidence is present in the repository.

## Acceptance Criteria

- AC-001: Exit code is 0 when all required files exist.
- AC-002: Exit code is 1 and missing path is printed when a required file is missing.
- AC-003: Exit code is 1 and usage guidance is printed when the story argument is missing.
- AC-004: Available through an npm script.
- AC-005: Build, lint, and test pass after implementation.

## Links

- Spec: [[docs/specs/SPEC-AI-SDLC-001-Completion-Gate-Checker.md|SPEC-AI-SDLC-001-Completion-Gate-Checker]]
- Plan: [[docs/plans/AI-SDLC-001/PLAN-AI-SDLC-001-Completion-Gate-Checker.md|PLAN-AI-SDLC-001-Completion-Gate-Checker]]
- Report: [[docs/reports/AI-SDLC-001/REPORT-AI-SDLC-001-Completion-Gate-Checker.md|REPORT-AI-SDLC-001-Completion-Gate-Checker]]
