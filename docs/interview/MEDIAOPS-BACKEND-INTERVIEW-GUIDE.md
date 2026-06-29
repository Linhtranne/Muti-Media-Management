# MediaOps Backend Interview Guide

## 1. Mục tiêu tài liệu

Tài liệu này dùng để ôn phỏng vấn Backend Developer dựa trên dự án cá nhân
MediaOps Composability và JD yêu cầu TypeScript, Node.js, REST API, PostgreSQL,
message queue, testing, tài liệu kỹ thuật và khả năng sử dụng AI.

Mục tiêu sau khi học:

- Trình bày dự án trong 60 giây và 5 phút.
- Giải thích được luồng end-to-end, không chỉ kể tên công nghệ.
- Giải thích được vì sao dùng RabbitMQ, Postgres, MCP, Zod và idempotency.
- Mô tả được trách nhiệm của từng folder và từng file TypeScript production.
- Trả lời trung thực các khoảng trống trong NestJS, ORM, Docker, Redis và realtime.
- Phân biệt phần đã chạy local/test với phần đang bị chặn bởi Meta App permission.

---

## 2. Giới thiệu dự án

### Bản 30-60 giây

MediaOps Composability là nền tảng backend điều phối quy trình vận hành nội dung
đa kênh. Airtable đóng vai trò control plane để quản lý campaign, post và
approval; Notion cung cấp campaign brief; Node.js Orchestrator xử lý webhook,
AI generation, policy validation và các worker bất đồng bộ qua RabbitMQ.
PostgreSQL là operational ledger lưu durable state, idempotency và audit.
Facebook API được cô lập sau MCP server để orchestrator không cầm token và
không gọi Graph API trực tiếp. Slack cung cấp các lệnh approve, reject, reply
và escalate.

### Bản 3-5 phút

Vấn đề nghiệp vụ là quy trình nội dung gồm nhiều bước và nhiều hệ thống:

1. Manager duyệt post trong Airtable.
2. Webhook kích hoạt workflow.
3. AI sinh Facebook variant từ master copy và Notion context.
4. Policy Engine kiểm tra approval, channel, token metadata, forbidden term,
   CTA và UTM.
5. Publish job được validate và thực thi qua Facebook MCP.
6. Comment và direct message được đồng bộ vào Ledger.
7. Support thao tác từ Slack.
8. Toàn bộ trạng thái và audit được lưu trong PostgreSQL.

Hệ thống tách thành các plane:

- Control Plane: Airtable.
- Knowledge Plane: Notion.
- Orchestration Plane: Express, workers, schedulers.
- Event Plane: RabbitMQ.
- Execution Plane: Facebook MCP Server.
- Operational Plane: PostgreSQL/InsForge.
- Communication Plane: Slack.

---

## 3. Kiến trúc tổng thể

```text
                         +------------------+
                         |     Notion       |
                         | Campaign brief   |
                         +---------+--------+
                                    |
67: +-----------+    HTTP webhook      v
| Airtable  | ----------------> Orchestrator
| Campaign  |                   Express routes
| Post      |                         |
+-----------+                         v
                              +---------------+
                              |  RabbitMQ     |
                              | retry + DLQ   |
                              +--+--+--+--+---+
                                 |  |  |  |
             +-------------------+  |  |  +------------------+
             v                      v  v                     v
      ApprovedPostWorker     AI/Policy Workers        Slack/DM Workers
             |                      |                        |
             +----------------------+------------------------+
                                    |
                                    v
                            PostgreSQL Ledger
                         state + audit + idempotency
                                    |
                                    v
                         Facebook MCP Client (stdio)
                                    |
                                    v
                         Facebook MCP Server
                          secret resolution only
                                    |
                                    v
                         Facebook Graph API
```

### Vì sao không làm monolith đơn giản?

Đây vẫn là monorepo và có một orchestrator chính, nhưng boundary được tách theo
trách nhiệm:

- Platform-specific API nằm trong MCP server.
- Business workflow nằm trong worker.
- SQL nằm trong repository.
- Event contract nằm trong shared package.
- Pure business rule nằm trong policy package.

Đây là modular architecture có event-driven processing, chưa phải microservices
hoàn chỉnh. Trả lời như vậy chính xác hơn việc tự nhận đây là microservices.

---

## 4. Các nguyên tắc backend quan trọng

### 4.1 Ledger là source of truth

RabbitMQ chỉ vận chuyển công việc. PostgreSQL mới lưu trạng thái lâu dài:

- Webhook đã nhận hay chưa.
- Workflow đang ở bước nào.
- AI run thành công hay thất bại.
- Policy có cho publish không.
- Publish job có external post ID nào.
- Command Slack do ai thực hiện.
- Comment/DM đã resolved hay chưa.

### 4.2 ACK sau khi commit

```text
Receive -> validate -> claim -> process -> commit Ledger -> ACK
```

Nếu ACK trước commit và process crash, message bị mất. Nếu commit trước ACK và
process crash, RabbitMQ redeliver; idempotency sẽ ngăn side effect trùng.

### 4.3 Idempotency

Idempotency được bảo vệ ở nhiều lớp:

