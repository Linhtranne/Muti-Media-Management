import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { ChannelAccountResolver } from "../services/channelAccountResolver.js";
import { Logger } from "../lib/logger.js";

describe("ChannelAccountResolver", () => {
  const logger = new Logger("warn");
  const resolver = new ChannelAccountResolver(logger);
  const workspaceId = "ws_test_123";

  it("returns success with empty accounts if Facebook is not in target channels", async () => {
    const mockClient = {} as pg.PoolClient;
    const result = await resolver.resolve(
      mockClient,
      workspaceId,
      ["LinkedIn"],
      [],
      []
    );
    assert.deepEqual(result, { outcome: "success", accounts: [] });
  });

  it("Case A: returns channel_account_missing if target includes Facebook but connected account record IDs are empty", async () => {
    const mockClient = {} as pg.PoolClient;
    const result = await resolver.resolve(
      mockClient,
      workspaceId,
      ["Facebook"],
      [],
      []
    );
    assert.equal(result.outcome, "channel_account_missing");
    assert.ok(result.reason.includes("connected_channel_accounts is empty"));
  });

  it("Case A: returns channel_account_missing if no Facebook stubs exist in list", async () => {
    const mockClient = {} as pg.PoolClient;
    const result = await resolver.resolve(
      mockClient,
      workspaceId,
      ["Facebook"],
      ["recAccLinkedInOnly"],
      [
        {
          airtable_channel_account_record_id: "recAccLinkedInOnly",
          platform: "LinkedIn",
          display_name: "LinkedIn Page",
          status: "Connected"
        }
      ]
    );
    assert.equal(result.outcome, "channel_account_missing");
    assert.ok(result.reason.includes("No Facebook platform stubs found"));
  });

  it("Case B: returns channel_account_inactive if stub status is not Connected", async () => {
    const mockClient = {} as pg.PoolClient;
    const result = await resolver.resolve(
      mockClient,
      workspaceId,
      ["Facebook"],
      ["recAcc123"],
      [
        {
          airtable_channel_account_record_id: "recAcc123",
          platform: "Facebook",
          display_name: "FB Page",
          status: "Expired"
        }
      ]
    );
    assert.equal(result.outcome, "channel_account_inactive");
    assert.ok(result.reason.includes("status is 'Expired'"));
  });

  it("Case C: returns channel_account_unresolved if database query returns no rows", async () => {
    const mockClient = {
      query: async (text: string, values?: any[]) => {
        assert.ok(text.includes("FROM channel_accounts"));
        assert.deepEqual(values, [workspaceId, "recAcc123"]);
        return { rows: [] };
      }
    } as any as pg.PoolClient;

    const result = await resolver.resolve(
      mockClient,
      workspaceId,
      ["Facebook"],
      ["recAcc123"],
      [
        {
          airtable_channel_account_record_id: "recAcc123",
          platform: "Facebook",
          display_name: "FB Page",
          status: "Connected"
        }
      ]
    );
    assert.equal(result.outcome, "channel_account_unresolved");
    assert.ok(result.reason.includes("cannot be resolved server-side"));
  });

  it("Case D: returns channel_account_inactive if DB status is inactive", async () => {
    const mockClient = {
      query: async () => {
        return {
          rows: [
            {
              id: "uuid-123",
              platform: "Facebook",
              airtable_channel_account_record_id: "recAcc123",
              external_account_id: "ext-fb-456",
              display_name: "DB FB Page",
              status: "inactive",
              token_status: "valid"
            }
          ]
        };
      }
    } as any as pg.PoolClient;

    const result = await resolver.resolve(
      mockClient,
      workspaceId,
      ["Facebook"],
      ["recAcc123"],
      [
        {
          airtable_channel_account_record_id: "recAcc123",
          platform: "Facebook",
          display_name: "FB Page",
          status: "Connected"
        }
      ]
    );
    assert.equal(result.outcome, "channel_account_inactive");
    assert.ok(result.reason.includes("status='inactive'"));
  });

  it("Case D: returns channel_account_inactive if DB token status is not valid", async () => {
    const mockClient = {
      query: async () => {
        return {
          rows: [
            {
              id: "uuid-123",
              platform: "Facebook",
              airtable_channel_account_record_id: "recAcc123",
              external_account_id: "ext-fb-456",
              display_name: "DB FB Page",
              status: "active",
              token_status: "expired"
            }
          ]
        };
      }
    } as any as pg.PoolClient;

    const result = await resolver.resolve(
      mockClient,
      workspaceId,
      ["Facebook"],
      ["recAcc123"],
      [
        {
          airtable_channel_account_record_id: "recAcc123",
          platform: "Facebook",
          display_name: "FB Page",
          status: "Connected"
        }
      ]
    );
    assert.equal(result.outcome, "channel_account_inactive");
    assert.ok(result.reason.includes("token_status='expired'"));
  });

  it("Case E: returns success and resolved accounts for valid active DB account", async () => {
    const mockClient = {
      query: async () => {
        return {
          rows: [
            {
              id: "uuid-123",
              platform: "Facebook",
              airtable_channel_account_record_id: "recAcc123",
              external_account_id: "ext-fb-456",
              display_name: "DB FB Page",
              status: "active",
              token_status: "valid"
            }
          ]
        };
      }
    } as any as pg.PoolClient;

    const result = await resolver.resolve(
      mockClient,
      workspaceId,
      ["Facebook"],
      ["recAcc123"],
      [
        {
          airtable_channel_account_record_id: "recAcc123",
          platform: "Facebook",
          display_name: "FB Page",
          status: "Connected"
        }
      ]
    );

    assert.deepEqual(result, {
      outcome: "success",
      accounts: [
        {
          channel_account_id: "uuid-123",
          platform: "Facebook",
          airtable_channel_account_record_id: "recAcc123",
          external_account_id: "ext-fb-456",
          display_name: "DB FB Page"
        }
      ]
    });
  });
});
