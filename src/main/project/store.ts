/**
 * The project store: dialogs, the recents index, and the allowlist side of opening a file.
 *
 * Everything about the files themselves is in `persistence.ts`, which imports no Electron and
 * is tested directly. What is left here is the part that genuinely needs an app.
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { readdir, readFile, rename as renameFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { canonicalRecents, copyName, displayFolder, fileStem, nameFromPath, projectStems, refuseUnlisted, renamedPath } from './manage'
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
import { adoptAssets } from '../media/import'
import { describeStorage, openDatabase, repairDatabase, type AppDatabase } from './db'
import { menuRecents, parseHidden, RECENT_MENU_HIDDEN_KEY, unhide } from './recent-menu'
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

export interface StorageRepair {
  ready: boolean
  error: string | null
  /** Where what was in the way went (renamed aside, never deleted). */
  movedAside: string[]
  /** Recent projects in the new database: carried over, plus any found in the projects folder. */
  recents: number
}

/**
 * Settings › Storage's and the projects screen's "Repair": makes the database open again with
 * nothing lost. The old file is set aside with what it still yields carried over
 * (`repairDatabase`), and every `.bay` in the projects folder is listed again, so a database
 * that yielded nothing still comes back with its recents. Projects themselves are files and are
 * never touched.
 */
export async function repairStorage(): Promise<StorageRepair> {
  handle?.close()
  handle = null
  const { result, open } = repairDatabase(appDbPath())
  handle = open.db
  status = { ready: result.ok, error: result.error }
  if (!result.ok) {
    console.error(`[bay] storage repair failed: ${result.error}`)
    return { ready: false, error: result.error, movedAside: result.movedAside.map((m) => m.to), recents: 0 }
  }
  console.log(`[bay] storage repaired: ${result.movedAside.length} set aside, ${result.recovered.recents} recent project(s) carried over`)
  const dir = projectsDir()
  let names: string[] = []
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.bay'))
  } catch {
    // No projects folder yet: nothing to list.
  }
  // Listing a project also marks it the last one opened; the recovered answer is the true one.
  const last = handle?.getState(LAST_PROJECT_KEY) ?? null
  for (const name of names) {
    try {
      rememberRecent(await readProjectFile(join(dir, name)))
    } catch {
      // A file that does not read as a project is not listed; it stays where it is.
    }
  }
  if (last) handle?.setState(LAST_PROJECT_KEY, last)
  recentsChanged()
  return { ready: true, error: null, movedAside: result.movedAside.map((m) => m.to), recents: handle?.listRecent(200).length ?? 0 }
}

const MCP_CLIENTS_KEY = 'mcpClients'

/**
 * Whether clients other than the in-app agent may drive bay over its MCP socket (a terminal
 * agent, another app). Off unless the user turned it on in Preferences › Agent; `BAY_MCP_CLIENTS=1`
 * turns it on for a run (the probes and `./run.sh` use it). Kept in main's database rather than
 * the renderer's storage because main opens the socket before any window exists. A database that
 * will not open reads as off — the safe answer for a door into the user's projects.
 */
export function mcpClientsEnabled(): boolean {
  if (process.env['BAY_MCP_CLIENTS'] === '1') return true
  return database()?.getState(MCP_CLIENTS_KEY) === '1'
}

