import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { ValidatePostInputSchema } from "@mediaops/shared-contracts";
import { GetRateLimitStatusInputSchema } from "@mediaops/shared-contracts";
import { EnvSecretStore } from "./lib/secretStore.js";
import { validatePostHandler } from "./tools/validatePost.js";
import { getRateLimitStatusHandler } from "./tools/getRateLimitStatus.js";
import { publishPostHandler } from "./tools/publishPost.js";
import { PublishPostInputSchema } from "@mediaops/shared-contracts";

// Ensure environment variables are loaded if not run via a wrapper
import * as dotenv from "dotenv";
dotenv.config();

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

const secretStore = new EnvSecretStore();

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

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [VALIDATE_POST_TOOL, GET_RATE_LIMIT_STATUS_TOOL, PUBLISH_POST_TOOL],
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

    throw new Error(`Tool not found: ${request.params.name}`);
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing ${request.params.name}: ${error.message}`
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

main().catch((error) => {
  console.error("Fatal error in Facebook MCP Server:", error);
  process.exit(1);
});
