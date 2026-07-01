#!/usr/bin/env node
import { writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const preCommitHookPath = path.join(workspaceRoot, ".git/hooks/pre-commit");
const prePushHookPath = path.join(workspaceRoot, ".git/hooks/pre-push");

const preCommitHookContent = `#!/bin/sh
# AI-SDLC pre-commit hook
node scripts/pre-commit-gate.mjs
`;

const prePushHookContent = `#!/bin/sh
# AI-SDLC pre-push hook
node scripts/pre-push-gate.mjs
`;

async function install() {
  try {
    await mkdir(path.dirname(preCommitHookPath), { recursive: true });
    await writeFile(preCommitHookPath, preCommitHookContent, { encoding: "utf8", mode: 0o755 });
    await writeFile(prePushHookPath, prePushHookContent, { encoding: "utf8", mode: 0o755 });
    try {
      await chmod(preCommitHookPath, 0o755);
      await chmod(prePushHookPath, 0o755);
    } catch {
      // ignore permission error on OS that doesn't support chmod
    }
    console.log("✓ AI-SDLC pre-commit hook installed successfully in .git/hooks/pre-commit");
  } catch (error) {
    console.error("❌ Failed to install AI-SDLC pre-commit hook:", error.message);
  }
}

install();
