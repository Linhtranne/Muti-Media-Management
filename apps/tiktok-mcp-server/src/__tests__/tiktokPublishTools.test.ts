import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EnvSecretStore } from "../lib/secretStore.js";
import {
  queryTiktokCreatorInfoHandler,
  validateTiktokPostHandler,
  publishTiktokVideoHandler,
  publishTiktokPhotoHandler,
  getTiktokPublishStatusHandler
} from "../tools/tiktokPublishTools.js";
import { type SecretStore } from "../lib/secretStore.js";

const TEST_ACCESS_TOKEN = "test-access-token";

const testSecretStore: SecretStore = {
  async storeSecret() {
    return "secret-ref";
  },
  async resolveSecret() {
    return TEST_ACCESS_TOKEN;
  },
  async resolveSecretForChannel() {
    return TEST_ACCESS_TOKEN;
  }
};

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
  headers: HeadersInit | undefined;
}

function installFetchMock(responseBody: Record<string, unknown>, calls: FetchCall[], ok = true, status = 200) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const bodyText = typeof init?.body === "string" ? init.body : "{}";
    calls.push({
      url: urlText,
      body: JSON.parse(bodyText) as Record<string, unknown>,
      headers: init?.headers
    });
    return {
      ok,
      status,
      async json() {
        return responseBody;
      },
      async text() {
        return JSON.stringify(responseBody);
      }
    } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("TikTok MCP Server Tools", () => {
  const secretStore = new EnvSecretStore();
  const originalMockMode = process.env.TIKTOK_MOCK_MODE;

  it("validateTiktokPostHandler checks body length and token boundary", async () => {
    process.env.TIKTOK_MOCK_MODE = "true";
    // Happy path validation
    const validResult = await validateTiktokPostHandler({
      variantRef: {
        variantId: "00000000-0000-0000-0000-000000000000",
        bodyLength: 200,
        hashtagCount: 5,
        hasMedia: true
      },
      channelAccountId: "ca-1",
      workspaceId: "ws-1"
    }, secretStore);

    assert.strictEqual(validResult.passed, true);
    assert.strictEqual(validResult.violations.length, 0);

    // Body length too long
    const tooLongResult = await validateTiktokPostHandler({
      variantRef: {
        variantId: "00000000-0000-0000-0000-000000000000",
        bodyLength: 3000, // exceeds 2200 limit
        hashtagCount: 5,
        hasMedia: true
      },
      channelAccountId: "ca-1",
      workspaceId: "ws-1"
    }, secretStore);
    assert.strictEqual(tooLongResult.passed, false);
    assert.strictEqual(tooLongResult.violations[0].code, "PLATFORM_TEXT_TOO_LONG");
  });

  it("publishTiktokVideoHandler mock publishing success and failure", async () => {
    process.env.TIKTOK_MOCK_MODE = "true";
    // Happy path video
    const successResult = await publishTiktokVideoHandler({
      jobRef: { jobId: "00000000-0000-0000-0000-000000000000" },
      channelAccountId: "ca-1",
      workspaceId: "ws-1",
      content: {
        title: "Behold this fine video",
        videoUrl: "https://r2.example.com/videos/v.mp4",
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    }, secretStore);
    assert.strictEqual(successResult.passed, true);
    assert.strictEqual(successResult.status, "PROCESSING");
    assert.ok(successResult.tiktokRequestId?.startsWith("mock-req-video-"));

    // Failure path video
    const failResult = await publishTiktokVideoHandler({
      jobRef: { jobId: "00000000-0000-0000-0000-000000000000" },
      channelAccountId: "ca-1",
      workspaceId: "ws-1",
      content: {
        title: "Test mock-fail video",
        videoUrl: "https://r2.example.com/videos/v.mp4",
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    }, secretStore);
    assert.strictEqual(failResult.passed, false);
    assert.strictEqual(failResult.status, "FAILED");
    assert.strictEqual(failResult.errors?.[0].code, "PLATFORM_ERROR");
  });

  it("publishTiktokPhotoHandler mock publishing success and failure", async () => {
    process.env.TIKTOK_MOCK_MODE = "true";
    // Happy path photo
    const successResult = await publishTiktokPhotoHandler({
      jobRef: { jobId: "00000000-0000-0000-0000-000000000000" },
      channelAccountId: "ca-1",
      workspaceId: "ws-1",
      content: {
        title: "Test Photo Carousel",
        description: "Behold this fine carousel",
        imageUrls: ["https://r2.example.com/images/1.png"],
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    }, secretStore);
    assert.strictEqual(successResult.passed, true);
    assert.strictEqual(successResult.status, "PROCESSING");
    assert.ok(successResult.tiktokRequestId?.startsWith("mock-req-photo-"));

    // Failure path photo
    const failResult = await publishTiktokPhotoHandler({
      jobRef: { jobId: "00000000-0000-0000-0000-000000000000" },
      channelAccountId: "ca-1",
      workspaceId: "ws-1",
      content: {
        title: "Test mock-fail photo",
        imageUrls: ["https://r2.example.com/images/1.png"],
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    }, secretStore);
    assert.strictEqual(failResult.passed, false);
    assert.strictEqual(failResult.status, "FAILED");
    assert.strictEqual(failResult.errors?.[0].code, "PLATFORM_ERROR");
  });

  it("getTiktokPublishStatusHandler checks status polling states", async () => {
    process.env.TIKTOK_MOCK_MODE = "true";
    // Published status
    const publishedResult = await getTiktokPublishStatusHandler({
      channelAccountId: "ca-1",
      workspaceId: "ws-1",
      tiktokRequestId: "mock-req-video-123"
    }, secretStore);
    assert.strictEqual(publishedResult.passed, true);
    assert.strictEqual(publishedResult.status, "PUBLISHED");
    assert.strictEqual(publishedResult.externalPostId, "tiktok-post-video-123");

    // Processing status
    const processingResult = await getTiktokPublishStatusHandler({
      channelAccountId: "ca-1",
      workspaceId: "ws-1",
      tiktokRequestId: "mock-req-pending-video-123"
    }, secretStore);
    assert.strictEqual(processingResult.passed, true);
    assert.strictEqual(processingResult.status, "PROCESSING");

    // Failed status
    const failedResult = await getTiktokPublishStatusHandler({
      channelAccountId: "ca-1",
      workspaceId: "ws-1",
      tiktokRequestId: "mock-req-fail-video-123"
    }, secretStore);
    assert.strictEqual(failedResult.passed, false);
    assert.strictEqual(failedResult.status, "FAILED");
    assert.strictEqual(failedResult.errors?.[0].code, "PROCESSING_FAILED");
  });

  it("queries TikTok creator info through the official endpoint", async () => {
    process.env.TIKTOK_MOCK_MODE = "false";
    const calls: FetchCall[] = [];
    const restoreFetch = installFetchMock({
      data: {
        creator_username: "creator",
        privacy_level_options: ["SELF_ONLY"],
        comment_disabled: false
      },
      error: { code: "ok", message: "", log_id: "log-1" }
    }, calls);

    try {
      const result = await queryTiktokCreatorInfoHandler({
        channelAccountId: "ca-1",
        workspaceId: "ws-1"
      }, testSecretStore);

      assert.equal(result.passed, true);
      assert.equal(calls[0].url, "https://open.tiktokapis.com/v2/post/publish/creator_info/query/");
      assert.deepEqual(calls[0].body, {});
    } finally {
      restoreFetch();
    }
  });

  it("publishes video with official Direct Post body fields", async () => {
    process.env.TIKTOK_MOCK_MODE = "false";
    const calls: FetchCall[] = [];
    const restoreFetch = installFetchMock({
      data: { publish_id: "v_pub_123" },
      error: { code: "ok", message: "", log_id: "log-1" }
    }, calls);

    try {
      const result = await publishTiktokVideoHandler({
        jobRef: { jobId: "00000000-0000-0000-0000-000000000000" },
        channelAccountId: "ca-1",
        workspaceId: "ws-1",
        content: {
          title: "Video title",
          videoUrl: "https://media.example.com/video.mp4",
          privacyLevel: "SELF_ONLY",
          brandContentToggle: false,
          brandOrganicToggle: false
        }
      }, testSecretStore);

      assert.equal(result.passed, true);
      assert.equal(calls[0].url, "https://open.tiktokapis.com/v2/post/publish/video/init/");
      assert.deepEqual(calls[0].body, {
        post_info: {
          title: "Video title",
          privacy_level: "SELF_ONLY",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          brand_content_toggle: false,
          brand_organic_toggle: false
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: "https://media.example.com/video.mp4"
        }
      });
    } finally {
      restoreFetch();
    }
  });

  it("publishes photos with official content init body fields", async () => {
    process.env.TIKTOK_MOCK_MODE = "false";
    const calls: FetchCall[] = [];
    const restoreFetch = installFetchMock({
      data: { publish_id: "p_pub_123" },
      error: { code: "ok", message: "", log_id: "log-1" }
    }, calls);

    try {
      const result = await publishTiktokPhotoHandler({
        jobRef: { jobId: "00000000-0000-0000-0000-000000000000" },
        channelAccountId: "ca-1",
        workspaceId: "ws-1",
        content: {
          description: "Photo description",
          imageUrls: ["https://media.example.com/1.png"],
          privacyLevel: "SELF_ONLY",
          brandContentToggle: false,
          brandOrganicToggle: false
        }
      }, testSecretStore);

      assert.equal(result.passed, true);
      assert.equal(calls[0].url, "https://open.tiktokapis.com/v2/post/publish/content/init/");
      assert.deepEqual(calls[0].body, {
        post_info: {
          description: "Photo description",
          privacy_level: "SELF_ONLY",
          disable_comment: false,
          brand_content_toggle: false,
          brand_organic_toggle: false
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: ["https://media.example.com/1.png"],
          photo_cover_index: 0
        },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
        auto_add_music: false
      });
    } finally {
      restoreFetch();
    }
  });

  it("maps official TikTok publish status values", async () => {
    process.env.TIKTOK_MOCK_MODE = "false";
    const calls: FetchCall[] = [];
    const restoreFetch = installFetchMock({
      data: {
        status: "PUBLISH_COMPLETE",
        publicaly_available_post_id: [123456789]
      },
      error: { code: "ok", message: "", log_id: "log-1" }
    }, calls);

    try {
      const result = await getTiktokPublishStatusHandler({
        channelAccountId: "ca-1",
        workspaceId: "ws-1",
        tiktokRequestId: "publish-123"
      }, testSecretStore);

      assert.equal(result.passed, true);
      assert.equal(result.status, "PUBLISHED");
      assert.equal(result.externalPostId, "123456789");
      assert.equal(calls[0].url, "https://open.tiktokapis.com/v2/post/publish/status/fetch/");
      assert.deepEqual(calls[0].body, { publish_id: "publish-123" });
    } finally {
      restoreFetch();
      process.env.TIKTOK_MOCK_MODE = originalMockMode;
    }
  });
});
