import { Router } from "express";
import { z } from "zod";
import { type Database } from "../ledger/postgres.js";
import { type Logger } from "../lib/logger.js";
import { ChannelAccountAdminRepository, toTokenStatus } from "../ledger/channelAccountAdminRepository.js";
import { type FacebookMcpClient } from "../mcp/facebookMcpClient.js";
import { type AirtableClient } from "../airtable/airtableClient.js";
import { randomUUID } from "node:crypto";
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
  if (!content || toolResponse.isError) {
    throw new Error("MCP error or invalid response");
  }
  return JSON.parse(content.text) as unknown;
}

// MVP In-Memory Session Cache
// Note: This is volatile and acts as a production blocker for multi-replica deployment.
const oauthSessions = new Map<string, { workspaceId: string; actorId: string; userTokenRef: string; expiresAt: number }>();

const OAuthCallbackBodySchema = z.object({
  code: z.string().min(1)
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

  // Guard all routes
  router.use((req, res, next) => {
    void (async () => {
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

      // Generate OAuth URL using MCP Client
      const result = await mcpClient.callTool("generateOAuthUrl", { redirectUri });
      
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

  router.post("/auth/callback", (req, res) => {
    void (async () => {
    try {
      const body = OAuthCallbackBodySchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "Missing OAuth code" });
        return;
      }
      if (!redirectUri) {
        res.status(500).json({ error: "FACEBOOK_REDIRECT_URI not configured" });
        return;
      }

      const result = await mcpClient.callTool("exchangeCodeAndListPages", {
        workspaceId,
        authCode: body.data.code,
        redirectUri
      });

      const data = StrictExchangeCodeResultSchema.parse(parseMcpJson(result));
      
      // Store userTokenRef in server-side session instead of leaking to client
      const connectionSessionId = randomUUID();
      const ttlMs = 15 * 60 * 1000; // 15 minutes
      oauthSessions.set(connectionSessionId, {
        workspaceId,
        actorId: String(res.locals.actorId),
        userTokenRef: data.userTokenRef,
        expiresAt: Date.now() + ttlMs
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

      const session = oauthSessions.get(connectionSessionId);
      if (!session || session.expiresAt < Date.now()) {
        oauthSessions.delete(connectionSessionId); // Clean up if expired
        res.status(400).json({ error: "OAUTH_SESSION_EXPIRED" });
        return;
      }

      if (session.workspaceId !== workspaceId || session.actorId !== String(res.locals.actorId)) {
        res.status(403).json({ error: "Session invalid for this context" });
        return;
      }

      const result = await mcpClient.callTool("connectPage", {
        workspaceId,
        pageId,
        userTokenRef: session.userTokenRef
      });
      
      // Clear session after terminal attempt
      oauthSessions.delete(connectionSessionId);

      const data = ConnectPageResultSchema.parse(parseMcpJson(result));

      // Ledger upsert
      let channelAccountId: string | undefined;
      await database.transaction(workspaceId, async (client) => {
        channelAccountId = await repo.upsertChannelAccountAndToken(client, workspaceId, {
          platform: "facebook",
          externalAccountId: data.externalAccountId,
          displayName: data.displayName,
          secretRef: data.secretRef,
          scopes: data.scopes,
          expiresAt: data.expiresAt
        });
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
        });
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
          await repo.disconnectChannelAccount(client, workspaceId, channelAccountId);
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
