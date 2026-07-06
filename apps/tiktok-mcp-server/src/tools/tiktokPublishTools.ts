import {
  type PublishTiktokVideoInput,
  type PublishTiktokPhotoInput,
  type PublishTiktokResult,
  type GetTiktokPublishStatusInput,
  type GetTiktokPublishStatusResult,
  type ValidateTiktokPostInput,
  type ValidatePostResult,
  type McpViolationCode,
  type McpWarningCode,
  type QueryTiktokCreatorInfoInput,
  type QueryTiktokCreatorInfoResult
} from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

const TIKTOK_MAX_LENGTH = 2200;
const TIKTOK_MAX_HASHTAGS = 30;
const MOCK_REQ_PREFIX_LENGTH = 9;

interface CreatorInfoData {
  creator_avatar_url?: string;
  creator_nickname?: string;
  creator_username?: string;
  privacy_level_options?: ("PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY")[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_duration_in_seconds?: number;
}

interface PublishInitData {
  publish_id?: string;
}

interface FetchStatusData {
  status?: "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED";
  fail_reason?: string;
  publicaly_available_post_id?: Array<string | number>;
}

interface TiktokApiResponse {
  data?: CreatorInfoData & PublishInitData & FetchStatusData;
  error?: {
    code: string;
    message: string;
    log_id: string;
  };
}

const ERROR_DETAIL_MAX_LENGTH = 600;

function sanitizeProviderText(text: string): string {
  const withoutUrlSecrets = text.replace(/https?:\/\/[^\s"']+/gi, (match) => {
    try {
      const url = new URL(match);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return match;
    }
  });

  return withoutUrlSecrets
    .replace(/((?:access_)?token|refresh_token|authorization|signature|client_secret|secret)=([^&\s"']+)/gi, "$1=[REDACTED]")
    .slice(0, ERROR_DETAIL_MAX_LENGTH);
}

function errorMessage(error: unknown): string {
  return sanitizeProviderText(error instanceof Error ? error.message : "Unknown error");
}

async function callTiktokApi(endpoint: string, accessToken: string, body: Record<string, unknown>): Promise<TiktokApiResponse> {
  const url = `https://open.tiktokapis.com${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = sanitizeProviderText(await response.text());
    throw new Error(`TIKTOK_HTTP_ERROR: HTTP status ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as TiktokApiResponse;

  if (data.error && data.error.code !== "ok" && data.error.code !== "0") {
    throw new Error(`TIKTOK_API_ERROR: ${data.error.code} - ${sanitizeProviderText(data.error.message)} (log_id: ${data.error.log_id})`);
  }
  return data;
}

export async function queryTiktokCreatorInfoHandler(
  input: QueryTiktokCreatorInfoInput,
  secretStore: SecretStore
): Promise<QueryTiktokCreatorInfoResult> {
  let accessToken: string;
  try {
    accessToken = await secretStore.resolveSecretForChannel(input.workspaceId, input.channelAccountId);
  } catch (error: unknown) {
    return {
      passed: false,
      errors: [{ code: "SECRET_UNAVAILABLE", detail: errorMessage(error) }]
    };
  }

  if (!accessToken) {
    return {
      passed: false,
      errors: [{ code: "PLATFORM_TOKEN_INVALID", detail: "Resolved access token is empty" }]
    };
  }

  if (process.env.TIKTOK_MOCK_MODE === "true") {
    return {
      passed: true,
      creatorInfo: {
        creator_avatar_url: "https://example.com/avatar.jpg",
        creator_nickname: "Mock Creator",
        creator_username: "mock_creator",
        privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"],
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
        max_video_duration_in_seconds: 600
      }
    };
  }

  try {
    const res = await callTiktokApi("/v2/post/publish/creator_info/query/", accessToken, {});
    const creatorInfo = res.data;
    if (!creatorInfo) {
      throw new Error("Empty data block returned from TikTok creator_info API");
    }
    return {
      passed: true,
      creatorInfo: {
        creator_avatar_url: creatorInfo.creator_avatar_url,
        creator_nickname: creatorInfo.creator_nickname,
        creator_username: creatorInfo.creator_username,
        privacy_level_options: creatorInfo.privacy_level_options || [],
        comment_disabled: creatorInfo.comment_disabled,
        duet_disabled: creatorInfo.duet_disabled,
        stitch_disabled: creatorInfo.stitch_disabled,
        max_video_duration_in_seconds: creatorInfo.max_video_duration_in_seconds
      }
    };
  } catch (error: unknown) {
    return {
      passed: false,
      errors: [{ code: "PLATFORM_ERROR", detail: errorMessage(error) }]
    };
  }
}

export async function validateTiktokPostHandler(
  input: ValidateTiktokPostInput,
  secretStore: SecretStore
): Promise<ValidatePostResult> {
  const violations: { code: McpViolationCode; detail: string }[] = [];
  const warnings: { code: McpWarningCode; detail: string }[] = [];

  // Query creator info first (required behavior)
  const creatorInfoResult = await queryTiktokCreatorInfoHandler(
    {
      channelAccountId: input.channelAccountId,
      workspaceId: input.workspaceId
    },
    secretStore
  );

  if (!creatorInfoResult.passed || !creatorInfoResult.creatorInfo) {
    violations.push({
      code: "PLATFORM_TOKEN_INVALID",
      detail: `Failed to retrieve TikTok Creator Info: ${creatorInfoResult.errors?.[0]?.detail || "Unknown error"}`
    });
    return {
      passed: false,
      violations,
      warnings,
      checkedAt: new Date().toISOString()
    };
  }

  // 1. Text Length Validation
  if (input.variantRef.bodyLength > TIKTOK_MAX_LENGTH) {
    violations.push({
      code: "PLATFORM_TEXT_TOO_LONG",
      detail: `Body length ${String(input.variantRef.bodyLength)} exceeds TikTok maximum of ${String(TIKTOK_MAX_LENGTH)} characters.`
    });
  }

  // 2. Hashtag Warning
  if (input.variantRef.hashtagCount > TIKTOK_MAX_HASHTAGS) {
    warnings.push({
      code: "HASHTAG_COUNT_HIGH",
      detail: `Hashtag count ${String(input.variantRef.hashtagCount)} exceeds recommended maximum of ${String(TIKTOK_MAX_HASHTAGS)}.`
    });
  }

  // 3. Privacy Option Validation
  if (input.privacyLevel) {
    const allowedOptions = creatorInfoResult.creatorInfo.privacy_level_options;
    if (!allowedOptions.includes(input.privacyLevel)) {
      violations.push({
        code: "PLATFORM_PERMISSION_MISSING",
        detail: `Privacy level '${input.privacyLevel}' is not supported by this creator. Allowed options: ${allowedOptions.join(", ")}`
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    checkedAt: new Date().toISOString()
  };
}

export async function publishTiktokVideoHandler(
  input: PublishTiktokVideoInput,
  secretStore: SecretStore
): Promise<PublishTiktokResult> {
  let accessToken: string;
  try {
    accessToken = await secretStore.resolveSecretForChannel(input.workspaceId, input.channelAccountId);
  } catch (error: unknown) {
    return {
      passed: false,
      status: "FAILED",
      errors: [{ code: "SECRET_UNAVAILABLE", detail: errorMessage(error) }]
    };
  }

  if (!accessToken) {
    return {
      passed: false,
      status: "FAILED",
      errors: [{ code: "SECRET_UNAVAILABLE", detail: "Resolved access token is empty" }]
    };
  }

  if (process.env.TIKTOK_MOCK_MODE === "true") {
    const success = !input.content.title.includes("mock-fail");
    return {
      passed: success,
      tiktokRequestId: success ? `mock-req-video-${input.jobRef.jobId}` : undefined,
      status: success ? "PROCESSING" : "FAILED",
      errors: success ? undefined : [{ code: "PLATFORM_ERROR", detail: "Mock publish failed" }]
    };
  }

  try {
    const body = {
      post_info: {
        title: input.content.title,
        privacy_level: input.content.privacyLevel ?? "SELF_ONLY",
        disable_duet: input.content.disableDuet ?? false,
        disable_comment: input.content.disableComment ?? false,
        disable_stitch: input.content.disableStitch ?? false,
        brand_content_toggle: input.content.brandContentToggle,
        brand_organic_toggle: input.content.brandOrganicToggle
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: input.content.videoUrl
      }
    };
    const res = await callTiktokApi("/v2/post/publish/video/init/", accessToken, body);
    const publishId = res.data?.publish_id;
    if (!publishId) {
      throw new Error("TikTok API did not return publish_id");
    }
    return {
      passed: true,
      tiktokRequestId: publishId,
      status: "PROCESSING"
    };
  } catch (error: unknown) {
    return {
      passed: false,
      status: "FAILED",
      errors: [{ code: "PLATFORM_ERROR", detail: errorMessage(error) }]
    };
  }
}

export async function publishTiktokPhotoHandler(
  input: PublishTiktokPhotoInput,
  secretStore: SecretStore
): Promise<PublishTiktokResult> {
  let accessToken: string;
  try {
    accessToken = await secretStore.resolveSecretForChannel(input.workspaceId, input.channelAccountId);
  } catch (error: unknown) {
    return {
      passed: false,
      status: "FAILED",
      errors: [{ code: "SECRET_UNAVAILABLE", detail: errorMessage(error) }]
    };
  }

  if (!accessToken) {
    return {
      passed: false,
      status: "FAILED",
      errors: [{ code: "SECRET_UNAVAILABLE", detail: "Resolved access token is empty" }]
    };
  }

  if (process.env.TIKTOK_MOCK_MODE === "true") {
    const mockText = input.content.title ?? input.content.description ?? "";
    const success = !mockText.includes("mock-fail");
    return {
      passed: success,
      tiktokRequestId: success ? `mock-req-photo-${input.jobRef.jobId}` : undefined,
      status: success ? "PROCESSING" : "FAILED",
      errors: success ? undefined : [{ code: "PLATFORM_ERROR", detail: "Mock publish failed" }]
    };
  }

  try {
    const body = {
      post_info: {
        ...(input.content.title ? { title: input.content.title } : {}),
        description: input.content.description ?? "",
        privacy_level: input.content.privacyLevel ?? "SELF_ONLY",
        disable_comment: input.content.disableComment ?? false,
        brand_content_toggle: input.content.brandContentToggle,
        brand_organic_toggle: input.content.brandOrganicToggle
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_images: input.content.imageUrls,
        photo_cover_index: 0
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
      auto_add_music: input.content.autoAddMusic ?? false
    };
    const res = await callTiktokApi("/v2/post/publish/content/init/", accessToken, body);
    const publishId = res.data?.publish_id;
    if (!publishId) {
      throw new Error("TikTok API did not return publish_id");
    }
    return {
      passed: true,
      tiktokRequestId: publishId,
      status: "PROCESSING"
    };
  } catch (error: unknown) {
    return {
      passed: false,
      status: "FAILED",
      errors: [{ code: "PLATFORM_ERROR", detail: errorMessage(error) }]
    };
  }
}

export async function getTiktokPublishStatusHandler(
  input: GetTiktokPublishStatusInput,
  secretStore: SecretStore
): Promise<GetTiktokPublishStatusResult> {
  let accessToken: string;
  try {
    accessToken = await secretStore.resolveSecretForChannel(input.workspaceId, input.channelAccountId);
  } catch (error: unknown) {
    return {
      passed: false,
      status: "FAILED",
      errors: [{ code: "SECRET_UNAVAILABLE", detail: errorMessage(error) }]
    };
  }

  if (!accessToken) {
    return {
      passed: false,
      status: "FAILED",
      errors: [{ code: "SECRET_UNAVAILABLE", detail: "Resolved access token is empty" }]
    };
  }

  if (input.tiktokRequestId.startsWith("mock-req-")) {
    const isFail = input.tiktokRequestId.includes("mock-fail") || input.tiktokRequestId.includes("fail");
    if (isFail) {
      return {
        passed: false,
        status: "FAILED",
        errors: [{ code: "PROCESSING_FAILED", detail: "TikTok processing failed mock error" }]
      };
    }
    const isProcessing = input.tiktokRequestId.includes("pending") || input.tiktokRequestId.includes("processing");
    if (isProcessing) {
      return {
        passed: true,
        status: "PROCESSING"
      };
    }
    return {
      passed: true,
      status: "PUBLISHED",
      externalPostId: `tiktok-post-${input.tiktokRequestId.slice(MOCK_REQ_PREFIX_LENGTH)}`
    };
  }

  try {
    const body = {
      publish_id: input.tiktokRequestId
    };
    const res = await callTiktokApi("/v2/post/publish/status/fetch/", accessToken, body);
    const statusData = res.data;
    if (!statusData) {
      throw new Error("Empty status data block returned from TikTok status API");
    }

    const tiktokStatus = statusData.status;
    let mappedStatus: "PROCESSING" | "PUBLISHED" | "FAILED" = "PROCESSING";

    if (tiktokStatus === "PUBLISH_COMPLETE") {
      mappedStatus = "PUBLISHED";
    } else if (tiktokStatus === "FAILED") {
      mappedStatus = "FAILED";
    }

    const publicPostIds = (statusData.publicaly_available_post_id ?? []).map(String);

    return {
      passed: mappedStatus !== "FAILED",
      status: mappedStatus,
      externalPostId: mappedStatus === "PUBLISHED" ? (publicPostIds[0] ?? `publish_id:${input.tiktokRequestId}`) : undefined,
      errors: mappedStatus === "FAILED" ? [{ code: "PROCESSING_FAILED", detail: statusData.fail_reason || "TikTok processing failed" }] : undefined
    };
  } catch (error: unknown) {
    return {
      passed: false,
      status: "FAILED",
      errors: [{ code: "PLATFORM_ERROR", detail: errorMessage(error) }]
    };
  }
}
