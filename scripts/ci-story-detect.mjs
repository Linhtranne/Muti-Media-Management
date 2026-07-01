#!/usr/bin/env node
/**
 * ci-story-detect.mjs
 *
 * CI-safe STORY-ID detector for GitHub Actions.
 * Does not use git diff --cached because there are no staged files in CI.
 *
 * Detection sources, scanned in order:
 *   1. GITHUB_HEAD_REF   - PR source branch
 *   2. GITHUB_REF_NAME   - branch/tag short name
 *   3. GITHUB_REF        - full ref, for example refs/heads/feature/US-001
 *   4. PR title from GITHUB_EVENT_PATH
 *
 * Pattern: US-\d+ or AI-SDLC-\d+.
 * IDs are normalized to uppercase and deduplicated.
 * Returns an empty array when none are found; callers must fail closed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STORY_PATTERN = /(US-\d+|AI-SDLC-\d+)/gi;

/**
 * Extract all unique story IDs from a string.
 * @param {string} text
 * @returns {string[]}
 */
export function extractStoryIds(text) {
  if (!text) return [];
  const matches = text.matchAll(STORY_PATTERN);
  const ids = new Set();
  for (const match of matches) {
    ids.add(match[1].toUpperCase());
  }
  return [...ids];
}

/**
 * Read the PR title from the GitHub event JSON payload.
 * Returns an empty string on any failure.
 * @param {string|undefined} eventPath
 * @returns {string}
 */
export function readPrTitleFromEventPayload(eventPath) {
  if (!eventPath) return "";
  try {
    const raw = readFileSync(eventPath, "utf8");
    const payload = JSON.parse(raw);
    return payload?.pull_request?.title ?? "";
  } catch {
    return "";
  }
}

/**
 * Detect story IDs from the CI environment.
 * Accepts an env-vars map so the function is unit-testable.
 * @param {{
 *   GITHUB_HEAD_REF?: string,
 *   GITHUB_REF_NAME?: string,
 *   GITHUB_REF?: string,
 *   GITHUB_EVENT_PATH?: string,
 * }} env
 * @returns {string[]}
 */
export function detectCiStoryIds(env = process.env) {
  const candidates = [
    env.GITHUB_HEAD_REF,
    env.GITHUB_REF_NAME,
    env.GITHUB_REF,
    readPrTitleFromEventPayload(env.GITHUB_EVENT_PATH)
  ];

  const ids = new Set();
  for (const candidate of candidates) {
    for (const id of extractStoryIds(candidate ?? "")) {
      ids.add(id);
    }
  }

  return [...ids];
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  const storyIds = detectCiStoryIds(process.env);

  if (storyIds.length === 0) {
    console.error(
      "No STORY-ID detected from CI environment.\n" +
      "Checked: GITHUB_HEAD_REF, GITHUB_REF_NAME, GITHUB_REF, PR title.\n" +
      "Name your branch like feature/US-001-short-desc or set PR title to include a story ID."
    );
    process.exit(1);
  }

  console.log(storyIds.join("\n"));
  process.exit(0);
}
