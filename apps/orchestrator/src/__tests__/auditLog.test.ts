import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeAuditMetadata } from "../lib/auditRedactor.js";
import { AuditLogRepository } from "../ledger/auditLogRepository.js";

type NestedAuditMetadata = {
  request: {
    headers: {
      authorization: string;
      "x-api-key": string;
    };
    payload: Array<{
      data: string;
      secretRef: string;
    }>;
  };
  metadata_redacted: boolean;
  redacted_keys: string[];
};

type FlatAuditMetadata = {
  user_id: string;
  token: string;
  role: string;
  metadata_redacted: boolean;
  redacted_keys: string[];
};

type StringMarkerAuditMetadata = {
  message: string;
  jwt: string;
  safe: string;
};

type DeepAuditMetadata = {
  deep: {
    nested: {
      password: string;
    };
  };
  redacted_keys: string[];
};

describe("Audit Redactor", () => {
  it("should redact flat forbidden fields", () => {
    const input = {
      user_id: "u123",
      token: "secret_token_123",
      role: "admin"
    };

    const result = sanitizeAuditMetadata(input) as FlatAuditMetadata;

    assert.equal(result.user_id, "u123");
    assert.equal(result.token, "[REDACTED]");
    assert.equal(result.role, "admin");
    assert.equal(result.metadata_redacted, true);
    assert.deepEqual(result.redacted_keys, ["token"]);
  });

  it("should redact nested object/array forbidden fields", () => {
    const input = {
      request: {
        headers: {
          authorization: "Bearer ABC",
          "x-api-key": "some-key"
        },
        payload: [
          { data: "ok", secretRef: "vault:v1:abc" }
        ]
      }
    };

    const result = sanitizeAuditMetadata(input) as NestedAuditMetadata;

    assert.equal(result.request.headers.authorization, "[REDACTED]");
    assert.equal(result.request.headers["x-api-key"], "[REDACTED]");
    assert.equal(result.request.payload[0].data, "ok");
    assert.equal(result.request.payload[0].secretRef, "[REDACTED]");
    assert.equal(result.metadata_redacted, true);
    assert.ok(result.redacted_keys.includes("authorization"));
    assert.ok(result.redacted_keys.includes("x-api-key"));
    assert.ok(result.redacted_keys.includes("secretRef"));
  });

  it("should redact string values containing Bearer or JWT", () => {
    const input = {
      message: "Here is your Bearer xyz123 token",
      jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZS.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      safe: "bearer is an animal?"
    };

    const result = sanitizeAuditMetadata(input) as StringMarkerAuditMetadata;
    assert.equal(result.message, "[REDACTED_TOKEN_MARKER]");
    assert.equal(result.jwt, "[REDACTED_TOKEN_MARKER]");
    assert.equal(result.safe, "[REDACTED_TOKEN_MARKER]"); // "bearer " is present so it's redacted
  });

  it("redacted_keys contains bare keys only, not paths", () => {
    const input = {
      deep: {
        nested: {
          password: "my_password"
        }
      }
    };
    const result = sanitizeAuditMetadata(input) as DeepAuditMetadata;
    assert.equal(result.deep.nested.password, "[REDACTED]");
    assert.deepEqual(result.redacted_keys, ["password"]);
  });
});

describe("AuditLogRepository", () => {
  it("should write sanitized metadata", async () => {
    const repo = new AuditLogRepository();
    const mockClient = {
      query: async (text: string, values: any[]) => {
        // Find the metadata parameter (it's the 11th, so index 10)
        const metadataIndex = (/\$11/.exec(text))?.[0] ? 10 : -1;
        if (metadataIndex !== -1) {
          const metadata = values[metadataIndex];
          assert.equal(metadata.secret, "[REDACTED]");
          assert.equal(metadata.metadata_redacted, true);
          assert.deepEqual(metadata.redacted_keys, ["secret"]);
        }
      }
    };

    await repo.insertAuditLog(mockClient as any, {
      workspaceId: "ws-1",
      eventType: "test_event",
      entityType: "test_entity",
      entityId: "e-1",
      metadata: { safe: "yes", secret: "super_secret" }
    });
  });

  it("should generate SQL using event_type instead of action", async () => {
    const repo = new AuditLogRepository();
    let executedSql = "";
    const mockClient = {
      query: async (text: string, values: any[]) => {
        executedSql = text;
      }
    };

    await repo.insertAuditLog(mockClient as any, {
      workspaceId: "ws-1",
      eventType: "test_event",
      entityType: "test_entity",
      entityId: "e-1",
      metadata: {}
    });

    assert.ok(executedSql.includes("event_type"), "SQL should use event_type column");
    assert.ok(!(/\baction\b/.exec(executedSql)), "SQL should not use action column");
  });
});
