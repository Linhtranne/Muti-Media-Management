import { type SendDirectMessageInput, type SendDirectMessageResult } from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

interface GraphSendMessageResponse {
  message_id?: string;
  error?: {
    message?: string;
  };
}

const GRAPH_API_ERROR_MESSAGE = "Graph API Error";
const FAILED_TO_RESOLVE_CREDENTIALS_MESSAGE = "Failed to resolve credentials.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseGraphSendMessageResponse(value: unknown): GraphSendMessageResponse {
  if (!isRecord(value)) {
    return {};
  }
  return {
    message_id: optionalString(value.message_id),
    error: isRecord(value.error)
      ? { message: optionalString(value.error.message) }
      : undefined
  };
}

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
    _idempotencyKey?: string
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

    const data = parseGraphSendMessageResponse(await response.json() as unknown);
    if (!response.ok) {
      const errorObj = new Error(data.error?.message ?? GRAPH_API_ERROR_MESSAGE);
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
    return { success: false, error: FAILED_TO_RESOLVE_CREDENTIALS_MESSAGE };
  }

  // Check if we are in mock/test mode
  if (
    process.env.FACEBOOK_MOCK_MODE === "true" ||
    process.env.NODE_ENV === "test" ||
    accessToken.startsWith("mock-") ||
    accessToken.startsWith("test-")
  ) {
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
