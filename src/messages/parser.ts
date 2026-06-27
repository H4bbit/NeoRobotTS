import { proto } from "baileys";
import { type ParsedMessage } from "./types.js";

export function parseMessage(msg: proto.IWebMessageInfo): ParsedMessage | null {
  if (!msg.message) return null;
  if (!msg.key?.remoteJid) return null;

  return msg as ParsedMessage;
}
