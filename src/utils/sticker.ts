import { downloadContentFromMessage, proto } from "baileys";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import ffmpeg from "fluent-ffmpeg";
import { webpLogger as logger, stickerLogger } from "./logger.js";
import { addStickerMetadata } from "./metadataWebp.js";

type ImageMessage = proto.Message.IImageMessage;
type VideoMessage = proto.Message.IVideoMessage;
type WebpStickerMessage = proto.Message.IStickerMessage;

export type StickerMedia =
  | {
      type: "image";
      message: ImageMessage;
    }
  | {
      type: "video";
      message: VideoMessage;
    };

export type WebpStickerMedia = {
  type: "sticker";
  message: WebpStickerMessage;
};

type DownloadableMedia = StickerMedia | WebpStickerMedia;

type WebpConversionStage = "validate_input" | "write_input" | "inspect" | "validate_webp" | "extract_frames" | "write_concat" | "encode_video" | "read_output";

export class StickerConversionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly stage: WebpConversionStage,
  ) {
    super(message);
    this.name = "StickerConversionError";
  }
}

class WebpmuxProcessError extends Error {
  constructor(
    public readonly args: string[],
    public readonly exitCode: string | number | null,
    public readonly signal: NodeJS.Signals | null,
    public readonly outputLength: number,
  ) {
    super("webpmux failed");
    this.name = "WebpmuxProcessError";
  }
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function logWebpConversionFailure(stage: WebpConversionStage, error: unknown) {
  const details = error instanceof WebpmuxProcessError
    ? {
        tool: "webpmux",
        args: error.args.filter((arg) => !arg.includes("/") && !arg.includes("\\")),
        exitCode: error.exitCode,
        signal: error.signal,
        outputLength: error.outputLength,
      }
    : undefined;

  logger.error(
    {
      type: "webp_conversion_event",
      event: "failure",
      stage,
      errorName: getErrorName(error),
      details,
    },
    "webp conversion failed",
  );
}

function getDirectOrQuotedMessage(msg: proto.IWebMessageInfo): proto.IMessage | null {
  const message = msg.message;

  return message?.extendedTextMessage?.contextInfo?.quotedMessage ?? message ?? null;
}

export function getStickerMedia(
  msg: proto.IWebMessageInfo,
): StickerMedia | null {
  const message = getDirectOrQuotedMessage(msg);

  if (message?.imageMessage) {
    return {
      type: "image",
      message: message.imageMessage,
    };
  }

  if (message?.videoMessage) {
    return {
      type: "video",
      message: message.videoMessage,
    };
  }

  return null;
}

export function getWebpStickerMedia(
  msg: proto.IWebMessageInfo,
): WebpStickerMedia | null {
  const message = getDirectOrQuotedMessage(msg);

  if (!message?.stickerMessage) return null;

  return {
    type: "sticker",
    message: message.stickerMessage,
  };
}
export function getStickerDuration(msg: proto.IWebMessageInfo): number | null {
  const message = msg.message;
  if (!message) return null;

  if (message.videoMessage) {
    return message.videoMessage.seconds ?? null;
  }

  const quoted = message.extendedTextMessage?.contextInfo?.quotedMessage;

  if (!quoted?.videoMessage) {
    return null;
  }

  return quoted.videoMessage.seconds ?? null;
}
export async function downloadStickerMedia(
  media: DownloadableMedia,
): Promise<Buffer> {
  const stream = await downloadContentFromMessage(media.message, media.type);

  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function createTempPaths(ext: string): Promise<{
  dir: string;
  input: string;
  output: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "neorobot-"));

  return {
    dir,
    input: path.join(dir, `${crypto.randomUUID()}.${ext}`),
    output: path.join(dir, `${crypto.randomUUID()}.webp`),
  };
}

async function cleanup(dir: string) {
  await fs.rm(dir, {
    recursive: true,
    force: true,
  });
}

