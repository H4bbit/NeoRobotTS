import { type WASocket } from "baileys";
import { type BotEvent } from "../events/types.js";
import { logCommand } from "../events/logger.js";
import { isGroupActive, setGroupActive } from "./db.js";
import { getJidType } from "../utils/jid.js";
import { getMessageText } from "../messages/text.js";
import {
    StickerConversionError,
    animatedWebpToVideo,
    downloadStickerMedia,
    getStickerDuration,
    getStickerMedia,
    getWebpStickerMedia,
    imageToSticker,
    videoToSticker,
    webpToImage,
} from "../utils/sticker.js";
import { sendReaction } from "../messages/react.js";
import { commandLogger } from "../utils/logger.js";
import { debugMessageContext, getTargetJid, isBotAdmin, isParticipantAdmin } from "../utils/admin.js";

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
            await sock.sendMessage(jid, {
                text: "Pong 🏓",
            },
                {
                    quoted: msg,
                }
            );
            break;
        }

        case "boton": {
            if (jidType === "group") {
                setGroupActive(jid, true);
                await sendReaction(sock, msg, "✅");
                await sock.sendMessage(jid, {
                    text: "✅ Bot ativado neste grupo",
                },
                    {
                        quoted: msg,
                    }
                );
            }
            break;
        }

        case "botoff": {
            if (jidType === "group") {
                setGroupActive(jid, false);
                await sendReaction(sock, msg, "❌");
                await sock.sendMessage(jid, {
                    text: "❌ Bot desativado neste grupo",
                },
                    {
                        quoted: msg,
                    }
                );
            }
            break;
        }
        case "tovideo": {
            const media = getWebpStickerMedia(msg);

            if (!media) {
                await sendReaction(sock, msg, "❓");
                await sock.sendMessage(jid, {
                    text: "Marque ou responda um sticker.",
                },
                    {
                        quoted: msg,
                    }
                );
                break;
            }

            try {
                const input = await downloadStickerMedia(media);
                commandLogger.info({ type: "command_event", command: "tovideo", jid, stage: "downloaded", inputSize: input.length }, "tovideo downloaded");
                const video = await animatedWebpToVideo(input);

                await sock.sendMessage(jid, {
                    video,
                    mimetype: "video/mp4",
                },
                    {
                        quoted: msg,
                    },
                );
                await sendReaction(sock, msg, "✅");
                commandLogger.info({ type: "command_event", command: "tovideo", jid, outputSize: video.length }, "tovideo succeeded");
            } catch (error) {
                const text = error instanceof StickerConversionError
                    ? error.message
                    : "Não foi possível converter o sticker em vídeo.";

                await sendReaction(sock, msg, "⚠️");
                await sock.sendMessage(jid, {
                    text,
                },
                    {
                        quoted: msg,
                    },
                );
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
                commandLogger.info({ type: "command_event", command: "toimg", jid, stage: "downloaded", inputSize: input.length }, "toimg downloaded");
                const image = await webpToImage(input);
                await sock.sendMessage(jid, { image, mimetype: "image/png" }, { quoted: msg });
                await sendReaction(sock, msg, "✅");
                commandLogger.info({ type: "command_event", command: "toimg", jid, outputSize: image.length }, "toimg succeeded");
            } catch (error) {
                const text = error instanceof StickerConversionError ? error.message : "Não foi possível converter o sticker em imagem.";
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
                await sock.sendMessage(jid, {
                    text: "Marque ou responda uma imagem ou vídeo.",
                },
                    {
                        quoted: msg,
                    }
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
            commandLogger.info({ type: "command_event", command: "sticker", jid, mediaType: media.type, inputSize: input.length }, "sticker downloaded");
            const sticker =
                media.type === "image"
                    ? await imageToSticker(input, sender)
                    : await videoToSticker(input, sender);

            await sock.sendMessage(jid, {
                sticker,
            },
                {
                    quoted: msg,
                },
            );
            await sendReaction(sock, msg, "✅");
            break;
        }
        case "ban":
        case "kick": {
            if (jidType !== "group") {
                await sendReaction(sock, msg, "❓");
                await sock.sendMessage(jid, { text: "Este comando só funciona em grupos." }, { quoted: msg });
                break;
            }
            const senderJid = msg.key.participant ?? msg.key.remoteJid!;
            const targetJid = getTargetJid(msg);
            commandLogger.info({ type: "admin_event", action: "ban_attempt", jid, senderJid, targetJid, debug: debugMessageContext(msg) }, "ban attempt");
            if (!targetJid) {
                await sendReaction(sock, msg, "❓");
                await sock.sendMessage(jid, { text: "Marque ou responda alguém para banir. Ex: !ban @usuario" }, { quoted: msg });
                commandLogger.info({ type: "admin_event", action: "ban_no_target", jid, senderJid }, "ban no target");
                break;
            }
            if (!await isParticipantAdmin(sock, jid, senderJid)) {
                await sendReaction(sock, msg, "❌");
                await sock.sendMessage(jid, { text: "❌ Você precisa ser admin para usar este comando." }, { quoted: msg });
                commandLogger.info({ type: "admin_event", action: "ban_sender_not_admin", jid, senderJid }, "ban sender not admin");
                break;
            }
            if (!await isBotAdmin(sock, jid)) {
                await sendReaction(sock, msg, "❌");
                await sock.sendMessage(jid, { text: "❌ Eu preciso ser admin para banir." }, { quoted: msg });
                commandLogger.info({ type: "admin_event", action: "ban_bot_not_admin", jid }, "ban bot not admin");
                break;
            }
            try {
                await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                await sendReaction(sock, msg, "✅");
                commandLogger.info({ type: "admin_event", action: "ban", jid, targetJid, senderJid }, "ban succeeded");
            } catch (error) {
                commandLogger.error({ type: "admin_event", action: "ban_failed", jid, targetJid, error }, "ban failed");
                await sendReaction(sock, msg, "⚠️");
                await sock.sendMessage(jid, { text: "Não foi possível banir." }, { quoted: msg });
            }
            break;
        }
        default:
            break;
    }
}
