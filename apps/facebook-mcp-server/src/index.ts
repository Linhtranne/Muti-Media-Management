import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { 
  ValidatePostInputSchema,
  GetRateLimitStatusInputSchema,
  PublishPostInputSchema, 
  ReplyCommentInputSchema,
  SyncCommentsInputSchema,
  ExchangeCodePayloadSchema, 
  ConnectPagePayloadSchema, 
  TokenHealthCheckPayloadSchema,
  GetDirectMessageInputSchema,
  SendDirectMessageInputSchema
} from "@mediaops/shared-contracts";
import { EnvSecretStore, type SecretStore } from "./lib/secretStore.js";
import { DatabaseSecretStore } from "./lib/databaseSecretStore.js";
import { validatePostHandler } from "./tools/validatePost.js";
import { getRateLimitStatusHandler } from "./tools/getRateLimitStatus.js";
import { publishPostHandler } from "./tools/publishPost.js";
import { replyCommentHandler } from "./tools/replyComment.js";
import { syncCommentsHandler } from "./tools/syncComments.js";
import { exchangeCodeAndListPages, connectPage, healthCheckToken } from "./tools/facebookAuthTools.js";
import { getDirectMessageHandler } from "./tools/getDirectMessage.js";
import { sendDirectMessageHandler } from "./tools/sendDirectMessage.js";

// Ensure environment variables are loaded if not run via a wrapper
import * as dotenv from "dotenv";
dotenv.config();

if (process.env.NODE_ENV === "production" && process.env.FACEBOOK_MOCK_MODE === "true") {
  throw new Error("FACEBOOK_MOCK_MODE=true is not allowed in production");
}

