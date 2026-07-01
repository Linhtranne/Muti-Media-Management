# RED-US-016: Shared Media Asset Storage and Optimization Pipeline

## RED Evidence

This is a pre-implementation RED placeholder for a newly planned story. Production code has not been changed for US-016 in this planning step.

## Baseline

- `media_assets`, `media_asset_derivatives`, and `post_media_assets` do not yet exist as implemented tables for this story.
- No Cloudflare R2 storage adapter exists for publish media derivatives.
- No FFmpeg-backed media optimization worker exists.
- Current media URLs may still be used directly from Airtable or text fields in existing flows.

## Failing Test / Check

The following tests must be written first and fail before implementation:

- AC-001: Contract test rejects raw binaries, raw tokens, signed URL query secrets, and unknown fields in media queue events.
- AC-002: Repository test expects a `media_asset_derivatives` row after a successful R2 upload.
- AC-003: Policy test expects TikTok eligibility to fail independently when mixed media is present.
- AC-004: Worker test expects FFmpeg timeout to mark media as failed and route to DLQ after Ledger update.
- AC-005: Security test expects signed source URL query values to be redacted from logs and audit metadata.

## Command

```powershell
npm run test -- media
```

## Expected Failure Output

The test runner should fail because US-016 contracts, migration, repository, storage adapter, and workers do not exist yet.

## Why This Proves the Needed Behavior

These failing tests prove the repository does not yet provide a shared production media pipeline. Implementation may start only after the RED failures are captured with real command output.

## Expected Result After Implementation

- AC-001: Pass after strict schemas are implemented.
- AC-002: Pass after R2 derivative persistence is implemented.
- AC-003: Pass after platform eligibility computation is implemented.
- AC-004: Pass after FFmpeg worker timeout and DLQ behavior are implemented.
- AC-005: Pass after redaction and audit boundaries are implemented.

## AI-SDLC AC Traceability

- AC-001: RED test case planned and must fail before implementation.
- AC-002: RED test case planned and must fail before implementation.
- AC-003: RED test case planned and must fail before implementation.
- AC-004: RED test case planned and must fail before implementation.
- AC-005: RED test case planned and must fail before implementation.
