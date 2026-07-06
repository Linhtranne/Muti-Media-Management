import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PublishTiktokRequestedEventSchema,
  PublishTiktokExecuteEventSchema,
  PublishTiktokStatusCheckEventSchema,
} from "../events/tiktokPublish.js";
import {
  PublishTiktokVideoInputSchema,
  PublishTiktokPhotoInputSchema,
  PublishTiktokResultSchema,
  GetTiktokPublishStatusInputSchema,
  GetTiktokPublishStatusResultSchema,
} from "../mcp/tiktok.js";

describe("TikTok Event Contracts", () => {
  const validRequestedEvent = {
    event_id: "11111111-1111-1111-1111-111111111111",
    event_type: "publish.tiktok.requested",
    event_version: 1,
    workspace_id: "ws-123",
    correlation_id: "22222222-2222-2222-2222-222222222222",
    workflow_run_id: "33333333-3333-3333-3333-333333333333",
    job_id: "44444444-4444-4444-4444-444444444444",
    variant_id: "55555555-5555-5555-5555-555555555555",
    channel_account_id: "ca-999",
    scheduled_at: "2026-07-01T12:00:00.000Z",
    idempotency_key: "idem-req-tiktok-1",
    created_at: "2026-07-01T12:00:00.000Z"
  };

  it("validates PublishTiktokRequestedEventSchema", () => {
    const result = PublishTiktokRequestedEventSchema.safeParse(validRequestedEvent);
    assert.equal(result.success, true);
  });

  it("rejects forbidden fields in PublishTiktokRequestedEventSchema", () => {
    const invalidEvent = {
      ...validRequestedEvent,
      token: "raw-token-here"
    };
    const result = PublishTiktokRequestedEventSchema.safeParse(invalidEvent);
    assert.equal(result.success, false);
  });

  it("validates PublishTiktokExecuteEventSchema", () => {
    const validExecute = {
      ...validRequestedEvent,
      event_type: "publish.tiktok.execute"
    };
    const result = PublishTiktokExecuteEventSchema.safeParse(validExecute);
    assert.equal(result.success, true);
  });

  it("validates PublishTiktokStatusCheckEventSchema", () => {
    const validStatusCheck = {
      ...validRequestedEvent,
      event_type: "publish.tiktok.status_check",
      tiktok_request_id: "tiktok-req-xyz",
      check_attempt_count: 1
    };
    const result = PublishTiktokStatusCheckEventSchema.safeParse(validStatusCheck);
    assert.equal(result.success, true);
  });

  it("rejects invalid check_attempt_count in PublishTiktokStatusCheckEventSchema", () => {
    const invalidStatusCheck = {
      ...validRequestedEvent,
      event_type: "publish.tiktok.status_check",
      tiktok_request_id: "tiktok-req-xyz",
      check_attempt_count: -5
    };
    const result = PublishTiktokStatusCheckEventSchema.safeParse(invalidStatusCheck);
    assert.equal(result.success, false);
  });
});

