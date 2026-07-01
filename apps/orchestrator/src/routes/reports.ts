import { Router, type Request, type Response, type NextFunction } from "express";
import { type Database } from "../ledger/postgres.js";
import { type Logger } from "../lib/logger.js";
import { ReportRepository } from "../ledger/reportRepository.js";
import { CampaignReportQuerySchema, type CampaignReportRow } from "@mediaops/shared-contracts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeCsv(val: string | number): string {
  const str = String(val);
  if (/[,"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function createReportsRouter(
  database: Database,
  logger: Logger,
  workspaceId: string
): Router {
  const router = Router();
  const repo = new ReportRepository();

  // Middleware for role-based access control
  const authorizeAccess = (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        const slackUserId = req.header("x-user-id");
        if (!slackUserId) {
          res.status(403).json({ error: "x-user-id header is required" });
          return;
        }

        let isAuthorized = false;
        await database.transaction(workspaceId, async (client) => {
          isAuthorized = await repo.verifyUserRole(client, workspaceId, slackUserId);
        });

        if (!isAuthorized) {
          res.status(403).json({ error: "Insufficient permissions. Admin or manager role required." });
          return;
        }

        res.locals.actorId = slackUserId;
        next();
      } catch (error: unknown) {
        logger.error("Authorization check failed", { error: errorMessage(error) });
        res.status(500).json({ error: "Internal server error" });
      }
    })();
  };

  router.use(authorizeAccess);

  router.get("/campaigns", (req: Request, res: Response): void => {
    void (async () => {
      try {
        const queryResult = CampaignReportQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
          res.status(400).json({ error: "Invalid query parameters", details: queryResult.error.issues });
          return;
        }

        const query = queryResult.data;
        let data: CampaignReportRow[] = [];

        await database.transaction(workspaceId, async (client) => {
          await client.query("SET LOCAL app.current_workspace_id = $1", [workspaceId]);
          data = await repo.getCampaignReport(client, workspaceId, query);
          await repo.insertAuditLog(client, workspaceId, "REPORT_ACCESSED", query, String(res.locals.actorId));
        });

        res.status(200).json({ data });
      } catch (error: unknown) {
        logger.error("Failed to fetch campaign report", { error: errorMessage(error) });
        res.status(500).json({ error: "Failed to generate report" });
      }
    })();
  });

  router.get("/campaigns.csv", (req: Request, res: Response): void => {
    void (async () => {
      try {
        const queryResult = CampaignReportQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
          res.status(400).json({ error: "Invalid query parameters", details: queryResult.error.issues });
          return;
        }

        const query = queryResult.data;
        let data: CampaignReportRow[] = [];

        await database.transaction(workspaceId, async (client) => {
          await client.query("SET LOCAL app.current_workspace_id = $1", [workspaceId]);
          data = await repo.getCampaignReport(client, workspaceId, query);
          await repo.insertAuditLog(client, workspaceId, "REPORT_EXPORTED", query, String(res.locals.actorId));
        });

        const headers = [
          "campaign_id",
          "posts_published",
          "publish_failed",
          "comments_total",
          "risk_comments",
          "avg_response_time",
          "last_updated_at"
        ];

        const csvRows = [headers.map(escapeCsv).join(",")];
        for (const row of data) {
          csvRows.push([
            row.campaign_id || "",
            row.posts_published,
            row.publish_failed,
            row.comments_total,
            row.risk_comments,
            row.avg_response_time !== null ? row.avg_response_time.toFixed(2) : "",
            row.last_updated_at || ""
          ].map(escapeCsv).join(","));
        }

        const csvString = csvRows.join("\n");
        res.header("Content-Type", "text/csv");
        res.attachment("campaign_report.csv");
        res.status(200).send(csvString);
      } catch (error: unknown) {
        logger.error("Failed to export campaign report", { error: errorMessage(error) });
        res.status(500).json({ error: "Failed to generate report export" });
      }
    })();
  });

  return router;
}
