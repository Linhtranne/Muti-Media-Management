import { AirtableReloadedRecordSchema, type AirtableReloadedRecord } from "@mediaops/shared-contracts";
import { redact } from "../lib/redact.js";

export class AirtableRateLimitError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "AirtableRateLimitError";
  }
}

export class AirtableServiceError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "AirtableServiceError";
  }
}

export class AirtableRecordNotFoundError extends Error {
  readonly retryable = false;
  constructor(recordId: string) {
    super(`Airtable record not found: ${recordId}`);
    this.name = "AirtableRecordNotFoundError";
  }
}

export class AirtableNetworkError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "AirtableNetworkError";
  }
}

const CONNECT_TIMEOUT_MS = 10_000;
const RESPONSE_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = CONNECT_TIMEOUT_MS + RESPONSE_TIMEOUT_MS;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const AIRTABLE_SERVICE_UNAVAILABLE_STATUS_CODES = [HTTP_BAD_GATEWAY, HTTP_SERVICE_UNAVAILABLE];
const NOTION_BRIEF_URL_FIELD_NAME = "Notion Brief URL";
const AIRTABLE_INVALID_MULTIPLE_CHOICE_OPTIONS = "INVALID_MULTIPLE_CHOICE_OPTIONS";

function isAirtableServiceUnavailable(status: number): boolean {
  return AIRTABLE_SERVICE_UNAVAILABLE_STATUS_CODES.includes(status);
}

async function readAirtableErrorType(response: Response): Promise<string | null> {
  try {
    const body = await response.clone().json() as { error?: { type?: unknown } };
    return typeof body.error?.type === "string" ? body.error.type : null;
  } catch {
    return null;
  }
}

export interface AirtableClient {
  getPostRecord(recordId: string): Promise<AirtableReloadedRecord>;
  listPostRecordsByStatus?(statuses: string[], maxRecords?: number): Promise<AirtableReloadedRecord[]>;
  fetchCampaignRecord(campaignId: string): Promise<{ notion_brief_url?: string; campaign_objective?: string }>;
  updatePolicyNeedsReview?(
    recordId: string,
    fields: {
      policy_status: string;
      policy_blockers: string[];
      policy_warnings?: string[];
    }
  ): Promise<void>;
  updateVariantDraft(
    recordId: string,
    variantId: string,
    fields: {
      variant_draft: string;
      variant_hashtags: string[];
      variant_cta_url?: string | null;
      ai_generation_status: string;
      ai_review_notes?: string | null;
    },
    mapping: {
      variant_draft: string;
      variant_hashtags: string;
      variant_cta_url: string;
      ai_generation_status: string;
      ai_review_notes: string;
      ledger_variant_id: string;
    }
  ): Promise<void>;
  updateRecordStatus(workspaceId: string, recordId: string, status: string): Promise<void>;
  updatePostApprovalStatus?(
    recordId: string,
    status: string,
    rejectionReason?: string | null,
    reasonField?: string
  ): Promise<void>;
  updateRecord(tableName: string, recordId: string, fields: Record<string, unknown>): Promise<void>;
}

