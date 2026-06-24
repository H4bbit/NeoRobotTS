import { type WASocket } from 'baileys'
import { type BotEvent } from '../events/types.js'
import { logCommand } from '../events/logger.js'
import { isGroupActive, setGroupActive } from './db.js'
import { getJidType } from '../utils/jid.js'

export async function commandController(
    sock: WASocket,
    event: BotEvent & { type: 'MessageReceived' }
) {
    const isCommand = event.text.startsWith('!')
    if (!isCommand) return

    const parts = event.text.slice(1).trim().split(/\s+/)
    const command = parts[0]

    if (!command) return

    logCommand({
        command,
        jid: event.jid,
        isGroup: event.isGroup,
        sender: event.sender,
    })

    const isActivationCommand = command === 'boton' || command === 'botoff'

    const jidType = getJidType(event.jid)

    // aplica regra apenas para grupos reais
    if (jidType === 'group') {
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
            if (jidType === 'group') {
                setGroupActive(event.jid, true)
                await sock.sendMessage(event.jid, {
                    text: '✅ Bot ativado neste grupo',
                })
            }
            break
        }

        case 'botoff': {
            if (jidType === 'group') {
                setGroupActive(event.jid, false)
                await sock.sendMessage(event.jid, {
                    text: '❌ Bot desativado neste grupo',
                })
            }
            break
        }

        default:
            break
    }
}
