import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectPlaceholders,
  verifyHeadings,
  verifyStatusApproved
} from "../ai-sdlc-check.mjs";

describe("Content Quality Checker", () => {
  describe("detectPlaceholders", () => {
    it("should detect TODO, TBD, and other placeholders", () => {
      const content = "This is a TODO item with TBD status.";
      const detected = detectPlaceholders(content);
      assert.deepEqual(detected, ["TODO", "TBD"]);
    });

    it("should detect template placeholders like SPEC-000 and YYYY-MM-DD", () => {
      const content = "Updated on YYYY-MM-DD for SPEC-000.";
      const detected = detectPlaceholders(content);
      assert.deepEqual(detected, ["SPEC-000", "YYYY-MM-DD"]);
    });

    it("should detect standalone ellipsis placeholder", () => {
      const content = "Goal:\n- ...";
      const detected = detectPlaceholders(content);
      assert.deepEqual(detected, ["..."]);
    });

    it("should not detect standard ellipses in sentences", () => {
      const content = "We searched here... and found nothing.";
      const detected = detectPlaceholders(content);
      assert.deepEqual(detected, []);
    });
  });

  describe("verifyHeadings", () => {
    it("should pass when required headings exist", () => {
      const content = `
# SPEC-US-100: Title
## Goal
This is the goal.
## In Scope
Items.
## Out of Scope
Items.
## Acceptance Criteria
Rules.
      `;
      const missing = verifyHeadings("docs/specs/SPEC-US-100.md", content);
      assert.deepEqual(missing, []);
    });

    it("should fail and list missing headings if absent", () => {
      const content = `
# SPEC-US-100: Title
## Goal
This is the goal.
      `;
      const missing = verifyHeadings("docs/specs/SPEC-US-100.md", content);
      assert.deepEqual(missing, ["In Scope", "Out of Scope", "Acceptance Criteria"]);
    });

    it("should handle numbered headings correctly", () => {
      const content = `
# SPEC-US-100: Title
## 1. Goal
This is the goal.
## 2. In Scope / Out of Scope
We do this.
## 6. Acceptance Criteria
Rules.
      `;
      // In Scope / Out of Scope matches "In Scope" or "Out of Scope"
      const missing = verifyHeadings("docs/specs/SPEC-US-100.md", content);
      assert.ok(!missing.includes("Goal"));
      assert.ok(!missing.includes("Acceptance Criteria"));
    });
  });

  describe("verifyStatusApproved", () => {
    it("should return true for approved status in various formats", () => {
      assert.equal(verifyStatusApproved("Status: Approved"), true);
      assert.equal(verifyStatusApproved("status: approved"), true);
      assert.equal(verifyStatusApproved("**Status:** approved"), true);
    });

    it("should return false for draft or missing status", () => {
      assert.equal(verifyStatusApproved("Status: draft"), false);
      assert.equal(verifyStatusApproved("status: TBD"), false);
      assert.equal(verifyStatusApproved("Nothing here"), false);
    });
  });
});
