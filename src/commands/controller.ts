import { type WASocket } from "baileys";
import { logCommand } from "../events/logger.js";
import { type BotEvent } from "../events/types.js";
import { sendReaction } from "../messages/react.js";
import { getMessageText } from "../messages/text.js";
import {
  debugMessageContext,
  getParticipantRole,
  getTargetJid,
  isBotJid,
  isParticipantAdmin,
} from "../utils/admin.js";
import { getJidType } from "../utils/jid.js";
import { commandLogger } from "../utils/logger.js";
import {
  animatedWebpToVideo,
  downloadStickerMedia,
  getStickerDuration,
  getStickerMedia,
  getWebpStickerMedia,
  imageToSticker,
  StickerConversionError,
  videoToSticker,
  webpToImage,
} from "../utils/sticker.js";
import { animatedWebpToVideoViaPillow } from "../utils/tovideoPillow.js";
import { isGroupActive, setGroupActive } from "./db.js";
import { requireBotAdmin, requireGroup, requireSenderAdmin } from "./helpers.js";

export async function commandController(
  sock: WASocket,
  event: BotEvent & { type: "MessageReceived" },
) {
  const msg = event.message;

  const jid = msg.key!.remoteJid!;
  const isGroup = jid.endsWith("@g.us");

  const text = getMessageText(msg);
  const sender = msg.pushName ?? "Desconhecido";
  const isCommand = text.startsWith("!");
  if (!isCommand) return;

  const parts = text.slice(1).trim().split(/\s+/);
  const command = parts[0];

  if (!command) return;

  logCommand({
    command,
    jid: jid,
    isGroup: isGroup,
    sender: sender,
  });

  const isActivationCommand = command === "boton" || command === "botoff";

  const jidType = getJidType(jid);

  // aplica regra apenas para grupos reais
  if (jidType === "group") {
    if (!isGroupActive(jid) && !isActivationCommand) return;
  }

  switch (command) {
    case "ping": {
      await sendReaction(sock, msg, "🏓");
      await sock.sendMessage(
        jid,
        {
          text: "Pong 🏓",
        },
        {
          quoted: msg,
        },
      );
      break;
    }

    case "boton": {
      if (jidType === "group") {
        setGroupActive(jid, true);
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(
          jid,
          {
            text: "✅ Bot ativado neste grupo",
          },
          {
            quoted: msg,
          },
        );
      }
      break;
    }

    case "botoff": {
      if (jidType === "group") {
        setGroupActive(jid, false);
        await sendReaction(sock, msg, "❌");
        await sock.sendMessage(
          jid,
          {
            text: "❌ Bot desativado neste grupo",
          },
          {
            quoted: msg,
          },
        );
      }
      break;
    }
    case "tovideo": {
      const media = getWebpStickerMedia(msg);

      if (!media) {
        await sendReaction(sock, msg, "❓");
        await sock.sendMessage(
          jid,
          {
            text: "Marque ou responda um sticker.",
          },
          {
            quoted: msg,
          },
        );
        break;
      }

      try {
        const input = await downloadStickerMedia(media);
        commandLogger.info(
          {
            type: "command_event",
            command: "tovideo",
            jid,
            stage: "downloaded",
            inputSize: input.length,
          },
          "tovideo downloaded",
        );
        const video = await animatedWebpToVideo(input);

        await sock.sendMessage(
          jid,
          {
            video,
            mimetype: "video/mp4",
          },
          {
            quoted: msg,
          },
        );
        await sendReaction(sock, msg, "✅");
        commandLogger.info(
          { type: "command_event", command: "tovideo", jid, outputSize: video.length },
          "tovideo succeeded",
        );
      } catch (error) {
        const text =
          error instanceof StickerConversionError
            ? error.message
            : "Não foi possível converter o sticker em vídeo.";

        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(
          jid,
          {
            text,
          },
          {
            quoted: msg,
          },
        );
      }
      break;
    }
    case "tovideo2": {
      const media = getWebpStickerMedia(msg);
      if (!media) {
        await sendReaction(sock, msg, "❓");
        await sock.sendMessage(jid, { text: "Marque ou responda um sticker." }, { quoted: msg });
        break;
      }
      try {
        const input = await downloadStickerMedia(media);
        commandLogger.info({ type: "command_event", command: "tovideo2", jid, stage: "downloaded", inputSize: input.length }, "tovideo2 downloaded");
        const video = await animatedWebpToVideoViaPillow(input);
        await sock.sendMessage(jid, { video, mimetype: "video/mp4" }, { quoted: msg });
        await sendReaction(sock, msg, "✅");
        commandLogger.info({ type: "command_event", command: "tovideo2", jid, outputSize: video.length }, "tovideo2 succeeded");
      } catch (error) {
        const text = error instanceof StickerConversionError ? error.message : "Não foi possível converter o sticker em vídeo (tovideo2).";
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(jid, { text }, { quoted: msg });
      }
      break;
    }
    case "toimg": {
      const media = getWebpStickerMedia(msg);
      if (!media) {
        await sendReaction(sock, msg, "❓");
        await sock.sendMessage(jid, { text: "Marque ou responda um sticker." }, { quoted: msg });
        break;
      }
      try {
        const input = await downloadStickerMedia(media);
        commandLogger.info(
          {
            type: "command_event",
            command: "toimg",
            jid,
            stage: "downloaded",
            inputSize: input.length,
          },
          "toimg downloaded",
        );
        const image = await webpToImage(input);
        await sock.sendMessage(jid, { image, mimetype: "image/png" }, { quoted: msg });
        await sendReaction(sock, msg, "✅");
        commandLogger.info(
          { type: "command_event", command: "toimg", jid, outputSize: image.length },
          "toimg succeeded",
        );
      } catch (error) {
        const text =
          error instanceof StickerConversionError
            ? error.message
            : "Não foi possível converter o sticker em imagem.";
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(jid, { text }, { quoted: msg });
      }
      break;
    }
    case "sticker":
    case "s": {
      const media = getStickerMedia(msg);

      if (!media) {
        await sendReaction(sock, msg, "❓");
        await sock.sendMessage(
          jid,
          {
            text: "Marque ou responda uma imagem ou vídeo.",
          },
          {
            quoted: msg,
          },
        );
        break;
      }
      if (media.type === "video") {
        const seconds = getStickerDuration(msg);

        if (seconds !== null && seconds > 10) {
          await sendReaction(sock, msg, "⚠️");
          await sock.sendMessage(
            jid,
            {
              text: "O vídeo deve ter no máximo 10 segundos.",
            },
            {
              quoted: msg,
            },
          );
          break;
        }
      }
      const input = await downloadStickerMedia(media);
      commandLogger.info(
        {
          type: "command_event",
          command: "sticker",
          jid,
          mediaType: media.type,
          inputSize: input.length,
        },
        "sticker downloaded",
      );
      const sticker =
        media.type === "image"
          ? await imageToSticker(input, sender)
          : await videoToSticker(input, sender);

      await sock.sendMessage(
        jid,
        {
          sticker,
        },
        {
          quoted: msg,
        },
      );
      await sendReaction(sock, msg, "✅");
      break;
    }
    case "promote":
    case "promover":
    case "up": {
      if (!(await requireGroup(sock, jid, msg as import("baileys").WAMessage, jidType))) break;
      const senderJid = msg.key.participant ?? msg.key.remoteJid!;
      const targetJid = await getTargetJid(sock, jid, msg);
      commandLogger.info(
        {
          type: "admin_event",
          action: "promote_attempt",
          jid,
          senderJid,
          targetJid,
          debug: debugMessageContext(msg),
        },
        "promote attempt",
      );
      if (targetJid && isBotJid(sock, targetJid)) {
        await sendReaction(sock, msg, "❌");
        await sock.sendMessage(jid, { text: "❌ Não posso me promover." }, { quoted: msg });
        break;
      }
      if (!targetJid) {
        await sendReaction(sock, msg, "❌");
        await sock.sendMessage(
          jid,
          { text: "❌ Você precisa ser admin para usar este comando." },
          { quoted: msg },
        );
        break;
      }
      if (!(await requireBotAdmin(sock, jid, msg as import("baileys").WAMessage, "promover")))
        break;
      const targetRole = await getParticipantRole(sock, jid, targetJid);
      if (targetRole === "superadmin") {
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(
          jid,
          { text: "⚠️ Não é possível promover/rebaixar o criador do grupo." },
          { quoted: msg },
        );
        break;
      }
      if (targetRole === "admin") {
        await sendReaction(sock, msg, "ℹ️");
        await sock.sendMessage(jid, { text: "ℹ️ Usuário já é admin." }, { quoted: msg });
        break;
      }
      try {
        await sock.groupParticipantsUpdate(jid, [targetJid], "promote");
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(jid, { text: "✅ Usuário promovido a admin" }, { quoted: msg });
        commandLogger.info(
          { type: "admin_event", action: "promote", jid, targetJid, senderJid },
          "promote succeeded",
        );
      } catch (error) {
        const isCreator = (error as unknown as { data?: number })?.data === 403;
        if (isCreator) {
          await sendReaction(sock, msg, "⚠️");
          await sock.sendMessage(
            jid,
            { text: "⚠️ Não é possível alterar o criador do grupo." },
            { quoted: msg },
          );
        } else {
          commandLogger.error(
            { type: "admin_event", action: "promote_failed", jid, targetJid, error },
            "promote failed",
          );
          await sendReaction(sock, msg, "⚠️");
          await sock.sendMessage(jid, { text: "Não foi possível promover." }, { quoted: msg });
        }
      }
      break;
    }
    case "demote":
    case "rebaixar":
    case "down": {
      if (!(await requireGroup(sock, jid, msg as import("baileys").WAMessage, jidType))) break;
      const senderJid = msg.key.participant ?? msg.key.remoteJid!;
      const targetJid = await getTargetJid(sock, jid, msg);
      commandLogger.info(
        {
          type: "admin_event",
          action: "demote_attempt",
          jid,
          senderJid,
          targetJid,
          debug: debugMessageContext(msg),
        },
        "demote attempt",
      );
      if (targetJid && isBotJid(sock, targetJid)) {
        await sendReaction(sock, msg, "❌");
        await sock.sendMessage(jid, { text: "❌ Não posso me rebaixar." }, { quoted: msg });
        break;
      }
      if (!targetJid) {
        break;
      }
      if (!(await isParticipantAdmin(sock, jid, senderJid))) {
        await sendReaction(sock, msg, "❌");
        await sock.sendMessage(
          jid,
          { text: "❌ Você precisa ser admin para usar este comando." },
          { quoted: msg },
        );
        break;
      }
      if (!(await requireBotAdmin(sock, jid, msg as import("baileys").WAMessage, "rebaixar")))
        break;
      const targetRoleDemote = await getParticipantRole(sock, jid, targetJid);
      if (targetRoleDemote === "superadmin") {
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(
          jid,
          { text: "⚠️ Não é possível promover/rebaixar o criador do grupo." },
          { quoted: msg },
        );
        break;
      }
      if (targetRoleDemote === null) {
        await sendReaction(sock, msg, "ℹ️");
        await sock.sendMessage(jid, { text: "ℹ️ Usuário já não é admin." }, { quoted: msg });
        break;
      }
      try {
        await sock.groupParticipantsUpdate(jid, [targetJid], "demote");
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(jid, { text: "✅ Usuário rebaixado" }, { quoted: msg });
        commandLogger.info(
          { type: "admin_event", action: "demote", jid, targetJid, senderJid },
          "demote succeeded",
        );
      } catch (error) {
        const isCreator = (error as unknown as { data?: number })?.data === 403;
        if (isCreator) {
          await sendReaction(sock, msg, "⚠️");
          await sock.sendMessage(
            jid,
            { text: "⚠️ Não é possível alterar o criador do grupo." },
            { quoted: msg },
          );
        } else {
          commandLogger.error(
            { type: "admin_event", action: "demote_failed", jid, targetJid, error },
            "demote failed",
          );
          await sendReaction(sock, msg, "⚠️");
          await sock.sendMessage(jid, { text: "Não foi possível rebaixar." }, { quoted: msg });
        }
      }
      break;
    }
    case "abrir":
    case "open": {
      if (!(await requireGroup(sock, jid, msg as import("baileys").WAMessage, jidType))) break;
      const senderJid = await requireSenderAdmin(sock, jid, msg as import("baileys").WAMessage);
      if (!senderJid) break;
      if (!(await requireBotAdmin(sock, jid, msg as import("baileys").WAMessage, "abrir o grupo")))
        break;
      try {
        await sock.groupSettingUpdate(jid, "not_announcement");
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(jid, { text: "✅ Grupo aberto" }, { quoted: msg });
        commandLogger.info({ type: "admin_event", action: "open", jid, senderJid }, "group opened");
      } catch (error) {
        commandLogger.error(
          { type: "admin_event", action: "open_failed", jid, error },
          "open failed",
        );
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(jid, { text: "Não foi possível abrir o grupo." }, { quoted: msg });
      }
      break;
    }
    case "fechar":
    case "close": {
      if (!(await requireGroup(sock, jid, msg as import("baileys").WAMessage, jidType))) break;
      const senderJid = await requireSenderAdmin(sock, jid, msg as import("baileys").WAMessage);
      if (!senderJid) break;
      if (!(await requireBotAdmin(sock, jid, msg as import("baileys").WAMessage, "fechar o grupo")))
        break;
      try {
        await sock.groupSettingUpdate(jid, "announcement");
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(jid, { text: "✅ Grupo fechado" }, { quoted: msg });
        commandLogger.info(
          { type: "admin_event", action: "close", jid, senderJid },
          "group closed",
        );
      } catch (error) {
        commandLogger.error(
          { type: "admin_event", action: "close_failed", jid, error },
          "close failed",
        );
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(jid, { text: "Não foi possível fechar o grupo." }, { quoted: msg });
      }
      break;
    }
    case "ban":
    case "banir":
    case "kick": {
      if (!(await requireGroup(sock, jid, msg as import("baileys").WAMessage, jidType))) break;
      const senderJid = msg.key.participant ?? msg.key.remoteJid!;
      const targetJid = await getTargetJid(sock, jid, msg);
      commandLogger.info(
        {
          type: "admin_event",
          action: "ban_attempt",
          jid,
          senderJid,
          targetJid,
          debug: debugMessageContext(msg),
        },
        "ban attempt",
      );
      if (targetJid && isBotJid(sock, targetJid)) {
        await sendReaction(sock, msg, "❌");
        await sock.sendMessage(jid, { text: "❌ Não posso me banir." }, { quoted: msg });
        break;
      }
      if (!targetJid) {
        await sendReaction(sock, msg, "❓");
        await sock.sendMessage(
          jid,
          { text: "Marque ou responda alguém para banir. Ex: !ban @usuario" },
          { quoted: msg },
        );
        commandLogger.info(
          { type: "admin_event", action: "ban_no_target", jid, senderJid },
          "ban no target",
        );
        break;
      }
      if (!(await isParticipantAdmin(sock, jid, senderJid))) {
        await sendReaction(sock, msg, "❌");
        await sock.sendMessage(
          jid,
          { text: "❌ Você precisa ser admin para usar este comando." },
          { quoted: msg },
        );
        commandLogger.info(
          { type: "admin_event", action: "ban_sender_not_admin", jid, senderJid },
          "ban sender not admin",
        );
        break;
      }
      if (!(await requireBotAdmin(sock, jid, msg as import("baileys").WAMessage, "banir"))) {
        commandLogger.info(
          { type: "admin_event", action: "ban_bot_not_admin", jid },
          "ban bot not admin",
        );
        break;
      }
      try {
        await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(jid, { text: "✅ Usuário banido" }, { quoted: msg });
        commandLogger.info(
          { type: "admin_event", action: "ban", jid, targetJid, senderJid },
          "ban succeeded",
        );
      } catch (error) {
        commandLogger.error(
          { type: "admin_event", action: "ban_failed", jid, targetJid, error },
          "ban failed",
        );
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(jid, { text: "Não foi possível banir." }, { quoted: msg });
      }
      break;
    }
    default:
      break;
  }
}
