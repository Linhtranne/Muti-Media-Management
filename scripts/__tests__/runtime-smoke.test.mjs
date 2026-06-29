import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectRequiredServices } from "../runtime-smoke.mjs";

describe("Runtime Smoke Checker Parser", () => {
  it("should detect postgres service when ledger/database keywords exist", () => {
    const spec = "We need to save posts in the Postgres Ledger.";
    const plan = "Verify database connection.";
    const services = detectRequiredServices(spec, plan);
    assert.ok(services.includes("postgres"));
  });

  it("should detect rabbitmq when queue keywords exist", () => {
    const spec = "Publish events to RabbitMQ.";
    const plan = "Verify queue broker.";
    const services = detectRequiredServices(spec, plan);
    assert.ok(services.includes("rabbitmq"));
  });

  it("should detect notion and slack when mentioned", () => {
    const spec = "Connect with Notion Briefs and alert on Slack.";
    const plan = "";
    const services = detectRequiredServices(spec, plan);
    assert.ok(services.includes("notion"));
    assert.ok(services.includes("slack"));
  });

  it("should detect facebook MCP service when meta or facebook is mentioned", () => {
    const spec = "Call Facebook Page Graph API via MCP.";
    const plan = "";
    const services = detectRequiredServices(spec, plan);
    assert.ok(services.includes("facebook"));
  });

  it("should return empty array if no external services are referenced", () => {
    const spec = "This is a local documentation change story.";
    const plan = "Doc only.";
    const services = detectRequiredServices(spec, plan);
    assert.deepEqual(services, []);
  });
});
