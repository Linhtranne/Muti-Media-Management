#!/usr/bin/env node
import { writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const hookPath = path.join(workspaceRoot, ".git/hooks/pre-commit");

const hookContent = `#!/bin/sh
# AI-SDLC pre-commit hook
node scripts/pre-commit-gate.mjs
`;

async function install() {
  try {
    await mkdir(path.dirname(hookPath), { recursive: true });
    await writeFile(hookPath, hookContent, { encoding: "utf8", mode: 0o755 });
    try {
      await chmod(hookPath, 0o755);
    } catch {
      // ignore permission error on OS that doesn't support chmod
    }
    console.log("✓ AI-SDLC pre-commit hook installed successfully in .git/hooks/pre-commit");
  } catch (error) {
    console.error("❌ Failed to install AI-SDLC pre-commit hook:", error.message);
  }
}

install();
