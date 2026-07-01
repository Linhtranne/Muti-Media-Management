import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { AirtableStatusPoller } from "../scheduler/airtableStatusPoller.js";

describe("AirtableStatusPoller", () => {
  it("queues approved and approved-for-publish records through the webhook ingestor", async () => {
    const airtableClient = {
      async listPostRecordsByStatus(statuses: string[]) {
        assert.deepEqual(statuses, ["Approved", "Approved for Publish"]);
        return [
          {
            id: "rec-1",
            fields: {
              status: "Approved for Publish",
              approved_at: "2026-06-30T09:00:00.000Z"
            }
          }
        ];
      }
    };
    const ingest = mock.fn(async (_payload: unknown) => ({
      status: "queued" as const,
      eventId: "event-1",
      messageId: "message-1"
    }));
    const ingestor = { ingest };
    const logger = {
      info: mock.fn(),
      error: mock.fn()
    };

    const poller = new AirtableStatusPoller(
      airtableClient as never,
      ingestor as never,
      logger as never,
      30_000
    );

    await poller.runPollCycle();

    const calls = ingest.mock.calls;
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].arguments[0], {
      event_id: "airtable_poll:rec-1:2026-06-30T09:00:00.000Z:approved_for_publish",
      record_id: "rec-1",
      table_name: "Posts",
      change_type: "update",
      approved_at: "2026-06-30T09:00:00.000Z"
    });
  });
});
