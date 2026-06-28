import { type WASocket } from "baileys";
import { type BotEvent } from "../events/types.js";
import { logCommand } from "../events/logger.js";
import { isGroupActive, setGroupActive } from "./db.js";
import { getJidType } from "../utils/jid.js";
import { getMessageText } from "../messages/text.js";
import {
    downloadStickerMedia,
    getStickerDuration,
    getStickerMedia,
    imageToSticker,
    videoToSticker,
} from "../utils/sticker.js";
import { sendReaction } from "../messages/react.js";

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
        default:
            break;
    }
}
