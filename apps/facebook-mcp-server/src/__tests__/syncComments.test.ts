import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { syncCommentsHandler, type GraphSyncCommentsClient } from "../tools/syncComments.js";
import { type SyncCommentsInput } from "@mediaops/shared-contracts";
import { type SecretStore } from "../lib/secretStore.js";

const mockSecretStore: SecretStore = {
  resolveSecret: async (ref: string) => {
    if (ref === "vault://bad") throw new Error("Secret not found");
    return "mock-token";
  },
  storeSecret: async (workspaceId: string, suffix: string, secretValue: string) => {
    return `vault://${workspaceId}/${suffix}`;
  }
};

describe("syncComments tool", () => {
  it("should successfully fetch comments", async () => {
    const input: SyncCommentsInput = {
      postRef: { jobId: "job-1" },
      channelAccountId: "acc-1",
      secretRef: "vault://good",
      externalPostId: "post-123"
    };

    const mockGraphClient: GraphSyncCommentsClient = {
      getComments: async (postId, token) => {
        assert.equal(postId, "post-123");
        assert.equal(token, "mock-token");
        return {
          data: [
            {
              id: "comment-1",
              message: "Test comment",
              from: { name: "User 1", id: "user-1" },
              created_time: "2026-06-02T00:00:00Z"
            }
          ]
        };
      }
    };

    const result = await syncCommentsHandler(input, mockSecretStore, mockGraphClient);
    assert.equal(result.passed, true);
    assert.equal(result.comments?.length, 1);
    assert.equal(result.comments?.[0].externalId, "comment-1");
    assert.equal(result.comments?.[0].body, "Test comment");
    assert.equal(result.comments?.[0].permalink, "https://facebook.com/comment-1"); // fallback permalink
  });

  it("should handle platform rate limit error", async () => {
    const input: SyncCommentsInput = {
      postRef: { jobId: "job-1" },
      channelAccountId: "acc-1",
      secretRef: "vault://good",
      externalPostId: "post-123"
    };

    const mockGraphClient: GraphSyncCommentsClient = {
      getComments: async () => {
        return {
          data: [],
          error: {
            message: "User request limit reached",
            code: 4
          }
        };
      }
    };

    const result = await syncCommentsHandler(input, mockSecretStore, mockGraphClient);
    assert.equal(result.passed, false);
    assert.equal(result.errors?.[0].code, "PLATFORM_RATE_LIMIT");
  });

  it("should handle missing secrets", async () => {
    const input: SyncCommentsInput = {
      postRef: { jobId: "job-1" },
      channelAccountId: "acc-1",
      secretRef: "vault://bad",
      externalPostId: "post-123"
    };

    // Override process.env.MOCK_ACCESS_TOKEN temporarily
    const oldMock = process.env.MOCK_ACCESS_TOKEN;
    delete process.env.MOCK_ACCESS_TOKEN;

    const mockGraphClient: GraphSyncCommentsClient = {
      getComments: async () => { throw new Error("Should not be called"); }
    };

    const result = await syncCommentsHandler(input, mockSecretStore, mockGraphClient);
    assert.equal(result.passed, false);
    assert.equal(result.errors?.[0].code, "SECRET_UNAVAILABLE");

    if (oldMock) process.env.MOCK_ACCESS_TOKEN = oldMock;
  });
});
