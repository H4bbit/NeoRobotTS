import { type WASocket } from 'baileys'
import { type BotEvent } from '../events/types.js'
import { logCommand } from '../events/logger.js'
import {isGroupActive, removeGroup, setGroupActive} from './db.js'

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

    const isActivationCommand = command === 'boton' || command === 'botoff'

    if (event.isGroup) {
        if (!isGroupActive(event.jid) && !isActivationCommand) return
    }
    switch (command) {
        case 'ping': {
            await sock.sendMessage(event.jid, {
                text: 'Pong 🏓',
            })
            break
        }
        case 'boton': {
            if (event.isGroup) {
                setGroupActive(event.jid, true)
                await sock.sendMessage(event.jid, {
                    text: '✅Bot ativado neste grupo'
                })
            }
            break
        }
        case 'botoff': {
            if (event.isGroup) {
                setGroupActive(event.jid, false)
                await sock.sendMessage(event.jid, {
                    text: '❌ Bot desativado neste grupo'
                })
            }
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
