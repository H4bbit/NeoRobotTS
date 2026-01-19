import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const dbPath = './data/commands.sqlite'
const dbDir = path.dirname(dbPath)
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

const db = new Database(dbPath)

// Tables: active groups
db.exec(`
CREATE TABLE IF NOT EXISTS active_groups (
  jid TEXT PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 0
);
`)

type ActiveGroupRow = { is_active: number }

export function isGroupActive(jid: string): boolean {
    const row = db
        .prepare('SELECT is_active FROM active_groups WHERE jid = ?')
        .get(jid) as ActiveGroupRow | undefined

    // default: inactive (false) unless explicitly enabled
    return !!(row && row.is_active === 1)
}

export function setGroupActive(jid: string, active: boolean): void {
    db.prepare('INSERT OR REPLACE INTO active_groups (jid, is_active) VALUES (?, ?)')
        .run(jid, active ? 1 : 0)
}

export function removeGroup(jid: string): void {
    db.prepare('DELETE FROM active_groups WHERE jid = ?').run(jid)
}
