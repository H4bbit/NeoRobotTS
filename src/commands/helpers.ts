import { type WAMessage, type WASocket } from "baileys";
import { sendReaction } from "../messages/react.js";
import { getTargetJid, isBotAdmin, isBotJid, isParticipantAdmin } from "../utils/admin.js";

export async function reply(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
  emoji: string,
  text: string,
) {
  await sendReaction(sock, msg, emoji);
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

export async function requireGroup(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
  jidType: string,
): Promise<boolean> {
  if (jidType !== "group") {
    await reply(sock, jid, msg, "❓", "Este comando só funciona em grupos.");
    return false;
  }
  return true;
}

export async function requireSenderAdmin(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
): Promise<string | null> {
  const senderJid = msg.key!.participant ?? msg.key!.remoteJid!;
  if (!(await isParticipantAdmin(sock, jid, senderJid))) {
    await reply(sock, jid, msg, "❌", "Você precisa ser admin para usar este comando.");
    return null;
  }
  return senderJid;
}

export async function requireBotAdmin(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
  action: string,
): Promise<boolean> {
  if (!(await isBotAdmin(sock, jid))) {
    await reply(sock, jid, msg, "❌", `Eu preciso ser admin para ${action}.`);
    return false;
  }
  return true;
}

export async function resolveTarget(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
): Promise<string | null> {
  const t = await getTargetJid(sock, jid, msg as import("baileys").proto.IWebMessageInfo);
  if (t && isBotJid(sock, t)) {
    await reply(sock, jid, msg, "❌", "Não posso fazer isso comigo mesmo.");
    return null;
  }
  if (!t) {
    await reply(sock, jid, msg, "❓", "Marque ou responda alguém.");
    return null;
  }
  return t;
}
