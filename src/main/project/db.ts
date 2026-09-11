/**
 * The recents index and a two-column key/value table, in SQLite.
 *
 * Everything here is disposable. `better-sqlite3` is a native module, which means a tree that
 * was not rebuilt against this Electron's ABI throws on `require` — so the whole thing is
 * behind a failed-open: no database, no recents, an app that still edits video. Nothing in
 * bay may become unavailable because a convenience index would not load.
 */

import { createRequire } from 'node:module'
import type DatabaseConstructor from 'better-sqlite3'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import type { RecentProject } from '@shared/ipc'

export interface AppDatabase {
  rememberRecent(entry: Omit<RecentProject, 'poster'> & { poster?: string }): void
  forgetRecent(filePath: string): void
  listRecent(limit: number): RecentProject[]
  getState(key: string): string | null
  setState(key: string, value: string): void
  close(): void
}

interface RecentRow {
  file_path: string
  id: string
  name: string
  updated_at: number
  poster: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recent_projects (
  file_path  TEXT PRIMARY KEY,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  poster     TEXT
);
CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export function openDatabase(path: string): AppDatabase | null {
  let handle: SqliteDatabase
  try {
    const require_ = createRequire(import.meta.url)
    const Database = require_('better-sqlite3') as typeof DatabaseConstructor
    handle = new Database(path)
    // WAL keeps a reader from blocking the autosave writer; the recents list is read on
    // every launch and written on every save.
    handle.pragma('journal_mode = WAL')
    handle.exec(SCHEMA)
  } catch {
    return null
  }

  const insertRecent = handle.prepare(
    `INSERT INTO recent_projects (file_path, id, name, updated_at, poster)
     VALUES (@file_path, @id, @name, @updated_at, @poster)
     ON CONFLICT(file_path) DO UPDATE SET
       id = excluded.id,
       name = excluded.name,
       updated_at = excluded.updated_at,
       poster = COALESCE(excluded.poster, recent_projects.poster)`
  )
  const deleteRecent = handle.prepare('DELETE FROM recent_projects WHERE file_path = ?')
  const selectRecent = handle.prepare(
    'SELECT file_path, id, name, updated_at, poster FROM recent_projects ORDER BY updated_at DESC LIMIT ?'
  )
  const selectState = handle.prepare('SELECT value FROM app_state WHERE key = ?')
  const upsertState = handle.prepare(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )

  return {
    rememberRecent(entry) {
      insertRecent.run({
        file_path: entry.filePath,
        id: entry.id,
        name: entry.name,
        updated_at: entry.updatedAt,
        poster: entry.poster ?? null
      })
    },
    forgetRecent(filePath) {
      deleteRecent.run(filePath)
    },
    listRecent(limit) {
      const rows = selectRecent.all(limit) as RecentRow[]
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        filePath: row.file_path,
        updatedAt: row.updated_at,
        ...(row.poster ? { poster: row.poster } : {})
      }))
    },
    getState(key) {
      const row = selectState.get(key) as { value: string } | undefined
      return row?.value ?? null
    },
    setState(key, value) {
      upsertState.run(key, value)
    },
    close() {
      try {
        handle.close()
      } catch {
        // Closing a database that already failed is not worth a second error.
      }
    }
  }
}
