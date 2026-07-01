import { describe, it } from "node:test";
import assert from "node:assert";
import { createDirectMessageReplyRabbitmqConsumer } from "../directMessageReplyRabbitmqConsumer.js";

describe("DirectMessageReplyRabbitmqConsumer", () => {
  it("should be creatable", async () => {
    const consumer = await createDirectMessageReplyRabbitmqConsumer(
      "amqp://localhost",
      {} as any,
      {} as any,
      "ws-1"
    );
    assert.ok(consumer);
    assert.strictEqual(typeof consumer.start, "function");
    assert.strictEqual(typeof consumer.stop, "function");
  });
});
