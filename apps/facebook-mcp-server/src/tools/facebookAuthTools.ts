import { 
  type ExchangeCodePayload, 
  type ExchangeCodeResult, 
  type ConnectPagePayload, 
  type ConnectPageResult,
  type TokenHealthCheckPayload,
  type TokenHealthCheckResult 
} from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

const FB_GRAPH_VERSION = "v22.0";
const FACEBOOK_INVALID_TOKEN_CODE = 190;
const MISSING_PERMISSION_CODE = 10;
const MOCK_PAGE_ID = "mock-facebook-page-001";
const MOCK_PAGE_NAME = "MediaOps Mock Facebook Page";

function isFacebookMockMode(): boolean {
  return process.env.FACEBOOK_MOCK_MODE === "true";
}

function requiredMockScopes(): string[] {
  return (process.env.FACEBOOK_REQUIRED_SCOPES ??
    "pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

interface GraphErrorResponse {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
}

interface GraphTokenResponse extends GraphErrorResponse {
  access_token?: string;
}

interface GraphPageListResponse extends GraphErrorResponse {
  data?: Array<{
    id: string;
    name: string;
  }>;
}

interface GraphPageResponse extends GraphErrorResponse {
  id?: string;
  name?: string;
  access_token?: string;
}

interface GraphDebugTokenResponse extends GraphErrorResponse {
  data?: {
    scopes?: string[];
  };
}

interface GraphPermissionResponse extends GraphErrorResponse {
  data?: Array<{
    permission: string;
    status: string;
  }>;
}

async function readGraphJson<T extends GraphErrorResponse>(response: Response): Promise<T> {
  return await response.json() as T;
}

function graphErrorMessage(data: GraphErrorResponse): string {
  return data.error?.message ?? "Unknown error";
}

/**
 * Exchanges an OAuth code for a short-lived user access token,
 * retrieves the long-lived user access token, 
 * and fetches the list of pages the user manages.
 */
export async function exchangeCodeAndListPages(
  input: ExchangeCodePayload,
  secretStore: SecretStore
): Promise<ExchangeCodeResult> {
  if (isFacebookMockMode()) {
    const userTokenRef = await secretStore.storeSecret(
      input.workspaceId,
      "MOCK_USER_TOKEN",
      `mock-user-token-${input.workspaceId}`
    );

    return {
      pages: [{ pageId: MOCK_PAGE_ID, displayName: MOCK_PAGE_NAME }],
      userTokenRef
    };
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET in environment");
  }

  // 1. Exchange code for short-lived user token
  const tokenUrl = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.append("client_id", appId);
  tokenUrl.searchParams.append("redirect_uri", input.redirectUri);
  tokenUrl.searchParams.append("client_secret", appSecret);
  tokenUrl.searchParams.append("code", input.authCode);

  const tokenRes = await fetch(tokenUrl.toString());
  const tokenData = await readGraphJson<GraphTokenResponse>(tokenRes);

  if (!tokenRes.ok) {
    throw new Error(`Failed to exchange code: ${graphErrorMessage(tokenData)}`);
  }

  if (!tokenData.access_token) {
    throw new Error("Failed to exchange code: access token missing");
  }

  const shortLivedToken = tokenData.access_token;

  // 2. Exchange for long-lived user token
  const longTokenUrl = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`);
  longTokenUrl.searchParams.append("grant_type", "fb_exchange_token");
  longTokenUrl.searchParams.append("client_id", appId);
  longTokenUrl.searchParams.append("client_secret", appSecret);
  longTokenUrl.searchParams.append("fb_exchange_token", shortLivedToken);

  const longTokenRes = await fetch(longTokenUrl.toString());
  const longTokenData = await readGraphJson<GraphTokenResponse>(longTokenRes);

  if (!longTokenRes.ok) {
    throw new Error(`Failed to get long-lived token: ${graphErrorMessage(longTokenData)}`);
  }

  if (!longTokenData.access_token) {
    throw new Error("Failed to get long-lived token: access token missing");
  }

  const longLivedUserToken = longTokenData.access_token;

  // 3. Temporarily store the long-lived user token in secret store so connect_page can use it
  const userTokenRef = await secretStore.storeSecret(
    input.workspaceId,
    "USER_TOKEN_TEMP",
    longLivedUserToken
  );

  // 4. Fetch user's pages
  const pagesUrl = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/me/accounts`);
  pagesUrl.searchParams.append("access_token", longLivedUserToken);

  const pagesRes = await fetch(pagesUrl.toString());
  const pagesData = await readGraphJson<GraphPageListResponse>(pagesRes);

  if (!pagesRes.ok) {
    throw new Error(`Failed to list pages: ${graphErrorMessage(pagesData)}`);
  }

  const pages = (pagesData.data ?? []).map((page) => ({
    pageId: page.id,
    displayName: page.name,
  }));

  return {
    pages,
    userTokenRef
  };
}

/**
 * Connects a specific page by retrieving its permanent Page Access Token
 * and storing it securely in the SecretStore.
 */
export async function connectPage(
  input: ConnectPagePayload,
  secretStore: SecretStore
): Promise<ConnectPageResult> {
  if (isFacebookMockMode()) {
    await secretStore.resolveSecret(input.userTokenRef);
    const secretRef = await secretStore.storeSecret(
      input.workspaceId,
      `MOCK_PAGE_TOKEN_${input.pageId}`,
      `mock-page-token-${input.pageId}`
    );

    return {
      externalAccountId: input.pageId,
      displayName: input.pageId === MOCK_PAGE_ID ? MOCK_PAGE_NAME : `Mock Page ${input.pageId}`,
      scopes: requiredMockScopes(),
      expiresAt: null,
      secretRef
    };
  }

  const userToken = await secretStore.resolveSecret(input.userTokenRef);

  // Get the page access token (using the long-lived user token gets a never-expiring page token)
  const pageUrl = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${input.pageId}`);
  pageUrl.searchParams.append("fields", "access_token,name,tasks");
  pageUrl.searchParams.append("access_token", userToken);

  const pageRes = await fetch(pageUrl.toString());
  const pageData = await readGraphJson<GraphPageResponse>(pageRes);

  if (!pageRes.ok) {
    throw new Error(`Failed to fetch page access token: ${graphErrorMessage(pageData)}`);
  }

  const pageAccessToken = pageData.access_token;
  
  if (!pageAccessToken) {
    throw new Error("No page access token returned. Check user permissions.");
  }

  // Check what permissions/tasks we have. Note: Tasks like CREATE_CONTENT indicate manage_posts
  // We can fetch debug_token to get exact scopes
  const debugTokenUrl = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/debug_token`);
  debugTokenUrl.searchParams.append("input_token", pageAccessToken);
  debugTokenUrl.searchParams.append("access_token", userToken); // using user token to debug page token

  const debugRes = await fetch(debugTokenUrl.toString());
  const debugData = await readGraphJson<GraphDebugTokenResponse>(debugRes);

  const scopes = debugData.data?.scopes ?? [];
  
  // Store the page token
  const secretRef = await secretStore.storeSecret(
    input.workspaceId,
    `PAGE_TOKEN_${input.pageId}`,
    pageAccessToken
  );

  return {
    externalAccountId: pageData.id ?? input.pageId,
    displayName: pageData.name ?? input.pageId,
    scopes,
    expiresAt: null, // Page tokens obtained from long-lived user tokens do not expire
    secretRef
  };
}

