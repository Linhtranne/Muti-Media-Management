import { describe, it } from "node:test";
import assert from "node:assert";
import {
  StrictExchangeCodeResultSchema,
  ConnectPageResultSchema,
  TokenHealthCheckResultSchema
} from "../../mcp/facebookAuth.js";

describe("facebookAuth schemas", () => {
  describe("StrictExchangeCodeResultSchema", () => {
    it("should accept valid result and strip/error on forbidden fields", () => {
      const valid = {
        pages: [{ pageId: "123", displayName: "Test Page" }],
        userTokenRef: "env:USER_TOKEN_TEMP",
      };
      
      const parsed = StrictExchangeCodeResultSchema.parse(valid);
      assert.deepStrictEqual(parsed, valid);

      // Verify that adding a token fails strict validation
      const withToken = {
        ...valid,
        token: "EAABabc123",
      };
      
      assert.throws(() => StrictExchangeCodeResultSchema.parse(withToken));
    });
  });

  describe("ConnectPageResultSchema", () => {
    it("should accept valid result and reject raw tokens", () => {
      const valid = {
        externalAccountId: "12345",
        displayName: "My Page",
        scopes: ["pages_manage_posts"],
        expiresAt: "2026-08-01T00:00:00Z",
        secretRef: "env:PAGE_TOKEN_123",
      };

      const parsed = ConnectPageResultSchema.parse(valid);
      assert.deepStrictEqual(parsed, valid);

      const withLeak = {
        ...valid,
        access_token: "EAABabc123",
      };

      assert.throws(() => ConnectPageResultSchema.parse(withLeak));
    });
  });

  describe("TokenHealthCheckResultSchema", () => {
    it("should accept valid result", () => {
      const valid = {
        status: "valid" as const,
        lastCheckedAt: "2026-06-02T10:00:00Z",
      };
      
      const parsed = TokenHealthCheckResultSchema.parse(valid);
      assert.deepStrictEqual(parsed, valid);
    });

    it("should accept missing permissions result", () => {
      const valid = {
        status: "missing_permissions" as const,
        missingScopes: ["pages_read_engagement"],
        lastCheckedAt: "2026-06-02T10:00:00Z",
        permissionErrorCode: 10,
      };
      
      const parsed = TokenHealthCheckResultSchema.parse(valid);
      assert.deepStrictEqual(parsed, valid);
    });
  });
});
