import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
//import readline from 'readline'
import P from 'pino'

import makeWASocket, {
    type CacheStore,
    type WAMessageContent,
    type WAMessageKey,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    proto,
} from 'baileys'
import { useSQLiteAuthState } from './auth/sqliteAuth.js'
import { parseMessage } from './messages/parser.js'
import { dispatchEvent } from './events/dispatcher.js'

const logger = P({ level: 'silent' })
const msgRetryCounterCache = new NodeCache() as CacheStore
/*
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})

const question = (text: string) =>
    new Promise<string>((resolve) => rl.question(text, resolve))
*/
async function getMessage(
    key: WAMessageKey
): Promise<WAMessageContent | undefined> {
    // Placeholder para evitar erro de retry
    return proto.Message.fromObject({})
}


//const startSock = async () => {
//    const { state, saveCreds } = await useMultiFileAuthState(
//        'baileys_auth_info'
//    )
const startSock = async () => {
    const { state, saveCreds } = await useSQLiteAuthState(
        './data/auth/whatsapp.sqlite'
    )
    const { version } = await fetchLatestBaileysVersion()

    console.log(`\n🤖 Bot Iniciado (Baileys v${version.join('.')})`)

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        getMessage,
    })

    // 🔐 Pareamento por código
    if (!sock.authState.creds.registered) {
        console.log('\n⚠️  Aparelho não registrado.')
        setTimeout(async () => {
            /*
                                const phoneNumber = await question(
                                    'Digite o número do WhatsApp (ex: 5511999998888): '
                                )
                    */
            const phoneNumber = process.env.WHATSAPP_PHONE_NUMBER || ''
            try {
                const code = await sock.requestPairingCode(
                    phoneNumber.replace(/\D/g, '')
                )

                console.log(
                    `\n✅ CÓDIGO DE PAREAMENTO: ${code
                        ?.match(/.{1,4}/g)
                        ?.join('-')}`
                )

                console.log(
                    'Vá em: Aparelhos Conectados > Conectar com número de telefone\n'
                )
            } catch (err) {
                console.error(
                    'Erro ao gerar código. Verifique se o número está correto.',
                    err
                )
            }
        }, 3000)
    }

    sock.ev.process(async (events) => {
        // 💾 Persistir credenciais
        if (events['creds.update']) {
            await saveCreds()
        }

        // 🔌 Estado da conexão
        if (events['connection.update']) {
            const { connection, lastDisconnect } =
                events['connection.update']

            if (connection === 'close') {
                const shouldReconnect =
                    (lastDisconnect?.error as Boom)?.output?.statusCode !==
                    DisconnectReason.loggedOut

                if (shouldReconnect) {
                    startSock()
                }
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp conectado com sucesso!')
            }
        }

        // 📩 Mensagens recebidas
        if (events['messages.upsert']) {
            const { messages, type } = events['messages.upsert']

            if (type !== 'notify') return

            for (const msg of messages) {
                const parsed = parseMessage(msg)
                if (!parsed) continue

                await dispatchEvent(sock, {
                    type: 'MessageReceived',
                    text: parsed.text,
                    jid: parsed.jid,
                    sender: parsed.sender,
                    isGroup: parsed.isGroup,
                })
            }
        }
    })
}

startSock()
