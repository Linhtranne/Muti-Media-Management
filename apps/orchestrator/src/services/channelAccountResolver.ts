import type pg from "pg";
import type { AirtableAccountStub } from "@mediaops/shared-contracts";
import type { Logger } from "../lib/logger.js";

export interface ResolverSuccess {
  outcome: "success";
  accounts: ResolvedAccount[];
}

export interface ResolvedAccount {
  channel_account_id: string;
  platform: "Facebook" | "TikTok";
  airtable_channel_account_record_id: string;
  external_account_id: string;
  display_name: string;
}

export interface ResolverFailure {
  outcome: "channel_account_missing" | "channel_account_inactive" | "channel_account_unresolved";
  reason: string;
}

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
    const platformsToResolve = (targetChannels ?? []).filter(
      (p) => p === "Facebook" || p === "TikTok"
    );

    if (platformsToResolve.length === 0) {
      return { outcome: "success", accounts: [] };
    }

    if (!connectedAccountRecordIds || connectedAccountRecordIds.length === 0) {
      this.logger.warn("Channel account missing: targets specified but no connected accounts", {
        workspace_id: workspaceId,
        platformsToResolve
      });
      return {
        outcome: "channel_account_missing",
        reason: "Target channels specified but connected_channel_accounts is empty"
      };
    }

    // Filter stubs to only keep the targeted platform accounts (Facebook or TikTok)
    const targetStubs = accountStubs.filter((stub) =>
      platformsToResolve.includes(stub.platform as "Facebook" | "TikTok")
    );

    if (targetStubs.length === 0) {
      this.logger.warn("Channel account missing: targets specified but no connected accounts matching targeted platforms", {
        workspace_id: workspaceId,
        platformsToResolve
      });
      return {
        outcome: "channel_account_missing",
        reason: `No connected channel accounts found for targeted platforms [${platformsToResolve.join(", ")}]`
      };
    }

    // Case B: Check Airtable stub status
    for (const stub of accountStubs) {
      if (connectedAccountRecordIds.includes(stub.airtable_channel_account_record_id)) {
        if (stub.status !== "Connected") {
          this.logger.warn("Channel account inactive in Airtable", {
            workspace_id: workspaceId,
            stub_status: stub.status,
            platform: stub.platform
          });
          return {
            outcome: "channel_account_inactive",
            reason: `Airtable account stub status is '${stub.status}' (not Connected) for ${stub.platform}`
          };
        }
      }
    }

    const resolved: ResolvedAccount[] = [];

    // Case C/D/E: Query Postgres for server-side metadata
    for (const recId of connectedAccountRecordIds) {
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
         LIMIT 1`,
        [workspaceId, recId]
      );

      // Case C: No matching row in database
      if (result.rows.length === 0) {
        this.logger.error("Channel account unresolved: no server-side mapping found", {
          workspace_id: workspaceId,
          airtable_record_id: recId
        });
        return {
          outcome: "channel_account_unresolved",
          reason: `Airtable account stub ${recId} cannot be resolved server-side`
        };
      }

      const row = result.rows[0];

      // Case D: DB row exists but status inactive or token expired
      if (row.status !== "active" || row.token_status !== "valid") {
        this.logger.warn("Channel account inactive server-side", {
          workspace_id: workspaceId,
          db_status: row.status,
          token_status: row.token_status,
          platform: row.platform
        });
        return {
          outcome: "channel_account_inactive",
          reason: `Server-side account status='${row.status}', token_status='${row.token_status}' for ${row.platform}`
        };
      }

      // Case E: Valid mapping
      resolved.push({
        channel_account_id: row.id,
        platform: row.platform as "Facebook" | "TikTok",
        airtable_channel_account_record_id: row.airtable_channel_account_record_id,
        external_account_id: row.external_account_id,
        display_name: row.display_name
      });
    }

    // Verify all platforms in targetChannels are covered by the resolved active accounts
    for (const platform of platformsToResolve) {
      const covered = resolved.some((acc) => acc.platform === platform);
      if (!covered) {
        this.logger.warn(`Channel account missing for targeted platform: ${platform}`, {
          workspace_id: workspaceId
        });
        return {
          outcome: "channel_account_missing",
          reason: `No connected channel account found for targeted platform ${platform}`
        };
      }
    }

    return { outcome: "success", accounts: resolved };
  }
}
