# Product Backlog

## Epic E01: Control Plane CMS

### US-001: Thiết lập Airtable base cho campaign/post workflow

**Description**  
Là Social Media Manager, tôi muốn quản lý campaign, post, asset, lịch đăng và trạng thái duyệt trong Airtable để cả team có một nơi làm việc chung.

**User Flow**
1. SMM tạo Campaign.
2. SMM/Creator tạo Post thuộc Campaign.
3. Creator nhập master copy, CTA URL, asset link, channel target.
4. SMM chuyển trạng thái Post qua Review.
5. Manager chuyển trạng thái Post sang Approved.

**Data Fields**
- Campaign: `campaign_id`, `name`, `objective`, `start_date`, `end_date`, `owner`, `status`.
- Post: `post_id`, `campaign_id`, `title`, `master_copy`, `cta_url`, `asset_links`, `target_channels`, `scheduled_at`, `status`, `reviewer`, `approved_at`.

**Acceptance Criteria (AC)**
- AC1: Có Airtable schema/view cho Campaign và Post.
- AC2: Post có đủ trạng thái `Draft`, `Review`, `Approved`, `Scheduled`, `Published`, `Failed`.
- AC3: Chỉ record `Approved` mới được gửi sang middleware.
- AC4: View Calendar hiển thị lịch đăng theo `scheduled_at`.

**Business Rules**
- BR1: Post không được Approved nếu thiếu `master_copy`.
- BR2: Post có `target_channels` chứa Facebook thì phải có Facebook Page đã kết nối.
- BR3: `scheduled_at` không được nhỏ hơn thời điểm hiện tại.

### US-002: Webhook Airtable kích hoạt workflow khi Post Approved

**Description**  
Là hệ thống, tôi muốn nhận webhook khi Post chuyển sang Approved để tự động tạo AI variant và publish workflow.

**User Flow**
1. Manager chuyển Post sang Approved.
2. Airtable gửi webhook đến middleware.
3. Middleware xác minh event.
4. Middleware kiểm tra duplicate.
5. Middleware tạo AI generation run.

**Data Fields**
- Webhook Event: `event_id`, `source`, `record_id`, `table_name`, `change_type`, `received_at`, `processed_at`, `status`, `error_message`.

**Acceptance Criteria (AC)**
- AC1: Event Approved được ghi vào Operational Ledger.
- AC2: Event trùng không tạo workflow trùng.
- AC3: Event không liên quan bị bỏ qua nhưng vẫn có log.
- AC4: Lỗi xử lý webhook có trạng thái `failed` và message rõ.

**Business Rules**
- BR1: Middleware chỉ xử lý Post có status `Approved`.
- BR2: Mỗi `record_id + status_version` chỉ tạo một workflow.
- BR3: Không publish trực tiếp từ webhook.

### US-013: Thiết lập Notion Knowledge & Brief Plane

**Description**  
Là Social Media Manager, tôi muốn lưu campaign brief, brand guideline, content guideline và legal note trong Notion để AI và team có ngữ cảnh đầy đủ khi tạo nội dung.

**User Flow**
1. SMM tạo Campaign Brief page trong Notion.
2. SMM gắn link Notion Brief vào Campaign trong Airtable.
3. Team cập nhật brand voice, guideline, legal note trong Notion.
4. AI Orchestrator đọc link Notion được cấu hình khi tạo variant.
5. Output AI ghi rõ đã dùng context nào.

**Data Fields**
- Notion Brief: `notion_page_id`, `campaign_id`, `title`, `brief_summary`, `brand_voice`, `do_terms`, `avoid_terms`, `legal_notes`, `last_edited_at`.
- Airtable Campaign: thêm field `Notion Brief URL`.

**Acceptance Criteria (AC)**
- AC1: Mỗi campaign có thể gắn một Notion Brief URL.
- AC2: Notion có template Campaign Brief thống nhất.
- AC3: AI run lưu reference đến Notion page/context đã dùng.
- AC4: Không có secret/token trong Notion page.

