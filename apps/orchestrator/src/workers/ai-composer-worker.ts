import type { Database } from "../ledger/postgres.js";
import type { AirtableClient } from "../airtable/airtableClient.js";
import type { Logger } from "../lib/logger.js";
import { loadNotionContext } from "../ai/notion-context-loader.js";
import { getPromptTemplate } from "../ai/prompt-registry.js";
import type { LlmAdapter, LlmGenerateOptions } from "../ai/llmAdapter.js";
import { validateStructuredOutput, ValidationError } from "../ai/structuredValidator.js";
import { AiWorkerRepository, type MarkAiCompletedResult } from "../ledger/aiWorkerRepository.js";
import { createHash, randomUUID } from "node:crypto";
import { LlmTimeoutError, LlmRateLimitError } from "../ai/llmAdapter.js";
import type { AiErrorCode, AiComposerQueueMessage, AirtableAttachment } from "@mediaops/shared-contracts";
import { NotionContextRefSchema } from "@mediaops/shared-contracts";

const AI_ERROR_MESSAGE_MAX_LENGTH = 255;
const SSRF_PREVENTION_ERROR_FRAGMENT = "SSRF prevention triggered";
const INVALID_NOTION_PAGE_ID_SSRF_MESSAGE = "Invalid Notion Page ID - SSRF prevention triggered";
const UNKNOWN_LOADER_ERROR = "Unknown loader error";
const DEFAULT_CAMPAIGN_OBJECTIVE = "General brand awareness";
const REVIEW_BLOCKED_STATUS = "Review Blocked";
const AI_GENERATION_NEEDS_REVIEW_STATUS = "needs_review";
const AIRTABLE_POST_NEEDS_REVIEW_STATUS = "Needs Review";
const NOT_APPLICABLE_VARIANT_ID = "N/A";
const AI_VALIDATION_FAILED_NOTE_PREFIX = "AI validation failed";
const AI_COMPOSER_SUCCESS_NOTE_PREFIX = "AI Composer generated Facebook variant successfully using prompt version";
const NOTION_CONTEXT_FAILED_PREFIX = "Notion context failed";
const MIN_TARGET_LENGTH = 1;
const MAX_TARGET_WORD_COUNT = 5_000;
const MAX_TARGET_CHARACTER_COUNT = 63_206;
const WORD_COUNT_LENGTH_INSTRUCTION_PREFIX = "Write the Facebook body at approximately";
const WORD_COUNT_LENGTH_INSTRUCTION_SUFFIX = "words. Stay close to this requested length while preserving the master copy intent.";
const CHARACTER_COUNT_LENGTH_INSTRUCTION_PREFIX = "Write the Facebook body at approximately";
const CHARACTER_COUNT_LENGTH_INSTRUCTION_SUFFIX = "characters. Stay close to this requested length while preserving the master copy intent.";

function buildAiValidationFailedNote(errorCode: AiErrorCode, message: string): string {
  return `${AI_VALIDATION_FAILED_NOTE_PREFIX}: [${errorCode}] ${String(redact(message))}`;
}

function buildAiComposerSuccessNote(promptVersion: string): string {
  return `${AI_COMPOSER_SUCCESS_NOTE_PREFIX} ${promptVersion}.`;
}

function parsePositiveInteger(value: number | string | null | undefined, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(numericValue) || numericValue < MIN_TARGET_LENGTH || numericValue > max) {
    return null;
  }
  return numericValue;
}

function buildLengthInstruction(fields: AirtableFields): string | null {
  const wordCount = parsePositiveInteger(
    fields.desired_word_count ?? fields.target_word_count ?? fields.word_count,
    MAX_TARGET_WORD_COUNT
  );
  if (wordCount !== null) {
    return `${WORD_COUNT_LENGTH_INSTRUCTION_PREFIX} ${wordCount} ${WORD_COUNT_LENGTH_INSTRUCTION_SUFFIX}`;
  }

  const characterCount = parsePositiveInteger(
    fields.desired_character_count ?? fields.target_character_count ?? fields.character_count,
    MAX_TARGET_CHARACTER_COUNT
  );
  if (characterCount !== null) {
    return `${CHARACTER_COUNT_LENGTH_INSTRUCTION_PREFIX} ${characterCount} ${CHARACTER_COUNT_LENGTH_INSTRUCTION_SUFFIX}`;
  }

  return null;
}

