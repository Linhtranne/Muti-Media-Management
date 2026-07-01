import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { traceAcceptanceCriteria } from "../ai-sdlc-check.mjs";

describe("Acceptance Criteria Tracing", () => {
  it("should pass when all ACs are traced successfully", () => {
    const spec = `
# SPEC-US-100: Title
## Acceptance Criteria
- AC-001: Success path
- AC-002: Error path
    `;
    const plan = `
## Tasks
- Implement AC-001
- Implement AC-002
    `;
    const tests = [
      "describe('AC-001', ...)",
      "describe('AC-002', ...)"
    ];
    const report = `
## Acceptance Criteria Mapping
| AC | Requirement | Evidence | Status |
|---|---|---|---|
| AC-001 | Success path | test | Pass |
| AC-002 | Error path | test | Pass |
    `;

    const result = traceAcceptanceCriteria({
      specContent: spec,
      planContent: plan,
      testContents: tests,
      reportContent: report
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.untraced, []);
  });

  it("should fail when AC is missing from plan, test, or report", () => {
    const spec = `
# SPEC-US-100: Title
## Acceptance Criteria
- AC-001: Success path
- AC-002: Error path
    `;
    const plan = `
## Tasks
- Implement AC-001 only.
    `;
    const tests = [
      "describe('AC-001')"
    ];
    const report = `
| AC | Requirement | Evidence | Status |
|---|---|---|---|
| AC-001 | Success path | test | Pass |
    `;

    const result = traceAcceptanceCriteria({
      specContent: spec,
      planContent: plan,
      testContents: tests,
      reportContent: report
    });

    assert.equal(result.ok, false);
    assert.ok(result.untraced.some(u => u.acCode === "AC-002"));
  });

  it("should fail when AC status in report is not Pass", () => {
    const spec = `
# SPEC-US-100: Title
## Acceptance Criteria
- AC-001: Success path
    `;
    const plan = "AC-001 tasks";
    const tests = ["AC-001 test"];
    const report = `
| AC | Status |
|---|---|
| AC-001 | Fail |
    `;

    const result = traceAcceptanceCriteria({
      specContent: spec,
      planContent: plan,
      testContents: tests,
      reportContent: report
    });

    assert.equal(result.ok, false);
    assert.equal(result.untraced[0].issues[0], "AC-001 status in Report is not Pass (found: Fail)");
  });
});
