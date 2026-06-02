import { type PublishPostInput, type PublishPostResult, type McpPublishError } from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

// Basic wrapper for testability
interface GraphFeedPostResult {
  id: string;
}

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    type?: string;
  };
}

interface GraphPublishError extends Error {
  code?: number;
  type?: string;
  status?: number;
  cause?: {
    code?: string;
  };
}

const FACEBOOK_INVALID_TOKEN_CODE = 190;
const FACEBOOK_TOKEN_EXPIRED_CODE = 463;
const FACEBOOK_PERMISSION_ERROR_CODE = 200;
const FACEBOOK_PERMISSION_DENIED_CODE = 214;
const FACEBOOK_APP_RATE_LIMIT_CODE = 4;
const FACEBOOK_USER_RATE_LIMIT_CODE = 17;
const FACEBOOK_APP_THROTTLE_CODE = 341;

export interface GraphClient {
  postFeed(pageId: string, accessToken: string, message: string, link?: string): Promise<GraphFeedPostResult>;
}

export class DefaultGraphClient implements GraphClient {
  async postFeed(pageId: string, accessToken: string, message: string, link?: string): Promise<GraphFeedPostResult> {
    const url = new URL(`https://graph.facebook.com/v20.0/${pageId}/feed`);
    
    const body: Record<string, string> = {
      message,
      access_token: accessToken
    };
    
    if (link) {
      body.link = link;
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json() as GraphFeedPostResult & GraphErrorBody;
    
    if (!response.ok) {
      const errorObj = new Error(data.error?.message ?? 'Graph API Error') as GraphPublishError;
      errorObj.code = data.error?.code;
      errorObj.type = data.error?.type;
      errorObj.status = response.status;
      throw errorObj;
    }

    return data;
  }
}

export async function publishPostHandler(
  input: PublishPostInput,
  secretStore: SecretStore,
  graphClient: GraphClient = new DefaultGraphClient()
): Promise<PublishPostResult> {
  const errors: McpPublishError[] = [];

  let accessToken: string;
  try {
    accessToken = await secretStore.resolveSecret(input.secretRef);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown credential error";
    errors.push({
      code: "SECRET_UNAVAILABLE",
      detail: `Failed to resolve credentials: ${message}`
    });
    return { passed: false, errors };
  }

  // Build message
  let message = input.content.body;
  if (input.content.hashtags && input.content.hashtags.length > 0) {
    message += '\n\n' + input.content.hashtags.join(' ');
  }

  try {
    const data = await graphClient.postFeed(
      input.channelAccountId,
      accessToken,
      message,
      input.content.link
    );

    return {
      passed: true,
      externalPostId: data.id,
      publishedAt: new Date().toISOString(),
      platformResponseSummary: {
        id: data.id
      }
    };
  } catch (error: unknown) {
    const graphError = error as GraphPublishError;
    // Map Graph errors
    const status = graphError.status;
    const code = graphError.code;
    const errorType = graphError.type;
    
    let mappedCode: McpPublishError["code"] = "UNKNOWN_ERROR";
    
    if (status === 401 || status === 403 || code === FACEBOOK_INVALID_TOKEN_CODE || code === FACEBOOK_TOKEN_EXPIRED_CODE || errorType === 'OAuthException') {
      mappedCode = "PLATFORM_AUTH_FAILED";
    } else if (code === FACEBOOK_PERMISSION_ERROR_CODE || code === FACEBOOK_PERMISSION_DENIED_CODE) {
      mappedCode = "PLATFORM_PERMISSION_DENIED";
    } else if (code === FACEBOOK_APP_RATE_LIMIT_CODE || code === FACEBOOK_USER_RATE_LIMIT_CODE || code === FACEBOOK_APP_THROTTLE_CODE) {
      mappedCode = "PLATFORM_RATE_LIMIT";
    } else if (status === 400) {
      mappedCode = "PLATFORM_VALIDATION_ERROR";
    } else if (status !== undefined && status >= 500) {
      mappedCode = "PLATFORM_TRANSIENT_ERROR";
    } else if (graphError.cause?.code === 'ECONNRESET' || graphError.cause?.code === 'ETIMEDOUT') {
      mappedCode = "PLATFORM_TRANSIENT_ERROR";
    }

    errors.push({
      code: mappedCode,
      // Sanitized detail, avoid raw string if it contains tokens, but FB error messages typically don't.
      // We will ensure we don't leak token.
      detail: (graphError.message || 'Unknown error').replaceAll(accessToken, '***TOKEN***')
    });

    return { passed: false, errors };
  }
}
