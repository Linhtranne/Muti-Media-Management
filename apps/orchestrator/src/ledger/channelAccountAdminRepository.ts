import type pg from "pg";
import { AuditLogRepository } from "./auditLogRepository.js";

export function toTokenStatus(status: string): "valid" | "expired" | "unknown" {
  if (status === "valid") return "valid";
  if (status === "expired") return "expired";
  return "unknown";
}

export class ChannelAccountAdminRepository {
  constructor(private readonly auditRepo: AuditLogRepository = new AuditLogRepository()) {}

  async upsertChannelAccountAndToken(
    client: pg.PoolClient,
    workspaceId: string,
    params: {
      platform: string;
      externalAccountId: string;
      displayName: string;
      secretRef: string;
      scopes: string[];
      expiresAt: string | null;
      airtableRecordId?: string | null;
    }
  ): Promise<string> {
    // 1. Upsert channel_accounts (using workspace_id, platform, external_account_id as unique key)
    // We fall back to airtable_channel_account_record_id as an alternate key if needed,
    // but the unique constraint we added is on (workspace_id, platform, external_account_id).
    
    const accountRes = await client.query<{ id: string }>(
      `
      INSERT INTO channel_accounts (
        workspace_id, platform, external_account_id, display_name, status, secret_ref,
        airtable_channel_account_record_id, connected_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'active', $5, $6, NOW(), NOW())
      ON CONFLICT (workspace_id, platform, external_account_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        status = 'active',
        secret_ref = EXCLUDED.secret_ref,
        updated_at = NOW()
      RETURNING id
      `,
      [workspaceId, params.platform, params.externalAccountId, params.displayName, params.secretRef, params.airtableRecordId ?? null]
    );

    const channelAccountId = accountRes.rows[0]?.id;
    if (!channelAccountId) {
      throw new Error("CHANNEL_ACCOUNT_UPSERT_FAILED");
    }

    // 2. Mark existing active tokens as revoked
    await client.query(
      `
      UPDATE token_references 
      SET status = 'revoked', token_status = 'invalid', revoked_at = NOW(), updated_at = NOW()
      WHERE channel_account_id = $1 AND status = 'active' AND secret_ref != $2
      `,
      [channelAccountId, params.secretRef]
    );

    // 3. Insert new token reference (or do nothing if exact same token ref is active)
    await client.query(
      `
      INSERT INTO token_references (
        channel_account_id, workspace_id, provider, secret_ref, scopes, expires_at, status, token_status
      ) VALUES ($1, $2, 'env', $3, $4::TEXT[], $5, 'active', 'valid')
      ON CONFLICT (channel_account_id) WHERE status = 'active'
      DO UPDATE SET
        secret_ref = EXCLUDED.secret_ref,
        scopes = EXCLUDED.scopes,
        expires_at = EXCLUDED.expires_at,
        token_status = 'valid',
        revoked_at = NULL,
        updated_at = NOW()
      `,
      [
        channelAccountId, 
        workspaceId, 
        params.secretRef, 
        params.scopes, 
        params.expiresAt
      ]
    );

    // 4. Audit Log
    await this.auditRepo.insertAuditLog(client, {
      workspaceId,
      entityType: "channel_account",
      entityId: channelAccountId,
      eventType: "FACEBOOK_PAGE_CONNECTED",
      actorId: "system", // Admin user ID could go here in future
      actorType: "user",
      metadata: {
        platform: params.platform,
        externalAccountId: params.externalAccountId,
        scopes: params.scopes
      }
    });

    return channelAccountId;
  }

  async updateHealthCheck(
    client: pg.PoolClient,
    workspaceId: string,
    channelAccountId: string,
    params: {
      status: "valid" | "expired" | "missing_permissions" | "unknown";
      missingScopes?: string[];
      permissionErrorCode?: number;
      lastCheckedAt: string;
    }
  ) {
    await client.query(
      `
      UPDATE channel_accounts
      SET 
        token_status = $1,
        permission_status = $2,
        permission_error_code = $3,
        last_checked_at = $4,
        updated_at = NOW()
      WHERE id = $5 AND workspace_id = $6
      `,
      [
        toTokenStatus(params.status),
        params.status,
        params.permissionErrorCode ?? null,
        params.lastCheckedAt,
        channelAccountId,
        workspaceId
      ]
    );

    await client.query(
      `
      UPDATE token_references
      SET token_status = $1, last_checked_at = $2, updated_at = NOW()
      WHERE channel_account_id = $3 AND status = 'active'
      `,
      [
        toTokenStatus(params.status),
        params.lastCheckedAt,
        channelAccountId
      ]
    );

    const action = params.status === "missing_permissions" 
      ? "FACEBOOK_PAGE_PERMISSION_MISSING" 
      : "FACEBOOK_PAGE_TOKEN_HEALTH_CHECKED";

    await this.auditRepo.insertAuditLog(client, {
      workspaceId,
      entityType: "channel_account",
      entityId: channelAccountId,
      eventType: action,
      actorId: "system",
      actorType: "system",
      metadata: {
        status: params.status,
        missingScopes: params.missingScopes,
        permissionErrorCode: params.permissionErrorCode
      }
    });
  }

  async disconnectChannelAccount(
    client: pg.PoolClient,
    workspaceId: string,
    channelAccountId: string
  ) {
    // 1. Mark account inactive
    await client.query(
      `
      UPDATE channel_accounts
      SET status = 'inactive', updated_at = NOW()
      WHERE id = $1 AND workspace_id = $2
      `,
      [channelAccountId, workspaceId]
    );

    // 2. Mark token references revoked
    await client.query(
      `
      UPDATE token_references
      SET status = 'revoked', token_status = 'invalid', revoked_at = NOW(), updated_at = NOW()
      WHERE channel_account_id = $1 AND workspace_id = $2
      `,
      [channelAccountId, workspaceId]
    );

    // 3. Audit Log
    await this.auditRepo.insertAuditLog(client, {
      workspaceId,
      entityType: "channel_account",
      entityId: channelAccountId,
      eventType: "FACEBOOK_PAGE_DISCONNECTED",
      actorId: "system",
      actorType: "user",
      metadata: {}
    });
  }
  
  async getChannelAccount(
    client: pg.PoolClient,
    workspaceId: string,
    channelAccountId: string
  ): Promise<{
    id: string;
    workspace_id: string;
    airtable_channel_account_record_id: string | null;
    secret_ref: string;
  } | null> {
    const res = await client.query<{
      id: string;
      workspace_id: string;
      airtable_channel_account_record_id: string | null;
      secret_ref: string;
    }>(
      `SELECT * FROM channel_accounts WHERE id = $1 AND workspace_id = $2`,
      [channelAccountId, workspaceId]
    );
    return res.rows[0] ?? null;
  }
}