**Business Rules**
- BR1: Airtable vẫn là nguồn trạng thái workflow chính.
- BR2: Notion chỉ là nguồn ngữ cảnh/tài liệu, không là queue hoặc audit ledger.
- BR3: Nếu Notion context không đọc được, workflow chuyển `needs_manual_review` hoặc dùng fallback theo cấu hình.

## Epic E02: AI Orchestration

### US-003: AI Composer tạo biến thể Facebook

**Description**  
Là Content Creator, tôi muốn AI tạo biến thể Facebook từ master copy để tiết kiệm thời gian chỉnh định dạng nội dung.

**User Flow**
1. Middleware nhận Post Approved.
2. AI Agent đọc master copy và channel target.
3. AI tạo Facebook variant.
4. Middleware lưu kết quả vào Ledger và cập nhật Airtable.
5. Policy Engine kiểm tra variant.

**Data Fields**
- AI Run: `run_id`, `workspace_id`, `post_id`, `provider`, `prompt`, `input_snapshot`, `notion_context_refs`, `output_variant`, `status`, `created_at`.
- Variant: `variant_id`, `post_id`, `platform`, `body`, `hashtags`, `cta_url`, `approval_status`, `policy_status`.

**Acceptance Criteria (AC)**
- AC1: Variant có `body`, `hashtags`, `cta_url`.
- AC2: Variant gắn đúng `post_id` và `platform=facebook`.
- AC3: AI run lưu input/output snapshot.
- AC4: Nếu AI lỗi, Post không chuyển sang publish queue và có Slack alert.

**Business Rules**
- BR1: AI không được tự quyết định bỏ qua approval.
- BR2: Variant phải giữ ý chính của master copy.
- BR3: CTA URL phải giữ UTM nếu master copy/post có UTM.

### US-004: Policy Engine kiểm tra trước khi publish

**Description**  
Là Manager, tôi muốn hệ thống kiểm tra rule trước khi publish để tránh đăng sai, thiếu approval hoặc vi phạm rule nội dung.

**User Flow**
1. Variant được tạo.
2. Policy Engine kiểm tra fields/rules.
3. Nếu pass, tạo publish job.
4. Nếu fail, cập nhật Airtable `Needs Review` và gửi Slack alert.

**Data Fields**
- Rule Result: `result_id`, `post_id`, `variant_id`, `allowed`, `blockers`, `warnings`, `checks`, `created_at`.

**Acceptance Criteria (AC)**
- AC1: Block khi thiếu approval.
- AC2: Block khi thiếu Facebook token hợp lệ.
- AC3: Block khi có forbidden term.
- AC4: Warning khi thiếu UTM nhưng không nhất thiết block nếu rule cấu hình cho phép.

**Business Rules**
- BR1: Auto publish chỉ chạy nếu `auto_publish_enabled = true` và `auto_approve_enabled = true`.
- BR2: Role `manager` hoặc `admin` mới bật auto-approve.
- BR3: Mọi rule result phải được audit.

## Epic E03: MCP Execution Plane

### US-005: Facebook MCP validate và enqueue publish job

**Description**  
Là hệ thống, tôi muốn Facebook MCP server validate và enqueue publish job để đảm bảo idempotency, quota và retry.

**User Flow**
1. Middleware gọi MCP tool `validate_post`.
2. MCP trả kết quả constraints.
3. Middleware gọi `enqueue_publish`.
4. MCP tạo job với idempotency key.
5. Job chờ đến `scheduled_at`.

**Data Fields**
- Publish Job: `job_id`, `workspace_id`, `post_id`, `variant_id`, `channel_account_id`, `scheduled_at`, `status`, `idempotency_key`, `queue_message_id`, `retry_count`, `last_error`.

