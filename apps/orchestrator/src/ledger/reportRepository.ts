import type pg from "pg";
import type { CampaignReportQuery, CampaignReportRow } from "@mediaops/shared-contracts";
import { AuditLogRepository } from "./auditLogRepository.js";

export interface CampaignReportSqlRow {
  campaign_id: string | null;
  posts_published: string;
  publish_failed: string;
  comments_total: string;
  risk_comments: string;
  avg_response_time: string | null;
  last_updated_at: string | null;
}

export class ReportRepository {
  async getCampaignReport(
    client: pg.PoolClient,
    workspaceId: string,
    query: CampaignReportQuery
  ): Promise<CampaignReportRow[]> {
    const conditions: string[] = ["pj.workspace_id = $1"];
    const params: unknown[] = [workspaceId];
    if (query.campaign_id) {
      params.push(query.campaign_id);
      conditions.push(`pj.campaign_id = $${params.length}`);
    }
    if (query.date_from) {
      params.push(query.date_from);
      conditions.push(`pj.created_at >= $${params.length}`);
    }
    if (query.date_to) {
      params.push(query.date_to);
      conditions.push(`pj.created_at <= $${params.length}`);
    }
    if (query.channel_account_id) {
      params.push(query.channel_account_id);
      conditions.push(`pj.channel_account_id = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      WITH comment_agg AS (
        SELECT 
          publish_job_id,
          COUNT(*) FILTER (WHERE interaction_type = 'comment') AS comments_total,
          COUNT(*) FILTER (WHERE risk_code = 'CRISIS') AS risk_comments,
          SUM(EXTRACT(EPOCH FROM (resolved_at - created_at_platform))) FILTER (WHERE status = 'resolved' AND resolved_at IS NOT NULL) AS response_time_sum,
          COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at IS NOT NULL) AS response_time_count,
          MAX(updated_at) AS max_updated_at
        FROM interactions
        WHERE workspace_id = $1
        GROUP BY publish_job_id
      )
      SELECT 
        pj.campaign_id,
        COUNT(*) FILTER (WHERE pj.status = 'published')::integer AS posts_published,
        COUNT(*) FILTER (WHERE pj.status IN ('failed', 'validation_failed'))::integer AS publish_failed,
        COALESCE(SUM(ca.comments_total), 0)::integer AS comments_total,
        COALESCE(SUM(ca.risk_comments), 0)::integer AS risk_comments,
        (SUM(ca.response_time_sum) / NULLIF(SUM(ca.response_time_count), 0)) AS avg_response_time,
        MAX(GREATEST(pj.updated_at, COALESCE(ca.max_updated_at, pj.updated_at))) AS last_updated_at
      FROM publish_jobs pj
      LEFT JOIN comment_agg ca ON pj.id = ca.publish_job_id
      ${whereClause}
      GROUP BY pj.campaign_id
      ORDER BY pj.campaign_id NULLS LAST
    `;

    const result = await client.query<CampaignReportSqlRow>(sql, params);

    return result.rows.map(row => ({
      campaign_id: row.campaign_id || null,
      posts_published: Number.parseInt(row.posts_published, 10),
      publish_failed: Number.parseInt(row.publish_failed, 10),
      comments_total: Number.parseInt(row.comments_total, 10),
      risk_comments: Number.parseInt(row.risk_comments, 10),
      avg_response_time: row.avg_response_time == null ? null : Number.parseFloat(row.avg_response_time),
      last_updated_at: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : null
    }));
  }

  async insertAuditLog(
    client: pg.PoolClient,
    workspaceId: string,
    eventType: "REPORT_ACCESSED" | "REPORT_EXPORTED",
    query: CampaignReportQuery,
    actorId: string | null = null
  ): Promise<void> {
    const auditRepo = new AuditLogRepository();
    await auditRepo.insertAuditLog(client, {
      workspaceId,
      eventType,
      entityType: 'report',
      entityId: 'campaign_report',
      actorType: 'user',
      actorId: actorId || 'unknown',
      metadata: {
        campaign_id: query.campaign_id,
        date_from: query.date_from,
        date_to: query.date_to,
        channel_account_id: query.channel_account_id
      }
    });
  }

  async verifyUserRole(
    client: pg.PoolClient,
    workspaceId: string,
    userId: string
  ): Promise<boolean> {
    const res = await client.query<{ role: string }>(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND slack_user_id = $2`,
      [workspaceId, userId]
    );
    const role = res.rows[0]?.role;
    return role === "admin" || role === "manager";
  }
}
