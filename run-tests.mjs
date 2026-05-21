#!/usr/bin/env node
/**
 * run-tests.mjs
 * Simple test runner script that works on Windows/PowerShell by explicitly
 * listing test files and spawning node --test with the correct flags.
 * This avoids PowerShell glob expansion issues.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testFiles = [
  "packages/shared-contracts/src/__tests__/airtableContracts.test.ts",
  "apps/orchestrator/src/__tests__/redact.test.ts"
];

const absoluteFiles = testFiles.map((f) => path.resolve(__dirname, f));

const result = spawnSync(
  process.execPath,
  ["--no-warnings", "--test", "--experimental-strip-types", ...absoluteFiles],
  {
    stdio: "inherit",
    cwd: __dirname
  }
);

process.exit(result.status ?? 1);
