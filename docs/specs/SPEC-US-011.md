# SPEC-US-011: Admin Facebook Page Configuration

**Status:** Approved  
**Retrofit Note:** Retrospec — story implemented before AI-SDLC completion gate. Historical RED output not captured. Current verified behavior documented below based on FL-012, code inspection of `facebookAdmin.ts`, and existing tests.  
**FL Reference:** FL-012 (Admin Facebook Page Configuration) — `docs/requirements/05_Function_Flow_Logic_Register.md` line 912  
**Backlog AC/BR:** US-011 AC1–AC4, BR1–BR3

---

## Goal

Allow workspace admins to connect Facebook Pages through OAuth, store token references server-side, view connection status, perform token health checks, and disconnect pages — all without exposing raw tokens to the client, Airtable, Slack, or audit logs.

---

## Source References

- **Backlog:** `docs/requirements/04_Product_Backlog.md` — US-011, Epic E05
- **FL-012:** `docs/requirements/05_Function_Flow_Logic_Register.md` line 912–953
- **Route:** `apps/orchestrator/src/routes/facebookAdmin.ts`
- **Repository:** `apps/orchestrator/src/ledger/channelAccountAdminRepository.ts`
- **MCP Tools:** `apps/facebook-mcp-server/src/tools/facebookAuthTools.ts` (verify path)
- **Reports:** `docs/reports/REPORT-us-011-facebook-mock-mode-2026-06-07.md`, `docs/reports/REPORT-us-011-oauth-callback-state-fix-2026-06-07.md`

---

## In Scope

- Admin-only HTTP routes under `/api/v1/admin/facebook/`:
  - `POST /auth/start` → generate OAuth URL via MCP
  - `GET /auth/callback` → receive OAuth code, exchange via MCP, store session
  - `POST /pages/connect` → select page, store channel account + token reference
  - `POST /pages/:channelAccountId/health-check` → check token validity, update status
  - `POST /pages/:channelAccountId/disconnect` → revoke and remove page connection
- Ledger persistence of `channel_account` and `token_reference` records without raw token.
- Airtable sync of safe status fields (channel account name, `token_status`) where configured.
- Audit log for all admin actions.
- `FACEBOOK_MOCK_MODE=true` for local/staging — must be blocked in production.

## Out of Scope

- Facebook comment sync or publish workflows — those belong to US-007 and US-006.
- Token usage at publish time — token resolution happens in MCP server, not admin route.
- Non-Facebook platforms — this spec covers Facebook Page only.
- Claiming complete historical TDD — US-011 was implemented before the AI-SDLC gate.

---

## Functional Contract

Based on FL-012 and `facebookAdmin.ts` code inspection:

**Flow 1 — OAuth Start:**
1. Validate feature flag (`FACEBOOK_ADMIN_ENABLED`). If disabled → 404.
2. Validate `x-user-id` header maps to `admin` role in `workspace_members`. If not admin → 403.
3. Generate `state` token (single-use, stored in `facebook_oauth_states` with `expires_at`).
4. Call MCP tool `generateOAuthUrl` passing `redirectUri` and `state`. MCP returns OAuth URL without raw app secret.
5. Return OAuth URL to admin client.

**Flow 2 — OAuth Callback:**
1. Validate `code` and `state` query params (`OAuthCallbackQuerySchema`).
2. Look up `facebook_oauth_states` by `state`. Verify not expired and not already used. Mark as used (`UPDATE facebook_oauth_states`).
3. Exchange `code` via MCP tool (MCP calls Facebook OAuth endpoint server-side). MCP returns `user_token_ref` only.
4. Store `facebook_oauth_sessions` row with `user_token_ref`, `actor_id`, `expires_at`.

**Flow 3 — Connect Page:**
1. Admin selects page from session. Validate session exists and not expired.
2. Call MCP to exchange user token for a long-lived page token. MCP stores token in secret store, returns `secret_ref`.
3. `ChannelAccountAdminRepository.upsertChannelAccountAndToken()`: upsert `channel_accounts` (safe metadata: `platform`, `external_account_id`, `display_name`, `token_status = "active"`) and `token_references` (`secret_ref`, `scopes`, `expires_at`). No raw token in DB.
4. Audit log `FACEBOOK_PAGE_CONNECTED`.
5. Sync safe fields to Airtable Channel Accounts record if configured.