- Event có `idempotency_key`.
- Database có unique constraint theo workspace.
- Worker kiểm tra trạng thái trước khi xử lý.
- External operation có job/event record.
- Duplicate message được ACK và no-op.

### 4.4 Zero-trust reload

Webhook chỉ là tín hiệu, không phải nguồn dữ liệu đáng tin cậy. Worker reload
record mới nhất từ Airtable, kiểm tra status và required fields trước khi tạo
workflow. Cách này ngăn stale webhook và payload bị giả mạo dẫn đến publish sai.

### 4.5 Credential boundary

- Airtable, Slack, queue, log và audit không chứa raw token.
- Ledger chỉ lưu `secret_ref`.
- MCP server resolve và decrypt token.
- Orchestrator gọi MCP tool, không gọi Graph API trực tiếp.

### 4.6 Tenant isolation

Mọi dữ liệu có `workspace_id`. Database transaction set RLS context và query
luôn scope theo workspace. Idempotency cũng phải là
`workspace_id + idempotency_key`, không được global.

### 4.7 Fail-fast configuration

`env.ts` dùng Zod validate các biến bắt buộc lúc startup. Nếu bật Slack command
mà không có signing secret, app dừng ngay thay vì lỗi ở request đầu tiên.

---

## 5. Luồng end-to-end

## 5.1 US-002: Airtable Approved Webhook

```text
Airtable
 -> POST webhook
 -> airtableWebhook route
 -> AirtableWebhookIngestor
 -> insert webhook_events
 -> publish airtable.webhook.approved
 -> rabbitmqConsumer
 -> ApprovedPostWorker
 -> reload Airtable
 -> allocate approved version
 -> create workflow_runs
 -> publish ai.compose.facebook.requested
 -> commit
 -> ACK
```

Điều cần nhấn mạnh:

- Route trả lời nhanh, không chạy toàn bộ workflow trong HTTP request.
- Ingress dedupe theo event ID.
- Worker reload Airtable để kiểm tra status hiện tại.
- Queue chỉ mang references.
- Workflow chỉ được tạo sau khi database commit.

## 5.2 US-003: AI Composer

```text
ai.compose.facebook.requested
 -> AiComposerRabbitmqConsumer
 -> AiComposerWorker claim workflow
 -> reload Airtable
 -> optionally load allowlisted Notion page
 -> build versioned prompt
 -> GeminiLlmAdapter
 -> StructuredValidator
 -> persist ai_generation_runs + content_variants
 -> handoff policy.evaluate.requested
 -> ACK
```

Security:

- Notion URL bị kiểm tra SSRF.
- Notion content được coi là untrusted data và bọc trong XML boundary.
- Structured output được parse bằng Zod.
- CTA/UTM phải được bảo toàn.
- Prompt injection hoặc schema invalid không được publish.

## 5.3 US-004: Policy Engine

```text
policy.evaluate.requested
 -> PolicyWorker reload context
 -> evaluateFacebookPolicy
 -> run independent pure rules
 -> aggregate blockers/warnings
 -> persist publish_rule_results
 -> if allowed: create publish_job
 -> publish publish.facebook.requested
```

Policy checks:

- Approval status.
- Auto publish/auto approve config.
- Channel account active.
- Token metadata active và chưa hết hạn.
- Facebook text length và hashtag count.
- Forbidden terms.
- CTA URL và UTM.

Rule là pure function nên dễ unit test, deterministic và không phụ thuộc DB.

## 5.4 US-005 và US-006: Validate và Publish

```text
publish.facebook.requested
 -> McpValidateWorker
 -> load publish context
 -> token metadata pre-check
 -> MCP getRateLimitStatus
 -> MCP validatePost
 -> mark job validated

McpPublishScheduler polls due jobs
 -> publish publish.facebook.execute
 -> McpPublishWorker
 -> claim job
 -> load content and secret_ref
 -> MCP publishPost
 -> MCP resolves token
 -> Facebook Graph API
 -> save external_post_id
 -> update Airtable
 -> audit
```

Tại sao cần scheduler:

- Publish job có `scheduled_at`.
- RabbitMQ không phải scheduler dài hạn.
- Scheduler lấy job đến hạn từ Ledger rồi mới enqueue execution.

## 5.5 US-007: Comment Sync

```text
CommentSyncScheduler
 -> comments.facebook.sync.requested
 -> SyncRequestConsumer
 -> resolve active channel and secret_ref
 -> MCP syncComments
 -> one comments.facebook.ingest event per comment
 -> FacebookCommentSyncWorker
 -> upsert interaction
 -> classify risk
 -> publish Slack alert reference
```

Duplicate comment được chặn bởi external ID và idempotency. Risk classifier quyết
định inbox hay crisis channel.

## 5.6 US-008 và US-009: Slack Commands

```text
Slack slash command
 -> raw Express body
 -> verify HMAC signature + timestamp
 -> parse command
 -> lookup workspace_members role
 -> persist command event
 -> respond HTTP 200 immediately
 -> publish queue message
 -> async worker
 -> Airtable update or MCP reply
 -> Ledger + audit
```