type AirtableAssetLinks = string | string[] | AirtableAttachment[] | null | undefined;

interface AssetLinkRef {
  url: string;
  filename?: string;
  mimeType?: string;
}

function isAirtableAttachment(value: unknown): value is AirtableAttachment {
  return typeof value === "object" && value !== null && "url" in value && typeof (value as { url?: unknown }).url === "string";
}

function normalizeAssetLinks(assetLinks: AirtableAssetLinks): AssetLinkRef[] {
  const links = Array.isArray(assetLinks) ? assetLinks : (assetLinks ? assetLinks.split(/[\n,]+/) : []);
  return links
    .map((link) => isAirtableAttachment(link)
      ? { url: link.url.trim(), filename: link.filename, mimeType: link.type }
      : { url: link.trim() })
    .filter((link) => {
      try {
        const url = new URL(link.url);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    });
}
import { z } from "zod";
import { redact } from "../lib/redact.js";

export interface AiWorkerResult {
  success: boolean;
  status: string;
  variantId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface AiQueueWorkerResult {
  action: "ack" | "nack_requeue" | "nack_dlq";
  status: string;
  errorCode?: string;
}

interface AirtableFields {
  status?: string;
  target_channels?: string[];
  master_copy?: string;
  campaign_id?: string[];
  cta_url?: string;
  post_id?: string;
  asset_links?: AirtableAssetLinks;
  desired_word_count?: number | string | null;
  target_word_count?: number | string | null;
  word_count?: number | string | null;
  desired_character_count?: number | string | null;
  target_character_count?: number | string | null;
  character_count?: number | string | null;
}

interface ValidatedOutput {
  body: string;
  hashtags: string[];
  cta_url?: string;
}

interface PromptContext {
  masterCopy: string;
  ctaUrl: string | undefined;
  campaignObjective: string;
  notionContext: string | null;
  lengthInstruction: string | null;
}

export class AiComposerWorker {
  private readonly repository = new AiWorkerRepository();
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: Database,
    private readonly airtableClient: AirtableClient,
    private readonly llmAdapter: LlmAdapter,
    private readonly logger: Logger,
    private readonly workspaceId: string,
    private readonly promptVersion = "fb_composer_v1.0.0",
    private readonly airtableFieldMap: {
      variant_draft: string;
      variant_hashtags: string;
      variant_cta_url: string;
      ai_generation_status: string;
      ai_review_notes: string;
      ledger_variant_id: string;
    },
    private readonly loadNotionFn = loadNotionContext
  ) {}

  start(intervalMs = 5000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info("AI Composer background SMM worker started", { intervalMs });

    const poll = () => {
      void (async () => {
        try {
          await this.pollAndProcess();
        } catch (err) {
          this.logger.error("Error in AI Composer polling loop", { error: String(err) });
        }
        if (this.isRunning) {
          this.intervalId = setTimeout(poll, intervalMs);
        }
      })();
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
    const pendingRuns = await this.database.query<{ id: string }>(
      `SELECT id FROM workflow_runs WHERE workspace_id = $1 AND status = 'pending_ai_generation' ORDER BY created_at ASC`,
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

    const claimResult = await this.claimRun(workflowRunId);
    if ("errorStatus" in claimResult) return claimResult.errorStatus;
    const { aiGenerationRunId, approvedVersion, airtableRecordId } = claimResult;

    const airtableResult = await this.reloadAndValidateAirtable(airtableRecordId, workflowRunId, aiGenerationRunId);
    if ("errorStatus" in airtableResult) return airtableResult.errorStatus;
    const fields = airtableResult;

    const notionResult = await this.loadNotionContext(fields, workflowRunId, aiGenerationRunId);
    if ("errorStatus" in notionResult) return notionResult.errorStatus;
    const { notionContext, campaignObjective, notionContextRefs } = notionResult;

    const promptContext = this.buildPromptContext(fields, campaignObjective, notionContext);
    const { systemPrompt, userPrompt } = this.preparePrompts(promptContext, aiGenerationRunId, notionContextRefs);

    const callResult = await this.callAiProvider(systemPrompt, userPrompt, workflowRunId, aiGenerationRunId);
    if ("errorStatus" in callResult) return callResult.errorStatus;

    const validationResult = await this.validateAiOutput(callResult.generatedText, fields.cta_url, airtableRecordId, workflowRunId, aiGenerationRunId);
    if ("errorStatus" in validationResult) return validationResult.errorStatus;
    const validatedOutput = validationResult.output;

    const persistResult = await this.persistVariant(validatedOutput, fields, workflowRunId, aiGenerationRunId, airtableRecordId, approvedVersion, correlationId);
    if ("errorStatus" in persistResult) return persistResult.errorStatus;

    await this.syncVariantToAirtable(validatedOutput, airtableRecordId, persistResult.variantId);

    return { success: true, status: "completed", variantId: persistResult.variantId };
  }

  private async claimRun(workflowRunId: string): Promise<{ aiGenerationRunId: string, approvedVersion: number, airtableRecordId: string } | { errorStatus: AiWorkerResult }> {
    try {
      const claim = await this.database.transaction(this.workspaceId, async (client) => {
        return this.repository.claimWorkflowRun(client, this.workspaceId, workflowRunId, this.promptVersion, "gemini", "gemini-2.5-pro");
      });

      if (claim.alreadyCompleted) {
        this.logger.info("AI generation already completed, fast-pass skip", { workflowRunId, aiGenerationRunId: claim.aiGenerationRunId });
        return { errorStatus: { success: true, status: "completed" } };
      }

      if (!claim.success || !claim.aiGenerationRunId || !claim.airtableRecordId || claim.approvedVersion === undefined) {
        this.logger.warn("Could not claim workflow run or no active generation run created", { workflowRunId });
        return { errorStatus: { success: false, status: "claim_skipped" } };
      }

      return { aiGenerationRunId: claim.aiGenerationRunId, approvedVersion: claim.approvedVersion, airtableRecordId: claim.airtableRecordId };
    } catch (err) {
      this.logger.error("Failed to claim workflow run", { workflowRunId, error: String(err) });
      return { errorStatus: { success: false, status: "claim_failed", errorMessage: String(err) } };
    }
  }

  private async reloadAndValidateAirtable(airtableRecordId: string, workflowRunId: string, aiGenerationRunId: string): Promise<AirtableFields | { errorStatus: AiWorkerResult }> {
    let postRecord;
    try {
      postRecord = await this.airtableClient.getPostRecord(airtableRecordId);
    } catch (err) {
      this.logger.error("Airtable Post reload failed", { airtableRecordId, error: String(err) });
      await this.markFailedInDb(workflowRunId, aiGenerationRunId, "AIRTABLE_CONTEXT_UNREACHABLE", `Failed to reload Airtable post: ${String(redact(String(err)))}`, "failed");
      return { errorStatus: { success: false, status: "airtable_reload_failed", errorCode: "AIRTABLE_CONTEXT_UNREACHABLE" } };
    }

    const fields = postRecord.fields as AirtableFields;

    if (fields.status !== "Approved") {
      this.logger.warn("Airtable post status changed after approval, aborting AI Composer", { airtableRecordId, current_status: fields.status });
      await this.markFailedInDb(workflowRunId, aiGenerationRunId, "STALE_SOURCE_STATUS_CHANGED", `Status changed to '${fields.status ?? "unknown"}' in Airtable`, "failed");
      return { errorStatus: { success: false, status: "status_changed", errorCode: "STALE_SOURCE_STATUS_CHANGED" } };
    }

    const channels = fields.target_channels || [];
    const hasValidChannel = channels.includes("Facebook") || channels.includes("TikTok");
    if (!hasValidChannel) {
      this.logger.warn("Post target channels does not explicitly contain Facebook or TikTok", { airtableRecordId, channels });
      await this.markFailedInDb(workflowRunId, aiGenerationRunId, "AIRTABLE_CONTEXT_INVALID", "Target channels does not contain Facebook or TikTok", "failed");
      return { errorStatus: { success: false, status: "channels_invalid", errorCode: "AIRTABLE_CONTEXT_INVALID" } };
    }

    if (!fields.master_copy) {
      this.logger.warn("Post master copy is empty", { airtableRecordId });
      await this.markFailedInDb(workflowRunId, aiGenerationRunId, "AIRTABLE_CONTEXT_INVALID", "Master copy is missing or empty", "failed");
      return { errorStatus: { success: false, status: "master_copy_empty", errorCode: "AIRTABLE_CONTEXT_INVALID" } };
    }

    return fields;
  }

  private async loadNotionContext(fields: AirtableFields, workflowRunId: string, aiGenerationRunId: string): Promise<{ notionContext: string | null, campaignObjective: string | null, notionContextRefs: Array<Record<string, unknown>> } | { errorStatus: AiWorkerResult }> {
    if (!fields.campaign_id || fields.campaign_id.length === 0) {
      return { notionContext: null, campaignObjective: null, notionContextRefs: [] };
    }

    const campaignId = fields.campaign_id[0];
    try {
      const campaign = await this.airtableClient.fetchCampaignRecord(campaignId);
      return await this.processCampaignBrief(campaign);
    } catch (campaignErr) {
      this.logger.error("Failed to load campaign brief details", { campaignId, error: String(campaignErr) });
      const isSsrf = campaignErr instanceof Error && campaignErr.message.includes(SSRF_PREVENTION_ERROR_FRAGMENT);
      const errorCode = isSsrf ? "NOTION_NOT_ALLOWLISTED" : "CONTEXT_UNREACHABLE";
      const status = isSsrf ? "failed" : "needs_manual_review";
      await this.markFailedInDb(workflowRunId, aiGenerationRunId, errorCode, `${NOTION_CONTEXT_FAILED_PREFIX}: ${String(redact(String(campaignErr)))}`.substring(0, AI_ERROR_MESSAGE_MAX_LENGTH), status);
      return { errorStatus: { success: false, status: "notion_context_failed", errorCode } };
    }
  }

  private async processCampaignBrief(campaign: { notion_brief_url?: string; campaign_objective?: string }): Promise<{ notionContext: string | null, campaignObjective: string | null, notionContextRefs: Array<Record<string, unknown>> }> {
    if (!campaign.notion_brief_url) {
      return { notionContext: null, campaignObjective: campaign.campaign_objective || null, notionContextRefs: [] };
    }

    this.logger.info("Loading Notion campaign brief context", { notion_url: campaign.notion_brief_url });
    
    const urlParts = campaign.notion_brief_url.split("/");
    const lastPart = urlParts[urlParts.length - 1] || "";
    const match = /[a-f0-9]{32}/i.exec(lastPart);
    const pageId = match ? match[0] : lastPart;

    const result = await this.loadNotionFn(
      { notionPageId: pageId, secretRef: "env:NOTION_TOKEN" },
      { tokenResolver: async () => process.env.NOTION_TOKEN || "" }
    );

    if (result.success && result.content) {
      return {
        notionContext: result.content,
        campaignObjective: campaign.campaign_objective || null,
        notionContextRefs: [{ notion_brief_url: campaign.notion_brief_url, load_status: "success", ai_ready: true }]
      };
    } else {
      this.logger.warn("Notion loader failed, attempting fallback", { error: result.error });
      const isSsrf = result.error?.code === "INVALID_PAGE_ID";
      if (isSsrf) {
        throw new Error(INVALID_NOTION_PAGE_ID_SSRF_MESSAGE);
      }
      
      const contextRef = { 
        notion_brief_url: campaign.notion_brief_url, 
        load_status: "fallback", 
        ai_ready: false, 
        fallback_source: "campaign_objective", 
        error_code: "CONTEXT_UNREACHABLE", 
        error_message: String(result.error?.message || UNKNOWN_LOADER_ERROR).substring(0, AI_ERROR_MESSAGE_MAX_LENGTH)
      };

      if (campaign.campaign_objective) {
        return { notionContext: null, campaignObjective: campaign.campaign_objective, notionContextRefs: [contextRef] };
      } else {
        throw new Error(result.error?.message || UNKNOWN_LOADER_ERROR);
      }
    }
  }

  private buildPromptContext(fields: AirtableFields, campaignObjective: string | null, notionContext: string | null): PromptContext {
    return {
      masterCopy: fields.master_copy || "",
      ctaUrl: fields.cta_url,
      campaignObjective: campaignObjective || DEFAULT_CAMPAIGN_OBJECTIVE,
      notionContext,
      lengthInstruction: buildLengthInstruction(fields)
    };
  }

  private preparePrompts(promptContext: PromptContext, aiGenerationRunId: string, notionContextRefs: Array<Record<string, unknown>>) {
    const promptTemplate = getPromptTemplate(this.promptVersion);
    const systemPrompt = promptTemplate.systemPrompt;
    const userPrompt = promptTemplate.userPrompt(promptContext);

    // Enforce strict schema before persisting to Ledger
    const validatedContextRefs = z.array(NotionContextRefSchema).parse(notionContextRefs);

    // Run async, no await needed for return
    void this.database.query(
      `UPDATE ai_generation_runs SET input_snapshot = $3::jsonb, notion_context_refs = $4::jsonb WHERE id = $1 AND workspace_id = $2`,
      [aiGenerationRunId, this.workspaceId, JSON.stringify(promptContext), JSON.stringify(validatedContextRefs)]
    );

    return { systemPrompt, userPrompt };
  }

  private async callAiProvider(systemPrompt: string, userPrompt: string, workflowRunId: string, aiGenerationRunId: string): Promise<{ generatedText: string } | { errorStatus: AiWorkerResult }> {
    try {
      const scenario = (process.env.MOCK_LLM_SCENARIO || "happy") as LlmGenerateOptions["mockScenario"];
      const generatedText = await this.llmAdapter.generateContent(systemPrompt, userPrompt, { timeoutMs: 30_000, mockScenario: scenario });
      return { generatedText };
    } catch (err: unknown) {
      this.logger.error("LLM Provider call failed", { error: String(err) });
      const isRateLimit = err instanceof LlmRateLimitError;
      const isTimeout = err instanceof LlmTimeoutError;

      let errCode: AiErrorCode;
      if (isRateLimit) {
        errCode = "PROVIDER_RATE_LIMIT";
      } else if (isTimeout) {
        errCode = "PROVIDER_TIMEOUT";
      } else {
        errCode = "INVALID_MODEL_CONFIG";
      }
      const runStatus = (isRateLimit || isTimeout) ? "retryable_failed" : "failed";

      await this.markFailedInDb(workflowRunId, aiGenerationRunId, errCode, `LLM provider error: ${String(redact(String(err)))}`, runStatus);
      return { errorStatus: { success: false, status: "llm_failed", errorCode: errCode } };
    }
  }

  private async validateAiOutput(generatedText: string, ctaUrl: string | undefined, airtableRecordId: string, workflowRunId: string, aiGenerationRunId: string): Promise<{ output: ValidatedOutput } | { errorStatus: AiWorkerResult }> {
    try {
      const validatedOutput = validateStructuredOutput(generatedText, ctaUrl);
      return { output: validatedOutput };
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        return this.handleValidationError(err, generatedText, airtableRecordId, workflowRunId, aiGenerationRunId);
      }

      await this.markFailedInDb(workflowRunId, aiGenerationRunId, "SCHEMA_PARSING_FAILED", `Unexpected validation error: ${String(redact(String(err)))}`, "needs_manual_review");
      return { errorStatus: { success: false, status: "validation_failed", errorCode: "SCHEMA_PARSING_FAILED" } };
    }
  }

  private async handleValidationError(err: ValidationError, generatedText: string, airtableRecordId: string, workflowRunId: string, aiGenerationRunId: string): Promise<{ errorStatus: AiWorkerResult }> {
    this.logger.warn("Structured output validation failed", { errorCode: err.errorCode, message: err.message });
    const isInjection = err.errorCode === "PROMPT_INJECTION_DETECTED";
    const status = isInjection ? "failed" : "needs_manual_review";
    const outputSnapshot = isInjection ? { rawOutputHash: createHash("sha256").update(generatedText).digest("hex"), sanitizedFailure: true as const, errorCode: err.errorCode as "PROMPT_INJECTION_DETECTED" } : undefined;
    
    await this.database.transaction(this.workspaceId, async (client) => {
      await this.repository.markFailed(client, { workspaceId: this.workspaceId, workflowRunId, aiGenerationRunId, errorCode: err.errorCode, errorMessage: err.message, status, outputSnapshot });
    });

    try {
      await this.airtableClient.updateVariantDraft(airtableRecordId, NOT_APPLICABLE_VARIANT_ID, { variant_draft: "", variant_hashtags: [], ai_generation_status: REVIEW_BLOCKED_STATUS, ai_review_notes: buildAiValidationFailedNote(err.errorCode, err.message) }, this.airtableFieldMap);
    } catch (airtableErr) {
      this.logger.error("Failed to sync validation error to Airtable", { airtableErr });
    }

    return { errorStatus: { success: false, status: "validation_failed", errorCode: err.errorCode } };
  }

  private async persistVariant(validatedOutput: ValidatedOutput, fields: AirtableFields, workflowRunId: string, aiGenerationRunId: string, airtableRecordId: string, approvedVersion: number, correlationId: string): Promise<MarkAiCompletedResult | { errorStatus: AiWorkerResult }> {
    try {
      const completed = await this.database.transaction(this.workspaceId, async (client) => {
        return this.repository.markCompleted(client, { workspaceId: this.workspaceId, workflowRunId, aiGenerationRunId, airtableRecordId, campaignId: fields.campaign_id?.[0] || null, approvedVersion, promptVersion: this.promptVersion, output: validatedOutput, assetLinks: normalizeAssetLinks(fields.asset_links), correlationId, postId: fields.post_id || airtableRecordId, syncRetryNeeded: false, targetChannels: fields.target_channels || [] });
      });
      return completed;
    } catch (err) {
      this.logger.error("Failed to persist variant and complete AI run in database", { error: String(err) });
      return { errorStatus: { success: false, status: "persistence_failed", errorMessage: String(err) } };
    }
  }

  private async syncVariantToAirtable(validatedOutput: ValidatedOutput, airtableRecordId: string, variantId: string) {
    this.logger.info("Syncing generated AI variant to Airtable", { airtableRecordId, variantId });
    try {
      const latestPost = await this.airtableClient.getPostRecord(airtableRecordId);
      if (latestPost.fields.status !== "Approved") {
        throw new Error(`Airtable optimistic guard failed: status is ${latestPost.fields.status ?? "unknown"}`);
      }
      await this.airtableClient.updateVariantDraft(airtableRecordId, variantId, { variant_draft: validatedOutput.body, variant_hashtags: validatedOutput.hashtags, variant_cta_url: validatedOutput.cta_url || null, ai_generation_status: AI_GENERATION_NEEDS_REVIEW_STATUS, ai_review_notes: buildAiComposerSuccessNote(this.promptVersion) }, this.airtableFieldMap);
      try {
        await this.airtableClient.updateRecordStatus(this.workspaceId, airtableRecordId, AIRTABLE_POST_NEEDS_REVIEW_STATUS);
      } catch (statusErr) {
        this.logger.warn("Airtable draft content synced but status update failed", { airtableRecordId, error: String(statusErr) });
      }
      this.logger.info("Successfully synced variant to Airtable", { airtableRecordId });
    } catch (airtableErr) {
      this.logger.error("Airtable variant sync failed. Setting sync_retry_needed = true in Ledger.", { airtableRecordId, error: String(airtableErr) });
      try {
        await this.database.transaction(this.workspaceId, async (client) => {
          await this.repository.updateVariantSyncStatus(client, this.workspaceId, variantId, true);
        });
      } catch (dbErr) {
        this.logger.error("Failed to mark sync_retry_needed in Ledger!", { variantId, dbErr });
      }
    }
  }

  private async markFailedInDb(workflowRunId: string, aiGenerationRunId: string, errorCode: AiErrorCode, errorMessage: string, status: "failed" | "retryable_failed" | "needs_manual_review") {
    try {
      await this.database.transaction(this.workspaceId, async (client) => {
        await this.repository.markFailed(client, { workspaceId: this.workspaceId, workflowRunId, aiGenerationRunId, errorCode, errorMessage, status });
      });
    } catch (dbErr) {
      this.logger.error("Failed to mark run as failed in DB", { workflowRunId, dbErr });
    }
  }

  async processQueueMessage(message: AiComposerQueueMessage, messageId: string): Promise<AiQueueWorkerResult> {
    if (message.workspace_id !== this.workspaceId) {
      this.logger.error("AI Composer queue message workspace mismatch", { messageId, message_workspace_id: message.workspace_id, worker_workspace_id: this.workspaceId });
      return { action: "nack_dlq", status: "workspace_mismatch" };
    }

    const result = await this.processWorkflowRun(message.workflow_run_id);

    if (result.success) return { action: "ack", status: result.status };

    if (result.status === "llm_failed" && (result.errorCode === "PROVIDER_RATE_LIMIT" || result.errorCode === "PROVIDER_TIMEOUT")) {
      return { action: "ack", status: "retryable_failed", errorCode: result.errorCode };
    }

    if (result.status === "persistence_failed" || result.status === "claim_failed" || result.status === "policy_publish_failed") {
      return { action: "nack_requeue", status: result.status, errorCode: result.errorCode };
    }

    return { action: "ack", status: result.status, errorCode: result.errorCode };
  }
}
