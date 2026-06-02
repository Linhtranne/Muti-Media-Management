import { type SyncCommentsInput, type SyncCommentsResult, type SanitizedComment, type CommentSyncError } from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

interface GraphComment {
  id: string;
  message: string;
  from?: {
    name: string;
    id?: string;
  };
  permalink_url?: string;
  created_time: string;
}

interface GraphCommentsResponse {
  data: GraphComment[];
  error?: {
    message?: string;
    code?: number;
    type?: string;
    error_subcode?: number;
  };
}

export interface GraphSyncCommentsClient {
  getComments(externalPostId: string, accessToken: string): Promise<GraphCommentsResponse>;
}

export class DefaultGraphSyncCommentsClient implements GraphSyncCommentsClient {
  async getComments(externalPostId: string, accessToken: string): Promise<GraphCommentsResponse> {
    const url = new URL(`https://graph.facebook.com/v20.0/${externalPostId}/comments`);
    url.searchParams.set("fields", "id,message,from,permalink_url,created_time");
    url.searchParams.set("access_token", accessToken);
    // Note: We might want pagination in the future, but for MVP fetching the first page or setting a high limit is fine
    url.searchParams.set("limit", "100");

    const response = await fetch(url.toString(), {
      method: "GET"
    });

    const data = await response.json() as GraphCommentsResponse;
    
    // Allow non-200 to be returned so we can inspect data.error in the handler
    if (!response.ok && !data.error) {
       data.error = { message: `HTTP ${response.status} ${response.statusText}`, code: -1 };
    }
    
    return data;
  }
}

export async function syncCommentsHandler(
  input: SyncCommentsInput,
  secretStore: SecretStore,
  graphClient: GraphSyncCommentsClient = new DefaultGraphSyncCommentsClient()
): Promise<SyncCommentsResult> {
  let accessToken: string;
  try {
    const mockAccessToken = process.env.MOCK_ACCESS_TOKEN;
    accessToken = mockAccessToken && mockAccessToken.length > 0
      ? mockAccessToken
      : await secretStore.resolveSecret(input.secretRef);
  } catch {
    return {
      passed: false,
      errors: [{ code: 'SECRET_UNAVAILABLE', detail: 'Failed to resolve Facebook access token.' }]
    };
  }

  try {
    const response = await graphClient.getComments(input.externalPostId, accessToken);

    if (response.error) {
      return {
        passed: false,
        errors: [mapGraphError(response.error)]
      };
    }

    const sanitizedComments: SanitizedComment[] = (response.data || []).map(c => ({
      externalId: c.id,
      authorName: c.from?.name || "Unknown",
      externalUserId: c.from?.id,
      body: c.message || "",
      // Fallback to constructing a permalink if the API doesn't provide it
      permalink: c.permalink_url || `https://facebook.com/${c.id}`,
      createdAtPlatform: c.created_time
    }));

    return {
      passed: true,
      comments: sanitizedComments
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      passed: false,
      errors: [{ code: 'UNKNOWN_ERROR', detail: message.replaceAll(accessToken, '***TOKEN***') }]
    };
  }
}

function mapGraphError(error: NonNullable<GraphCommentsResponse["error"]>): CommentSyncError {
  const code = error.code || 0;
  
  // Rate limit heuristics
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return { code: 'PLATFORM_RATE_LIMIT', detail: error.message || 'Rate limited' };
  }
  
  // Auth failures
  if (code === 190 || code === 102) {
    return { code: 'PLATFORM_AUTH_FAILED', detail: error.message || 'Session expired or invalid' };
  }
  
  // Permission denied
  if (code === 200 || code === 10) {
    return { code: 'PLATFORM_PERMISSION_DENIED', detail: error.message || 'Insufficient permissions' };
  }
  
  // Transient/Network
  if (code === 1 || code === 2) {
    return { code: 'PLATFORM_TRANSIENT_ERROR', detail: error.message || 'Temporary platform error' };
  }

  return { code: 'UNKNOWN_ERROR', detail: error.message || 'Unmapped Graph API error' };
}
