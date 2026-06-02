import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CommentSyncRequestedEventSchema, CommentIngestEventSchema } from "../events/facebookCommentSync.js";

describe("facebookCommentContracts", () => {
  describe("CommentSyncRequestedEventSchema", () => {
    it("should allow a valid payload", () => {
      const payload = {
        event_id: "123e4567-e89b-12d3-a456-426614174000",
        event_type: "comments.facebook.sync.requested",
        event_version: 1,
        workspace_id: "workspace-1",
        job_id: "123e4567-e89b-12d3-a456-426614174001",
        channel_account_id: "acc-1",
        external_post_id: "post-1",
        idempotency_key: "key-1",
        correlation_id: "123e4567-e89b-12d3-a456-426614174002",
        created_at: new Date().toISOString(),
      };
      
      const result = CommentSyncRequestedEventSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it("should reject payload with raw token", () => {
      const payload = {
        event_id: "123e4567-e89b-12d3-a456-426614174000",
        event_type: "comments.facebook.sync.requested",
        event_version: 1,
        workspace_id: "workspace-1",
        job_id: "123e4567-e89b-12d3-a456-426614174001",
        channel_account_id: "acc-1",
        external_post_id: "post-1",
        idempotency_key: "key-1",
        correlation_id: "123e4567-e89b-12d3-a456-426614174002",
        created_at: new Date().toISOString(),
        access_token: "secret-token", // Forbidden
      };
      
      const result = CommentSyncRequestedEventSchema.safeParse(payload);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.issues.some(i => i.message.includes("Forbidden queue field: access_token")), true);
      }
    });
  });

  describe("CommentIngestEventSchema", () => {
    it("should allow a valid payload", () => {
      const payload = {
        event_id: "123e4567-e89b-12d3-a456-426614174000",
        event_type: "comments.facebook.ingest",
        event_version: 1,
        workspace_id: "workspace-1",
        job_id: "123e4567-e89b-12d3-a456-426614174001",
        external_post_id: "post-123",
        external_comment_id: "comment-1",
        author_ref: {
          name: "John Doe",
          external_user_id: "user-1",
        },
        comment_preview: "Hello world",
        permalink: "https://facebook.com/comment",
        created_at_platform: new Date().toISOString(),
        correlation_id: "123e4567-e89b-12d3-a456-426614174002",
        causation_id: "123e4567-e89b-12d3-a456-426614174003",
        created_at: new Date().toISOString(),
      };
      
      const result = CommentIngestEventSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it("should reject payload with full body", () => {
      const payload = {
        event_id: "123e4567-e89b-12d3-a456-426614174000",
        event_type: "comments.facebook.ingest",
        event_version: 1,
        workspace_id: "workspace-1",
        job_id: "123e4567-e89b-12d3-a456-426614174001",
        external_post_id: "post-123",
        external_comment_id: "comment-1",
        author_ref: {
          name: "John Doe",
        },
        comment_preview: "Hello world",
        permalink: "https://facebook.com/comment",
        created_at_platform: new Date().toISOString(),
        correlation_id: "123e4567-e89b-12d3-a456-426614174002",
        causation_id: "123e4567-e89b-12d3-a456-426614174003",
        created_at: new Date().toISOString(),
        body: "This is a full body that should be forbidden", // Forbidden
      };
      
      const result = CommentIngestEventSchema.safeParse(payload);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.issues.some(i => i.message.includes("Forbidden queue field: body")), true);
      }
    });
  });
});
