/**
 * Reading and writing `.bay` files, and deciding which project opens at launch.
 *
 * Split from `store.ts` so it imports no Electron: the dialogs, the allowlist and the window
 * live there, and none of them are involved in whether a saved project comes back. That
 * matters because the bug this file was extracted for — the app opening Untitled when it
 * should have reopened the last project — was in this path and could not be tested while it
 * needed an app instance to run.
 *
 * The project is a plain JSON file with a `.bay` extension, in a folder the user picked, and
 * that is not negotiable: a user must be able to see their own work, copy it to a backup
 * drive, and open it when bay is not installed.
 */

import { randomUUID } from 'node:crypto'
import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Project, Timeline, Track, TrackKind } from '@shared/project'
import { CANVAS_PRESETS, PROJECT_VERSION } from '@shared/project'
import type { AppDatabase } from './db'
import { applyTransforms, runMigrations, type RawDocument } from './migrations'

export const EXTENSION = 'bay'

/** The key `initial()` reads to decide what opens at launch. */
export const LAST_PROJECT_KEY = 'lastProjectPath'

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
 * The shape `emptyProject()` in the renderer store produces. Duplicated rather than imported
 * because main must not depend on renderer code — but the two have to agree, and the JSON
 * round trip through `.bay` is what would catch it if they stopped.
 */
export function freshProject(): Project {
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
// Files
// ---------------------------------------------------------------------------

export async function exists(path: string): Promise<boolean> {
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
export async function writeAtomic(path: string, contents: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  await writeFile(temp, contents, 'utf8')
  try {
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

/**
 * A parsed `.bay` document in, a `Project` at this build's format out.
 *
 * The version chain and the load-time repairs live in `./migrations`, and the order here is the
 * contract: refuse what is not a project, then upgrade the format (or refuse a newer one), then
 * normalise. Normalising first would run today's repairs against yesterday's shape.
 */
export function migrate(raw: unknown, filePath: string): Project {
  const name = basename(filePath)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${name} is not a bay project.`)
  }
  const shaped = raw as Partial<Project>
  if (!Array.isArray(shaped.timelines) || !Array.isArray(shaped.assets)) {
    throw new Error(`${name} is missing its timelines or assets.`)
  }
  const current = runMigrations(raw as RawDocument, name) as unknown as Project
  return { ...applyTransforms(current), version: PROJECT_VERSION, filePath }
}

export async function readProjectFile(filePath: string): Promise<Project> {
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
  return migrate(raw, absolute)
}

export async function writeProjectFile(project: Project, filePath: string): Promise<Project> {
  const stamped: Project = { ...project, filePath, updatedAt: Date.now() }
  await writeAtomic(filePath, JSON.stringify(stamped, null, 2))
  return stamped
}

/** Autosave goes to a sidecar of the project, or to a given directory when never saved. */
export function autosavePathFor(project: Project, fallbackDir: string): string {
  return project.filePath
    ? `${project.filePath}.autosave`
    : join(fallbackDir, `${project.id}.${EXTENSION}.autosave`)
}

// ---------------------------------------------------------------------------
// What opens at launch
// ---------------------------------------------------------------------------

/**
 * The project to show at launch: the one last opened, if the database remembers it and the
 * file is still there, otherwise a fresh one.
 *
 * Takes the database rather than reaching for it, so the round trip that failed in the real
 * app — write the key, relaunch, get the project back — is exercisable without an app. With
 * `db` null every launch silently produced Untitled, which is precisely how a dead database
 * passed for a working one.
 */
export async function resolveInitialProject(db: AppDatabase | null): Promise<Project> {
  const last = db?.getState(LAST_PROJECT_KEY) ?? null
  if (last) {
    try {
      return await readProjectFile(last)
    } catch {
      // Anything at all: the file is gone, is a directory, is unreadable, is half-written.
      // A project that will not open must not stop bay from opening. The user gets an empty
      // document and their file is still on disk for them to look at.
      //
      // There is deliberately no `exists()` check in front of this. There was one, and it was
      // unfalsifiable — every case it rejected, `readProjectFile` throws on anyway, so nothing
      // could tell its presence from its absence. Checked differentially over missing files,
      // directories, unreadable files, empty files and bad JSON: identical outcomes either
      // way. `exists` is still load-bearing in `recent()`, where it prunes rather than guards.
    }
  }
  return freshProject()
}
