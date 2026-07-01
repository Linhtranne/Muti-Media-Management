import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectStoryIds } from "../story-detect.mjs";

describe("Story detector", () => {
  it("prefers story IDs from staged file paths", () => {
    const storyIds = detectStoryIds({
      stagedFiles: [
        "docs/specs/SPEC-US-008.md",
        "apps/orchestrator/src/server.ts"
      ],
      branchName: "feature/US-009-slack-comment-action"
    });

    assert.deepEqual(storyIds, ["US-008"]);
  });

  it("falls back to branch name when staged paths do not contain a story ID", () => {
    const storyIds = detectStoryIds({
      stagedFiles: ["package.json"],
      branchName: "feature/US-014-rabbitmq-hardening"
    });

    assert.deepEqual(storyIds, ["US-014"]);
  });

  it("returns an empty list when neither staged files nor branch include a story ID", () => {
    const storyIds = detectStoryIds({
      stagedFiles: ["package.json"],
      branchName: "main"
    });

    assert.deepEqual(storyIds, []);
  });
});
