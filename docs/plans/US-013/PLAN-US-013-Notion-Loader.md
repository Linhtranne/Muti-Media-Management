# Spec & Plan: US-013 - Notion Campaign Brief Context Loader

**Task Slug:** US-013-Notion-Loader
**Date:** 2026-06-24
**Target:** Pilot AI-SDLC
**Status:** Implemented - local validation passed, runtime smoke not performed

## 1. Specification (Spec)
Please refer to `docs/specs/SPEC-US-013-Notion-Context-Loader.md` for the approved specification.

## 2. Implementation Plan

### Step 1: Create the Context Loader Utility
**File:** `apps/orchestrator/src/ai/notion-context-loader.ts`
- Implement `loadNotionContext(input, config)`.
- Input validation: enforce `notionPageId` is alphanumeric/dash using regex.
- Hardcode base URL: `https://api.notion.com/v1/blocks/${pageId}/children`.
- Require `config.tokenResolver`; resolve `secretRef` through that injected resolver, then use resolved token only for the Notion Authorization header. Do not log or persist the resolved token.
- Implement response size limit and timeout.
- Return structured `NotionContextResult` matching the spec.

### Step 2: Write Unit Tests (L2 Validation)
**File:** `apps/orchestrator/src/__tests__/notion-context-loader.test.ts`
- **TDD Approach (RED -> GREEN -> REFACTOR):**
  - Test 1: Valid Notion Page ID returns combined text.
  - Test 2: Invalid page ID returns `INVALID_PAGE_ID`.
  - Test 3: API Timeout returns `TIMEOUT_EXCEEDED`.
  - Test 4: Oversized response returns `RESPONSE_TOO_LARGE`.
  - Test 5: 404 Not Found returns `NOT_FOUND`.
  - Test 6: API Error (401/403/500) returns `NOTION_API_ERROR`.
  - Test 7: Malformed response returns `MALFORMED_RESPONSE`.

## 3. Validation Gate & Evidence
**Level:** L2 - Unit scope
**Commands to run:**
```powershell
npm run build
node --test apps/orchestrator/dist/__tests__/notion-context-loader.test.js
```
