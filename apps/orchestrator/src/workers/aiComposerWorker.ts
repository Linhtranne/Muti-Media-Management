import type { Database } from "../ledger/postgres.js";
import type { AirtableClient } from "../airtable/airtableClient.js";
import type { Logger } from "../lib/logger.js";
import { NotionClient, NotionSsrfError, NotionFetchError } from "../services/notionClient.js";
import { getPromptTemplate } from "../ai/promptRegistry.js";
import type { LlmAdapter } from "../ai/llmAdapter.js";
import { validateStructuredOutput, ValidationError } from "../ai/structuredValidator.js";
import { AiWorkerRepository } from "../ledger/aiWorkerRepository.js";
import { createHash, randomUUID } from "node:crypto";
import { LlmTimeoutError, LlmRateLimitError } from "../ai/llmAdapter.js";
import type { AiComposerQueueMessage } from "@mediaops/shared-contracts";
import { redact } from "../lib/redact.js";

export type AiWorkerResult = {
  success: boolean;
  status: string;
  variantId?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type AiQueueWorkerResult = {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
  errorCode?: string;
};

export class AiComposerWorker {
  private readonly repository = new AiWorkerRepository();
  private readonly notionClient = new NotionClient();
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: Database,
    private readonly airtableClient: AirtableClient,
    private readonly llmAdapter: LlmAdapter,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly promptVersion: string = "fb_composer_v1.0.0",
    private readonly airtableFieldMap: {
      variant_draft: string;
      variant_hashtags: string;
      variant_cta_url: string;
      ai_generation_status: string;
      ai_review_notes: string;
      ledger_variant_id: string;
    }
  ) {}

  start(intervalMs: number = 5000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info("AI Composer background SMM worker started", { intervalMs });

    const poll = async () => {
      try {
        await this.pollAndProcess();
      } catch (err) {
        this.logger.error("Error in AI Composer polling loop", { error: String(err) });
      }
      if (this.isRunning) {
        this.intervalId = setTimeout(poll, intervalMs);
      }
    };

    this.intervalId = setTimeout(poll, intervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    this.logger.info("AI Composer background SMM worker stopped");
  }

  async pollAndProcess(): Promise<void> {
    // Check for any pending_ai_generation workflows in database
    const pendingRuns = await this.database.query<{ id: string }>(
      `SELECT id FROM workflow_runs 
       WHERE workspace_id = $1 AND status = 'pending_ai_generation'
       ORDER BY created_at ASC`,
      [this.workspaceId]
    );

    for (const row of pendingRuns.rows) {
      this.logger.info("Found eligible workflow run for AI Composer", { workflow_run_id: row.id });
      await this.processWorkflowRun(row.id);
    }
  }

  async processWorkflowRun(workflowRunId: string): Promise<AiWorkerResult> {
    const correlationId = randomUUID();
    this.logger.info("AI Composer processing workflow run", { workflowRunId, correlationId });

    // ──────────────────────────────────────────────
    // 1. Claim Workflow Run (Transaction A)
    // ──────────────────────────────────────────────
    let claim;
    try {
      claim = await this.database.transaction(this.workspaceId, async (client) => {
        return this.repository.claimWorkflowRun(
          client,
          this.workspaceId,
          workflowRunId,
          this.promptVersion,
          "gemini",
          "gemini-2.5-pro"
        );
      });
    } catch (err) {
      this.logger.error("Failed to claim workflow run", { workflowRunId, error: String(err) });
      return { success: false, status: "claim_failed", errorMessage: String(err) };
    }

    const { success, alreadyCompleted, aiGenerationRunId, approvedVersion, airtableRecordId, existingOutput } = claim;

    if (alreadyCompleted) {
      this.logger.info("AI generation already completed, fast-pass skip", { workflowRunId, aiGenerationRunId });
      return { success: true, status: "completed" };
    }

    if (!success || !aiGenerationRunId || !airtableRecordId || approvedVersion === undefined) {
      this.logger.warn("Could not claim workflow run or no active generation run created", { workflowRunId });
      return { success: false, status: "claim_skipped" };
    }

    // ──────────────────────────────────────────────
    // 2. Reload Airtable & Revalidate (Zero-Trust)
    // ──────────────────────────────────────────────
    let postRecord;
    try {
      postRecord = await this.airtableClient.getPostRecord(airtableRecordId);
    } catch (err) {
      this.logger.error("Airtable Post reload failed", { airtableRecordId, error: String(err) });
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.markFailed(
          client,
          this.workspaceId,
          workflowRunId,
          aiGenerationRunId,
          "AIRTABLE_CONTEXT_UNREACHABLE",
          `Failed to reload Airtable post: ${String(redact(String(err)))}`,
          "failed"
        );
      });
      return { success: false, status: "airtable_reload_failed", errorCode: "AIRTABLE_CONTEXT_UNREACHABLE" };
    }

    const fields = postRecord.fields;

    // Check status is still compatible (Approved)
    if (fields.status !== "Approved") {
      this.logger.warn("Airtable post status changed after approval, aborting AI Composer", {
        airtableRecordId,
        current_status: fields.status
      });
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.markFailed(
          client,
          this.workspaceId,
          workflowRunId,
          aiGenerationRunId,
            "STALE_SOURCE_STATUS_CHANGED",
          `Status changed to '${fields.status}' in Airtable`,
          "failed"
        );
      });
      return { success: false, status: "status_changed", errorCode: "STALE_SOURCE_STATUS_CHANGED" };
    }

    // Check target channels contain Facebook
    const channels = fields.target_channels || [];
    if (!channels.includes("Facebook")) {
      this.logger.warn("Post target channels does not explicitly contain Facebook", { airtableRecordId, channels });
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.markFailed(
          client,
          this.workspaceId,
          workflowRunId,
          aiGenerationRunId,
          "AIRTABLE_CONTEXT_INVALID",
          "Target channels does not contain Facebook",
          "failed"
        );
      });
      return { success: false, status: "channels_invalid", errorCode: "AIRTABLE_CONTEXT_INVALID" };
    }

    // Check master copy exists
    if (!fields.master_copy) {
      this.logger.warn("Post master copy is empty", { airtableRecordId });
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.markFailed(
          client,
          this.workspaceId,
          workflowRunId,
          aiGenerationRunId,
          "AIRTABLE_CONTEXT_INVALID",
          "Master copy is missing or empty",
          "failed"
        );
      });
      return { success: false, status: "master_copy_empty", errorCode: "AIRTABLE_CONTEXT_INVALID" };
    }

    // ──────────────────────────────────────────────
    // 3. Load Notion Context (Optional & Hardened Allowlist)
    // ──────────────────────────────────────────────
    let notionBrief = null;
    let notionContextRefs: any[] = [];

    if (fields.campaign_id && fields.campaign_id.length > 0) {
      const campaignId = fields.campaign_id[0];
      try {
        const campaign = await this.airtableClient.fetchCampaignRecord(campaignId);
        
        if (campaign.notion_brief_url) {
          try {
            this.logger.info("Loading Notion campaign brief context", { notion_url: campaign.notion_brief_url });
            // Retrieve notion token from env
            const token = process.env.NOTION_TOKEN;
            notionBrief = await this.notionClient.fetchNotionBrief(campaign.notion_brief_url, token);
            
            notionContextRefs.push({
              notion_brief_url: campaign.notion_brief_url,
              load_status: "success",
              ai_ready: true
            });
          } catch (notionErr: unknown) {
            this.logger.warn("Notion brief fetch failed, attempting fallback", {
              notion_url: campaign.notion_brief_url,
              error: String(notionErr)
            });

            const isSsrf = notionErr instanceof NotionSsrfError;
            const errCode = isSsrf ? "NOTION_NOT_ALLOWLISTED" : "CONTEXT_UNREACHABLE";

            notionContextRefs.push({
              notion_brief_url: campaign.notion_brief_url,
              load_status: "failed",
              ai_ready: false,
              fallback_source: "campaign_objective",
              error_code: errCode,
              error_message: String(redact(String(notionErr)))
            });

            // Fallback: If campaign has objective, use it, otherwise throw/fail
            if (campaign.campaign_objective) {
              notionBrief = {
                brief_summary: campaign.campaign_objective,
                brand_voice: "Professional, engaging, modern",
                do_terms: [],
                avoid_terms: [],
                legal_notes: ""
              };
            } else {
              throw notionErr; // Trigger failure state if no fallback objective
            }
          }
        }
      } catch (campaignErr) {
        this.logger.error("Failed to load campaign brief details", { campaignId, error: String(campaignErr) });
        // Notion loading failed completely with no fallback objective available
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.markFailed(
            client,
            this.workspaceId,
            workflowRunId,
            aiGenerationRunId,
            "CONTEXT_UNREACHABLE",
            `Notion campaign brief context loading failed completely: ${String(redact(String(campaignErr)))}`,
            "needs_manual_review"
          );
        });
        return { success: false, status: "notion_context_failed", errorCode: "CONTEXT_UNREACHABLE" };
      }
    }

    // ──────────────────────────────────────────────
    // 4. Construct Prompt
    // ──────────────────────────────────────────────
    const promptTemplate = getPromptTemplate(this.promptVersion);
    const promptContext = {
      masterCopy: fields.master_copy,
      ctaUrl: fields.cta_url,
      campaignObjective: notionBrief?.brief_summary || "General brand awareness",
      briefSummary: notionBrief?.brief_summary || null,
      brandVoice: notionBrief?.brand_voice || null,
      doTerms: notionBrief?.do_terms || null,
      avoidTerms: notionBrief?.avoid_terms || null,
      legalNotes: notionBrief?.legal_notes || null
    };

    const systemPrompt = promptTemplate.systemPrompt;
    const userPrompt = promptTemplate.userPrompt(promptContext);

    // Update input snapshot and notion refs in database
    await this.database.query(
      `UPDATE ai_generation_runs 
       SET input_snapshot = $3::jsonb, notion_context_refs = $4::jsonb 
       WHERE id = $1 AND workspace_id = $2`,
      [aiGenerationRunId, this.workspaceId, JSON.stringify(promptContext), JSON.stringify(notionContextRefs)]
    );

    // ──────────────────────────────────────────────
    // 5. Call AI Provider (Adapter with Retries)
    // ──────────────────────────────────────────────
    let generatedText: string;
    try {
      const scenario = (process.env.MOCK_LLM_SCENARIO || "happy") as any;
      generatedText = await this.llmAdapter.generateContent(systemPrompt, userPrompt, {
        timeoutMs: 30_000,
        mockScenario: scenario
      });
    } catch (err: unknown) {
      this.logger.error("LLM Provider call failed", { error: String(err) });
      const isRateLimit = err instanceof LlmRateLimitError;
      const isTimeout = err instanceof LlmTimeoutError;

      const errCode = isRateLimit 
        ? "PROVIDER_RATE_LIMIT" 
        : isTimeout 
          ? "PROVIDER_TIMEOUT" 
          : "INVALID_MODEL_CONFIG";

      const runStatus = (isRateLimit || isTimeout) ? "retryable_failed" : "failed";

      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.markFailed(
          client,
          this.workspaceId,
          workflowRunId,
          aiGenerationRunId,
          errCode,
          `LLM provider error: ${String(redact(String(err)))}`,
          runStatus
        );
      });

      return { success: false, status: "llm_failed", errorCode: errCode };
    }

    // ──────────────────────────────────────────────
    // 6. Validate Structured Output
    // ──────────────────────────────────────────────
    let validatedOutput;
    try {
      validatedOutput = validateStructuredOutput(generatedText, fields.cta_url);
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        this.logger.warn("Structured output validation failed", {
          errorCode: err.errorCode,
          message: err.message
        });

        const status = err.errorCode === "PROMPT_INJECTION_DETECTED" ? "failed" : "needs_manual_review";
        const outputSnapshot = err.errorCode === "PROMPT_INJECTION_DETECTED"
          ? {
              rawOutputHash: createHash("sha256").update(generatedText).digest("hex"),
              sanitizedFailure: true as const,
              errorCode: err.errorCode
            }
          : undefined;

        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.markFailed(
            client,
            this.workspaceId,
            workflowRunId,
            aiGenerationRunId,
            err.errorCode,
            err.message,
            status,
            outputSnapshot
          );
        });

        // Sync failure status to Airtable
        try {
          await this.airtableClient.updateVariantDraft(
            airtableRecordId,
            "N/A",
            {
              variant_draft: "",
              variant_hashtags: [],
              ai_generation_status: "Review Blocked",
              ai_review_notes: `AI validation failed: [${err.errorCode}] ${String(redact(err.message))}`
            },
            this.airtableFieldMap
          );
        } catch (airtableErr) {
          this.logger.error("Failed to sync validation error to Airtable", { airtableErr });
        }

        return { success: false, status: "validation_failed", errorCode: err.errorCode };
      }

      // Unexpected error during validation
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.markFailed(
          client,
          this.workspaceId,
          workflowRunId,
          aiGenerationRunId,
          "SCHEMA_PARSING_FAILED",
          `Unexpected validation error: ${String(redact(String(err)))}`,
          "needs_manual_review"
        );
      });
      return { success: false, status: "validation_failed", errorCode: "SCHEMA_PARSING_FAILED" };
    }

    // ──────────────────────────────────────────────
    // 7. Persist Results & outbox (Transaction B)
    // ──────────────────────────────────────────────
    let variantId: string;
    try {
      variantId = await this.database.transaction(this.workspaceId, async (client) => {
        return this.repository.markCompleted(
          client,
          this.workspaceId,
          workflowRunId,
          aiGenerationRunId,
          airtableRecordId,
          approvedVersion,
          this.promptVersion,
          validatedOutput,
          correlationId,
          fields.post_id || airtableRecordId,
          false // sync_retry_needed initially false, will set to true if Airtable sync fails
        );
      });
    } catch (err) {
      this.logger.error("Failed to persist variant and complete AI run in database", { error: String(err) });
      return { success: false, status: "persistence_failed", errorMessage: String(err) };
    }

    // ──────────────────────────────────────────────
    // 8. Sync Variant Draft to Airtable (Out-of-Transaction)
    // ──────────────────────────────────────────────
    this.logger.info("Syncing generated AI variant to Airtable", { airtableRecordId, variantId });
    try {
      const latestPost = await this.airtableClient.getPostRecord(airtableRecordId);
      if (latestPost.fields.status !== "Approved") {
        throw new Error(`Airtable optimistic guard failed: status is ${latestPost.fields.status ?? "unknown"}`);
      }

      await this.airtableClient.updateVariantDraft(
        airtableRecordId,
        variantId,
        {
          variant_draft: validatedOutput.body,
          variant_hashtags: validatedOutput.hashtags,
          variant_cta_url: validatedOutput.cta_url || null,
          ai_generation_status: "Needs Review",
          ai_review_notes: `AI Composer generated Facebook variant successfully using prompt version ${this.promptVersion}.`
        },
        this.airtableFieldMap
      );
      this.logger.info("Successfully synced variant to Airtable", { airtableRecordId });
    } catch (airtableErr) {
      this.logger.error("Airtable variant sync failed. Setting sync_retry_needed = true in Ledger.", {
        airtableRecordId,
        error: String(airtableErr)
      });

      // Compensating Transaction: Mark sync_retry_needed = true
      try {
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.updateVariantSyncStatus(client, this.workspaceId, variantId, true);
        });
      } catch (dbErr) {
        this.logger.error("Failed to mark sync_retry_needed in Ledger!", { variantId, dbErr });
      }
    }

    return { success: true, status: "completed", variantId };
  }

  async processQueueMessage(message: AiComposerQueueMessage, messageId: string): Promise<AiQueueWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("AI Composer queue message workspace mismatch", {
        messageId,
        message_workspace_id: message.workspace_id,
        worker_workspace_id: this.workspaceId
      });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    const result = await this.processWorkflowRun(message.workflow_run_id);

    if (result.success) {
      return { action: "ack", status: result.status };
    }

    if (result.status === "llm_failed" && (result.errorCode === "PROVIDER_RATE_LIMIT" || result.errorCode === "PROVIDER_TIMEOUT")) {
      return { action: "ack", status: "retryable_failed", errorCode: result.errorCode };
    }

    if (result.status === "persistence_failed" || result.status === "claim_failed") {
      return { action: "nack_requeue", status: result.status, errorCode: result.errorCode };
    }

    return { action: "ack", status: result.status, errorCode: result.errorCode };
  }
}
