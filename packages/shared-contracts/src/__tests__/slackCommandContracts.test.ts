import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SlackSlashCommandSchema } from "../slack/slashCommand.js";
import { SlackCommandActionEventSchema } from "../slack/slackCommandAction.js";

describe("SlackCommandContracts", () => {
  describe("SlackSlashCommandSchema", () => {
    it("should accept valid approve payload", () => {
      const payload = {
        command: "/approve_post",
        text: "POST-123",
        user_id: "U12345",
        team_id: "T12345",
      };
      assert.doesNotThrow(() => SlackSlashCommandSchema.parse(payload));
    });

    it("should accept valid reject payload", () => {
      const payload = {
        command: "/reject_post",
        text: "POST-123 Too much text",
        user_id: "U12345",
        team_id: "T12345",
      };
      assert.doesNotThrow(() => SlackSlashCommandSchema.parse(payload));
    });
  });

  describe("SlackCommandActionEventSchema", () => {
    it("should reject payload with reason field", () => {
      const payload = {
        event_id: "123e4567-e89b-12d3-a456-426614174000",
        event_type: "slack.post_approval.requested",
        event_version: 1,
        workspace_id: "ws-1",
        command_event_id: "123e4567-e89b-12d3-a456-426614174001",
        action: "reject",
        target_post_id: "POST-123",
        idempotency_key: "idemp-123",
        correlation_id: "corr-123",
        created_at: new Date().toISOString(),
        reason: "Too spicy", // Invalid field
      };

      const result = SlackCommandActionEventSchema.safeParse(payload);
      assert.strictEqual(result.success, false);
    });

    it("should reject payload with token field", () => {
      const payload = {
        event_id: "123e4567-e89b-12d3-a456-426614174000",
        event_type: "slack.post_approval.requested",
        event_version: 1,
        workspace_id: "ws-1",
        command_event_id: "123e4567-e89b-12d3-a456-426614174001",
        action: "approve",
        target_post_id: "POST-123",
        idempotency_key: "idemp-123",
        correlation_id: "corr-123",
        created_at: new Date().toISOString(),
        token: "xoxb-123", // Invalid field
      };

      const result = SlackCommandActionEventSchema.safeParse(payload);
      assert.strictEqual(result.success, false);
    });
  });
});