async function runFfmpeg(
  command: ffmpeg.FfmpegCommand,
  timeoutMs?: number,
): Promise<void> {
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

const WEBP_MAX_FILE_SIZE = 1024 * 1024 * 2;
const WEBP_MAX_FRAMES = 120;
const WEBP_MAX_DIMENSION = 1024;
const WEBP_MAX_DURATION_MS = 15000;
const PROCESS_TIMEOUT_MS = 15000;

export type AnimatedWebpFrameInfo = {
  index: number;
  width: number;
  height: number;
  duration: number;
  compression: string | null;
  hasAlpha: boolean;
};

export type AnimatedWebpInfo = {
  canvasWidth: number;
  canvasHeight: number;
  frameCount: number;
  loopCount: number | null;
  frames: AnimatedWebpFrameInfo[];
  compression: string | null;
  hasAlpha: boolean;
  duration: number;
};

async function runWebpmux(args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile("webpmux", args, { timeout: PROCESS_TIMEOUT_MS }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`;

      if (error) {
        const execError = error as NodeJS.ErrnoException & { code?: string | number; signal?: NodeJS.Signals };

        reject(new WebpmuxProcessError(
          args,
          execError.code ?? null,
          execError.signal ?? null,
          output.length,
        ));
        return;
      }

      resolve(output);
    });
  });
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;

  const number = Number.parseInt(value, 10);

  return Number.isFinite(number) ? number : null;
}

function findHeaderIndex(headers: string[], name: string, fallback: number): number {
  const index = headers.findIndex((header) => header.toLowerCase() === name);

  return index >= 0 ? index : fallback;
}

function parseWebpmuxInfo(output: string): AnimatedWebpInfo {
  const canvasMatch = output.match(/Canvas\s+size:\s*(\d+)\s*x\s*(\d+)/i)
    ?? output.match(/Canvas[^\n]*?:\s*(\d+)\s*x\s*(\d+)/i);
  const frameCountMatch = output.match(/Number\s+of\s+frames:\s*(\d+)/i);
  const loopCountMatch = output.match(/Loop\s+Count:\s*(\d+)/i);
  const lines = output.split(/\r?\n/);
  const headerLine = lines.find((line) => /^\s*No\.:/i.test(line));
  const headers = headerLine
    ?.replace(/^\s*No\.:\s*/i, "")
    .trim()
    .split(/\s+/) ?? [];
  const widthIndex = findHeaderIndex(headers, "width", 0);
  const heightIndex = findHeaderIndex(headers, "height", 1);
  const alphaIndex = findHeaderIndex(headers, "alpha", 2);
  const durationIndex = findHeaderIndex(headers, "duration", 5);
  const compressionIndex = findHeaderIndex(headers, "compression", 9);
  const frames: AnimatedWebpFrameInfo[] = [];

  for (const line of lines) {
    const frameMatch = line.match(/^\s*(\d+)\s*:\s*(.+)$/);

    if (!frameMatch) continue;

    const columns = frameMatch[2]?.trim().split(/\s+/) ?? [];
    const width = parseNumber(columns[widthIndex]);
    const height = parseNumber(columns[heightIndex]);
    const duration = parseNumber(columns[durationIndex]);

    if (width === null || height === null || duration === null) continue;

    frames.push({
      index: Number.parseInt(frameMatch[1]!, 10),
      width,
      height,
      duration,
      compression: columns[compressionIndex] ?? null,
      hasAlpha: /yes|true|1/i.test(columns[alphaIndex] ?? ""),
    });
  }

  const canvasWidth = parseNumber(canvasMatch?.[1]) ?? frames[0]?.width ?? 0;
  const canvasHeight = parseNumber(canvasMatch?.[2]) ?? frames[0]?.height ?? 0;
  const frameCount = parseNumber(frameCountMatch?.[1]) ?? frames.length;
  const compression = frames[0]?.compression ?? null;
  const hasAlpha = frames.some((frame) => frame.hasAlpha)
    || /Features[^\n]*Alpha/i.test(output)
    || /Features[^\n]*transparency/i.test(output);

  return {
    canvasWidth,
    canvasHeight,
    frameCount,
    loopCount: parseNumber(loopCountMatch?.[1]),
    frames,
    compression,
    hasAlpha,
    duration: frames.reduce((total, frame) => total + frame.duration, 0),
  };
}

export async function inspectAnimatedWebp(input: string): Promise<AnimatedWebpInfo> {
  const output = await runWebpmux(["-info", input]);

  return parseWebpmuxInfo(output);
}

function isWebpBuffer(buffer: Buffer): boolean {
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

function validateWebpForVideo(info: AnimatedWebpInfo, size: number) {
  if (size > WEBP_MAX_FILE_SIZE) {
    throw new StickerConversionError("O sticker é grande demais para converter.", "webp_file_too_large", "validate_webp");
  }

  if (info.canvasWidth <= 0 || info.canvasHeight <= 0) {
    throw new StickerConversionError("Envie um sticker WebP válido para converter.", "invalid_webp_dimensions", "validate_webp");
  }

  if (info.canvasWidth > WEBP_MAX_DIMENSION || info.canvasHeight > WEBP_MAX_DIMENSION) {
    throw new StickerConversionError("As dimensões do sticker são grandes demais.", "webp_dimensions_too_large", "validate_webp");
  }

  if (info.frameCount <= 0) {
    throw new StickerConversionError("O sticker não possui frames para converter.", "webp_without_frames", "validate_webp");
  }

  if (info.frameCount > WEBP_MAX_FRAMES) {
    throw new StickerConversionError("O sticker possui frames demais para converter.", "webp_too_many_frames", "validate_webp");
  }

  if (info.duration > WEBP_MAX_DURATION_MS) {
    throw new StickerConversionError("A duração do sticker é grande demais para converter.", "webp_duration_too_large", "validate_webp");
  }
}

export async function extractAnimatedWebpFrames(
  input: string,
  outputDir: string,
  frameCount: number,
): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true });

  const frames: string[] = [];

  for (let index = 1; index <= frameCount; index += 1) {
    const output = path.join(outputDir, `frame-${String(index).padStart(6, "0")}.webp`);

    try {
      await runWebpmux(["-get", "frame", String(index), input, "-o", output]);
      frames.push(output);
    } catch (error) {
      await fs.rm(output, { force: true });
      throw error;
    }
  }

  return frames;
}

function escapeConcatPath(file: string): string {
  return file.replace(/'/g, "'\\''");
}

async function writeConcatFile(
  file: string,
  frames: string[],
  info: AnimatedWebpInfo,
) {
  const lines: string[] = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const duration = (info.frames[index]?.duration ?? 100) / 1000;

    lines.push(`file '${escapeConcatPath(frame)}'`);
    lines.push(`duration ${duration.toFixed(3)}`);
  }

  lines.push(`file '${escapeConcatPath(frames[frames.length - 1]!)}'`);

  await fs.writeFile(file, `${lines.join("\n")}\n`);
}

export async function animatedWebpToVideo(buffer: Buffer): Promise<Buffer> {
  const startMs = Date.now();
  logger.info(
    {
      type: "webp_conversion_event",
      event: "start",
      fileSize: buffer.length,
    },
    "webp conversion started",
  );

  let stage: WebpConversionStage = "validate_input";

  if (!isWebpBuffer(buffer)) {
    const error = new StickerConversionError("Envie um sticker WebP válido para converter.", "invalid_webp_file", stage);
    logWebpConversionFailure(stage, error);
    throw error;
  }

  const temp = await createTempPaths("webp");
  const framesDir = path.join(temp.dir, "frames");
  const concatFile = path.join(temp.dir, "frames.txt");
  const output = path.join(temp.dir, `${crypto.randomUUID()}.mp4`);

  try {
    stage = "write_input";
    await fs.writeFile(temp.input, buffer);

    stage = "inspect";
    let info: AnimatedWebpInfo;

    try {
      info = await inspectAnimatedWebp(temp.input);
    } catch (error) {
      logWebpConversionFailure(stage, error);
      throw new StickerConversionError("Envie um sticker WebP válido para converter.", "webp_inspection_failed", stage);
    }

    logger.info(
      {
        type: "webp_conversion_event",
        event: "inspection_result",
        fileSize: buffer.length,
        frameCount: info.frameCount,
        canvasWidth: info.canvasWidth,
        canvasHeight: info.canvasHeight,
        duration: info.duration,
        loopCount: info.loopCount,
        compression: info.compression,
        hasAlpha: info.hasAlpha,
      },
      "webp inspection completed",
    );

    stage = "validate_webp";
    validateWebpForVideo(info, buffer.length);

    stage = "extract_frames";
    const frames = await extractAnimatedWebpFrames(temp.input, framesDir, info.frameCount);

    logger.info(
      {
        type: "webp_conversion_event",
        event: "frames_extracted",
        frameCount: frames.length,
        expectedFrameCount: info.frameCount,
        canvasWidth: info.canvasWidth,
        canvasHeight: info.canvasHeight,
        duration: info.duration,
      },
      "webp frames extracted",
    );

    if (frames.length === 0) {
      throw new StickerConversionError("O sticker não possui frames para converter.", "webp_without_frames", stage);
    }

    stage = "write_concat";
    await writeConcatFile(concatFile, frames, info);
    logger.info(
      {
        type: "webp_conversion_event",
        event: "concat_written",
        frameCount: frames.length,
      },
      "webp concat file written",
    );

    stage = "encode_video";
    const encodeStart = Date.now();
    logger.info(
      {
        type: "webp_conversion_event",
        event: "encode_start",
        frameCount: frames.length,
      },
      "webp video encode started",
    );
    await runFfmpeg(
      ffmpeg()
        .input(concatFile)
        .inputOptions("-f", "concat", "-safe", "0")
        .outputOptions(
          "-y",
          "-vf",
          "fps=30,format=yuv420p",
          "-movflags",
          "+faststart",
          "-pix_fmt",
          "yuv420p",
        )
        .output(output),
      PROCESS_TIMEOUT_MS,
    );
    logger.info(
      {
        type: "webp_conversion_event",
        event: "encode_done",
        durationMs: Date.now() - encodeStart,
      },
      "webp video encode completed",
    );

    stage = "read_output";
    const video = await fs.readFile(output);
    logger.info(
      {
        type: "webp_conversion_event",
        event: "success",
        fileSize: buffer.length,
        outputSize: video.length,
        frameCount: frames.length,
        totalDurationMs: Date.now() - startMs,
      },
      "webp conversion succeeded",
    );
    return video;
  } catch (error) {
    if (error instanceof StickerConversionError) {
      logWebpConversionFailure(error.stage, error);
      throw error;
    }

    logWebpConversionFailure(stage, error);
    throw new StickerConversionError("Não foi possível converter o sticker em vídeo.", "webp_conversion_failed", stage);
  } finally {
    await cleanup(temp.dir);
  }
}

export async function webpToImage(buffer: Buffer): Promise<Buffer> {
  const startMs = Date.now();
  logger.info({ type: "webp_conversion_event", event: "toimg_start", fileSize: buffer.length }, "webp to image started");
  if (!isWebpBuffer(buffer)) {
    throw new StickerConversionError("Envie um sticker WebP válido para converter.", "invalid_webp_file", "validate_input");
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "neorobot-"));
  const input = path.join(dir, `${crypto.randomUUID()}.webp`);
  const output = path.join(dir, `${crypto.randomUUID()}.png`);
  try {
    await fs.writeFile(input, buffer);
    await runFfmpeg(ffmpeg(input).outputOptions("-y").output(output), PROCESS_TIMEOUT_MS);
    const image = await fs.readFile(output);
    logger.info({ type: "webp_conversion_event", event: "toimg_success", fileSize: buffer.length, outputSize: image.length, durationMs: Date.now() - startMs }, "webp to image succeeded");
    return image;
  } catch (error) {
    logWebpConversionFailure("encode_video", error);
    throw new StickerConversionError("Não foi possível converter o sticker em imagem.", "webp_to_image_failed", "encode_video");
  } finally {
    await cleanup(dir);
  }
}

const PACK_NAME = "🤖 NeoRobot\n⤷ bot by S3NP41";

const AUTHOR_TEMPLATE = (sender: string) => `⚡ Feita por\n⤷ ⋅ ${sender}`;
export async function imageToSticker(
  buffer: Buffer,
  author: string,
): Promise<Buffer> {
  const startMs = Date.now();
  stickerLogger.info({ type: "sticker_event", event: "image_start", inputSize: buffer.length }, "image sticker started");
  const temp = await createTempPaths("png");

  try {
    await fs.writeFile(temp.input, buffer);
    await runFfmpeg(
      ffmpeg(temp.input)
        .outputOptions("-vf", "scale=512:512")
        .output(temp.output),
    );
    const sticker = await fs.readFile(temp.output);
    const out = await addStickerMetadata(sticker, PACK_NAME, AUTHOR_TEMPLATE(author));
    stickerLogger.info({ type: "sticker_event", event: "image_success", inputSize: buffer.length, outputSize: out.length, durationMs: Date.now() - startMs }, "image sticker succeeded");
    return out;
  } finally {
    await cleanup(temp.dir);
  }
}
export async function videoToSticker(
  buffer: Buffer,
  author: string,
): Promise<Buffer> {
  const startMs = Date.now();
  stickerLogger.info({ type: "sticker_event", event: "video_start", inputSize: buffer.length }, "video sticker started");
  const temp = await createTempPaths("mp4");

  try {
    await fs.writeFile(temp.input, buffer);

    await runFfmpeg(
      ffmpeg(temp.input)
        .outputOptions(
          "-y",
          "-vcodec",
          "libwebp",
          "-fs",
          "0.99M",
          "-filter_complex",
          "[0:v] scale=512:512,fps=12,pad=512:512:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse",
          "-f",
          "webp",
        )
        .output(temp.output),
    );

    const sticker = await fs.readFile(temp.output);
    const out = await addStickerMetadata(sticker, PACK_NAME, AUTHOR_TEMPLATE(author));
    stickerLogger.info({ type: "sticker_event", event: "video_success", inputSize: buffer.length, outputSize: out.length, durationMs: Date.now() - startMs }, "video sticker succeeded");
    return out;
  } finally {
    await cleanup(temp.dir);
  }
}
