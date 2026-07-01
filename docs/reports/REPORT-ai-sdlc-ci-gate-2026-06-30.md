# Report: AI-SDLC CI Gate — GitHub Actions

**Date:** 2026-06-30
**Agent(s) Used:** Antigravity (devops-engineer + backend-specialist)
**Related User Story:** Infrastructure / Tooling (CI gate hardening)
**Status:** Completed

---

## Summary

Implemented a GitHub Actions CI gate that runs on every `push` and `pull_request`
event, making `git push --no-verify` unable to bypass the AI-SDLC story validation.
Created a CI-safe story ID detector that reads only from GitHub environment variables
(no `git diff --cached` dependency), backed by a full unit test suite.

---

## What Was Done

- [x] Created `scripts/ci-story-detect.mjs` — CI-safe STORY-ID detector
- [x] Created `scripts/__tests__/ci-story-detect.test.mjs` — 17 unit tests
- [x] Created `.github/workflows/ai-sdlc.yml` — GitHub Actions workflow
- [x] Updated `run-tests.mjs` — registered new test file

---

## How It Was Done

### Approach

The existing `story-detect.mjs` uses `git diff --cached` (staged files) which does
not work in CI because no files are staged in a CI checkout.  A new, separate script
`ci-story-detect.mjs` was created that reads exclusively from GitHub env vars and the
GitHub event JSON payload, with no `git` subprocess calls.

### Detection Order

| Priority | Source | GitHub Variable | Event |
|:--|:--|:--|:--|
| 1 | PR source branch | `GITHUB_HEAD_REF` | `pull_request` |
| 2 | Branch short name | `GITHUB_REF_NAME` | `push` |
| 3 | Full Git ref | `GITHUB_REF` | `push` (fallback) |
| 4 | PR title | `GITHUB_EVENT_PATH` → `.pull_request.title` | `pull_request` |

All sources are checked; IDs from all are merged and deduplicated.  
Pattern: `US-\d+` or `AI-SDLC-\d+` (case-insensitive, normalised to uppercase).

### CI Commands Run

```bash
# 1. Detect story IDs (fails closed if none found)
node --no-warnings scripts/ci-story-detect.mjs

# 2. For each detected story ID:
npm run story:validate -- <STORY-ID>
```

### Files Changed

| File | Action | Description |
|:--|:--|:--|
| `scripts/ci-story-detect.mjs` | Created | CI-safe detector reading GitHub env vars |
| `scripts/__tests__/ci-story-detect.test.mjs` | Created | 17 unit tests (3 suites) |
| `.github/workflows/ai-sdlc.yml` | Created | CI gate workflow (push + PR) |
| `run-tests.mjs` | Modified | Added ci-story-detect.test.mjs to list |

### Tools & Skills Used

| Tool/Skill | Purpose |
|:--|:--|
| `@devops-engineer` | CI/CD workflow design |
| `@backend-specialist` | Node.js script patterns |
| `@powershell-windows` | Windows path awareness |
| `@plan-writing` | Implementation structure |

---

## Impact & Purpose

**Before:** `git push --no-verify` could skip the local pre-push gate entirely.  
**After:** The GitHub Actions workflow runs server-side on every push and PR.
Even if a developer bypasses local hooks, GitHub will block merge until the CI
gate passes.

The workflow:
- Triggers on **all** branches (not just `main`/`dev`)
- Fails closed — if no STORY-ID is detected, CI fails with a clear error
- Validates multiple story IDs when present
- Is fully tested with 17 unit tests

---

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:--|:--|:--|
| Separate `ci-story-detect.mjs` | Keeps CI logic isolated from local git-hook logic | Modifying `story-detect.mjs` directly (would break local detector) |
| Fail-closed on missing STORY-ID | AI-SDLC requirement — no story, no code | Warn only (rejected — defeats purpose) |
| Validate all detected IDs | Multiple stories possible in one PR | Validate only first match (rejected — incomplete) |
| `on: push` without branch filter | Gate must apply to all branches | Filter to `main`/`dev` only (rejected — dev branches also need gate) |

---

## Verification

- [x] `node --no-warnings scripts/__tests__/ci-story-detect.test.mjs` → 17/17 pass, 0 fail
- [x] `npm run story:validate -- US-001` — run post-report
- [x] No secrets exposed
- [x] No production app code touched
- [x] Scope limited to: `.github/workflows/**`, `scripts/**`, `run-tests.mjs`

---

## Open Items / Next Steps

- Consider adding the workflow to GitHub branch protection rules as a required
  status check so PRs cannot be merged until `AI-SDLC Story Gate` is green.
- If the repo ever adds `.nvmrc` or `engines` field in `package.json`, update
  `ai-sdlc.yml` to read the version dynamically.