Lệnh:

- `/approve_post <post_id>`
- `/reject_post <post_id> <reason>`
- `/reply_comment <interaction_id> <message>`
- `/escalate <interaction_id> [reason]`
- `/reply_dm <conversation_id> <message>`

Tại sao trả `Processing your request...` ngay: Slack có timeout ngắn, trong khi
database, Airtable, queue và Facebook là external I/O.

## 5.7 US-010: Audit

Tất cả subsystem gọi `AuditLogRepository`. Metadata chạy qua recursive redactor.
Database audit append-only, RLS theo workspace, correlation ID dùng để nối các
event trong cùng một luồng.

## 5.8 US-011: Facebook Admin OAuth

```text
Admin POST /auth/start
 -> verify admin role
 -> generate one-time state in Postgres
 -> MCP generateOAuthUrl
 -> browser redirects to Meta
 -> Meta GET /auth/callback?code&state
 -> consume state atomically
 -> MCP exchange code and list pages
 -> connection session
 -> admin selects page
 -> MCP stores encrypted token
 -> Ledger stores secret_ref
```

Trạng thái hiện tại cần nói trung thực:

- Code, migration và local flow đã có.
- Real Meta OAuth đang bị chặn bởi app use-case/permission configuration.
- Đây là external platform setup blocker, không nên tuyên bố production OAuth
  đã hoàn tất.

## 5.9 US-012: Reporting

REST endpoints đọc aggregate từ Ledger, không tính từ Slack:

- `GET /api/v1/reports/campaigns`
- `GET /api/v1/reports/campaigns.csv`

Query pre-aggregate interactions trước khi join publish jobs để tránh
double-count. CSV fields được escape quote, comma và newline.

## 5.10 US-014: Event Bus Hardening

- Canonical event envelope.
- Config-driven queue topology.
- Per-queue DLQ.
- TTL retry queues.
- Confirm channel.
- Event idempotency table.
- Queue audit events.
- Forbidden field scan để chặn token/secret trong payload.

## 5.11 US-015: Unified DM Inbox

```text
dm.facebook.ingest
 -> DirectMessageIngestWorker
 -> MCP fetch full message by reference
 -> upsert conversation/message
 -> calculate SLA
 -> send redacted Slack preview

/reply_dm
 -> create reply job in Ledger
 -> queue only reply_job_id
 -> DirectMessageReplyWorker claims job atomically
 -> load reply body from Ledger
 -> MCP sendDirectMessage
 -> persist outbound message and audit
```

Full DM body ở Ledger dưới RLS; Slack chỉ nhận preview đã redact. Queue reply
không mang full body.

---

## 6. Bản đồ folder và từng file TypeScript

Phần này mô tả file production. Các file `__tests__` có nhiệm vụ kiểm tra module
tương ứng và được nói riêng ở mục Testing.

## 6.1 `apps/orchestrator/src`

### Root

- `server.ts`: composition root; khởi tạo dependency, route, consumer,
  scheduler, feature flag và graceful shutdown.

### `config`

- `config/env.ts`: Zod schema cho environment, defaults và cross-field
  validation.

### `airtable`

- `airtable/airtableClient.ts`: HTTP adapter cho Airtable; timeout, error
  mapping, get record, update variant và approval status.

### `ai`

- `ai/llmAdapter.ts`: interface LLM và Gemini implementation; timeout, rate
  limit, service/config errors.
- `ai/promptRegistry.ts`: prompt versioning và builder theo context.
- `ai/structuredValidator.ts`: extract JSON, normalize hashtag, verify CTA/UTM,
  detect injection và validate output.

### `routes`

- `routes/airtableWebhook.ts`: HTTP ingress cho Airtable, chuyển raw request cho
  ingestor và map result thành HTTP response.
- `routes/slackCommands.ts`: verify/parse/authorize/persist các command approve,
  reject, reply comment, escalate và reply DM; ACK Slack sớm và enqueue async.
- `routes/facebookAdmin.ts`: OAuth start/callback, connect page, token health
  check và disconnect; admin authorization và one-time OAuth state.
- `routes/reports.ts`: campaign report JSON/CSV, role authorization và audit.

### `services`

- `services/airtableWebhookIngestor.ts`: validate webhook, dedupe, insert Ledger
  và publish references-only event.
- `services/channelAccountResolver.ts`: map Airtable channel stub sang active
  Ledger channel account theo workspace.
- `services/commentRiskClassifier.ts`: classify comment normal/risk để route
  Slack channel.
- `services/notionClient.ts`: fetch Notion properties, allowlist host, DNS/IP
  SSRF defense và sanitized errors.
- `services/slackCommandParser.ts`: parse text của từng slash command thành
  discriminated union.
- `services/slackSignatureVerifier.ts`: verify Slack HMAC SHA256, constant-time
  comparison và replay timestamp window.

### `workers`

- `workers/approvedPostWorker.ts`: zero-trust reload Approved post, resolve
  channel, allocate version, create workflow và handoff AI.
- `workers/aiComposerWorker.ts`: claim AI workflow, load Airtable/Notion, call LLM,
  validate, persist variant và handoff policy.
