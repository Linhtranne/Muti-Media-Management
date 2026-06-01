import { PublishPostInput, PublishPostResult, McpPublishError } from "@mediaops/shared-contracts";
import { SecretStore } from "../lib/secretStore.js";

// Basic wrapper for testability
export interface GraphClient {
  postFeed(pageId: string, accessToken: string, message: string, link?: string): Promise<any>;
}

export class DefaultGraphClient implements GraphClient {
  async postFeed(pageId: string, accessToken: string, message: string, link?: string): Promise<any> {
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

    const data = await response.json();
    
    if (!response.ok) {
      const errorObj = new Error(data.error?.message || 'Graph API Error');
      (errorObj as any).code = data.error?.code;
      (errorObj as any).type = data.error?.type;
      (errorObj as any).status = response.status;
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
  } catch (error: any) {
    errors.push({
      code: "SECRET_UNAVAILABLE",
      detail: `Failed to resolve credentials: ${error.message}`
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
  } catch (error: any) {
    // Map Graph errors
    const status = error.status;
    const code = error.code;
    const errorType = error.type;
    
    let mappedCode: McpPublishError["code"] = "UNKNOWN_ERROR";
    
    if (status === 401 || status === 403 || code === 190 || code === 463 || errorType === 'OAuthException') {
      mappedCode = "PLATFORM_AUTH_FAILED";
    } else if (code === 200 || code === 214) { // Permission errors
      mappedCode = "PLATFORM_PERMISSION_DENIED";
    } else if (code === 4 || code === 17 || code === 341) {
      mappedCode = "PLATFORM_RATE_LIMIT";
    } else if (status === 400) {
      mappedCode = "PLATFORM_VALIDATION_ERROR";
    } else if (status >= 500) {
      mappedCode = "PLATFORM_TRANSIENT_ERROR";
    } else if (error.cause?.code === 'ECONNRESET' || error.cause?.code === 'ETIMEDOUT') {
      mappedCode = "PLATFORM_TRANSIENT_ERROR";
    }

    errors.push({
      code: mappedCode,
      // Sanitized detail, avoid raw string if it contains tokens, but FB error messages typically don't.
      // We will ensure we don't leak token.
      detail: (error.message || 'Unknown error').replace(accessToken, '***TOKEN***')
    });

    return { passed: false, errors };
  }
}
