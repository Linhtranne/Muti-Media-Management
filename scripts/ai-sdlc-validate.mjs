#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE_TEXT = "Usage: npm run ai-sdlc:validate -- <STORY-ID>";
const DEFAULT_WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseStoryArgument(arguments_) {
  const storyId = arguments_[0];

  if (!storyId) {
    throw new Error(USAGE_TEXT);
  }

  return storyId;
}

export function buildValidationCommands(storyId) {
  return [
    { command: "npm", arguments_: ["run", "build"] },
    { command: "npm", arguments_: ["run", "lint"] },
    { command: "npm", arguments_: ["test"] },
    { command: "npm", arguments_: ["run", "ai-sdlc:check", "--", storyId] }
  ];
}

function runShellCommand(commandSpec, cwd) {
  const result = spawnSync(commandSpec.command, commandSpec.arguments_, {
    cwd,
    stdio: "inherit",
    shell: true
  });

  return result.status ?? 1;
}

export function runValidation({
  storyId,
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  runCommand = (commandSpec) => runShellCommand(commandSpec, workspaceRoot)
}) {
  for (const commandSpec of buildValidationCommands(storyId)) {
    const displayCommand = [commandSpec.command, ...commandSpec.arguments_].join(" ");
    console.log(`AI-SDLC validate: ${displayCommand}`);

    const exitCode = runCommand(commandSpec);

    if (exitCode !== 0) {
      console.error(`AI-SDLC validate failed at: ${displayCommand}`);
      return exitCode;
    }
  }

  console.log(`AI-SDLC validate passed for ${storyId}.`);
  return 0;
}

async function runCli() {
  try {
    const storyId = parseStoryArgument(process.argv.slice(2));
    return runValidation({ storyId });
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