- `workers/policyWorker.ts`: load policy context, evaluate pure rules, persist
  result và tạo publish job nếu allowed.
- `workers/mcpValidateWorker.ts`: pre-check token metadata/quota, call MCP
  validation và mark publish job validated/failed.
- `workers/mcpPublishScheduler.ts`: poll publish jobs đến hạn và enqueue execute.
- `workers/mcpPublishWorker.ts`: claim publish job, call MCP publish, persist
  external ID, update Airtable và audit.
- `workers/facebookCommentSyncWorker.ts`: upsert comment interaction, risk
  classification và Slack alert handoff.
- `workers/slackPostApprovalWorker.ts`: xử lý approve/reject Airtable sau queue.
- `workers/slackCommentActionWorker.ts`: reply comment qua MCP hoặc commit
  escalation rồi gửi alert post-commit.
- `workers/directMessageIngestWorker.ts`: fetch DM body qua MCP, upsert
  conversation/message, SLA và redacted Slack alert.
- `workers/directMessageReplyWorker.ts`: atomically claim reply job, load body
  từ Ledger, send qua MCP và persist outbound result.

### `ledger`

- `ledger/postgres.ts`: tạo pool/database abstraction, transaction helper và
  guard connection string/RLS.
- `ledger/webhookEventRepository.ts`: CRUD cần thiết cho `webhook_events`.
- `ledger/workerRepository.ts`: fast-pass event, advisory lock, approved version
  và workflow creation cho approved-post worker.
- `ledger/aiWorkerRepository.ts`: claim AI workflow, mark completed/failed và
  persist generation/variant.
- `ledger/policyWorkerRepository.ts`: load policy context và transaction persist
  rule result/publish job.
- `ledger/mcpValidateWorkerRepository.ts`: load validation context và persist
  validated/failed handoff.
- `ledger/mcpPublishSchedulerRepository.ts`: query/claim job đến lịch.
- `ledger/mcpPublishWorkerRepository.ts`: load publish context và persist
  publishing/success/failure.
- `ledger/commentSyncSchedulerRepository.ts`: tìm Facebook posts/accounts cần
  sync comment.
- `ledger/commentSyncWorkerRepository.ts`: upsert interaction/comment và Slack
  alert metadata.
- `ledger/slackCommandRepository.ts`: Slack approval command events, role lookup
  và audit.
- `ledger/commentActionRepository.ts`: comment action event, interaction lookup,
  deterministic channel resolution và status update.
- `ledger/directMessageRepository.ts`: conversation, message, reply job,
  assignment tenant guard và atomic claim.
- `ledger/channelAccountAdminRepository.ts`: channel account, token reference,
  OAuth state/session và admin operations.
- `ledger/auditLogRepository.ts`: canonical append-only audit insert sau
  redaction.
- `ledger/reportRepository.ts`: aggregate campaign metrics bằng SQL CTE.

### `queue`

- `queue/rabbitmqPublisher.ts`: declare exchange/topology và publish bằng confirm
  channel; validate canonical reference-only payload.
- `queue/rabbitmqConsumer.ts`: consumer cho approved webhook; ACK/NACK/DLQ và
  idempotency ordering.
- `queue/aiComposerRabbitmqConsumer.ts`: queue adapter cho AI worker.
- `queue/policyRabbitmqConsumer.ts`: queue adapter cho Policy worker.
- `queue/mcpValidateRabbitmqConsumer.ts`: queue adapter cho MCP validation.
- `queue/mcpPublishRabbitmqConsumer.ts`: queue adapter cho publish execution.
- `queue/facebookCommentSyncRequestConsumer.ts`: lấy secret reference, gọi MCP
  sync và fan-out comment ingest events.
- `queue/facebookCommentSyncIngestConsumer.ts`: retry/DLQ adapter cho comment
  persistence worker.
- `queue/slackCommandRabbitmqConsumer.ts`: Slack approve/reject consumer với TTL
  retry.
- `queue/slackCommentActionRabbitmqConsumer.ts`: Slack reply/escalate consumer.
- `queue/directMessageIngestRabbitmqConsumer.ts`: DM ingest validation,
  retry/DLQ và ACK ordering.
- `queue/directMessageReplyRabbitmqConsumer.ts`: DM reply job consumer; DLQ chỉ
  chứa reference.
- `queue/idempotencyGuard.ts`: insert/check/update `event_bus_messages` theo
  workspace và idempotency key.
- `queue/queueAuditHelper.ts`: audit published, consumed, retried và DLQ.
- `queue/topologyConfig.ts`: registry queue, routing key, DLQ, prefetch và owner
  US.
- `queue/rabbitmqMonitor.ts`: kiểm tra queue depth/retry/DLQ và không crash khi
  dynamic retry queue chưa tồn tại.

### `scheduler`

- `scheduler/commentSyncScheduler.ts`: interval poll channel/post và publish
  comment sync request.

### `mcp`

- `mcp/facebookMcpClient.ts`: spawn MCP server qua stdio, whitelist environment,
  call tools, parse response, cleanup và reconnect khi connection drop.

### `lib`

