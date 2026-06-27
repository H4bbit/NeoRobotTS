import { proto } from "baileys";

export function getMessageText(msg: proto.IWebMessageInfo): string {
  return (
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    msg.message?.imageMessage?.caption ??
    ""
  );
}
