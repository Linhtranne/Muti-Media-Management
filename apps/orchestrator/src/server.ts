import express from "express";
import { loadEnv } from "./config/env.js";
import { Logger } from "./lib/logger.js";
import { createDatabase } from "./ledger/postgres.js";
import { createRabbitMqPublisher } from "./queue/rabbitmqPublisher.js";
import { AirtableWebhookIngestor } from "./services/airtableWebhookIngestor.js";
import { createAirtableWebhookRouter } from "./routes/airtableWebhook.js";

export async function createServer() {
  const env = loadEnv();
  const logger = new Logger(env.LOG_LEVEL);
  const database = createDatabase(env.DATABASE_URL);
  const queuePublisher = await createRabbitMqPublisher(env.RABBITMQ_URL);
  const ingestor = new AirtableWebhookIngestor(database, queuePublisher, logger, env.WORKSPACE_ID);

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use("/api/v1", createAirtableWebhookRouter(ingestor, logger));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return { app, env, logger };
}

if (process.env.NODE_ENV !== "test") {
  const { app, env, logger } = await createServer();
  app.listen(env.PORT, () => {
    logger.info("Orchestrator listening", { port: env.PORT });
  });
}

