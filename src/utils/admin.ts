import { type WASocket } from "baileys";
import { commandLogger } from "./logger.js";

export function normalizeJid(jid: string): string {
  return jid.split(":")[0]!.split("@")[0]!;
}

export function isBotJid(sock: WASocket, targetJid: string): boolean {
  const botJid = sock.user?.id;
  const botLid = (sock.user as unknown as { lid?: string })?.lid;
  const targetNorm = normalizeJid(targetJid);
  return [botJid, botLid].filter(Boolean).some((b) => normalizeJid(b as string) === targetNorm);
}

export async function getParticipantRole(
  sock: WASocket,
  groupJid: string,
  participantJid: string,
): Promise<"admin" | "superadmin" | null> {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const targetNorm = normalizeJid(participantJid);
    const participant = metadata.participants.find((p) => {
      const idNorm = normalizeJid(p.id);
      const lidNorm = (p as unknown as { lid?: string }).lid
        ? normalizeJid((p as unknown as { lid: string }).lid)
        : null;
      return idNorm === targetNorm || lidNorm === targetNorm;
    });
    const role = (participant?.admin as "admin" | "superadmin" | undefined) ?? null;
    commandLogger.info(
      {
        type: "admin_event",
        action: "check_admin",
        groupJid,
        participantJid,
        targetNorm,
        found: !!participant,
        admin: role,
      },
      "admin check",
    );
    return role;
  } catch (error) {
    commandLogger.error(
      { type: "admin_event", action: "check_admin_failed", groupJid, participantJid, error },
      "failed to check admin",
    );
    return null;
  }
}

export async function isParticipantAdmin(
  sock: WASocket,
  groupJid: string,
  participantJid: string,
): Promise<boolean> {
  const role = await getParticipantRole(sock, groupJid, participantJid);
  return role === "admin" || role === "superadmin";
}

export async function isBotAdmin(sock: WASocket, groupJid: string): Promise<boolean> {
  const botJid = sock.user?.id;
  if (!botJid) return false;
  // In LID groups, bot may be listed by LID not phone. Try phone, lid, and lookup via metadata phoneNumber field
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const botNorm = normalizeJid(botJid);
    // also try sock.user.lid if exists (Baileys may store lid)
    const botLid = (sock.user as unknown as { lid?: string })?.lid;
    const candidates = [botJid, botNorm, botLid].filter(Boolean) as string[];
    // Check direct admin check first
    for (const c of candidates) {
      if (await isParticipantAdmin(sock, groupJid, c)) return true;
    }
    // Fallback: find participant entry where phoneNumber matches bot phone or lid matches
    const participant = metadata.participants.find((p) => {
      const pAny = p as unknown as { lid?: string; phoneNumber?: string };
      const idNorm = normalizeJid(p.id);
      const lidNorm = pAny.lid ? normalizeJid(pAny.lid) : null;
      const phoneNorm = pAny.phoneNumber ? normalizeJid(pAny.phoneNumber) : null;
      return (
        idNorm === botNorm ||
        lidNorm === botNorm ||
        phoneNorm === botNorm ||
        (botLid && (idNorm === normalizeJid(botLid) || lidNorm === normalizeJid(botLid)))
      );
    });
    if (participant) {
      commandLogger.info(
        {
          type: "admin_event",
          action: "bot_lookup",
          groupJid,
          botJid,
          botLid,
          foundId: participant.id,
          admin: participant.admin,
        },
        "bot admin lookup via phoneNumber",
      );
      return participant.admin === "admin" || participant.admin === "superadmin";
    }
    // Last resort: dump participants for debug
    commandLogger.info(
      {
        type: "admin_event",
        action: "bot_not_found",
        groupJid,
        botJid,
        botLid,
        participants: metadata.participants.map((p) => ({
          id: p.id,
          admin: p.admin,
          lid: (p as unknown as { lid?: string }).lid,
          phoneNumber: (p as unknown as { phoneNumber?: string }).phoneNumber,
        })),
      },
      "bot not found in participants",
    );
    return false;
  } catch (error) {
    commandLogger.error(
      { type: "admin_event", action: "isBotAdmin_failed", groupJid, error },
      "isBotAdmin failed",
    );
    return false;
  }
}

function getContextInfo(
  msg: import("baileys").proto.IWebMessageInfo,
): import("baileys").proto.IContextInfo | null | undefined {
  const m = msg.message;
  if (!m) return null;
  return (m.extendedTextMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.videoMessage?.contextInfo ??
    m.stickerMessage?.contextInfo ??
    m.conversation)
    ? undefined
    : undefined;
}

export async function getTargetJid(
  sock: WASocket,
  groupJid: string,
  msg: import("baileys").proto.IWebMessageInfo,
): Promise<string | null> {
  const contextInfo = getContextInfo(msg);
  const mentioned = contextInfo?.mentionedJid?.[0];
  if (mentioned) return mentioned;
  const quoted = (contextInfo as unknown as { participant?: string })?.participant;
  if (quoted) return quoted;
  const quoted2 = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (quoted2) return quoted2;
  // fallback: parse @number from text when mention entity is missing (e.g. typed "@928..." )
  const text = msg.message?.extendedTextMessage?.text ?? msg.message?.conversation ?? "";
  const atMatch = text.match(/@(\d{5,20})/);
  if (atMatch?.[1]) {
    const num = atMatch[1];
    // lookup real JID in groupMetadata by number base (handles LID vs s.whatsapp.net)
    try {
      const metadata = await sock.groupMetadata(groupJid);
      const participant = metadata.participants.find((p) => {
        const pAny = p as unknown as { lid?: string; phoneNumber?: string };
        return (
          normalizeJid(p.id) === num ||
          (pAny.lid && normalizeJid(pAny.lid) === num) ||
          (pAny.phoneNumber && normalizeJid(pAny.phoneNumber) === num)
        );
      });
      if (participant) return participant.id;
    } catch {}
    return `${num}@lid`;
  }
  return null;
}

export function debugMessageContext(
  msg: import("baileys").proto.IWebMessageInfo,
): Record<string, unknown> {
  const m = msg.message;
  return {
    hasExtended: !!m?.extendedTextMessage,
    hasConversation: !!m?.conversation,
    text: m?.extendedTextMessage?.text ?? m?.conversation ?? null,
    mentionedJid: getContextInfo(msg)?.mentionedJid ?? null,
    quotedParticipant:
      (getContextInfo(msg) as unknown as { participant?: string })?.participant ?? null,
    keyParticipant: msg.key?.participant ?? null,
    remoteJid: msg.key?.remoteJid ?? null,
  };
}
