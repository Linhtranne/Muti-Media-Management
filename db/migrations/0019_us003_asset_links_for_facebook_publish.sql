ALTER TABLE content_variants
  ADD COLUMN IF NOT EXISTS asset_links JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_content_variants_asset_links_gin
  ON content_variants USING GIN (asset_links);
