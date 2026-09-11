/**
 * Where projects live.
 *
 * The project itself is a plain JSON file with a `.bay` extension, in a folder the user
 * picked. That is deliberate and not negotiable: a user must be able to see their own work,
 * copy it to a backup drive, diff it, and open it when bay is not installed. SQLite is used
 * for exactly one thing — the recents index and a little app state — because that is
 * bookkeeping *about* projects, not the projects themselves. If `app.db` is deleted, nothing
 * is lost but the list.
 */

import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile, access, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { RecentProject } from '@shared/ipc'
import type { Project, Timeline, Track, TrackKind } from '@shared/project'
import { CANVAS_PRESETS, PROJECT_VERSION } from '@shared/project'
import { appDbPath, autosaveDir } from '../paths'
import { allowPaths } from '../protocol'
import { adoptAssets } from '../media/import'
import { openDatabase, type AppDatabase } from './db'

const EXTENSION = 'bay'

let db: AppDatabase | null = null

function database(): AppDatabase | null {
  if (db === null) db = openDatabase(appDbPath())
  return db
}

export function closeStore(): void {
  db?.close()
  db = null
}

// ---------------------------------------------------------------------------
// A fresh project
// ---------------------------------------------------------------------------

function makeTrack(kind: TrackKind, index: number): Track {
  return {
    id: `trk_${randomUUID()}`,
    kind,
    name: `${kind === 'video' ? 'V' : 'A'}${index}`,
    locked: false,
    muted: false,
    hidden: false,
    items: []
  }
}

/**
 * The shape `emptyProject()` in the renderer store produces. It is duplicated rather than
 * imported because main must not depend on renderer code — but the two have to agree, and
 * the serde round-trip through `.bay` is what would catch it if they stopped.
 */
function freshProject(): Project {
  const preset = CANVAS_PRESETS[0]!
  const timeline: Timeline = {
    id: `tl_${randomUUID()}`,
    name: 'Timeline 1',
    fps: preset.fps,
    width: preset.width,
    height: preset.height,
    background: '#000000',
    tracks: [makeTrack('video', 1), makeTrack('audio', 1)]
  }
  const now = Date.now()
  return {
    id: `prj_${randomUUID()}`,
    name: 'Untitled',
    version: PROJECT_VERSION,
    assets: [],
    timelines: [timeline],
    activeTimelineId: timeline.id,
    createdAt: now,
    updatedAt: now,
    filePath: null
  }
}

// ---------------------------------------------------------------------------
// Reading and writing the file
// ---------------------------------------------------------------------------

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Write to a sibling temp file and rename over the target. `rename` within a directory is
 * atomic, so a crash leaves either the old project or the new one — never a truncated file
 * with the user's afternoon half-written into it.
 */
async function writeAtomic(path: string, contents: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  await writeFile(temp, contents, 'utf8')
  try {
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

function migrate(raw: unknown, filePath: string): Project {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${basename(filePath)} is not a bay project.`)
  }
  const project = raw as Partial<Project>
  if (!Array.isArray(project.timelines) || !Array.isArray(project.assets)) {
    throw new Error(`${basename(filePath)} is missing its timelines or assets.`)
  }
  const version = typeof project.version === 'number' ? project.version : 0
  if (version > PROJECT_VERSION) {
    throw new Error(
      `${basename(filePath)} was saved by a newer version of bay (project format ${version}, this build reads ${PROJECT_VERSION}).`
    )
  }
  // Nothing to migrate yet — version 0 files predate the field and are otherwise identical.
  return { ...(project as Project), version: PROJECT_VERSION, filePath }
}

async function readProject(filePath: string): Promise<Project> {
  const absolute = resolve(filePath)
  let text: string
  try {
    text = await readFile(absolute, 'utf8')
  } catch {
    throw new Error(`Could not read ${absolute}.`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`${basename(absolute)} is not valid JSON — it may be a partial write.`)
  }
  const project = migrate(raw, absolute)
  // Opening a project is the second door media comes through; without this its clips would
  // probe fine and then fail to play, because `bay://` would refuse every one of them.
  adoptAssets(project.assets)
  allowPaths(project.assets.map((asset) => asset.path))
  return project
}

async function writeProject(project: Project, filePath: string): Promise<Project> {
  const stamped: Project = { ...project, filePath, updatedAt: Date.now() }
  await writeAtomic(filePath, JSON.stringify(stamped, null, 2))
  rememberRecent(stamped)
  allowPaths(stamped.assets.map((asset) => asset.path))
  return stamped
}

// ---------------------------------------------------------------------------
// Recents and app state
// ---------------------------------------------------------------------------

function rememberRecent(project: Project): void {
  const handle = database()
  if (!handle || !project.filePath) return
  handle.rememberRecent({
    filePath: project.filePath,
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt
  })
  handle.setState('lastProjectPath', project.filePath)
}

export async function recent(): Promise<RecentProject[]> {
  const handle = database()
  if (!handle) return []
  const rows = handle.listRecent(20)
  const out: RecentProject[] = []
  for (const row of rows) {
    // A recents list that offers files the user moved to the bin is worse than a short one.
    if (!(await exists(row.filePath))) {
      handle.forgetRecent(row.filePath)
      continue
    }
    out.push(row)
  }
  return out
}

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

export async function initial(): Promise<Project> {
  const handle = database()
  const last = handle?.getState('lastProjectPath') ?? null
  if (last && (await exists(last))) {
    try {
      return await readProject(last)
    } catch {
      // A project that will not parse must not stop bay from opening. The user gets an empty
      // document and the file is still on disk for them to look at.
    }
  }
  return freshProject()
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

export async function save(
  project: Project,
  window: BrowserWindow | null
): Promise<{ filePath: string }> {
  const target = project.filePath ?? (await chooseSavePath(project, window))
  // `save` promises a path, so a cancelled first-save can only be reported as a rejection.
  // The renderer treats it as a no-op; inventing a path in userData would hide the user's
  // work somewhere they would never think to look.
  if (!target) throw new Error('Save cancelled.')
  const written = await writeProject(project, target)
  return { filePath: written.filePath! }
}

export async function saveAs(
  project: Project,
  window: BrowserWindow | null
): Promise<{ filePath: string } | null> {
  const target = await chooseSavePath(project, window)
  if (!target) return null
  const written = await writeProject(project, target)
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
  const project = await readProject(filePath)
  rememberRecent(project)
  return project
}

/**
 * Autosave writes a *sidecar*, never the project file. The whole point is that a crash
 * during an autosave cannot cost the user the last version they deliberately saved, and
 * writing over `project.bay` — atomically or not — gives up that guarantee for nothing.
 */
export async function autosave(project: Project): Promise<void> {
  const target = project.filePath
    ? `${project.filePath}.autosave`
    : join(autosaveDir(), `${project.id}.${EXTENSION}.autosave`)
  await writeAtomic(target, JSON.stringify({ ...project, updatedAt: Date.now() }, null, 2))
}
