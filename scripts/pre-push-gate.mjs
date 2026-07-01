#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCurrentStoryIds } from "./story-detect.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runValidation(storyId) {
  return spawnSync(process.execPath, ["scripts/ai-sdlc-validate.mjs", storyId], {
    cwd: workspaceRoot,
    stdio: "inherit"
  }).status ?? 1;
}

export function buildPrePushPlan(storyIds) {
  if (storyIds.length === 0) {
    return {
      ok: false,
      reason: "No active STORY-ID detected from staged files or branch.",
      storyIds: []
    };
  }

  return {
    ok: true,
    reason: null,
    storyIds
  };
}

async function runCli() {
  console.log("Checking AI-SDLC pre-push gate...");

  const plan = buildPrePushPlan(getCurrentStoryIds());
  if (!plan.ok) {
    console.error(plan.reason);
    console.error("Use a branch name like feature/US-008-short-description or include a STORY-ID in staged files.");
    return 1;
  }

  console.log(`Detected story IDs for pre-push validation: ${plan.storyIds.join(", ")}`);

  for (const storyId of plan.storyIds) {
    console.log(`Running story validation for ${storyId}...`);
    const exitCode = runValidation(storyId);
    if (exitCode !== 0) {
      console.error(`AI-SDLC pre-push gate failed for ${storyId}.`);
      return exitCode;
    }
  }

  console.log("AI-SDLC pre-push gate passed.");
  return 0;
}

const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
  const exitCode = await runCli();
  process.exit(exitCode);
}
