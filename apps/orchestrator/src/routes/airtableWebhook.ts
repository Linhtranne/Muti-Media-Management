import type { Request, Response, Router } from "express";
import express from "express";
import { ZodError } from "zod";
import type { AirtableWebhookIngestor } from "../services/airtableWebhookIngestor.js";
import type { Logger } from "../lib/logger.js";

export function createAirtableWebhookRouter(ingestor: AirtableWebhookIngestor, logger: Logger): Router {
  const router = express.Router();

  router.post("/webhooks/airtable", async (req: Request, res: Response) => {
    try {
      const result = await ingestor.ingest(req.body);
      res.status(202).json(result);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: "validation_error",
          message: "Invalid Airtable webhook payload",
          details: error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
        });
        return;
      }

      logger.error("Airtable webhook ingestion failed", {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        error: "internal_error",
        message: "Webhook ingestion failed"
      });
    }
  });

  return router;
}

