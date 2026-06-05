import { describe, it } from "node:test";
import assert from "node:assert";
import { createDirectMessageIngestRabbitmqConsumer } from "../directMessageIngestRabbitmqConsumer.js";

describe("DirectMessageIngestRabbitmqConsumer", () => {
  it("should be creatable", async () => {
    const consumer = await createDirectMessageIngestRabbitmqConsumer(
      "amqp://localhost",
      {} as any,
      {} as any,
      "ws-1"
    );
    assert.ok(consumer);
    assert.ok(consumer.start);
    assert.ok(consumer.stop);
  });
});
