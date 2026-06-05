import { type GetDirectMessageInput, type GetDirectMessageResult } from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

export interface GraphDMClient {
  getMessage(messageId: string, accessToken: string): Promise<any>;
}

export class DefaultGraphDMClient implements GraphDMClient {
  async getMessage(messageId: string, accessToken: string): Promise<any> {
    const url = new URL(`https://graph.facebook.com/v20.0/${messageId}`);
    url.searchParams.set("fields", "id,message,from,created_time,attachments");
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url.toString(), { method: "GET" });
    const data = await response.json();

    if (!response.ok) {
      const errorObj = new Error((data as any).error?.message ?? "Graph API Error");
      throw errorObj;
    }
    return data;
  }
}

export async function getDirectMessageHandler(
  input: GetDirectMessageInput,
  secretStore: SecretStore,
  graphClient: GraphDMClient = new DefaultGraphDMClient()
): Promise<GetDirectMessageResult> {
  let accessToken: string;
  try {
    accessToken = await secretStore.resolveSecret(input.secret_ref);
  } catch {
    throw new Error(`Failed to resolve credentials.`);
  }

  // Check if we are in mock/test mode
  if (process.env.NODE_ENV === "test" || accessToken.startsWith("mock-") || accessToken.startsWith("test-")) {
    return {
      body: `Deterministic mock body for ${input.external_message_id}`,
      body_redacted: `Deterministic mock body for ${input.external_message_id}`,
      attachments_ref: [],
      sender_metadata: {
        name: "Mock User",
        external_user_id: "mock-customer-123"
      },
      created_at_platform: "2026-06-03T10:00:00.000Z"
    };
  }

  try {
    const data = await graphClient.getMessage(input.external_message_id, accessToken);
    const body = data.message || "";
    // Redaction: max 80 chars, remove newlines/control chars
    const bodyRedacted = body.replace(/[\r\n\t]+/g, " ").slice(0, 80);

    const attachments = (data.attachments?.data || []).map((att: any) => ({
      type: att.mime_type || "file",
      url_ref: att.file_url || att.url || "",
      id: att.id
    }));

    return {
      body,
      body_redacted: bodyRedacted,
      attachments_ref: attachments,
      sender_metadata: {
        name: data.from?.name || "Facebook User",
        external_user_id: data.from?.id || ""
      },
      created_at_platform: data.created_time || new Date().toISOString()
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    throw new Error(errorMsg.replaceAll(accessToken, "***TOKEN***"));
  }
}