**Acceptance Criteria (AC)**
- AC1: Cùng idempotency key không tạo job trùng.
- AC2: Job có trạng thái `queued`, `publishing`, `published`, `failed`, `needs_review`.
- AC3: MCP kiểm tra quota trước khi publish.
- AC4: Job fail có error message và audit.

**Business Rules**
- BR1: Không publish nếu quota ngày đã hết.
- BR2: Retry chỉ áp dụng lỗi tạm thời.
- BR3: Lỗi permission/token phải fail ngay và yêu cầu admin xử lý.

### US-006: Facebook MCP publish post

**Description**  
Là hệ thống, tôi muốn MCP server publish post lên Facebook Page thay vì để AI gọi Graph API trực tiếp.

**User Flow**
1. Worker lấy job đến hạn.
2. MCP kiểm tra token và policy snapshot.
3. MCP gọi Facebook Graph API.
4. MCP lưu external post id.
5. MCP cập nhật Airtable và gửi Slack success/failure.

**Data Fields**
- Publish Response: `external_post_id`, `platform_response_summary`, `published_at`, `status`, `error_code`, `error_message`.

**Acceptance Criteria (AC)**
- AC1: Publish thành công lưu `external_post_id`.
- AC2: Publish fail cập nhật job `failed`.
- AC3: Audit có request summary và response summary.
- AC4: Không log raw access token.

**Business Rules**
- BR1: Token không bao giờ xuất hiện ở Airtable hoặc Slack.
- BR2: AI Agent chỉ gọi MCP tool, không giữ token.
- BR3: Mọi publish phải có audit trước và sau.

### US-007: Sync Facebook comments vào Ledger và Slack

**Description**  
Là Support, tôi muốn comment Facebook được đồng bộ và gửi cảnh báo vào Slack để phản hồi nhanh.

**User Flow**
1. MCP sync comments theo post.
2. Comment mới được upsert vào Ledger.
3. Risk keyword/sentiment được kiểm tra.
4. Slack nhận alert ở channel phù hợp.
5. Support reply hoặc escalate từ Slack.

**Data Fields**
- Interaction: `interaction_id`, `platform`, `external_id`, `post_id`, `author`, `message`, `sentiment`, `status`, `created_at_platform`.
- Slack Alert: `alert_id`, `interaction_id`, `channel`, `message_ts`, `status`.

**Acceptance Criteria (AC)**
- AC1: Sync lại không tạo comment trùng.
- AC2: Comment risk được gửi channel crisis.
- AC3: Comment thường được gửi inbox channel.
- AC4: Interaction có link về Facebook permalink.

**Business Rules**
- BR1: Không gửi dữ liệu nhạy cảm không cần thiết vào Slack.
- BR2: Comment có keyword khủng hoảng phải escalate.
- BR3: Comment đã resolved không alert lại.

## Epic E04: Communication Plane

### US-008: Slack slash command duyệt/reject post

**Description**  
Là Manager, tôi muốn duyệt hoặc reject post từ Slack để không phải mở Airtable trong mọi tình huống.

**User Flow**
1. Slack hiển thị alert cần duyệt.
2. Manager chạy `/approve_post <post_id>` hoặc `/reject_post <post_id> <reason>`.
3. Middleware verify signature và role.
4. Middleware cập nhật Airtable và Ledger.
5. Slack trả kết quả.

**Data Fields**
- Command Event: `command_id`, `slack_user_id`, `command`, `args`, `verified`, `role`, `status`, `created_at`.

**Acceptance Criteria (AC)**
- AC1: Command không hợp lệ bị từ chối.
- AC2: User không có role manager/admin không approve được.
- AC3: Approve/reject cập nhật Airtable.
- AC4: Mọi command có audit log.

**Business Rules**
- BR1: Slash command phải verify Slack signature.
- BR2: Reject bắt buộc có reason.
- BR3: Command timeout phải trả response nhanh và xử lý async nếu cần.

### US-009: Slack slash command reply/escalate comment

**Description**  
Là Support, tôi muốn phản hồi hoặc escalate comment từ Slack để xử lý nhanh các tương tác quan trọng.

