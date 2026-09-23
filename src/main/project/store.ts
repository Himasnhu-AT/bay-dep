/**
 * The project store: dialogs, the recents index, and the allowlist side of opening a file.
 *
 * Everything about the files themselves is in `persistence.ts`, which imports no Electron and
 * is tested directly. What is left here is the part that genuinely needs an app.
 */

import { BrowserWindow, dialog, shell } from 'electron'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { posterFor, uniqueProjectName } from './library'
import { thumbnailFile } from '../media/thumbnails'
import type { RecentProject } from '@shared/ipc'
import type { Project } from '@shared/project'
import { appDbPath, autosaveDir, projectsDir } from '../paths'
import {
  WINDOW_BOUNDS_KEY,
  parseBounds,
  serialiseBounds,
  type Bounds
} from '../window-state'
import { allowPaths } from '../protocol'
import { adoptAssets } from '../media/import'
import { describeStorage, openDatabase, type AppDatabase } from './db'
import {
  EXTENSION,
  freshProject,
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

// ---------------------------------------------------------------------------
// Window bounds
// ---------------------------------------------------------------------------

export function readWindowBounds(): Bounds | null {
  return parseBounds(database()?.getState(WINDOW_BOUNDS_KEY) ?? null)
}

export function writeWindowBounds(bounds: Bounds): void {
  database()?.setState(WINDOW_BOUNDS_KEY, serialiseBounds(bounds))
}

// ---------------------------------------------------------------------------
// A document handed to us before there was anywhere to put it
// ---------------------------------------------------------------------------

/**
 * macOS fires `open-file` before `ready` on a cold launch, so the path arrives before any
 * window exists. It is held here and claimed by `initial()`, which is the first thing the
 * renderer asks for — so a double-clicked project opens that project rather than the last one.
 *
 * In memory rather than in `app_state` on purpose: this is a fact about *this launch*, and
 * persisting it would reopen the document on every subsequent launch too.
 */
let pendingOpenPath: string | null = null

export function rememberOpenPath(path: string): void {
  pendingOpenPath = path
}

/** Reads and clears. Claiming it twice would reopen the document on the next window. */
export function takePendingOpen(): string | null {
  const path = pendingOpenPath
  pendingOpenPath = null
  return path
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
  // The thumbnail follows, off the critical path: reading a poster must never slow a save or an
  // open, and a project with no readable poster is still a project in the list. The row is
  // written again with the poster; `COALESCE` in the upsert keeps an older one if this finds
  // none.
  const filePath = project.filePath
  void posterFor(project, (path) => readFile(path), async (asset) =>
    asset.path && (asset.kind === 'video' || asset.kind === 'image')
      ? thumbnailFile({
          assetId: asset.id,
          path: asset.path,
          // A second in, or the middle of anything shorter: frame zero is black too often.
          atUs: Math.min(1_000_000, Math.round(asset.durationUs / 2)),
          size: 480
        })
      : null
  ).then((poster) => {
    if (!poster) return
    database()?.rememberRecent({
      filePath,
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      poster
    })
  })
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

export async function launchRequest(): Promise<Project | null> {
  const requested = takePendingOpen()
  if (!requested) return null
  try {
    return await openPath(requested)
  } catch {
    // A .bay that will not open falls back to the projects screen, where the user can pick
    // another — never to an error screen at launch.
    return null
  }
}

export async function create(): Promise<Project> {
  const dir = projectsDir()
  const taken = (await readdir(dir).catch(() => [] as string[]))
    .filter((name) => name.toLowerCase().endsWith(`.${EXTENSION}`))
    .map((name) => name.slice(0, -(EXTENSION.length + 1)))
  const name = uniqueProjectName(taken)
  const fresh: Project = { ...freshProject(), name }
  return admitAssets(await persist(fresh, join(dir, `${name}.${EXTENSION}`)))
}

export function forget(filePath: string): void {
  database()?.forgetRecent(filePath)
}

export function reveal(filePath: string): void {
  shell.showItemInFolder(filePath)
}

export async function initial(): Promise<Project> {
  // A document double-clicked in Finder outranks the last-opened project: the user named
  // which file they wanted by launching it.
  const requested = takePendingOpen()
  if (requested) {
    try {
      return await openPath(requested)
    } catch {
      // A .bay that will not open must not strand the launch on an error screen; fall
      // through to the normal path and the user gets their last project or an empty one.
    }
  }
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
