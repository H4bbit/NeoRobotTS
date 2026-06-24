export function getJidType(jid: string): 'group' | 'lid' | 'private' {
    if (jid.endsWith('@g.us')) return 'group'
    if (jid.endsWith('@lid')) return 'lid'
    return 'private'
}
