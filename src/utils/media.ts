import { downloadContentFromMessage, type proto } from "baileys";
import type { WASocket } from "baileys";
import { commandLogger } from "./logger.js";

export type MediaType = "image" | "video" | "audio";

export interface DownloadedMedia {
  buffer: Buffer;
  mediaType: MediaType;
  size: number;
}

/**
 * Baixa mídia genérica via Baileys e retorna Buffer consolidado.
 * Elimina o padrão repetido de Buffer.from([]) + for-await + concat.
 */
export async function downloadMedia(
  message: proto.Message.IImageMessage | proto.Message.IVideoMessage | proto.Message.IAudioMessage,
  mediaType: MediaType,
): Promise<DownloadedMedia> {
  const stream = await downloadContentFromMessage(message, mediaType);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const buffer = Buffer.concat(chunks);
  return { buffer, mediaType, size: buffer.length };
}

/**
 * Extrai a mensagem interna de uma view-once message,
 * cobrindo todas as variantes da API da Baileys.
 */
export function extractViewOnce(quoted: proto.IMessage): {
  image?: proto.Message.IImageMessage | null;
  video?: proto.Message.IVideoMessage | null;
  audio?: proto.Message.IAudioMessage | null;
} {
  const raw =
    quoted?.viewOnceMessage?.message ||
    quoted?.viewOnceMessageV2?.message ||
    quoted?.viewOnceMessageV2Extension?.message ||
    quoted;

  return {
    image: raw?.imageMessage ?? null,
    video: raw?.videoMessage ?? null,
    audio: raw?.audioMessage ?? null,
  };
}

/**
 * Envia mídia revelada (sem viewOnce) com reação e logging padronizados.
 * Centraliza o boilerplate de: viewOnce=false + download + send + reaction + log.
 */
export async function sendRevealedMedia(
  sock: WASocket,
  jid: string,
  msg: import("baileys").proto.IWebMessageInfo,
  mediaType: MediaType,
  message: proto.Message.IImageMessage | proto.Message.IVideoMessage | proto.Message.IAudioMessage,
  caption?: string,
): Promise<void> {
  const { buffer, size } = await downloadMedia(message, mediaType);

  message.viewOnce = false;

  const extra: Record<string, unknown> = { quoted: msg };
  if (mediaType === "audio") {
    (message as proto.Message.IAudioMessage).ptt = true;
    extra["mimetype"] = "audio/ogg; codecs=opus";
    extra["ptt"] = true;
  }

  await sock.sendMessage(jid, {
    [mediaType]: buffer,
    ...(caption ? { caption } : {}),
    ...extra,
  } as Parameters<typeof sock.sendMessage>[1]);

  commandLogger.info(
    { type: "media_event", action: "reveal_success", jid, mediaType, size },
    "reveal succeeded",
  );
}
