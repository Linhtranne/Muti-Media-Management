# RED Evidence: AI-SDLC-002 Native Gate Checker

## Baseline Before RED
- `npm run build`: pass.
- `npm run lint`: pass.
- `npm test`: pass (420 tests, 0 failures).

## Failing Test Added
- File: `scripts/__tests__/ai-sdlc-quality.test.mjs`

Command run:
```powershell
npm test
```

Expected RED result:
```text
SyntaxError: The requested module '../ai-sdlc-check.mjs' does not provide an export named 'detectPlaceholders'
```

## Links
- Spec: [[SPEC-AI-SDLC-002-Native-Gate-Checker]]
- Plan: [[PLAN-AI-SDLC-002-Native-Gate-Checker]]
