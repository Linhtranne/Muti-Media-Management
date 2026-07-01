#!/usr/bin/env node
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStoryFromBranch, parseStoryFromPaths } from "./pre-commit-gate.mjs";

const USAGE_TEXT = "Usage: npm run story:detect";

function runGitCommand(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function detectStoryIds({ stagedFiles = [], branchName = "" }) {
  const storyIdsFromPaths = parseStoryFromPaths(stagedFiles);
  if (storyIdsFromPaths.length > 0) {
    return storyIdsFromPaths;
  }

  const storyIdFromBranch = parseStoryFromBranch(branchName);
  return storyIdFromBranch ? [storyIdFromBranch] : [];
}

export function getCurrentStoryIds() {
  const diffOutput = runGitCommand("git diff --cached --name-only");
  const stagedFiles = diffOutput ? diffOutput.split("\n").filter(Boolean) : [];
  const branchName = runGitCommand("git rev-parse --abbrev-ref HEAD");

  return detectStoryIds({ stagedFiles, branchName });
}

async function runCli() {
  try {
    const storyIds = getCurrentStoryIds();

    if (storyIds.length === 0) {
      console.error("No active STORY-ID detected from staged files or branch.");
      return 1;
    }

    console.log(storyIds.join("\n"));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : USAGE_TEXT);
    return 1;
  }
}

const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
  const exitCode = await runCli();
  process.exit(exitCode);
}
