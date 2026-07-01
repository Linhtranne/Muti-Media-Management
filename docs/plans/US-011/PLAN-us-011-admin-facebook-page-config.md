# AI-SDLC Retrofit Header for US-011

status: approved

## Goal

Maintain US-011 behavior for Admin Facebook Page Configuration according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-011` passes after retrofit artifacts are present.

# Plan: US-011 Admin Facebook Page Config

**Version:** 1.0.0
**Status:** Draft / Pending Review
**Date:** 2026-06-02
**Related US:** US-011

## 1. Docs Read + Extracted Constraints

**Documents Read:**
1. `docs/architecture/06_Architecture_Composability.md`
2. `docs/architecture/11_Coding_Convention.md`
3. `docs/requirements/04_Product_Backlog.md` (US-011)
4. `docs/requirements/05_Function_Flow_Logic_Register.md`
5. `docs/plans/US-010/PLAN-us-010-operational-ledger-audit-log.md`
6. `db/migrations/0002_us002_channel_accounts.sql`

**Constraints Extracted:**
- **Business Rule 1 (BR1):** Only Admin can connect/disconnect a Facebook Page. Role check via `workspace_members.role`.
- **Business Rule 2 (BR2):** Tokens must be stored in secret storage. Ledger stores only a reference (`secret_ref` / `token_id`).
- **Business Rule 3 (BR3):** Required Meta permissions must be verified against official docs before production.
- **Architectural Boundary:** Platform API/OAuth/Graph API logic MUST reside within `apps/facebook-mcp-server`, NOT `orchestrator`.
- **Orchestrator Role:** Handles auth/admin routes, Ledger state (upsert), invoking MCP tools, writing audit logs via `AuditLogRepository`, and optional Airtable status sync (using safe fields only).
- **Security / No Raw Token Leak:** No raw access token, refresh token, app secret, auth code, or `secret_ref` should appear in Slack, Airtable, logs, or audit metadata.
- **Audit Logging:** Token health checks and all related state changes must write an append-only audit log using the new `AuditLogRepository` from US-010.

## 2. Current Repo State Scan

Based on the provided context and migration `0002_us002_channel_accounts.sql`:
- The repo currently has a `channel_accounts` table: `id`, `workspace_id`, `platform`, `airtable_channel_account_record_id`, `external_account_id`, `display_name`, `status`, `token_status`, `secret_ref`, `connected_at`, `updated_at`.
- Existing workers/components (e.g., `channelAccountResolver`, `mcpValidateWorkerRepository`, `slackCommentActionWorker`, `facebook-mcp-server` tools/SecretStore) are directly reading `channel_accounts.secret_ref`.
- **Constraint:** We cannot break existing code immediately. The plan must introduce `token_references` as the canonical token entity, but maintain backward compatibility during a transition period (e.g., backfilling or dual-writing `channel_accounts.secret_ref`).

## 3. Scope / Out of Scope

**In Scope:**
- Canonical `token_references` table and additive changes to `channel_accounts`.
- Facebook OAuth flow (Generate URL, Callback exchange, Page selection).
- SecretStore abstraction for token storage (MCP side).
- Ledger upsert and token health check logic.
- Admin-only routes for connection management.
- Audit logging of all actions using `AuditLogRepository`.
- Optional safe-field sync to Airtable.
- Feature flagging the OAuth endpoints.

**Out of Scope:**
- Creating a custom Admin UI in this PR (API-only MVP + Airtable sync).
- Immediate removal/refactor of `channel_accounts.secret_ref` reads from all existing workers (will be handled as a separate technical debt/transition task).

## 4. Architecture Flow

1. **Admin initiates OAuth:** Admin calls an Orchestrator API endpoint to initiate the Facebook connection. The Orchestrator calls the MCP tool `generate_oauth_url`.
2. **OAuth callback:** Facebook redirects to the Orchestrator with an `auth_code` and `state`. The Orchestrator verifies the `state` (CSRF).
3. **Token exchange/storage & Page Selection:** 
   - Orchestrator passes `auth_code` to MCP tool `exchange_code_and_list_pages`.
   - MCP Server exchanges code for a User Access Token, lists managed Pages, and returns the sanitized list (no raw tokens returned to Orchestrator).
   - Admin selects a Page (or automatically selects if single page).
   - Orchestrator calls MCP tool `connect_page` with selected `page_id`.
   - MCP Server exchanges short-lived token for long-lived Page Token, stores it via `SecretStore`, and returns a `secret_ref`, scopes, and expiry info.
4. **Ledger upsert:** Orchestrator upserts the `token_references` and `channel_accounts` tables in the Ledger and writes an Audit log.
5. **Token health check:** Scheduled job or manual trigger calls Orchestrator, which calls MCP tool `health_check_token`. MCP verifies the token validity/scopes. Orchestrator records audit and updates `token_status`.
6. **Disconnect:** Admin calls Orchestrator to disconnect. Orchestrator marks the Ledger records as inactive/revoked and optionally calls an MCP tool to revoke on Meta.

## 5. Security Boundary

- **Raw Token Boundary:** Raw tokens, app secrets, and auth codes NEVER leave the `facebook-mcp-server` process during storage/execution. Orchestrator never sees them except as transient arguments passed to MCP during setup (auth code).
- **Secret Ref Boundary:** The `secret_ref` is stored in the Ledger but MUST NOT be exported to Airtable, Slack, audit logs, or general API responses.
- **Forbidden Fields in Audit/Logs/Slack/Airtable:** `token`, `access_token`, `refresh_token`, `secret`, `secret_ref`, `authorization`, `auth_code`.
- **State Parameter / CSRF Protection:** The OAuth initiation must generate a cryptographically secure `state` parameter bound to the `workspace_id` and admin session, verified in the callback.
- **Admin Role Mapping:** Orchestrator endpoints must explicitly verify `workspace_members.role == 'admin'` before allowing OAuth initiation or page disconnect.

## 6. Database Plan

**Migration: `0011_us011_admin_facebook_page_config.sql`**

- **Create `token_references` table:**
  - `id` UUID PRIMARY KEY
  - `channel_account_id` UUID NOT NULL REFERENCES channel_accounts(id)
  - `workspace_id` TEXT NOT NULL
  - `secret_ref` TEXT NOT NULL
  - `scopes` JSONB NOT NULL DEFAULT '[]'::jsonb
  - `expires_at` TIMESTAMPTZ NULL
  - `status` TEXT NOT NULL DEFAULT 'active'
  - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- **Additive changes to `channel_accounts`:**
  - Keep `secret_ref` for backward compatibility. Add a comment indicating it is slated for deprecation.
  - Ensure `last_checked_at` TIMESTAMPTZ NULL exists.
- **RLS Policies:**
  - `ENABLE RLS` on `token_references`.
  - `USING (workspace_id = current_setting('app.current_workspace_id', true))`
  - `WITH CHECK (...)`
- **Unique Indexes:**
  - Unique index on `channel_account_id` where status is 'active' (to ensure one active token per account).
- **Compatibility/Backfill Strategy:**
  - Upserting a new token will write to `token_references` AND update `channel_accounts.secret_ref`. Existing workers reading `channel_accounts.secret_ref` will continue to function.

## 7. Shared Contracts

Located in `packages/shared-contracts`:
- **OAuth Schemas:** Zod schemas for `OAuthStartRequest`, `OAuthCallbackPayload`, `PageSelectionPayload`.
- **Result Schemas (Strict):** `ConnectPageResult` containing ONLY sanitized data (`external_account_id`, `display_name`, `scopes`, `expires_at`, `secret_ref`). NO raw tokens.
- **Health Check Schema:** `TokenHealthCheckResult` containing `status` (`valid`, `expired`, `missing_permissions`), `missing_scopes`, and `last_checked_at`.
- **Forbidden Fields Tests:** Ensure Zod schemas explicitly `omit` or strip forbidden fields to prevent accidental leakage.

## 8. MCP Server Plan

Implement the following tools in `apps/facebook-mcp-server`:
- `generate_oauth_url(input)`: Generates FB OAuth URL with `FACEBOOK_APP_ID`, `FACEBOOK_REDIRECT_URI`, `FACEBOOK_REQUIRED_SCOPES`, and secure `state`.
- `exchange_code_and_list_pages(input)`: Exchanges `auth_code` for user access token. Fetches `/me/accounts`. Returns sanitized list of Pages.
- `connect_page(input)`: Receives selected `page_id` and user token. Exchanges for long-lived Page Token. Stores token using `SecretStore.storeSecret(workspace_id, token)`. Returns `secret_ref`.
- `health_check_token(input)`: Uses `SecretStore.getSecret(secret_ref)`. Calls Graph API `/debug_token` or `/me/permissions`. Validates against `FACEBOOK_REQUIRED_SCOPES`. Returns `TokenHealthCheckResult`.
- **Constraints:** Returns ONLY sanitized results.

## 9. Orchestrator Plan

Implement the following in `apps/orchestrator`:
- **Admin-only Routes:** `GET /api/v1/facebook/auth/start`, `GET /api/v1/facebook/auth/callback`, `POST /api/v1/facebook/auth/connect`, `POST /api/v1/facebook/auth/disconnect`.
- **Middleware:** Verify `workspace_members.role == 'admin'`.
- **MCP Calls:** Call the tools implemented in the MCP server.
- **Ledger Upsert:** Atomically update `channel_accounts` (including `secret_ref` for compatibility) and insert/update `token_references`.
- **Audit Logging:** Use `AuditLogRepository` to emit `FACEBOOK_PAGE_CONNECTED`, `FACEBOOK_PAGE_DISCONNECTED`, `TOKEN_HEALTH_CHECK_COMPLETED`, `TOKEN_HEALTH_CHECK_FAILED`.
- **Airtable Sync (Optional):** Sync `status` and `token_status` to Airtable, strictly avoiding `secret_ref`.

## 10. Env Vars

Require the following in `.env`:
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET` (MCP server only)
- `FACEBOOK_REDIRECT_URI`
- `FACEBOOK_REQUIRED_SCOPES` (e.g., `pages_show_list,pages_read_engagement,pages_manage_posts,publish_video`)
- **Secret Provider Config:** `SECRET_PROVIDER_TYPE` (e.g., `env`, `vault`, `insforge`)
- **Feature Flag:** `FACEBOOK_PAGE_CONFIG_ENABLED=false` (Default false for safe rollout)

