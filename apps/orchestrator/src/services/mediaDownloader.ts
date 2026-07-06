import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_ERROR_CODE = "HTTP_STATUS_ERROR";
const DOWNLOAD_FAILED_PREFIX = "Download failed for URL";
const HOSTNAME_LOCALHOST = "localhost";
const IPV4_SEGMENT_COUNT = 4;
const IPV4_MAPPED_IPV6_PREFIX = "::ffff:";

const IPV4_LOOPBACK_FIRST_OCTET = 127;
const IPV4_PRIVATE_CLASS_A_FIRST_OCTET = 10;
const IPV4_PRIVATE_CLASS_B_FIRST_OCTET = 172;
const IPV4_PRIVATE_CLASS_B_SECOND_OCTET_MIN = 16;
const IPV4_PRIVATE_CLASS_B_SECOND_OCTET_MAX = 31;
const IPV4_PRIVATE_CLASS_C_FIRST_OCTET = 192;
const IPV4_PRIVATE_CLASS_C_SECOND_OCTET = 168;
const IPV4_LINK_LOCAL_FIRST_OCTET = 169;
const IPV4_LINK_LOCAL_SECOND_OCTET = 254;
const IPV4_MULTICAST_FIRST_OCTET = 224;
const IPV4_UNSPECIFIED_FIRST_OCTET = 0;

const IPV6_LOOPBACK_ADDRESSES = new Set(["::1", "0:0:0:0:0:0:0:1"]);
const IPV6_LINK_LOCAL_PREFIXES = ["fe80:", "fe90:", "fea0:", "feb0:"];
const IPV6_UNIQUE_LOCAL_PREFIXES = ["fc", "fd"];
const IPV6_UNSPECIFIED_ADDRESSES = new Set(["::", "0:0:0:0:0:0:0:0"]);

export class MediaDownloaderError extends Error {
  constructor(public code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MediaDownloaderError";
  }
}

export type DnsLookupFn = (
  hostname: string,
  options: { all: true }
) => Promise<{ address: string; family?: number }[]>;

export interface DownloaderConfig {
  fetchImpl?: typeof globalThis.fetch;
  dnsLookup?: DnsLookupFn;
}

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm"
]);

const DETERMINISTIC_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

export class MediaDownloader {
  private fetchImpl: typeof globalThis.fetch;
  private dnsLookup: DnsLookupFn;

  constructor(config?: DownloaderConfig) {
    this.fetchImpl = config?.fetchImpl || globalThis.fetch.bind(globalThis);
    this.dnsLookup = config?.dnsLookup || dns.lookup.bind(dns);
  }

  /**
   * Redacts URL queries and credentials, returning origin + pathname + ?[REDACTED]
   */
  public redactUrl(urlStr: string): string {
    try {
      const url = new URL(urlStr);
      if (url.search) {
        return `${url.origin}${url.pathname}?[REDACTED]`;
      }
      return urlStr;
    } catch {
      return "[INVALID_URL]";
    }
  }

  /**
   * Scrubs raw query strings, signatures, and tokens from exception error messages.
   */
  private scrubError(error: unknown, originalUrl: string): Error {
    const redactedUrl = this.redactUrl(originalUrl);
    let originalMsg = error instanceof Error ? error.message : String(error);

    try {
      const url = new URL(originalUrl);
      if (url.search) {
        // Scrub individual query parameter values to be safe
        url.searchParams.forEach((val) => {
          if (val) {
            originalMsg = originalMsg.split(val).join("[REDACTED_VAL]");
          }
        });
      }
    } catch {
      // ignore parsing failure
    }

    originalMsg = originalMsg.replace(/(token|signature|access_token|secret_ref|bearer|key)=[^&\s]+/gi, "[REDACTED_CREDENTIAL]");

    let code = DEFAULT_ERROR_CODE;
    let msg = originalMsg;

    if (error instanceof MediaDownloaderError) {
      code = error.code;
    } else {
      msg = `${DOWNLOAD_FAILED_PREFIX} ${redactedUrl}: ${originalMsg}`;
    }

    return new MediaDownloaderError(code, msg, { cause: error });
  }

