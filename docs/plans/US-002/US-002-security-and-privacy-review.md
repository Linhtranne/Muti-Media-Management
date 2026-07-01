# AI-SDLC Retrofit Header for US-002

status: approved

## Goal

Maintain US-002 behavior for Airtable Approved Webhook Workflow Trigger according to the approved backlog, function flow, and implementation evidence.

## Tasks

- AC-001: Preserve the documented trigger, processing, and output workflow.
- AC-002: Preserve tenant isolation, idempotency, and durable Ledger/audit evidence where applicable.
- AC-003: Preserve zero-token and reference-only security boundaries.
- AC-004: Keep the story compatible with build, lint, tests, and AI-SDLC artifact validation.

## Done When

- AC-001: Story workflow matches the accepted implementation report and function flow register.
- AC-002: Ledger, idempotency, queue, and role/security constraints are documented or tested where applicable.
- AC-003: No raw tokens or oversized/raw provider payloads cross forbidden boundaries.
- AC-004: `npm run ai-sdlc:check -- US-002` passes after retrofit artifacts are present.

﻿# T-011: Security and Privacy Review cho US-002

## 1. Docs Read
- `docs/architecture/06_Architecture_Composability.md`
- `docs/architecture/11_Coding_Convention.md`
- `docs/requirements/04_Product_Backlog.md`
- `docs/requirements/05_Function_Flow_Logic_Register.md`
- `docs/project-mgmt/07_Risk_Assumption_Decision_Log.md`
- `docs/requirements/03_SRS_MediaOps_Composability.md`
- `docs/requirements/13_Sprint_1_Backlog.md`
- `docs/plans/US-002/` (T-001 Ä‘áº¿n T-010)

## 2. Review Objective
RÃ  soÃ¡t toÃ n bá»™ thiáº¿t káº¿ US-002 tá»« receiver, queue, worker, ledger, audit, channel account boundary, workflow stub, test fixtures Ä‘á»ƒ xÃ¡c nháº­n khÃ´ng cÃ³ rá»§i ro security/privacy blocking trÆ°á»›c khi sang T-012. Ãp dá»¥ng mindset "Assume Breach", "Zero Trust", vÃ  nguyÃªn táº¯c Data Minimization Ä‘á»ƒ báº£o vá»‡ tÃ i sáº£n, dá»¯ liá»‡u, credential cá»§a MediaOps Composability.

## 3. Review Scope
- Airtable Webhook Receiver API vÃ  logic xÃ¡c thá»±c.
- RabbitMQ Queue Payload vÃ  Routing topology.
- Logic xá»­ lÃ½ cá»§a Worker: Zero-trust reload, revalidation, channel account resolution.
- Thiáº¿t káº¿ Schema Postgres Ledger (webhook_events, queue_events, workflow_runs, audit_logs).
- Test fixtures vÃ  chiáº¿n lÆ°á»£c cleanup data.

## 4. Out of Scope
- Quy trÃ¬nh OAuth vÃ  Token storage (US-011).
- Logic sinh ná»™i dung AI Composer (US-003).
- Facebook Graph API Publish physical execution.
- Gá»­i Slack notification tháº­t.

## 5. Security Control Matrix

| Area | Threat | Control Mechanism | Status |
| :--- | :--- | :--- | :--- |
| Ingress / Webhook | Giáº£ máº¡o webhook event, DDoS | Receiver verify source/config signature, rate limiting. KhÃ´ng trust payload Ä‘á»ƒ action. | Pass |
| Data Processing | Xá»­ lÃ½ dá»¯ liá»‡u cÅ© / Ä‘Ã£ bá»‹ thay Ä‘á»•i (Stale data) | Worker Ã¡p dá»¥ng Zero-Trust Reload: `GET /v0/base_id/Posts/record_id` Ä‘á»ƒ láº¥y tráº¡ng thÃ¡i thá»±c. | Pass |
| Token Management | Leak platform tokens, Airtable keys | KhÃ´ng lÆ°u/truyá»n access token, refresh token, vault ref trong RabbitMQ hay Airtable. Channel Account Boundary chá»‰ tráº£ safe metadata. | Pass |
| Operational Ledger | Máº¥t dáº¥u váº¿t Audit do lá»—i / crash | Ãp dá»¥ng nguyÃªn táº¯c "ACK chá»‰ sau Ledger commit". Ghi Ledger log cho cáº£ ignored/failed events. | Pass |

## 6. Privacy / Data Minimization Matrix

| Data Element | Presence in Queue | Presence in Audit Log | Presence in Ledger | Rule / Policy |
| :--- | :--- | :--- | :--- | :--- |
| `master_copy` | âŒ Banned | âŒ Banned | âŒ Banned (in workflow stub) | Chá»‰ reload khi cáº§n cháº¡y AI/Publish. |
| `asset_links` / `cta_url` | âŒ Banned | âŒ Banned | âŒ Banned | Content body khÃ´ng Ä‘Æ°á»£c ghi vÃ o logs/audit. |
| Raw Tokens | âŒ Banned | âŒ Banned | âŒ Banned | Tuyá»‡t Ä‘á»‘i cáº¥m. (Secret vault only) |
| Target Channels | âŒ Banned | âœ… Allowed (Sanitized) | âœ… Allowed | Chá»‰ ghi nháº­n "Facebook" etc, khÃ´ng content. |

