import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotionClient, NotionSsrfError } from "../services/notionClient.js";

describe("NotionClient SSRF Guardrails", () => {
  const client = new NotionClient();

  it("blocks non-HTTPS protocols", async () => {
    await assert.rejects(
      client.validateAndResolveUrl("http://notion.so/my-page"),
      /Only HTTPS protocol is allowed/
    );
  });

  it("blocks hosts not in the allowlist", async () => {
    await assert.rejects(
      client.validateAndResolveUrl("https://evil-notion.site/my-page"),
      /not in the Notion allowlist/
    );
  });

  it("blocks URLs with user information", async () => {
    await assert.rejects(
      client.validateAndResolveUrl("https://user:pass@notion.so/my-page"),
      /User information in URL is forbidden/
    );
  });

  it("blocks non-standard ports", async () => {
    await assert.rejects(
      client.validateAndResolveUrl("https://notion.so:8443/my-page"),
      /Non-standard ports are forbidden/
    );
  });

  it("resolves and loads mock brief correctly", async () => {
    const brief = await client.fetchNotionBrief("https://notion.so/test-brief-12345678901234567890123456789012");
    assert.equal(brief.brand_voice, "Professional, engaging, modern");
    assert.deepEqual(brief.do_terms, ["innovation", "easy", "secure"]);
    assert.deepEqual(brief.avoid_terms, ["cheap", "guaranteed", "hack"]);
  });
});
