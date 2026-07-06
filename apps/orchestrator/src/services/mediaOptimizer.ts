import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import sharp from "sharp";

const MAX_IMAGE_EDGE_PX = 4096;
const COMPRESSION_QUALITY = 85;
const DEFAULT_MAX_IMAGE_SIZE_BYTES = 52_428_800; // 50MB (50 * 1024 * 1024)
const DEFAULT_MAX_VIDEO_SIZE_BYTES = 1_073_741_824; // 1GB (1024 * 1024 * 1024)
const DEFAULT_VIDEO_TIMEOUT_MS = 300_000; // 5 minutes

export class MediaOptimizerError extends Error {
  constructor(public code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MediaOptimizerError";
  }
}

export class ImageOptimizer {
  /**
   * Resizes and compresses image to jpeg/png/webp, enforcing size limits.
   */
  public async optimize(
    inputBuffer: Buffer,
    mimeType: string,
    options?: { maxSizeBytes?: number }
  ): Promise<{ buffer: Buffer; mimeType: string; width: number; height: number }> {
    const cleanMime = mimeType.toLowerCase().trim();
    if (cleanMime !== "image/jpeg" && cleanMime !== "image/jpg" && cleanMime !== "image/png" && cleanMime !== "image/webp") {
      throw new MediaOptimizerError("UNSUPPORTED_MIME_TYPE", `Image optimizer: MIME type '${mimeType}' is not supported.`);
    }

    try {
      const image = sharp(inputBuffer);
      
      // Resize to fit inside 4096x4096, preserving aspect ratio and avoiding enlargement
      image.resize(MAX_IMAGE_EDGE_PX, MAX_IMAGE_EDGE_PX, {
        fit: "inside",
        withoutEnlargement: true
      });

      // Apply quality formatting
      if (cleanMime === "image/jpeg" || cleanMime === "image/jpg") {
        image.jpeg({ quality: COMPRESSION_QUALITY });
      } else if (cleanMime === "image/png") {
        image.png({ quality: COMPRESSION_QUALITY });
      } else if (cleanMime === "image/webp") {
        image.webp({ quality: COMPRESSION_QUALITY });
      }

      const { data, info } = await image.toBuffer({ resolveWithObject: true });

      const maxLimit = options?.maxSizeBytes || DEFAULT_MAX_IMAGE_SIZE_BYTES;
      if (data.length > maxLimit) {
        throw new MediaOptimizerError("MEDIA_TOO_LARGE", `Image optimization output size ${data.length} bytes exceeds limit of ${maxLimit} bytes.`);
      }

      return {
        buffer: data,
        mimeType: cleanMime,
        width: info.width,
        height: info.height
      };
    } catch (error) {
      if (error instanceof MediaOptimizerError) throw error;
      throw new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `Image optimization failed: ${(error as Error).message}`, { cause: error });
    }
  }
}

export interface VideoMetadata {
  width?: number;
  height?: number;
  durationSeconds?: number;
  videoCodec?: string;
  audioCodec?: string;
  bitrate?: number;
}

export interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  bit_rate?: string;
}

export interface FfprobeResult {
  streams?: FfprobeStream[];
}

export class VideoOptimizer {
  private spawnImpl: typeof spawn;

  constructor(config?: { spawnImpl?: typeof spawn }) {
    this.spawnImpl = config?.spawnImpl || spawn;
  }

