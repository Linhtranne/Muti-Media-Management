/**
 * US-014: RabbitMQ Topology Configuration
 *
 * Config-driven registry of all queues, exchanges, routing keys, DLQs, and
 * retry policies. Used by consumers to self-declare topology on startup.
 *
 * RULES:
 * - Do NOT rename existing queues/exchanges — backward compatibility required.
 * - Per-queue DLQ: `<queue>.dlq`
 * - TTL retry queues: `<queue>.retry.<ttlMs>`
 * - `mediaops.events.topic` is the new canonical exchange (additive only).
 * - Legacy exchanges (airtable.webhooks, ai.workflows, publish.workflows, etc.) remain.
 */

export interface QueueTopologyEntry {
  /** Exchange name */
  exchange: string;
  /** Exchange type */
  exchangeType: "topic" | "direct" | "fanout";
  /** Main queue name */
  queue: string;
  /** Routing key for binding */
  routingKey: string;
  /** Per-queue DLQ name (`<queue>.dlq`) */
  dlq: string;
  /**
   * Retry TTL steps in ms (exponential backoff anchors).
   * Consumer creates TTL queues on demand: `<queue>.retry.<ttlMs>`
   */
  retryTtlMs: number[];
  /** Max retry attempts before moving to DLQ */
  maxRetries: number;
  /** Consumer prefetch count */
  prefetch: number;
  /** Human-readable description of what worker consumes this queue */
  workerBinding: string;
  /** US that owns this queue */
  ownerUs: string;
}

const TTL_HALF_SECOND_MS = 500;
const TTL_ONE_SECOND_MS = 1000;
const TTL_TWO_SECONDS_MS = 2000;
const TTL_FOUR_SECONDS_MS = 4000;
const TTL_EIGHT_SECONDS_MS = 8000;
const TTL_SIXTEEN_SECONDS_MS = 16000;
const TTL_THIRTY_TWO_SECONDS_MS = 32000;

const STANDARD_RETRY_TTL_MS = [
  TTL_ONE_SECOND_MS,
  TTL_TWO_SECONDS_MS,
  TTL_FOUR_SECONDS_MS,
  TTL_EIGHT_SECONDS_MS,
  TTL_SIXTEEN_SECONDS_MS
];
const SLOW_RETRY_TTL_MS = [
  TTL_TWO_SECONDS_MS,
  TTL_FOUR_SECONDS_MS,
  TTL_EIGHT_SECONDS_MS,
  TTL_SIXTEEN_SECONDS_MS,
  TTL_THIRTY_TWO_SECONDS_MS
];
const COMMENT_INGEST_RETRY_TTL_MS = [
  TTL_HALF_SECOND_MS,
  TTL_ONE_SECOND_MS,
  TTL_TWO_SECONDS_MS,
  TTL_FOUR_SECONDS_MS,
  TTL_EIGHT_SECONDS_MS
];
const SHORT_RETRY_TTL_MS = [
  TTL_ONE_SECOND_MS,
  TTL_TWO_SECONDS_MS,
  TTL_FOUR_SECONDS_MS
];
const DM_RETRY_TTL_MS = [
  TTL_ONE_SECOND_MS,
  TTL_TWO_SECONDS_MS,
  TTL_FOUR_SECONDS_MS,
  TTL_EIGHT_SECONDS_MS
];

/**
 * Full topology inventory for MediaOps Composability.
 * Order: approximate creation order US-002 → US-009 + shared alerting.
 */
