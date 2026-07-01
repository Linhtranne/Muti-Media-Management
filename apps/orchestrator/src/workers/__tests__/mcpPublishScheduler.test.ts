import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { McpPublishScheduler } from "../mcpPublishScheduler.js";

const mockDatabase = {
  transaction: mock.fn(async (workspaceId: string, callback: any) => {
    return callback({
      query: mock.fn(async () => ({ rows: [] }))
    });
  })
} as any;

const mockLogger = {
  info: mock.fn(),
  error: mock.fn()
} as any;

const mockQueuePublisher = {
  publishFacebookExecute: mock.fn(async () => undefined)
} as any;

describe("McpPublishScheduler", () => {
  let scheduler: McpPublishScheduler;

  beforeEach(() => {
    mockDatabase.transaction.mock.resetCalls();
    mockQueuePublisher.publishFacebookExecute.mock.resetCalls();
    process.env.US006_EXECUTION_ENABLED = 'true';
    scheduler = new McpPublishScheduler(mockDatabase, mockLogger, "ws-1", mockQueuePublisher);
  });

  it("does nothing if US006_EXECUTION_ENABLED is not true", async () => {
    process.env.US006_EXECUTION_ENABLED = 'false';
    await scheduler.runPollCycle();
    assert.equal(mockDatabase.transaction.mock.calls.length, 0);
  });

  it("queries due jobs and publishes to rabbitmq", async () => {
    // Override the private repository temporarily for test
    (scheduler as any).repository = {
      findDueJobs: mock.fn(async () => [
        {
          id: "job-1",
          workspace_id: "ws-1",
          variant_id: "var-1",
          channel_account_id: "acc-1",
          scheduled_at: new Date().toISOString(),
          workflow_run_id: "run-1"
        }
      ]),
      enqueueExecuteEvent: mock.fn(async (client: any, job: any) => {
        return {
          eventId: "evt-1",
          eventType: "publish.facebook.execute",
          eventVersion: "1",
          workspaceId: job.workspace_id,
          jobId: job.id,
          variantId: job.variant_id,
          channelAccountId: job.channel_account_id,
          scheduledAt: job.scheduled_at,
          idempotencyKey: `idem-${job.id}`,
          correlationId: "corr-1",
          createdAt: new Date().toISOString()
        };
      })
    };

    await scheduler.runPollCycle();
    assert.equal(mockDatabase.transaction.mock.calls.length, 2);
    assert.equal(mockQueuePublisher.publishFacebookExecute.mock.calls.length, 1);
    assert.equal(mockQueuePublisher.publishFacebookExecute.mock.calls[0].arguments[0].jobId, "job-1");
  });

  it("does not publish if event was already enqueued (duplicate)", async () => {
    (scheduler as any).repository = {
      findDueJobs: mock.fn(async () => [
        { id: "job-duplicate", workspace_id: "ws-1" }
      ]),
      enqueueExecuteEvent: mock.fn(async () => null) // duplicate
    };
    
    await scheduler.runPollCycle();
    
    assert.equal(mockDatabase.transaction.mock.calls.length, 2);
  });
});
