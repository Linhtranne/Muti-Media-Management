import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { 
  PublishPostInputSchema, 
  PublishPostResultSchema
} from "../mcp/publishPost.js";
import { PublishFacebookExecuteEventSchema } from "../mcp/publishFacebookExecute.js";

describe("MCP Publish Contracts", () => {
  it("validates PublishPostInputSchema", () => {
    const valid = {
      jobRef: { jobId: "00000000-0000-0000-0000-000000000000" },
      channelAccountId: "ca-123",
      secretRef: "sec-123",
      content: {
        body: "Hello world",
        hashtags: ["test", "facebook"],
        link: "https://example.com",
        media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }]
      }
    };
    const result = PublishPostInputSchema.safeParse(valid);
    assert.equal(result.success, true);

    const invalid = { ...valid, content: { body: 123 } };
    const invalidResult = PublishPostInputSchema.safeParse(invalid);
    assert.equal(invalidResult.success, false);
  });

  it("validates PublishPostResultSchema", () => {
    const validSuccess = {
      passed: true,
      externalPostId: "ext-123",
      platformResponseSummary: { id: "ext-123" },
      publishedAt: new Date().toISOString()
    };
    assert.equal(PublishPostResultSchema.safeParse(validSuccess).success, true);

    const validFailure = {
      passed: false,
      errors: [
        { code: "PLATFORM_AUTH_FAILED", detail: "Invalid token" }
      ]
    };
    assert.equal(PublishPostResultSchema.safeParse(validFailure).success, true);
  });

  it("validates PublishFacebookExecuteEventSchema", () => {
    const validEvent = {
      eventId: "00000000-0000-0000-0000-000000000000",
      eventType: "publish.facebook.execute",
      eventVersion: "1",
      workspaceId: "ws-1",
      jobId: "00000000-0000-0000-0000-000000000000",
      variantId: "00000000-0000-0000-0000-000000000000",
      channelAccountId: "c-1",
      scheduledAt: new Date().toISOString(),
      idempotencyKey: "idem-1",
      correlationId: "00000000-0000-0000-0000-000000000000",
      createdAt: new Date().toISOString()
    };
    assert.equal(PublishFacebookExecuteEventSchema.safeParse(validEvent).success, true);

    const invalidEvent = {
      ...validEvent,
      body: "forbidden" // References-only payload should reject body
    };
    assert.equal(PublishFacebookExecuteEventSchema.safeParse(invalidEvent).success, false);
  });
});
