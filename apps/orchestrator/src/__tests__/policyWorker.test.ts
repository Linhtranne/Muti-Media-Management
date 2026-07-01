import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PolicyWorker } from "../workers/policyWorker.js";
import { PolicyWorkerRepository } from "../ledger/policyWorkerRepository.js";

function validMessage() {
  return {
    event_id: "11111111-1111-4111-8111-111111111111",
    event_type: "policy.evaluate.requested" as const,
    event_version: 1 as const,
    workspace_id: "ws_test_123",
    correlation_id: "corr-1",
    workflow_run_id: "22222222-2222-4222-8222-222222222222",
    ai_generation_run_id: "33333333-3333-4333-8333-333333333333",
    content_variant_id: "44444444-4444-4444-8444-444444444444",
    airtable_record_id: "recPost123",
    platform: "facebook" as const,
    prompt_version: "fb_composer_v1.0.0",
    approved_version: 1,
    idempotency_key: "policy.evaluate.requested:ws_test_123:44444444-4444-4444-8444-444444444444:policy-facebook-v1",
    created_at: "2026-06-01T00:00:00.000Z"
  };
}

function makeWorker(repo: any, events: string[] = []) {
  const database = {
    async transaction(_workspaceId: string, fn: (client: any) => Promise<unknown>) {
      events.push("tx_begin");
      const result = await fn({});
      events.push("tx_commit");
      return result;
    },
    query: async () => ({ rows: [] }),
    getPool: () => ({})
  };
  const airtable = {
    async updatePolicyNeedsReview() {
      events.push("airtable_patch");
    }
  };
  const publisher = {
    async publishFacebookRequest(message: any) {
      events.push("publish_facebook");
      assert.equal(message.event_type, "publish.facebook.requested");
      assert.equal("body" in message, false);
      assert.equal("access_token" in message, false);
    },
    async publishSlackAlert(message: any) {
      events.push("publish_slack");
      assert.deepEqual(message.blocker_codes, ["FORBIDDEN_TERM_DETECTED"]);
    }
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const worker = new PolicyWorker(database as any, airtable as any, logger as any, "ws_test_123", publisher as any);
  (worker as any).repository = repo;
  return worker;
}

function makeWorkerWithAirtableFailure(repo: any, events: string[] = []) {
  const database = {
    async transaction(_workspaceId: string, fn: (client: any) => Promise<unknown>) {
      events.push("tx_begin");
      const result = await fn({});
      events.push("tx_commit");
      return result;
    },
    query: async () => ({ rows: [] }),
    getPool: () => ({})
  };
  const airtable = {
    async updatePolicyNeedsReview() {
      events.push("airtable_patch_failed");
      throw new Error("Airtable failed api_key=secret");
    }
  };
  const publisher = {
    async publishFacebookRequest() {},
    async publishSlackAlert() {
      events.push("publish_slack");
    }
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const worker = new PolicyWorker(database as any, airtable as any, logger as any, "ws_test_123", publisher as any);
  (worker as any).repository = repo;
  return worker;
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    variant: {
      id: "44444444-4444-4444-8444-444444444444",
      workspace_id: "ws_test_123",
      workflow_run_id: "22222222-2222-4222-8222-222222222222",
      ai_generation_run_id: "33333333-3333-4333-8333-333333333333",
      airtable_record_id: "recPost123",
      post_id: "post-1",
      body: "Clean body with https://example.com?utm_source=fb",
      hashtags: ["#brand"],
      cta_url: "https://example.com?utm_source=fb",
      approval_status: "needs_review",
      policy_status: "pending_policy",
      ...overrides
    },
    workflow: {
      id: "22222222-2222-4222-8222-222222222222",
      status: "ai_generation_completed",
      approved_version: 1
    },
    channelAccount: {
      id: "77777777-7777-4777-8777-777777777777",
      status: "active",
      token_status: "valid"
    },
    workspaceConfig: {
      autoPublishEnabled: true,
      autoApproveEnabled: true,
      utmWarnOnly: true,
      forbiddenTerms: []
    }
  };
}

describe("PolicyWorker", () => {
  it("happy path creates publish handoff only after durable transaction", async () => {
    const events: string[] = [];
    const repo = {
      async getExistingResult() { return null; },
      async loadAndLockContext() { return context(); },
      async persistEvaluation(_client: any, _workspaceId: string, _message: any, _context: any, evaluation: any) {
        assert.equal(evaluation.allowed, true);
        return {
          status: "persisted",
          allowed: true,
          resultId: "result-1",
          publishEvent: {
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
          }
        };
      },
      async markIneligible() {}
    };

    const worker = makeWorker(repo, events);
    const result = await worker.processQueueMessage(validMessage(), "msg-1");

    assert.equal(result.action, "ack");
    assert.deepEqual(events, ["tx_begin", "tx_commit", "publish_facebook"]);
  });

  it("block path persists result then updates Airtable and publishes Slack alert", async () => {
    const events: string[] = [];
    process.env.POLICY_BLOCK_SLACK_CHANNEL_ID = "C_POLICY";
    const repo = {
      async getExistingResult() { return null; },
      async loadAndLockContext() { return context({ body: "Nội dung cờ bạc" }); },
      async persistEvaluation(_client: any, _workspaceId: string, _message: any, _context: any, evaluation: any) {
        assert.equal(evaluation.allowed, false);
        return {
          status: "persisted",
          allowed: false,
          resultId: "result-1",
          blockers: evaluation.blockers,
          warnings: evaluation.warnings
        };
      },
      async markIneligible() {}
    };

    const worker = makeWorker(repo, events);
    const result = await worker.processQueueMessage(validMessage(), "msg-1");

    assert.equal(result.action, "ack");
    assert.equal(result.status, "policy_rejected");
    assert.deepEqual(events, ["tx_begin", "tx_commit", "airtable_patch", "publish_slack"]);
  });

  it("duplicate event ACKs without side effects", async () => {
    const events: string[] = [];
    const repo = {
      async getExistingResult() { return { id: "existing-result" }; }
    };

    const worker = makeWorker(repo, events);
    const result = await worker.processQueueMessage(validMessage(), "msg-1");

    assert.deepEqual(result, { action: "ack", status: "duplicate" });
    assert.deepEqual(events, ["tx_begin", "tx_commit"]);
  });

  it("DB failure before commit returns NACK requeue", async () => {
    const worker = makeWorker({
      async getExistingResult() {
        throw new Error("db timeout api_key=secret");
      }
    });

    const result = await worker.processQueueMessage(validMessage(), "msg-1");
    assert.equal(result.action, "nack_requeue");
  });

  it("Airtable failure after Ledger commit marks compensation and still ACKs", async () => {
    const events: string[] = [];
    const repo = {
      async getExistingResult() { return null; },
      async loadAndLockContext() { return context({ body: "Nội dung cờ bạc" }); },
      async persistEvaluation(_client: any, _workspaceId: string, _message: any, _context: any, evaluation: any) {
        return {
          status: "persisted",
          allowed: false,
          resultId: "result-1",
          blockers: evaluation.blockers,
          warnings: evaluation.warnings
        };
      },
      async markAirtableSyncRetryNeeded(_client: any, _workspaceId: string, resultId: string, errorMessage: string) {
        events.push("compensation_marked");
        assert.equal(resultId, "result-1");
        assert.equal(errorMessage.includes("secret"), false);
      },
      async markIneligible() {}
    };

    const worker = makeWorkerWithAirtableFailure(repo, events);
    const result = await worker.processQueueMessage(validMessage(), "msg-1");

    assert.equal(result.action, "ack");
    assert.deepEqual(events, ["tx_begin", "tx_commit", "airtable_patch_failed", "tx_begin", "compensation_marked", "tx_commit", "publish_slack"]);
  });

  it("loads only active Facebook channel accounts with valid token status", async () => {
    const queries: string[] = [];
    const repository = new PolicyWorkerRepository();
    const client = {
      async query(text: string) {
        queries.push(text);
        if (text.includes("FROM content_variants")) {
          return { rows: [context().variant] };
        }
        if (text.includes("FROM workflow_runs")) {
          return { rows: [context().workflow] };
        }
        if (text.includes("FROM channel_accounts")) {
          return { rows: [context().channelAccount] };
        }
        return { rows: [] };
      }
    };

    await repository.loadAndLockContext(client as any, "ws_test_123", validMessage());

    const channelQuery = queries.find((query) => query.includes("FROM channel_accounts"));
    assert.ok(channelQuery);
    assert.match(channelQuery, /lower\(platform\) = 'facebook'/);
    assert.match(channelQuery, /status = 'active'/);
    assert.match(channelQuery, /token_status = 'valid'/);
  });
});