export const QUEUE_TOPOLOGY: QueueTopologyEntry[] = [
  // ─── US-002: Airtable Webhook Ingress ───────────────────────────────────
  {
    exchange: "airtable.webhooks",
    exchangeType: "topic",
    queue: "airtable.webhook.approved",
    routingKey: "airtable.post.approved.ingress",
    dlq: "airtable.webhook.approved.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "ApprovedPostWorker",
    ownerUs: "US-002"
  },

  // ─── US-003: AI Composer Queue ───────────────────────────────────────────
  {
    exchange: "ai.workflows",
    exchangeType: "topic",
    queue: "ai.compose.facebook.requested",
    routingKey: "ai.compose.facebook.requested",
    dlq: "ai.compose.facebook.requested.dlq",
    retryTtlMs: SLOW_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "AiComposerWorker",
    ownerUs: "US-003"
  },

  // ─── US-004: Policy Evaluate ──────────────────────────────────────────────
  {
    exchange: "publish.workflows",
    exchangeType: "topic",
    queue: "policy.evaluate.requested",
    routingKey: "policy.evaluate.requested",
    dlq: "policy.evaluate.requested.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "PolicyWorker",
    ownerUs: "US-004"
  },

  // ─── US-005: Validate (Requested → Validated) ────────────────────────────
  {
    exchange: "publish.workflows",
    exchangeType: "topic",
    queue: "publish.facebook.requested",
    routingKey: "publish.facebook.requested",
    dlq: "publish.facebook.requested.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "McpValidateWorker",
    ownerUs: "US-005"
  },
  {
    exchange: "publish.workflows",
    exchangeType: "topic",
    queue: "publish.facebook.validated",
    routingKey: "publish.facebook.validated",
    dlq: "publish.facebook.validated.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "McpValidateWorker (output queue — consumed by McpPublishWorker)",
    ownerUs: "US-005"
  },

  // ─── US-006: Publish Execution ────────────────────────────────────────────
  {
    exchange: "publish.workflows",
    exchangeType: "topic",
    queue: "publish.facebook.execute",
    routingKey: "publish.facebook.execute",
    dlq: "publish.facebook.execute.dlq",
    retryTtlMs: SLOW_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "McpPublishWorker",
    ownerUs: "US-006"
  },

  // ─── US-007: Facebook Comment Sync ───────────────────────────────────────
  {
    exchange: "comments.workflows",
    exchangeType: "topic",
    queue: "comments.facebook.sync.requested",
    routingKey: "comments.facebook.sync.requested",
    dlq: "comments.facebook.sync.requested.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "FacebookCommentSyncWorker (sync request)",
    ownerUs: "US-007"
  },
  {
    exchange: "comments.workflows",
    exchangeType: "topic",
    queue: "comments.facebook.ingest",
    routingKey: "comments.facebook.ingest",
    dlq: "comments.facebook.ingest.dlq",
    retryTtlMs: COMMENT_INGEST_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 5,
    workerBinding: "FacebookCommentSyncWorker (ingest)",
    ownerUs: "US-007"
  },

  // ─── US-008: Slack Post Approval ─────────────────────────────────────────
  {
    exchange: "slack.workflows",
    exchangeType: "topic",
    queue: "slack.post_approval.requested",
    routingKey: "slack.post_approval.requested",
    dlq: "slack.post_approval.requested.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "SlackPostApprovalWorker",
    ownerUs: "US-008"
  },

  // ─── US-009: Slack Comment Action ────────────────────────────────────────
  {
    exchange: "slack.workflows",
    exchangeType: "topic",
    queue: "slack.comment_action.requested",
    routingKey: "slack.comment_action.requested",
    dlq: "slack.comment_action.requested.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "SlackCommentActionWorker",
    ownerUs: "US-009"
  },

  // ─── Shared Alerting ──────────────────────────────────────────────────────
  {
    exchange: "alerts",
    exchangeType: "topic",
    queue: "alerts.slack.send",
    routingKey: "alerts.slack.send",
    dlq: "alerts.slack.send.dlq",
    retryTtlMs: SHORT_RETRY_TTL_MS,
    maxRetries: 3,
    prefetch: 5,
    workerBinding: "SlackAlertWorker (shared)",
    ownerUs: "shared"
  },

  // ─── US-015: Direct Message Inbox ───────────────────────────────────────
  {
    exchange: "mediaops.events.topic",
    exchangeType: "topic",
    queue: "dm.facebook.ingest",
    routingKey: "dm.facebook.ingest",
    dlq: "dm.facebook.ingest.dlq",
    retryTtlMs: DM_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 5,
    workerBinding: "DirectMessageIngestWorker",
    ownerUs: "US-015"
  },
  {
    exchange: "mediaops.events.topic",
    exchangeType: "topic",
    queue: "dm.instagram.ingest",
    routingKey: "dm.instagram.ingest",
    dlq: "dm.instagram.ingest.dlq",
    retryTtlMs: DM_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 5,
    workerBinding: "Stub",
    ownerUs: "US-015"
  },
  {
    exchange: "mediaops.events.topic",
    exchangeType: "topic",
    queue: "dm.zalo.ingest",
    routingKey: "dm.zalo.ingest",
    dlq: "dm.zalo.ingest.dlq",
    retryTtlMs: DM_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 5,
    workerBinding: "Stub",
    ownerUs: "US-015"
  },
  {
    exchange: "mediaops.events.topic",
    exchangeType: "topic",
    queue: "dm.reply.requested",
    routingKey: "dm.reply.requested",
    dlq: "dm.reply.requested.dlq",
    retryTtlMs: DM_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "DirectMessageReplyWorker",
    ownerUs: "US-015"
  },
  // ─── US-016: Media Ingestion & Optimization ──────────────────────────────
  {
    exchange: "mediaops.events.topic",
    exchangeType: "topic",
    queue: "media.asset.ingest.requested",
    routingKey: "media.asset.ingest.requested",
    dlq: "media.asset.ingest.requested.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "MediaAssetIngestWorker",
    ownerUs: "US-016"
  },
  {
    exchange: "mediaops.events.topic",
    exchangeType: "topic",
    queue: "media.asset.optimize.requested",
    routingKey: "media.asset.optimize.requested",
    dlq: "media.asset.optimize.requested.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "MediaAssetOptimizeWorker",
    ownerUs: "US-016"
  },
  // ─── US-017: TikTok Publishing ──────────────────────────────────────────
  {
    exchange: "publish.workflows",
    exchangeType: "topic",
    queue: "publish.tiktok.requested",
    routingKey: "publish.tiktok.requested",
    dlq: "publish.tiktok.requested.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "TiktokValidateWorker",
    ownerUs: "US-017"
  },
  {
    exchange: "publish.workflows",
    exchangeType: "topic",
    queue: "publish.tiktok.validated",
    routingKey: "publish.tiktok.validated",
    dlq: "publish.tiktok.validated.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "TiktokValidateWorker (output queue)",
    ownerUs: "US-017"
  },
  {
    exchange: "publish.workflows",
    exchangeType: "topic",
    queue: "publish.tiktok.execute",
    routingKey: "publish.tiktok.execute",
    dlq: "publish.tiktok.execute.dlq",
    retryTtlMs: SLOW_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "TiktokPublishWorker",
    ownerUs: "US-017"
  },
  {
    exchange: "publish.workflows",
    exchangeType: "topic",
    queue: "publish.tiktok.status_check",
    routingKey: "publish.tiktok.status_check",
    dlq: "publish.tiktok.status_check.dlq",
    retryTtlMs: STANDARD_RETRY_TTL_MS,
    maxRetries: 5,
    prefetch: 1,
    workerBinding: "TiktokStatusCheckWorker",
    ownerUs: "US-017"
  }
];

// ─── Canonical Topic Exchange (US-014 additive standard) ─────────────────────
export const CANONICAL_TOPIC_EXCHANGE = "mediaops.events.topic";

/**
 * Lookup a topology entry by queue name.
 * Returns undefined if the queue is not in the registry.
 */
export function getTopologyByQueue(queueName: string): QueueTopologyEntry | undefined {
  return QUEUE_TOPOLOGY.find((t) => t.queue === queueName);
}

/**
 * Returns all DLQ names in the topology.
 * Used for assertions and testing.
 */
export function getAllDlqNames(): string[] {
  return QUEUE_TOPOLOGY.map((t) => t.dlq);
}

/**
 * Returns all main queue names in the topology.
 */
export function getAllQueueNames(): string[] {
  return QUEUE_TOPOLOGY.map((t) => t.queue);
}
