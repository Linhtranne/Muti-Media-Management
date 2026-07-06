import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { ImageOptimizer, VideoOptimizer, MediaOptimizerError } from "../services/mediaOptimizer.js";

// Helper Base64 1x1 PNG
const TINY_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

function createMockChildProcess(exitCode: number, stdoutData = "", stderrData = "", delayMs = 0) {
  const child = new EventEmitter() as any;
  child.stdout = new Readable({
    read() {
      if (stdoutData) this.push(Buffer.from(stdoutData));
      this.push(null);
    }
  });
  child.stderr = new Readable({
    read() {
      if (stderrData) this.push(Buffer.from(stderrData));
      this.push(null);
    }
  });
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      callback();
    }
  });
  child.kill = mock.fn(() => {
    child.killed = true;
  });

  setTimeout(() => {
    child.emit("close", exitCode);
  }, delayMs);

  return child;
}

describe("MediaOptimizer Wrappers", () => {
  describe("ImageOptimizer", () => {
    it("rejects non-allowlisted MIME types", async () => {
      const optimizer = new ImageOptimizer();
      await assert.rejects(
        optimizer.optimize(TINY_PNG_BUFFER, "text/html"),
        (err: Error) => {
          assert.ok(err instanceof MediaOptimizerError);
          assert.equal((err as MediaOptimizerError).code, "UNSUPPORTED_MIME_TYPE");
          return true;
        }
      );
    });

    it("resizes and compresses images successfully", async () => {
      const optimizer = new ImageOptimizer();
      // Optimize a valid tiny PNG
      const result = await optimizer.optimize(TINY_PNG_BUFFER, "image/png");

      assert.ok(result.buffer instanceof Buffer, "Should output buffer");
      assert.equal(result.mimeType, "image/png");
      assert.ok(result.width > 0, "Should extract width");
      assert.ok(result.height > 0, "Should extract height");
    });

    it("rejects output image exceeding 50MB with MEDIA_TOO_LARGE", async () => {
      const optimizer = new ImageOptimizer();
      
      // We can force a fail by setting maxSizeBytes option to a small number
      await assert.rejects(
        optimizer.optimize(TINY_PNG_BUFFER, "image/png", { maxSizeBytes: 10 }),
        (err: Error) => {
          assert.ok(err instanceof MediaOptimizerError);
          assert.equal((err as MediaOptimizerError).code, "MEDIA_TOO_LARGE");
          return true;
        }
      );
    });
  });

  describe("VideoOptimizer", () => {
    it("probes video duration and metadata successfully", async () => {
      const ffprobeOutput = JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
            duration: "12.500000",
            bit_rate: "5000000"
          },
          {
            codec_type: "audio",
            codec_name: "aac",
            duration: "12.520000"
          }
        ]
      });

      const mockSpawn = mock.fn(() => createMockChildProcess(0, ffprobeOutput));
      const optimizer = new VideoOptimizer({ spawnImpl: mockSpawn as any });

      const metadata = await optimizer.probe("input.mp4");

      assert.equal(metadata.width, 1920);
      assert.equal(metadata.height, 1080);
      assert.equal(metadata.durationSeconds, 12.5);
      assert.equal(metadata.videoCodec, "h264");
      assert.equal(metadata.audioCodec, "aac");
      assert.equal(metadata.bitrate, 5000000);
      
      // Verify ffprobe arguments are secure and do not invoke shell injection
      const spawnCall = (mockSpawn.mock.calls as any[])[0];
      assert.equal(spawnCall.arguments[0], "ffprobe");
      const args = spawnCall.arguments[1] as string[];
      assert.ok(args.includes("-show_streams"));
      assert.ok(args.includes("-print_format"));
      assert.ok(args.includes("input.mp4"));
    });

    it("handles ffmpeg transcode success and checks size limits", async () => {
      const mockSpawn = mock.fn(() => createMockChildProcess(0, "", "ffmpeg encoding logs..."));
      
      // Create a fake output file to satisfy file existence and size checking
      const tempOut = path.join(".tmp", `test-out-${Date.now()}.mp4`);
      await fs.mkdir(".tmp", { recursive: true });
      await fs.writeFile(tempOut, "dummy output video content");

      try {
        const optimizer = new VideoOptimizer({ spawnImpl: mockSpawn as any });
        const result = await optimizer.optimize("input.mov", tempOut, {
          maxSizeBytes: 1000
        });

        assert.equal(result.sizeBytes, 26); // length of dummy content
        assert.equal(result.mimeType, "video/mp4");
        
        // Assert spawn parameters
        const spawnCall = (mockSpawn.mock.calls as any[])[0];
        assert.equal(spawnCall.arguments[0], "ffmpeg");
        const args = spawnCall.arguments[1] as string[];
        assert.ok(args.includes("-c:v"));
        assert.ok(args.includes("libx264"));
        assert.ok(args.includes("-c:a"));
        assert.ok(args.includes("aac"));
      } finally {
        await fs.rm(tempOut, { force: true });
      }
    });

    it("throws MEDIA_OPTIMIZATION_FAILED on ffmpeg non-zero exit status", async () => {
      const mockSpawn = mock.fn(() => createMockChildProcess(1, "", "ffmpeg error: invalid stream"));
      const optimizer = new VideoOptimizer({ spawnImpl: mockSpawn as any });

      await assert.rejects(
        optimizer.optimize("input.mov", "output.mp4"),
        (err: Error) => {
          assert.ok(err instanceof MediaOptimizerError);
          assert.equal((err as MediaOptimizerError).code, "MEDIA_OPTIMIZATION_FAILED");
          assert.ok(err.message.includes("exit code 1"));
          return true;
        }
      );
    });

    it("aborts ffmpeg, cleans up temp files, and throws on execution timeouts", async () => {
      const mockSpawn = mock.fn(() => createMockChildProcess(0, "", "", 500));
      const optimizer = new VideoOptimizer({ spawnImpl: mockSpawn as any });

      const tempOut = path.join(".tmp", `test-timeout-${Date.now()}.mp4`);
      await fs.mkdir(".tmp", { recursive: true });
      await fs.writeFile(tempOut, "initial temp data");

      try {
        await assert.rejects(
          optimizer.optimize("input.mov", tempOut, { timeoutMs: 50 }),
          (err: Error) => {
            assert.ok(err instanceof MediaOptimizerError);
            assert.equal((err as MediaOptimizerError).code, "MEDIA_OPTIMIZATION_FAILED");
            assert.ok(err.message.includes("timed out"));
            return true;
          }
        );

        // Verify output file cleanup occurred on timeout
        await assert.rejects(fs.access(tempOut));
      } finally {
        await fs.rm(tempOut, { force: true });
      }
    });

    it("throws MEDIA_TOO_LARGE if ffmpeg output file exceeds limits", async () => {
      const mockSpawn = mock.fn(() => createMockChildProcess(0, "", "done"));
      const tempOut = path.join(".tmp", `test-size-${Date.now()}.mp4`);
      await fs.mkdir(".tmp", { recursive: true });
      await fs.writeFile(tempOut, "content exceeding max size");

      try {
        const optimizer = new VideoOptimizer({ spawnImpl: mockSpawn as any });
        
        await assert.rejects(
          optimizer.optimize("input.mov", tempOut, { maxSizeBytes: 5 }),
          (err: Error) => {
            assert.ok(err instanceof MediaOptimizerError);
            assert.equal((err as MediaOptimizerError).code, "MEDIA_TOO_LARGE");
            return true;
          }
        );

        // Verify temp file cleaned up after rejection
        await assert.rejects(fs.access(tempOut));
      } finally {
        await fs.rm(tempOut, { force: true });
      }
    });
  });
});
