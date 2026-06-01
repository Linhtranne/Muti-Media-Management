import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { 
  ValidatePostInput, 
  ValidatePostResult,
  ValidatePostResultSchema 
} from "@mediaops/shared-contracts";
import { 
  GetRateLimitStatusInput, 
  RateLimitStatusResult,
  RateLimitStatusResultSchema
} from "@mediaops/shared-contracts";
import {
  PublishPostInput,
  PublishPostResult,
  PublishPostResultSchema
} from "@mediaops/shared-contracts";

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

  async validatePost(input: ValidatePostInput): Promise<ValidatePostResult> {
    if (!this.client) throw new Error("MCP Client not connected");

    const response = await this.client.callTool({
      name: "validatePost",
      arguments: input as any
    });

    if (response.isError) {
      const content = response.content as any[];
      const errorText = content.find(c => c.type === "text")?.text || "Unknown error";
      throw new Error(`MCP Error: ${errorText}`);
    }

    const content = response.content as any[];
    const textContent = content.find(c => c.type === "text")?.text;
    if (!textContent) throw new Error("No text content returned from tool");

    return ValidatePostResultSchema.parse(JSON.parse(textContent));
  }

  async getRateLimitStatus(input: GetRateLimitStatusInput): Promise<RateLimitStatusResult> {
    if (!this.client) throw new Error("MCP Client not connected");

    const response = await this.client.callTool({
      name: "getRateLimitStatus",
      arguments: input as any
    });

    if (response.isError) {
      const content = response.content as any[];
      const errorText = content.find(c => c.type === "text")?.text || "Unknown error";
      throw new Error(`MCP Error: ${errorText}`);
    }

    const content = response.content as any[];
    const textContent = content.find(c => c.type === "text")?.text;
    if (!textContent) throw new Error("No text content returned from tool");

    return RateLimitStatusResultSchema.parse(JSON.parse(textContent));
  }

  async publishPost(input: PublishPostInput): Promise<PublishPostResult> {
    if (!this.client) throw new Error("MCP Client not connected");

    const response = await this.client.callTool({
      name: "publishPost",
      arguments: input as any
    });

    if (response.isError) {
      const content = response.content as any[];
      const errorText = content.find(c => c.type === "text")?.text || "Unknown error";
      throw new Error(`MCP Error: ${errorText}`);
    }

    const content = response.content as any[];
    const textContent = content.find(c => c.type === "text")?.text;
    if (!textContent) throw new Error("No text content returned from tool");

    return PublishPostResultSchema.parse(JSON.parse(textContent));
  }
}