- `lib/logger.ts`: structured JSON logger theo log level.
- `lib/redact.ts`: generic recursive secret masking cho logs.
- `lib/auditRedactor.ts`: stricter recursive audit metadata redactor và
  `redacted_keys`.
- `lib/dmRedactor.ts`: tạo DM preview an toàn cho Slack.

### `scripts`

- `scripts/seed_workspace_members.ts`: seed/upsert Slack user role cho workspace.

## 6.2 `apps/facebook-mcp-server/src`

### Root

- `index.ts`: khởi tạo MCP server, chọn secret-store provider, khai báo tool
  schema và route tool call đến handler.

### `lib`

- `lib/secretStore.ts`: `SecretStore` interface và memory/env implementation
  cho development.
- `lib/databaseSecretStore.ts`: AES-256-GCM encrypt/decrypt token và lưu
  `secret_references` với RLS workspace context.

### `tools`

- `tools/validatePost.ts`: Facebook-specific constraints và sanitized
  validation result.
- `tools/getRateLimitStatus.ts`: kiểm tra quota/rate-limit status.
- `tools/publishPost.ts`: resolve token, call Graph feed endpoint, map Facebook
  error code thành domain error.
- `tools/syncComments.ts`: fetch comments, sanitize/map response và platform
  errors.
- `tools/replyComment.ts`: reply Facebook comment qua platform client.
- `tools/facebookAuthTools.ts`: exchange OAuth code, list pages, store page
  token và token health check.
- `tools/getDirectMessage.ts`: lấy DM body từ Facebook/mock bằng message
  reference.
- `tools/sendDirectMessage.ts`: gửi DM reply về đúng thread/platform.

## 6.3 `packages/policy-engine/src`

- `index.ts`: public exports của package.
- `types.ts`: input, check, blocker, warning và evaluation types.
- `version.ts`: policy snapshot version.
- `forbiddenTerms.ts`: default forbidden-term configuration.
- `evaluate.ts`: chạy rules và aggregate thành allowed/blockers/warnings.
- `rules/helpers.ts`: constructors `passed`, `blocked`, `warned` và text
  normalization.
- `rules/checkApprovalStatus.ts`: variant đã được approval hay chưa.
- `rules/checkAutoPublishConfig.ts`: auto-publish và auto-approve config.
- `rules/checkChannel.ts`: channel active, token active/scopes/expiry.
- `rules/checkContent.ts`: Facebook body length và hashtag limit.
- `rules/checkCta.ts`: CTA URL validity và UTM preservation/presence.
- `rules/checkForbiddenTerms.ts`: case-insensitive normalized forbidden-term
  detection.

## 6.4 `packages/shared-contracts/src`

- `index.ts`: public export surface.
- `ai/composer.ts`: AI queue, run, variant, structured output và Notion context
  schemas.
- `airtable/reloadedRecord.ts`: canonical Airtable record/status schemas.
- `events/airtablePostApproved.ts`: ingress và queue reference schemas,
  idempotency builders.
- `events/directMessage.ts`: DM ingest/reply/MCP schemas và forbidden fields.
- `events/envelope.ts`: canonical event envelope và recursive secret scan.
- `events/facebookCommentSync.ts`: comment sync request/ingest schemas.
- `ledger/channelAccountRef.ts`: safe channel account reference.
- `ledger/webhookEventStatus.ts`: webhook status enum.
- `ledger/workflowRunStatus.ts`: workflow state enum.
- `mcp/facebookAuth.ts`: OAuth/page/token health contracts.
- `mcp/publishFacebookExecute.ts`: publish execution queue contract.
- `mcp/publishFacebookValidated.ts`: validated handoff contract.
- `mcp/publishPost.ts`: publish tool input/result/error contracts.
- `mcp/rateLimitStatus.ts`: quota tool contracts.
- `mcp/replyComment.ts`: comment reply contracts.
- `mcp/syncComments.ts`: sanitized comment sync contracts.
- `mcp/validatePost.ts`: MCP validation result contracts.
- `policy/policyEvaluate.ts`: policy request và publish request events.
- `reports/index.ts`: report query/row/response schemas.
- `slack/slackCommandAction.ts`: approve/reject và comment action events.
- `slack/slashCommand.ts`: strict Slack form payload.

## 6.5 Database migrations

- `0001`: webhook Ledger và workflow foundation.
- `0002`: channel accounts.
- `0003`: AI generation runs và content variants.
- `0004`: policy result và publish guardrail.
- `0005`: MCP validation/enqueue.
- `0006`: publish execution.
- `0007`: Facebook comment sync.
- `0008`: Slack approve/reject.
- `0009`: Slack reply/escalate.
- `0010`: audit hardening, redaction-related schema, append-only.
- `0011`: Facebook admin configuration.
- `0012`: encrypted secret store và persistent OAuth sessions.
- `0013`: campaign reporting và timestamps.
- `0014`: event bus idempotency/audit.
- `0015`: unified DM inbox.
- `0016`: one-time Facebook OAuth state.

---

## 7. Testing strategy

