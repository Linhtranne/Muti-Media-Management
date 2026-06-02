import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createFacebookAdminRouter } from "../routes/facebookAdmin.js";
import type { Database } from "../ledger/postgres.js";
import { Logger } from "../lib/logger.js";
import type { AirtableClient } from "../airtable/airtableClient.js";

describe("FacebookAdminRoutes", () => {
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
            return { rows: [] };
          }
          return { rows: [{ id: "mock_account_123" }] };
        }
      } as any;
      return fn(client);
    },
    async query() { return { rows: [] } as any; },
    getPool() { return {} as any; }
  };

  const mockMcpClient: any = {
    async callTool(name: string, args: any) {
      if (name === "generateOAuthUrl") {
        return { content: [{ type: "text", text: JSON.stringify({ url: "https://mock-oauth.com", state: "mock-state" }) }] };
      }
      if (name === "exchangeCodeAndListPages") {
        return { content: [{ type: "text", text: JSON.stringify({ pages: [], userTokenRef: "env:MOCK_USER_TOKEN" }) }] };
      }
      if (name === "connectPage") {
        return { content: [{ type: "text", text: JSON.stringify({ externalAccountId: "ext123", displayName: "Mock Page", secretRef: "env:MOCK_PAGE_TOKEN", scopes: ["public_profile"], expiresAt: null }) }] };
      }
      if (name === "healthCheckToken") {
        return { content: [{ type: "text", text: JSON.stringify({ status: "valid", missingScopes: [], lastCheckedAt: "2026-06-02T00:00:00Z" }) }] };
      }
      return { isError: true };
    }
  };

  const mockAirtable: AirtableClient = {
    async updateRecord() {},
    async getPostRecord() { return {} as any; },
    async fetchCampaignRecord() { return {}; },
    async updateRecordStatus() {},
    async updateVariantDraft() {}
  };

  const createTestApp = (isEnabled: boolean) => {
    const app = express();
    app.use(express.json());
    app.use("/api/v1/admin/facebook", createFacebookAdminRouter(
      mockDb,
      mockMcpClient,
      mockAirtable,
      logger,
      workspaceId,
      isEnabled,
      "https://mock-redirect.com"
    ));
    return app;
  };

  it("AD-01: Returns 404 when feature flag is disabled", async () => {
    const app = createTestApp(false);
    const res = await request(app)
      .post("/api/v1/admin/facebook/auth/start")
      .set("x-user-id", "admin123");
    assert.equal(res.status, 404);
  });

  it("AD-02: Returns 403 when admin role is missing", async () => {
    const app = createTestApp(true);
    const res = await request(app)
      .post("/api/v1/admin/facebook/auth/start");
    assert.equal(res.status, 403);
  });

  it("AD-03: Generates OAuth URL successfully", async () => {
    const app = createTestApp(true);
    const res = await request(app)
      .post("/api/v1/admin/facebook/auth/start")
      .set("x-user-id", "admin123");
    assert.equal(res.status, 200);
    assert.equal(res.body.url, "https://mock-oauth.com");
  });

  let testConnectionSessionId = "";

  it("AD-04: Exchanges code and lists pages, returns session ID not token", async () => {
    const app = createTestApp(true);
    const res = await request(app)
      .post("/api/v1/admin/facebook/auth/callback")
      .set("x-user-id", "admin123")
      .send({ code: "mock-code" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.pages, []);
    assert.equal(res.body.userTokenRef, undefined);
    assert.ok(res.body.connectionSessionId);
    testConnectionSessionId = res.body.connectionSessionId;
  });

  it("AD-05: Connects page using connectionSessionId and creates channel account", async () => {
    const app = createTestApp(true);
    const res = await request(app)
      .post("/api/v1/admin/facebook/pages/connect")
      .set("x-user-id", "admin123")
      .send({ pageId: "page123", connectionSessionId: testConnectionSessionId });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "success");
    assert.equal(res.body.channelAccountId, "mock_account_123");
  });

  it("AD-06: Performs health check", async () => {
    const app = createTestApp(true);
    const res = await request(app)
      .post("/api/v1/admin/facebook/pages/mock_account_123/health-check")
      .set("x-user-id", "admin123");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "valid");
  });

  it("AD-07: Disconnects page", async () => {
    const app = createTestApp(true);
    const res = await request(app)
      .post("/api/v1/admin/facebook/pages/mock_account_123/disconnect")
      .set("x-user-id", "admin123");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "disconnected");
  });
});