**User Flow**
1. Support nhận alert comment.
2. Support chạy `/reply_comment <interaction_id> <message>`.
3. Middleware verify role.
4. Middleware gọi MCP `reply_comment`.
5. Ledger cập nhật status và audit.

**Data Fields**
- Reply Action: `reply_id`, `interaction_id`, `actor_id`, `message`, `status`, `external_reply_id`, `created_at`.

**Acceptance Criteria (AC)**
- AC1: Support/Manager/Admin reply được.
- AC2: Creator không reply được nếu không có quyền support.
- AC3: Reply fail có error rõ và không đánh dấu resolved.
- AC4: Escalate gửi crisis channel.

**Business Rules**
- BR1: Reply phải gắn interaction còn tồn tại.
- BR2: Message rỗng bị từ chối.
- BR3: Reply qua MCP, không gọi API trực tiếp từ Slack handler.

## Epic E05: Governance, Audit, Reporting

### US-010: Operational Ledger và Audit Log

**Description**  
Là Admin/CMO, tôi muốn mọi webhook, AI run, policy result, publish job và Slack command được ghi log để có thể truy vết và báo cáo.

**User Flow**
1. Mỗi subsystem gửi event vào Ledger.
2. Ledger lưu trạng thái, actor, entity, metadata.
3. Admin xem audit theo campaign/post/job.
4. CMO xuất báo cáo cơ bản.

