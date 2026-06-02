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
import { AiComposerWorker } from "./workers/aiComposerWorker.js";
import { createAiComposerRabbitMqConsumer } from "./queue/aiComposerRabbitmqConsumer.js";
import { PolicyWorker } from "./workers/policyWorker.js";
import { createPolicyRabbitMqConsumer } from "./queue/policyRabbitmqConsumer.js";
import { FacebookMcpClient } from "./mcp/facebookMcpClient.js";
import { McpValidateWorker } from "./workers/mcpValidateWorker.js";
import { createMcpValidateRabbitMqConsumer } from "./queue/mcpValidateRabbitmqConsumer.js";
import { McpPublishWorker } from "./workers/mcpPublishWorker.js";
import { createMcpPublishRabbitMqConsumer } from "./queue/mcpPublishRabbitmqConsumer.js";
import { McpPublishScheduler } from "./workers/mcpPublishScheduler.js";
import { SlackSignatureVerifier } from "./services/slackSignatureVerifier.js";
import { SlackCommandParser } from "./services/slackCommandParser.js";
import { SlackCommandRepository } from "./ledger/slackCommandRepository.js";
import { createSlackCommandsRouter } from "./routes/slackCommands.js";
import { createFacebookAdminRouter } from "./routes/facebookAdmin.js";
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
import { CommentSyncSchedulerRepository } from "./ledger/commentSyncSchedulerRepository.js";
import { CommentSyncScheduler } from "./scheduler/commentSyncScheduler.js";
import { ChannelAccountAdminRepository } from "./ledger/channelAccountAdminRepository.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function createServer() {
  const env = loadEnv();
  const logger = new Logger(env.LOG_LEVEL);
  const database = createDatabase(env.DATABASE_URL);
  const queuePublisher = await createRabbitMqPublisher(env.RABBITMQ_URL);
  const ingestor = new AirtableWebhookIngestor(database, queuePublisher, logger, env.WORKSPACE_ID);

  const airtableClient = createAirtableClient(env.AIRTABLE_API_KEY, env.AIRTABLE_BASE_ID);
  const worker = new ApprovedPostWorker(database, airtableClient, logger, env.WORKSPACE_ID, queuePublisher);
  const consumer = await createRabbitMqConsumer(env.RABBITMQ_URL, worker, logger);

  // AI Composer integration
  const llmAdapter = new GeminiLlmAdapter(env.GEMINI_API_KEY || "mock-key", env.GEMINI_MODEL);
  const aiComposerWorker = new AiComposerWorker(
    database,
    airtableClient,
    llmAdapter,
    logger,
    env.WORKSPACE_ID,
    "fb_composer_v1.0.0",
    env.AIRTABLE_FIELD_MAP
  );
  const aiComposerConsumer = await createAiComposerRabbitMqConsumer(env.RABBITMQ_URL, aiComposerWorker, logger);
  const policyWorker = new PolicyWorker(database, airtableClient, logger, env.WORKSPACE_ID, queuePublisher);
  const policyConsumer = await createPolicyRabbitMqConsumer(env.RABBITMQ_URL, policyWorker, logger);

  // MCP integration
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = process.env.NODE_ENV === "test" 
    ? path.join(currentDir, "../../facebook-mcp-server/dist/index.js")
    : path.join(currentDir, "../../../facebook-mcp-server/dist/index.js");

  const facebookMcpClient = new FacebookMcpClient(mcpServerPath);
  await facebookMcpClient.connect().catch(err => {
    logger.error("Failed to connect to Facebook MCP server", { error: String(err) });
  });

  const mcpValidateWorker = new McpValidateWorker(database, facebookMcpClient, logger, env.WORKSPACE_ID, queuePublisher);
  const mcpValidateConsumer = await createMcpValidateRabbitMqConsumer(env.RABBITMQ_URL, mcpValidateWorker, logger);

  const mcpPublishWorker = new McpPublishWorker(database, facebookMcpClient, airtableClient, logger, env.WORKSPACE_ID, queuePublisher);
  const mcpPublishConsumer = await createMcpPublishRabbitMqConsumer(env.RABBITMQ_URL, mcpPublishWorker, logger);

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
  const facebookCommentSyncWorker = new FacebookCommentSyncWorker(database.getPool(), commentSyncWorkerRepo, commentRiskClassifier, queuePublisher);
  
  const facebookCommentIngestConsumer = await createFacebookCommentSyncIngestConsumer(env.RABBITMQ_URL, facebookCommentSyncWorker, logger);
  const facebookCommentSyncRequestConsumer = await createFacebookCommentSyncRequestConsumer(env.RABBITMQ_URL, facebookMcpClient, database.getPool(), channelAccountAdminRepo, queuePublisher, logger);

  const commentSyncSchedulerRepo = new CommentSyncSchedulerRepository();
  const commentSyncScheduler = new CommentSyncScheduler(database.getPool(), commentSyncSchedulerRepo, queuePublisher, logger);

  const app = express();
  app.disable("x-powered-by");
  
  // Note: Slack commands router must be mounted before the global express.json() 
  // since it uses express.raw() to verify the signature.
  app.use("/api/v1", createSlackCommandsRouter({
    verifier: slackVerifier,
    parser: slackParser,
    repository: slackRepository,
    commentActionRepository,
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

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return { 
    app, env, logger, database, consumer, aiComposerWorker, aiComposerConsumer, policyConsumer, mcpValidateConsumer, facebookMcpClient,
    mcpPublishConsumer, mcpPublishScheduler, slackCommandConsumer, slackCommentActionConsumer,
    facebookCommentIngestConsumer, facebookCommentSyncRequestConsumer, commentSyncScheduler
  };
}

if (process.env.NODE_ENV !== "test") {
  const { 
    app, env, logger, consumer, aiComposerWorker, aiComposerConsumer, policyConsumer, mcpValidateConsumer, facebookMcpClient,
    mcpPublishConsumer, mcpPublishScheduler, slackCommandConsumer, slackCommentActionConsumer,
    facebookCommentIngestConsumer, facebookCommentSyncRequestConsumer, commentSyncScheduler
  } = await createServer();

  await consumer.start().catch((err) => {
    logger.error("Failed to start RabbitMQ consumer", { error: String(err) });
  });

  await aiComposerConsumer.start().catch((err) => {
    logger.error("Failed to start AI Composer RabbitMQ consumer", { error: String(err) });
  });

  await policyConsumer.start().catch((err) => {
    logger.error("Failed to start Policy RabbitMQ consumer", { error: String(err) });
  });

  await mcpValidateConsumer.start().catch((err) => {
    logger.error("Failed to start MCP Validate RabbitMQ consumer", { error: String(err) });
  });

  await mcpPublishConsumer.start().catch((err) => {
    logger.error("Failed to start MCP Publish RabbitMQ consumer", { error: String(err) });
  });

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

  // Start the scheduler loop
  let schedulerInterval: NodeJS.Timeout | null = null;
  if (env.US006_EXECUTION_ENABLED === 'true') {
    logger.info("Starting MCP Publish Scheduler...");
    schedulerInterval = setInterval(() => {
      void mcpPublishScheduler.runPollCycle().catch(err => {
        logger.error("Scheduler run failed", { error: String(err) });
      });
    }, 60000); // 1 minute
  }

  commentSyncScheduler.start();

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
    await slackCommandConsumer.stop();
    await slackCommentActionConsumer.stop();
    await facebookCommentIngestConsumer.stop();
    await facebookCommentSyncRequestConsumer.stop();
    commentSyncScheduler.stop();
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
    }
    await facebookMcpClient.disconnect();
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
