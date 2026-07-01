## US-013 AC Trace

- AC1: Retrofit RED evidence covers valid Notion context behavior.
- AC2: Retrofit RED evidence covers invalid page id and unsafe origin behavior.
- AC3: Retrofit RED evidence covers timeout and response-size behavior.
- AC4: Retrofit RED evidence covers token and raw response boundary behavior.
- AC5: Retrofit RED evidence covers prompt injection boundary behavior.

# RED-US-013: Notion Knowledge Brief Context Loader

## RED Evidence

This is a retrofit evidence file. Original RED output was not captured at implementation time.

Current gap: US-013 predates the AI-SDLC completion gate or was completed before the repository required story-level RED artifacts.

Follow-up: future behavior changes for US-013 must capture real RED before production code changes.

## Failing Test / Check

- Retrofit gate failure: `npm run ai-sdlc:validate -- US-013` failed before this documentation retrofit because required AI-SDLC artifacts or headings were missing.
- AC-001: Historical implementation evidence exists in the story plan/report, but original failing test output is unavailable.
- AC-002: Historical implementation evidence exists in the story plan/report, but original failing test output is unavailable.
- AC-003: Historical implementation evidence exists in the story plan/report, but original failing test output is unavailable.
- AC-004: The current AI-SDLC artifact gate is the failing check being remediated by this retrofit.

## Command

```powershell
npm run ai-sdlc:validate -- US-013
```

## Failure Output

The checker reported missing or incomplete AI-SDLC artifacts for this historical story, such as missing spec files, missing RED evidence files, missing required plan headings, missing report completion gate sections, or incomplete AC traceability.

## Why This Proves the Needed Behavior

The failure proves the story was not yet compliant with the new Automated L2 completion gate. This retrofit creates traceable artifacts but keeps the RED verdict Partial because the original implementation-time RED cycle cannot be reconstructed honestly.

## Expected Result

After retrofit, `npm run ai-sdlc:check -- US-013` should pass artifact existence, required headings, approved status, and AC traceability checks.

## Baseline

- Baseline state: historical story artifacts existed but did not fully match the new AI-SDLC checker contract.
- Retrofit verdict for RED: Partial.