  /**
   * Helper to verify if an IP address belongs to loopback, private ranges, link-local,
   * unique local (ULA), unspecified, or IPv4-mapped loopback/private ranges.
   */
  private isPrivateIp(ip: string): boolean {
    if (!net.isIP(ip)) return false;

    if (net.isIPv4(ip)) {
      const parts = ip.split(".").map(Number);
      if (parts.length !== IPV4_SEGMENT_COUNT) return false;

      const [firstOctet, secondOctet] = parts;

      if (firstOctet === IPV4_LOOPBACK_FIRST_OCTET) return true;
      if (firstOctet === IPV4_PRIVATE_CLASS_A_FIRST_OCTET) return true;
      if (
        firstOctet === IPV4_PRIVATE_CLASS_B_FIRST_OCTET &&
        secondOctet >= IPV4_PRIVATE_CLASS_B_SECOND_OCTET_MIN &&
        secondOctet <= IPV4_PRIVATE_CLASS_B_SECOND_OCTET_MAX
      ) return true;
      if (firstOctet === IPV4_PRIVATE_CLASS_C_FIRST_OCTET && secondOctet === IPV4_PRIVATE_CLASS_C_SECOND_OCTET) return true;
      if (firstOctet === IPV4_LINK_LOCAL_FIRST_OCTET && secondOctet === IPV4_LINK_LOCAL_SECOND_OCTET) return true;
      if (firstOctet >= IPV4_MULTICAST_FIRST_OCTET || firstOctet === IPV4_UNSPECIFIED_FIRST_OCTET) return true;
    }

    if (net.isIPv6(ip)) {
      const cleanIp = ip.toLowerCase().trim();

      if (IPV6_LOOPBACK_ADDRESSES.has(cleanIp)) return true;
      if (startsWithAny(cleanIp, IPV6_LINK_LOCAL_PREFIXES)) return true;
      if (startsWithAny(cleanIp, IPV6_UNIQUE_LOCAL_PREFIXES)) return true;
      if (IPV6_UNSPECIFIED_ADDRESSES.has(cleanIp)) return true;

      if (cleanIp.startsWith(IPV4_MAPPED_IPV6_PREFIX)) {
        return true;
      }
    }

    return false;
  }

  /**
   * SSRF Guard validating URL protocol, port, userinfo, and resolved target IPs.
   */
  private async validateSsrfGuard(urlStr: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch (error) {
      throw new MediaDownloaderError("INVALID_URL", `SSRF Guard: Invalid URL: ${(error as Error).message}`);
    }

    if (url.protocol !== "https:") {
      throw new MediaDownloaderError("UNSUPPORTED_PROTOCOL", `SSRF Guard: Protocol ${url.protocol} is unsupported. Only HTTPS is allowed.`);
    }

    const hostname = normalizeHostname(url.hostname);
    if (hostname.toLowerCase() === HOSTNAME_LOCALHOST) {
      throw new MediaDownloaderError("SSRF_BLOCKED", "SSRF Guard: localhost is blocked.");
    }

    if (net.isIP(hostname)) {
      if (this.isPrivateIp(hostname)) {
        throw new MediaDownloaderError("SSRF_BLOCKED", `SSRF Guard: Private IP ${hostname} is blocked.`);
      }
      return;
    }

    // Resolve DNS and verify all returned addresses
    try {
      const records = await this.dnsLookup(hostname, { all: true });
      for (const entry of records) {
        if (this.isPrivateIp(entry.address)) {
          throw new MediaDownloaderError("SSRF_BLOCKED", `SSRF Guard: Domain ${hostname} resolves to blocked IP ${entry.address}.`);
        }
      }
    } catch (error) {
      if (error instanceof MediaDownloaderError) throw error;
      throw new MediaDownloaderError("SSRF_BLOCKED", `SSRF Guard: Failed resolving hostname ${hostname}: ${(error as Error).message}`);
    }
  }

