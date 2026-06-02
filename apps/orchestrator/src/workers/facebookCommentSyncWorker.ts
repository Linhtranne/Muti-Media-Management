import type pg from "pg";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import { CommentSyncWorkerRepository } from "../ledger/commentSyncWorkerRepository.js";
import { CommentRiskClassifier } from "../services/commentRiskClassifier.js";
import type { CommentIngestEvent } from "@mediaops/shared-contracts";

export class FacebookCommentSyncWorker {
  constructor(
    private readonly dbPool: pg.Pool,
    private readonly repo: CommentSyncWorkerRepository,
    private readonly riskClassifier: CommentRiskClassifier,
    private readonly publisher: QueuePublisher
  ) {}

  async processIngestEvent(event: CommentIngestEvent): Promise<void> {
    const client = await this.dbPool.connect();
    
    try {
      await client.query("BEGIN");

      // 1. Idempotency Check
      const alreadyProcessed = await this.repo.checkIngestIdempotency(client, event.event_id);
      if (alreadyProcessed) {
        await client.query("ROLLBACK");
        return; // ACK immediately
      }

      // 2. Classify risk
      const riskCode = this.riskClassifier.classify(event.comment_preview);

      // 3. Upsert Interaction
      const interaction = await this.repo.upsertInteraction(
        client,
        event.workspace_id,
        "facebook",
        event.external_comment_id,
        {
          publish_job_id: event.job_id,
          external_post_id: event.external_post_id,
          author_ref: event.author_ref,
          interaction_type: "comment",
          risk_code: riskCode,
          created_at_platform: event.created_at_platform
        }
      );

      // 4. Upsert Comment details
      await this.repo.upsertComment(client, interaction.id, event.workspace_id, {
        body_preview: event.comment_preview,
        permalink: event.permalink
      });

      // 5. Send Slack alert if this is a newly inserted alert record for this interaction
      const channelType = riskCode === "CRISIS" ? "crisis" : "inbox";
      const alertType = riskCode === "CRISIS" ? "comment_risk" : "comment_normal";
      
      const insertedAlert = await this.repo.recordSlackAlert(
        client,
        interaction.id,
        event.workspace_id,
        "pending", // Unresolved channel ID initially
        channelType,
        alertType
      );

      if (insertedAlert) {
        // Dispatch alert to Slack (alerts.slack.send)
        await this.publisher.publishSlackAlert(
          {
            event_id: `slack_alert_${event.event_id}`,
            event_type: "alerts.slack.send",
            event_version: 1,
            workspace_id: event.workspace_id,
            alert_type: alertType,
            interaction_id: interaction.id,
            metadata: {
              platform: "facebook",
              comment_preview: event.comment_preview,
              author_name: event.author_ref.name,
              permalink: event.permalink
            },
            idempotency_key: `slack_alert:interaction:${interaction.id}`,
            correlation_id: event.correlation_id,
            causation_id: event.event_id
          },
          `slack_alert_${event.event_id}`,
          event.correlation_id
        );
      }

      // 6. Record event idempotency
      await this.repo.recordIngestIdempotency(
        client,
        event.event_id,
        event.event_type,
        event.workspace_id,
        event.job_id,
        event.event_id
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
