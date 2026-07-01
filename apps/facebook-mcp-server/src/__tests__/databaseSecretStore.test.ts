import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { DatabaseSecretStore } from "../lib/databaseSecretStore.js";
import crypto from "node:crypto";
import pg from "pg";

describe("DatabaseSecretStore", () => {
  let store: DatabaseSecretStore;
  let mockClient: any;
  let connectMock: any;
  const encryptionKey = crypto.randomBytes(32).toString("base64");

  before(() => {
    process.env.SECRET_ENCRYPTION_KEY = encryptionKey;
    process.env.DATABASE_URL = "postgres://fake";

    mockClient = {
      query: async (query: string, params: any[]) => {
        if (query.includes("INSERT INTO secret_references")) {
          return { rows: [{ id: "mock-uuid-1234" }] };
        }
        if (query.includes("SELECT ciphertext")) {
          if (params[0] === "not-found") return { rows: [] };
          if (params[0] === "revoked") return { rows: [{ status: "revoked", ciphertext: "fake" }] };
          
          // Generate valid ciphertext for 'active'
          const iv = crypto.randomBytes(12);
          const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(encryptionKey, 'base64'), iv);
          let encrypted = cipher.update("decrypted-secret", 'utf8', 'base64');
          encrypted += cipher.final('base64');
          const authTag = cipher.getAuthTag().toString('base64');
          const ciphertext = `${iv.toString('base64')}:${authTag}:${encrypted}`;
          
          return { rows: [{ status: "active", ciphertext }] };
        }
        return { rows: [] };
      },
      release: () => {}
    };

    connectMock = async () => mockClient;
    pg.Pool.prototype.connect = connectMock;

    store = new DatabaseSecretStore();
  });

  after(async () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;
    await store.close();
  });

  it("should throw error if SECRET_ENCRYPTION_KEY is missing", () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    assert.throws(() => new DatabaseSecretStore(), /SECRET_ENCRYPTION_KEY environment variable is missing/);
    process.env.SECRET_ENCRYPTION_KEY = encryptionKey;
  });

  it("should securely encrypt and store a secret", async () => {
    const ref = await store.storeSecret("ws-1", "SUFFIX", "my-secret-val");
    assert.strictEqual(ref, "dbsecret:ws-1:mock-uuid-1234");
  });

  it("should correctly resolve an active secret", async () => {
    const val = await store.resolveSecret("dbsecret:ws-1:active-uuid");
    assert.strictEqual(val, "decrypted-secret");
  });

  it("should reject resolving a non-existent secret", async () => {
    await assert.rejects(
      async () => await store.resolveSecret("dbsecret:ws-1:not-found"),
      (err: Error) => err.message.includes("SECRET_NOT_FOUND")
    );
  });

  it("should reject resolving a revoked secret", async () => {
    await assert.rejects(
      async () => await store.resolveSecret("dbsecret:ws-1:revoked"),
      (err: Error) => err.message.includes("SECRET_REVOKED")
    );
  });

  it("should reject non-dbsecret formats", async () => {
    await assert.rejects(
      async () => await store.resolveSecret("env:var"),
      (err: Error) => err.message.includes("SECRET_REF_INVALID")
    );
  });
});
