/**
 * US-014 Topology Config Tests
 * Verifies all queues, DLQs, and canonical exchange are correctly declared.
 * Uses node:test (not vitest) to match project test runner.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  QUEUE_TOPOLOGY,
  getTopologyByQueue,
  getAllDlqNames,
  getAllQueueNames,
  CANONICAL_TOPIC_EXCHANGE
} from "../../queue/topologyConfig.js";

const EXPECTED_QUEUES = [
  "airtable.webhook.approved",
  "ai.compose.facebook.requested",
  "policy.evaluate.requested",
  "publish.facebook.requested",
  "publish.facebook.validated",
  "publish.facebook.execute",
  "comments.facebook.sync.requested",
  "comments.facebook.ingest",
  "slack.post_approval.requested",
  "slack.comment_action.requested",
  "alerts.slack.send"
];

describe("QUEUE_TOPOLOGY", () => {
  it("contains all 11 expected queues", () => {
    const names = getAllQueueNames();
    for (const q of EXPECTED_QUEUES) {
      assert.ok(names.includes(q), `Expected queue '${q}' in topology but not found. Got: ${names.join(", ")}`);
    }
    assert.ok(names.length >= EXPECTED_QUEUES.length, `Expected at least ${EXPECTED_QUEUES.length} queues, got ${names.length}`);
  });

  it("every queue has a per-queue DLQ named <queue>.dlq", () => {
    for (const entry of QUEUE_TOPOLOGY) {
      assert.equal(
        entry.dlq,
        `${entry.queue}.dlq`,
        `Queue '${entry.queue}' has incorrect DLQ name '${entry.dlq}', expected '${entry.queue}.dlq'`
      );
    }
  });

  it("every queue has retryTtlMs array with at least 3 steps", () => {
    for (const entry of QUEUE_TOPOLOGY) {
      assert.ok(Array.isArray(entry.retryTtlMs), `Queue '${entry.queue}' missing retryTtlMs array`);
      assert.ok(
        entry.retryTtlMs.length >= 3,
        `Queue '${entry.queue}' has ${entry.retryTtlMs.length} retry steps, expected >= 3`
      );
    }
  });

  it("every queue has maxRetries >= 3", () => {
    for (const entry of QUEUE_TOPOLOGY) {
      assert.ok(
        entry.maxRetries >= 3,
        `Queue '${entry.queue}' has maxRetries=${entry.maxRetries}, expected >= 3`
      );
    }
  });

  it("every queue has prefetch >= 1", () => {
    for (const entry of QUEUE_TOPOLOGY) {
      assert.ok(
        entry.prefetch >= 1,
        `Queue '${entry.queue}' has prefetch=${entry.prefetch}, expected >= 1`
      );
    }
  });

  it("every queue has a non-empty workerBinding", () => {
    for (const entry of QUEUE_TOPOLOGY) {
      assert.ok(entry.workerBinding.length > 0, `Queue '${entry.queue}' has empty workerBinding`);
    }
  });

  it("every queue has an ownerUs", () => {
    for (const entry of QUEUE_TOPOLOGY) {
      assert.ok(entry.ownerUs.length > 0, `Queue '${entry.queue}' has empty ownerUs`);
    }
  });

  it("no DLQ has the same name as a main queue (no conflicts)", () => {
    const queueNames = new Set(getAllQueueNames());
    const dlqNames = getAllDlqNames();
    for (const dlq of dlqNames) {
      assert.equal(
        queueNames.has(dlq),
        false,
        `DLQ '${dlq}' conflicts with a main queue name`
      );
    }
  });

  it("canonical topic exchange is mediaops.events.topic", () => {
    assert.equal(CANONICAL_TOPIC_EXCHANGE, "mediaops.events.topic");
  });
});

describe("getTopologyByQueue", () => {
  it("finds publish.facebook.execute as US-006", () => {
    const entry = getTopologyByQueue("publish.facebook.execute");
    assert.ok(entry, "Expected entry for publish.facebook.execute");
    assert.equal(entry.ownerUs, "US-006");
    assert.equal(entry.dlq, "publish.facebook.execute.dlq");
  });

  it("returns undefined for unknown queue", () => {
    assert.equal(getTopologyByQueue("non.existent.queue"), undefined);
  });

  it("finds slack.comment_action.requested as US-009", () => {
    const entry = getTopologyByQueue("slack.comment_action.requested");
    assert.ok(entry, "Expected entry for slack.comment_action.requested");
    assert.equal(entry.ownerUs, "US-009");
  });

  it("finds slack.post_approval.requested as US-008", () => {
    const entry = getTopologyByQueue("slack.post_approval.requested");
    assert.ok(entry, "Expected entry for slack.post_approval.requested");
    assert.equal(entry.ownerUs, "US-008");
  });

  it("finds airtable.webhook.approved as US-002", () => {
    const entry = getTopologyByQueue("airtable.webhook.approved");
    assert.ok(entry, "Expected entry for airtable.webhook.approved");
    assert.equal(entry.ownerUs, "US-002");
  });

  it("finds ai.compose.facebook.requested as US-003", () => {
    const entry = getTopologyByQueue("ai.compose.facebook.requested");
    assert.ok(entry, "Expected entry for ai.compose.facebook.requested");
    assert.equal(entry.ownerUs, "US-003");
  });
});
