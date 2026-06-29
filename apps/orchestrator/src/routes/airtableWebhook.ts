import type { Request, Response, Router } from "express";
import express from "express";
import { ZodError } from "zod";
import type { AirtableWebhookIngestor } from "../services/airtableWebhookIngestor.js";
import type { Logger } from "../lib/logger.js";

const HTTP_ACCEPTED = 202;

export function createAirtableWebhookRouter(ingestor: AirtableWebhookIngestor, logger: Logger): Router {
  const router = express.Router();

  router.post("/webhooks/airtable", (req: Request, res: Response) => {
    void (async () => {
    try {
      const result = await ingestor.ingest(req.body);
      res.status(HTTP_ACCEPTED).json(result);
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
    })();
  });

  return router;
}
