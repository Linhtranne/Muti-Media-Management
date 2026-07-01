import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PolicyEvaluateRequestedEventSchema,
  PublishFacebookRequestedEventSchema
} from "../policy/policyEvaluate.js";

const basePolicyEvent = {
  event_id: "11111111-1111-4111-8111-111111111111",
  event_type: "policy.evaluate.requested",
  event_version: 1,
  workspace_id: "ws_test_123",
  correlation_id: "corr-1",
  workflow_run_id: "22222222-2222-4222-8222-222222222222",
  ai_generation_run_id: "33333333-3333-4333-8333-333333333333",
  content_variant_id: "44444444-4444-4444-8444-444444444444",
  airtable_record_id: "recPost123",
  platform: "facebook",
  prompt_version: "fb_composer_v1.0.0",
  approved_version: 1,
  idempotency_key: "policy.evaluate.requested:ws_test_123:44444444-4444-4444-8444-444444444444:policy-facebook-v1",
  created_at: "2026-06-01T00:00:00.000Z"
};

const basePublishEvent = {
  event_id: "55555555-5555-4555-8555-555555555555",
  event_type: "publish.facebook.requested",
  event_version: 1,
  workspace_id: "ws_test_123",
  correlation_id: "corr-1",
  workflow_run_id: "22222222-2222-4222-8222-222222222222",
  job_id: "66666666-6666-4666-8666-666666666666",
  variant_id: "44444444-4444-4444-8444-444444444444",
  channel_account_id: "77777777-7777-4777-8777-777777777777",
  scheduled_at: "2026-06-01T01:00:00.000Z",
  idempotency_key: "publish.facebook.handoff:ws_test_123:66666666-6666-4666-8666-666666666666",
  created_at: "2026-06-01T00:00:00.000Z"
};

describe("PolicyEvaluateRequestedEventSchema", () => {
  it("accepts a valid references-only policy event", () => {
    assert.equal(PolicyEvaluateRequestedEventSchema.safeParse(basePolicyEvent).success, true);
  });

  for (const field of ["body", "hashtags", "cta_url", "access_token", "secret_ref", "api_key", "token"]) {
    it(`rejects forbidden field ${field}`, () => {
      assert.equal(PolicyEvaluateRequestedEventSchema.safeParse({ ...basePolicyEvent, [field]: "secret" }).success, false);
    });
  }
});

describe("PublishFacebookRequestedEventSchema", () => {
  it("accepts a valid references-only publish event", () => {
    assert.equal(PublishFacebookRequestedEventSchema.safeParse(basePublishEvent).success, true);
  });

  for (const field of ["body", "hashtags", "cta_url", "access_token", "secret_ref", "api_key", "master_copy"]) {
    it(`rejects forbidden field ${field}`, () => {
      assert.equal(PublishFacebookRequestedEventSchema.safeParse({ ...basePublishEvent, [field]: "secret" }).success, false);
    });
  }
});

