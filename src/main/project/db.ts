/**
 * The recents index and a two-column key/value table.
 *
 * On `node:sqlite`, deliberately, after `better-sqlite3` turned out to be unloadable in the
 * shipped app. pnpm builds that native module against the local Node (module version 137);
 * Electron 40 needs 143, so `require` threw every single time the real app started — while
 * passing under `pnpm test`, which runs on plain Node. The tests were green over a subsystem
 * that had never once worked. `node:sqlite` is the same module in both, so the tests now
 * exercise what ships, and there is no ABI to keep in step, no rebuild step, and nothing to
 * un-asar.
 *
 * Everything here is still disposable — if `app.db` is deleted, nothing is lost but the list.
 * What is *not* acceptable is losing it silently, which is the other half of what went wrong:
 * a bare `catch { return null }` turned a subsystem that could never load into a feature that
 * merely looked empty. A failure is returned as a reason now, and the caller reports it.
 */

import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { RecentProject } from '@shared/ipc'

export interface AppDatabase {
  rememberRecent(entry: Omit<RecentProject, 'poster'> & { poster?: string }): void
  forgetRecent(filePath: string): void
  listRecent(limit: number): RecentProject[]
  getState(key: string): string | null
  setState(key: string, value: string): void
  close(): void
}

/**
 * `error` is non-null exactly when `db` is null. Returning the reason rather than swallowing
 * it is the point: the caller has to decide what to say, and cannot accidentally say nothing.
 */
export interface OpenResult {
  db: AppDatabase | null
  error: string | null
}

export interface StorageReport {
  ready: boolean
  error: string | null
  /** What to print, or null when there is nothing to say. Never an empty string. */
  message: string | null
}

/**
 * Turns an open result into what the user and the log should be told.
 *
 * Separate from `openDatabase` and from the reporting itself so the property the failure
 * needs — that it *says something* — is assertable. The previous design had no such property
 * to assert: a failure and an empty database were the same value, and the app spent every
 * build it has ever had in that state without a line of output anywhere.
 */
export function describeStorage(result: OpenResult): StorageReport {
  if (result.error === null) return { ready: true, error: null, message: null }
  return {
    ready: false,
    error: result.error,
    message:
      `The project database could not be opened, so recent projects and reopening the last ` +
      `project are unavailable for this session. Editing and saving are unaffected. ` +
      `Reason: ${result.error}`
  }
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

/** Rows arrive with a null prototype; this copies out only the columns, as plain values. */
function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function integer(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

export function openDatabase(path: string): OpenResult {
  let handle: DatabaseSync
  try {
    handle = new DatabaseSync(path)
    // WAL keeps a reader from blocking the autosave writer; the recents list is read on
    // every launch and written on every save.
    handle.exec('PRAGMA journal_mode = WAL')
    handle.exec(SCHEMA)
  } catch (error) {
    return { db: null, error: error instanceof Error ? error.message : String(error) }
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

  const db: AppDatabase = {
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
      return selectRecent.all(limit).map((row) => {
        const poster = text(row['poster'])
        return {
          id: text(row['id']) ?? '',
          name: text(row['name']) ?? '',
          filePath: text(row['file_path']) ?? '',
          updatedAt: integer(row['updated_at']),
          ...(poster ? { poster } : {})
        }
      })
    },
    getState(key) {
      const row = selectState.get(key)
      return row ? text(row['value']) : null
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

  return { db, error: null }
}

export interface RepairResult {
  /** The database opens now. */
  ok: boolean
  /** Why it still does not, when `ok` is false. */
  error: string | null
  /** What was in the way, and where it went: set aside beside the database, never deleted. */
  movedAside: { from: string; to: string }[]
  /** Rows read back out of the old database and written into the new one. */
  recovered: { recents: number; state: number }
}

/**
 * Makes the project database open again without throwing anything away.
 *
 * What the database holds is the recents list and a few remembered values — never a project:
 * projects are `.bay` files and are not touched. So a repair can afford to start a fresh file,
 * but it does so conservatively: whatever the old file still yields is read out first, the old
 * file (and its `-wal`/`-shm`, or a directory sitting at its name) is renamed aside with a
 * timestamp rather than deleted, and the recovered rows are written into the new one. Anything
 * the old file would not give up is still on disk under the aside name.
 *
 * Returns the fresh handle alongside the report, so the caller installs exactly what it tested.
 */
export function repairDatabase(path: string, now: number = Date.now()): { result: RepairResult; open: OpenResult } {
  const recents: Record<string, unknown>[] = []
  const state: Record<string, unknown>[] = []
  if (existsSync(path) && statSync(path).isFile()) {
    try {
      const old = new DatabaseSync(path, { readOnly: true })
      try {
        for (const row of old.prepare('SELECT file_path, id, name, updated_at, poster FROM recent_projects').all()) recents.push(row)
      } catch {
        // A damaged table yields nothing; the file itself is kept aside below.
      }
      try {
        for (const row of old.prepare('SELECT key, value FROM app_state').all()) state.push(row)
      } catch {
        // As above.
      }
      old.close()
    } catch {
      // Not readable at all: nothing to recover here, and the file is still kept aside.
    }
  }

  const movedAside: { from: string; to: string }[] = []
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  try {
    mkdirSync(dirname(path), { recursive: true })
    for (const suffix of ['', '-wal', '-shm']) {
      const from = path + suffix
      if (!existsSync(from)) continue
      const to = `${path}.broken-${stamp}${suffix}`
      renameSync(from, to)
      movedAside.push({ from, to })
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      result: { ok: false, error: `Could not set the old database aside: ${reason}`, movedAside, recovered: { recents: 0, state: 0 } },
      open: { db: null, error: reason }
    }
  }

  const open = openDatabase(path)
  if (!open.db) {
    return { result: { ok: false, error: open.error, movedAside, recovered: { recents: 0, state: 0 } }, open }
  }
  let recoveredRecents = 0
  for (const row of recents) {
    const filePath = text(row['file_path'])
    const id = text(row['id'])
    if (!filePath || !id) continue
    const poster = text(row['poster'])
    open.db.rememberRecent({ filePath, id, name: text(row['name']) ?? '', updatedAt: integer(row['updated_at']), ...(poster ? { poster } : {}) })
    recoveredRecents++
  }
  let recoveredState = 0
  for (const row of state) {
    const key = text(row['key'])
    const value = text(row['value'])
    if (key === null || value === null) continue
    open.db.setState(key, value)
    recoveredState++
  }
  return { result: { ok: true, error: null, movedAside, recovered: { recents: recoveredRecents, state: recoveredState } }, open }
}
