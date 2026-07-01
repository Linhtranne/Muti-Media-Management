import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrePushPlan } from "../pre-push-gate.mjs";

describe("Pre-push Gate Planner", () => {
  it("fails closed when no story ID is detected", () => {
    const plan = buildPrePushPlan([]);

    assert.equal(plan.ok, false);
    assert.equal(plan.reason, "No active STORY-ID detected from staged files or branch.");
    assert.deepEqual(plan.storyIds, []);
  });

  it("builds a validation plan for detected stories", () => {
    const plan = buildPrePushPlan(["US-008", "US-009"]);

    assert.equal(plan.ok, true);
    assert.equal(plan.reason, null);
    assert.deepEqual(plan.storyIds, ["US-008", "US-009"]);
  });
});