  /**
   * Probes video metadata using ffprobe.
   */
  public async probe(filePath: string): Promise<VideoMetadata> {
    return new Promise<VideoMetadata>((resolve, reject) => {
      const args = [
        "-v", "error",
        "-show_streams",
        "-print_format", "json",
        filePath
      ];

      const cp = this.spawnImpl("ffprobe", args);
      let stdoutData = "";
      let stderrData = "";

      cp.stdout?.on("data", (chunk: Buffer) => {
        stdoutData += chunk.toString();
      });

      cp.stderr?.on("data", (chunk: Buffer) => {
        stderrData += chunk.toString();
      });

      cp.on("error", (error) => {
        reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `ffprobe failed to start: ${error.message}`, { cause: error }));
      });

      cp.on("close", (code) => {
        if (code !== 0) {
          reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `ffprobe failed with exit code ${code || "null"}. Stderr: ${stderrData}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdoutData) as FfprobeResult;
          const videoStream = parsed.streams?.find((s) => s.codec_type === "video");
          const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");

          const metadata: VideoMetadata = {};
          if (videoStream) {
            metadata.width = videoStream.width;
            metadata.height = videoStream.height;
            metadata.videoCodec = videoStream.codec_name;
            if (videoStream.duration) {
              metadata.durationSeconds = parseFloat(videoStream.duration);
            }
            if (videoStream.bit_rate) {
              metadata.bitrate = parseInt(videoStream.bit_rate, 10);
            }
          }
          if (audioStream) {
            metadata.audioCodec = audioStream.codec_name;
            if (!metadata.durationSeconds && audioStream.duration) {
              metadata.durationSeconds = parseFloat(audioStream.duration);
            }
          }

          resolve(metadata);
        } catch (error) {
          reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `Failed parsing ffprobe stdout: ${(error as Error).message}. Raw: ${stdoutData}`, { cause: error }));
        }
      });
    });
  }

  /**
   * Optimizes video input and transcodes it to standard MP4/H264/AAC.
   */
  public async optimize(
    inputPath: string,
    outputPath: string,
    options?: { maxSizeBytes?: number; timeoutMs?: number }
  ): Promise<{ sizeBytes: number; mimeType: string }> {
    const timeoutMs = options?.timeoutMs || DEFAULT_VIDEO_TIMEOUT_MS;
    const maxLimit = options?.maxSizeBytes || DEFAULT_MAX_VIDEO_SIZE_BYTES;

    const cleanupOutputFile = async () => {
      await fs.rm(outputPath, { force: true });
    };

    return new Promise<{ sizeBytes: number; mimeType: string }>((resolve, reject) => {
      const args = [
        "-i", inputPath,
        "-y",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-movflags", "+faststart",
        outputPath
      ];

      const cp = this.spawnImpl("ffmpeg", args);
      let stderrData = "";
      let childKilled = false;

      cp.stderr?.on("data", (chunk: Buffer) => {
        stderrData += chunk.toString();
      });

      const timeoutId = setTimeout(() => {
        childKilled = true;
        cp.kill();
        cleanupOutputFile().then(() => {
          reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `ffmpeg process timed out after ${timeoutMs}ms.`));
        }).catch((err: unknown) => {
          reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `ffmpeg process timed out and cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
        });
      }, timeoutMs);

      cp.on("error", (error) => {
        clearTimeout(timeoutId);
        cleanupOutputFile().then(() => {
          reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `ffmpeg failed to start: ${error.message}`, { cause: error }));
        }).catch((err: unknown) => {
          reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `ffmpeg failed to start and cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
        });
      });

      cp.on("close", (code) => {
        clearTimeout(timeoutId);

        if (childKilled) {
          return; // Already handled in timeout handler
        }

        if (code !== 0) {
          cleanupOutputFile().then(() => {
            reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `ffmpeg failed with exit code ${code || "null"}. Stderr: ${stderrData}`));
          }).catch((err: unknown) => {
            reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `ffmpeg failed with exit code ${code || "null"} and cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
          });
          return;
        }

        fs.stat(outputPath).then((stats) => {
          if (stats.size > maxLimit) {
            cleanupOutputFile().then(() => {
              reject(new MediaOptimizerError("MEDIA_TOO_LARGE", `ffmpeg output size ${stats.size} bytes exceeds limit of ${maxLimit} bytes.`));
            }).catch((err: unknown) => {
              reject(new MediaOptimizerError("MEDIA_TOO_LARGE", `ffmpeg output size ${stats.size} bytes exceeds limit and cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
            });
            return;
          }

          resolve({
            sizeBytes: stats.size,
            mimeType: "video/mp4"
          });
        }).catch((error: unknown) => {
          cleanupOutputFile().then(() => {
            reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `Failed stating output file ${outputPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
          }).catch((err: unknown) => {
            reject(new MediaOptimizerError("MEDIA_OPTIMIZATION_FAILED", `Failed stating output file and cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
          });
        });
      });
    });
  }
}
