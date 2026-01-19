import P from 'pino'

const logger = P({ level: 'info' })

export function logCommand(event: {
    command: string
    jid: string
    isGroup: boolean
    sender: string
}) {
    logger.info(
        {
            command: event.command,
            jid: event.jid,
            isGroup: event.isGroup,
            sender: event.sender,
        },
        'command received'
    )
}
