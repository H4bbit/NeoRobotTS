import { proto } from 'baileys'

export type ParsedMessage = {
  jid: string
  sender: string
  text: string
  isGroup: boolean
  raw: proto.IWebMessageInfo
}