const server = new Server(
  {
    name: "facebook-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let secretStore: SecretStore;
if (process.env.SECRET_STORE_PROVIDER === "memory") {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SECRET_STORE_PROVIDER=memory is not allowed in production");
  }
  secretStore = new EnvSecretStore();
} else if (process.env.SECRET_STORE_PROVIDER === "database" || process.env.NODE_ENV === "production") {
  secretStore = new DatabaseSecretStore();
} else {
  secretStore = new EnvSecretStore();
}

const VALIDATE_POST_TOOL: Tool = {
  name: "validatePost",
  description: "Validates a Facebook post against platform rules before publishing",
  inputSchema: {
    type: "object",
    properties: {
      variantRef: {
        type: "object",
        properties: {
          variantId: { type: "string" },
          bodyLength: { type: "number" },
          hashtagCount: { type: "number" },
          hasMedia: { type: "boolean" },
          ctaUrl: { type: "string" }
        },
        required: ["variantId", "bodyLength", "hashtagCount", "hasMedia"]
      },
      channelAccountId: { type: "string" },
      secretRef: { type: "string" }
    },
    required: ["variantRef", "channelAccountId", "secretRef"]
  }
};

const GET_RATE_LIMIT_STATUS_TOOL: Tool = {
  name: "getRateLimitStatus",
  description: "Gets the current Facebook Graph API rate limit status for an account",
  inputSchema: {
    type: "object",
    properties: {
      channelAccountId: { type: "string" },
      secretRef: { type: "string" }
    },
    required: ["channelAccountId", "secretRef"]
  }
};

const PUBLISH_POST_TOOL: Tool = {
  name: "publishPost",
  description: "Publishes a post to a Facebook Page",
  inputSchema: {
    type: "object",
    properties: {
      jobRef: {
        type: "object",
        properties: {
          jobId: { type: "string" }
        },
        required: ["jobId"]
      },
      channelAccountId: { type: "string" },
      secretRef: { type: "string" },
      content: {
        type: "object",
        properties: {
          body: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          link: { type: "string" }
        },
        required: ["body"]
      }
    },
    required: ["jobRef", "channelAccountId", "secretRef", "content"]
  }
};

const REPLY_COMMENT_TOOL: Tool = {
  name: "replyComment",
  description: "Replies to a Facebook comment",
  inputSchema: {
    type: "object",
    properties: {
      external_comment_id: { type: "string" },
      message: { type: "string" },
      channelAccountId: { type: "string" }
    },
    required: ["external_comment_id", "message", "channelAccountId"]
  }
};

const SYNC_COMMENTS_TOOL: Tool = {
  name: "syncComments",
  description: "Fetches comments for a given Facebook post",
  inputSchema: {
    type: "object",
    properties: {
      postRef: {
        type: "object",
        properties: { jobId: { type: "string" } },
        required: ["jobId"]
      },
      channelAccountId: { type: "string" },
      secretRef: { type: "string" },
      externalPostId: { type: "string" }
    },
    required: ["postRef", "channelAccountId", "secretRef", "externalPostId"]
  }
};

const GENERATE_OAUTH_URL_TOOL: Tool = {
  name: "generateOAuthUrl",
  description: "Generates the Facebook OAuth URL for admin consent",
  inputSchema: {
    type: "object",
    properties: {
      redirectUri: { type: "string" },
      state: { type: "string" }
    },
    required: ["redirectUri", "state"]
  }
};

const EXCHANGE_CODE_TOOL: Tool = {
  name: "exchangeCodeAndListPages",
  description: "Exchanges OAuth code for token and lists pages",
  inputSchema: {
    type: "object",
    properties: {
      workspaceId: { type: "string" },
      authCode: { type: "string" },
      redirectUri: { type: "string" }
    },
    required: ["workspaceId", "authCode", "redirectUri"]
  }
};

const CONNECT_PAGE_TOOL: Tool = {
  name: "connectPage",
  description: "Connects a selected page by returning its Page Access Token secretRef",
  inputSchema: {
    type: "object",
    properties: {
      workspaceId: { type: "string" },
      pageId: { type: "string" },
      userTokenRef: { type: "string" }
    },
    required: ["workspaceId", "pageId", "userTokenRef"]
  }
};

const HEALTH_CHECK_TOKEN_TOOL: Tool = {
  name: "healthCheckToken",
  description: "Checks if a token is valid and has required scopes",
  inputSchema: {
    type: "object",
    properties: {
      workspaceId: { type: "string" },
      secretRef: { type: "string" },
      requiredScopes: { type: "array", items: { type: "string" } }
    },
    required: ["workspaceId", "secretRef", "requiredScopes"]
  }
};

const GET_DIRECT_MESSAGE_TOOL: Tool = {
  name: "get_direct_message",
  description: "Fetches full body content and attachments of a direct message from Facebook",
  inputSchema: {
    type: "object",
    properties: {
      channel_account_id: { type: "string" },
      external_thread_id: { type: "string" },
      external_message_id: { type: "string" }
    },
    required: ["channel_account_id", "external_thread_id", "external_message_id"]
  }
};

const SEND_DIRECT_MESSAGE_TOOL: Tool = {
  name: "send_direct_message",
  description: "Sends a direct message reply to a customer thread on Facebook Page",
  inputSchema: {
    type: "object",
    properties: {
      channel_account_id: { type: "string" },
      external_thread_id: { type: "string" },
      reply_body: { type: "string" },
      idempotency_key: { type: "string" }
    },
    required: ["channel_account_id", "external_thread_id", "reply_body", "idempotency_key"]
  }
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      VALIDATE_POST_TOOL, 
      GET_RATE_LIMIT_STATUS_TOOL, 
      PUBLISH_POST_TOOL, 
      REPLY_COMMENT_TOOL,
      SYNC_COMMENTS_TOOL,
      GENERATE_OAUTH_URL_TOOL,
      EXCHANGE_CODE_TOOL,
      CONNECT_PAGE_TOOL,
      HEALTH_CHECK_TOKEN_TOOL,
      GET_DIRECT_MESSAGE_TOOL,
      SEND_DIRECT_MESSAGE_TOOL
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === "validatePost") {
      const input = ValidatePostInputSchema.parse(request.params.arguments);
      const result = await validatePostHandler(input, secretStore);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    if (request.params.name === "getRateLimitStatus") {
      const input = GetRateLimitStatusInputSchema.parse(request.params.arguments);
      const result = await getRateLimitStatusHandler(input, secretStore);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    if (request.params.name === "publishPost") {
      const input = PublishPostInputSchema.parse(request.params.arguments);
      const result = await publishPostHandler(input, secretStore);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    if (request.params.name === "replyComment") {
      const input = ReplyCommentInputSchema.parse(request.params.arguments);
      const result = await replyCommentHandler(input, secretStore);
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) }
        ]
      };
    }

    if (request.params.name === "syncComments") {
      const input = SyncCommentsInputSchema.parse(request.params.arguments);
      const result = await syncCommentsHandler(input, secretStore);
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) }
        ]
      };
    }

    if (request.params.name === "get_direct_message") {
      const input = GetDirectMessageInputSchema.parse(request.params.arguments);
      const result = await getDirectMessageHandler(input, secretStore);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    if (request.params.name === "send_direct_message") {
      const input = SendDirectMessageInputSchema.parse(request.params.arguments);
      const result = await sendDirectMessageHandler(input, secretStore);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    if (request.params.name === "generateOAuthUrl") {
      const input = z.object({
        redirectUri: z.string().url(),
        state: z.string().min(1)
      }).strict().parse(request.params.arguments);

      if (process.env.FACEBOOK_MOCK_MODE === "true") {
        const callbackUrl = new URL(input.redirectUri);
        callbackUrl.searchParams.set("code", "mock-authorization-code");
        callbackUrl.searchParams.set("state", input.state);
        return {
          content: [{ type: "text", text: JSON.stringify({ url: callbackUrl.toString() }, null, 2) }]
        };
      }

      const appId = process.env.FACEBOOK_APP_ID;
      if (!appId) throw new Error("Missing FACEBOOK_APP_ID");

      const scopes = (process.env.FACEBOOK_REQUIRED_SCOPES ??
        "pages_show_list,pages_read_engagement,pages_manage_posts")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean);
      const url = new URL("https://www.facebook.com/v22.0/dialog/oauth");
      url.searchParams.set("client_id", appId);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("scope", scopes.join(","));
      url.searchParams.set("state", input.state);
      
      return {
        content: [{ type: "text", text: JSON.stringify({ url: url.toString() }, null, 2) }]
      };
    }

    if (request.params.name === "exchangeCodeAndListPages") {
      const input = ExchangeCodePayloadSchema.parse(request.params.arguments);
      const result = await exchangeCodeAndListPages(input, secretStore);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }

    if (request.params.name === "connectPage") {
      const input = ConnectPagePayloadSchema.parse(request.params.arguments);
      const result = await connectPage(input, secretStore);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }

    if (request.params.name === "healthCheckToken") {
      const input = TokenHealthCheckPayloadSchema.parse(request.params.arguments);
      const result = await healthCheckToken(input, secretStore);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }

    throw new Error(`Tool not found: ${request.params.name}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing ${request.params.name}: ${message}`
        }
      ]
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Facebook MCP Server running on stdio");
}

try {
  await main();
} catch (error) {
  console.error("Fatal error in Facebook MCP Server:", error);
  process.exit(1);
}
