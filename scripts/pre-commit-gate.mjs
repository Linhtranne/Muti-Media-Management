#!/usr/bin/env node
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseStoryFromPaths(filePaths) {
  const storyIds = new Set();
  const pattern = /(US-\d+|AI-SDLC-\d+)/i;
  for (const filePath of filePaths) {
    const match = filePath.match(pattern);
    if (match) {
      storyIds.add(match[1].toUpperCase());
    }
  }
  return [...storyIds];
}

export function parseStoryFromBranch(branchName) {
  const pattern = /(US-\d+|AI-SDLC-\d+)/i;
  const match = branchName.match(pattern);
  return match ? match[1].toUpperCase() : null;
}

function runGitCommand(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

async function runCli() {
  console.log("Checking AI-SDLC validation gate for staged changes...");
  
  // 1. Get staged files
  const diffOutput = runGitCommand("git diff --cached --name-only");
  const stagedFiles = diffOutput ? diffOutput.split("\n").filter(Boolean) : [];

  // 2. Parse stories from staged files
  let storyIds = parseStoryFromPaths(stagedFiles);

  // 3. Fallback to branch name if no story ID found in staged files
  if (storyIds.length === 0) {
    const branchName = runGitCommand("git rev-parse --abbrev-ref HEAD");
    if (branchName) {
      const storyIdFromBranch = parseStoryFromBranch(branchName);
      if (storyIdFromBranch) {
        storyIds = [storyIdFromBranch];
      }
    }
  }

  // 4. Run validation if story IDs detected
  if (storyIds.length > 0) {
    console.log(`Detected active story IDs: ${storyIds.join(", ")}`);
    for (const storyId of storyIds) {
      console.log(`Running validation gate for ${storyId}...`);
      try {
        execSync(`npm run ai-sdlc:validate -- ${storyId}`, { stdio: "inherit" });
      } catch {
        console.error(`\n❌ AI-SDLC pre-commit validation gate FAILED for ${storyId}.`);
        console.error("Please ensure all specs and plans are approved, and all tests pass before committing.");
        console.error("You can bypass this gate in emergencies using: git commit --no-verify\n");
        return 1;
      }
    }
    console.log("✓ AI-SDLC pre-commit validation gate passed successfully!");
  } else {
    console.log("No active STORY-ID detected from staged files or branch. Skipping automated gate checks.");
  }

  return 0;
}

const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
  const exitCode = await runCli();
  process.exit(exitCode);
}
