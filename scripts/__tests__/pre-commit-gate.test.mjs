import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseStoryFromBranch,
  parseStoryFromPaths
} from "../pre-commit-gate.mjs";

describe("Pre-commit Gate Parser", () => {
  describe("parseStoryFromPaths", () => {
    it("should extract STORY-ID from various file paths", () => {
      const files = [
        "docs/specs/SPEC-US-007-facebook-comment-sync.md",
        "docs/plans/US-007/PLAN-us-007.md",
        "apps/orchestrator/src/server.ts"
      ];
      const storyIds = parseStoryFromPaths(files);
      assert.deepEqual(storyIds, ["US-007"]);
    });

    it("should handle AI-SDLC format story IDs", () => {
      const files = [
        "docs/testing/AI-SDLC-002/RED-AI-SDLC-002.md"
      ];
      const storyIds = parseStoryFromPaths(files);
      assert.deepEqual(storyIds, ["AI-SDLC-002"]);
    });

    it("should return empty array if no story ID matches in paths", () => {
      const files = [
        "package.json",
        "README.md"
      ];
      const storyIds = parseStoryFromPaths(files);
      assert.deepEqual(storyIds, []);
    });
  });

  describe("parseStoryFromBranch", () => {
    it("should extract STORY-ID from feature branch name", () => {
      assert.equal(parseStoryFromBranch("feature/US-007-facebook-sync"), "US-007");
      assert.equal(parseStoryFromBranch("fix/AI-SDLC-002-gate-checker"), "AI-SDLC-002");
    });

    it("should return null if branch does not contain story ID", () => {
      assert.equal(parseStoryFromBranch("main"), null);
      assert.equal(parseStoryFromBranch("dev"), null);
    });
  });
});
