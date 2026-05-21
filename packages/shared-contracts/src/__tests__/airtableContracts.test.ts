/**
 * @file airtableContracts.test.ts
 * US-002 Contract Tests — shared-contracts
 *
 * Tests (no network, no DB, no RabbitMQ):
 * 1. Valid Airtable webhook payload parses successfully.
 * 2. Webhook payload with forbidden fields (master_copy, cta_url, asset_links, token) is rejected.
 * 3. Queue message with forbidden fields (approved_version, master_copy, token, etc.) is rejected.
 * 4. Valid queue message parses successfully.
 * 5. Idempotency helpers return correct format.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Direct relative imports — no alias resolution needed for node:test strip-types mode
import { AirtableApprovedWebhookSchema } from "../events/airtablePostApproved.ts";
import { AirtableApprovedQueueMessageSchema } from "../events/airtablePostApproved.ts";
import {
  createIngressIdempotencyKey,
  createWorkflowIdempotencyKey
} from "../events/airtablePostApproved.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validWebhookPayload = {
  event_id: "evt_abc123",
  record_id: "recXXXXXXXXXXXXXX",
  table_name: "Posts" as const,
  change_type: "update" as const,
  approved_at: "2026-05-21T09:00:00.000Z"
};

const validQueueMessage = {
  event_id: "evt_abc123",
  event_type: "airtable.post.approved.ingress" as const,
  event_version: 1 as const,
  source: "airtable.webhook_receiver" as const,
  workspace_id: "workspace_test_001",
  record_ref: "recXXXXXXXXXXXXXX",
  approval_ref: "2026-05-21T09:00:00.000Z",
  idempotency_key: "airtable.webhook.ingress:evt_abc123",
  correlation_id: "corr_abc123",
  causation_id: "evt_abc123"
};

// ---------------------------------------------------------------------------
// 1. Valid webhook payload parses successfully
// ---------------------------------------------------------------------------
describe("AirtableApprovedWebhookSchema", () => {
  it("accepts a valid approved webhook payload", () => {
    const result = AirtableApprovedWebhookSchema.safeParse(validWebhookPayload);
    assert.ok(result.success, `Expected parse success but got: ${JSON.stringify(result)}`);
    assert.equal(result.data?.event_id, "evt_abc123");
    assert.equal(result.data?.table_name, "Posts");
  });

  // ---------------------------------------------------------------------------
  // 2. Forbidden content fields must be rejected
  // ---------------------------------------------------------------------------
  it("rejects payload with master_copy field", () => {
    const payload = { ...validWebhookPayload, master_copy: "Some campaign copy here" };
    const result = AirtableApprovedWebhookSchema.safeParse(payload);
    assert.equal(result.success, false, "Expected rejection when master_copy is present");
  });

  it("rejects payload with cta_url field", () => {
    const payload = { ...validWebhookPayload, cta_url: "https://example.com/cta" };
    const result = AirtableApprovedWebhookSchema.safeParse(payload);
    assert.equal(result.success, false, "Expected rejection when cta_url is present");
  });

  it("rejects payload with asset_links field", () => {
    const payload = { ...validWebhookPayload, asset_links: ["https://cdn.example.com/img.png"] };
    const result = AirtableApprovedWebhookSchema.safeParse(payload);
    assert.equal(result.success, false, "Expected rejection when asset_links is present");
  });

  it("rejects payload with token field", () => {
    const payload = { ...validWebhookPayload, token: "EAAxxxxxx" };
    const result = AirtableApprovedWebhookSchema.safeParse(payload);
    assert.equal(result.success, false, "Expected rejection when token is present");
  });

  it("rejects payload with access_token field", () => {
    const payload = { ...validWebhookPayload, access_token: "EAAxxxxxx" };
    const result = AirtableApprovedWebhookSchema.safeParse(payload);
    assert.equal(result.success, false, "Expected rejection when access_token is present");
  });

  it("rejects payload with api_key field", () => {
    const payload = { ...validWebhookPayload, api_key: "key_supersecret" };
    const result = AirtableApprovedWebhookSchema.safeParse(payload);
    assert.equal(result.success, false, "Expected rejection when api_key is present");
  });

  it("rejects payload with wrong table_name", () => {
    const payload = { ...validWebhookPayload, table_name: "Campaigns" };
    const result = AirtableApprovedWebhookSchema.safeParse(payload);
    assert.equal(result.success, false, "Expected rejection when table_name is not 'Posts'");
  });

  it("rejects payload with wrong change_type", () => {
    const payload = { ...validWebhookPayload, change_type: "create" };
    const result = AirtableApprovedWebhookSchema.safeParse(payload);
    assert.equal(result.success, false, "Expected rejection when change_type is not 'update'");
  });

  it("rejects payload missing required fields", () => {
    const { record_id: _omit, ...payload } = validWebhookPayload;
    const result = AirtableApprovedWebhookSchema.safeParse(payload);
    assert.equal(result.success, false, "Expected rejection when record_id is missing");
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. Queue message validation
// ---------------------------------------------------------------------------
describe("AirtableApprovedQueueMessageSchema", () => {
  it("accepts a valid references-only queue message", () => {
    const result = AirtableApprovedQueueMessageSchema.safeParse(validQueueMessage);
    assert.ok(result.success, `Expected parse success but got: ${JSON.stringify(result)}`);
    assert.equal(result.data?.event_type, "airtable.post.approved.ingress");
  });

  it("rejects queue message with approved_version field", () => {
    const msg = { ...validQueueMessage, approved_version: 1 };
    const result = AirtableApprovedQueueMessageSchema.safeParse(msg);
    assert.equal(result.success, false, "Expected rejection when approved_version is present");
  });

  it("rejects queue message with master_copy field", () => {
    const msg = { ...validQueueMessage, master_copy: "Campaign copy text" };
    const result = AirtableApprovedQueueMessageSchema.safeParse(msg);
    assert.equal(result.success, false, "Expected rejection when master_copy is present");
  });

  it("rejects queue message with cta_url field", () => {
    const msg = { ...validQueueMessage, cta_url: "https://example.com" };
    const result = AirtableApprovedQueueMessageSchema.safeParse(msg);
    assert.equal(result.success, false, "Expected rejection when cta_url is present");
  });

  it("rejects queue message with asset_links field", () => {
    const msg = { ...validQueueMessage, asset_links: [] };
    const result = AirtableApprovedQueueMessageSchema.safeParse(msg);
    assert.equal(result.success, false, "Expected rejection when asset_links is present");
  });

  it("rejects queue message with access_token field", () => {
    const msg = { ...validQueueMessage, access_token: "EAAxxxxxx" };
    const result = AirtableApprovedQueueMessageSchema.safeParse(msg);
    assert.equal(result.success, false, "Expected rejection when access_token is present");
  });

  it("rejects queue message with secret_ref field", () => {
    const msg = { ...validQueueMessage, secret_ref: "vault://prod/token" };
    const result = AirtableApprovedQueueMessageSchema.safeParse(msg);
    assert.equal(result.success, false, "Expected rejection when secret_ref is present");
  });

  it("rejects queue message with wrong event_type", () => {
    const msg = { ...validQueueMessage, event_type: "airtable.post.created" };
    const result = AirtableApprovedQueueMessageSchema.safeParse(msg);
    assert.equal(result.success, false, "Expected rejection for wrong event_type");
  });

  it("rejects queue message with wrong event_version", () => {
    const msg = { ...validQueueMessage, event_version: 2 };
    const result = AirtableApprovedQueueMessageSchema.safeParse(msg);
    assert.equal(result.success, false, "Expected rejection for wrong event_version");
  });

  it("rejects queue message missing correlation_id", () => {
    const { correlation_id: _omit, ...msg } = validQueueMessage;
    const result = AirtableApprovedQueueMessageSchema.safeParse(msg);
    assert.equal(result.success, false, "Expected rejection when correlation_id is missing");
  });
});

// ---------------------------------------------------------------------------
// 5. Idempotency helpers
// ---------------------------------------------------------------------------
describe("idempotency helpers", () => {
  it("createIngressIdempotencyKey returns correct format", () => {
    const key = createIngressIdempotencyKey("evt_abc123");
    assert.equal(key, "airtable.webhook.ingress:evt_abc123");
  });

  it("createWorkflowIdempotencyKey returns correct format", () => {
    const key = createWorkflowIdempotencyKey({
      workspaceId: "workspace_001",
      airtableRecordId: "recXXXX",
      approvedVersion: 3
    });
    assert.equal(key, "airtable.post.approved:workspace_001:recXXXX:3");
  });

  it("createIngressIdempotencyKey is deterministic for same input", () => {
    const key1 = createIngressIdempotencyKey("evt_xyz");
    const key2 = createIngressIdempotencyKey("evt_xyz");
    assert.equal(key1, key2);
  });

  it("createWorkflowIdempotencyKey differentiates workspace_id", () => {
    const key1 = createWorkflowIdempotencyKey({ workspaceId: "ws_A", airtableRecordId: "rec1", approvedVersion: 1 });
    const key2 = createWorkflowIdempotencyKey({ workspaceId: "ws_B", airtableRecordId: "rec1", approvedVersion: 1 });
    assert.notEqual(key1, key2);
  });

  it("createWorkflowIdempotencyKey differentiates approved_version", () => {
    const key1 = createWorkflowIdempotencyKey({ workspaceId: "ws_A", airtableRecordId: "rec1", approvedVersion: 1 });
    const key2 = createWorkflowIdempotencyKey({ workspaceId: "ws_A", airtableRecordId: "rec1", approvedVersion: 2 });
    assert.notEqual(key1, key2);
  });
});