## 11. Test Matrix

- **Admin happy path:** OAuth initiation -> callback -> page selection -> connect -> Ledger updated.
- **Non-admin forbidden:** Initiating auth with non-admin role returns 403.
- **Invalid state/callback rejected:** CSRF token mismatch or invalid code fails gracefully.
- **Missing permission mapped clearly:** Health check identifies and reports missing required scopes.
- **Token never leaked:** Verify API responses, Slack mocks, Airtable mocks, and Audit logs do not contain raw tokens or `secret_ref`.
- **Upsert/backfill:** Connecting an existing page updates the existing `channel_accounts` record and adds a new `token_references` row.
- **Health check:** `valid` updates `last_checked_at`; `expired` updates `token_status` and alerts.
- **Disconnect:** Marks `channel_accounts.status = 'inactive'`, `token_references.status = 'revoked'`.
- **Audit:** All actions successfully log via `AuditLogRepository`.
- **RLS fail-closed:** Ensure DB transactions execute under the correct `workspace_id` setting.

## 12. Migration Safety / Rollback

- **Additive Schema:** Adding `token_references` and keeping `channel_accounts.secret_ref` ensures backward compatibility.
- **Worker Stability:** Existing workers reading `channel_accounts.secret_ref` will not break.
- **Feature Flag:** `FACEBOOK_PAGE_CONFIG_ENABLED` allows turning off the new admin routes instantly without rollback of DB schema.

