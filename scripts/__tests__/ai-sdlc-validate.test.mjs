import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildValidationCommands,
  parseStoryArgument,
  resolveCommand,
  runValidation
} from "../ai-sdlc-validate.mjs";

const STORY_ID = "AI-SDLC-001";

describe("AI-SDLC validate gate", () => {
  it("requires a story argument with validate-specific usage", () => {
    assert.throws(
      () => parseStoryArgument([]),
      /Usage: npm run ai-sdlc:validate -- <STORY-ID>/
    );
  });

  it("builds the official validation command sequence", () => {
    assert.deepEqual(buildValidationCommands(STORY_ID), [
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
        arguments_: ["scripts/ai-sdlc-check.mjs", STORY_ID],
        displayCommand: `npm run ai-sdlc:check -- ${STORY_ID}`
      }
    ]);
  });

  it("fails fast when a validation command fails", () => {
    const executed = [];
    const originalLog = console.log;
    const originalError = console.error;

    console.log = () => {};
    console.error = () => {};

    try {
      const result = runValidation({
        storyId: STORY_ID,
        runCommand(commandSpec) {
          executed.push(commandSpec);

          if (commandSpec.displayCommand === "npm run lint:eslint") {
            return 1;
          }

          return 0;
        }
      });

      assert.equal(result, 1);
      assert.deepEqual(
        executed.map((x) => x.displayCommand),
        ["npm run build", "npm run typecheck", "npm run lint:eslint"]
      );
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  it("uses the current Node runtime for node command specs", () => {
    const commandSpec = { command: "node", arguments_: ["scripts/ai-sdlc-check.mjs", STORY_ID] };
    const resolved = resolveCommand(commandSpec, {}, "win32");

    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.arguments_, ["scripts/ai-sdlc-check.mjs", STORY_ID]);
  });

  it("uses npm_execpath when available instead of requiring a shell", () => {
    const commandSpec = { command: "npm", arguments_: ["run", "build"] };
    const resolved = resolveCommand(commandSpec, { npm_execpath: "C:\\npm\\npm-cli.js" }, "win32");

    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.arguments_, ["C:\\npm\\npm-cli.js", "run", "build"]);
  });

  it("falls back to npm.cmd on Windows when npm_execpath is unavailable", () => {
    assert.deepEqual(
      resolveCommand({ command: "npm", arguments_: ["test"] }, {}, "win32"),
      { command: "npm.cmd", arguments_: ["test"] }
    );
    assert.deepEqual(
      resolveCommand({ command: "npm", arguments_: ["test"] }, {}, "linux"),
      { command: "npm", arguments_: ["test"] }
    );
  });
});