Repo dùng Node Test Runner và `node:assert/strict`. `run-tests.mjs` là runner
tập trung, vì vậy test file mới phải được wire vào runner nếu runner đang dùng
danh sách static.

### Các lớp test

- Contract tests: Zod accept/reject đúng payload.
- Unit tests: policy rules, parser, redactor, validator.
- Worker tests: mock repositories/external adapters và verify state transition.
- Queue tests: ACK/NACK, retry TTL, DLQ, binding.
- Route tests: validation, authorization, response status.
- Security tests: secret fields, Slack signature, SSRF, RLS/migration checks.

### Cách nói về E2E

Repo có integration-style tests với mock dependencies, nhưng chưa nên khẳng
định có full production E2E qua Airtable + CloudAMQP + Meta Graph API. Meta OAuth
thực tế vẫn đang bị chặn bởi permission setup.

---

## 8. CV so với JD

## 8.1 Điểm phù hợp mạnh

| JD | Bằng chứng trong MediaOps |
|:---|:---|
| TypeScript/JavaScript backend | Toàn bộ orchestrator, MCP và packages viết bằng TypeScript |
| Node.js async/await | HTTP, database, RabbitMQ, MCP stdio và external API đều async |
| REST API | Airtable webhook, Slack command, Facebook admin và report routes |
| Validation/error handling | Zod schemas, typed domain errors, sanitized errors |
| PostgreSQL | Migrations, transaction, CTE, unique constraints, RLS, trigger |
| Message queue/event-driven | RabbitMQ consumers, confirm publisher, TTL retry, DLQ |
| Internal service integration | Airtable, Notion, Gemini, Slack, Facebook MCP |
| Unit test | Contract, policy, worker, queue, route và security tests |
| Technical docs | Architecture, backlog, flow register, plan và report |
| AI-assisted development | Dùng AI để phân tích requirement, lập plan, review và test |
| Microservice concepts | Service boundary giữa orchestrator và Facebook MCP |

## 8.2 Khoảng trống cần trả lời trung thực

### NestJS

Dự án dùng Express, không dùng NestJS.

Trả lời:

> Dự án cá nhân của em dùng Express để em tự thiết kế rõ route, service, worker,
> repository và dependency boundary. Em chưa dùng NestJS trong production,
> nhưng em hiểu cách map kiến trúc hiện tại sang NestJS: route thành Controller,
> business logic thành Injectable Service, repository/provider đăng ký trong
> Module, Slack signature có thể là Guard/Middleware, Zod validation có thể đưa
> vào Pipe, logging/error mapping vào Interceptor và Exception Filter. Em có
> thể học nhanh vì các concept DI và separation đã được áp dụng thủ công.

### ORM

Dự án dùng `pg` và raw parameterized SQL, không dùng Prisma/TypeORM.

Trả lời:

> Em chọn raw SQL vì dự án cần advisory lock, SET LOCAL RLS context, CTE aggregate,
> partial unique index và transaction boundary rõ ràng. Em hiểu ORM giúp tăng
> productivity cho CRUD và migration, nhưng với query đặc thù vẫn cần SQL.
> Em chưa nên tự nhận có kinh nghiệm Prisma production; em có thể trình bày
> repository pattern hiện tại và cách thay implementation bằng Prisma.

### Docker

Nếu repo chưa có Dockerfile/Compose production-ready, nói:

> Em hiểu container image, environment, port, health check và multi-stage build,
> nhưng phần deployment Docker của project chưa hoàn thiện. Đây là next step em
> sẽ làm: build TypeScript ở builder stage, copy dist và production dependencies
> sang runtime stage, chạy orchestrator và RabbitMQ/Postgres dependency qua
> compose cho local.

### WebSocket/realtime

> Dự án hiện tại dùng event-driven async qua RabbitMQ và Slack webhook, chưa dùng
> WebSocket. Em hiểu WebSocket là kết nối hai chiều lâu dài phù hợp dashboard
> realtime; nếu thêm dashboard, em sẽ publish domain event sau commit và đẩy
> update qua Socket.IO/WebSocket, không để socket handler tự sửa Ledger tùy tiện.

### Redis/NoSQL

> PostgreSQL là source of truth và RabbitMQ xử lý queue. Redis chưa cần cho MVP.
> Redis có thể được thêm cho distributed cache, rate-limit counter hoặc ephemeral
> presence; không dùng thay Ledger. NoSQL chỉ nên thêm khi có nhu cầu raw event
> archive, search hoặc analytics volume lớn.

### Next.js

> Project này backend-focused, không có frontend Next.js. Em có thể hỗ trợ API
> integration và component/hooks cơ bản, nhưng không tự nhận là frontend chính.

---

## 9. Các câu hỏi rất dễ bị hỏi từ CV

### "Em đã tự code bao nhiêu và AI làm bao nhiêu?"

> Em dùng AI để phân tích requirement, tạo plan, đề xuất implementation và review.
> Tuy nhiên em không apply mù quáng. Em kiểm tra boundary kiến trúc, đọc diff,
> chạy build/lint/test và test luồng thực tế. Một ví dụ là MCP OAuth: test code
> có thể pass nhưng runtime process vẫn crash do encryption key sai; em trace từ
> lỗi `Connection closed` về stderr của child process và xác định root cause.
> Em chịu trách nhiệm về code cuối cùng, không coi output AI là kết quả đã đúng.

