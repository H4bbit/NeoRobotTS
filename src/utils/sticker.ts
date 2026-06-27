import { downloadContentFromMessage, proto } from "baileys";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import { addStickerMetadata } from "./metadataWebp.js";

type ImageMessage = proto.Message.IImageMessage;
type VideoMessage = proto.Message.IVideoMessage;

export type StickerMedia =
  | {
      type: "image";
      message: ImageMessage;
    }
  | {
      type: "video";
      message: VideoMessage;
    };

export function getStickerMedia(
  msg: proto.IWebMessageInfo,
): StickerMedia | null {
  const message = msg.message;
  if (!message) return null;

  // mídia enviada junto com o comando
  if (message.imageMessage) {
    return {
      type: "image",
      message: message.imageMessage,
    };
  }

  if (message.videoMessage) {
    return {
      type: "video",
      message: message.videoMessage,
    };
  }

  // mídia da mensagem respondida
  const quoted = message.extendedTextMessage?.contextInfo?.quotedMessage;

  if (!quoted) return null;

  if (quoted.imageMessage) {
    return {
      type: "image",
      message: quoted.imageMessage,
    };
  }

  if (quoted.videoMessage) {
    return {
      type: "video",
      message: quoted.videoMessage,
    };
  }

  return null;
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
  media: StickerMedia,
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