**Data Fields**
- Audit Log: `audit_id`, `workspace_id`, `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `metadata`, `created_at`.

**Acceptance Criteria (AC)**
- AC1: Publish job có audit trước/sau.
- AC2: Slack command có audit.
- AC3: AI run có audit.
- AC4: Không lưu raw token trong audit.

**Business Rules**
- BR1: Audit log append-only.
- BR2: Metadata nhạy cảm phải mask.
- BR3: Audit retention tối thiểu 12 tháng cho production.

### US-011: Admin cấu hình Facebook Page

**Description**  
Là Admin, tôi muốn kết nối Facebook Page và quản lý trạng thái token để hệ thống có thể publish/comment sync an toàn.

**User Flow**
1. Admin bắt đầu OAuth.
2. Admin chọn Page.
3. System lưu token server-side.
4. Channel account hiển thị connected.
5. Token hết hạn sẽ cảnh báo.

**Data Fields**
- Channel Account: `channel_account_id`, `platform`, `external_account_id`, `display_name`, `token_status`, `connected_at`, `last_checked_at`.
- Token Reference: `token_id`, `channel_account_id`, `scopes`, `expires_at`, `secret_ref`.

**Acceptance Criteria (AC)**
- AC1: Token không xuất hiện ở Airtable/Slack.
- AC2: Admin thấy trạng thái connected/expired.
- AC3: Thiếu permission thì hệ thống báo rõ.
- AC4: Token health check ghi audit.

**Business Rules**
- BR1: Chỉ Admin được connect/disconnect Page.
- BR2: Token lưu trong secret storage, Ledger chỉ lưu reference.
- BR3: Permission Meta phải xác minh theo docs chính thức trước production.

### US-012: Báo cáo campaign cơ bản

**Description**  
Là CMO, tôi muốn xem campaign nào đã publish, lỗi gì, có bao nhiêu comment/risk để đánh giá vận hành.

**User Flow**
1. CMO mở reporting view.
2. Hệ thống tổng hợp từ Ledger.
3. CMO lọc theo campaign/date/channel.
4. CMO xuất CSV hoặc Airtable synced view.

**Data Fields**
- Report Row: `campaign_id`, `posts_published`, `publish_failed`, `comments_total`, `risk_comments`, `avg_response_time`, `last_updated_at`.

**Acceptance Criteria (AC)**
- AC1: Report có số post published/failed.
- AC2: Report có số comments/risk comments.
- AC3: Có filter campaign/date.
- AC4: Dữ liệu lấy từ Ledger, không tính từ Slack message.

**Business Rules**
- BR1: Report chỉ dùng dữ liệu đã xử lý thành công.
- BR2: Failed job vẫn hiển thị để CMO thấy rủi ro vận hành.
- BR3: Không expose nội dung comment nhạy cảm trong report tổng hợp nếu không cần.


## Epic E06: Event Bus and Unified Direct Inbox

### US-014: RabbitMQ Event Bus cho publish/comment/direct message

**Description**  
Là hệ thống, tôi muốn dùng RabbitMQ làm event bus/queue để xử lý bất đồng bộ webhook, publish job, comment và direct message mà không làm nghẽn MCP hoặc middleware.

**User Flow**
1. Webhook receiver/MCP tạo event.
2. Event được publish vào RabbitMQ exchange.
3. Worker consume từ queue chuyên biệt.
4. Worker xử lý thành công thì ack.
5. Worker lỗi tạm thời thì retry/backoff.
6. Worker lỗi vĩnh viễn thì đưa vào DLQ và gửi alert.

**Data Fields**
- Queue Event: `event_id`, `type`, `workspace_id`, `source`, `payload_ref`, `idempotency_key`, `attempt_count`, `created_at`, `correlation_id`.
- Queue Metadata in Ledger: `queue_message_id`, `queue_name`, `status`, `last_attempt_at`, `last_error`.

**Acceptance Criteria (AC)**
- AC1: Có queue riêng cho publish, comment ingestion, direct message ingestion, Slack alert.
- AC2: Worker xử lý idempotent theo `idempotency_key`.
- AC3: Event lỗi tạm thời được retry.
- AC4: Event lỗi vượt retry đi vào DLQ và có Slack/Admin alert.

**Business Rules**
- BR1: RabbitMQ không là database dài hạn.
- BR2: Worker phải ghi trạng thái xử lý vào Ledger.
- BR3: Không đưa raw token vào message payload.
- BR4: Payload lớn lưu ở Ledger/object storage, RabbitMQ chỉ giữ reference.

### US-015: Unified Direct Message Inbox qua RabbitMQ và Ledger

**Description**  
Là Support, tôi muốn tin nhắn trực tiếp từ các nền tảng được gom về một inbox thống nhất, có trạng thái xử lý và có thể phản hồi từ Slack/Teams.

**User Flow**
1. Messenger/Zalo/Instagram MCP nhận direct message webhook.
2. MCP publish event vào RabbitMQ queue `dm.<platform>.ingest`.
3. Worker upsert conversation/message vào Ledger.
4. Worker gửi Slack/Teams alert nếu cần.
5. Support reply bằng command.
6. Reply Worker gọi MCP gửi phản hồi về nền tảng gốc.
7. Ledger ghi audit và trạng thái conversation.

**Data Fields**
- Conversation: `conversation_id`, `workspace_id`, `platform`, `external_thread_id`, `customer_ref`, `status`, `assigned_to`, `last_message_at`, `sla_due_at`.
- Message: `message_id`, `conversation_id`, `external_message_id`, `direction`, `sender_type`, `body`, `attachments`, `created_at_platform`.
- Reply Job: `reply_job_id`, `conversation_id`, `message_id`, `actor_id`, `status`, `idempotency_key`.

**Acceptance Criteria (AC)**
- AC1: Message trùng không tạo duplicate.
- AC2: Conversation có trạng thái `new`, `assigned`, `waiting`, `resolved`, `escalated`.
- AC3: Reply qua Slack/Teams được audit.
- AC4: MCP gửi reply về đúng platform/thread.

**Business Rules**
- BR1: Airtable/Notion không lưu toàn bộ nội dung direct message.
- BR2: Direct message là dữ liệu nhạy cảm, cần phân quyền và audit.
- BR3: RabbitMQ xử lý ingestion/reply async; Ledger lưu trạng thái lâu dài.
