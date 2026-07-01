import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createReportsRouter } from "../routes/reports.js";
import type { Database } from "../ledger/postgres.js";
import { Logger } from "../lib/logger.js";

describe("ReportsRoutes", () => {
  const workspaceId = "ws_test_123";
  const logger = new Logger("error");

  const mockDb: Database = {
    async transaction(wsId, fn) {
      const client = {
        query: async (sql: string, params: any[]) => {
          if (sql.includes("workspace_members")) {
            if (params[1] === "admin123") {
              return { rows: [{ role: "admin" }] };
            }
            if (params[1] === "manager123") {
              return { rows: [{ role: "manager" }] };
            }
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO audit_logs")) {
            return { rows: [] };
          }
          if (sql.includes("SET LOCAL app.current_workspace_id")) {
            return { rows: [] };
          }
          // Default mock for campaign report CTE
          if (sql.includes("WITH comment_agg AS")) {
            return {
              rows: [
                {
                  campaign_id: "camp_1",
                  posts_published: "10",
                  publish_failed: "2",
                  comments_total: "100",
                  risk_comments: "5",
                  avg_response_time: "120.5",
                  last_updated_at: "2026-06-03T00:00:00.000Z"
                },
                {
                  campaign_id: "camp,\"2\"\nnew",
                  posts_published: "0",
                  publish_failed: "0",
                  comments_total: "0",
                  risk_comments: "0",
                  avg_response_time: null,
                  last_updated_at: null
                }
              ]
            };
          }
          return { rows: [] };
        }
      } as any;
      return fn(client);
    },
    async query() { return { rows: [] } as any; },
    getPool() { return {} as any; }
  };

  const createTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use("/api/v1/reports", createReportsRouter(
      mockDb,
      logger,
      workspaceId
    ));
    return app;
  };

  it("RE-01: Returns 403 when user is missing", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/v1/reports/campaigns");
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "x-user-id header is required");
  });

  it("RE-02: Returns 403 when user has insufficient permissions", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/v1/reports/campaigns")
      .set("x-user-id", "viewer123");
    assert.equal(res.status, 403);
    assert.match(res.body.error, /Insufficient permissions/);
  });

  it("RE-03: Allows admin access and returns valid JSON report", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/v1/reports/campaigns")
      .set("x-user-id", "admin123");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 2);
    const row = res.body.data[0];
    assert.equal(row.campaign_id, "camp_1");
    assert.equal(row.posts_published, 10);
    assert.equal(row.publish_failed, 2);
    assert.equal(row.comments_total, 100);
    assert.equal(row.risk_comments, 5);
    assert.equal(row.avg_response_time, 120.5);
  });

  it("RE-04: Allows manager access and filters by query params", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/v1/reports/campaigns?campaign_id=camp_1&date_from=2026-06-01T00:00:00Z")
      .set("x-user-id", "manager123");
    assert.equal(res.status, 200);
  });

  it("RE-05: Validates query parameters properly", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/v1/reports/campaigns?date_from=invalid-date")
      .set("x-user-id", "admin123");
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Invalid query parameters");
  });

  it("RE-06: Generates valid CSV and escapes strings", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/v1/reports/campaigns.csv")
      .set("x-user-id", "admin123");
    
    assert.equal(res.status, 200);
    assert.equal(res.header["content-type"], "text/csv; charset=utf-8");
    const csvContent = res.text;
    
    // Check header
    assert.ok(csvContent.includes("campaign_id,posts_published,publish_failed,comments_total,risk_comments,avg_response_time,last_updated_at"));
    // Check data row
    assert.ok(csvContent.includes("camp_1,10,2,100,5,120.50,2026-06-03T00:00:00.000Z"));
    // Check escaped row
    assert.ok(csvContent.includes(`"camp,""2""\nnew",0,0,0,0,,`));
  });
});
