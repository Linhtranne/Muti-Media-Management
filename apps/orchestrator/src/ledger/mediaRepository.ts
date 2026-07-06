import type pg from "pg";

const FIRST_ROW_INDEX = 0;
const DEFAULT_SORT_ORDER = 0;

export interface MediaAssetInput {
  workspace_id: string;
  post_id: string;
  airtable_record_id: string;
  source_type: "airtable_attachment" | "public_url";
  source_url_hash: string;
  original_filename: string;
  original_mime_type: string;
  original_size_bytes: number;
  sha256?: string | null;
  status?: "received" | "downloading" | "optimizing" | "ready" | "failed";
}

export interface MediaAssetDerivativeInput {
  workspace_id: string;
  media_asset_id: string;
  derivative_kind: "optimized_original" | "tiktok_video" | "tiktok_photo" | "facebook_image" | "facebook_link_preview";
  storage_provider?: string;
  storage_bucket: string;
  storage_key: string;
  public_url: string;
  mime_type: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  status?: "ready" | "failed";
}

export interface PostMediaAssetInput {
  workspace_id: string;
  post_id: string;
  content_variant_id?: string | null;
  media_asset_id: string;
  sort_order: number;
  platform_eligibility?: Record<string, unknown>;
}

export interface MediaAssetDbRow {
  id: string;
  workspace_id: string;
  post_id: string;
  airtable_record_id: string;
  source_type: "airtable_attachment" | "public_url";
  source_url_hash: string;
  original_filename: string;
  original_mime_type: string;
  original_size_bytes: string; // postgres bigint returns string
  sha256: string | null;
  status: "received" | "downloading" | "optimizing" | "ready" | "failed";
  error_code: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PostMediaAssetDbRow {
  id: string;
  workspace_id: string;
  post_id: string;
  content_variant_id: string | null;
  media_asset_id: string;
  sort_order: number;
  platform_eligibility: Record<string, unknown>;
  created_at: Date;
}

export class MediaRepository {
  public async getMediaAssetById(
    client: pg.PoolClient | pg.Pool,
    workspaceId: string,
    id: string
  ): Promise<MediaAssetDbRow | null> {
    const res = await client.query<MediaAssetDbRow>(
      "SELECT id, workspace_id, post_id, airtable_record_id, source_type, source_url_hash, original_filename, original_mime_type, original_size_bytes, sha256, status, error_code, created_at, updated_at FROM media_assets WHERE id = $1 AND workspace_id = $2",
      [id, workspaceId]
    );
    return res.rows[FIRST_ROW_INDEX] || null;
  }

  public async getMediaAssetBySourceHash(
    client: pg.PoolClient | pg.Pool,
    workspaceId: string,
    postId: string,
    sourceUrlHash: string
  ): Promise<MediaAssetDbRow | null> {
    const res = await client.query<MediaAssetDbRow>(
      "SELECT id, workspace_id, post_id, airtable_record_id, source_type, source_url_hash, original_filename, original_mime_type, original_size_bytes, sha256, status, error_code, created_at, updated_at FROM media_assets WHERE workspace_id = $1 AND post_id = $2 AND source_url_hash = $3",
      [workspaceId, postId, sourceUrlHash]
    );
    return res.rows[FIRST_ROW_INDEX] || null;
  }

  public async insertMediaAsset(
    client: pg.PoolClient | pg.Pool,
    input: MediaAssetInput
  ): Promise<MediaAssetDbRow> {
    const res = await client.query<MediaAssetDbRow>(
      `INSERT INTO media_assets (
        workspace_id, post_id, airtable_record_id, source_type, source_url_hash,
        original_filename, original_mime_type, original_size_bytes, sha256, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (workspace_id, post_id, source_url_hash) DO UPDATE
      SET airtable_record_id = EXCLUDED.airtable_record_id,
          original_filename = EXCLUDED.original_filename,
          original_mime_type = EXCLUDED.original_mime_type,
          original_size_bytes = EXCLUDED.original_size_bytes,
          sha256 = COALESCE(EXCLUDED.sha256, media_assets.sha256),
          status = CASE
            WHEN media_assets.status = 'ready' THEN media_assets.status
            ELSE EXCLUDED.status
          END,
          updated_at = NOW()
      RETURNING id, workspace_id, post_id, airtable_record_id, source_type, source_url_hash, original_filename, original_mime_type, original_size_bytes, sha256, status, error_code, created_at, updated_at`,
      [
        input.workspace_id,
        input.post_id,
        input.airtable_record_id,
        input.source_type,
        input.source_url_hash,
        input.original_filename,
        input.original_mime_type,
        input.original_size_bytes,
        input.sha256 || null,
        input.status || "received"
      ]
    );
    return res.rows[FIRST_ROW_INDEX];
  }

