import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { R2StorageService } from "../services/r2Storage.js";
import { EnvSchema } from "../config/env.js";

// Dummy S3 client helper
function createMockS3(sendFn: (command: any) => Promise<any>): S3Client {
  return {
    send: mock.fn(sendFn)
  } as unknown as S3Client;
}

const mockConfig = {
  R2_BUCKET: "my-test-bucket",
  R2_PUBLIC_BASE_URL: "https://pub.example.com",
  R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key"
};

describe("R2StorageService", () => {
  describe("Endpoint Normalizer", () => {
    it("handles plain R2 endpoint format", () => {
      const service = new R2StorageService(mockConfig);
      assert.equal(service.getNormalizedEndpoint(), "https://account.r2.cloudflarestorage.com");
    });

    it("handles R2 endpoint with bucket suffix and trailing slash", () => {
      const configWithSuffix = {
        ...mockConfig,
        R2_ENDPOINT: "https://account.r2.cloudflarestorage.com/my-test-bucket/"
      };
      const service = new R2StorageService(configWithSuffix);
      assert.equal(service.getNormalizedEndpoint(), "https://account.r2.cloudflarestorage.com");
    });
  });

  describe("uploadBuffer", () => {
    it("uploads buffer using PutObjectCommand and returns correct public URL and storage key", async () => {
      let putCommandInput: any = null;
      const mockS3 = createMockS3(async (command) => {
        if (command instanceof PutObjectCommand) {
          putCommandInput = command.input;
        }
        return {};
      });

      const service = new R2StorageService(mockConfig, mockS3);
      const data = Buffer.from("hello world");

      const result = await service.uploadBuffer({
        workspaceId: "ws123",
        postId: "post456",
        data,
        mimeType: "image/jpeg",
        extension: "jpg",
        sha256: "d5a3d49f6b9c99187a716cda24e4d6d67b25fbefd5c0e1db50f0c0f688eef123"
      });

      // Verify PutObjectCommand was called
      assert.ok(putCommandInput, "PutObjectCommand should be sent");
      assert.equal(putCommandInput.Bucket, "my-test-bucket");
      assert.equal(putCommandInput.ContentType, "image/jpeg");
      assert.deepEqual(putCommandInput.Body, data);

      // Verify generated key structure does NOT leak original filename
      const key = result.storageKey;
      assert.ok(!key.includes("my-cat-photo"), "Storage key should not leak original filename");
      assert.ok(key.startsWith("workspaces/ws123/posts/post456/"), "Key should start with correct prefix");
      assert.ok(key.endsWith(".jpg"), "Key should preserve correct extension");
      assert.ok(key.includes("d5a3d49f"), "Key should include sha256 prefix");

      // Verify publicUrl mappings
      assert.equal(result.publicUrl, `https://pub.example.com/${key}`);
    });

    it("sanitizes access key and secret key from thrown errors", async () => {
      const mockS3 = createMockS3(async () => {
        throw new Error(
          `Failed to authenticate. AccessKeyId: ${mockConfig.R2_ACCESS_KEY_ID}, SecretAccessKey: ${mockConfig.R2_SECRET_ACCESS_KEY}`
        );
      });

      const service = new R2StorageService(mockConfig, mockS3);

      await assert.rejects(
        async () => {
          await service.uploadBuffer({
            workspaceId: "ws",
            postId: "post",
            data: Buffer.from("test"),
            mimeType: "image/png",
            extension: "png",
            sha256: "hash"
          });
        },
        (err: Error) => {
          assert.ok(!err.message.includes(mockConfig.R2_ACCESS_KEY_ID), "Should redact R2_ACCESS_KEY_ID");
          assert.ok(!err.message.includes(mockConfig.R2_SECRET_ACCESS_KEY), "Should redact R2_SECRET_ACCESS_KEY");
          assert.ok(err.message.includes("[REDACTED_ACCESS_KEY_ID]"), "Should place REDACTED label");
          return true;
        }
      );
    });
  });

  describe("Environment Configuration Schema", () => {
    const baseValidEnv = {
      NODE_ENV: "development",
      PORT: "3000",
      WORKSPACE_ID: "ws_staging",
      DATABASE_URL: "postgresql://localhost",
      RABBITMQ_URL: "amqp://localhost",
      AIRTABLE_API_KEY: "pat123",
      AIRTABLE_BASE_ID: "app123",
      SLACK_SIGNING_SECRET: "test-secret"
    };

    it("does not require R2 properties when MEDIA_PIPELINE_ENABLED is false", () => {
      const parsed = EnvSchema.safeParse({
        ...baseValidEnv,
        MEDIA_PIPELINE_ENABLED: "false"
      });
      assert.equal(parsed.success, true, `Expected base env to pass when MEDIA_PIPELINE_ENABLED is false. Errors: ${JSON.stringify(parsed.success ? "" : parsed.error.format())}`);
    });

    it("requires R2 credentials and bucket when MEDIA_PIPELINE_ENABLED is true", () => {
      const parsed = EnvSchema.safeParse({
        ...baseValidEnv,
        MEDIA_PIPELINE_ENABLED: "true"
      });
      assert.equal(parsed.success, false, "Expected base env to fail when MEDIA_PIPELINE_ENABLED is true without R2 properties");
    });

    it("accepts base env when MEDIA_PIPELINE_ENABLED is true and R2 credentials are valid", () => {
      const parsed = EnvSchema.safeParse({
        ...baseValidEnv,
        MEDIA_PIPELINE_ENABLED: "true",
        R2_BUCKET: "my-bucket",
        R2_ENDPOINT: "https://myaccount.r2.cloudflarestorage.com",
        R2_PUBLIC_BASE_URL: "https://pub.example.com",
        R2_ACCESS_KEY_ID: "my-access-key",
        R2_SECRET_ACCESS_KEY: "my-secret-key"
      });
      assert.equal(parsed.success, true, `Expected parse to succeed with valid R2 credentials. Errors: ${JSON.stringify(parsed.success ? "" : parsed.error.format())}`);
    });

    it("rejects invalid URL for R2_ENDPOINT or R2_PUBLIC_BASE_URL when MEDIA_PIPELINE_ENABLED is true", () => {
      const parsed = EnvSchema.safeParse({
        ...baseValidEnv,
        MEDIA_PIPELINE_ENABLED: "true",
        R2_BUCKET: "my-bucket",
        R2_ENDPOINT: "not-a-url",
        R2_PUBLIC_BASE_URL: "https://pub.example.com",
        R2_ACCESS_KEY_ID: "my-access-key",
        R2_SECRET_ACCESS_KEY: "my-secret-key"
      });
      assert.equal(parsed.success, false, "Expected invalid R2_ENDPOINT URL to fail");
    });
  });
});
