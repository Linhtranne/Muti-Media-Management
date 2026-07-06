import { McpPublishSchedulerRepository } from "../ledger/mcpPublishSchedulerRepository.js";
import type { Database } from "../ledger/postgres.js";
import type { Logger } from "../lib/logger.js";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { PublishFacebookExecuteEvent, PublishTiktokExecuteEvent } from "@mediaops/shared-contracts";

export class McpPublishScheduler {
  private readonly repository = new McpPublishSchedulerRepository();

  constructor(
    private readonly database: Database,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly queuePublisher?: Pick<QueuePublisher, "publishFacebookExecute" | "publishTiktokExecute">
  ) {}

  async runPollCycle(): Promise<void> {
    if (process.env.US006_EXECUTION_ENABLED !== 'true') {
      return;
    }

    try {
      const jobs = await this.database.transaction(
        this.workspaceId,
        async (client) => {
          return this.repository.findDueJobs(client);
        }
      );

      for (const job of jobs) {
        // Now process each job in its own tenant context
        try {
          await this.database.transaction(job.workspace_id, async (client) => {
            const executeEvent = await this.repository.enqueueExecuteEvent(client, job);
            if (executeEvent && this.queuePublisher) {
              if (job.platform === "tiktok") {
                const tiktokEvent = executeEvent as PublishTiktokExecuteEvent;
                await this.queuePublisher.publishTiktokExecute(tiktokEvent, tiktokEvent.event_id);
                this.logger.info("Published execute event for job", {
                  jobId: job.id,
                  workspaceId: job.workspace_id,
                  eventId: tiktokEvent.event_id
                });
              } else {
                const facebookEvent = executeEvent as PublishFacebookExecuteEvent;
                await this.queuePublisher.publishFacebookExecute(facebookEvent, facebookEvent.eventId);
                this.logger.info("Published execute event for job", {
                  jobId: job.id,
                  workspaceId: job.workspace_id,
                  eventId: facebookEvent.eventId
                });
              }
            }
          });
        } catch (error: unknown) {
          this.logger.error("Failed to enqueue execute event for job", {
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error: unknown) {
      this.logger.error("MCP Publish Scheduler poll failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