export function createAirtableClient(apiKey: string, baseId: string): AirtableClient {
  const baseUrl = `https://api.airtable.com/v0/${baseId}`;

  return {
    async listPostRecordsByStatus(statuses: string[], maxRecords = 25): Promise<AirtableReloadedRecord[]> {
      const filterByFormula = `AND({approved_at},OR(${statuses.map(() => "{status} = ?").join(",")}))`;
      const formula = statuses.reduce((current, status) => current.replace("?", `"${status.replaceAll("\"", "\\\"")}"`), filterByFormula);
      const params = new URLSearchParams({
        maxRecords: String(maxRecords),
        filterByFormula: formula
      });
      const url = `${baseUrl}/Posts?${params.toString()}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, TOTAL_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          signal: controller.signal
        });

        if (response.status === 429) {
          throw new AirtableRateLimitError("Airtable API rate limit exceeded (HTTP 429)");
        }

        if (isAirtableServiceUnavailable(response.status)) {
          throw new AirtableServiceError(`Airtable service unavailable (HTTP ${response.status})`);
        }

        if (!response.ok) {
          throw new AirtableServiceError(`Airtable API error (HTTP ${response.status})`);
        }

        const body = await response.json() as { records?: unknown[] };
        return (body.records ?? []).map((record) => AirtableReloadedRecordSchema.parse(record));
      } catch (error: unknown) {
        if (error instanceof AirtableRateLimitError || error instanceof AirtableServiceError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AirtableNetworkError("Airtable API request timed out");
        }

        if (error instanceof TypeError && error.message.includes("fetch")) {
          throw new AirtableNetworkError(`Airtable network error: ${String(redact(error.message))}`);
        }

        throw new AirtableNetworkError(`Airtable request failed: ${String(redact(String(error)))}`);
      } finally {
        clearTimeout(timeout);
      }
    },

    async getPostRecord(recordId: string): Promise<AirtableReloadedRecord> {
      const url = `${baseUrl}/Posts/${encodeURIComponent(recordId)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, TOTAL_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          signal: controller.signal
        });

        if (response.status === 429) {
          throw new AirtableRateLimitError("Airtable API rate limit exceeded (HTTP 429)");
        }

        if (isAirtableServiceUnavailable(response.status)) {
          throw new AirtableServiceError(`Airtable service unavailable (HTTP ${response.status})`);
        }

        if (response.status === 404) {
          throw new AirtableRecordNotFoundError(recordId);
        }

        if (!response.ok) {
          throw new AirtableServiceError(`Airtable API error (HTTP ${response.status})`);
        }

        const body = await response.json() as unknown;
        return AirtableReloadedRecordSchema.parse(body);
      } catch (error: unknown) {
        if (error instanceof AirtableRateLimitError
          || error instanceof AirtableServiceError
          || error instanceof AirtableRecordNotFoundError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AirtableNetworkError("Airtable API request timed out");
        }

        if (error instanceof TypeError && error.message.includes("fetch")) {
          throw new AirtableNetworkError(`Airtable network error: ${String(redact(error.message))}`);
        }

        throw new AirtableNetworkError(`Airtable request failed: ${String(redact(String(error)))}`);
      } finally {
        clearTimeout(timeout);
      }
    },

    async fetchCampaignRecord(campaignId: string): Promise<{ notion_brief_url?: string; campaign_objective?: string }> {
      const url = `${baseUrl}/Campaigns/${encodeURIComponent(campaignId)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, TOTAL_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          signal: controller.signal
        });

        if (response.status === 429) {
          throw new AirtableRateLimitError("Airtable API rate limit exceeded (HTTP 429)");
        }

        if (isAirtableServiceUnavailable(response.status)) {
          throw new AirtableServiceError(`Airtable service unavailable (HTTP ${response.status})`);
        }

        if (response.status === 404) {
          throw new AirtableRecordNotFoundError(campaignId);
        }

        if (!response.ok) {
          throw new AirtableServiceError(`Airtable API error (HTTP ${response.status})`);
        }

        const body = await response.json() as { fields?: Record<string, unknown> };
        const fields = body.fields || {};
        const notionBriefUrl = fields[NOTION_BRIEF_URL_FIELD_NAME] || fields.notion_brief_url;
        const campaignObjective = fields.objective || fields.campaign_objective || fields.Objective;

        return {
          notion_brief_url: typeof notionBriefUrl === "string" ? notionBriefUrl : undefined,
          campaign_objective: typeof campaignObjective === "string" ? campaignObjective : undefined
        };
      } catch (error: unknown) {
        if (error instanceof AirtableRateLimitError
          || error instanceof AirtableServiceError
          || error instanceof AirtableRecordNotFoundError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AirtableNetworkError("Airtable API request timed out");
        }

        if (error instanceof TypeError && error.message.includes("fetch")) {
          throw new AirtableNetworkError(`Airtable network error: ${String(redact(error.message))}`);
        }

        throw new AirtableNetworkError(`Airtable request failed: ${String(redact(String(error)))}`);
      } finally {
        clearTimeout(timeout);
      }
    },

    async updatePolicyNeedsReview(
      recordId: string,
      fields: {
        policy_status: string;
        policy_blockers: string[];
        policy_warnings?: string[];
      }
    ): Promise<void> {
      const url = `${baseUrl}/Posts/${encodeURIComponent(recordId)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, TOTAL_TIMEOUT_MS);

      const updateFields: Record<string, unknown> = {
        status: "Needs Review",
        policy_status: fields.policy_status,
        policy_blockers: fields.policy_blockers,
        policy_warnings: fields.policy_warnings ?? []
      };

      try {
        const response = await fetch(url, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ fields: updateFields }),
          signal: controller.signal
        });

        if (response.status === 429) {
          throw new AirtableRateLimitError("Airtable API rate limit exceeded (HTTP 429)");
        }

        if (isAirtableServiceUnavailable(response.status)) {
          throw new AirtableServiceError(`Airtable service unavailable (HTTP ${response.status})`);
        }

        if (response.status === 404) {
          throw new AirtableRecordNotFoundError(recordId);
        }

        if (!response.ok) {
          throw new AirtableServiceError(`Airtable API error (HTTP ${response.status})`);
        }
      } catch (error: unknown) {
        if (error instanceof AirtableRateLimitError
          || error instanceof AirtableServiceError
          || error instanceof AirtableRecordNotFoundError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AirtableNetworkError("Airtable API request timed out");
        }

        if (error instanceof TypeError && error.message.includes("fetch")) {
          throw new AirtableNetworkError(`Airtable network error: ${String(redact(error.message))}`);
        }

        throw new AirtableNetworkError(`Airtable request failed: ${String(redact(String(error)))}`);
      } finally {
        clearTimeout(timeout);
      }
    },

    async updateVariantDraft(
      recordId: string,
      variantId: string,
      fields: {
        variant_draft: string;
        variant_hashtags: string[];
        variant_cta_url?: string | null;
        ai_generation_status: string;
        ai_review_notes?: string | null;
      },
      mapping: {
        variant_draft: string;
        variant_hashtags: string;
        variant_cta_url: string;
        ai_generation_status: string;
        ai_review_notes: string;
        ledger_variant_id: string;
      }
    ): Promise<void> {
      const url = `${baseUrl}/Posts/${encodeURIComponent(recordId)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, TOTAL_TIMEOUT_MS);

      const updateFields: Record<string, unknown> = {
        [mapping.variant_draft]: fields.variant_draft,
        [mapping.variant_hashtags]: fields.variant_hashtags.join(" "),
        [mapping.ai_generation_status]: fields.ai_generation_status,
        [mapping.ledger_variant_id]: variantId
      };

      if (fields.variant_cta_url !== undefined) {
        updateFields[mapping.variant_cta_url] = fields.variant_cta_url;
      }
      if (fields.ai_review_notes !== undefined) {
        updateFields[mapping.ai_review_notes] = fields.ai_review_notes;
      }

      const contentOnlyFields: Record<string, unknown> = {
        [mapping.variant_draft]: fields.variant_draft,
        [mapping.variant_hashtags]: fields.variant_hashtags.join(" "),
        [mapping.ledger_variant_id]: variantId
      };

      if (fields.variant_cta_url !== undefined) {
        contentOnlyFields[mapping.variant_cta_url] = fields.variant_cta_url;
      }
      if (fields.ai_review_notes !== undefined) {
        contentOnlyFields[mapping.ai_review_notes] = fields.ai_review_notes;
      }

      try {
        const response = await fetch(url, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ fields: updateFields }),
          signal: controller.signal
        });

        if (response.status === 429) {
          throw new AirtableRateLimitError("Airtable API rate limit exceeded (HTTP 429)");
        }

        if (isAirtableServiceUnavailable(response.status)) {
          throw new AirtableServiceError(`Airtable service unavailable (HTTP ${response.status})`);
        }

        if (response.status === 404) {
          throw new AirtableRecordNotFoundError(recordId);
        }

        if (!response.ok && response.status === 422 && await readAirtableErrorType(response) === AIRTABLE_INVALID_MULTIPLE_CHOICE_OPTIONS) {
          const retryResponse = await fetch(url, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ fields: contentOnlyFields }),
            signal: controller.signal
          });

          if (retryResponse.ok) {
            return;
          }
        }

        if (!response.ok) {
          throw new AirtableServiceError(`Airtable API error (HTTP ${response.status})`);
        }
      } catch (error: unknown) {
        if (error instanceof AirtableRateLimitError
          || error instanceof AirtableServiceError
          || error instanceof AirtableRecordNotFoundError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AirtableNetworkError("Airtable API request timed out");
        }

        if (error instanceof TypeError && error.message.includes("fetch")) {
          throw new AirtableNetworkError(`Airtable network error: ${String(redact(error.message))}`);
        }

        throw new AirtableNetworkError(`Airtable request failed: ${String(redact(String(error)))}`);
      } finally {
        clearTimeout(timeout);
      }
    },

    async updateRecordStatus(workspaceId: string, recordId: string, status: string): Promise<void> {
      const url = `${baseUrl}/Posts/${encodeURIComponent(recordId)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, TOTAL_TIMEOUT_MS);

      const updateFields: Record<string, unknown> = {
        status
      };

      try {
        const response = await fetch(url, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ fields: updateFields }),
          signal: controller.signal
        });

        if (response.status === 429) {
          throw new AirtableRateLimitError("Airtable API rate limit exceeded (HTTP 429)");
        }

        if (isAirtableServiceUnavailable(response.status)) {
          throw new AirtableServiceError(`Airtable service unavailable (HTTP ${response.status})`);
        }

        if (response.status === 404) {
          throw new AirtableRecordNotFoundError(recordId);
        }

        if (!response.ok) {
          throw new AirtableServiceError(`Airtable API error (HTTP ${response.status})`);
        }
      } catch (error: unknown) {
        if (error instanceof AirtableRateLimitError
          || error instanceof AirtableServiceError
          || error instanceof AirtableRecordNotFoundError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AirtableNetworkError("Airtable API request timed out");
        }

        if (error instanceof TypeError && error.message.includes("fetch")) {
          throw new AirtableNetworkError(`Airtable network error: ${String(redact(error.message))}`);
        }

        throw new AirtableNetworkError(`Airtable request failed: ${String(redact(String(error)))}`);
      } finally {
        clearTimeout(timeout);
      }
    },

    async updatePostApprovalStatus(
      recordId: string,
      status: string,
      rejectionReason?: string | null,
      reasonField = "review_notes"
    ): Promise<void> {
      const url = `${baseUrl}/Posts/${encodeURIComponent(recordId)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, TOTAL_TIMEOUT_MS);

      const updateFields: Record<string, unknown> = {
        status
      };

      if (rejectionReason !== undefined) {
        updateFields[reasonField] = rejectionReason;
      }

      try {
        const response = await fetch(url, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ fields: updateFields }),
          signal: controller.signal
        });

        if (response.status === 429) {
          throw new AirtableRateLimitError("Airtable API rate limit exceeded (HTTP 429)");
        }

        if (isAirtableServiceUnavailable(response.status)) {
          throw new AirtableServiceError(`Airtable service unavailable (HTTP ${response.status})`);
        }

        if (response.status === 404) {
          throw new AirtableRecordNotFoundError(recordId);
        }

        if (!response.ok) {
          throw new AirtableServiceError(`Airtable API error (HTTP ${response.status})`);
        }
      } catch (error: unknown) {
        if (error instanceof AirtableRateLimitError
          || error instanceof AirtableServiceError
          || error instanceof AirtableRecordNotFoundError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AirtableNetworkError("Airtable API request timed out");
        }

        if (error instanceof TypeError && error.message.includes("fetch")) {
          throw new AirtableNetworkError(`Airtable network error: ${String(redact(error.message))}`);
        }

        throw new AirtableNetworkError(`Airtable request failed: ${String(redact(String(error)))}`);
      } finally {
        clearTimeout(timeout);
      }
    },

    async updateRecord(tableName: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
      const url = `${baseUrl}/${encodeURIComponent(tableName)}/${encodeURIComponent(recordId)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, TOTAL_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ fields }),
          signal: controller.signal
        });

        if (response.status === 429) {
          throw new AirtableRateLimitError("Airtable API rate limit exceeded (HTTP 429)");
        }

        if (isAirtableServiceUnavailable(response.status)) {
          throw new AirtableServiceError(`Airtable service unavailable (HTTP ${response.status})`);
        }

        if (response.status === 404) {
          throw new AirtableRecordNotFoundError(recordId);
        }

        if (!response.ok) {
          throw new AirtableServiceError(`Airtable API error (HTTP ${response.status})`);
        }
      } catch (error: unknown) {
        if (error instanceof AirtableRateLimitError
          || error instanceof AirtableServiceError
          || error instanceof AirtableRecordNotFoundError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new AirtableNetworkError("Airtable API request timed out");
        }

        if (error instanceof TypeError && error.message.includes("fetch")) {
          throw new AirtableNetworkError(`Airtable network error: ${String(redact(error.message))}`);
        }

        throw new AirtableNetworkError(`Airtable request failed: ${String(redact(String(error)))}`);
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
