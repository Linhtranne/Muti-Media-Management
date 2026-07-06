import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";

const SHA256_PREFIX_LENGTH = 8;

export interface R2Config {
  R2_BUCKET: string;
  R2_ENDPOINT: string;
  R2_PUBLIC_BASE_URL: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

export class R2StorageService {
  private s3: S3Client;
  private config: R2Config;
  private normalizedEndpoint: string;

  constructor(config: R2Config, s3Client?: S3Client) {
    this.config = config;
    this.normalizedEndpoint = this.normalizeEndpoint(config.R2_ENDPOINT, config.R2_BUCKET);

    this.s3 = s3Client || new S3Client({
      region: "auto",
      endpoint: this.normalizedEndpoint,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY_ID,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY
      },
      forcePathStyle: true
    });
  }

  /**
   * Normalizes the R2 endpoint URL by stripping any trailing slash
   * and trailing bucket name suffix.
   */
  private normalizeEndpoint(endpoint: string, bucket: string): string {
    let cleaned = endpoint.trim().replace(/\/$/, "");
    if (cleaned.endsWith(`/${bucket}`)) {
      cleaned = cleaned.substring(0, cleaned.length - bucket.length - 1);
    }
    return cleaned;
  }

  /**
   * Public getter for tests to verify normalized endpoint.
   */
  public getNormalizedEndpoint(): string {
    return this.normalizedEndpoint;
  }

  /**
   * Uploads a file buffer to Cloudflare R2 and returns the generated key and public URL.
   */
  public async uploadBuffer(params: {
    workspaceId: string;
    postId: string;
    data: Buffer;
    mimeType: string;
    extension: string;
    sha256: string;
  }): Promise<{ storageKey: string; publicUrl: string }> {
    const { workspaceId, postId, data, mimeType, extension, sha256 } = params;

    const cleanExt = extension.replace(/^\./, "").toLowerCase();
    const sha256Prefix = sha256.substring(0, SHA256_PREFIX_LENGTH);
    const uuidPart = uuidv4();
    const objectKey = `workspaces/${workspaceId}/posts/${postId}/${uuidPart}-${sha256Prefix}.${cleanExt}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.config.R2_BUCKET,
        Key: objectKey,
        Body: data,
        ContentType: mimeType
      });

      await this.s3.send(command);

      const baseUrl = this.config.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
      const publicUrl = `${baseUrl}/${objectKey}`;

      return {
        storageKey: objectKey,
        publicUrl
      };
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);

      // Scrub credentials from error
      if (this.config.R2_ACCESS_KEY_ID) {
        message = message.split(this.config.R2_ACCESS_KEY_ID).join("[REDACTED_ACCESS_KEY_ID]");
      }
      if (this.config.R2_SECRET_ACCESS_KEY) {
        message = message.split(this.config.R2_SECRET_ACCESS_KEY).join("[REDACTED_SECRET_ACCESS_KEY]");
      }
      
      message = message.replace(/(Credential|Signature|SignedHeaders|Signature=)[a-zA-Z0-9+=/_-]+/gi, "$1[REDACTED]");

      throw new Error(`R2 Upload Failed: ${message}`, { cause: error });
    }
  }
}