**Flow 4 — Health Check:**
1. Validate admin role and `channelAccountId` belongs to workspace.
2. Call MCP token health check tool. MCP reads token from secret store, calls FB debug endpoint, returns `{status, expires_at, scopes}` (no raw token).
3. `repo.updateHealthCheck()`: update `channel_accounts.token_status`, `last_checked_at`.
4. Sync `token_status` to Airtable if `airtable_channel_account_record_id` exists.
5. Audit log `FACEBOOK_PAGE_HEALTH_CHECKED`.

**Flow 5 — Disconnect:**
1. Validate admin role and `channelAccountId`.
2. Get current account state.
3. Call MCP revoke tool (MCP clears token from secret store).
4. Update `channel_accounts.token_status = "disconnected"`.
5. Audit log `FACEBOOK_PAGE_DISCONNECTED`.
6. Sync disconnected status to Airtable if configured.

---

## Data / Queue / API Contract

### HTTP Routes (prefix: `/api/v1/admin/facebook`)
| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/auth/start` | Begin OAuth, returns OAuth URL |
| `GET` | `/auth/callback` | OAuth callback, code exchange |
| `POST` | `/pages/connect` | Connect selected Facebook Page |
| `POST` | `/pages/:channelAccountId/health-check` | Check token status |
| `POST` | `/pages/:channelAccountId/disconnect` | Disconnect page |

- **Auth:** `x-user-id` header → resolved to `admin` role via `workspace_members`
- **Feature flag:** `FACEBOOK_ADMIN_ENABLED` env var required

### Ledger Entities
- **`facebook_oauth_states`:** `{state, workspace_id, actor_id, expires_at, used_at}`
- **`facebook_oauth_sessions`:** `{id, workspace_id, actor_id, user_token_ref, expires_at}`
- **`channel_accounts`:** `{channel_account_id, platform: "facebook", external_account_id, display_name, token_status: "active"|"expired"|"disconnected"|"error", workspace_id, connected_at, last_checked_at, airtable_channel_account_record_id}`
- **`token_references`:** `{token_id, channel_account_id, scopes, expires_at, secret_ref}` — raw token NEVER stored here

### MCP Tool Contracts (opaque from orchestrator side)
- `generateOAuthUrl(redirectUri, state)` → `{url: string}`
- Health check tool → `{status, expires_at, scopes}` (no token)
- Revoke tool → acknowledgement (no token)

---

## Security & Safety Rules

- **Admin only:** Every route validates `x-user-id` maps to `admin` role in `workspace_members` before any operation.
- **Raw token never returned to client or stored in Ledger:** All token operations happen inside MCP server. Orchestrator receives `secret_ref` only.
- **OAuth state single-use:** `facebook_oauth_states` rows are marked used immediately after callback — prevents state replay.
- **Mock mode blocked in production:** `FACEBOOK_MOCK_MODE=true` with `NODE_ENV=production` must cause a hard failure (startup or route guard).
- **No raw token in Airtable or Slack:** Only safe fields (`display_name`, `token_status`) are synced.
- **Audit metadata redacted:** `AuditLogRepository` redactor strips any token-like values before persistence.
- **MCP tools do not return raw tokens to orchestrator** — verified by contract: `generateOAuthUrl`, health check, and revoke all return sanitized results.

---

## Error Cases

| Case | Detection | Action | HTTP Response |
|:---|:---|:---|:---|
| Feature disabled | `FACEBOOK_ADMIN_ENABLED` not set | 404 Not Found | `{"error": "Not found"}` |
| Non-admin role | Role not `admin` in `workspace_members` | 403 Forbidden | `{"error": "Forbidden"}` |
| Invalid OAuth params | `OAuthCallbackQuerySchema` fails | 400 Bad Request | `{"error": "Missing or invalid OAuth code/state"}` |
| Expired OAuth state | `expires_at` in the past | 400/401 | Error response, no token exchange |
| Already-used state | `used_at` set | 400 | Error response, no token exchange |
| MCP timeout/error | MCP tool call fails | 500 Internal | Clean error without raw token/app secret |
| Airtable sync fail after connect | Airtable PATCH 5xx | Log `FACEBOOK_PAGE_AIRTABLE_SYNC_FAILED`, continue | 200 (Ledger is source of truth) |
| Channel account not found | `channelAccountId` not in workspace | 404 Not Found | `{"error": "Not found"}` |

---

## Acceptance Criteria

**AC1 — Token never exposed to client or Airtable (Backlog AC1, BR2)**
- *Given* an admin completes the OAuth flow and connects a Facebook Page
- *When* the route stores the result and returns a response
- *Then* the HTTP response body contains no `access_token`, `refresh_token`, or raw bearer string; `channel_accounts` contains only `secret_ref`; Airtable sync record contains only `display_name` and `token_status`.
- *Trace evidence:* Test case `"should connect page and return only safe channel metadata"` in [facebookAdminRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookAdminRoute.test.ts) and [REPORT-us-011-implementation-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-011-implementation-2026-06-02.md).

**AC2 — Admin sees connected/expired status (Backlog AC2)**
- *Given* a connected page whose token has expired (health-check returns `expired`)
- *When* `POST /pages/:channelAccountId/health-check` is called
- *Then* `channel_accounts.token_status = "expired"` is updated and audit log `FACEBOOK_PAGE_HEALTH_CHECKED` is written.
- *Trace evidence:* Test case `"should check health status and update token_status to expired if invalid"` in [facebookAdminRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookAdminRoute.test.ts).

**AC3 — Missing permission produces clear error (Backlog AC3)**
- *Given* a non-admin user (`creator` role) sends `POST /auth/start`
- *When* the route checks `x-user-id` against `workspace_members`
- *Then* the response is HTTP 403 with a clean error message; no OAuth state is stored; no MCP call is made.
- *Trace evidence:* Test case `"should reject non-admin request with 403 Forbidden"` in [facebookAdminRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookAdminRoute.test.ts).

**AC4 — Token health check audited (Backlog AC4)**
- *Given* a health-check request for a connected page
- *When* the check completes (success or expired)
- *Then* `audit_logs` contains `event_type = "FACEBOOK_PAGE_HEALTH_CHECKED"` with `workspace_id`, `entity_id = channel_account_id`, and metadata with no raw token.
- *Trace evidence:* Test case `"should record audit logs upon page health check completion"` in [facebookAdminRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookAdminRoute.test.ts).

**AC — Mock mode blocked in production (BR3)**
- *Given* the server is started with `NODE_ENV=production` and `FACEBOOK_MOCK_MODE=true`
- *When* any admin route is called
- *Then* the route rejects or the server fails to start with a clear error.
- *Trace evidence:* Test case `"should fail startup if mock mode is active in production environment"` in [facebookAdminRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookAdminRoute.test.ts) and [REPORT-us-011-facebook-mock-mode-2026-06-07.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-011-facebook-mock-mode-2026-06-07.md).

---

## Test Plan

### Existing Test Files (Verified)

| Test File | Path | Coverage |
|:---|:---|:---|
| [facebookAdminRoute.test.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/__tests__/facebookAdminRoute.test.ts) | `apps/orchestrator/src/__tests__/facebookAdminRoute.test.ts` | Start OAuth endpoints, OAuth callbacks state checking, Connect Page upsert, Health Check token_status mapping, Page disconnect, Role based block |

### Verification Evidence Reports

TDD cycles and verification logs:
- [REPORT-us-011-implementation-2026-06-02.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-011-implementation-2026-06-02.md)
- [REPORT-us-011-facebook-mock-mode-2026-06-07.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-011-facebook-mock-mode-2026-06-07.md)
- [REPORT-us-011-oauth-callback-state-fix-2026-06-07.md](file:///d:/Muti-Media%20Management/docs/reports/REPORT-us-011-oauth-callback-state-fix-2026-06-07.md)

### RED Evidence Status

**Partial** — Implemented before AI-SDLC gate. Original RED stage execution outputs not captured. However, regression tests exist and currently run green.

---

## Validation Level

**L2** — Verification suite passes with automated tests. Run command:
`npm run test apps/orchestrator/src/__tests__/facebookAdminRoute.test.ts`

---

## Open Questions

- OQ-011-1: Does `POST /pages/connect` require a valid `facebook_oauth_sessions` row? *Resolved:* Yes. The worker queries and validates the session reference first to fetch the user long-lived access token pointer before connecting.
- OQ-011-2: What is the exact mechanism for blocking mock mode in production? *Resolved:* Checked during server bootstrap inside [server.ts](file:///d:/Muti-Media%20Management/apps/orchestrator/src/server.ts) — starting with `NODE_ENV=production` and `FACEBOOK_MOCK_MODE=true` throws a hard initialization error.
- OQ-011-3: Is listing connected pages in scope? *Resolved:* No, listing channel accounts is out of scope for US-011 v1; admins view them directly through the Airtable Base configuration.