## 7. Secret Exposure Review
- **Findings:** Thiáº¿t káº¿ Ä‘Ã£ quy Ä‘á»‹nh rÃµ trong T-008 vÃ  T-003 vá» viá»‡c nghiÃªm cáº¥m cÃ¡c trÆ°á»ng `access_token`, `refresh_token`, `app_secret`, `vault_ref`, vÃ  `Airtable API key` trong queue payload, logs, audit trails, vÃ  test fixtures. Channel Account Resolution Boundary chá»‰ tráº£ vá» `SafeChannelAccountMetadata`.
- **Conclusion:** KhÃ´ng cÃ³ dáº¥u hiá»‡u lá»™ lá»t secret. Pass.

## 8. Queue Payload Review
- **Findings:** Payload RabbitMQ chá»‰ cho phÃ©p chá»©a references (`record_ref`, `approval_ref`, `routing_ref`). KhÃ´ng chá»©a `master_copy`, `CTA URL`, `asset bodies`, hay `image paths`. `approved_version` khÃ´ng náº±m trong payload Ingress.
- **Conclusion:** Thiáº¿t káº¿ References-only payload Ä‘áº¡t chuáº©n an toÃ n. Pass.

## 9. Ledger / Audit Metadata Review
- **Findings:** `channel_account_refs` chá»‰ lÆ°u metadata an toÃ n. CÃ¡c audit logs Ã¡p dá»¥ng log sanitization, loáº¡i bá» má»i traces vá» port, db connection, file path, access tokens.
- **Conclusion:** Thiáº¿t káº¿ Audit logs an toÃ n. Pass.

## 10. Webhook/API Error Handling Review
- **Findings:** Receiver khÃ´ng return stack trace. Má»i error message pháº£i sanitized. KhÃ´ng leak connection string/secrets ra ngoÃ i API response. Má»i ngoáº¡i lá»‡ tráº£ vá» response an toÃ n (VD: 4xx, 5xx) theo thiáº¿t káº¿ T-004.
- **Conclusion:** Xá»­ lÃ½ lá»—i an toÃ n, Fail-closed design. Pass.

## 11. Idempotency and Replay Attack Review
- **Findings:** Receiver deduplicate theo `event_id`. Worker check idempotency theo `(workspace_id, airtable_record_id, approved_version)` vÃ  canonical `idempotency_key`. `approved_version` chá»‰ cáº¥p phÃ¡t á»Ÿ server-side Ledger, cÃ¡c nhÃ¡nh stale/ignored/invalid khÃ´ng cáº¥p version. Äáº£m báº£o chá»‘ng replay attacks vÃ  duplicate publish jobs. Má»i external event cÃ³ `event_id`, `correlation_id`.
- **Conclusion:** CÆ¡ cháº¿ Idempotency thiáº¿t káº¿ ráº¥t tá»‘t. Pass.

## 12. Tenant Isolation Review
- **Findings:** Má»i query database pháº£i filter theo `workspace_id` (RLS ready). CÃ¡c test scenario vÃ  Ledger queries Ä‘Ã£ xÃ¡c nháº­n rÃ ng buá»™c nÃ y trong T-008. Äáº£m báº£o cross-tenant data isolation.
- **Conclusion:** Strict tenant boundary. Pass.

## 13. Rollback / Delete Safety Review
- **Findings:** Production khÃ´ng physical delete `workflow_runs`, má»i thao tÃ¡c rollback dÃ¹ng compensating audit (VD: `workflow_stub_cancelled`). Test cleanup chá»‰ Ä‘Æ°á»£c phÃ©p dá»n dáº¹p cÃ¡c data thuá»™c prefix `test_` vÃ  trong mÃ´i trÆ°á»ng non-production. 
- **Conclusion:** Äáº£m báº£o data integrity vÃ  auditability. Pass.

## 14. Findings Table

| Severity | Area | Finding | Evidence | Required Fix | Blocking? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Medium | Ingress / Webhook | Zod/Pydantic validation config | T-010 Risk Question chá»‰ má»›i nháº¯c "sáº½ xá»­ lÃ½". Cáº§n Ä‘áº£m báº£o schema validator config `strict()` Ä‘á»ƒ reject cÃ¡c JSON cÃ³ undefined/unknown properties (VD payload bÆ¡m dÆ° file/token). | Cáº¥u hÃ¬nh strict parsing á»Ÿ Receiver schema. | No (Conditional Approval) |
| Low | Logging | Log Masking Helper | Rules cÃ³ yÃªu cáº§u sanitized logs nhÆ°ng chÆ°a rÃµ Helper function mask data á»Ÿ cáº¥p global logger. | Cáº§n bá»• sung middleware log sanitizer Ä‘á»ƒ auto-mask keywords (token, password). | No |

## 15. Required Remediation Checklist
- [ ] (Medium) Äáº£m báº£o API Receiver cÃ³ Schema Validation sá»­ dá»¥ng cháº¿ Ä‘á»™ `strict` (No unknown fields allowed) Ä‘á»ƒ chá»‘ng Mass Assignment / Payload Injection.
- [ ] (Low) Implement Global Log Sanitizer / Redactor trong thÆ° viá»‡n logger chung.

## 16. Final Approval Gate
**Status: Conditional Approval for T-012.** No Critical / High findings were found. The Medium/Low remediation items must be carried into T-012 implementation notes and the US-002 implementation checklist before coding starts. Zero-trust reload, references-only queue payloads, and Ledger idempotency constraints cover the core security risks.

## 17. Open Questions / Residual Risks
- LÃ m sao monitor rate-limit cá»§a Airtable tá»« gÃ³c Ä‘á»™ Security (trÃ¡nh DDoS qua webhook triggers)? -> Hiá»‡n Ä‘Ã£ cÃ³ Retry policy vá»›i exponential backoff. Tuy nhiÃªn á»Ÿ production cáº§n cÃ³ metric tracking Ä‘á»ƒ detect spam spikes.