  /**
   * Downloads media stream from a secure HTTPS URL, enforcing SSRF blocks, timeouts, and size limits.
   */
  public async download(
    urlStr: string,
    options?: { maxSizeBytes?: number; timeoutMs?: number }
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    extension: string;
  }> {
    const redactedUrl = this.redactUrl(urlStr);
    const maxSizeBytes = options?.maxSizeBytes || Infinity;
    const timeoutMs = options?.timeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS;

    await this.validateSsrfGuard(urlStr);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      // Fetch with redirect: manual to prevent public endpoint redirection to private IPs
      const response = await this.fetchImpl(urlStr, {
        signal: controller.signal,
        redirect: "manual"
      });

      // 3xx Manual Redirect check
      if (response.status >= 300 && response.status < 400) {
        throw new MediaDownloaderError("SSRF_BLOCKED", `Download failed for URL ${redactedUrl}: redirects are disabled to prevent SSRF.`);
      }

      if (!response.ok) {
        throw new MediaDownloaderError("HTTP_STATUS_ERROR", `Download failed for URL ${redactedUrl}: status code ${response.status}.`);
      }

      // MIME Type Validation
      const mimeType = (response.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        throw new MediaDownloaderError("UNSUPPORTED_MIME_TYPE", `Download failed for URL ${redactedUrl}: MIME type '${mimeType}' is not allowed.`);
      }

      // Layer 1 check: Content-Length validation (if valid, non-negative integer)
      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(contentLength) && contentLength >= 0) {
          if (contentLength === 0) {
            throw new MediaDownloaderError("EMPTY_RESPONSE", `Download failed for URL ${redactedUrl}: Content-Length is 0.`);
          }
          if (contentLength > maxSizeBytes) {
            throw new MediaDownloaderError("RESPONSE_TOO_LARGE", `Download failed for URL ${redactedUrl}: Content-Length ${contentLength} exceeds maximum limit of ${maxSizeBytes} bytes.`);
          }
        }
      }

      if (!response.body) {
        throw new MediaDownloaderError("EMPTY_RESPONSE", `Download failed for URL ${redactedUrl}: Response body is empty.`);
      }

      // Layer 2 check: read body chunk-by-chunk dynamically
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const sha256Hash = crypto.createHash("sha256");

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalBytes += value.length;
          if (totalBytes > maxSizeBytes) {
            await reader.cancel("Max bytes exceeded");
            throw new MediaDownloaderError("RESPONSE_TOO_LARGE", `Download failed for URL ${redactedUrl}: Accumulated bytes exceed maximum limit of ${maxSizeBytes} bytes.`);
          }

          chunks.push(value);
          sha256Hash.update(value);
        }
      } finally {
        if (reader && typeof reader.releaseLock === "function") {
          reader.releaseLock();
        }
      }

      if (totalBytes === 0) {
        throw new MediaDownloaderError("EMPTY_RESPONSE", `Download failed for URL ${redactedUrl}: Read 0 bytes from response body.`);
      }

      const buffer = Buffer.concat(chunks);
      const sha256 = sha256Hash.digest("hex");
      const extension = DETERMINISTIC_EXTENSIONS[mimeType] || "bin";

      return {
        buffer,
        mimeType,
        sizeBytes: totalBytes,
        sha256,
        extension
      };
    } catch (error) {
      if (error instanceof MediaDownloaderError) {
        throw this.scrubError(error, urlStr);
      }

      const cleanName = error instanceof Error ? error.name : "";
      if (cleanName === "AbortError") {
        throw new MediaDownloaderError("DOWNLOAD_TIMEOUT", `Download timed out for URL ${redactedUrl} after ${timeoutMs}ms.`, { cause: error });
      }

      throw this.scrubError(error, urlStr);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
