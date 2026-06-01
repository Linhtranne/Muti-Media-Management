import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AiComposerWorker } from "../workers/aiComposerWorker.js";
import { GeminiLlmAdapter } from "../ai/llmAdapter.js";
import type { Database } from "../ledger/postgres.js";
import type { AirtableClient } from "../airtable/airtableClient.js";
import { Logger } from "../lib/logger.js";
import { 
  AirtableReloadedRecordSchema,
  type AirtableReloadedRecord 
} from "@mediaops/shared-contracts";

const logger = new Logger("error");
const workspaceId = "ws_test_composer";

// Mock Field Mapping Configuration
const fieldMap = {
  variant_draft: "facebook_body",
  variant_hashtags: "facebook_hashtags",
  variant_cta_url: "facebook_cta_url",
  ai_generation_status: "ai_generation_status",
  ai_review_notes: "ai_review_notes",
  ledger_variant_id: "ledger_variant_id"
};

describe("AiComposerWorker Integration Scenarios", () => {
  
  // ──────────────────────────────────────────────
  // SCENARIO 1: Happy Path Generation Flow
  // ──────────────────────────────────────────────
  it("SC-01 Happy Path: claims workflow, reloads Airtable, calls LLM, persists variant & outbox, and syncs Airtable", async () => {
    let sqlQueries: string[] = [];
    let airtableUpdated = false;
    let rlsSet = false;

    const mockDb: Database = {
      async transaction(wsId, fn) {
        rlsSet = true;
        const client = {
          query: async (text: string, values?: any[]) => {
            sqlQueries.push(text);
            if (text.includes("FROM workflow_runs")) {
              return { rows: [{ id: "wf_run_123", status: "pending_ai_generation", approved_version: 1, airtable_record_id: "recPost123" }] };
            }
            if (text.includes("FROM ai_generation_runs")) {
              return { rows: [] }; // No existing runs
            }
            return { rows: [{ id: "some-uuid" }] };
          }
        } as any;
        return fn(client);
      },
      async query(text: string, values?: any[]) {
        sqlQueries.push(text);
        if (text.includes("FROM workflow_runs")) {
          return { rows: [{ id: "wf_run_123" }] };
        }
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord(recordId) {
        return AirtableReloadedRecordSchema.parse({
          id: recordId,
          fields: {
            status: "Approved",
            is_valid_for_approval: 1,
            master_copy: "Launch our new product innovatively with secure systems!",
            target_channels: ["Facebook"],
            cta_url: "https://mediaops.com/launch?utm_source=fb&utm_medium=post",
            post_id: "post_123"
          }
        });
      },
      async fetchCampaignRecord() {
        return {
          notion_brief_url: "https://notion.so/test-brief-12345678901234567890123456789012",
          campaign_objective: "Launch product innovatively"
        };
      },
      async updateVariantDraft(recordId, variantId, fields, mapping) {
        airtableUpdated = true;
        assert.equal(fields.ai_generation_status, "Needs Review");
        assert.equal(fields.variant_draft, "Preserving the master copy perfectly with innovation and secure systems!");
      }
    };

    process.env.MOCK_LLM_SCENARIO = "happy";
    const adapter = new GeminiLlmAdapter("mock-key");
    const worker = new AiComposerWorker(mockDb, mockAirtable, adapter, logger, workspaceId, "fb_composer_v1.0.0", fieldMap);
    
    const result = await worker.processWorkflowRun("wf_run_123");

    assert.equal(result.success, true);
    assert.equal(result.status, "completed");
    assert.ok(airtableUpdated, "Airtable should be patched with AI draft");
    assert.ok(rlsSet, "RLS context should be set at start of transaction");
    
    // Verify outbox was written
    const hasOutboxInsert = sqlQueries.some(q => q.includes("INSERT INTO policy_handoff_events"));
    assert.ok(hasOutboxInsert, "Transactional outbox event policy.evaluate.requested should be created");
  });

  // ──────────────────────────────────────────────
  // SCENARIO 2: Duplicate Redelivery Short-Circuit
  // ──────────────────────────────────────────────
  it("SC-02 Duplicate Redelivery: fast-pass reuse of existing completed generation run", async () => {
    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM workflow_runs")) {
              // Workflow already completed
              return { rows: [{ id: "wf_run_123", status: "ai_generation_completed", approved_version: 1, airtable_record_id: "recPost123" }] };
            }
            if (text.includes("FROM ai_generation_runs")) {
              return { rows: [{ id: "run_existing_123", status: "completed", output_snapshot: { body: "Cached", hashtags: [] } }] };
            }
            return { rows: [] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord() { throw new Error("Should not fetch Airtable on duplicate fast-pass"); },
      async fetchCampaignRecord() { throw new Error("Should not fetch Airtable Campaign on duplicate fast-pass"); },
      async updateVariantDraft() { throw new Error("Should not patch Airtable on duplicate fast-pass"); }
    };

    const adapter = new GeminiLlmAdapter("mock-key");
    const worker = new AiComposerWorker(mockDb, mockAirtable, adapter, logger, workspaceId, "fb_composer_v1.0.0", fieldMap);
    
    const result = await worker.processWorkflowRun("wf_run_123");

    assert.equal(result.success, true);
    assert.equal(result.status, "completed");
  });

  // ──────────────────────────────────────────────
  // SCENARIO 3: Provider Rate Limit Retry (Transient)
  // ──────────────────────────────────────────────
  it("SC-03 Rate Limit Retry: marks run as retryable_failed on provider rate limit", async () => {
    let markedFailed = false;

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM workflow_runs")) {
              return { rows: [{ id: "wf_run_123", status: "pending_ai_generation", approved_version: 1, airtable_record_id: "recPost123" }] };
            }
            if (text.includes("FROM ai_generation_runs")) {
              return { rows: [] };
            }
            if (text.includes("UPDATE ai_generation_runs SET status = $3") || text.includes("UPDATE ai_generation_runs")) {
              markedFailed = true;
            }
            return { rows: [{ id: "some-uuid" }] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord(recordId) {
        return AirtableReloadedRecordSchema.parse({
          id: recordId,
          fields: {
            status: "Approved",
            is_valid_for_approval: 1,
            master_copy: "Copy",
            target_channels: ["Facebook"]
          }
        });
      },
      async fetchCampaignRecord() { return {}; },
      async updateVariantDraft() {}
    };

    process.env.MOCK_LLM_SCENARIO = "rate_limit";
    const adapter = new GeminiLlmAdapter("mock-key");
    const worker = new AiComposerWorker(mockDb, mockAirtable, adapter, logger, workspaceId, "fb_composer_v1.0.0", fieldMap);
    
    const result = await worker.processWorkflowRun("wf_run_123");

    assert.equal(result.success, false);
    assert.equal(result.status, "llm_failed");
    assert.equal(result.errorCode, "PROVIDER_RATE_LIMIT");
    assert.ok(markedFailed, "Retryable failure status should be saved to database");
  });

  // ──────────────────────────────────────────────
  // SCENARIO 4: Intent Drift Validation Error
  // ──────────────────────────────────────────────
  it("SC-04 Intent Drift: rejects mismatching CTA hostname", async () => {
    let airtableNotes = "";

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM workflow_runs")) {
              return { rows: [{ id: "wf_run_123", status: "pending_ai_generation", approved_version: 1, airtable_record_id: "recPost123" }] };
            }
            if (text.includes("FROM ai_generation_runs")) {
              return { rows: [] };
            }
            return { rows: [{ id: "some-uuid" }] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord(recordId) {
        return AirtableReloadedRecordSchema.parse({
          id: recordId,
          fields: {
            status: "Approved",
            is_valid_for_approval: 1,
            master_copy: "Copy",
            target_channels: ["Facebook"],
            cta_url: "https://mediaops.com/launch?utm_source=fb&utm_medium=post"
          }
        });
      },
      async fetchCampaignRecord() { return {}; },
      async updateVariantDraft(recordId, variantId, fields) {
        airtableNotes = fields.ai_review_notes || "";
        assert.equal(fields.ai_generation_status, "Review Blocked");
      }
    };

    process.env.MOCK_LLM_SCENARIO = "drift";
    const adapter = new GeminiLlmAdapter("mock-key");
    const worker = new AiComposerWorker(mockDb, mockAirtable, adapter, logger, workspaceId, "fb_composer_v1.0.0", fieldMap);
    
    const result = await worker.processWorkflowRun("wf_run_123");

    assert.equal(result.success, false);
    assert.equal(result.status, "validation_failed");
    assert.equal(result.errorCode, "INTENT_DRIFT");
    assert.ok(airtableNotes.includes("INTENT_DRIFT"), "Airtable notes should explain the intent drift error");
  });

  // ──────────────────────────────────────────────
  // SCENARIO 5: Prompt Injection Hard Fail
  // ──────────────────────────────────────────────
  it("SC-05 Prompt Injection: locks down on dangerous keys", async () => {
    let airtableNotes = "";
    let failureOutputSnapshot: any = null;

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM workflow_runs")) {
              return { rows: [{ id: "wf_run_123", status: "pending_ai_generation", approved_version: 1, airtable_record_id: "recPost123" }] };
            }
            if (text.includes("FROM ai_generation_runs")) {
              return { rows: [] };
            }
            if (text.includes("UPDATE ai_generation_runs") && values?.[5]) {
              failureOutputSnapshot = JSON.parse(values[5]);
            }
            return { rows: [{ id: "some-uuid" }] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord(recordId) {
        return AirtableReloadedRecordSchema.parse({
          id: recordId,
          fields: {
            status: "Approved",
            is_valid_for_approval: 1,
            master_copy: "Copy",
            target_channels: ["Facebook"]
          }
        });
      },
      async fetchCampaignRecord() { return {}; },
      async updateVariantDraft(recordId, variantId, fields) {
        airtableNotes = fields.ai_review_notes || "";
        assert.equal(fields.ai_generation_status, "Review Blocked");
      }
    };

    process.env.MOCK_LLM_SCENARIO = "injection";
    const adapter = new GeminiLlmAdapter("mock-key");
    const worker = new AiComposerWorker(mockDb, mockAirtable, adapter, logger, workspaceId, "fb_composer_v1.0.0", fieldMap);
    
    const result = await worker.processWorkflowRun("wf_run_123");

    assert.equal(result.success, false);
    assert.equal(result.status, "validation_failed");
    assert.equal(result.errorCode, "PROMPT_INJECTION_DETECTED");
    assert.ok(airtableNotes.includes("PROMPT_INJECTION_DETECTED"), "Airtable notes should indicate prompt injection was caught");
    assert.equal(failureOutputSnapshot?.sanitizedFailure, true);
    assert.equal(failureOutputSnapshot?.errorCode, "PROMPT_INJECTION_DETECTED");
    assert.match(failureOutputSnapshot?.rawOutputHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(failureOutputSnapshot).includes("policy_bypass"), false);
  });

  it("SC-06 Airtable optimistic guard: keeps Ledger committed and marks sync retry when status changed before sync", async () => {
    let postReloadCount = 0;
    let syncRetryMarked = false;

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM workflow_runs")) {
              return { rows: [{ id: "wf_run_123", status: "pending_ai_generation", approved_version: 1, airtable_record_id: "recPost123" }] };
            }
            if (text.includes("FROM ai_generation_runs")) {
              return { rows: [] };
            }
            if (text.includes("UPDATE content_variants") && values?.[2] === true) {
              syncRetryMarked = true;
            }
            return { rows: [{ id: "some-uuid" }] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord(recordId) {
        postReloadCount += 1;
        return AirtableReloadedRecordSchema.parse({
          id: recordId,
          fields: {
            status: postReloadCount === 1 ? "Approved" : "Scheduled",
            is_valid_for_approval: 1,
            master_copy: "Launch our new product innovatively with secure systems!",
            target_channels: ["Facebook"],
            cta_url: "https://mediaops.com/launch?utm_source=fb&utm_medium=post",
            post_id: "post_123"
          }
        });
      },
      async fetchCampaignRecord() {
        return {};
      },
      async updateVariantDraft() {
        throw new Error("PATCH should not run after optimistic guard failure");
      }
    };

    process.env.MOCK_LLM_SCENARIO = "happy";
    const adapter = new GeminiLlmAdapter("mock-key");
    const worker = new AiComposerWorker(mockDb, mockAirtable, adapter, logger, workspaceId, "fb_composer_v1.0.0", fieldMap);

    const result = await worker.processWorkflowRun("wf_run_123");

    assert.equal(result.success, true);
    assert.equal(result.status, "completed");
    assert.equal(syncRetryMarked, true);
  });

  it("SC-07 Malformed JSON: does not create an active content variant", async () => {
    let contentVariantInserted = false;

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string) => {
            if (text.includes("FROM workflow_runs")) {
              return { rows: [{ id: "wf_run_123", status: "pending_ai_generation", approved_version: 1, airtable_record_id: "recPost123" }] };
            }
            if (text.includes("FROM ai_generation_runs")) {
              return { rows: [] };
            }
            if (text.includes("INSERT INTO content_variants")) {
              contentVariantInserted = true;
            }
            return { rows: [{ id: "some-uuid" }] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord(recordId) {
        return AirtableReloadedRecordSchema.parse({
          id: recordId,
          fields: {
            status: "Approved",
            is_valid_for_approval: 1,
            master_copy: "Copy",
            target_channels: ["Facebook"]
          }
        });
      },
      async fetchCampaignRecord() { return {}; },
      async updateVariantDraft() {}
    };

    process.env.MOCK_LLM_SCENARIO = "malformed";
    const adapter = new GeminiLlmAdapter("mock-key");
    const worker = new AiComposerWorker(mockDb, mockAirtable, adapter, logger, workspaceId, "fb_composer_v1.0.0", fieldMap);

    const result = await worker.processWorkflowRun("wf_run_123");

    assert.equal(result.success, false);
    assert.equal(result.errorCode, "SCHEMA_PARSING_FAILED");
    assert.equal(contentVariantInserted, false);
  });

  it("SC-08 LLM provider errors are redacted before Ledger persistence", async () => {
    let persistedErrorMessage = "";

    const mockDb: Database = {
      async transaction(wsId, fn) {
        const client = {
          query: async (text: string, values?: any[]) => {
            if (text.includes("FROM workflow_runs")) {
              return { rows: [{ id: "wf_run_123", status: "pending_ai_generation", approved_version: 1, airtable_record_id: "recPost123" }] };
            }
            if (text.includes("FROM ai_generation_runs")) {
              return { rows: [] };
            }
            if (text.includes("UPDATE ai_generation_runs") && values?.[4]) {
              persistedErrorMessage = values[4];
            }
            return { rows: [{ id: "some-uuid" }] };
          }
        } as any;
        return fn(client);
      },
      async query() {
        return { rows: [] } as any;
      },
      getPool() {
        return {} as any;
      }
    };

    const mockAirtable: AirtableClient = {
      async updateRecordStatus() {},
      async getPostRecord(recordId) {
        return AirtableReloadedRecordSchema.parse({
          id: recordId,
          fields: {
            status: "Approved",
            is_valid_for_approval: 1,
            master_copy: "Copy",
            target_channels: ["Facebook"]
          }
        });
      },
      async fetchCampaignRecord() { return {}; },
      async updateVariantDraft() {}
    };

    const leakingAdapter = {
      async generateContent() {
        throw new Error("provider failed api_key=secret-provider-key Bearer secret-bearer-token");
      }
    };

    const worker = new AiComposerWorker(mockDb, mockAirtable, leakingAdapter, logger, workspaceId, "fb_composer_v1.0.0", fieldMap);
    const result = await worker.processWorkflowRun("wf_run_123");

    assert.equal(result.success, false);
    assert.equal(persistedErrorMessage.includes("secret-provider-key"), false);
    assert.equal(persistedErrorMessage.includes("secret-bearer-token"), false);
    assert.ok(persistedErrorMessage.includes("[REDACTED]"));
  });
});


