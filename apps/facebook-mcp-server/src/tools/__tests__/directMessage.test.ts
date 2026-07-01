import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { getDirectMessageHandler } from "../getDirectMessage.js";
import { sendDirectMessageHandler } from "../sendDirectMessage.js";

const MOCK_SECRET_REF = "dbsecret:ws-001:550e8400-e29b-41d4-a716-446655440099";

describe("MCP Direct Message Tools", () => {
  describe("get_direct_message", () => {
    it("should fetch direct message and return details", async () => {
      const secretStore = {
        resolveSecret: mock.fn(async () => "real-fb-token")
      };

      const graphClient = {
        getMessage: mock.fn(async () => ({
          id: "msg-123",
          message: "Hello world!",
          from: { name: "Alice", id: "user-123" },
          created_time: "2026-06-03T10:00:00.000Z",
          attachments: {
            data: [
              { mime_type: "image/png", file_url: "http://example.com/img.png", id: "att-1" }
            ]
          }
        }))
      };

      process.env.NODE_ENV = "production"; // Bypass mock mode check to run actual client flow

      const result = await getDirectMessageHandler(
        {
          channel_account_id: "550e8400-e29b-41d4-a716-446655440001",
          external_thread_id: "thread-123",
          external_message_id: "msg-123",
          secret_ref: MOCK_SECRET_REF
        },
        secretStore as any,
        graphClient as any
      );

      assert.strictEqual(result.body, "Hello world!");
      assert.strictEqual(result.body_redacted, "Hello world!");
      assert.strictEqual(result.sender_metadata.name, "Alice");
      assert.strictEqual(result.sender_metadata.external_user_id, "user-123");
      assert.strictEqual(result.attachments_ref.length, 1);
      assert.strictEqual(result.attachments_ref[0].id, "att-1");
    });

    it("should return mock response in test mode", async () => {
      const secretStore = {
        resolveSecret: mock.fn(async () => "mock-token")
      };

      const graphClient = {
        getMessage: mock.fn(async () => {
          throw new Error("Should not be called");
        })
      };

      process.env.NODE_ENV = "test";

      const result = await getDirectMessageHandler(
        {
          channel_account_id: "550e8400-e29b-41d4-a716-446655440001",
          external_thread_id: "thread-123",
          external_message_id: "msg-123",
          secret_ref: MOCK_SECRET_REF
        },
        secretStore as any,
        graphClient as any
      );

      assert.ok(result.body.includes("Deterministic mock body for msg-123"));
      assert.strictEqual(result.sender_metadata.name, "Mock User");
    });

    it("should sanitize token in error messages", async () => {
      const secretStore = {
        resolveSecret: mock.fn(async () => "super-secret-fb-token")
      };

      const graphClient = {
        getMessage: mock.fn(async () => {
          throw new Error("Invalid request using token super-secret-fb-token");
        })
      };

      process.env.NODE_ENV = "production";

      await assert.rejects(
        async () => {
          await getDirectMessageHandler(
            {
              channel_account_id: "550e8400-e29b-41d4-a716-446655440001",
              external_thread_id: "thread-123",
              external_message_id: "msg-123",
              secret_ref: MOCK_SECRET_REF
            },
            secretStore as any,
            graphClient as any
          );
        },
        (err: Error) => {
          assert.ok(!err.message.includes("super-secret-fb-token"));
          assert.ok(err.message.includes("***TOKEN***"));
          return true;
        }
      );
    });
  });

  describe("send_direct_message", () => {
    it("should send direct message and return external message id", async () => {
      const secretStore = {
        resolveSecret: mock.fn(async () => "real-fb-token")
      };

      const graphClient = {
        sendMessage: mock.fn(async () => ({ message_id: "out-msg-123" }))
      };

      process.env.NODE_ENV = "production";

      const result = await sendDirectMessageHandler(
        {
          channel_account_id: "550e8400-e29b-41d4-a716-446655440001",
          external_thread_id: "thread-123",
          reply_body: "Hello back!",
          idempotency_key: "ik-1",
          secret_ref: MOCK_SECRET_REF
        },
        secretStore as any,
        graphClient as any
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.external_message_id, "out-msg-123");
    });

    it("should return mock response in test mode", async () => {
      const secretStore = {
        resolveSecret: mock.fn(async () => "mock-token")
      };

      const graphClient = {
        sendMessage: mock.fn(async () => {
          throw new Error("Should not be called");
        })
      };

      process.env.NODE_ENV = "test";

      const result = await sendDirectMessageHandler(
        {
          channel_account_id: "550e8400-e29b-41d4-a716-446655440001",
          external_thread_id: "thread-123",
          reply_body: "Hello back!",
          idempotency_key: "ik-1",
          secret_ref: MOCK_SECRET_REF
        },
        secretStore as any,
        graphClient as any
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.external_message_id, "mock-reply-msg-ik-1");
    });
  });
});
