-- Migration: US-017 - TikTok Publishing Pipeline
-- Add support for TikTok platform variants and status checks.

BEGIN;

-- 1. Update content_variants platform check constraint dynamically
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_variants_platform_chk') THEN
        ALTER TABLE content_variants DROP CONSTRAINT content_variants_platform_chk;
    END IF;
    ALTER TABLE content_variants ADD CONSTRAINT content_variants_platform_chk CHECK (
        platform IN ('facebook', 'tiktok', 'instagram', 'zalo', 'threads', 'dm', 'youtube')
    );
END $$;

-- 2. Update publish_jobs status constraint to include pending_platform_status
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_jobs_status_chk') THEN
        ALTER TABLE publish_jobs DROP CONSTRAINT publish_jobs_status_chk;
    END IF;
    ALTER TABLE publish_jobs ADD CONSTRAINT publish_jobs_status_chk CHECK (
        status IN ('queued', 'mcp_validating', 'validated', 'validation_failed', 'cancelled', 'needs_review', 'publishing', 'published', 'failed', 'pending_platform_status')
    );
END $$;

-- 3. Add tiktok_request_id column to publish_jobs
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS tiktok_request_id TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_publish_jobs_tiktok_request ON publish_jobs (workspace_id, tiktok_request_id);

-- 4. Update publish_handoff_events type check constraint to support TikTok and other platforms
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_handoff_events_type_chk') THEN
        ALTER TABLE publish_handoff_events DROP CONSTRAINT publish_handoff_events_type_chk;
    END IF;
    ALTER TABLE publish_handoff_events ADD CONSTRAINT publish_handoff_events_type_chk CHECK (
        event_type IN (
            'publish.facebook.requested',
            'publish.tiktok.requested',
            'publish.instagram.requested',
            'publish.zalo.requested',
            'publish.threads.requested',
            'publish.dm.requested',
            'publish.youtube.requested'
        )
    );
END $$;

-- 5. Update mcp_validation_events type check constraint to support TikTok and other platforms
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_validation_events_type_chk') THEN
        ALTER TABLE mcp_validation_events DROP CONSTRAINT mcp_validation_events_type_chk;
    END IF;
    ALTER TABLE mcp_validation_events ADD CONSTRAINT mcp_validation_events_type_chk CHECK (
        event_type IN (
            'publish.facebook.validated',
            'publish.tiktok.validated',
            'publish.instagram.validated',
            'publish.zalo.validated',
            'publish.threads.validated',
            'publish.dm.validated',
            'publish.youtube.validated'
        )
    );
END $$;

COMMIT;
