import { type WAMessage, type WASocket } from "baileys";

export async function sendReaction(sock: WASocket, msg: WAMessage, emoji: string) {
  await sock.sendMessage(msg.key.remoteJid!, {
    react: {
      text: emoji,
      key: msg.key,
    },
  });
}
