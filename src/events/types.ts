export type BotEvent =
    | {
        type: 'MessageReceived'
        text: string
        jid: string
        sender: string
        isGroup: boolean
    }
