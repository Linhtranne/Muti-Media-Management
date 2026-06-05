import type pg from "pg";
import type { QueuePublisher } from "../queue/rabbitmqPublisher.js";
import type { CommentSyncWorkerRepository } from "../ledger/commentSyncWorkerRepository.js";
import type { CommentIngestEvent } from "@mediaops/shared-contracts";

export class FacebookCommentSyncWorker {
  constructor(
    private readonly dbPool: pg.Pool,
    private readonly repo: CommentSyncWorkerRepository,
    private readonly publisher: QueuePublisher,
    private readonly slackChannels: { inboxChannelId?: string; crisisChannelId?: string } = {}
  ) {}

  async processIngestEvent(event: CommentIngestEvent): Promise<void> {
    const client = await this.dbPool.connect();
    let alertToPublish: {
      interactionId: string;
      alertType: "comment_risk" | "comment_normal";
      channelId: string;
    } | null = null;
    
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL app.current_workspace_id = $1", [event.workspace_id]);

      // 1. Idempotency Check
      const alreadyProcessed = await this.repo.checkIngestIdempotency(client, event.event_id);
      if (alreadyProcessed) {
        await client.query("ROLLBACK");
        return; // ACK immediately
      }

      // 2. Use risk code classified from the full MCP comment body before queue truncation.
      const riskCode = event.risk_code;

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
      const channelId = riskCode === "CRISIS"
        ? this.slackChannels.crisisChannelId
        : this.slackChannels.inboxChannelId;
      
      const insertedAlert = await this.repo.recordSlackAlert(
        client,
        interaction.id,
        event.workspace_id,
        channelId ?? null,
        channelType,
        alertType,
        channelId ? "pending" : "pending_config"
      );

      if (insertedAlert && channelId) {
        alertToPublish = {
          interactionId: interaction.id,
          alertType,
          channelId
        };
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

    if (alertToPublish) {
      await this.publishSlackAlertAfterCommit(event, alertToPublish);
    }
  }

  private async publishSlackAlertAfterCommit(
    event: CommentIngestEvent,
    alert: { interactionId: string; alertType: "comment_risk" | "comment_normal"; channelId: string }
  ): Promise<void> {
    try {
      await this.publisher.publishSlackAlert(
        {
          event_id: `slack_alert_${event.event_id}`,
          event_type: "alerts.slack.send",
          event_version: 1,
          workspace_id: event.workspace_id,
          channel_id: alert.channelId,
          alert_type: alert.alertType,
          interaction_id: alert.interactionId,
          metadata: {
            platform: "facebook",
            comment_preview: event.comment_preview,
            author_name: event.author_ref.name,
            permalink: event.permalink,
            risk_code: event.risk_code
          },
          idempotency_key: `slack_alert:interaction:${alert.interactionId}`,
          correlation_id: event.correlation_id,
          causation_id: event.event_id
        },
        `slack_alert_${event.event_id}`,
        event.correlation_id
      );

      await this.updateAlertStatus(event.workspace_id, alert.interactionId, "sent");
    } catch {
      await this.updateAlertStatus(event.workspace_id, alert.interactionId, "failed");
    }
  }

  private async updateAlertStatus(
    workspaceId: string,
    interactionId: string,
    status: "sent" | "failed"
  ): Promise<void> {
    const client = await this.dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL app.current_workspace_id = $1", [workspaceId]);
      await this.repo.updateSlackAlertStatus(client, interactionId, workspaceId, status);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (status === "failed") {
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
