# RED-US-017: TikTok Direct Posting MCP

## RED Evidence

This is a pre-implementation RED placeholder for a newly planned story. Production code has not been changed for US-017 in this planning step.

## Baseline

- No `apps/tiktok-mcp-server` implementation exists.
- No TikTok OAuth route exists.
- No TikTok publish queue topology or worker exists.
- No TikTok-specific policy rules exist.
- No TikTok status polling exists.

## Failing Test / Check

The following tests must be written first and fail before implementation:

- AC-001: Policy test expects separate Facebook and TikTok publish jobs from one Airtable record.
- AC-002: Static boundary test expects TikTok API calls to be absent outside `apps/tiktok-mcp-server`.
- AC-003: Policy test expects mixed TikTok photo and video media to fail TikTok only.
- AC-004: Admin setup test expects OAuth production flow and staging seed fallback to be available.
- AC-005: Worker test expects asynchronous TikTok status polling to update Ledger and Airtable status.

## Command

```powershell
npm run test -- tiktok
```

## Expected Failure Output

The test runner should fail because TikTok contracts, MCP tools, routes, queue topology, policy rules, and workers do not exist yet.

## Why This Proves the Needed Behavior

These failures prove TikTok is not yet integrated as a real MCP-backed publishing platform. Implementation may start only after RED failures are captured with command output.

## Expected Result After Implementation

- AC-001: Pass when Facebook and TikTok jobs are created independently.
- AC-002: Pass when TikTok API calls are isolated inside TikTok MCP server.
- AC-003: Pass when mixed media blocks TikTok only.
- AC-004: Pass when OAuth and fallback setup paths are implemented.
- AC-005: Pass when status polling persists final TikTok result.

## AI-SDLC AC Traceability

- AC-001: RED test case planned and must fail before implementation.
- AC-002: RED test case planned and must fail before implementation.
- AC-003: RED test case planned and must fail before implementation.
- AC-004: RED test case planned and must fail before implementation.
- AC-005: RED test case planned and must fail before implementation.
