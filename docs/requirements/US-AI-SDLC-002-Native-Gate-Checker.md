---
id: US-AI-SDLC-002
status: approved
priority: high
owner: AI Orchestrator
updated: 2026-06-29
---

# US-AI-SDLC-002 - Native Completion Gate Checker

## User

As an AI-driven SDLC developer / reviewer

## Need

I want the completion gate checker to run automatically in git pre-commit/CI, check content quality/rejection of placeholders, verify AC traceability, and run staging smoke connectivity checks for external services.

## Value

So that we guarantee that no non-compliant code or incomplete/placeholder-containing documentation is committed or deployed to production.

## Acceptance Criteria

- AC-001: Git pre-commit hook automatically triggers, extracts STORY-ID from staged changes or branch name, and runs `npm run ai-sdlc:validate`.
- AC-002: Check content quality of markdown files, reject template placeholders (such as TO-DO, T-B-D, SPEC-zeros, etc.), and verify Approved status.
- AC-003: Trace AC codes (`AC-001`, `AC-002`, etc.) from Spec to Plan, test/evidence files, and Report (checking for Pass status).
- AC-004: Run connectivity smoke checks for required services (Postgres, RabbitMQ, Slack, Facebook Graph API, Notion) on staging/runtime.

## Links

- Spec: [[SPEC-AI-SDLC-002-Native-Gate-Checker]]
- Plan: [[PLAN-AI-SDLC-002-Native-Gate-Checker]]
- Report: [[REPORT-AI-SDLC-002-Native-Gate-Checker]]
