import express from "express";
import { loadEnv } from "./config/env.js";
import { Logger } from "./lib/logger.js";
import { createDatabase } from "./ledger/postgres.js";
import { createRabbitMqPublisher } from "./queue/rabbitmqPublisher.js";
import { AirtableWebhookIngestor } from "./services/airtableWebhookIngestor.js";
import { createAirtableWebhookRouter } from "./routes/airtableWebhook.js";
import { createAirtableClient } from "./airtable/airtableClient.js";
import { ApprovedPostWorker } from "./workers/approvedPostWorker.js";
import { createRabbitMqConsumer } from "./queue/rabbitmqConsumer.js";
import { GeminiLlmAdapter } from "./ai/llmAdapter.js";
import { AiComposerWorker } from "./workers/ai-composer-worker.js";
import { createAiComposerRabbitMqConsumer } from "./queue/aiComposerRabbitmqConsumer.js";
import { PolicyWorker } from "./workers/policyWorker.js";
import { createPolicyRabbitMqConsumer } from "./queue/policyRabbitmqConsumer.js";
import { FacebookMcpClient } from "./mcp/facebookMcpClient.js";
import { TiktokMcpClient } from "./mcp/tiktokMcpClient.js";
import { McpValidateWorker } from "./workers/mcpValidateWorker.js";
import { TiktokValidateWorker } from "./workers/tiktokValidateWorker.js";
import { createMcpValidateRabbitMqConsumer } from "./queue/mcpValidateRabbitmqConsumer.js";
import { createTiktokValidateRabbitMqConsumer, type TiktokValidateQueueConsumer } from "./queue/tiktokValidateRabbitmqConsumer.js";
import { McpPublishWorker } from "./workers/mcpPublishWorker.js";
import { TiktokPublishWorker } from "./workers/tiktokPublishWorker.js";
import { createMcpPublishRabbitMqConsumer } from "./queue/mcpPublishRabbitmqConsumer.js";
import { createTiktokPublishRabbitMqConsumer, type TiktokPublishQueueConsumer } from "./queue/tiktokPublishRabbitmqConsumer.js";
import { TiktokStatusCheckWorker } from "./workers/tiktokStatusCheckWorker.js";
import { createTiktokStatusCheckRabbitMqConsumer, type TiktokStatusCheckQueueConsumer } from "./queue/tiktokStatusCheckRabbitmqConsumer.js";
import { McpPublishScheduler } from "./workers/mcpPublishScheduler.js";
import { SlackSignatureVerifier } from "./services/slackSignatureVerifier.js";
import { SlackCommandParser } from "./services/slackCommandParser.js";
import { SlackCommandRepository } from "./ledger/slackCommandRepository.js";
import { createSlackCommandsRouter } from "./routes/slackCommands.js";
import { createFacebookAdminRouter } from "./routes/facebookAdmin.js";
import { createReportsRouter } from "./routes/reports.js";
import { SlackPostApprovalWorker } from "./workers/slackPostApprovalWorker.js";
import { createSlackCommandRabbitmqConsumer } from "./queue/slackCommandRabbitmqConsumer.js";
import { CommentActionRepository } from "./ledger/commentActionRepository.js";
import { SlackCommentActionWorker } from "./workers/slackCommentActionWorker.js";
import { createSlackCommentActionRabbitmqConsumer } from "./queue/slackCommentActionRabbitmqConsumer.js";
import { CommentRiskClassifier } from "./services/commentRiskClassifier.js";
import { CommentSyncWorkerRepository } from "./ledger/commentSyncWorkerRepository.js";
import { FacebookCommentSyncWorker } from "./workers/facebookCommentSyncWorker.js";
import { createFacebookCommentSyncIngestConsumer } from "./queue/facebookCommentSyncIngestConsumer.js";
import { createFacebookCommentSyncRequestConsumer } from "./queue/facebookCommentSyncRequestConsumer.js";
import { createRabbitMqMonitor } from "./queue/rabbitmqMonitor.js";
import { CommentSyncSchedulerRepository } from "./ledger/commentSyncSchedulerRepository.js";
import { CommentSyncScheduler } from "./scheduler/commentSyncScheduler.js";
import { AirtableStatusPoller } from "./scheduler/airtableStatusPoller.js";
import { ChannelAccountAdminRepository } from "./ledger/channelAccountAdminRepository.js";
import { DirectMessageRepository } from "./ledger/directMessageRepository.js";
import { DirectMessageIngestWorker } from "./workers/directMessageIngestWorker.js";
import { DirectMessageReplyWorker } from "./workers/directMessageReplyWorker.js";
import { createDirectMessageIngestRabbitmqConsumer } from "./queue/directMessageIngestRabbitmqConsumer.js";
import { createDirectMessageReplyRabbitmqConsumer } from "./queue/directMessageReplyRabbitmqConsumer.js";
import { MediaRepository } from "./ledger/mediaRepository.js";
import { AuditLogRepository } from "./ledger/auditLogRepository.js";
import { R2StorageService } from "./services/r2Storage.js";
import { MediaDownloader } from "./services/mediaDownloader.js";
import { ImageOptimizer, VideoOptimizer } from "./services/mediaOptimizer.js";
import { MediaAssetIngestWorker, MediaAssetOptimizeWorker } from "./workers/mediaPipelineWorker.js";
import { createMediaPipelineRabbitmqConsumer, type MediaQueueConsumer } from "./queue/mediaPipelineRabbitmqConsumer.js";

