import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildValidationCommands,
  parseStoryArgument,
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
      { command: "npm", arguments_: ["run", "build"] },
      { command: "npm", arguments_: ["run", "lint"] },
      { command: "npm", arguments_: ["test"] },
      { command: "npm", arguments_: ["run", "ai-sdlc:check", "--", STORY_ID] }
    ]);
  });

  it("fails fast when a validation command fails", () => {
    const executed = [];
    const result = runValidation({
      storyId: STORY_ID,
      runCommand(commandSpec) {
        executed.push(commandSpec);

        if (commandSpec.arguments_.includes("lint")) {
          return 1;
        }

        return 0;
      }
    });

    assert.equal(result, 1);
    assert.deepEqual(
      executed.map((x) => x.arguments_.join(" ")),
      ["run build", "run lint"]
    );
  });
});
