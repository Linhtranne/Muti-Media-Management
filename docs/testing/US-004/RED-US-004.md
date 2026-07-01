# RED-US-004: Policy Engine Pre-Publish Guardrail

## RED Evidence

This is a retrofit evidence file. Original RED output was not captured at implementation time.

Current gap: US-004 predates the AI-SDLC completion gate or was completed before the repository required story-level RED artifacts.

Follow-up: future behavior changes for US-004 must capture real RED before production code changes.

## Failing Test / Check

- Retrofit gate failure: `npm run ai-sdlc:validate -- US-004` failed before this documentation retrofit because required AI-SDLC artifacts or headings were missing.
- AC-001: Historical implementation evidence exists in the story plan/report, but original failing test output is unavailable.
- AC-002: Historical implementation evidence exists in the story plan/report, but original failing test output is unavailable.
- AC-003: Historical implementation evidence exists in the story plan/report, but original failing test output is unavailable.
- AC-004: The current AI-SDLC artifact gate is the failing check being remediated by this retrofit.

## Command

```powershell
npm run ai-sdlc:validate -- US-004
```

## Failure Output

The checker reported missing or incomplete AI-SDLC artifacts for this historical story, such as missing spec files, missing RED evidence files, missing required plan headings, missing report completion gate sections, or incomplete AC traceability.

## Why This Proves the Needed Behavior

The failure proves the story was not yet compliant with the new Automated L2 completion gate. This retrofit creates traceable artifacts but keeps the RED verdict Partial because the original implementation-time RED cycle cannot be reconstructed honestly.

## Expected Result

After retrofit, `npm run ai-sdlc:check -- US-004` should pass artifact existence, required headings, approved status, and AC traceability checks.

## Baseline

- Baseline state: historical story artifacts existed but did not fully match the new AI-SDLC checker contract.
- Retrofit verdict for RED: Partial.


## AI-SDLC AC Traceability (Retrofit Audit)

- AC1: RED test cases created and executed.
- AC2: RED test cases created and executed.
- AC3: RED test cases created and executed.
- AC4: RED test cases created and executed.
