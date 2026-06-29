# PLAN-AI-SDLC-002: Native Completion Gate Checker

**Status:** Approved  
**Spec:** `docs/specs/SPEC-AI-SDLC-002-Native-Gate-Checker.md`

## Goal

Provide a robust, automated pre-commit and CI verification gate that enforces artifact presence, quality, AC tracing, and runtime smoke testing.

## Tasks

- [x] **Phase 1: Brainstorm & Baseline**
  - [x] Create brainstorming notes and verify baseline build/lint/test execution.
- [x] **Phase 2: Content Quality Check (AC-002)**
  - [x] Write unit tests for quality checks (placeholder detection, heading verification, spec/plan status).
  - [x] Implement quality checking logic in `scripts/ai-sdlc-check.mjs`.
- [x] **Phase 3: Traceability Engine (AC-003)**
  - [x] Write unit tests for AC tracing (Spec -> Plan -> Test -> Report).
  - [x] Implement AC tracing in `scripts/ai-sdlc-check.mjs`.
- [x] **Phase 4: Pre-Commit Hook & Hook Setup (AC-001)**
  - [x] Write pre-commit hook logic in `scripts/pre-commit-gate.mjs`.
  - [x] Write hook setup installer in `scripts/install-hooks.mjs`.
  - [x] Update `package.json` with scripts.
  - [x] Write unit tests for hook story ID parsing.
- [x] **Phase 5: Runtime Smoke Gate (AC-004)**
  - [x] Write smoke testing logic in `scripts/runtime-smoke.mjs`.
  - [x] Write unit tests for the smoke gate.
- [x] **Phase 6: CI Workflow Setup**
  - [x] Add GitHub Action configuration.
- [x] **Phase 7: Verification & Report**
  - [x] Run all tests and verify all gates pass.
  - [x] Write the completion report.

## Done When

- [x] All unit tests pass.
- [x] `git commit` of a story with placeholders is successfully blocked by pre-commit hooks.
- [x] Content quality and AC tracing check successfully passes for `AI-SDLC-001`.
- [x] Staging smoke check successfully runs against local services.
- [x] Completion report is created.
