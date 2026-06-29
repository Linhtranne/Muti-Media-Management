# 00 - Project MOC: MediaOps Composability

MOC = Map of Context. File này là bản đồ định hướng nhanh cho agent khi làm việc trong repo `D:\Muti-Media Management`.

## 1. Mục tiêu sản phẩm

MediaOps Composability là nền tảng backend vận hành nội dung đa kênh theo kiến trúc composability:

- Airtable là Control Plane để quản lý campaign, post, approval và lịch đăng.
- Notion là Knowledge & Brief Plane để lưu campaign brief, brand voice, guideline và legal notes.
- Orchestrator là lớp điều phối workflow, API, worker và scheduler.
- RabbitMQ là event bus/queue cho tác vụ bất đồng bộ, retry và DLQ.
- Postgres/InsForge là Operational Ledger, source of truth cho trạng thái, audit và idempotency.
- Facebook MCP Server là Execution Plane, nơi duy nhất xử lý Facebook Graph API và token resolution.
- Slack là Communication Plane cho approve/reject/reply/escalate và cảnh báo.

## 2. Source of Truth trong repo

Agent phải ưu tiên đọc theo thứ tự sau trước khi lập plan hoặc sửa code:

1. `docs/architecture/06_Architecture_Composability.md`
   - Xác định layer, boundary, flow tổng thể.
2. `docs/architecture/11_Coding_Convention.md`
   - Quy tắc code, test, security, report.
3. `docs/requirements/04_Product_Backlog.md`
   - User Story, Acceptance Criteria, Business Rules.
4. `docs/requirements/05_Function_Flow_Logic_Register.md`
   - Function-level flow, trigger, input, output, error handling, audit.
5. `docs/plans/**`
   - Plan đã chốt cho từng US, nếu có.
6. `docs/reports/**`
   - Lịch sử quyết định, fix, test evidence, production blocker.
7. `db/migrations/**`
   - Schema thật và migration order.
8. `apps/**`, `packages/**`
   - Code implementation hiện hành.
9. `scripts/**`, root scripts trong `package.json`
   - Local operations, seed, apply migration, reset queue.

Nếu tài liệu mâu thuẫn, ưu tiên:

```text
Architecture > Coding Convention > Backlog > Function Flow Register > Plan > Report > Code comments
```

Nếu code đã khác tài liệu, agent phải ghi rõ discrepancy và đề xuất cập nhật tài liệu hoặc code, không tự âm thầm chọn một bên.

## 3. Kiến trúc thư mục

```text
apps/
  orchestrator/              # Express API, workers, queue consumers, repositories
  facebook-mcp-server/       # MCP server, Facebook tools, secret store

packages/
  shared-contracts/          # Zod schemas, event contracts, MCP contracts
  policy-engine/             # Pure policy rules and evaluation

db/
  migrations/                # Postgres schema migrations in filename order

docs/
  architecture/              # System architecture and coding convention
  requirements/              # Backlog, SRS, FL register
  plans/                     # Implementation plans by US
  reports/                   # Post-work reports and evidence
  ai-sdlc/                   # AI-driven SDLC operating docs

scripts/
  # Operational helper scripts when present
```

## 4. Production code ownership map

### `apps/orchestrator/src`

- `server.ts`: composition root; wires dependencies, routes, workers, consumers, schedulers.
- `routes/`: HTTP ingress/egress for Airtable, Slack, Facebook admin and reports.
- `workers/`: business workflows consuming queue messages.
- `queue/`: RabbitMQ publisher, consumers, retry/DLQ, topology, idempotency guard.
- `ledger/`: Postgres repositories and transaction-oriented persistence.
- `services/`: support services such as Slack parser/signature, Notion client, Airtable ingestor.
- `ai/`: LLM adapter, prompt registry, structured output validation.
- `mcp/`: stdio client for Facebook MCP server.
- `lib/`: logging and redaction utilities.

### `apps/facebook-mcp-server/src`

- `index.ts`: MCP server entrypoint and tool registry.
- `tools/`: Facebook tool handlers.
- `lib/secretStore.ts`: secret store interface and development store.
- `lib/databaseSecretStore.ts`: encrypted database-backed secret store.

### `packages/shared-contracts/src`

- Zod schemas shared by producers and consumers.
- Event contracts for RabbitMQ.
- MCP input/result contracts.
- Slack, report, AI, policy and ledger schemas.

### `packages/policy-engine/src`

- Pure TypeScript policy rules.
- No database, queue, HTTP or platform side effects.

## 5. Core architectural boundaries

Agent must preserve these boundaries:

- Platform API code belongs inside `apps/facebook-mcp-server`, not `apps/orchestrator`.
- Orchestrator may call MCP tools, but must not call Facebook Graph API directly.
- RabbitMQ payloads must carry references only, not raw tokens or large content bodies.
- Raw token must never appear in logs, Slack, Airtable, Notion, RabbitMQ payload or audit metadata.
- PostgreSQL/InsForge Ledger is durable source of truth, not RabbitMQ.
- Workers ACK only after durable Ledger state is committed or DLQ publish is confirmed.
- Audit metadata must go through redaction.
- Tenant-scoped data must include `workspace_id`; queries and idempotency must be workspace-scoped.
- Policy engine must remain pure and deterministic.
- Shared contracts must be updated when payload shape changes.

## 6. Main user stories and modules

| US | Capability | Main modules |
|:---|:---|:---|
| US-002 | Airtable Approved webhook to workflow | `routes/airtableWebhook.ts`, `services/airtableWebhookIngestor.ts`, `workers/approvedPostWorker.ts`, `queue/rabbitmqConsumer.ts`, `ledger/workerRepository.ts` |
| US-003 | AI Composer | `workers/aiComposerWorker.ts`, `ai/*`, `services/notionClient.ts`, `ledger/aiWorkerRepository.ts` |
| US-004 | Policy Engine | `packages/policy-engine`, `workers/policyWorker.ts`, `ledger/policyWorkerRepository.ts` |
| US-005 | MCP validate/enqueue | `workers/mcpValidateWorker.ts`, `queue/mcpValidateRabbitmqConsumer.ts`, `packages/shared-contracts/src/mcp/*` |
| US-006 | Publish execution | `workers/mcpPublishWorker.ts`, `workers/mcpPublishScheduler.ts`, `apps/facebook-mcp-server/src/tools/publishPost.ts` |
| US-007 | Facebook comment sync | `scheduler/commentSyncScheduler.ts`, `queue/facebookCommentSync*`, `workers/facebookCommentSyncWorker.ts` |
| US-008 | Slack approve/reject | `routes/slackCommands.ts`, `workers/slackPostApprovalWorker.ts`, `ledger/slackCommandRepository.ts` |
| US-009 | Slack reply/escalate comment | `workers/slackCommentActionWorker.ts`, `ledger/commentActionRepository.ts`, MCP `replyComment` |
| US-010 | Audit hardening | `ledger/auditLogRepository.ts`, `lib/auditRedactor.ts`, migration `0010` |
| US-011 | Facebook Page admin config | `routes/facebookAdmin.ts`, `ledger/channelAccountAdminRepository.ts`, `apps/facebook-mcp-server/src/tools/facebookAuthTools.ts` |
| US-012 | Campaign reporting | `routes/reports.ts`, `ledger/reportRepository.ts`, migration `0013` |
| US-013 | Notion context | `services/notionClient.ts`, `workers/aiComposerWorker.ts`, shared AI contracts |
| US-014 | RabbitMQ hardening | `queue/topologyConfig.ts`, `queue/rabbitmqPublisher.ts`, `queue/idempotencyGuard.ts`, migration `0014` |
| US-015 | Unified DM inbox | `workers/directMessage*`, `queue/directMessage*`, `ledger/directMessageRepository.ts`, shared DM contracts |
| AI-SDLC-001 | Completion Gate Checker | `scripts/ai-sdlc-check.mjs`, `scripts/ai-sdlc-validate.mjs` |
| AI-SDLC-002 | Native Completion Gate Checker | `scripts/pre-commit-gate.mjs`, `scripts/install-hooks.mjs`, `scripts/runtime-smoke.mjs` |

## 7. Current implementation caveats

- Real Meta/Facebook Graph API production use depends on Meta permissions and app review. Local/staging can use `FACEBOOK_MOCK_MODE=true`.
- Do not claim external platform readiness without checking latest reports and runtime config.
- `run-tests.mjs` explicitly lists test files. New tests may need runner wiring.
- Some docs contain mojibake/encoding artifacts from earlier Vietnamese text. Do not “fix” broad docs encoding unless the task explicitly asks.
- `*.tsbuildinfo`, logs and generated artifacts should not be treated as source-of-truth work products.

## 8. Standard agent workflow

For any non-trivial task:

1. Read relevant docs in the source-of-truth order.
2. Inspect actual code paths and migrations.
3. State assumptions and scope.
4. Make the smallest necessary changes.
5. Update shared contracts when payloads change.
6. Update FL register/report when behavior changes.
7. Run the validation gate that matches the risk.
8. Report verified facts separately from unverified assumptions.

