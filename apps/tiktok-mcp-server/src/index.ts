import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import {
  ValidateTiktokPostInputSchema,
  PublishTiktokVideoInputSchema,
  PublishTiktokPhotoInputSchema,
  GetTiktokPublishStatusInputSchema,
  QueryTiktokCreatorInfoInputSchema
} from "@mediaops/shared-contracts";
import { EnvSecretStore, type SecretStore } from "./lib/secretStore.js";
import { DatabaseSecretStore } from "./lib/databaseSecretStore.js";
import {
  validateTiktokPostHandler,
  publishTiktokVideoHandler,
  publishTiktokPhotoHandler,
  getTiktokPublishStatusHandler,
  queryTiktokCreatorInfoHandler
} from "./tools/tiktokPublishTools.js";

import * as dotenv from "dotenv";
dotenv.config();

const server = new Server(
  {
    name: "tiktok-mcp-server",
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
  secretStore = new EnvSecretStore();
} else if (process.env.SECRET_STORE_PROVIDER === "database" || process.env.NODE_ENV === "production") {
  secretStore = new DatabaseSecretStore();
} else {
  secretStore = new EnvSecretStore();
}

const VALIDATE_TIKTOK_POST_TOOL: Tool = {
  name: "validateTikTokPost",
  description: "Validates a TikTok post against platform rules before publishing",
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
      workspaceId: { type: "string" },
      privacyLevel: { type: "string" }
    },
    required: ["variantRef", "channelAccountId", "workspaceId"]
  }
};

const PUBLISH_TIKTOK_VIDEO_TOOL: Tool = {
  name: "publishTikTokVideo",
  description: "Initiates video publishing to TikTok",
  inputSchema: {
    type: "object",
    properties: {
      jobRef: {
        type: "object",
        properties: { jobId: { type: "string" } },
        required: ["jobId"]
      },
      channelAccountId: { type: "string" },
      workspaceId: { type: "string" },
      content: {
        type: "object",
        properties: {
          title: { type: "string" },
          videoUrl: { type: "string" },
          privacyLevel: { type: "string" },
          disableComment: { type: "boolean" },
          disableDuet: { type: "boolean" },
          disableStitch: { type: "boolean" },
          brandContentAgreement: { type: "boolean" }
        },
        required: ["title", "videoUrl"]
      }
    },
    required: ["jobRef", "channelAccountId", "workspaceId", "content"]
  }
};

const PUBLISH_TIKTOK_PHOTO_TOOL: Tool = {
  name: "publishTikTokPhoto",
  description: "Initiates photo/carousel publishing to TikTok",
  inputSchema: {
    type: "object",
    properties: {
      jobRef: {
        type: "object",
        properties: { jobId: { type: "string" } },
        required: ["jobId"]
      },
      channelAccountId: { type: "string" },
      workspaceId: { type: "string" },
      content: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          imageUrls: { type: "array", items: { type: "string" } },
          privacyLevel: { type: "string" },
          disableComment: { type: "boolean" }
        },
        required: ["title", "imageUrls"]
      }
    },
    required: ["jobRef", "channelAccountId", "workspaceId", "content"]
  }
};

const GET_TIKTOK_PUBLISH_STATUS_TOOL: Tool = {
  name: "getTikTokPublishStatus",
  description: "Polls TikTok publish status for a given request",
  inputSchema: {
    type: "object",
    properties: {
      channelAccountId: { type: "string" },
      workspaceId: { type: "string" },
      tiktokRequestId: { type: "string" }
    },
    required: ["channelAccountId", "workspaceId", "tiktokRequestId"]
  }
};

const QUERY_TIKTOK_CREATOR_INFO_TOOL: Tool = {
  name: "queryTikTokCreatorInfo",
  description: "Queries TikTok Creator Info metadata",
  inputSchema: {
    type: "object",
    properties: {
      channelAccountId: { type: "string" },
      workspaceId: { type: "string" }
    },
    required: ["channelAccountId", "workspaceId"]
  }
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      VALIDATE_TIKTOK_POST_TOOL,
      PUBLISH_TIKTOK_VIDEO_TOOL,
      PUBLISH_TIKTOK_PHOTO_TOOL,
      GET_TIKTOK_PUBLISH_STATUS_TOOL,
      QUERY_TIKTOK_CREATOR_INFO_TOOL
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === "validateTikTokPost") {
      const input = ValidateTiktokPostInputSchema.parse(request.params.arguments);
      const result = await validateTiktokPostHandler(input, secretStore);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }

    if (request.params.name === "publishTikTokVideo") {
      const input = PublishTiktokVideoInputSchema.parse(request.params.arguments);
      const result = await publishTiktokVideoHandler(input, secretStore);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }

    if (request.params.name === "publishTikTokPhoto") {
      const input = PublishTiktokPhotoInputSchema.parse(request.params.arguments);
      const result = await publishTiktokPhotoHandler(input, secretStore);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }

    if (request.params.name === "getTikTokPublishStatus") {
      const input = GetTiktokPublishStatusInputSchema.parse(request.params.arguments);
      const result = await getTiktokPublishStatusHandler(input, secretStore);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }

    if (request.params.name === "queryTikTokCreatorInfo") {
      const input = QueryTiktokCreatorInfoInputSchema.parse(request.params.arguments);
      const result = await queryTiktokCreatorInfoHandler(input, secretStore);
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
  console.error("TikTok MCP Server running on stdio");
}

try {
  await main();
} catch (error) {
  console.error("Fatal error in TikTok MCP Server:", error);
  process.exit(1);
}