### "Idempotency trong dự án của em hoạt động thế nào?"

Trả lời theo 4 tầng:

1. Deterministic key từ business identity.
2. Unique constraint trong PostgreSQL theo workspace.
3. Worker state guard/atomic claim.
4. ACK sau commit để redelivery vẫn an toàn.

### "Tại sao dùng RabbitMQ thay vì gọi trực tiếp?"

> Webhook và Slack cần response nhanh; AI, Airtable và Facebook có latency và có
> thể lỗi tạm thời. RabbitMQ tách ingress khỏi processing, buffer burst, retry
> có backoff, DLQ và scale consumer độc lập.

### "Khi nào retry, khi nào DLQ?"

- Timeout, network, 429, temporary 5xx: bounded retry.
- Invalid schema, permission, expired token, missing entity: terminal/DLQ hoặc
  mark failed tùy business case.
- Retry count được lưu header/Ledger.
- Original message chỉ ACK sau khi retry/DLQ publish được confirm.

### "Làm sao ngăn duplicate Facebook post?"

- Publish job có unique idempotency key.
- Worker atomically claim eligible status.
- Job đã publishing/published sẽ no-op.
- External result lưu vào Ledger.
- Queue redelivery không tự động gọi Facebook lại nếu state đã advanced.

### "Transaction có bao gồm external API call không?"

Không giữ transaction trong lúc gọi external API:

1. Transaction ngắn để claim và commit processing state.
2. Gọi external API ngoài transaction.
3. Transaction ngắn để persist result.

Lý do: tránh lock dài, pool exhaustion và transaction timeout. Đổi lại cần
idempotency và recovery state.

### "RLS để làm gì nếu query đã có workspace_id?"

Query scoping là lớp ứng dụng; RLS là defense-in-depth ở database. Nếu developer
quên điều kiện workspace, RLS vẫn ngăn cross-tenant access. Cả `USING` và
`WITH CHECK` cần được cấu hình.

### "MCP khác REST API thế nào trong dự án?"

MCP là stable tool protocol giữa orchestrator và execution server qua stdio.
Orchestrator gọi tool theo schema, MCP server giữ platform-specific logic và
credential resolution. REST routes vẫn dùng cho external HTTP clients như
Airtable, Slack và admin.

### "Vì sao dùng Zod?"

- Runtime validation, TypeScript type chỉ tồn tại lúc compile.
- Shared schema giữa producer/consumer.
- `.strict()` chặn extra fields.
- Security refine chặn forbidden token/payload fields.

### "Event loop liên quan gì?"

- Node chạy JavaScript trên event loop.
- I/O database/network/RabbitMQ là non-blocking.
- Không dùng blocking sleep cho retry.
- Retry được đẩy sang RabbitMQ TTL queue.
- CPU-heavy work không nên chạy trực tiếp trong request handler.

### "CommonJS và ESM?"

Repo đặt `"type": "module"`, TypeScript import sử dụng `.js` extension để output
ESM resolve đúng. Helper `.cjs` được dùng khi cần CommonJS script.

### "Đã gặp bug runtime nào?"

Ví dụ tốt:

- Queue declaration mismatch gây RabbitMQ 406.
- Slack timeout do route cho processing dài.
- MCP child process `Connection closed` do invalid encryption key.
- Environment không được forward vào stdio child.
- Meta OAuth scope/use-case là external blocker.

Trình bày theo Situation -> Root cause -> Fix -> Verification.

---

## 10. Câu hỏi theo JD

### Node.js

1. Async/await có block event loop không?
2. `Promise.all` nên và không nên dùng khi nào?
3. Xử lý unhandled rejection và graceful shutdown ra sao?
4. Event loop, microtask queue và I/O callback khác nhau thế nào?
5. ESM resolution tại sao import source TS lại có `.js`?

### REST API

1. Validation nằm ở đâu?
2. HTTP status cho validation/auth/conflict/internal error?
3. Làm sao idempotent POST endpoint?
4. Tại sao Slack invalid command vẫn có thể trả HTTP 200?
5. Pagination/filter/report CSV thiết kế thế nào?

### PostgreSQL

1. Transaction isolation và row lock?
2. `SELECT ... FOR UPDATE SKIP LOCKED` dùng khi nào?
3. Unique constraint bảo vệ idempotency ra sao?
4. RLS `USING` và `WITH CHECK` khác nhau?
5. CTE pre-aggregate tránh double-count như thế nào?
6. Index nào cần cho queue polling và report?
7. Vì sao audit append-only dùng trigger?

### RabbitMQ

1. Exchange, routing key, queue và binding?
2. ACK, NACK, requeue?
3. Prefetch để làm gì?
4. Confirm channel khác normal channel?
5. TTL retry queue hoạt động ra sao?
6. DLQ replay cần chú ý idempotency thế nào?
7. Message ordering có được đảm bảo tuyệt đối không?

### NestJS mapping

