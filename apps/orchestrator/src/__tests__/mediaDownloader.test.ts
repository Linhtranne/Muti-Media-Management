import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { MediaDownloader, MediaDownloaderError } from "../services/mediaDownloader.js";

// Helper mocks
function mockDnsLookup(addresses: { address: string }[]) {
  return mock.fn(async () => addresses);
}

function mockFetchResponse(status: number, headers: Record<string, string>, bodyChunks: Uint8Array[]) {
  let chunkIndex = 0;
  const mockReader = {
    read: mock.fn(async () => {
      if (chunkIndex >= bodyChunks.length) {
        return { done: true, value: undefined };
      }
      const value = bodyChunks[chunkIndex++];
      return { done: false, value };
    }),
    cancel: mock.fn(async () => {})
  };

  const mockResponse = {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || null
    },
    body: {
      getReader: () => mockReader
    }
  };

  return mock.fn(async () => mockResponse as any);
}

describe("MediaDownloader & SSRF Guard", () => {
  describe("SSRF Guard & Protocol Checks", () => {
    it("rejects http: protocol with UNSUPPORTED_PROTOCOL", async () => {
      const downloader = new MediaDownloader();
      await assert.rejects(
        downloader.download("http://example.com/image.jpg"),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "UNSUPPORTED_PROTOCOL");
          return true;
        }
      );
    });

    it("rejects localhost with SSRF_BLOCKED", async () => {
      const downloader = new MediaDownloader();
      await assert.rejects(
        downloader.download("https://localhost/image.jpg"),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "SSRF_BLOCKED");
          return true;
        }
      );
    });

    it("rejects private IPv4 addresses with SSRF_BLOCKED", async () => {
      const downloader = new MediaDownloader();
      const privateIps = ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.0.1", "0.0.0.0"];
      for (const ip of privateIps) {
        await assert.rejects(
          downloader.download(`https://${ip}/image.jpg`),
          (err: Error) => {
            assert.ok(err instanceof MediaDownloaderError);
            assert.equal((err as MediaDownloaderError).code, "SSRF_BLOCKED");
            return true;
          }
        );
      }
    });

    it("rejects private IPv6 and mapped IPv6 addresses with SSRF_BLOCKED", async () => {
      const downloader = new MediaDownloader();
      const privateIps = ["::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"];
      for (const ip of privateIps) {
        await assert.rejects(
          downloader.download(`https://[${ip}]/image.jpg`),
          (err: Error) => {
            assert.ok(err instanceof MediaDownloaderError);
            assert.equal((err as MediaDownloaderError).code, "SSRF_BLOCKED");
            return true;
          }
        );
      }
    });

    it("rejects domains that resolve to at least one private IP", async () => {
      const dnsMock = mockDnsLookup([
        { address: "1.1.1.1" },
        { address: "192.168.1.50" }
      ]);
      const downloader = new MediaDownloader({ dnsLookup: dnsMock });

      await assert.rejects(
        downloader.download("https://my-multi-ip-domain.com/image.jpg"),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "SSRF_BLOCKED");
          return true;
        }
      );
    });
  });

  describe("Download Constraints", () => {
    const baseConfig = {
      dnsLookup: mockDnsLookup([{ address: "1.1.1.1" }])
    };

    it("rejects non-allowlisted MIME types with UNSUPPORTED_MIME_TYPE", async () => {
      const fetchMock = mockFetchResponse(200, { "content-type": "text/html" }, []);
      const downloader = new MediaDownloader({ ...baseConfig, fetchImpl: fetchMock });

      await assert.rejects(
        downloader.download("https://example.com/page.html"),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "UNSUPPORTED_MIME_TYPE");
          return true;
        }
      );
    });

    it("rejects redirects manually with SSRF_BLOCKED", async () => {
      // Manual redirect returns a 302 response structure with manual config
      const mockResponse = {
        status: 302,
        ok: false,
        headers: {
          get: () => null
        }
      };
      const fetchMock = mock.fn(async () => mockResponse as any);
      const downloader = new MediaDownloader({ ...baseConfig, fetchImpl: fetchMock });

      await assert.rejects(
        downloader.download("https://example.com/redirect"),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "SSRF_BLOCKED");
          return true;
        }
      );
    });

    it("Layer 1 check: rejects large Content-Length with RESPONSE_TOO_LARGE", async () => {
      const fetchMock = mockFetchResponse(
        200,
        { "content-type": "image/png", "content-length": "1000" },
        []
      );
      const downloader = new MediaDownloader({ ...baseConfig, fetchImpl: fetchMock });

      await assert.rejects(
        downloader.download("https://example.com/large.png", { maxSizeBytes: 500 }),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "RESPONSE_TOO_LARGE");
          return true;
        }
      );
    });

    it("Layer 2 check: rejects stream exceeding maxSizeBytes dynamically with RESPONSE_TOO_LARGE", async () => {
      const chunk1 = Buffer.alloc(300, "a");
      const chunk2 = Buffer.alloc(300, "b");
      const fetchMock = mockFetchResponse(
        200,
        { "content-type": "image/png" }, // No Content-Length
        [chunk1, chunk2]
      );
      const downloader = new MediaDownloader({ ...baseConfig, fetchImpl: fetchMock });

      await assert.rejects(
        downloader.download("https://example.com/stream.png", { maxSizeBytes: 500 }),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "RESPONSE_TOO_LARGE");
          return true;
        }
      );
    });

    it("rejects empty response with EMPTY_RESPONSE", async () => {
      const fetchMock = mockFetchResponse(
        200,
        { "content-type": "image/png", "content-length": "0" },
        []
      );
      const downloader = new MediaDownloader({ ...baseConfig, fetchImpl: fetchMock });

      await assert.rejects(
        downloader.download("https://example.com/empty.png"),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "EMPTY_RESPONSE");
          return true;
        }
      );
    });

    it("rejects HTTP errors with HTTP_STATUS_ERROR", async () => {
      const fetchMock = mockFetchResponse(500, { "content-type": "image/png" }, []);
      const downloader = new MediaDownloader({ ...baseConfig, fetchImpl: fetchMock });

      await assert.rejects(
        downloader.download("https://example.com/fail.png"),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "HTTP_STATUS_ERROR");
          return true;
        }
      );
    });

    it("aborts downloads that exceed timeoutMs with DOWNLOAD_TIMEOUT", async () => {
      const fetchMock = mock.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      });
      const downloader = new MediaDownloader({ ...baseConfig, fetchImpl: fetchMock as typeof fetch });

      await assert.rejects(
        downloader.download("https://example.com/slow.png", { timeoutMs: 1 }),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          assert.equal((err as MediaDownloaderError).code, "DOWNLOAD_TIMEOUT");
          return true;
        }
      );
    });
  });

  describe("Redactions & Logging Integrity", () => {
    const baseConfig = {
      dnsLookup: mockDnsLookup([{ address: "1.1.1.1" }])
    };

    it("redacts raw query values, tokens, and signatures from thrown errors", async () => {
      const fetchMock = mock.fn(async () => {
        throw new Error("Failed connecting to host with signature=abcdef123&token=myTokenValue");
      });
      const downloader = new MediaDownloader({ ...baseConfig, fetchImpl: fetchMock });

      const signedUrl = "https://example.com/asset.png?token=myTokenValue&signature=abcdef123";

      await assert.rejects(
        downloader.download(signedUrl),
        (err: Error) => {
          assert.ok(err instanceof MediaDownloaderError);
          
          // Verify redacted representation is mapped
          assert.ok(err.message.includes("?[REDACTED]"), "Should display REDACTED placeholder");
          
          // Assert no sensitive query credentials leak
          assert.ok(!err.message.includes("token="), "Should not contain 'token='");
          assert.ok(!err.message.includes("signature="), "Should not contain 'signature='");
          assert.ok(!err.message.includes("myTokenValue"), "Should not leak raw token value");
          assert.ok(!err.message.includes("abcdef123"), "Should not leak raw signature value");
          
          return true;
        }
      );
    });
  });

  describe("Success Path", () => {
    const baseConfig = {
      dnsLookup: mockDnsLookup([{ address: "1.1.1.1" }])
    };

    it("downloads successfully and extracts clean metadata and extension", async () => {
      const fileData = Buffer.from("fake png file data");
      const fetchMock = mockFetchResponse(
        200,
        { "content-type": "image/png", "content-length": String(fileData.length) },
        [new Uint8Array(fileData)]
      );
      const downloader = new MediaDownloader({ ...baseConfig, fetchImpl: fetchMock });

      const result = await downloader.download("https://example.com/asset.png");

      assert.deepEqual(result.buffer, fileData);
      assert.equal(result.mimeType, "image/png");
      assert.equal(result.sizeBytes, fileData.length);
      assert.equal(result.extension, "png");
      assert.ok(result.sha256, "Should return sha256 checksum");
    });
  });
});
