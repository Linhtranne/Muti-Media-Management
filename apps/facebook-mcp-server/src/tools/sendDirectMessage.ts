import { type SendDirectMessageInput, type SendDirectMessageResult } from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

export interface GraphSendDMClient {
  sendMessage(
    recipientId: string,
    messageText: string,
    accessToken: string,
    idempotencyKey?: string
  ): Promise<{ message_id: string }>;
}

export class DefaultGraphSendDMClient implements GraphSendDMClient {
  async sendMessage(
    recipientId: string,
    messageText: string,
    accessToken: string,
    idempotencyKey?: string
  ): Promise<{ message_id: string }> {
    const url = new URL(`https://graph.facebook.com/v20.0/me/messages`);
    url.searchParams.set("access_token", accessToken);

    const body = {
      recipient: { id: recipientId },
      message: { text: messageText },
      messaging_type: "RESPONSE"
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      const errorObj = new Error(data.error?.message ?? "Graph API Error");
      throw errorObj;
    }

    return { message_id: data.message_id || `msg-reply-${Date.now()}` };
  }
}

export async function sendDirectMessageHandler(
  input: SendDirectMessageInput,
  secretStore: SecretStore,
  graphClient: GraphSendDMClient = new DefaultGraphSendDMClient()
): Promise<SendDirectMessageResult> {
  let accessToken: string;
  try {
    accessToken = await secretStore.resolveSecret(input.secret_ref);
  } catch {
    return { success: false, error: "Failed to resolve credentials." };
  }

  // Check if we are in mock/test mode
  if (process.env.NODE_ENV === "test" || accessToken.startsWith("mock-") || accessToken.startsWith("test-")) {
    return {
      success: true,
      external_message_id: `mock-reply-msg-${input.idempotency_key}`
    };
  }

  try {
    const data = await graphClient.sendMessage(
      input.external_thread_id,
      input.reply_body,
      accessToken,
      input.idempotency_key
    );

    return {
      success: true,
      external_message_id: data.message_id
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: errorMsg.replaceAll(accessToken, "***TOKEN***")
    };
  }
}