describe("TikTok MCP Contracts", () => {
  it("validates PublishTiktokVideoInputSchema", () => {
    const validVideo = {
      jobRef: { jobId: "44444444-4444-4444-4444-444444444444" },
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      content: {
        title: "Test Video",
        videoUrl: "https://r2.example.com/videos/123.mp4",
        privacyLevel: "PUBLIC_TO_EVERYONE",
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    };
    const result = PublishTiktokVideoInputSchema.safeParse(validVideo);
    assert.equal(result.success, true);
  });

  it("rejects invalid privacy enum in PublishTiktokVideoInputSchema", () => {
    const invalidVideo = {
      jobRef: { jobId: "44444444-4444-4444-4444-444444444444" },
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      content: {
        title: "Test Video",
        videoUrl: "https://r2.example.com/videos/123.mp4",
        privacyLevel: "PUBLIC",
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    };
    const result = PublishTiktokVideoInputSchema.safeParse(invalidVideo);
    assert.equal(result.success, false);
  });

  it("rejects video title longer than 2200 runes", () => {
    const invalidVideo = {
      jobRef: { jobId: "44444444-4444-4444-4444-444444444444" },
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      content: {
        title: "A".repeat(2201),
        videoUrl: "https://r2.example.com/videos/123.mp4",
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    };
    const result = PublishTiktokVideoInputSchema.safeParse(invalidVideo);
    assert.equal(result.success, false);
  });

  it("rejects token in PublishTiktokVideoInputSchema", () => {
    const invalidVideo = {
      jobRef: { jobId: "44444444-4444-4444-4444-444444444444" },
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      token: "secret-token",
      content: {
        title: "Test Video",
        videoUrl: "https://r2.example.com/videos/123.mp4",
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    };
    const result = PublishTiktokVideoInputSchema.safeParse(invalidVideo);
    assert.equal(result.success, false);
  });

  it("validates PublishTiktokPhotoInputSchema with multiple images", () => {
    const validPhoto = {
      jobRef: { jobId: "44444444-4444-4444-4444-444444444444" },
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      content: {
        title: "Test Photo Post",
        description: "Behold, a carousel",
        imageUrls: [
          "https://r2.example.com/images/1.png",
          "https://r2.example.com/images/2.png"
        ],
        privacyLevel: "PUBLIC_TO_EVERYONE",
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    };
    const result = PublishTiktokPhotoInputSchema.safeParse(validPhoto);
    assert.equal(result.success, true);
  });

  it("rejects photo title > 90 runes", () => {
    const invalidPhoto = {
      jobRef: { jobId: "44444444-4444-4444-4444-444444444444" },
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      content: {
        title: "A".repeat(91),
        imageUrls: ["https://r2.example.com/images/1.png"],
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    };
    const result = PublishTiktokPhotoInputSchema.safeParse(invalidPhoto);
    assert.equal(result.success, false);
  });

  it("rejects photo description > 4000 runes", () => {
    const invalidPhoto = {
      jobRef: { jobId: "44444444-4444-4444-4444-444444444444" },
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      content: {
        title: "Valid Title",
        description: "A".repeat(4001),
        imageUrls: ["https://r2.example.com/images/1.png"],
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    };
    const result = PublishTiktokPhotoInputSchema.safeParse(invalidPhoto);
    assert.equal(result.success, false);
  });

  it("rejects empty imageUrls in PublishTiktokPhotoInputSchema", () => {
    const invalidPhoto = {
      jobRef: { jobId: "44444444-4444-4444-4444-444444444444" },
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      content: {
        title: "Test Photo Post",
        description: "Behold, empty",
        imageUrls: [],
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    };
    const result = PublishTiktokPhotoInputSchema.safeParse(invalidPhoto);
    assert.equal(result.success, false);
  });

  it("rejects more than 35 imageUrls in PublishTiktokPhotoInputSchema", () => {
    const urls = Array.from({ length: 36 }, (_, i) => `https://r2.example.com/images/${i}.png`);
    const invalidPhoto = {
      jobRef: { jobId: "44444444-4444-4444-4444-444444444444" },
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      content: {
        title: "Test Photo Post",
        imageUrls: urls,
        brandContentToggle: false,
        brandOrganicToggle: false
      }
    };
    const result = PublishTiktokPhotoInputSchema.safeParse(invalidPhoto);
    assert.equal(result.success, false);
  });

  it("validates PublishTiktokResultSchema", () => {
    const validResult = {
      passed: true,
      tiktokRequestId: "v_init_123456",
      status: "PROCESSING"
    };
    const result = PublishTiktokResultSchema.safeParse(validResult);
    assert.equal(result.success, true);
  });

  it("validates GetTiktokPublishStatusInputSchema", () => {
    const validStatusInput = {
      channelAccountId: "ca-999",
      workspaceId: "ws-123",
      tiktokRequestId: "v_init_123456"
    };
    const result = GetTiktokPublishStatusInputSchema.safeParse(validStatusInput);
    assert.equal(result.success, true);
  });

  it("validates GetTiktokPublishStatusResultSchema for published and failed cases", () => {
    const successResult = {
      passed: true,
      status: "PUBLISHED",
      externalPostId: "tiktok_post_999"
    };
    const failedResult = {
      passed: false,
      status: "FAILED",
      errors: [{ code: "VIDEO_FILE_ERROR", detail: "Video processing failed on TikTok side" }]
    };

    assert.equal(GetTiktokPublishStatusResultSchema.safeParse(successResult).success, true);
    assert.equal(GetTiktokPublishStatusResultSchema.safeParse(failedResult).success, true);
  });
});
