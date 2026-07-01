import { Router } from "express";
import { z } from "zod";
import { type Database } from "../ledger/postgres.js";
import { type Logger } from "../lib/logger.js";
import { ChannelAccountAdminRepository, toTokenStatus } from "../ledger/channelAccountAdminRepository.js";
import { type FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import { type AirtableClient } from "../airtable/airtableClient.js";
import { randomUUID } from "node:crypto";
import { redact } from "../lib/redact.js";
import {
  ConnectPageResultSchema,
  StrictExchangeCodeResultSchema,
  TokenHealthCheckResultSchema
} from "@mediaops/shared-contracts";

type McpToolResponse = {
  isError?: boolean;
  content?: unknown[];
};

type McpTextContent = {
  type: "text";
  text: string;
};

const OAUTH_STATE_TTL_MINUTES = 10;
const OAUTH_SESSION_TTL_MINUTES = 15;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const OAUTH_STATE_TTL_MS = OAUTH_STATE_TTL_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const OAUTH_SESSION_TTL_MS = OAUTH_SESSION_TTL_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTextContent(content: unknown): content is McpTextContent {
  return (
    typeof content === "object" &&
    content !== null &&
    "type" in content &&
    "text" in content &&
    (content as { type: unknown }).type === "text" &&
    typeof (content as { text: unknown }).text === "string"
  );
}

function parseMcpJson(response: unknown): unknown {
  const toolResponse = response as McpToolResponse;
  const content = toolResponse.content?.find(isTextContent);
  if (toolResponse.isError) {
    throw new Error(`MCP error: ${String(redact(content?.text ?? "Unknown MCP error"))}`);
  }
  if (!content) {
    throw new Error("MCP response did not contain text content");
  }
  return JSON.parse(content.text) as unknown;
}

// MVP In-Memory Session Cache has been replaced by DB table
// to allow multi-replica deployment and persistence across restarts.

const OAuthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().uuid()
});

const ConnectPageBodySchema = z.object({
  pageId: z.string().min(1),
  connectionSessionId: z.string().min(1)
});

