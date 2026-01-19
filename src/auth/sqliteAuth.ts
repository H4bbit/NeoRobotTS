import Database from 'better-sqlite3'
import {
    type AuthenticationCreds,
    type AuthenticationState,
    BufferJSON,
    initAuthCreds,
    type SignalDataSet,
    type SignalDataTypeMap,
} from 'baileys'

import fs from 'node:fs'
import path from 'node:path'

export async function useSQLiteAuthState(
    dbPath: string
): Promise<{
    state: AuthenticationState
    saveCreds: () => Promise<void>
}> {
    const dir = path.dirname(dbPath)

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }

    const db = new Database(dbPath)

    db.exec(`
        CREATE TABLE IF NOT EXISTS auth (
            id TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `)

    const getStmt = db.prepare('SELECT value FROM auth WHERE id = ?')
    const setStmt = db.prepare(
        'INSERT OR REPLACE INTO auth (id, value) VALUES (?, ?)'
    )
    const delStmt = db.prepare('DELETE FROM auth WHERE id = ?')

    const read = <T = unknown>(id: string): T | undefined => {
        const row = getStmt.get(id) as { value: string } | undefined
        return row
            ? JSON.parse(row.value, BufferJSON.reviver)
            : undefined
    }

    const write = (id: string, value: unknown) => {
        setStmt.run(id, JSON.stringify(value, BufferJSON.replacer))
    }

    const creds: AuthenticationCreds =
        read<AuthenticationCreds>('creds') ?? initAuthCreds()

    const state: AuthenticationState = {
        creds,
        keys: {
            get: async <T extends keyof SignalDataTypeMap>(
                type: T,
                ids: string[]
            ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
                const data = {} as { [id: string]: SignalDataTypeMap[T] }

                for (const id of ids) {
                    const value = read<SignalDataTypeMap[T]>(
                        `${type}-${id}`
                    )
                    if (value !== undefined) {
                        data[id] = value
                    }
                }

                return data
            },

            set: async (data: SignalDataSet): Promise<void> => {
                const trx = db.transaction(() => {
                    for (const category of Object.keys(
                        data
                    ) as (keyof SignalDataSet)[]) {
                        const categoryData = data[category]
                        if (!categoryData) continue

                        for (const id of Object.keys(categoryData)) {
                            const value = categoryData[id]
                            const key = `${category}-${id}`

                            if (value !== null && value !== undefined) {
                                write(key, value)
                            } else {
                                delStmt.run(key)
                            }
                        }
                    }
                })

                trx()
            },
        },
    }

    const saveCreds = async () => {
        write('creds', state.creds)
    }

    return { state, saveCreds }
}