| Express project | NestJS |
|:---|:---|
| `server.ts` wiring | Root/App Module |
| Route factory | Controller |
| Worker/service class | Injectable Service |
| Repository class | Provider |
| Signature verification | Guard/Middleware |
| Zod request parsing | Pipe |
| Error mapping | Exception Filter |
| Logging/audit wrapper | Interceptor |
| Constructor mocks | DI testing module |

### AI usage

1. AI giúp phân tích requirement như thế nào?
2. Làm sao phát hiện AI code sai?
3. Có bao giờ AI đề xuất vi phạm architecture boundary?
4. Làm sao bảo vệ secret khi đưa context cho AI?
5. Verification gate trước khi merge là gì?

---

## 11. Điểm cần sửa trong cách ghi CV

Bản CV hiện tại phù hợp JD, nhưng cần tránh để interviewer hiểu rằng bạn đã
production-deploy Meta flow hoàn chỉnh.

### Bản đề xuất

**MediaOps Composability - Nền tảng vận hành nội dung đa kênh (Dự án cá nhân)**

**Vai trò:** Backend Developer

**Backend highlights:**

- Xây dựng event-driven pipeline từ Airtable Approved Webhook đến AI generation,
  policy validation và Facebook publish job với idempotency và zero-trust reload.
- Triển khai RabbitMQ consumers với confirm publish, TTL retry, per-queue DLQ và
  nguyên tắc ACK sau khi commit PostgreSQL Ledger.
- Phát triển Policy Engine dạng pure functions để kiểm tra approval, channel/token
  metadata, forbidden terms, Facebook constraints và CTA/UTM.
- Tách Facebook integration qua MCP server, áp dụng encrypted secret references
  và ngăn raw token xuất hiện trong queue, log, Slack và audit.
- Thiết kế PostgreSQL migrations, RLS theo workspace, append-only audit,
  shared Zod contracts và automated tests cho route, worker, queue và security.

**Công nghệ:** TypeScript, Node.js, Express.js, PostgreSQL, RabbitMQ, Zod,
MCP SDK, Node Test Runner, Git.

**Demo source:** `https://github.com/Linhtranne/Muti-Media-Management`

Không thêm NestJS, Prisma, Docker, Redis, WebSocket vào technology list nếu chưa
thực sự implement.

---

## 12. Giới hạn và production readiness

Cần nói rõ để không bị bắt bẻ:

- Build/lint/test local là bằng chứng về code quality, không đồng nghĩa production.
- Database schema đã được apply trên staging InsForge.
- RabbitMQ và Slack đã được kết nối/test từng phần.
- Meta OAuth/Graph API thật đang bị chặn bởi Meta app use-case và permission.
- Ngrok chỉ là local tunnel, không phải production deployment.
- Chưa có frontend Next.js.
- Chưa có containerized deployment hoàn chỉnh.
- Chưa có load test, full observability stack và disaster recovery drill.

Trả lời production:

> Phần code đã có các production-oriented guardrail như idempotency, RLS,
> encrypted secret store, ACK-after-commit, retry/DLQ và audit. Tuy nhiên em
> không gọi toàn hệ thống là production-ready cho đến khi Meta permission được
> phê duyệt, service được containerize/deploy trên stable compute, secret được
> quản lý chuẩn, migration rollout được verify và có monitoring/alerting.

---

## 13. Kế hoạch ôn trong một ngày

### Vòng 1 - 90 phút

- Học mục 2-5.
- Tự vẽ lại architecture không nhìn tài liệu.
- Trình bày luồng publish trong 5 phút.

### Vòng 2 - 90 phút

- Học `server.ts`, routes, workers và repositories.
- Giải thích dependency injection thủ công.
- Giải thích transaction boundary và ACK ordering.

### Vòng 3 - 60 phút

- Học Node.js event loop, async/await, ESM.
- Học RabbitMQ exchange/queue/binding/ACK/prefetch/retry/DLQ.
- Học PostgreSQL transaction/index/RLS/unique constraint.

### Vòng 4 - 60 phút

- Luyện các khoảng trống trong NestJS, ORM, Docker, WebSocket.
- Không học thuộc giả kinh nghiệm; tập map concept hiện có sang công nghệ JD.

### Vòng 5 - 45 phút

- Trả lời 10 câu hỏi ở mục 9 thành tiếng.
- Mỗi câu 1-2 phút, có ví dụ code/bug trong dự án.

---

## 14. Checklist trước phỏng vấn

- [ ] Giới thiệu dự án dưới 60 giây.
- [ ] Vẽ được luồng Airtable -> RabbitMQ -> Worker -> Ledger.
- [ ] Giải thích ACK-after-commit.
- [ ] Giải thích idempotency ở DB và worker.
- [ ] Giải thích MCP credential boundary.
- [ ] Giải thích RLS và workspace scoping.
- [ ] Giải thích raw SQL thay vì ORM.
- [ ] Map Express architecture sang NestJS.
- [ ] Nói đúng mục về production readiness.
- [ ] Có 2 bug stories theo Situation/Root cause/Fix/Verification.
- [ ] Không tự nhận kinh nghiệm chưa có.