  public async updateMediaAssetStatus(
    client: pg.PoolClient | pg.Pool,
    workspaceId: string,
    id: string,
    status: "received" | "downloading" | "optimizing" | "ready" | "failed",
    errorCode?: string | null,
    sha256?: string | null,
    sizeBytes?: number | null
  ): Promise<MediaAssetDbRow | null> {
    const res = await client.query<MediaAssetDbRow>(
      `UPDATE media_assets
       SET status = $1,
           error_code = $2,
           sha256 = COALESCE($3, sha256),
           original_size_bytes = COALESCE($4, original_size_bytes),
           updated_at = NOW()
       WHERE id = $5 AND workspace_id = $6
       RETURNING id, workspace_id, post_id, airtable_record_id, source_type, source_url_hash, original_filename, original_mime_type, original_size_bytes, sha256, status, error_code, created_at, updated_at`,
      [status, errorCode || null, sha256 || null, sizeBytes || null, id, workspaceId]
    );
    return res.rows[FIRST_ROW_INDEX] || null;
  }

  public async insertMediaAssetDerivative(
    client: pg.PoolClient | pg.Pool,
    input: MediaAssetDerivativeInput
  ): Promise<void> {
    await client.query(
      `INSERT INTO media_asset_derivatives (
        workspace_id, media_asset_id, derivative_kind, storage_provider,
        storage_bucket, storage_key, public_url, mime_type, size_bytes,
        width, height, duration_seconds, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (workspace_id, media_asset_id, derivative_kind) DO UPDATE
      SET storage_bucket = EXCLUDED.storage_bucket,
          storage_key = EXCLUDED.storage_key,
          public_url = EXCLUDED.public_url,
          mime_type = EXCLUDED.mime_type,
          size_bytes = EXCLUDED.size_bytes,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          duration_seconds = EXCLUDED.duration_seconds,
          status = EXCLUDED.status`,
      [
        input.workspace_id,
        input.media_asset_id,
        input.derivative_kind,
        input.storage_provider || "cloudflare_r2",
        input.storage_bucket,
        input.storage_key,
        input.public_url,
        input.mime_type,
        input.size_bytes,
        input.width || null,
        input.height || null,
        input.duration_seconds ? String(input.duration_seconds) : null,
        input.status || "ready"
      ]
    );
  }

  public async insertPostMediaAsset(
    client: pg.PoolClient | pg.Pool,
    input: PostMediaAssetInput
  ): Promise<PostMediaAssetDbRow> {
    const res = await client.query<PostMediaAssetDbRow>(
      `INSERT INTO post_media_assets (
        workspace_id, post_id, content_variant_id, media_asset_id, sort_order, platform_eligibility
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (workspace_id, post_id, content_variant_id, media_asset_id) DO UPDATE
      SET sort_order = EXCLUDED.sort_order,
          platform_eligibility = EXCLUDED.platform_eligibility
      RETURNING id, workspace_id, post_id, content_variant_id, media_asset_id, sort_order, platform_eligibility, created_at`,
      [
        input.workspace_id,
        input.post_id,
        input.content_variant_id || null,
        input.media_asset_id,
        input.sort_order ?? DEFAULT_SORT_ORDER,
        input.platform_eligibility || {}
      ]
    );
    return res.rows[FIRST_ROW_INDEX];
  }

  public async updatePostMediaEligibility(
    client: pg.PoolClient | pg.Pool,
    workspaceId: string,
    postId: string,
    eligibility: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      `UPDATE post_media_assets
       SET platform_eligibility = $1
       WHERE workspace_id = $2 AND post_id = $3`,
      [eligibility, workspaceId, postId]
    );
  }

  public async getPostMediaAssetsJoined(
    client: pg.PoolClient | pg.Pool,
    workspaceId: string,
    postId: string
  ): Promise<(PostMediaAssetDbRow & { original_mime_type: string; status: string; sha256: string | null })[]> {
    const res = await client.query<PostMediaAssetDbRow & { original_mime_type: string; status: string; sha256: string | null }>(
      `SELECT pma.id, pma.workspace_id, pma.post_id, pma.content_variant_id, pma.media_asset_id, pma.sort_order, pma.platform_eligibility, pma.created_at,
              ma.original_mime_type, ma.status, ma.sha256
       FROM post_media_assets pma
       JOIN media_assets ma ON pma.media_asset_id = ma.id
       WHERE pma.workspace_id = $1 AND pma.post_id = $2
       ORDER BY pma.sort_order ASC`,
      [workspaceId, postId]
    );
    return res.rows;
  }
}
