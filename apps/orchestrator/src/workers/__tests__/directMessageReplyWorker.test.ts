import { describe, it } from "node:test";
import assert from "node:assert";
import { DirectMessageReplyWorker } from "../directMessageReplyWorker.js";

describe("DirectMessageReplyWorker", () => {
  it("should be instantiable", () => {
    const worker = new DirectMessageReplyWorker(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      "ws-1"
    );
    assert.ok(worker);
  });
});
