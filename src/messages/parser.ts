import { proto } from 'baileys'
import { type ParsedMessage } from './types.js'

export function parseMessage(
    msg: proto.IWebMessageInfo
): ParsedMessage | null {
    if (!msg.message) return null
    if (!msg.key?.remoteJid) return null

    const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption

    if (!text) return null

    return {
        jid: msg.key.remoteJid,
        sender: msg.pushName ?? 'Desconhecido',
        text: text.trim(),
        isGroup: msg.key.remoteJid.endsWith('@g.us'),
        raw: msg,
    }
}