## 13. Important Plan Decisions (Approved)

1. **Secret Storage:** MVP uses `env` reference (`env:<VAR_NAME>`) for `secret_ref` to align with current code. `token_references` is designed as provider-agnostic for future Vault/InsForge adoption.
2. **Admin Flow:** API-only admin flow for MVP. No custom UI or Slack admin command in US-011.
3. **Airtable Sync:** Sync safe status fields back to Airtable (`channel_status`, `token_status`, `connected_at`, `last_checked_at`, `permission_status`, `permission_error_code`, `ledger_channel_account_id`). No secrets or raw responses synced.
4. **Permissions:** MVP required Meta permissions are `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
5. **Multi-Page Support:** Multiple Pages per workspace are supported in MVP. Unique key is `workspace_id + platform + external_account_id`.
6. **Disconnect Behavior:** Soft disconnect in Ledger (mark inactive/revoked and audit). No Graph API revoke in US-011.
7. **Canonical `token_references`:** Introduce `token_references` as the source of truth, but dual-write to `channel_accounts.secret_ref` to maintain compatibility during the transition period.
8. **Feature Flag:** Default `FACEBOOK_PAGE_CONFIG_ENABLED` to `false`.

## 14. Production Blockers / Open Questions

*(All Open Questions resolved as per review on 2026-06-02. Plan locked for Implementation.)*

## 15. Implementation Task Breakdown

- `[ ]` **T-011-1:** Add Zod schemas to `shared-contracts` and unit tests ensuring no forbidden fields leak.
- `[ ]` **T-011-2:** Create migration `0011_us011_admin_facebook_page_config.sql`.
- `[ ]` **T-011-3:** Implement MCP tools: `generate_oauth_url`, `exchange_code_and_list_pages`, `connect_page`, `health_check_token`.
- `[ ]` **T-011-4:** Implement Orchestrator routes for OAuth start, callback, and disconnect. Add Admin role validation.
- `[ ]` **T-011-5:** Implement Ledger upsert logic (dual-write to `channel_accounts.secret_ref`) and Audit logging.
- `[ ]` **T-011-6:** Add tests for the full test matrix (Admin constraints, Token boundaries, RLS).
- `[ ]` **T-011-7:** Write US-011 implementation report.


## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: Planned and defined.
- AC2: Planned and defined.
- AC3: Planned and defined.
- AC4: Planned and defined.
