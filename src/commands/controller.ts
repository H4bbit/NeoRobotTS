import { type WASocket } from "baileys";
import { type WAMessage } from "baileys";
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
      await sock.sendMessage(jid, {
        text: "Pong 🏓",
      });
      break;
    }

    case "boton": {
      if (jidType === "group") {
        setGroupActive(jid, true);
        await sock.sendMessage(jid, {
          text: "✅ Bot ativado neste grupo",
        });
      }
      break;
    }

    case "botoff": {
      if (jidType === "group") {
        setGroupActive(jid, false);
        await sock.sendMessage(jid, {
          text: "❌ Bot desativado neste grupo",
        });
      }
      break;
    }
    case "sticker":
    case "s": {
      const media = getStickerMedia(msg);

      if (!media) {
        await sock.sendMessage(jid, {
          text: "Marque ou responda uma imagem ou vídeo.",
        });
        break;
      }
      if (media.type === "video") {
        const seconds = getStickerDuration(msg);

        if (seconds !== null && seconds > 10) {
          await sock.sendMessage(
            jid,
            {
              text: "O vídeo deve ter no máximo 10 segundos.",
            },
            {
              quoted: msg as WAMessage,
            },
          );
          break;
        }
      }
      const input = await downloadStickerMedia(media);

      const sticker =
        media.type === "image"
          ? await imageToSticker(input)
          : await videoToSticker(input);

      console.log(sticker.length);
      await sock.sendMessage(jid, {
        sticker,
      });
      break;
    }
    default:
      break;
  }
}
