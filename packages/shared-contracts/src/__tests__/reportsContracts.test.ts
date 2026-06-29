import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CampaignReportQuerySchema, CampaignReportRowSchema, CampaignReportResponseSchema } from "../reports/index.js";

describe("reportsContracts", () => {
  describe("CampaignReportQuerySchema", () => {
    it("REC-01: should accept empty object", () => {
      const result = CampaignReportQuerySchema.safeParse({});
      assert.ok(result.success);
    });

    it("REC-02: should accept valid query with all fields", () => {
      const result = CampaignReportQuerySchema.safeParse({
        campaign_id: "camp_1",
        date_from: "2026-06-01T00:00:00.000Z",
        date_to: "2026-06-30T00:00:00.000Z",
        channel_account_id: "ch_1"
      });
      assert.ok(result.success);
    });

    it("REC-03: should reject invalid date format", () => {
      const result = CampaignReportQuerySchema.safeParse({
        date_from: "2026-06-01" // Missing time
      });
      assert.equal(result.success, false);
    });

    it("REC-04: should reject extra fields", () => {
      const result = CampaignReportQuerySchema.safeParse({
        campaign_id: "camp_1",
        extra_field: "invalid"
      });
      assert.equal(result.success, false);
    });
  });

  describe("CampaignReportRowSchema", () => {
    it("REC-05: should accept valid row", () => {
      const result = CampaignReportRowSchema.safeParse({
        campaign_id: "camp_1",
        posts_published: 10,
        publish_failed: 2,
        comments_total: 100,
        risk_comments: 5,
        avg_response_time: 120.5,
        last_updated_at: "2026-06-03T00:00:00.000Z"
      });
      assert.ok(result.success);
    });

    it("REC-06: should accept row with null campaign and null response time", () => {
      const result = CampaignReportRowSchema.safeParse({
        campaign_id: null,
        posts_published: 0,
        publish_failed: 0,
        comments_total: 0,
        risk_comments: 0,
        avg_response_time: null,
        last_updated_at: null
      });
      assert.ok(result.success);
    });
  });

  describe("CampaignReportResponseSchema", () => {
    it("REC-07: should accept valid response", () => {
      const result = CampaignReportResponseSchema.safeParse({
        data: []
      });
      assert.ok(result.success);
    });
  });
});
