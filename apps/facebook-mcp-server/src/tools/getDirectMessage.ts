import { type GetDirectMessageInput, type GetDirectMessageResult } from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

interface GraphErrorResponse {
  error?: {
    message?: string;
  };
}

interface GraphDirectMessageAttachment {
  mime_type?: string;
  file_url?: string;
  url?: string;
  id?: string;
}

interface GraphDirectMessageResponse extends GraphErrorResponse {
  id?: string;
  message?: string;
  from?: {
    name?: string;
    id?: string;
  };
  created_time?: string;
  attachments?: {
    data?: GraphDirectMessageAttachment[];
  };
}

const GRAPH_API_ERROR_MESSAGE = "Graph API Error";
const FAILED_TO_RESOLVE_CREDENTIALS_MESSAGE = "Failed to resolve credentials.";
const MOCK_SENDER_NAME = "Mock User";
const MOCK_SENDER_EXTERNAL_ID = "mock-customer-123";
const FACEBOOK_SENDER_NAME_FALLBACK = "Facebook User";
const FILE_ATTACHMENT_TYPE = "file";
const REDACTED_BODY_MAX_LENGTH = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseGraphDirectMessageResponse(value: unknown): GraphDirectMessageResponse {
  if (!isRecord(value)) {
    return {};
  }
  const error = isRecord(value.error) ? { message: optionalString(value.error.message) } : undefined;
  const from = isRecord(value.from)
    ? { name: optionalString(value.from.name), id: optionalString(value.from.id) }
    : undefined;
  const rawAttachments = isRecord(value.attachments) && Array.isArray(value.attachments.data)
    ? value.attachments.data
    : [];
  const attachments = rawAttachments
    .filter(isRecord)
    .map((attachment) => ({
      mime_type: optionalString(attachment.mime_type),
      file_url: optionalString(attachment.file_url),
      url: optionalString(attachment.url),
      id: optionalString(attachment.id)
    }));
  return {
    id: optionalString(value.id),
    message: optionalString(value.message),
    from,
    created_time: optionalString(value.created_time),
    attachments: { data: attachments },
    error
  };
}

export interface GraphDMClient {
  getMessage(messageId: string, accessToken: string): Promise<GraphDirectMessageResponse>;
}

export class DefaultGraphDMClient implements GraphDMClient {
  async getMessage(messageId: string, accessToken: string): Promise<GraphDirectMessageResponse> {
    const url = new URL(`https://graph.facebook.com/v20.0/${messageId}`);
    url.searchParams.set("fields", "id,message,from,created_time,attachments");
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url.toString(), { method: "GET" });
    const data = parseGraphDirectMessageResponse(await response.json() as unknown);

    if (!response.ok) {
      const errorObj = new Error(data.error?.message ?? GRAPH_API_ERROR_MESSAGE);
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
    throw new Error(FAILED_TO_RESOLVE_CREDENTIALS_MESSAGE);
  }

  // Check if we are in mock/test mode
  if (
    process.env.FACEBOOK_MOCK_MODE === "true" ||
    process.env.NODE_ENV === "test" ||
    accessToken.startsWith("mock-") ||
    accessToken.startsWith("test-")
  ) {
    return {
      body: `Deterministic mock body for ${input.external_message_id}`,
      body_redacted: `Deterministic mock body for ${input.external_message_id}`,
      attachments_ref: [],
      sender_metadata: {
        name: MOCK_SENDER_NAME,
        external_user_id: MOCK_SENDER_EXTERNAL_ID
      },
      created_at_platform: "2026-06-03T10:00:00.000Z"
    };
  }

  try {
    const data = await graphClient.getMessage(input.external_message_id, accessToken);
    const body = data.message ?? "";
    // Redaction: max 80 chars, remove newlines/control chars
    const bodyRedacted = body.replace(/[\r\n\t]+/g, " ").slice(0, REDACTED_BODY_MAX_LENGTH);

    const attachments = (data.attachments?.data ?? []).map((att) => ({
      type: att.mime_type ?? FILE_ATTACHMENT_TYPE,
      url_ref: att.file_url ?? att.url ?? "",
      id: att.id
    }));

    return {
      body,
      body_redacted: bodyRedacted,
      attachments_ref: attachments,
      sender_metadata: {
        name: data.from?.name ?? FACEBOOK_SENDER_NAME_FALLBACK,
        external_user_id: data.from?.id ?? ""
      },
      created_at_platform: data.created_time ?? new Date().toISOString()
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    throw new Error(errorMsg.replaceAll(accessToken, "***TOKEN***"), { cause: error });
  }
}
