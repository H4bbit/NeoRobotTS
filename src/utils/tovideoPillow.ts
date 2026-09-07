import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import PQueue from "p-queue";
import { webpLogger as logger } from "./logger.js";
import { StickerConversionError } from "./sticker.js";
type WebpConversionStage = "validate_input" | "write_input" | "inspect" | "validate_webp" | "extract_frames" | "write_concat" | "encode_video" | "read_output";

// Fila isolada para v2 — não compartilha com sticker.ts pra manter isolamento.
// Mesmo limite inicial 2, ajustável por observabilidade.
const pillowQueue = new PQueue({ concurrency: 2 });

const PROCESS_TIMEOUT_MS = 15000;

function isWebpBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function runFfmpeg(command: ffmpeg.FfmpegCommand, timeoutMs?: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        command.kill("SIGKILL");
        reject(new Error("Tempo limite excedido ao processar mídia."));
      }, timeoutMs);
    }
    command
      .on("end", () => {
        if (timer) clearTimeout(timer);
        resolve();
      })
      .on("error", (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      })
      .run();
  });
}

async function runPillowExtract(input: string, outputDir: string): Promise<number> {
  const pythonCode = `
import sys
from PIL import Image
import os
inp = sys.argv[1]
outdir = sys.argv[2]
im = Image.open(inp)
os.makedirs(outdir, exist_ok=True)
count = 0
for i in range(getattr(im, "n_frames", 1)):
    try:
        im.seek(i)
    except EOFError:
        break
    frame = im.convert("RGBA")
    frame.save(os.path.join(outdir, f"frame{i:04d}.png"))
    count += 1
print(count)
`;
  return await new Promise<number>((resolve, reject) => {
    execFile("python3", ["-c", pythonCode, input, outputDir], { timeout: PROCESS_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Pillow extract failed: ${stderr || stdout || error.message}`));
        return;
      }
      const n = Number.parseInt(stdout.trim(), 10);
      if (!Number.isFinite(n) || n <= 0) {
        reject(new Error(`Pillow extract produced no frames: ${stdout} ${stderr}`));
        return;
      }
      resolve(n);
    });
  });
}

async function cleanup(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function animatedWebpToVideoViaPillow(buffer: Buffer): Promise<Buffer> {
  return pillowQueue.add(async () => {
    const startMs = Date.now();
    const stageInitial: WebpConversionStage = "validate_input";
    logger.info(
      { type: "webp_conversion_event", event: "tovideo2_start", fileSize: buffer.length },
      "tovideo2 (pillow) started",
    );

    if (!isWebpBuffer(buffer)) {
      const error = new StickerConversionError("Envie um sticker WebP válido para converter.", "invalid_webp_file", stageInitial);
      logger.error({ type: "webp_conversion_event", event: "failure", stage: stageInitial, errorName: getErrorName(error) }, "webp conversion failed");
      throw error;
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "neorobot-pillow-"));
    const input = path.join(dir, `${crypto.randomUUID()}.webp`);
    const framesDir = path.join(dir, "frames");
    const output = path.join(dir, `${crypto.randomUUID()}.mp4`);
    let stage: WebpConversionStage = "write_input";

    try {
      await fs.writeFile(input, buffer);

      stage = "extract_frames";
      let frameCount: number;
      try {
        frameCount = await runPillowExtract(input, framesDir);
      } catch (error) {
        logger.error({ type: "webp_conversion_event", event: "failure", stage, errorName: getErrorName(error) }, "webp conversion failed");
        throw new StickerConversionError("Não foi possível extrair frames do sticker (Pillow).", "webp_extract_failed", stage);
      }

      logger.info(
        { type: "webp_conversion_event", event: "tovideo2_frames_extracted", frameCount, fileSize: buffer.length },
        "tovideo2 frames extracted via Pillow",
      );

      stage = "encode_video";
      const encodeStart = Date.now();
      logger.info({ type: "webp_conversion_event", event: "tovideo2_encode_start", frameCount }, "tovideo2 encode started");

      await runFfmpeg(
        ffmpeg()
          .input(path.join(framesDir, "frame%04d.png"))
          .inputOptions("-framerate", "12")
          .outputOptions("-y", "-vf", "scale=512:512,fps=12,format=yuv420p", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart")
          .output(output),
        PROCESS_TIMEOUT_MS,
      );

      logger.info({ type: "webp_conversion_event", event: "tovideo2_encode_done", durationMs: Date.now() - encodeStart }, "tovideo2 encode completed");

      stage = "read_output";
      const video = await fs.readFile(output);
      logger.info(
        { type: "webp_conversion_event", event: "tovideo2_success", fileSize: buffer.length, outputSize: video.length, frameCount, totalDurationMs: Date.now() - startMs },
        "tovideo2 succeeded",
      );
      return video;
    } catch (error) {
      if (error instanceof StickerConversionError) {
        logger.error({ type: "webp_conversion_event", event: "failure", stage: error.stage, errorName: getErrorName(error) }, "webp conversion failed");
        throw error;
      }
      logger.error({ type: "webp_conversion_event", event: "failure", stage, errorName: getErrorName(error) }, "webp conversion failed");
      throw new StickerConversionError("Não foi possível converter o sticker em vídeo (Pillow).", "webp_conversion_failed", stage);
    } finally {
      await cleanup(dir);
    }
  });
}
