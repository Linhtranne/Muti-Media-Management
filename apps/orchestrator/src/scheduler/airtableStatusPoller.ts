import type { AirtableClient } from "../airtable/airtableClient.js";
import type { AirtableWebhookIngestor } from "../services/airtableWebhookIngestor.js";
import type { Logger } from "../lib/logger.js";

const POLLED_STATUSES = ["Approved", "Approved for Publish"] as const;
const AIRTABLE_POSTS_TABLE = "Posts";
const AIRTABLE_CHANGE_TYPE_UPDATE = "update";

function normalizeEventStatus(status: string): string {
  return status.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, "");
}

export class AirtableStatusPoller {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly airtableClient: AirtableClient,
    private readonly ingestor: AirtableWebhookIngestor,
    private readonly logger: Logger,
    private readonly intervalMs: number
  ) {}

  start(): void {
    if (this.interval) {
      return;
    }

    this.logger.info("Starting Airtable status poller", { intervalMs: this.intervalMs });
    void this.runPollCycle();
    this.interval = setInterval(() => {
      void this.runPollCycle();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.interval) {
      return;
    }

    clearInterval(this.interval);
    this.interval = null;
  }

  async runPollCycle(): Promise<void> {
    try {
      if (!this.airtableClient.listPostRecordsByStatus) {
        this.logger.error("Airtable status poller cannot run because listPostRecordsByStatus is unavailable");
        return;
      }

      const records = await this.airtableClient.listPostRecordsByStatus([...POLLED_STATUSES]);
      for (const record of records) {
        const approvedAt = record.fields.approved_at;
        const status = record.fields.status;
        if (!approvedAt || typeof status !== "string" || !POLLED_STATUSES.includes(status as (typeof POLLED_STATUSES)[number])) {
          continue;
        }

        const eventId = `airtable_poll:${record.id}:${approvedAt}:${normalizeEventStatus(status)}`;
        const result = await this.ingestor.ingest({
          event_id: eventId,
          record_id: record.id,
          table_name: AIRTABLE_POSTS_TABLE,
          change_type: AIRTABLE_CHANGE_TYPE_UPDATE,
          approved_at: approvedAt
        });

        if (result.status === "queued") {
          this.logger.info("Airtable status poller queued record", {
            eventId,
            recordId: record.id,
            status
          });
        }
      }
    } catch (error) {
      this.logger.error("Airtable status poller failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