export function setMcpClientsEnabled(on: boolean): void {
  database()?.setState(MCP_CLIENTS_KEY, on ? '1' : '0')
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

/**
 * Whoever shows the recents outside the renderer (File › Open Recent) is told when the list may
 * have changed: a project opened, saved, created, renamed, binned or taken off the list, or one
 * found gone from disk. The listener re-reads `recentForMenu`; it is not told what changed.
 */
const recentsListeners = new Set<() => void>()

export function onRecentsChanged(listener: () => void): () => void {
  recentsListeners.add(listener)
  return () => recentsListeners.delete(listener)
}

function recentsChanged(): void {
  for (const listener of recentsListeners) listener()
}

/** File › Open Recent's entries: the recents less the ones Clear Menu hid (`recent-menu.ts`). */
export async function recentForMenu(): Promise<RecentProject[]> {
  const rows = await recent()
  return menuRecents(rows, parseHidden(database()?.getState(RECENT_MENU_HIDDEN_KEY) ?? null))
}

/** Clear Menu: hides every listed project from the menu and the Dock; the projects screen keeps them. */
export async function clearRecentMenu(): Promise<void> {
  const db = database()
  const rows = await recent()
  db?.setState(RECENT_MENU_HIDDEN_KEY, JSON.stringify(rows.map((row) => row.filePath)))
  if (process.platform === 'darwin') app.clearRecentDocuments()
  recentsChanged()
}

/**
 * The one spelling of a file: `realpath`, or the path as given when it cannot be resolved (a file
 * not yet written). Recents are keyed by it, so one file reached through `/tmp` and `/private/tmp`,
 * or a symlinked folder, is one row.
 */
function canonicalPath(filePath: string): string {
  try {
    return realpathSync.native(filePath)
  } catch {
    return filePath
  }
}

function rememberRecent(given: Project): void {
  const db = database()
  if (!db || !given.filePath) return
  const filePath = canonicalPath(given.filePath)
  const project = { ...given, filePath }
  db.rememberRecent({
    filePath,
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt
  })
  db.setState(LAST_PROJECT_KEY, project.filePath)
  // Opened or saved again after a Clear Menu: back in the menu, as it would be on any Mac app.
  const shown = unhide(parseHidden(db.getState(RECENT_MENU_HIDDEN_KEY)), project.filePath)
  if (shown) db.setState(RECENT_MENU_HIDDEN_KEY, JSON.stringify(shown))
  // The Dock's and Finder's recent documents; the file type is declared in electron-builder.yml.
  if (process.platform === 'darwin') app.addRecentDocument(project.filePath)
  recentsChanged()
  // The thumbnail follows, off the critical path: reading a poster must never slow a save or an
  // open, and a project with no readable poster is still a project in the list. The row is
  // written again with the poster; `COALESCE` in the upsert keeps an older one if this finds
  // none.
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
  // One row per real file: aliases written by older builds (or before this) are folded into the
  // newest row for that file, under its real path, and the database is corrected as it goes.
  const canonical = canonicalRecents(db.listRecent(40), canonicalPath)
  for (const path of canonical.forget) db.forgetRecent(path)
  for (const row of canonical.rekey) db.rememberRecent(row)
  let pruned = canonical.forget.length > 0
  for (const row of canonical.rows.slice(0, 20)) {
    // A recents list that offers files the user moved to the bin is worse than a short one.
    if (!(await exists(row.filePath))) {
      db.forgetRecent(row.filePath)
      pruned = true
      continue
    }
    out.push({ ...row, folder: displayFolder(row.filePath, homedir()) })
  }
  // Only when something went: the menu's listener calls back into here, and an unconditional
  // notice would rebuild the menu forever.
  if (pruned) recentsChanged()
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
  // Not every path a document names: `adoptAssets` admits only what `admissibleFromProject`
  // allows (plus bay's own font copies), and is the one place that decides.
  adoptAssets(project.assets)
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
  recentsChanged()
}

export function reveal(filePath: string): void {
  shell.showItemInFolder(filePath)
}

/**
 * The gate for the three calls below: the renderer names the file, so main acts only on a `.bay`
 * that is already on the projects list (`manage.ts` says why). Throws the reason as is.
 */
function listedProject(filePath: string): void {
  const db = database()
  const listed = db ? db.listRecent(1000).map((row) => row.filePath) : []
  const refusal = refuseUnlisted(filePath, listed)
  if (refusal) throw new Error(refusal)
}

async function stemsBeside(filePath: string): Promise<string[]> {
  return projectStems(await readdir(dirname(filePath)).catch(() => [] as string[]))
}

function listed(project: Project): RecentProject {
  const filePath = project.filePath!
  return {
    id: project.id,
    name: project.name,
    filePath,
    updatedAt: project.updatedAt,
    folder: displayFolder(filePath, homedir())
  }
}

export async function rename(filePath: string, name: string): Promise<RecentProject> {
  listedProject(filePath)
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed === '') throw new Error('A project needs a name.')
  const project = await readProjectFile(filePath)
  const target = renamedPath(filePath, trimmed, await stemsBeside(filePath))
  // The file first, then the document at its new path, so the name and `filePath` inside it
  // are the ones it now has. A move that fails leaves everything as it was.
  if (target !== filePath) await renameFile(filePath, target)
  const written = await writeProjectFile({ ...project, name: trimmed }, target)
  if (target !== filePath) database()?.forgetRecent(filePath)
  rememberRecent(written)
  return listed(written)
}

export async function duplicate(filePath: string): Promise<RecentProject> {
  listedProject(filePath)
  const project = await readProjectFile(filePath)
  const name = copyName(project.name || basename(filePath, `.${EXTENSION}`), await stemsBeside(filePath))
  const target = join(dirname(filePath), `${fileStem(name)}.${EXTENSION}`)
  // A new id: the autosave sidecar and the agent's change cards are keyed by it, and two
  // projects sharing one would restore each other's work.
  const written = await persist({ ...project, id: `prj_${randomUUID()}`, name }, target)
  return listed(written)
}

export async function trash(filePath: string): Promise<void> {
  listedProject(filePath)
  await shell.trashItem(filePath)
  database()?.forgetRecent(filePath)
  recentsChanged()
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
  // Through the same gate as opening: a project opened with a refused path and then saved must not
  // admit that path on the way out. What the user imported this session was admitted at import.
  adoptAssets(written.assets)
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
): Promise<{ filePath: string; name: string } | null> {
  const target = await chooseSavePath(project, window)
  if (!target) return null
  // The project takes the new file's name, as `create` and `rename` keep them; otherwise home
  // lists two identical cards for two files.
  const written = await persist({ ...project, name: nameFromPath(target, project.name) }, target)
  return { filePath: written.filePath!, name: written.name }
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
  const project = admitAssets(await readProjectFile(canonicalPath(filePath)))
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
