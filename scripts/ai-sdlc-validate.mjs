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
    {
      command: "node",
      arguments_: ["node_modules/typescript/bin/tsc", "-b"],
      displayCommand: "npm run build"
    },
    {
      command: "node",
      arguments_: ["node_modules/typescript/bin/tsc", "-b", "--pretty", "false"],
      displayCommand: "npm run typecheck"
    },
    {
      command: "node",
      arguments_: ["node_modules/eslint/bin/eslint.js", "."],
      displayCommand: "npm run lint:eslint"
    },
    {
      command: "node",
      arguments_: ["run-tests.mjs"],
      displayCommand: "npm test"
    },
    {
      command: "node",
      arguments_: ["scripts/ai-sdlc-check.mjs", storyId],
      displayCommand: `npm run ai-sdlc:check -- ${storyId}`
    }
  ];
}

export function resolveCommand(commandSpec, environment = process.env, platform = process.platform) {
  if (commandSpec.command === "node") {
    return {
      command: process.execPath,
      arguments_: commandSpec.arguments_
    };
  }

  if (commandSpec.command === "npm" && environment.npm_execpath) {
    return {
      command: process.execPath,
      arguments_: [environment.npm_execpath, ...commandSpec.arguments_]
    };
  }

  if (platform === "win32" && commandSpec.command === "npm") {
    return {
      command: "npm.cmd",
      arguments_: commandSpec.arguments_
    };
  }

  return commandSpec;
}

function runShellCommand(commandSpec, cwd) {
  const resolvedCommand = resolveCommand(commandSpec);
  const result = spawnSync(resolvedCommand.command, resolvedCommand.arguments_, {
    cwd,
    stdio: "inherit"
  });

  if (result.error) {
    console.error(result.error.message);
  }

  return result.status ?? 1;
}

export function runValidation({
  storyId,
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  runCommand = (commandSpec) => runShellCommand(commandSpec, workspaceRoot)
}) {
  for (const commandSpec of buildValidationCommands(storyId)) {
    const displayCommand = commandSpec.displayCommand ?? [commandSpec.command, ...commandSpec.arguments_].join(" ");
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
