import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReportRepository } from "../ledger/reportRepository.js";
import type pg from "pg";

describe("ReportRepository", () => {
  const repo = new ReportRepository();

  it("REP-01: Correctly constructs SQL query and params for empty query", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];
    const mockClient = {
      query: async (sql: string, params: any[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [] };
      }
    } as unknown as pg.PoolClient;

    await repo.getCampaignReport(mockClient, "ws_1", {});

    assert.equal(capturedParams.length, 1);
    assert.equal(capturedParams[0], "ws_1");
    assert.ok(capturedSql.includes("WHERE pj.workspace_id = $1"));
  });

  it("REP-02: Correctly constructs SQL query and params with full query", async () => {
    let capturedSql = "";
    let capturedParams: any[] = [];
    const mockClient = {
      query: async (sql: string, params: any[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [] };
      }
    } as unknown as pg.PoolClient;

    await repo.getCampaignReport(mockClient, "ws_1", {
      campaign_id: "camp_1",
      date_from: "2026-06-01T00:00:00Z",
      date_to: "2026-06-30T00:00:00Z",
      channel_account_id: "ch_1"
    });

    assert.equal(capturedParams.length, 5);
    assert.equal(capturedParams[0], "ws_1");
    assert.equal(capturedParams[1], "camp_1");
    assert.equal(capturedParams[2], "2026-06-01T00:00:00Z");
    assert.equal(capturedParams[3], "2026-06-30T00:00:00Z");
    assert.equal(capturedParams[4], "ch_1");

    assert.ok(capturedSql.includes("WHERE pj.workspace_id = $1 AND pj.campaign_id = $2 AND pj.created_at >= $3 AND pj.created_at <= $4 AND pj.channel_account_id = $5"));
  });
});
