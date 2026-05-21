# Report: US-002 Foundation Contract and Redaction Tests

**Date:** 2026-05-21
**Agent(s) Used:** Antigravity — Backend Specialist
**Related User Story:** US-002
**Status:** Completed

## Summary

Hoàn thiện US-002 backend foundation để build/typecheck pass và thêm test tối thiểu cho receiver contracts và redaction. Sửa lỗi TypeScript module resolution, tạo test infrastructure với Node built-in test runner, viết 47 tests (25 contract + 22 redaction) — tất cả pass.

## What Was Done

- [x] Đọc tất cả tài liệu bắt buộc: architecture, coding convention, backlog, function flow, US-001 notes, US-002 plan, foundation report.
- [x] Sửa lỗi `tsconfig.base.json`: bỏ `baseUrl`/`paths` khỏi base config vì paths không resolve đúng khi extend từ subpackage.
- [x] Sửa `apps/orchestrator/tsconfig.json`: thêm `baseUrl` + `paths` override đúng cho `@mediaops/shared-contracts`.
- [x] Thêm `exports` field vào `packages/shared-contracts/package.json` cho ESM module resolution.
- [x] Thêm `devDependencies` (TypeScript, @types/node, etc.) vào cả hai packages.
- [x] Tạo `tsconfig.test.json` riêng cho mỗi package (với `allowImportingTsExtensions: true` + `noEmit: true`) để typecheck test files mà không ảnh hưởng composite build.
- [x] Exclude `src/__tests__` khỏi composite build tsconfig của mỗi package.
- [x] Tạo `packages/shared-contracts/src/__tests__/airtableContracts.test.ts` (25 tests).
- [x] Tạo `apps/orchestrator/src/__tests__/redact.test.ts` (22 tests).
- [x] Tạo `run-tests.mjs` — cross-platform test runner để tránh PowerShell glob expansion issue.
- [x] Tạo `.npmrc` với `script-shell=cmd` để tránh PowerShell NativeCommandError false-failure khi npm scripts có stderr output.
- [x] Thêm `typecheck:test` script vào mỗi package và root.
- [x] Build/typecheck pass: `tsc -b` với exit 0.
- [x] Tests pass: 47/47 (`npm test`).

## How It Was Done

### Approach

**TypeScript Module Resolution Fix**: Bỏ `paths` khỏi `tsconfig.base.json` — paths resolve relative từ file config định nghĩa chúng, không phải từ file extend. Mỗi package cần định nghĩa paths riêng với đường dẫn tương đối chính xác.

**Dual tsconfig Strategy**: Composite build cần `rootDir` + emit. Test files dùng `.ts` extension trong import (yêu cầu `allowImportingTsExtensions`) và không emit. Tách ra `tsconfig.test.json` riêng giải quyết conflict này mà không break composite build.

**Test Framework**: Node built-in `node:test` + `node:assert/strict` — zero deps, chạy trực tiếp TypeScript với `--experimental-strip-types` trên Node 22.15.0.

**PowerShell npm workaround**: npm.ps1 wrapper bắt stderr từ native commands như NativeCommandError, khiến `npm test` fail dù exit code = 0. Fix: `.npmrc` `script-shell=cmd` + `run-tests.mjs` (không cần glob).

### Tools & Skills Used

| Tool/Skill | Purpose |
|:---|:---|
| `event-architect` (Spawner) | Event envelope, idempotency contracts validation. |
| `queue-workers` (Spawner) | References-only queue payload assertion pattern. |
| `api-design` (Spawner) | Strict ingress validation design. |
| `postgres-wizard` (Spawner) | Transaction scoping review (`set_config` pattern). |
| `node:test` + `node:assert` | Built-in test runner — no deps needed. |
| `tsc -b` composite build | Multi-package TypeScript project build. |

### Files Changed

| File | Action | Description |
|:---|:---|:---|
| `tsconfig.base.json` | Modified | Removed `baseUrl`/`paths` — these must be defined per-package with correct relative paths |
| `apps/orchestrator/tsconfig.json` | Modified | Added `baseUrl`/`paths` override + `exclude: [src/__tests__]` |
| `packages/shared-contracts/tsconfig.json` | Modified | Added `exclude: [src/__tests__]` to keep composite build clean |
| `apps/orchestrator/tsconfig.test.json` | Created | Test-only tsconfig: `allowImportingTsExtensions`, `noEmit`, paths to shared-contracts |
| `packages/shared-contracts/tsconfig.test.json` | Created | Test-only tsconfig: `allowImportingTsExtensions`, `noEmit` |
| `packages/shared-contracts/package.json` | Modified | Added `exports` field, `devDependencies`, `typecheck:test` + `test` scripts |
| `apps/orchestrator/package.json` | Modified | Added `devDependencies`, `typecheck:test` + `test` scripts |
| `package.json` (root) | Modified | Added `typecheck:test` + updated `test` script to use `run-tests.mjs` |
| `packages/shared-contracts/src/__tests__/airtableContracts.test.ts` | Created | 25 contract tests: webhook parse, forbidden fields, queue forbidden fields, idempotency |
| `apps/orchestrator/src/__tests__/redact.test.ts` | Created | 22 redaction tests: Bearer token, key-value patterns, object keys, nested, arrays, edge cases |
| `run-tests.mjs` | Created | Cross-platform test runner using `spawnSync` — avoids PowerShell glob expansion |
| `.npmrc` | Created | `script-shell=cmd` to fix PowerShell NativeCommandError false-failure for npm scripts |