export function createFacebookAdminRouter(
  database: Database,
  mcpClient: FacebookMcpClient,
  airtableClient: AirtableClient,
  logger: Logger,
  workspaceId: string,
  isEnabled: boolean,
  redirectUri: string | undefined
): Router {
  const router = Router();
  const repo = new ChannelAccountAdminRepository();

  // Meta redirects the browser to this route and cannot attach our admin
  // header. The one-time OAuth state authenticates and attributes callback.
  router.use((req, res, next) => {
    void (async () => {
    if (req.method === "GET" && req.path === "/auth/callback") {
      next();
      return;
    }

    if (!isEnabled) {
      res.status(404).json({ error: "Facebook Page Config is disabled" });
      return;
    }
    
    const slackUserId = req.header("x-user-id");
    if (!slackUserId) {
      res.status(403).json({ error: "x-user-id header is required" });
      return;
    }

    try {
      let isAdmin = false;
      await database.transaction(workspaceId, async (client) => {
        const result = await client.query<{ role: string }>(
          "SELECT role FROM workspace_members WHERE workspace_id = $1 AND slack_user_id = $2",
          [workspaceId, slackUserId]
        );
        if (result.rows.length > 0 && result.rows[0].role === "admin") {
          isAdmin = true;
        }
      });

      if (!isAdmin) {
        res.status(403).json({ error: "Admin role required" });
        return;
      }
      
      // Pass actorId to routes
      res.locals.actorId = slackUserId;
      next();
    } catch (error: unknown) {
      logger.error("Admin validation failed", { error: errorMessage(error) });
      res.status(500).json({ error: "Internal server error" });
    }
    })();
  });

  router.post("/auth/start", (req, res) => {
    void (async () => {
    try {
      if (!redirectUri) {
        res.status(500).json({ error: "FACEBOOK_REDIRECT_URI not configured" });
        return;
      }

      const state = randomUUID();
      const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();

      await database.transaction(workspaceId, async (client) => {
        await client.query(
          `INSERT INTO facebook_oauth_states (state, workspace_id, actor_id, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [state, workspaceId, res.locals.actorId, expiresAt]
        );
      });

      // Generate OAuth URL using MCP Client
      const result = await mcpClient.callTool("generateOAuthUrl", { redirectUri, state });
      
      const data = parseMcpJson(result) as { url: string };

      await database.transaction(workspaceId, async (client) => {
        // We log the intent
        const { AuditLogRepository } = await import("../ledger/auditLogRepository.js");
        const auditRepo = new AuditLogRepository();
        await auditRepo.insertAuditLog(client, {
          workspaceId,
          entityType: "workspace",
          entityId: workspaceId,
          eventType: "FACEBOOK_PAGE_OAUTH_STARTED",
          actorId: String(res.locals.actorId),
          actorType: "user",
          metadata: {}
        });
      });

      res.status(200).json({ url: data.url });
    } catch (error: unknown) {
      logger.error("OAuth start failed", { error: errorMessage(error) });
      res.status(500).json({ error: "Failed to generate OAuth URL" });
    }
    })();
  });

  router.get("/auth/callback", (req, res) => {
    void (async () => {
    try {
      const query = OAuthCallbackQuerySchema.safeParse(req.query);
      if (!query.success) {
        res.status(400).json({ error: "Missing or invalid OAuth code/state" });
        return;
      }
      if (!redirectUri) {
        res.status(500).json({ error: "FACEBOOK_REDIRECT_URI not configured" });
        return;
      }

      let actorId: string | undefined;
      await database.transaction(workspaceId, async (client) => {
        const stateResult = await client.query<{ actor_id: string }>(
          `UPDATE facebook_oauth_states
           SET consumed_at = NOW()
           WHERE state = $1
             AND workspace_id = $2
             AND consumed_at IS NULL
             AND expires_at > NOW()
           RETURNING actor_id`,
          [query.data.state, workspaceId]
        );
        actorId = stateResult.rows[0]?.actor_id;
      });

      if (!actorId) {
        res.status(400).json({ error: "OAUTH_STATE_INVALID_OR_EXPIRED" });
        return;
      }

      const result = await mcpClient.callTool("exchangeCodeAndListPages", {
        workspaceId,
        authCode: query.data.code,
        redirectUri
      });

      const data = StrictExchangeCodeResultSchema.parse(parseMcpJson(result));
      
      const connectionSessionId = randomUUID();
      const ttlMs = OAUTH_SESSION_TTL_MS;
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();

      await database.transaction(workspaceId, async (client) => {
        await client.query(
          `INSERT INTO facebook_oauth_sessions (id, workspace_id, actor_id, user_token_ref, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [connectionSessionId, workspaceId, actorId, data.userTokenRef, expiresAt]
        );
      });

      res.status(200).json({
        pages: data.pages,
        connectionSessionId
      });
    } catch (error: unknown) {
      logger.error("OAuth callback failed", { error: errorMessage(error) });
      res.status(500).json({ error: "Failed to exchange code and list pages" });
    }
    })();
  });

  router.post("/pages/connect", (req, res) => {
    void (async () => {
    try {
      const body = ConnectPageBodySchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "Missing pageId or connectionSessionId" });
        return;
      }
      const { pageId, connectionSessionId } = body.data;

      let userTokenRef: string | undefined;

      await database.transaction(workspaceId, async (client) => {
        const result = await client.query<{ user_token_ref: string }>(
          `UPDATE facebook_oauth_sessions
           SET consumed_at = NOW()
           WHERE id = $1 AND workspace_id = $2 AND actor_id = $3 AND consumed_at IS NULL AND expires_at > NOW()
           RETURNING user_token_ref`,
          [connectionSessionId, workspaceId, res.locals.actorId]
        );
        userTokenRef = result.rows[0]?.user_token_ref;
      });

      if (!userTokenRef) {
        res.status(400).json({ error: "OAUTH_SESSION_EXPIRED" });
        return;
      }

      const result = await mcpClient.callTool("connectPage", {
        workspaceId,
        pageId,
        userTokenRef
      });

      const data = ConnectPageResultSchema.parse(parseMcpJson(result));

      // Ledger upsert
      let channelAccountId: string | undefined;
      await database.transaction(workspaceId, async (client) => {
        channelAccountId = await repo.upsertChannelAccountAndToken(
          client, 
          workspaceId, 
          {
            platform: "facebook",
            externalAccountId: data.externalAccountId,
            displayName: data.displayName,
            secretRef: data.secretRef,
            scopes: data.scopes,
            expiresAt: data.expiresAt
          },
          String(res.locals.actorId)
        );
      });

      if (!channelAccountId) {
        throw new Error("Failed to persist channel account");
      }

      res.status(200).json({
        channelAccountId,
        status: "success"
      });
    } catch (error: unknown) {
      logger.error("Connect page failed", { error: errorMessage(error) });
      res.status(500).json({ error: "Failed to connect page" });
    }
    })();
  });

  router.post("/pages/:channelAccountId/health-check", (req, res) => {
    void (async () => {
    try {
      const { channelAccountId } = req.params;
      
      const account = await database.transaction(workspaceId, async (client) => {
        return await repo.getChannelAccount(client, workspaceId, channelAccountId);
      });

      if (!account) {
        res.status(404).json({ error: "Channel account not found" });
        return;
      }

      const requiredScopes = process.env.FACEBOOK_REQUIRED_SCOPES?.split(",") || [];

      const result = await mcpClient.callTool("healthCheckToken", {
        workspaceId,
        secretRef: account.secret_ref,
        requiredScopes
      });

      const data = TokenHealthCheckResultSchema.parse(parseMcpJson(result));

      await database.transaction(workspaceId, async (client) => {
        await repo.updateHealthCheck(client, workspaceId, channelAccountId, {
          status: data.status,
          missingScopes: data.missingScopes,
          permissionErrorCode: data.permissionErrorCode,
          lastCheckedAt: data.lastCheckedAt
        }, String(res.locals.actorId));
      });

      // Optional: Airtable sync safe fields
      if (account.airtable_channel_account_record_id) {
        try {
          await airtableClient.updateRecord("Channel Accounts", account.airtable_channel_account_record_id, {
            token_status: toTokenStatus(data.status),
            permission_status: data.status,
            permission_error_code: data.permissionErrorCode,
            last_checked_at: data.lastCheckedAt
          });
        } catch (syncErr: unknown) {
          logger.warn("Failed to sync Airtable status", { error: errorMessage(syncErr) });
          // Note: we do not rollback ledger
          await database.transaction(workspaceId, async (client) => {
            const { AuditLogRepository } = await import("../ledger/auditLogRepository.js");
            const auditRepo = new AuditLogRepository();
            await auditRepo.insertAuditLog(client, {
              workspaceId,
              entityType: "channel_account",
              entityId: channelAccountId,
              eventType: "FACEBOOK_PAGE_AIRTABLE_SYNC_FAILED",
              actorId: "system",
              actorType: "system",
              metadata: { error: errorMessage(syncErr) }
            });
          });
        }
      }

      res.status(200).json(data);
    } catch (error: unknown) {
      logger.error("Health check failed", { error: errorMessage(error) });
      res.status(500).json({ error: "Failed to perform health check" });
    }
    })();
  });

  router.post("/pages/:channelAccountId/disconnect", (req, res) => {
    void (async () => {
    try {
      const { channelAccountId } = req.params;

      const account = await database.transaction(workspaceId, async (client) => {
        const currentAccount = await repo.getChannelAccount(client, workspaceId, channelAccountId);
        if (currentAccount) {
          await repo.disconnectChannelAccount(client, workspaceId, channelAccountId, String(res.locals.actorId));
        }
        return currentAccount;
      });

      if (!account) {
        res.status(404).json({ error: "Channel account not found" });
        return;
      }

      if (account.airtable_channel_account_record_id) {
        try {
          await airtableClient.updateRecord("Channel Accounts", account.airtable_channel_account_record_id, {
            status: "inactive",
            token_status: "unknown"
          });
        } catch (syncErr: unknown) {
          logger.warn("Failed to sync Airtable status on disconnect", { error: errorMessage(syncErr) });
        }
      }

      res.status(200).json({ status: "disconnected" });
    } catch (error: unknown) {
      logger.error("Disconnect failed", { error: errorMessage(error) });
      res.status(500).json({ error: "Failed to disconnect page" });
    }
    })();
  });

  return router;
}
