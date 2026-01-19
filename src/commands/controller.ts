import { type WASocket } from 'baileys'
import { type BotEvent } from '../events/types.js'

export async function commandController(
  sock: WASocket,
  event: BotEvent & { type: 'MessageReceived' }
) {
  if (!event.text.startsWith('!')) return

  const [command, ...args] = event.text
    .slice(1)
    .trim()
    .split(/\s+/)

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
