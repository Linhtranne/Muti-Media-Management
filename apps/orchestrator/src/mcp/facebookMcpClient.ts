import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { 
  type ValidatePostInput, 
  type ValidatePostResult,
  ValidatePostResultSchema,
  type GetRateLimitStatusInput, 
  type RateLimitStatusResult,
  RateLimitStatusResultSchema,
  type PublishPostInput,
  type PublishPostResult,
  PublishPostResultSchema,
  type ReplyCommentInput,
  type ReplyCommentResult,
  ReplyCommentResultSchema,
  type SyncCommentsInput,
  type SyncCommentsResult,
  SyncCommentsResultSchema
} from "@mediaops/shared-contracts";

type McpTextContent = {
  type: "text";
  text: string;
};

type McpToolResponse = {
  isError?: boolean;
  content?: unknown[];
};

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

function extractToolText(response: McpToolResponse): string {
  const textContent = response.content?.find(isTextContent)?.text;

  if (response.isError) {
    throw new Error(`MCP Error: ${textContent ?? "Unknown error"}`);
  }

  if (!textContent) throw new Error("No text content returned from tool");
  return textContent;
}

export class FacebookMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(private readonly serverPath: string) {}

  async connect() {
    if (this.client) return;

    this.transport = new StdioClientTransport({
      command: "node",
      args: [this.serverPath]
    });

    this.client = new Client({
      name: "orchestrator-client",
      version: "0.1.0"
    }, {
      capabilities: {}
    });

    await this.client.connect(this.transport);
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.transport = null;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error("MCP Client not connected");
    return this.client.callTool({ name, arguments: args });
  }

  async validatePost(input: ValidatePostInput): Promise<ValidatePostResult> {
    if (!this.client) throw new Error("MCP Client not connected");

    const response = await this.client.callTool({
      name: "validatePost",
      arguments: input
    });

    const textContent = extractToolText(response as McpToolResponse);

    return ValidatePostResultSchema.parse(JSON.parse(textContent));
  }

  async getRateLimitStatus(input: GetRateLimitStatusInput): Promise<RateLimitStatusResult> {
    if (!this.client) throw new Error("MCP Client not connected");

    const response = await this.client.callTool({
      name: "getRateLimitStatus",
      arguments: input
    });

    const textContent = extractToolText(response as McpToolResponse);

    return RateLimitStatusResultSchema.parse(JSON.parse(textContent));
  }

  async publishPost(input: PublishPostInput): Promise<PublishPostResult> {
    if (!this.client) throw new Error("MCP Client not connected");

    const response = await this.client.callTool({
      name: "publishPost",
      arguments: input
    });

    const textContent = extractToolText(response as McpToolResponse);

    return PublishPostResultSchema.parse(JSON.parse(textContent));
  }

  async replyComment(input: ReplyCommentInput): Promise<ReplyCommentResult> {
    if (!this.client) throw new Error("MCP Client not connected");

    const response = await this.client.callTool({
      name: "replyComment",
      arguments: input
    });

    const textContent = extractToolText(response as McpToolResponse);

    return ReplyCommentResultSchema.parse(JSON.parse(textContent));
  }

  async syncComments(input: SyncCommentsInput): Promise<SyncCommentsResult> {
    if (!this.client) throw new Error("MCP Client not connected");

    const response = await this.client.callTool({
      name: "syncComments",
      arguments: input
    });

    const textContent = extractToolText(response as McpToolResponse);

    return SyncCommentsResultSchema.parse(JSON.parse(textContent));
  }
}
