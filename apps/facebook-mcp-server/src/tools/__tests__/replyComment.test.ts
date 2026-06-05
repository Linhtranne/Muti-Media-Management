import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { replyCommentHandler } from "../replyComment.js";

describe("replyComment", () => {
  it("should post comment and return success", async () => {
    const secretStore = {
      resolveSecret: mock.fn(async () => "test-token")
    };

    const graphClient = {
      postComment: mock.fn(async () => ({ id: "reply-123" }))
    };

    process.env.MOCK_ACCESS_TOKEN = "";

    const result = await replyCommentHandler(
      { external_comment_id: "ext-1", message: "Hello", channelAccountId: "chan-1" },
      secretStore as any,
      graphClient as any
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.external_reply_id, "reply-123");
    assert.strictEqual((graphClient.postComment as any).mock.calls.length, 1);
    const args = (graphClient.postComment as any).mock.calls[0].arguments;
    assert.strictEqual(args[1], "test-token");

    // Ensure the token resolution follows the deterministic env mapping
    assert.strictEqual((secretStore.resolveSecret as any).mock.calls.length, 1);
    assert.strictEqual((secretStore.resolveSecret as any).mock.calls[0].arguments[0], "env:FACEBOOK_CHANNEL_CHAN_1_TOKEN");
  });

  it("should sanitize credentials on graph error", async () => {
    const secretStore = {
      resolveSecret: mock.fn(async () => "super-secret-token")
    };

    const graphClient = {
      postComment: mock.fn(async () => {
        throw new Error("Invalid token super-secret-token for request");
      })
    };

    process.env.MOCK_ACCESS_TOKEN = "";

    const result = await replyCommentHandler(
      { external_comment_id: "ext-1", message: "Hello", channelAccountId: "chan-1" },
      secretStore as any,
      graphClient as any
    );

    assert.strictEqual(result.success, false);
    // ensure no leak
    assert.strictEqual(result.error?.includes("super-secret-token"), false);
    assert.strictEqual(result.error?.includes("***TOKEN***"), true);
  });
});
