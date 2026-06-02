import type pg from "pg";
import { sanitizeAuditMetadata } from "../lib/auditRedactor.js";

type AuditMetadata = Record<string, unknown>;

export interface AuditLogInput {
  workspaceId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType?: string | null;
  actorId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  idempotencyKey?: string | null;
  severity?: "info" | "warn" | "error" | "critical";
  metadata?: AuditMetadata;
}

export class AuditLogRepository {
  sanitizeAuditMetadata(metadata: AuditMetadata): AuditMetadata {
    return sanitizeAuditMetadata(metadata);
  }

  async insertAuditLog(client: pg.PoolClient, input: AuditLogInput): Promise<void> {
    const sanitizedMetadata = this.sanitizeAuditMetadata(input.metadata || {});

    await client.query(
      `INSERT INTO audit_logs (
        workspace_id,
        event_type,
        entity_type,
        entity_id,
        actor_type,
        actor_id,
        correlation_id,
        causation_id,
        idempotency_key,
        severity,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      ) ON CONFLICT (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        input.workspaceId,
        input.eventType,
        input.entityType,
        input.entityId,
        input.actorType || "system",
        input.actorId || "system",
        input.correlationId || null,
        input.causationId || null,
        input.idempotencyKey || null,
        input.severity || "info",
        sanitizedMetadata,
      ]
    );
  }
}
