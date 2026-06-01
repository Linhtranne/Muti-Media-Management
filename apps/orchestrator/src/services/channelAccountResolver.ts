import type pg from "pg";
import type { AirtableAccountStub } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";

export type ResolverSuccess = {
  outcome: "success";
  accounts: ResolvedAccount[];
};

export type ResolvedAccount = {
  channel_account_id: string;
  platform: "Facebook";
  airtable_channel_account_record_id: string;
  external_account_id: string;
  display_name: string;
};

export type ResolverFailure = {
  outcome: "channel_account_missing" | "channel_account_inactive" | "channel_account_unresolved";
  reason: string;
};

export type ResolverResult = ResolverSuccess | ResolverFailure;

export class ChannelAccountResolver {
  constructor(private readonly logger: Logger) {}

  async resolve(
    client: pg.PoolClient,
    workspaceId: string,
    targetChannels: string[] | null | undefined,
    connectedAccountRecordIds: string[] | null | undefined,
    accountStubs: AirtableAccountStub[]
  ): Promise<ResolverResult> {
    const hasFacebook = targetChannels?.includes("Facebook") ?? false;

    if (!hasFacebook) {
      return { outcome: "success", accounts: [] };
    }

    // Case A: Target channels includes "Facebook" but no connected accounts
    if (!connectedAccountRecordIds || connectedAccountRecordIds.length === 0) {
      this.logger.warn("Channel account missing: target includes Facebook but no connected accounts", {
        workspace_id: workspaceId
      });
      return {
        outcome: "channel_account_missing",
        reason: "Target channels includes Facebook but connected_channel_accounts is empty"
      };
    }

    // Check each stub for Airtable-level status
    const facebookStubs = accountStubs.filter(s => s.platform === "Facebook");
    if (facebookStubs.length === 0) {
      return {
        outcome: "channel_account_missing",
        reason: "No Facebook platform stubs found in connected accounts"
      };
    }

    // Case B: Check Airtable stub status
    const inactiveStub = facebookStubs.find(s => s.status !== "Connected");
    if (inactiveStub) {
      this.logger.warn("Channel account inactive in Airtable", {
        workspace_id: workspaceId,
        stub_status: inactiveStub.status
      });
      return {
        outcome: "channel_account_inactive",
        reason: `Airtable account stub status is '${inactiveStub.status}' (not Connected)`
      };
    }

    // Case C/D/E: Query Postgres for server-side metadata
    const resolved: ResolvedAccount[] = [];

    for (const stub of facebookStubs) {
      const result = await client.query<{
        id: string;
        platform: string;
        airtable_channel_account_record_id: string;
        external_account_id: string;
        display_name: string;
        status: string;
        token_status: string;
      }>(
        `SELECT id, platform, airtable_channel_account_record_id, external_account_id,
                display_name, status, token_status
         FROM channel_accounts
         WHERE workspace_id = $1
           AND airtable_channel_account_record_id = $2
           AND platform = 'Facebook'
         LIMIT 1`,
        [workspaceId, stub.airtable_channel_account_record_id]
      );

      // Case C: No matching row in database
      if (result.rows.length === 0) {
        this.logger.error("Channel account unresolved: no server-side mapping found", {
          workspace_id: workspaceId,
          airtable_record_id: stub.airtable_channel_account_record_id
        });
        return {
          outcome: "channel_account_unresolved",
          reason: `Airtable account stub ${stub.airtable_channel_account_record_id} cannot be resolved server-side`
        };
      }

      const row = result.rows[0];

      // Case D: DB row exists but status inactive or token expired
      if (row.status !== "active" || row.token_status !== "valid") {
        this.logger.warn("Channel account inactive server-side", {
          workspace_id: workspaceId,
          db_status: row.status,
          token_status: row.token_status
        });
        return {
          outcome: "channel_account_inactive",
          reason: `Server-side account status='${row.status}', token_status='${row.token_status}'`
        };
      }

      // Case E: Valid mapping
      resolved.push({
        channel_account_id: row.id,
        platform: "Facebook",
        airtable_channel_account_record_id: row.airtable_channel_account_record_id,
        external_account_id: row.external_account_id,
        display_name: row.display_name
      });
    }

    return { outcome: "success", accounts: resolved };
  }
}
