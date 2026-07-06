-- Migration: US-016 - Shared Media Asset Storage and Optimization Pipeline
-- Additive tables for media assets, derivatives, and post media mappings.
-- RLS workspace isolation enforced on all tables.

BEGIN;

-- 1. Media Assets Table
CREATE TABLE IF NOT EXISTS media_assets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  post_id               TEXT NOT NULL,
  airtable_record_id    TEXT NOT NULL,
  source_type           TEXT NOT NULL CHECK (source_type IN ('airtable_attachment', 'public_url')),
  source_url_hash       TEXT NOT NULL,
  original_filename     TEXT NOT NULL,
  original_mime_type    TEXT NOT NULL,
  original_size_bytes   BIGINT NOT NULL,
  sha256                TEXT,
  status                TEXT NOT NULL DEFAULT 'received'
                          CHECK (status IN ('received', 'downloading', 'optimizing', 'ready', 'failed')),
  error_code            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_media_assets_post_source
    UNIQUE (workspace_id, post_id, source_url_hash)
);

-- 2. Media Asset Derivatives Table
CREATE TABLE IF NOT EXISTS media_asset_derivatives (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  media_asset_id        UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  derivative_kind       TEXT NOT NULL CHECK (derivative_kind IN (
                          'optimized_original', 'tiktok_video', 'tiktok_photo',
                          'facebook_image', 'facebook_link_preview'
                        )),
  storage_provider      TEXT NOT NULL DEFAULT 'cloudflare_r2',
  storage_bucket        TEXT NOT NULL,
  storage_key           TEXT NOT NULL,
  public_url            TEXT NOT NULL,
  mime_type             TEXT NOT NULL,
  size_bytes            BIGINT NOT NULL,
  width                 INTEGER,
  height                INTEGER,
  duration_seconds      NUMERIC(10, 3),
  status                TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'failed')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_media_asset_derivatives_kind
    UNIQUE (workspace_id, media_asset_id, derivative_kind)
);

-- 3. Post Media Assets Table
CREATE TABLE IF NOT EXISTS post_media_assets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  post_id               TEXT NOT NULL,
  content_variant_id    UUID REFERENCES content_variants(id) ON DELETE SET NULL,
  media_asset_id        UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  platform_eligibility  JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_post_media_assets
    UNIQUE (workspace_id, post_id, content_variant_id, media_asset_id)
);

-- Indexes for performance & quick status/lookup queries
CREATE INDEX IF NOT EXISTS idx_media_assets_workspace_post ON media_assets (workspace_id, post_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_workspace_status ON media_assets (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_media_asset_derivatives_lookup ON media_asset_derivatives (workspace_id, media_asset_id);
CREATE INDEX IF NOT EXISTS idx_post_media_assets_lookup ON post_media_assets (workspace_id, post_id, media_asset_id);
CREATE INDEX IF NOT EXISTS idx_post_media_assets_variant ON post_media_assets (workspace_id, content_variant_id);

-- Enable RLS and isolate by workspace_id
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_asset_derivatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_assets_workspace_isolation ON media_assets
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE POLICY media_asset_derivatives_workspace_isolation ON media_asset_derivatives
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

CREATE POLICY post_media_assets_workspace_isolation ON post_media_assets
  AS RESTRICTIVE FOR ALL
  USING (workspace_id = current_setting('app.current_workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.current_workspace_id', true));

-- Trigger to automatically update updated_at on media_assets
DROP TRIGGER IF EXISTS set_media_assets_updated_at ON media_assets;
CREATE TRIGGER set_media_assets_updated_at
BEFORE UPDATE ON media_assets
FOR EACH ROW
EXECUTE FUNCTION trigger_set_updated_at();

-- Add comments for documentation
COMMENT ON TABLE media_assets IS 'US-016: Original media source metadata and processing status.';
COMMENT ON TABLE media_asset_derivatives IS 'US-016: Optimized media derivatives stored in Cloudflare R2.';
COMMENT ON TABLE post_media_assets IS 'US-016: Ordered relationship mapping media assets to posts and content variants.';

COMMIT;