const SCHEDULER_INTERVAL_MS = 60_000;
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function createServer() {
  const env = loadEnv();
  const logger = new Logger(env.LOG_LEVEL);
  const database = createDatabase(env.DATABASE_URL);
  const queuePublisher = await createRabbitMqPublisher(env.RABBITMQ_URL, database, logger);
  const ingestor = new AirtableWebhookIngestor(database, queuePublisher, logger, env.WORKSPACE_ID);

  const airtableClient = createAirtableClient(env.AIRTABLE_API_KEY, env.AIRTABLE_BASE_ID);
  const airtableStatusPoller = new AirtableStatusPoller(
    airtableClient,
    ingestor,
    logger,
    env.AIRTABLE_STATUS_POLLER_INTERVAL_MS
  );
  const worker = new ApprovedPostWorker(database, airtableClient, logger, env.WORKSPACE_ID, queuePublisher, env.MEDIA_PIPELINE_ENABLED === "true");
  const consumer = await createRabbitMqConsumer(env.RABBITMQ_URL, worker, logger, database);

  // AI Composer integration
  const llmAdapter = new GeminiLlmAdapter(env.GEMINI_API_KEY || "mock-key", env.GEMINI_MODEL);
  const aiComposerWorker = new AiComposerWorker(
    database,
    airtableClient,
    llmAdapter,
    logger,
    env.WORKSPACE_ID,
    "fb_composer_v1.0.0",
    env.AIRTABLE_FIELD_MAP,
    undefined
  );
  const aiComposerConsumer = await createAiComposerRabbitMqConsumer(env.RABBITMQ_URL, aiComposerWorker, logger);
  const policyWorker = new PolicyWorker(database, airtableClient, logger, env.WORKSPACE_ID, queuePublisher);
  const policyConsumer = await createPolicyRabbitMqConsumer(env.RABBITMQ_URL, policyWorker, logger);

  // MCP integration
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(currentDir, "../../facebook-mcp-server/dist/index.js");
  const tiktokMcpServerPath = path.join(currentDir, "../../tiktok-mcp-server/dist/index.js");

  const facebookMcpClient = new FacebookMcpClient(mcpServerPath);
  await facebookMcpClient.connect().catch(err => {
    logger.error("Failed to connect to Facebook MCP server", { error: String(err) });
  });

  const mcpValidateWorker = new McpValidateWorker(database, facebookMcpClient, logger, env.WORKSPACE_ID, queuePublisher);
  const mcpValidateConsumer = await createMcpValidateRabbitMqConsumer(env.RABBITMQ_URL, mcpValidateWorker, logger);

  const mcpPublishWorker = new McpPublishWorker(database, facebookMcpClient, airtableClient, logger, env.WORKSPACE_ID, queuePublisher);
  const mcpPublishConsumer = await createMcpPublishRabbitMqConsumer(env.RABBITMQ_URL, mcpPublishWorker, logger);

  let tiktokMcpClient: TiktokMcpClient | null = null;
  let tiktokValidateConsumer: TiktokValidateQueueConsumer | null = null;
  let tiktokPublishConsumer: TiktokPublishQueueConsumer | null = null;
  let tiktokStatusCheckConsumer: TiktokStatusCheckQueueConsumer | null = null;

  if (env.TIKTOK_PUBLISHING_ENABLED === "true") {
    logger.info("TikTok publishing enabled, connecting to TikTok MCP server and starting consumers...");
    tiktokMcpClient = new TiktokMcpClient(tiktokMcpServerPath);
    await tiktokMcpClient.connect().catch(err => {
      logger.error("Failed to connect to TikTok MCP server", { error: String(err) });
    });

    const tiktokValidateWorker = new TiktokValidateWorker(database, tiktokMcpClient, logger, env.WORKSPACE_ID, queuePublisher, airtableClient);
    tiktokValidateConsumer = await createTiktokValidateRabbitMqConsumer(env.RABBITMQ_URL, tiktokValidateWorker, logger);

    const tiktokPublishWorker = new TiktokPublishWorker(database, tiktokMcpClient, airtableClient, logger, env.WORKSPACE_ID, queuePublisher);
    tiktokPublishConsumer = await createTiktokPublishRabbitMqConsumer(env.RABBITMQ_URL, tiktokPublishWorker, logger);

    const tiktokStatusCheckWorker = new TiktokStatusCheckWorker(database, tiktokMcpClient, logger, env.WORKSPACE_ID, queuePublisher);
    tiktokStatusCheckConsumer = await createTiktokStatusCheckRabbitMqConsumer(env.RABBITMQ_URL, tiktokStatusCheckWorker, logger);
  } else {
    logger.info("TikTok publishing disabled");
  }

  const mcpPublishScheduler = new McpPublishScheduler(database, logger, env.WORKSPACE_ID, queuePublisher);

  // Slack integration
  const slackVerifier = new SlackSignatureVerifier(env.SLACK_SIGNING_SECRET, logger);
  const slackParser = new SlackCommandParser(env.SLACK_COMMAND_MAX_REASON_LENGTH);
  const slackRepository = new SlackCommandRepository();
  const slackWorker = new SlackPostApprovalWorker(database, slackRepository, airtableClient, logger, env.WORKSPACE_ID, env.AIRTABLE_FIELD_MAP.ai_review_notes);
  const slackCommandConsumer = createSlackCommandRabbitmqConsumer(env.RABBITMQ_URL, slackWorker, logger, env.WORKSPACE_ID);

  const commentActionRepository = new CommentActionRepository();
  const slackCommentActionWorker = new SlackCommentActionWorker(database, commentActionRepository, facebookMcpClient, queuePublisher, logger, env.WORKSPACE_ID);
  const slackCommentActionConsumer = createSlackCommentActionRabbitmqConsumer(env.RABBITMQ_URL, slackCommentActionWorker, logger, env.WORKSPACE_ID);

  // US-007 Facebook Comments Sync
  const channelAccountAdminRepo = new ChannelAccountAdminRepository();
  const commentRiskClassifier = new CommentRiskClassifier();
  const commentSyncWorkerRepo = new CommentSyncWorkerRepository();
  const facebookCommentSyncWorker = new FacebookCommentSyncWorker(database.getPool(), commentSyncWorkerRepo, queuePublisher, {
    inboxChannelId: env.SLACK_INBOX_CHANNEL_ID,
    crisisChannelId: env.SLACK_CRISIS_CHANNEL_ID
  });
  
  const facebookCommentIngestConsumer = await createFacebookCommentSyncIngestConsumer(env.RABBITMQ_URL, facebookCommentSyncWorker, logger);
  const facebookCommentSyncRequestConsumer = await createFacebookCommentSyncRequestConsumer(env.RABBITMQ_URL, facebookMcpClient, database.getPool(), channelAccountAdminRepo, queuePublisher, commentRiskClassifier, logger);

  const commentSyncSchedulerRepo = new CommentSyncSchedulerRepository();
  const commentSyncScheduler = new CommentSyncScheduler(database.getPool(), commentSyncSchedulerRepo, queuePublisher, logger);
  const rabbitmqMonitor = createRabbitMqMonitor(env.RABBITMQ_URL, logger);

  // US-015 Unified Direct Message Inbox
  const directMessageRepository = new DirectMessageRepository();
  const directMessageIngestWorker = new DirectMessageIngestWorker(
    database,
    directMessageRepository,
    queuePublisher,
    facebookMcpClient,
    logger,
    env.WORKSPACE_ID,
    { inboxChannelId: env.SLACK_INBOX_CHANNEL_ID },
    { dmSlaHours: env.DM_SLA_HOURS }
  );
  const directMessageReplyWorker = new DirectMessageReplyWorker(
    database,
    directMessageRepository,
    queuePublisher,
    facebookMcpClient,
    logger,
    env.WORKSPACE_ID,
    { inboxChannelId: env.SLACK_INBOX_CHANNEL_ID }
  );

  const directMessageIngestConsumer = await createDirectMessageIngestRabbitmqConsumer(
    env.RABBITMQ_URL,
    directMessageIngestWorker,
    logger,
    env.WORKSPACE_ID
  );
  const directMessageReplyConsumer = await createDirectMessageReplyRabbitmqConsumer(
    env.RABBITMQ_URL,
    directMessageReplyWorker,
    logger,
    env.WORKSPACE_ID
  );

  // US-016: Media Ingestion & Optimization Pipeline
  let mediaPipelineConsumer: MediaQueueConsumer | null = null;
  if (env.MEDIA_PIPELINE_ENABLED === "true") {
    const mediaRepository = new MediaRepository();
    const auditLogRepository = new AuditLogRepository();
    const r2Storage = new R2StorageService({
      R2_BUCKET: env.R2_BUCKET!,
      R2_ENDPOINT: env.R2_ENDPOINT!,
      R2_PUBLIC_BASE_URL: env.R2_PUBLIC_BASE_URL!,
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID!,
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY!
    });
    const mediaDownloader = new MediaDownloader();
    const imageOptimizer = new ImageOptimizer();
    const videoOptimizer = new VideoOptimizer();

    const ingestWorker = new MediaAssetIngestWorker(
      database,
      airtableClient,
      mediaRepository,
      auditLogRepository,
      queuePublisher,
      logger
    );
    const optimizeWorker = new MediaAssetOptimizeWorker(
      database,
      airtableClient,
      mediaRepository,
      auditLogRepository,
      r2Storage,
      mediaDownloader,
      imageOptimizer,
      videoOptimizer,
      logger,
      {
        R2_BUCKET: env.R2_BUCKET!,
        MEDIA_TEMP_DIR: env.MEDIA_TEMP_DIR
      }
    );

    mediaPipelineConsumer = await createMediaPipelineRabbitmqConsumer(
      env.RABBITMQ_URL,
      ingestWorker,
      optimizeWorker,
      logger
    );
  }

  const app = express();
  app.disable("x-powered-by");
  
  // Note: Slack commands router must be mounted before the global express.json() 
  // since it uses express.raw() to verify the signature.
  app.use("/api/v1", createSlackCommandsRouter({
    verifier: slackVerifier,
    parser: slackParser,
    repository: slackRepository,
    commentActionRepository,
    directMessageRepository,
    publisher: queuePublisher,
    database,
    logger,
    workspaceId: env.WORKSPACE_ID,
    slackCommandsEnabled: env.SLACK_COMMANDS_ENABLED === "true"
  }));

  app.use(express.json({ limit: "64kb" }));
  app.use("/api/v1", createAirtableWebhookRouter(ingestor, logger));

  app.use("/api/v1/admin/facebook", createFacebookAdminRouter(
    database,
    facebookMcpClient,
    airtableClient,
    logger,
    env.WORKSPACE_ID,
    env.FACEBOOK_PAGE_CONFIG_ENABLED === "true",
    env.FACEBOOK_REDIRECT_URI
  ));

  app.use("/api/v1/reports", createReportsRouter(
    database,
    logger,
    env.WORKSPACE_ID
  ));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return { 
    app, env, logger, database, consumer, aiComposerWorker, aiComposerConsumer, policyConsumer, mcpValidateConsumer, facebookMcpClient,
    mcpPublishConsumer, mcpPublishScheduler, slackCommandConsumer, slackCommentActionConsumer,
    facebookCommentIngestConsumer, facebookCommentSyncRequestConsumer, commentSyncScheduler, rabbitmqMonitor,
    airtableStatusPoller, directMessageIngestConsumer, directMessageReplyConsumer, mediaPipelineConsumer,
    tiktokValidateConsumer, tiktokPublishConsumer, tiktokStatusCheckConsumer, tiktokMcpClient
  };
}

