import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildRequiredArtifactPaths,
  checkStoryArtifacts,
  parseStoryArgument
} from "../ai-sdlc-check.mjs";

const PILOT_STORY_ID = "AI-SDLC-001";

async function withTemporaryWorkspace(callback) {
  const workspace = await mkdtemp(path.join(tmpdir(), "ai-sdlc-check-"));

  try {
    return await callback(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function getMinimalPassingContent(relativePath) {
  if (relativePath.includes("SPEC-")) {
    return "Status: Approved\n## Goal\n## In Scope\n## Out of Scope\n## Acceptance Criteria";
  }
  if (relativePath.includes("PLAN-")) {
    return "Status: Approved\n## Goal\n## Tasks\n## Done When";
  }
  if (relativePath.includes("REPORT-")) {
    return "## Summary\n## What Was Done\n## How It Was Done\n## Verification\n## AI-SDLC Completion Gate";
  }
  if (relativePath.includes("RED-")) {
    return "## RED Evidence\n## Baseline\n## Failing";
  }
  return "## Goal\n## Tasks\n## Summary\n## Verification";
}

async function writeRequiredArtifacts(workspace, storyId) {
  const requiredPaths = await buildRequiredArtifactPaths(storyId, workspace);

  for (const relativePath of requiredPaths) {
    const absolutePath = path.join(workspace, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, getMinimalPassingContent(relativePath), { encoding: "utf8", flush: false });
  }
}

describe("AI-SDLC completion gate checker", () => {
  it("passes when all required story artifacts exist", async () => {
    await withTemporaryWorkspace(async (workspace) => {
      await writeRequiredArtifacts(workspace, PILOT_STORY_ID);

      const result = await checkStoryArtifacts({
        storyId: PILOT_STORY_ID,
        workspaceRoot: workspace
      });

      assert.equal(result.ok, true);
      assert.deepEqual(result.missing, []);
    });
  });

  it("fails and lists missing artifacts when required files are absent", async () => {
    await withTemporaryWorkspace(async (workspace) => {
      const result = await checkStoryArtifacts({
        storyId: PILOT_STORY_ID,
        workspaceRoot: workspace
      });

      assert.equal(result.ok, false);
      assert.ok(result.missing.includes("docs/specs/SPEC-AI-SDLC-001-Completion-Gate-Checker.md"));
    });
  });

  it("requires a story argument", () => {
    assert.throws(
      () => parseStoryArgument([]),
      /Usage: npm run ai-sdlc:check -- <STORY-ID>/
    );
  });

  it("accepts a positional story argument for npm and PowerShell compatibility", () => {
    assert.equal(parseStoryArgument([PILOT_STORY_ID]), PILOT_STORY_ID);
  });

  it("requires the full pilot evidence set", async () => {
    const requiredPaths = await buildRequiredArtifactPaths(PILOT_STORY_ID);

    assert.ok(requiredPaths.includes("docs/testing/AI-SDLC-001/BASELINE-AI-SDLC-001-Completion-Gate-Checker.md"));
    assert.ok(requiredPaths.includes("docs/testing/AI-SDLC-001/GREEN-AI-SDLC-001-Completion-Gate-Checker.md"));
    assert.ok(requiredPaths.includes("docs/testing/AI-SDLC-001/REFACTOR-AI-SDLC-001-Completion-Gate-Checker.md"));
    assert.ok(requiredPaths.includes("docs/testing/AI-SDLC-001/APPROVAL-AI-SDLC-001-Completion-Gate-Checker.md"));
  });
});