/**
 * Validates the health of a page access token.
 */
export async function healthCheckToken(
  input: TokenHealthCheckPayload,
  secretStore: SecretStore
): Promise<TokenHealthCheckResult> {
  if (isFacebookMockMode()) {
    await secretStore.resolveSecret(input.secretRef);
    return {
      status: "valid",
      lastCheckedAt: new Date().toISOString()
    };
  }

  let token: string;
  try {
    token = await secretStore.resolveSecret(input.secretRef);
  } catch {
    return {
      status: "unknown",
      lastCheckedAt: new Date().toISOString()
    };
  }

  // Use debug_token if possible, or just call /me?fields=id,permissions
  const checkUrl = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/me/permissions`);
  checkUrl.searchParams.append("access_token", token);

  const res = await fetch(checkUrl.toString());
  const data = await readGraphJson<GraphPermissionResponse>(res);

  if (!res.ok) {
    const code = data.error?.code;
    const subcode = data.error?.error_subcode;
    
    // Check if expired or invalidated
    if (code === FACEBOOK_INVALID_TOKEN_CODE) {
      return {
        status: "expired",
        lastCheckedAt: new Date().toISOString(),
        permissionErrorCode: subcode
      };
    }

    return {
      status: "unknown",
      lastCheckedAt: new Date().toISOString(),
      permissionErrorCode: code
    };
  }

  // Check scopes
  const permissions = data.data ?? [];
  const grantedScopes = new Set(
    permissions
      .filter((permission) => permission.status === "granted")
      .map((permission) => permission.permission)
  );
  
  const missingScopes = input.requiredScopes.filter(scope => !grantedScopes.has(scope));

  if (missingScopes.length > 0) {
    return {
      status: "missing_permissions",
      missingScopes,
      lastCheckedAt: new Date().toISOString(),
      permissionErrorCode: MISSING_PERMISSION_CODE
    };
  }

  return {
    status: "valid",
    lastCheckedAt: new Date().toISOString()
  };
}
