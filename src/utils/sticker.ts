import { downloadContentFromMessage, proto } from "baileys";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import ffmpeg from "fluent-ffmpeg";
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

async function runFfmpeg(command: ffmpeg.FfmpegCommand): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    command
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

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
    execFile("webpmux", args, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`;

      if (error) {
        reject(new Error(output.trim() || error.message));
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
  const temp = await createTempPaths("webp");
  const framesDir = path.join(temp.dir, "frames");
  const concatFile = path.join(temp.dir, "frames.txt");
  const output = path.join(temp.dir, `${crypto.randomUUID()}.mp4`);

  try {
    await fs.writeFile(temp.input, buffer);

    const info = await inspectAnimatedWebp(temp.input);
    const frames = await extractAnimatedWebpFrames(temp.input, framesDir, info.frameCount);

    if (frames.length === 0) {
      throw new Error("O sticker não possui frames para converter.");
    }

    await writeConcatFile(concatFile, frames, info);

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
    );

    return await fs.readFile(output);
  } finally {
    await cleanup(temp.dir);
  }
}

const PACK_NAME = "🤖 NeoRobot\n⤷ bot by S3NP41";

const AUTHOR_TEMPLATE = (sender: string) => `⚡ Feita por\n⤷ ⋅ ${sender}`;
export async function imageToSticker(
  buffer: Buffer,
  author: string,
): Promise<Buffer> {
  const temp = await createTempPaths("png");

  try {
    await fs.writeFile(temp.input, buffer);
    await runFfmpeg(
      ffmpeg(temp.input)
        .outputOptions("-vf", "scale=512:512")
        .output(temp.output),
    );
    const sticker = await fs.readFile(temp.output);
    return await addStickerMetadata(
      sticker,
      PACK_NAME,
      AUTHOR_TEMPLATE(author),
    );
  } finally {
    await cleanup(temp.dir);
  }
}
export async function videoToSticker(
  buffer: Buffer,
  author: string,
): Promise<Buffer> {
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
    return await addStickerMetadata(
      sticker,
      PACK_NAME,
      AUTHOR_TEMPLATE(author),
    );
  } finally {
    await cleanup(temp.dir);
  }
}
