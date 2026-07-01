import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { publishPostHandler } from "../tools/publishPost.js";

const mockSecretStore = {
  resolveSecret: mock.fn(async () => "mock-token")
} as any;

describe("MCP publishPost tool", () => {
  it("returns success when publish succeeds", async () => {
    const mockGraphClient = {
      postFeed: mock.fn(async () => ({ id: "mock-post-id" })),
      postPhoto: mock.fn(async () => ({ id: "mock-photo-id" }))
    };

    const input = {
      channelAccountId: "ca-123",
      secretRef: "sec-123",
      content: {
        body: "Hello world",
        hashtags: ["test"]
      }
    };
    const result = await publishPostHandler(input as any, mockSecretStore, mockGraphClient);
    assert.equal(result.passed, true);
    assert.equal(result.externalPostId, "mock-post-id");
    assert.equal(result.platformResponseSummary?.id, "mock-post-id");
  });

  it("publishes image assets through the Facebook photo endpoint", async () => {
    const mockGraphClient = {
      postFeed: mock.fn(async () => ({ id: "unexpected-feed-id" })),
      postPhoto: mock.fn(async () => ({ id: "mock-photo-id" }))
    };

    const input = {
      channelAccountId: "ca-123",
      secretRef: "sec-123",
      content: {
        body: "Hello image",
        media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }]
      }
    };

    const result = await publishPostHandler(input as any, mockSecretStore, mockGraphClient);

    assert.equal(result.passed, true);
    assert.equal(result.externalPostId, "mock-photo-id");
    assert.equal(mockGraphClient.postFeed.mock.calls.length, 0);
    assert.equal(mockGraphClient.postPhoto.mock.calls.length, 1);
  });

  it("returns PLATFORM_TRANSIENT_ERROR on 5xx", async () => {
    const mockGraphClient = {
      postFeed: mock.fn(async () => {
        const error = new Error("Gateway Timeout");
        (error as any).status = 504;
        throw error;
      }),
      postPhoto: mock.fn(async () => ({ id: "unused" }))
    };

    const input = {
      channelAccountId: "ca-123",
      secretRef: "sec-123",
      content: {
        body: "trigger_transient"
      }
    };
    const result = await publishPostHandler(input as any, mockSecretStore, mockGraphClient);
    assert.equal(result.passed, false);
    assert.equal(result.errors?.[0].code, "PLATFORM_TRANSIENT_ERROR");
  });

  it("returns PLATFORM_AUTH_FAILED on OAuth error", async () => {
    const mockGraphClient = {
      postFeed: mock.fn(async () => {
        const error = new Error("Invalid token mock-token");
        (error as any).type = 'OAuthException';
        throw error;
      }),
      postPhoto: mock.fn(async () => ({ id: "unused" }))
    };

    const input = {
      channelAccountId: "ca-123",
      secretRef: "sec-123",
      content: {
        body: "trigger_error"
      }
    };
    const result = await publishPostHandler(input as any, mockSecretStore, mockGraphClient);
    assert.equal(result.passed, false);
    assert.equal(result.errors?.[0].code, "PLATFORM_AUTH_FAILED");
    // Token should be redacted
    assert.equal(result.errors?.[0].detail?.includes("mock-token"), false);
    assert.equal(result.errors?.[0].detail?.includes("***TOKEN***"), true);
  });
});
