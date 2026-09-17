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
import {
  askBansos,
  BANSOS_ALIVE_18,
  checkRateLimit,
  getAskModel,
  ASK_MODEL,
  ASK_MAX_TOKENS,
  VISION_MAX_TOKENS,
  VISION_MODEL,
  getAskTokens,
  getVisionModel,
  getVisionTokens,
  VISION_PROMPT_DEFAULT,
  visionBansos,
} from "../utils/bansos.js";
import { requireOwner } from "../utils/owner.js";
import { downloadMedia, extractViewOnce, sendRevealedMedia } from "../utils/media.js";
import { downloadContentFromMessage, type proto } from "baileys";
import { deleteAiConfig, getAiConfig, setAiConfig } from "./db.js";

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
    case "ask": {
      const prompt = parts.slice(1).join(" ").trim();
      if (!prompt) {
        await sendReaction(sock, msg, "❓");
        await sock.sendMessage(jid, { text: "Uso: !ask <pergunta>\nEx: !ask qual a capital do Brasil?" }, { quoted: msg });
        break;
      }
      const rl = checkRateLimit(jid);
      if (!rl.ok) {
        await sendReaction(sock, msg, "⏳");
        await sock.sendMessage(jid, { text: `⏳ Limite 200/h atingido. Tente em ${Math.ceil(rl.resetMs / 60000)} min.` }, { quoted: msg });
        break;
      }
      await sendReaction(sock, msg, "🤔");
      try {
        const { text: answer } = await askBansos(prompt);
        await sock.sendMessage(jid, { text: answer }, { quoted: msg });
        await sendReaction(sock, msg, "✅");
      } catch (error) {
        const rawErr = error instanceof Error ? error.message : String(error);
        commandLogger.error({ type: "ai_event", action: "ask_failed", jid, error: rawErr }, "ask failed");
        // mensagens de bansos.ts já são seguras (sem raw/reasoning). "Resposta truncada" agora é neutra, sem culpar user.
        const isKnown = rawErr.startsWith("IA ") || rawErr.startsWith("Resposta ");
        const userMsg = isKnown ? rawErr : "Não consegui gerar resposta. Tente novamente.";
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(jid, { text: `⚠️ ${userMsg}` }, { quoted: msg });
      }
      break;
    }
    case "ialist": {
      if (!(await requireOwner(sock, msg, jid))) break;
      const curAsk = getAskModel();
      const curVision = getVisionModel();
      const lines = BANSOS_ALIVE_18.map((m, i) => {
        const cur = m.id === curAsk ? " ★ ask" : m.id === curVision ? " ★ vision" : "";
        const v = m.vision ? "👁️" : "  ";
        const r = m.reasoning ? "🧠" : "  ";
        return `${String(i + 1).padStart(2, " ")}. ${v}${r} ${m.id}${cur} — ${m.note}`;
      });
      const txt = `📋 *Modelos disponíveis*\n\n${lines.join("\n")}\n\n★ atual • 👁️ vision • 🧠 reasoning`;
      await sock.sendMessage(jid, { text: txt }, { quoted: msg });
      await sendReaction(sock, msg, "📋");
      break;
    }
    case "aitokens": {
      if (!(await requireOwner(sock, msg, jid))) break;
      const args = parts.slice(1);
      const curAsk = getAskTokens();
      const curVision = getVisionTokens();
      if (args.length === 0) {
        await sock.sendMessage(
          jid,
          { text: `🤖 *Tokens atuais*\n• ask: \`${curAsk}\`\n• vision: \`${curVision}\`\n\nUse: !aitokens <n> → ask\n!aitokens vision <n> → vision\n!aitokens reset` },
          { quoted: msg },
        );
        break;
      }
      if (args[0] === "reset") {
        deleteAiConfig("ask_tokens");
        deleteAiConfig("vision_tokens");
        await sock.sendMessage(jid, { text: `✅ Resetado\n• ask: \`${ASK_MAX_TOKENS}\`\n• vision: \`${VISION_MAX_TOKENS}\`` }, { quoted: msg });
        await sendReaction(sock, msg, "✅");
        break;
      }
      let target: number;
      if (args[0] === "vision") {
        const v = args[1]?.trim();
        if (!v) {
          await sock.sendMessage(jid, { text: "Uso: !aitokens vision <n>\nEx: !aitokens vision 3000" }, { quoted: msg });
          break;
        }
        target = Number.parseInt(v, 10);
        if (!Number.isFinite(target) || target < 100 || target > 8000) {
          await sendReaction(sock, msg, "❌");
          await sock.sendMessage(jid, { text: `❌ vision: 100-8000` }, { quoted: msg });
          break;
        }
        setAiConfig("vision_tokens", String(target));
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(jid, { text: `✅ vision tokens → \`${target}\`` }, { quoted: msg });
      } else {
        const v = args[0]!.trim();
        target = Number.parseInt(v, 10);
        if (!Number.isFinite(target) || target < 10 || target > 4000) {
          await sendReaction(sock, msg, "❌");
          await sock.sendMessage(jid, { text: `❌ ask: 10-4000` }, { quoted: msg });
          break;
        }
        setAiConfig("ask_tokens", String(target));
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(jid, { text: `✅ ask tokens → \`${target}\`` }, { quoted: msg });
      }
      break;
    }
    case "iamodel": {
      if (!(await requireOwner(sock, msg, jid))) break;
      const args = parts.slice(1);
      const curAsk = getAskModel();
      const curVision = getVisionModel();
      if (args.length === 0) {
        await sock.sendMessage(
          jid,
          { text: `🤖 *Modelos atuais*\n• ask: \`${curAsk}\`\n• vision: \`${curVision}\`\n\nUse: !ialist pra ver os 18\n!iamodel <id> → ask\n!iamodel vision <id> → vision\n!iamodel reset` },
          { quoted: msg },
        );
        break;
      }
      if (args[0] === "reset") {
        deleteAiConfig("ask_model");
        deleteAiConfig("vision_model");
        await sock.sendMessage(jid, { text: `✅ Resetado\n• ask: \`${ASK_MODEL}\`\n• vision: \`${VISION_MODEL}\`` }, { quoted: msg });
        await sendReaction(sock, msg, "✅");
        break;
      }
      let targetId: string;
      let isVision = false;
      if (args[0] === "vision") {
        isVision = true;
        targetId = args[1]?.trim() ?? "";
        if (!targetId) {
          await sock.sendMessage(jid, { text: "Uso: !iamodel vision <id>\nEx: !iamodel vision muse-spark-1.2-contributor-free" }, { quoted: msg });
          break;
        }
      } else {
        targetId = args[0]!.trim();
      }
      const found = BANSOS_ALIVE_18.find((m) => m.id === targetId);
      if (!found) {
        await sendReaction(sock, msg, "❌");
        await sock.sendMessage(jid, { text: `❌ \`${targetId}\` não está entre os modelos disponíveis. Use !ialist` }, { quoted: msg });
        break;
      }
      if (isVision && !found.vision) {
        await sendReaction(sock, msg, "❌");
        await sock.sendMessage(jid, { text: `❌ \`${targetId}\` não suporta imagem (sem 👁️). Escolha um com 👁️ no !ialist` }, { quoted: msg });
        break;
      }
      if (isVision) {
        setAiConfig("vision_model", targetId);
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(jid, { text: `✅ vision → \`${targetId}\`` }, { quoted: msg });
      } else {
        setAiConfig("ask_model", targetId);
        await sendReaction(sock, msg, "✅");
        await sock.sendMessage(jid, { text: `✅ ask → \`${targetId}\`` }, { quoted: msg });
      }
      break;
    }
    case "vision": {
      // prompt obedecendo o comando: "!vision transcreva" ou "!vision descreva a roupa" ou só "!vision" (usa default)
      const prompt = parts.slice(1).join(" ").trim() || VISION_PROMPT_DEFAULT;
      // pega imagem: direta no msg atual ou quoted (reply)
      const directImg = (msg.message?.imageMessage ?? null) as proto.Message.IImageMessage | null;
      const quotedImg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ?? null;
      const imageMessage = directImg ?? quotedImg;
      if (!imageMessage) {
        await sendReaction(sock, msg, "❓");
        await sock.sendMessage(
          jid,
          { text: "Uso: !vision [prompt]\nEnvie uma imagem com legenda !vision <prompt> ou responda uma imagem com !vision <prompt>\nEx: !vision transcreva o texto da imagem" },
          { quoted: msg },
        );
        break;
      }
      const rl = checkRateLimit(jid);
      if (!rl.ok) {
        await sendReaction(sock, msg, "⏳");
        await sock.sendMessage(jid, { text: `⏳ Limite 200/h atingido. Tente em ${Math.ceil(rl.resetMs / 60000)} min.` }, { quoted: msg });
        break;
      }
      await sendReaction(sock, msg, "👁️");
      try {
        const stream = await downloadContentFromMessage(imageMessage, "image");
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        const buf = Buffer.concat(chunks);
        const mime = (imageMessage.mimetype ?? "image/jpeg") as string;
        const b64 = buf.toString("base64");
        commandLogger.info({ type: "ai_event", action: "vision_start", jid, prompt: prompt.slice(0, 120), imageSize: buf.length, mime }, "vision start");
        const { text: answer } = await visionBansos(b64, mime, prompt);
        await sock.sendMessage(jid, { text: answer }, { quoted: msg });
        await sendReaction(sock, msg, "✅");
      } catch (error) {
        const rawErr = error instanceof Error ? error.message : String(error);
        commandLogger.error({ type: "ai_event", action: "vision_failed", jid, error: rawErr }, "vision failed");
        const userMsg = rawErr.startsWith("Visão ") || rawErr.startsWith("IA ") ? rawErr : "Não consegui analisar a imagem. Tente novamente.";
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(jid, { text: `⚠️ ${userMsg}` }, { quoted: msg });
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
    case "reveal":
    case "revelar": {
      if (!(await requireOwner(sock, msg, jid))) break;
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const quoted = ctx?.quotedMessage;
      if (!quoted) {
        await sendReaction(sock, msg, "❓");
        await sock.sendMessage(jid, { text: "👁️ Responda a uma mídia de visualização única." }, { quoted: msg });
        break;
      }
      const { image, video, audio } = extractViewOnce(quoted);
      const mediaEntry = image ?? video ?? audio;
      const mediaType = image ? "image" : video ? "video" : audio ? "audio" : null;
      if (!mediaEntry || !mediaType) {
        await sendReaction(sock, msg, "❓");
        await sock.sendMessage(jid, { text: "Nenhuma mídia de visualização única encontrada." }, { quoted: msg });
        break;
      }
      try {
        await sendRevealedMedia(sock, jid, msg, mediaType, mediaEntry, "\n\n👁️ *REVELADO*");
        await sendReaction(sock, msg, "✅");
      } catch (error) {
        commandLogger.error(
          { type: "media_event", action: "reveal_failed", jid, error: error instanceof Error ? error.message : String(error) },
          "reveal failed",
        );
        await sendReaction(sock, msg, "⚠️");
        await sock.sendMessage(jid, { text: "⚠️ Erro ao revelar a mídia." }, { quoted: msg });
      }
      break;
    }
    default:
      break;
  }
}
