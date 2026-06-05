/**
 * US-015 Contract Tests — Direct Message Schemas
 * Tests for directMessage.ts using node:test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ConversationStatusSchema,
  DirectMessageIngestEventSchema,
  DirectMessageReplyRequestedEventSchema,
  GetDirectMessageInputSchema,
  GetDirectMessageResultSchema,
  SendDirectMessageInputSchema,
  SendDirectMessageResultSchema
} from "../events/directMessage.js";

const VALID_INGEST = {
  event_id: "550e8400-e29b-41d4-a716-446655440000",
  event_type: "dm.facebook.ingest",
  event_version: 1,
  workspace_id: "ws-001",
  idempotency_key: "dm.facebook.ingest:ws-001:msg-001:v1",
  correlation_id: "550e8400-e29b-41d4-a716-446655440002",
  created_at: "2026-06-03T10:00:00.000Z",
  payload: {
    platform: "facebook",
    channel_account_id: "550e8400-e29b-41d4-a716-446655440001",
    external_thread_id: "thread-123",
    external_message_id: "msg-123",
    customer_ref: {
      name: "John Doe",
      external_user_id: "cust-123"
    },
    body_preview: "Hello there!",
    created_at_platform: "2026-06-03T09:59:59.000Z",
    has_attachments: false
  }
};

const VALID_REPLY_REQUESTED = {
  event_id: "550e8400-e29b-41d4-a716-446655440000",
  event_type: "dm.reply.requested",
  event_version: 1,
  workspace_id: "ws-001",
  idempotency_key: "dm.reply.requested:ws-001:job-001",
  correlation_id: "550e8400-e29b-41d4-a716-446655440002",
  created_at: "2026-06-03T10:00:00.000Z",
  payload: {
    reply_job_id: "550e8400-e29b-41d4-a716-446655440003",
    actor_id: "550e8400-e29b-41d4-a716-446655440004"
  }
};

describe("Direct Message Schemas", () => {
  describe("ConversationStatusSchema", () => {
    it("accepts valid statuses", () => {
      const statuses = ["new", "assigned", "waiting", "resolved", "escalated"];
      for (const s of statuses) {
        assert.ok(ConversationStatusSchema.safeParse(s).success);
      }
    });

    it("rejects invalid status", () => {
      assert.equal(ConversationStatusSchema.safeParse("unknown").success, false);
    });
  });

  describe("DirectMessageIngestEventSchema", () => {
    it("accepts valid ingest event", () => {
      const result = DirectMessageIngestEventSchema.safeParse(VALID_INGEST);
      assert.equal(result.success, true, result.success ? "" : JSON.stringify(result.error));
    });

    it("rejects invalid platform", () => {
      const result = DirectMessageIngestEventSchema.safeParse({
        ...VALID_INGEST,
        payload: {
          ...VALID_INGEST.payload,
          platform: "unsupported"
        }
      });
      assert.equal(result.success, false);
    });

    it("rejects body_preview > 80 chars", () => {
      const result = DirectMessageIngestEventSchema.safeParse({
        ...VALID_INGEST,
        payload: {
          ...VALID_INGEST.payload,
          body_preview: "a".repeat(81)
        }
      });
      assert.equal(result.success, false);
    });

    it("rejects string literal version", () => {
      const result = DirectMessageIngestEventSchema.safeParse({
        ...VALID_INGEST,
        event_version: "1"
      });
      assert.equal(result.success, false);
    });

    it("rejects forbidden fields like access_token in payload", () => {
      const result = DirectMessageIngestEventSchema.safeParse({
        ...VALID_INGEST,
        payload: {
          ...VALID_INGEST.payload,
          access_token: "fb-secret-token"
        }
      });
      assert.equal(result.success, false);
    });

    it("rejects camelCase forbidden fields like accessToken", () => {
      const result = DirectMessageIngestEventSchema.safeParse({
        ...VALID_INGEST,
        payload: {
          ...VALID_INGEST.payload,
          accessToken: "fb-secret-token"
        }
      });
      assert.equal(result.success, false);
    });

    it("rejects PascalCase forbidden fields like AccessToken", () => {
      const result = DirectMessageIngestEventSchema.safeParse({
        ...VALID_INGEST,
        payload: {
          ...VALID_INGEST.payload,
          AccessToken: "fb-secret-token"
        }
      });
      assert.equal(result.success, false);
    });
  });

  describe("DirectMessageReplyRequestedEventSchema", () => {
    it("accepts valid reply requested event with reply_job_id", () => {
      const result = DirectMessageReplyRequestedEventSchema.safeParse(VALID_REPLY_REQUESTED);
      assert.equal(result.success, true, result.success ? "" : JSON.stringify((result as any).error));
    });

    it("rejects payload with reply_body (must use reply_job_id only)", () => {
      const result = DirectMessageReplyRequestedEventSchema.safeParse({
        ...VALID_REPLY_REQUESTED,
        payload: {
          reply_job_id: VALID_REPLY_REQUESTED.payload.reply_job_id,
          actor_id: VALID_REPLY_REQUESTED.payload.actor_id,
          reply_body: "leaking message body in queue"
        }
      });
      assert.equal(result.success, false);
    });

    it("rejects payload with conversation_id (legacy field removed)", () => {
      const result = DirectMessageReplyRequestedEventSchema.safeParse({
        ...VALID_REPLY_REQUESTED,
        payload: {
          reply_job_id: VALID_REPLY_REQUESTED.payload.reply_job_id,
          actor_id: VALID_REPLY_REQUESTED.payload.actor_id,
          conversation_id: "550e8400-e29b-41d4-a716-446655440099"
        }
      });
      assert.equal(result.success, false);
    });

    it("rejects missing actor_id", () => {
      const result = DirectMessageReplyRequestedEventSchema.safeParse({
        ...VALID_REPLY_REQUESTED,
        payload: {
          reply_job_id: VALID_REPLY_REQUESTED.payload.reply_job_id
        }
      });
      assert.equal(result.success, false);
    });

    it("rejects forbidden field api_key in payload", () => {
      const result = DirectMessageReplyRequestedEventSchema.safeParse({
        ...VALID_REPLY_REQUESTED,
        payload: {
          ...VALID_REPLY_REQUESTED.payload,
          api_key: "api-secret"
        }
      });
      assert.equal(result.success, false);
    });
  });

  describe("MCP Tool Schemas", () => {
    it("validates GetDirectMessageInputSchema — requires secret_ref", () => {
      const validInput = {
        channel_account_id: "550e8400-e29b-41d4-a716-446655440001",
        external_thread_id: "thread-1",
        external_message_id: "msg-1",
        secret_ref: "dbsecret:ws-001:550e8400-e29b-41d4-a716-446655440099"
      };
      assert.ok(GetDirectMessageInputSchema.safeParse(validInput).success);

      // Rejects missing secret_ref
      const { secret_ref: _, ...noSecretRef } = validInput;
      assert.equal(GetDirectMessageInputSchema.safeParse(noSecretRef).success, false);

      // Rejects forbidden field
      assert.equal(GetDirectMessageInputSchema.safeParse({ ...validInput, token: "leak" }).success, false);
    });

    it("validates GetDirectMessageResultSchema", () => {
      const result = {
        body: "Hello, this is my message.",
        body_redacted: "Hello, this is my message.",
        attachments_ref: [
          { type: "image", url_ref: "http://example.com/img.png", id: "att-1" }
        ],
        sender_metadata: {
          name: "Alice",
          external_user_id: "alice-123"
        },
        created_at_platform: "2026-06-03T10:00:00.000Z"
      };
      assert.ok(GetDirectMessageResultSchema.safeParse(result).success);

      // Rejects raw_response
      assert.equal(GetDirectMessageResultSchema.safeParse({ ...result, raw_response: {} }).success, false);
    });

    it("validates SendDirectMessageInputSchema — requires secret_ref", () => {
      const validInput = {
        channel_account_id: "550e8400-e29b-41d4-a716-446655440001",
        external_thread_id: "thread-1",
        reply_body: "Hi",
        idempotency_key: "key-1",
        secret_ref: "dbsecret:ws-001:550e8400-e29b-41d4-a716-446655440099"
      };
      assert.ok(SendDirectMessageInputSchema.safeParse(validInput).success);

      // Rejects missing secret_ref
      const { secret_ref: _, ...noSecretRef } = validInput;
      assert.equal(SendDirectMessageInputSchema.safeParse(noSecretRef).success, false);

      // Rejects camelCase secretRef (strict mode)
      assert.equal(SendDirectMessageInputSchema.safeParse({ ...validInput, secretRef: "extra" }).success, false);
    });

    it("validates SendDirectMessageResultSchema", () => {
      const result = {
        success: true,
        external_message_id: "msg-reply-1"
      };
      assert.ok(SendDirectMessageResultSchema.safeParse(result).success);
    });
  });
});
