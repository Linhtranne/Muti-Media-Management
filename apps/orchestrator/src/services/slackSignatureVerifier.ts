import crypto from "crypto";
import type { Logger } from "../lib/logger.js";

export type SlackSignatureVerificationResult =
  | { valid: true }
  | { valid: false; errorCode: string; message: string };

export class SlackSignatureVerifier {
  private readonly signingSecret: string;
  private readonly logger: Logger;

  constructor(signingSecret: string | undefined, logger: Logger) {
    this.signingSecret = signingSecret || "";
    this.logger = logger;
  }

  verify(
    rawBody: Buffer,
    signatureHeader: string | undefined | string[],
    timestampHeader: string | undefined | string[]
  ): SlackSignatureVerificationResult {
    if (!this.signingSecret) {
      this.logger.error("SlackSignatureVerifier: SLACK_SIGNING_SECRET is not configured");
      return { valid: false, errorCode: "MISSING_SECRET", message: "Server configuration error" };
    }

    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;

    if (!signature || !timestamp) {
      return { valid: false, errorCode: "MISSING_HEADERS", message: "Missing Slack signature headers" };
    }

    // Protect against replay attacks (reject if older than 5 minutes)
    const timeNow = Math.floor(Date.now() / 1000);
    const timeRequest = parseInt(timestamp, 10);

    if (isNaN(timeRequest)) {
      return { valid: false, errorCode: "INVALID_TIMESTAMP", message: "Invalid timestamp format" };
    }

    if (Math.abs(timeNow - timeRequest) > 300) {
      return { valid: false, errorCode: "STALE_TIMESTAMP", message: "Request timestamp is too old or too far in the future" };
    }

    try {
      const sigBaseString = `v0:${timestamp}:${rawBody.toString("utf8")}`;
      const mySignature = `v0=${crypto
        .createHmac("sha256", this.signingSecret)
        .update(sigBaseString, "utf8")
        .digest("hex")}`;

      const expectedBuffer = Buffer.from(mySignature, "utf8");
      const receivedBuffer = Buffer.from(signature, "utf8");

      if (expectedBuffer.length !== receivedBuffer.length) {
        return { valid: false, errorCode: "SIGNATURE_MISMATCH", message: "Signature mismatch" };
      }

      const isValid = crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

      if (!isValid) {
        return { valid: false, errorCode: "SIGNATURE_MISMATCH", message: "Signature mismatch" };
      }

      return { valid: true };
    } catch (error) {
      this.logger.error("SlackSignatureVerifier: Error during signature verification", {
        error: error instanceof Error ? error.message : String(error)
      });
      return { valid: false, errorCode: "VERIFICATION_ERROR", message: "Internal verification error" };
    }
  }
}
