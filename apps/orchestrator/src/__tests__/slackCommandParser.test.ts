import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SlackCommandParser } from "../services/slackCommandParser.js";

describe("SlackCommandParser", () => {
  const parser = new SlackCommandParser(500);

  it("should parse valid approve command", () => {
    const result = parser.parse("/approve_post", "POST-123");
    assert.deepEqual(result, { error: false, action: "approve", postId: "POST-123", reason: null });
  });

  it("should parse valid approve command with extra trailing spaces in text", () => {
    const result = parser.parse("/approve_post", "POST-123   ");
    assert.deepEqual(result, { error: false, action: "approve", postId: "POST-123", reason: null });
  });

  it("should ignore reason for approve command if provided", () => {
    const result = parser.parse("/approve_post", "POST-123 This is a reason");
    assert.deepEqual(result, { error: false, action: "approve", postId: "POST-123", reason: null });
  });

  it("should parse valid reject command with reason", () => {
    const result = parser.parse("/reject_post", "POST-123 Content policy violation");
    assert.deepEqual(result, { error: false, action: "reject", postId: "POST-123", reason: "Content policy violation" });
  });

  it("should return error for missing post id in approve", () => {
    const result = parser.parse("/approve_post", "   ");
    assert.deepEqual(result, { error: true, errorCode: "MISSING_POST_ID", message: "Post ID is required" });
  });

  it("should return error for missing reason in reject", () => {
    const result = parser.parse("/reject_post", "POST-123");
    assert.deepEqual(result, { error: true, errorCode: "MISSING_REASON", message: "Reason is required for rejecting a post" });
  });

  it("should return error for empty reason in reject", () => {
    const result = parser.parse("/reject_post", "POST-123   ");
    assert.deepEqual(result, { error: true, errorCode: "MISSING_REASON", message: "Reason is required for rejecting a post" });
  });

  it("should return error for reason too long", () => {
    const longReason = "a".repeat(501);
    const result = parser.parse("/reject_post", `POST-123 ${longReason}`);
    assert.deepEqual(result, { error: true, errorCode: "REASON_TOO_LONG", message: "Reason must be less than 500 characters" });
  });

  it("should return error for unknown command", () => {
    const result = parser.parse("/unknown_command", "POST-123");
    assert.deepEqual(result, { error: true, errorCode: "UNKNOWN_COMMAND", message: "Unknown command" });
  });

  it("should sanitize post id", () => {
    const result = parser.parse("/approve_post", "POST!@#-123$%^");
    assert.deepEqual(result, { error: false, action: "approve", postId: "POST-123", reason: null });
  });

  it("should error if post id is empty after sanitization", () => {
    const result = parser.parse("/approve_post", "!@#$");
    assert.deepEqual(result, { error: true, errorCode: "MISSING_POST_ID", message: "Post ID is invalid or missing" });
  });

  // US-009 Tests
  it("should parse valid reply_comment command", () => {
    const result = parser.parse("/reply_comment", "123e4567-e89b-12d3-a456-426614174000 This is a reply");
    assert.deepEqual(result, { error: false, action: "reply", interactionId: "123e4567-e89b-12d3-a456-426614174000", message: "This is a reply" });
  });

  it("should parse valid escalate command", () => {
    const result = parser.parse("/escalate", "123e4567-e89b-12d3-a456-426614174000 Needs support");
    assert.deepEqual(result, { error: false, action: "escalate", interactionId: "123e4567-e89b-12d3-a456-426614174000", reason: "Needs support" });
  });

  it("should return error for missing message in reply_comment", () => {
    const result = parser.parse("/reply_comment", "123e4567-e89b-12d3-a456-426614174000");
    assert.deepEqual(result, { error: true, errorCode: "MISSING_MESSAGE", message: "Message is required for replying to a comment" });
  });

  it("should return error for missing interaction id in reply_comment", () => {
    const result = parser.parse("/reply_comment", "   ");
    assert.deepEqual(result, { error: true, errorCode: "MISSING_INTERACTION_ID", message: "Interaction ID is required" });
  });

  it("should return error for interaction id invalid in reply_comment", () => {
    const result = parser.parse("/reply_comment", "INT-123 Some message");
    assert.deepEqual(result, { error: true, errorCode: "INVALID_UUID", message: "Interaction ID must be a valid UUID" });
  });
});
