import { type ReplyCommentInput, type ReplyCommentResult } from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

// Basic wrapper for testability
interface GraphCommentResult {
  id: string;
}

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    type?: string;
  };
}

interface GraphCommentError extends Error {
  code?: number;
  type?: string;
  status?: number;
}

export interface GraphCommentClient {
  postComment(commentId: string, accessToken: string, message: string): Promise<GraphCommentResult>;
}

export class DefaultGraphCommentClient implements GraphCommentClient {
  async postComment(commentId: string, accessToken: string, message: string): Promise<GraphCommentResult> {
    const url = new URL(`https://graph.facebook.com/v20.0/${commentId}/comments`);
    
    const body: Record<string, string> = {
      message,
      access_token: accessToken
    };
    
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json() as GraphCommentResult & GraphErrorBody;
    
    if (!response.ok) {
      const errorObj = new Error(data.error?.message ?? 'Graph API Error') as GraphCommentError;
      errorObj.code = data.error?.code;
      errorObj.type = data.error?.type;
      errorObj.status = response.status;
      throw errorObj;
    }

    return data;
  }
}

export async function replyCommentHandler(
  input: ReplyCommentInput,
  secretStore: SecretStore,
  graphClient: GraphCommentClient = new DefaultGraphCommentClient()
): Promise<ReplyCommentResult> {
  let accessToken: string;
  try {
    const sanitizedId = input.channelAccountId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
    const mockAccessToken = process.env.MOCK_ACCESS_TOKEN;
    accessToken = mockAccessToken && mockAccessToken.length > 0
      ? mockAccessToken
      : await secretStore.resolveSecret(`env:FACEBOOK_CHANNEL_${sanitizedId}_TOKEN`);
  } catch {
    return { success: false, error: `Failed to resolve credentials.` };
  }

  if (process.env.FACEBOOK_MOCK_MODE === "true") {
    return {
      success: true,
      external_reply_id: `mock-comment-reply-${input.external_comment_id}`
    };
  }

  try {
    const data = await graphClient.postComment(
      input.external_comment_id,
      accessToken,
      input.message
    );

    return {
      success: true,
      external_reply_id: data.id,
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMsg.replaceAll(accessToken, '***TOKEN***') };
  }
}
