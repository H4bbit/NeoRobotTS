import type { WASocket } from "baileys";
import { normalizeJid } from "./admin.js";

export function getSenderJid(msg: import("baileys").proto.IWebMessageInfo): string {
  return msg.key?.participant ?? msg.key?.remoteJid ?? "";
}

export function isOwner(sock: WASocket, msg: import("baileys").proto.IWebMessageInfo): boolean {
  // self-bot: dono = quem enviou pelo próprio aparelho (fromMe) ou LID do bot
  if ((msg.key as unknown as { fromMe?: boolean })?.fromMe) return true;
  const sender = getSenderJid(msg);
  const botId = sock.user?.id ?? "";
  const botLid = (sock.user as unknown as { lid?: string })?.lid ?? "";
  const senderNorm = normalizeJid(sender);
  if (!senderNorm) return false;
  const candidates = [botId, botLid].filter(Boolean).map(normalizeJid);
  if (candidates.includes(senderNorm)) return true;
  const envOwner = (process.env.OWNER_JID ?? "").trim();
  if (envOwner && normalizeJid(envOwner) === senderNorm) return true;
  // fallback privado: se for PV (não grupo), considera dono (self-bot só tem um dono)
  const jid = msg.key?.remoteJid ?? "";
  if (jid && !jid.endsWith("@g.us")) return true;
  return false;
}

export async function requireOwner(
  sock: WASocket,
  msg: import("baileys").proto.IWebMessageInfo,
  jid: string,
): Promise<boolean> {
  if (isOwner(sock, msg)) return true;
  const { sendReaction } = await import("../messages/react.js");
  await sendReaction(sock, msg as unknown as import("baileys").WAMessage, "❌");
  await sock.sendMessage(
    jid,
    { text: "❌ Apenas o dono pode usar este comando." },
    { quoted: msg as unknown as import("baileys").WAMessage },
  );
  return false;
}
