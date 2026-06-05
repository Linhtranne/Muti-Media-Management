/**
 * US-014: Postgres-based Idempotency Guard for RabbitMQ message processing.
 *
 * Uses an additive `event_bus_messages` table to track processed events.
 * If the table does not exist, falls back gracefully (logs warning, does NOT throw).
 *
 * ACK rules (from US-014 plan):
 * - Worker MUST NOT process a message if idempotency_key is already SUCCEEDED.
 * - If status is PROCESSING (stale), attempt recovery based on `attempts`.
 * - If table unavailable, skip check and log warning — do not block the queue.
 */

import type pg from "pg";
import type { Logger } from "../lib/logger.js";

export type IdempotencyStatus = "processing" | "succeeded" | "failed";

export interface IdempotencyRecord {
  event_id: string;
  idempotency_key: string;
  workspace_id: string;
  event_type: string;
  queue_name: string;
  status: IdempotencyStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface IdempotencyCheckResult {
  /** Whether the event was already successfully processed */
  isDuplicate: boolean;
  /** Whether the guard table is available */
  available: boolean;
  /** Existing record if found */
  existing?: IdempotencyRecord;
}

/**
 * Check if an event has already been processed.
 * Inserts a "processing" record if not found (atomic via ON CONFLICT DO NOTHING).
 * Returns `isDuplicate: true` if the event was already succeeded.
 */
export async function checkIdempotency(
  client: pg.PoolClient | pg.Pool,
  input: {
    eventId: string;
    idempotencyKey: string;
    workspaceId: string;
    eventType: string;
    queueName: string;
  },
  logger: Logger
): Promise<IdempotencyCheckResult> {
  try {
    // Insert new record — do nothing if idempotency_key already exists
    await client.query(
      `INSERT INTO event_bus_messages (
        event_id, idempotency_key, workspace_id, event_type, queue_name,
        status, attempts, last_error, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'processing', 1, NULL, NOW(), NOW())
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
      [
        input.eventId,
        input.idempotencyKey,
        input.workspaceId,
        input.eventType,
        input.queueName
      ]
    );

    // Fetch current state
    const result = await client.query<IdempotencyRecord>(
      `SELECT * FROM event_bus_messages WHERE workspace_id = $1 AND idempotency_key = $2`,
      [input.workspaceId, input.idempotencyKey]
    );

    if (result.rows.length === 0) {
      // Should not happen but handle gracefully
      return { isDuplicate: false, available: true };
    }

    const record = result.rows[0];

    if (record.status === "succeeded") {
      logger.info("Idempotency guard: event already succeeded — skipping", {
        eventId: input.eventId,
        idempotencyKey: input.idempotencyKey,
        queueName: input.queueName
      });
      return { isDuplicate: true, available: true, existing: record };
    }

    return { isDuplicate: false, available: true, existing: record };
  } catch (err) {
    // Table may not exist yet — fail open with warning
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("does not exist") || errMsg.includes("relation")) {
      logger.warn(
        "Idempotency guard table (event_bus_messages) not found — skipping check. " +
          "Run migration 0014_us014_event_bus_messages.sql to enable.",
        { queueName: input.queueName }
      );
      return { isDuplicate: false, available: false };
    }
    logger.error("Idempotency guard check failed with unexpected error", {
      error: errMsg,
      eventId: input.eventId,
      queueName: input.queueName
    });
    return { isDuplicate: false, available: false };
  }
}

/**
 * Mark an event as succeeded in the idempotency table.
 * Called after Ledger commit — safe to skip if table unavailable.
 */
export async function markIdempotencySucceeded(
  client: pg.PoolClient | pg.Pool,
  workspaceId: string,
  idempotencyKey: string,
  logger: Logger
): Promise<void> {
  try {
    await client.query(
      `UPDATE event_bus_messages
       SET status = 'succeeded', updated_at = NOW()
       WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey]
    );
  } catch (err) {
    logger.warn("Idempotency guard: could not mark succeeded (table may not exist)", {
      workspaceId,
      idempotencyKey,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Mark an event as failed and increment attempts.
 * Called before DLQ routing.
 */
export async function markIdempotencyFailed(
  client: pg.PoolClient | pg.Pool,
  workspaceId: string,
  idempotencyKey: string,
  lastError: string,
  logger: Logger
): Promise<void> {
  try {
    await client.query(
      `UPDATE event_bus_messages
       SET status = 'failed', last_error = $3, attempts = attempts + 1, updated_at = NOW()
       WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey, lastError.slice(0, 1000)]
    );
  } catch (err) {
    logger.warn("Idempotency guard: could not mark failed (table may not exist)", {
      workspaceId,
      idempotencyKey,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
