import { type WASocket } from 'baileys'
import { type BotEvent } from '../events/types.js'
import { logCommand } from '../events/logger.js'

export async function commandController(
    sock: WASocket,
    event: BotEvent & { type: 'MessageReceived' }
) {
    const isCommand = event.text.startsWith('!')
    if (!isCommand) return

    const parts = event.text
        .slice(1)
        .trim()
        .split(/\s+/)
    const command = parts[0]

    if (!command) return

    logCommand({
        command,
        jid: event.jid,
        isGroup: event.isGroup,
        sender: event.sender,
    })
    switch (command) {
        case 'ping': {
            await sock.sendMessage(event.jid, {
                text: 'Pong 🏓',
            })
            break
        }

        /*
        case 'ban': {
          await banUser(sock, event, args)
          break
        }
        */

        default:
            // comando desconhecido → ignora
            break
    }
}
