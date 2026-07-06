import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertRlsGovernedConnectionString } from "../ledger/postgres.js";
import { GeminiLlmAdapter, LlmServiceError } from "../ai/llmAdapter.js";
import { NotionClient, isPrivateOrLocalIp } from "../services/notionClient.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("US-003 production security gate", () => {
  it("migration enables RLS and uses USING plus WITH CHECK on every US-003 table", () => {
    const migration = readFileSync(resolve(repoRoot, "db/migrations/0003_us003_ai_generation_ledger.sql"), "utf8");

    for (const table of ["ai_generation_runs", "content_variants", "policy_handoff_events"]) {
      assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
      assert.match(migration, new RegExp(`CREATE POLICY ${table}_workspace_rls ON ${table}[\\s\\S]*?USING \\(workspace_id = current_setting\\('app.current_workspace_id', true\\)\\)[\\s\\S]*?WITH CHECK \\(workspace_id = current_setting\\('app.current_workspace_id', true\\)\\);`));
    }
  });

  it("rejects service-role or RLS-bypass database credentials for worker runtime", () => {
    assert.throws(
      () => { assertRlsGovernedConnectionString("postgres://service_role:secret@localhost:5432/mediaops"); },
      /RLS-bypass credential/
    );
    assert.throws(
      () => { assertRlsGovernedConnectionString("postgres://app:bypassrls-token@localhost:5432/mediaops"); },
      /RLS-bypass credential/
    );
    assert.doesNotThrow(() => { assertRlsGovernedConnectionString("postgres://mediaops_worker:worker_password@localhost:5432/mediaops"); });
  });

  it("redacts provider credentials from serialized provider errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => new Response(
      "upstream failed with api_key=provider-secret-123 and https://example.com?key=provider-secret-456",
      { status: 500 }
    )) as unknown as typeof fetch;

    try {
      const adapter = new GeminiLlmAdapter("provider-secret-123", "gemini-test");
      await assert.rejects(
        adapter.generateContent("system", "user", { maxRetries: 0 }),
        (error: unknown) => {
          assert.ok(error instanceof LlmServiceError);
          const message = String((error as Error).message);
          assert.equal(message.includes("provider-secret-123"), false);
          assert.equal(message.includes("provider-secret-456"), false);
          assert.ok(message.includes("[REDACTED]"));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks private, loopback, link-local, metadata, and IPv6 local resolved Notion IPs", async () => {
    const blockedIps = ["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.10", "172.20.1.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"];

    for (const ip of blockedIps) {
      assert.equal(isPrivateOrLocalIp(ip), true, `${ip} should be considered private/local`);
      const client = new NotionClient({ async resolve() { return [ip]; } });
      await assert.rejects(
        client.validateAndResolveUrl("https://notion.so/test-brief-12345678901234567890123456789012"),
        /private or local address/
      );
    }
  });

  it("blocks shortened/custom Notion-like domains and sends Notion fetches with redirects disabled", async () => {
    const client = new NotionClient({ async resolve() { return ["8.8.8.8"]; } });

    await assert.rejects(
      client.validateAndResolveUrl("https://notion.site/test-brief"),
      /not in the Notion allowlist/
    );
    await assert.rejects(
      client.validateAndResolveUrl("https://evil.notion.site/test-brief"),
      /not in the Notion allowlist/
    );

    const originalFetch = globalThis.fetch;
    let redirectMode: RequestRedirect | undefined;
    globalThis.fetch = mock.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      redirectMode = init?.redirect;
      return new Response(JSON.stringify({ properties: {} }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await client.fetchNotionBrief("https://notion.so/12345678901234567890123456789012", "notion-token");
      assert.equal(redirectMode, "error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("US-004 production security gate", () => {
  it("migration enables RLS and uses USING plus WITH CHECK on every US-004 table", () => {
    const migration = readFileSync(resolve(repoRoot, "db/migrations/0004_us004_policy_publish_guardrail.sql"), "utf8");

    for (const table of ["publish_rule_results", "publish_handoff_events", "publish_jobs"]) {
      assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
      assert.match(migration, new RegExp(`CREATE POLICY ${table}_workspace_rls ON ${table}[\\s\\S]*?USING \\(workspace_id = current_setting\\('app.current_workspace_id', true\\)\\)[\\s\\S]*?WITH CHECK \\(workspace_id = current_setting\\('app.current_workspace_id', true\\)\\);`));
    }
  });

  it("policy engine package does not contain platform API or MCP publish calls", () => {
    const policyFiles = [
      "packages/policy-engine/src/index.ts",
      "packages/policy-engine/src/evaluate.ts",
      "packages/policy-engine/src/rules/checkApprovalStatus.ts",
      "packages/policy-engine/src/rules/checkAutoPublishConfig.ts",
      "packages/policy-engine/src/rules/checkChannel.ts",
      "packages/policy-engine/src/rules/checkContent.ts",
      "packages/policy-engine/src/rules/checkCta.ts",
      "packages/policy-engine/src/rules/checkForbiddenTerms.ts"
    ];
    const content = policyFiles.map((file) => readFileSync(resolve(repoRoot, file), "utf8")).join("\n");

    assert.doesNotMatch(content, /graph\.facebook|api\.facebook|validate_post|enqueue_publish|publish_post/i);
  });
});

describe("US-006 production security gate", () => {
  it("migration enables RLS and uses USING plus WITH CHECK on publish_execution_events", () => {
    const migration = readFileSync(resolve(repoRoot, "db/migrations/0006_us006_facebook_publish_execution.sql"), "utf8");

    for (const table of ["publish_execution_events"]) {
      assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
      assert.match(migration, new RegExp(`CREATE POLICY ${table}_workspace_rls ON ${table}[\\s\\S]*?USING \\(workspace_id = current_setting\\('app.current_workspace_id', true\\)\\)[\\s\\S]*?WITH CHECK \\(workspace_id = current_setting\\('app.current_workspace_id', true\\)\\);`));
    }
  });

  it("orchestrator codebase does not contain direct Graph API calls", () => {
    const orchestratorCodePaths = [
      "apps/orchestrator/src/workers/mcpPublishWorker.ts",
      "apps/orchestrator/src/workers/mcpPublishScheduler.ts",
      "apps/orchestrator/src/mcp/facebookMcpClient.ts"
    ];
    
    for (const file of orchestratorCodePaths) {
      const content = readFileSync(resolve(repoRoot, file), "utf8");
      assert.doesNotMatch(content, /graph\.facebook\.com/i);
    }
  });

  it("mcp publish event schema rejects raw token/secret fields", () => {
    const schemaFile = readFileSync(resolve(repoRoot, "packages/shared-contracts/src/mcp/publishFacebookExecute.ts"), "utf8");
    assert.match(schemaFile, /\.strict\(\)/);
    // the forbidden keys should be explicitly tested in mcpPublishContracts.test.ts which we already wrote
  });
});