if (process.env.NODE_ENV !== "test") {
  const { 
    app, env, logger, consumer, aiComposerWorker, aiComposerConsumer, policyConsumer, mcpValidateConsumer, facebookMcpClient,
    mcpPublishConsumer, mcpPublishScheduler, slackCommandConsumer, slackCommentActionConsumer,
    facebookCommentIngestConsumer, facebookCommentSyncRequestConsumer, commentSyncScheduler, rabbitmqMonitor,
    airtableStatusPoller, directMessageIngestConsumer, directMessageReplyConsumer, mediaPipelineConsumer,
    tiktokValidateConsumer, tiktokPublishConsumer, tiktokStatusCheckConsumer, tiktokMcpClient
  } = await createServer();

  await consumer.start().catch((err) => {
    logger.error("Failed to start RabbitMQ consumer", { error: String(err) });
  });

  await aiComposerConsumer.start().catch((err) => {
    logger.error("Failed to start AI Composer RabbitMQ consumer", { error: String(err) });
  });

  await policyConsumer.start().catch((err: unknown) => {
    logger.error("Failed to start Policy RabbitMQ consumer", { error: String(err) });
  });

  await mcpValidateConsumer.start().catch((err: unknown) => {
    logger.error("Failed to start MCP Validate RabbitMQ consumer", { error: String(err) });
  });

  await mcpPublishConsumer.start().catch((err: unknown) => {
    logger.error("Failed to start MCP Publish RabbitMQ consumer", { error: String(err) });
  });

  if (tiktokValidateConsumer) {
    await tiktokValidateConsumer.start().catch((err: unknown) => {
      logger.error("Failed to start TikTok Validate RabbitMQ consumer", { error: String(err) });
    });
  }

  if (tiktokPublishConsumer) {
    await tiktokPublishConsumer.start().catch((err: unknown) => {
      logger.error("Failed to start TikTok Publish RabbitMQ consumer", { error: String(err) });
    });
  }

  if (tiktokStatusCheckConsumer) {
    await tiktokStatusCheckConsumer.start().catch((err: unknown) => {
      logger.error("Failed to start TikTok Status Check RabbitMQ consumer", { error: String(err) });
    });
  }

  await slackCommandConsumer.start().catch((err) => {
    logger.error("Failed to start Slack Command RabbitMQ consumer", { error: String(err) });
  });

  await slackCommentActionConsumer.start().catch((err) => {
    logger.error("Failed to start Slack Comment Action RabbitMQ consumer", { error: String(err) });
  });

  await facebookCommentIngestConsumer.start().catch((err) => {
    logger.error("Failed to start Facebook Comment Ingest consumer", { error: String(err) });
  });

  await facebookCommentSyncRequestConsumer.start().catch((err) => {
    logger.error("Failed to start Facebook Comment Sync Request consumer", { error: String(err) });
  });

  if (env.DM_INBOX_ENABLED === "true") {
    await directMessageIngestConsumer.start().catch((err: unknown) => {
      logger.error("Failed to start Direct Message Ingest consumer", { error: String(err) });
    });

    await directMessageReplyConsumer.start().catch((err: unknown) => {
      logger.error("Failed to start Direct Message Reply consumer", { error: String(err) });
    });
  } else {
    logger.info("DM Inbox consumers disabled (DM_INBOX_ENABLED != true)");
  }

  if (mediaPipelineConsumer) {
    await mediaPipelineConsumer.start().catch((err: unknown) => {
      logger.error("Failed to start Media Pipeline consumer", { error: String(err) });
    });
  } else {
    logger.info("Media Pipeline consumer disabled (MEDIA_PIPELINE_ENABLED != true)");
  }

  // Start the scheduler loop
  let schedulerInterval: NodeJS.Timeout | null = null;
  if (env.US006_EXECUTION_ENABLED === 'true') {
    logger.info("Starting MCP Publish Scheduler...");
    schedulerInterval = setInterval(() => {
      void mcpPublishScheduler.runPollCycle().catch(err => {
        logger.error("Scheduler run failed", { error: String(err) });
      });
    }, SCHEDULER_INTERVAL_MS);
  }

  if (env.COMMENT_SYNC_SCHEDULER_ENABLED === "true") {
    commentSyncScheduler.start();
  } else {
    logger.info("CommentSyncScheduler disabled (COMMENT_SYNC_SCHEDULER_ENABLED != true)");
  }

  if (env.AIRTABLE_STATUS_POLLER_ENABLED === "true") {
    airtableStatusPoller.start();
  } else {
    logger.info("Airtable status poller disabled (AIRTABLE_STATUS_POLLER_ENABLED != true)");
  }
  
  await rabbitmqMonitor.start(SCHEDULER_INTERVAL_MS).catch(err => {
    logger.error("Failed to start RabbitMQ monitor", { error: String(err) });
  });

  const server = app.listen(env.PORT, () => {
    logger.info("Orchestrator listening", { port: env.PORT });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    server.close(() => {
      logger.info("HTTP server closed.");
    });

    await consumer.stop();
    await aiComposerConsumer.stop();
    await policyConsumer.stop();
    await mcpValidateConsumer.stop();
    await mcpPublishConsumer.stop();
    if (tiktokValidateConsumer) await tiktokValidateConsumer.stop();
    if (tiktokPublishConsumer) await tiktokPublishConsumer.stop();
    if (tiktokStatusCheckConsumer) await tiktokStatusCheckConsumer.stop();
    await slackCommandConsumer.stop();
    await slackCommentActionConsumer.stop();
    await facebookCommentIngestConsumer.stop();
    await facebookCommentSyncRequestConsumer.stop();
    await directMessageIngestConsumer.stop();
    await directMessageReplyConsumer.stop();
    if (mediaPipelineConsumer) {
      await mediaPipelineConsumer.stop();
    }
    commentSyncScheduler.stop();
    airtableStatusPoller.stop();
    await rabbitmqMonitor.stop();
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
    }
    await facebookMcpClient.disconnect();
    if (tiktokMcpClient) await tiktokMcpClient.disconnect();
    aiComposerWorker.stop();

    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}