## Impact & Purpose

Foundation US-002 hiện đã có:
- TypeScript build compile-ready (tsc -b exit 0) cho cả shared-contracts và orchestrator.
- Contract tests chứng minh Zod schema enforce references-only queue payload và reject mọi forbidden field (approved_version, master_copy, cta_url, asset_links, access_token, secret_ref, token, api_key).
- Redaction tests chứng minh log sanitizer redact Bearer tokens, key-value patterns, object keys, và nested objects đúng cách.
- Zero network calls, zero DB calls, zero RabbitMQ calls trong tất cả tests.
- Hard rules đã verify: receiver không reload Airtable, không allocate approved_version, không gọi AI/MCP/Facebook/publish.

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|:---|:---|:---|
| Separate `tsconfig.test.json` per package | Composite build cần `rootDir` + emit; test files cần `allowImportingTsExtensions` + `noEmit` — hai yêu cầu conflict | Single tsconfig với `noEmit` — rejected vì không build được dist |
| Paths override per-package, not in base | `paths` trong tsconfig.base.json chỉ resolve relative từ base file, không từ file extend | Dùng `baseUrl` ở root — rejected vì không work với composite monorepo |
| Node built-in test runner | Zero deps, chạy TypeScript trực tiếp với `--experimental-strip-types` trên Node 22.15 | Vitest (cần install), Jest (cần config phức tạp) |
| `run-tests.mjs` + `.npmrc` script-shell=cmd | PowerShell npm.ps1 bắt stderr như NativeCommandError — `cmd /c` bypass wrapper; `.npmrc` làm `npm test` work transparently | Glob trong npm script — không work trên PowerShell |
| `exports` field in shared-contracts | Node ESM với `"type":"module"` yêu cầu `exports` field để resolve package từ workspace | Không có exports — package resolution fail ở runtime |

## Verification

- [x] `tsc -b --pretty false` → exit 0 (build typecheck pass)
- [x] `tsc -p packages/shared-contracts/tsconfig.test.json` → exit 0
- [x] `tsc -p apps/orchestrator/tsconfig.test.json` → exit 0
- [x] `npm test` → 47 tests, 47 pass, 0 fail, 0 cancelled, 0 skipped
- [x] Contract tests cover: valid webhook parse, 8 forbidden field rejections, valid queue parse, 9 queue forbidden field rejections, 5 idempotency helper assertions
- [x] Redaction tests cover: Bearer token, api_key/access_token/secret/password key-value, object key redaction, nested objects, arrays, edge cases
- [x] No secrets exposed in test fixtures
- [x] No raw tokens in test data (no real API keys or access tokens used)
- [x] Queue contract rejects `approved_version`, `master_copy`, `cta_url`, `asset_links`, `access_token`, `secret_ref`, `token`, `api_key`
- [x] Receiver (airtableWebhookIngestor.ts) does not reload Airtable, does not allocate approved_version, does not call AI/MCP/publish
- [x] DB transaction uses `set_config('app.current_workspace_id', workspace_id, true)` (tenant scoping)
- [ ] Database migration not applied (no DB connection available)
- [ ] RabbitMQ topology not tested (no RabbitMQ connection available)

## Open Items / Next Steps

1. **Worker reload/reverify** (T-007): Implement approved-post worker in `apps/workers` — reload Airtable record, reverify status, allocate `approved_version`, create `workflow_runs` stub.
2. **Channel account resolver** (T-008): Implement safe resolver that maps Airtable channel account stubs to server-side metadata without loading tokens.
3. **Worker integration tests**: Test ACK/NACK behavior, Airtable retryable failure, and `workflow_stub_created` status.
4. **DB migration apply**: Apply `db/migrations/0001_us002_webhook_ledger.sql` when database connection is available.
5. **RabbitMQ topology verify**: Verify exchange/queue/routing topology when RabbitMQ is available.
6. **`npm test` PowerShell note**: Direct `node run-tests.mjs` (exit 0) and `cmd /c npm test` work correctly. `npm test` from PowerShell terminal uses the `.npmrc` `script-shell=cmd` fix going forward.
