import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  type ValidateTiktokPostInput,
  type ValidatePostResult,
  ValidatePostResultSchema,
  type PublishTiktokVideoInput,
  type PublishTiktokPhotoInput,
  type PublishTiktokResult,
  PublishTiktokResultSchema,
  type GetTiktokPublishStatusInput,
  type GetTiktokPublishStatusResult,
  GetTiktokPublishStatusResultSchema
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

export class TiktokMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connectionPromise: Promise<void> | null = null;

  constructor(private readonly serverPath: string) {}

  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = this.openConnection();
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async openConnection(): Promise<void> {
    const mcpEnv = Object.fromEntries(
      [
        "NODE_ENV",
        "DATABASE_URL",
        "SECRET_STORE_PROVIDER",
        "SECRET_ENCRYPTION_KEY",
        "TIKTOK_CLIENT_KEY",
        "TIKTOK_CLIENT_SECRET",
        "TIKTOK_MOCK_MODE"
      ]
        .map((name) => [name, process.env[name]])
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );

    const transport = new StdioClientTransport({
      command: "node",
      args: [this.serverPath],
      env: mcpEnv
    });

    const client = new Client({
      name: "orchestrator-tiktok-client",
      version: "0.1.0"
    }, {
      capabilities: {}
    });

    try {
      await client.connect(transport);
      this.transport = transport;
      this.client = client;
    } catch (error) {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      this.transport = null;
      this.client = null;
      throw error;
    }
  }

  async disconnect() {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;

    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.getConnectedClient();

    try {
      return await client.callTool({ name, arguments: args });
    } catch (error) {
      if (!this.isDisconnectedError(error)) throw error;

      await this.disconnect();
      const reconnectedClient = await this.getConnectedClient();
      return reconnectedClient.callTool({ name, arguments: args });
    }
  }

  private async getConnectedClient(): Promise<Client> {
    await this.connect();
    if (!this.client) throw new Error("MCP Client not connected");
    return this.client;
  }

  private isDisconnectedError(error: unknown): boolean {
    return error instanceof Error && /not connected|connection closed/i.test(error.message);
  }

  async validatePost(input: ValidateTiktokPostInput): Promise<ValidatePostResult> {
    const response = await this.callTool("validateTikTokPost", input);
    const textContent = extractToolText(response as McpToolResponse);
    return ValidatePostResultSchema.parse(JSON.parse(textContent));
  }

  async publishTiktokVideo(input: PublishTiktokVideoInput): Promise<PublishTiktokResult> {
    const response = await this.callTool("publishTikTokVideo", input);
    const textContent = extractToolText(response as McpToolResponse);
    return PublishTiktokResultSchema.parse(JSON.parse(textContent));
  }

  async publishTiktokPhoto(input: PublishTiktokPhotoInput): Promise<PublishTiktokResult> {
    const response = await this.callTool("publishTikTokPhoto", input);
    const textContent = extractToolText(response as McpToolResponse);
    return PublishTiktokResultSchema.parse(JSON.parse(textContent));
  }

  async getTiktokPublishStatus(input: GetTiktokPublishStatusInput): Promise<GetTiktokPublishStatusResult> {
    const response = await this.callTool("getTikTokPublishStatus", input);
    const textContent = extractToolText(response as McpToolResponse);
    return GetTiktokPublishStatusResultSchema.parse(JSON.parse(textContent));
  }
}
