import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  extractStoryIds,
  detectCiStoryIds,
  readPrTitleFromEventPayload,
} from "../ci-story-detect.mjs";

// ── extractStoryIds ──────────────────────────────────────────────────────────

describe("extractStoryIds", () => {
  it("extracts US-\\d+ from a string", () => {
    assert.deepEqual(extractStoryIds("feature/US-001-my-feature"), ["US-001"]);
  });

  it("extracts AI-SDLC-\\d+ from a string", () => {
    assert.deepEqual(extractStoryIds("fix/AI-SDLC-002-gate"), ["AI-SDLC-002"]);
  });

  it("normalises to uppercase", () => {
    assert.deepEqual(extractStoryIds("us-007 something"), ["US-007"]);
  });

  it("deduplicates multiple occurrences of the same ID", () => {
    assert.deepEqual(
      extractStoryIds("US-008 and US-008 again"),
      ["US-008"]
    );
  });

  it("extracts multiple distinct story IDs", () => {
    const result = extractStoryIds("US-001 AI-SDLC-002 US-003");
    assert.deepEqual(result, ["US-001", "AI-SDLC-002", "US-003"]);
  });

  it("returns empty array when no ID present", () => {
    assert.deepEqual(extractStoryIds("main"), []);
    assert.deepEqual(extractStoryIds(""), []);
  });
});

// ── readPrTitleFromEventPayload ──────────────────────────────────────────────

describe("readPrTitleFromEventPayload", () => {
  const tmpDir = path.join(tmpdir(), "ci-story-detect-tests");

  it("reads PR title from a valid event JSON", () => {
    mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, "event-valid.json");
    writeFileSync(
      file,
      JSON.stringify({ pull_request: { title: "feat: implement US-042" } }),
      "utf8"
    );
    assert.equal(readPrTitleFromEventPayload(file), "feat: implement US-042");
    rmSync(file);
  });

  it("returns empty string when file does not exist", () => {
    assert.equal(
      readPrTitleFromEventPayload("/nonexistent/path/event.json"),
      ""
    );
  });

  it("returns empty string when eventPath is undefined", () => {
    assert.equal(readPrTitleFromEventPayload(undefined), "");
  });

  it("returns empty string when payload has no pull_request", () => {
    mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, "event-push.json");
    writeFileSync(file, JSON.stringify({ ref: "refs/heads/main" }), "utf8");
    assert.equal(readPrTitleFromEventPayload(file), "");
    rmSync(file);
  });
});

// ── detectCiStoryIds ─────────────────────────────────────────────────────────

describe("detectCiStoryIds", () => {
  it("detects from GITHUB_HEAD_REF (pull_request event)", () => {
    const result = detectCiStoryIds({
      GITHUB_HEAD_REF: "feature/US-007-slack-comments",
    });
    assert.deepEqual(result, ["US-007"]);
  });

  it("detects from GITHUB_REF_NAME (push event)", () => {
    const result = detectCiStoryIds({
      GITHUB_REF_NAME: "feature/US-009-my-story",
    });
    assert.deepEqual(result, ["US-009"]);
  });

  it("detects from GITHUB_REF (full ref fallback)", () => {
    const result = detectCiStoryIds({
      GITHUB_REF: "refs/heads/feature/US-012-some-feature",
    });
    assert.deepEqual(result, ["US-012"]);
  });

  it("detects from PR title event payload", () => {
    const tmpDir = path.join(tmpdir(), "ci-detect-payload-test");
    mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, "event.json");
    writeFileSync(
      file,
      JSON.stringify({ pull_request: { title: "feat(US-042): add CI gate" } }),
      "utf8"
    );
    const result = detectCiStoryIds({ GITHUB_EVENT_PATH: file });
    assert.deepEqual(result, ["US-042"]);
    rmSync(file);
  });

  it("returns empty array when no story ID exists anywhere", () => {
    const result = detectCiStoryIds({
      GITHUB_HEAD_REF: "main",
      GITHUB_REF_NAME: "main",
      GITHUB_REF: "refs/heads/main",
    });
    assert.deepEqual(result, []);
  });

  it("supports multiple story IDs and deduplicates", () => {
    const result = detectCiStoryIds({
      GITHUB_HEAD_REF: "feature/US-001-foo",
      GITHUB_REF_NAME: "feature/US-001-foo",  // same — deduped
      GITHUB_REF: "refs/heads/feature/US-001-foo",
    });
    // US-001 appears in all three sources but should appear once
    assert.deepEqual(result, ["US-001"]);
  });

  it("merges story IDs from multiple sources", () => {
    const tmpDir = path.join(tmpdir(), "ci-detect-multi-test");
    mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, "event.json");
    writeFileSync(
      file,
      JSON.stringify({ pull_request: { title: "chore: US-003 and US-004 combined" } }),
      "utf8"
    );
    const result = detectCiStoryIds({
      GITHUB_HEAD_REF: "feature/US-001-base",
      GITHUB_EVENT_PATH: file,
    });
    // US-001 from branch, US-003 and US-004 from PR title
    assert.ok(result.includes("US-001"), "should include US-001");
    assert.ok(result.includes("US-003"), "should include US-003");
    assert.ok(result.includes("US-004"), "should include US-004");
    assert.equal(result.length, 3, "should have exactly 3 unique IDs");
    rmSync(file);
  });
});
