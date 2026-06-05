import { describe, it } from "node:test";
import assert from "node:assert";
import { DirectMessageIngestWorker } from "../directMessageIngestWorker.js";

describe("DirectMessageIngestWorker", () => {
  it("should be instantiable", () => {
    const worker = new DirectMessageIngestWorker(
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
