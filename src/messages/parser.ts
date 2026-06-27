import { proto } from "baileys";

export function parseMessage(
  msg: proto.IWebMessageInfo,
): proto.IWebMessageInfo | null {
  if (!msg.message) return null;
  if (!msg.key?.remoteJid) return null;

  return msg;
}
