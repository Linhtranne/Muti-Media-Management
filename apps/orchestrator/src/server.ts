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
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = process.env.NODE_ENV === "test" 
    ? path.join(__dirname, "../../facebook-mcp-server/dist/index.js")
    : path.join(__dirname, "../../../facebook-mcp-server/dist/index.js");

  const facebookMcpClient = new FacebookMcpClient(mcpServerPath);
  await facebookMcpClient.connect().catch(err => {
    logger.error("Failed to connect to Facebook MCP server", { error: String(err) });
  });

  const mcpValidateWorker = new McpValidateWorker(database, facebookMcpClient, logger, env.WORKSPACE_ID, queuePublisher);
  const mcpValidateConsumer = await createMcpValidateRabbitMqConsumer(env.RABBITMQ_URL, mcpValidateWorker, logger);

  const mcpPublishWorker = new McpPublishWorker(database, facebookMcpClient, airtableClient, logger, env.WORKSPACE_ID, queuePublisher);
  const mcpPublishConsumer = await createMcpPublishRabbitMqConsumer(env.RABBITMQ_URL, mcpPublishWorker, logger);

  const mcpPublishScheduler = new McpPublishScheduler(database, logger, env.WORKSPACE_ID, queuePublisher);

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use("/api/v1", createAirtableWebhookRouter(ingestor, logger));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return { 
    app, env, logger, database, consumer, aiComposerWorker, aiComposerConsumer, policyConsumer, mcpValidateConsumer, facebookMcpClient,
    mcpPublishConsumer, mcpPublishScheduler
  };
}

if (process.env.NODE_ENV !== "test") {
  const { 
    app, env, logger, consumer, aiComposerWorker, aiComposerConsumer, policyConsumer, mcpValidateConsumer, facebookMcpClient,
    mcpPublishConsumer, mcpPublishScheduler
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

  // Start the scheduler loop
  let schedulerInterval: NodeJS.Timeout | null = null;
  if (env.US006_EXECUTION_ENABLED === 'true') {
    logger.info("Starting MCP Publish Scheduler...");
    schedulerInterval = setInterval(() => {
      mcpPublishScheduler.runPollCycle().catch(err => {
        logger.error("Scheduler run failed", { error: String(err) });
      });
    }, 60000); // 1 minute
  }

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
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
    }
    await facebookMcpClient.disconnect();
    aiComposerWorker.stop();

    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
