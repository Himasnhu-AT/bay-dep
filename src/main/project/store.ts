/**
 * The project store: dialogs, the recents index, and the allowlist side of opening a file.
 *
 * Everything about the files themselves is in `persistence.ts`, which imports no Electron and
 * is tested directly. What is left here is the part that genuinely needs an app.
 */

import { BrowserWindow, dialog } from 'electron'
import type { RecentProject } from '@shared/ipc'
import type { Project } from '@shared/project'
import { appDbPath, autosaveDir } from '../paths'
import { allowPaths } from '../protocol'
import { adoptAssets } from '../media/import'
import { describeStorage, openDatabase, type AppDatabase } from './db'
import {
  EXTENSION,
  LAST_PROJECT_KEY,
  autosavePathFor,
  exists,
  readProjectFile,
  resolveInitialProject,
  writeAtomic,
  writeProjectFile
} from './persistence'

export interface StorageStatus {
  ready: boolean
  /** Why the database is unavailable, or null when it is fine. Shown, never swallowed. */
  error: string | null
}

let handle: AppDatabase | null = null
let status: StorageStatus | null = null

/**
 * Opens the database once, and says so once if it cannot.
 *
 * The reporting is the point. The previous version returned null on failure with no output
 * anywhere, so a database that could never load presented as a recents list that happened to
 * be empty and a "last project" that was never remembered — a dead subsystem wearing the
 * appearance of a working one. It stays non-fatal: bay must open without it.
 */
function database(): AppDatabase | null {
  if (status !== null) return handle
  const result = openDatabase(appDbPath())
  const report = describeStorage(result)
  handle = result.db
  status = { ready: report.ready, error: report.error }
  // The one line that had to exist. A database that cannot open must say so; the previous
  // version returned null in silence, which is what let a dead subsystem pass for an empty one.
  if (report.message) console.error(`[bay] ${report.message}`)
  return handle
}

/** For the UI's degraded-state indicator, beside the ffmpeg warning. */
export function storageStatus(): StorageStatus {
  database()
  return status ?? { ready: false, error: 'The database was never opened.' }
}

export function closeStore(): void {
  handle?.close()
  handle = null
  status = null
}

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

function rememberRecent(project: Project): void {
  const db = database()
  if (!db || !project.filePath) return
  db.rememberRecent({
    filePath: project.filePath,
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt
  })
  db.setState(LAST_PROJECT_KEY, project.filePath)
}

export async function recent(): Promise<RecentProject[]> {
  const db = database()
  if (!db) return []
  const out: RecentProject[] = []
  for (const row of db.listRecent(20)) {
    // A recents list that offers files the user moved to the bin is worse than a short one.
    if (!(await exists(row.filePath))) {
      db.forgetRecent(row.filePath)
      continue
    }
    out.push(row)
  }
  return out
}

// ---------------------------------------------------------------------------
// Opening and saving
// ---------------------------------------------------------------------------

/**
 * Opening a project is the second door media comes through; without this its clips would
 * probe fine and then fail to play, because `bay://` would refuse every one of them.
 */
function admitAssets(project: Project): Project {
  adoptAssets(project.assets)
  allowPaths(project.assets.map((asset) => asset.path))
  return project
}

export async function initial(): Promise<Project> {
  return admitAssets(await resolveInitialProject(database()))
}

function dialogOptions(project: Project): Electron.SaveDialogOptions {
  const suggested = `${project.name || 'Untitled'}.${EXTENSION}`
  return {
    title: 'Save project',
    defaultPath: project.filePath ?? suggested,
    filters: [{ name: 'bay project', extensions: [EXTENSION] }]
  }
}

async function chooseSavePath(
  project: Project,
  window: BrowserWindow | null
): Promise<string | null> {
  const options = dialogOptions(project)
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

async function persist(project: Project, filePath: string): Promise<Project> {
  const written = await writeProjectFile(project, filePath)
  rememberRecent(written)
  allowPaths(written.assets.map((asset) => asset.path))
  return written
}

export async function save(
  project: Project,
  window: BrowserWindow | null
): Promise<{ filePath: string }> {
  const target = project.filePath ?? (await chooseSavePath(project, window))
  // `save` promises a path, so a cancelled first-save can only be reported as a rejection.
  // The renderer treats it as a no-op; inventing a path in userData would hide the user's
  // work somewhere they would never think to look.
  if (!target) throw new Error('Save cancelled.')
  const written = await persist(project, target)
  return { filePath: written.filePath! }
}

export async function saveAs(
  project: Project,
  window: BrowserWindow | null
): Promise<{ filePath: string } | null> {
  const target = await chooseSavePath(project, window)
  if (!target) return null
  const written = await persist(project, target)
  return { filePath: written.filePath! }
}

export async function open(window: BrowserWindow | null): Promise<Project | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'bay project', extensions: [EXTENSION] }]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  const first = result.filePaths[0]
  if (result.canceled || first === undefined) return null
  return openPath(first)
}

export async function openPath(filePath: string): Promise<Project> {
  const project = admitAssets(await readProjectFile(filePath))
  rememberRecent(project)
  return project
}

/**
 * Autosave writes a *sidecar*, never the project file. The whole point is that a crash during
 * an autosave cannot cost the user the last version they deliberately saved, and writing over
 * `project.bay` — atomically or not — gives up that guarantee for nothing.
 */
export async function autosave(project: Project): Promise<void> {
  const target = autosavePathFor(project, autosaveDir())
  await writeAtomic(target, JSON.stringify({ ...project, updatedAt: Date.now() }, null, 2))
}
