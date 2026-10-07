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
import { access, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Project, Timeline, Track, TrackKind } from '@shared/project'
import { CANVAS_PRESETS, PROJECT_VERSION } from '@shared/project'
import { recoveryOffer, type AutosaveTarget, type OpenedProject, type RecoveryOffer, type SidecarReading } from '@shared/autosave'
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

/** The suffix every sidecar carries. On disk beside users' projects, so a test pins it. */
export const AUTOSAVE_SUFFIX = '.autosave'

/** Where a project's sidecar is, from the two things that decide it. */
export function sidecarPathFor(target: AutosaveTarget, fallbackDir: string): string {
  return target.filePath
    ? `${target.filePath}${AUTOSAVE_SUFFIX}`
    : join(fallbackDir, `${target.id}.${EXTENSION}${AUTOSAVE_SUFFIX}`)
}

/**
 * Write the sidecar. Atomic like a save, and stamped with the time it was written — that stamp
 * is what "newer than the saved project" is judged by.
 */
export async function writeSidecar(project: Project, fallbackDir: string, now: number = Date.now()): Promise<string> {
  const target = autosavePathFor(project, fallbackDir)
  await writeAtomic(target, JSON.stringify({ ...project, updatedAt: now }, null, 2))
  return target
}

/**
 * A sidecar read back as a project, through the same refusals, migrations and repairs as a
 * `.bay` — a sidecar written by last month's build is last month's format. `filePath` is the
 * project's own file (null when it never had one), never the sidecar's: a restored project that
 * believed it lived at `film.bay.autosave` would be saved there.
 */
export async function readSidecar(sidecarPath: string, filePath: string | null): Promise<Project> {
  let text: string
  try {
    text = await readFile(sidecarPath, 'utf8')
  } catch {
    throw new Error('The file could not be opened.')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('It is not complete — bay may have been stopped while writing it.')
  }
  const project = migrate(raw, filePath ?? sidecarPath)
  return { ...project, filePath }
}

async function readingOf(sidecarPath: string, filePath: string | null): Promise<SidecarReading> {
  if (!(await exists(sidecarPath))) return { kind: 'none' }
  try {
    const project = await readSidecar(sidecarPath, filePath)
    return { kind: 'project', sidecarPath, id: project.id, name: project.name, updatedAt: project.updatedAt }
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)
    return { kind: 'unreadable', sidecarPath, reason: /[.!?]$/.test(said) ? said : `${said}.` }
  }
}

/** Whether a project that was just opened has unsaved work waiting, and in what state. */
export async function checkRecovery(opened: OpenedProject, fallbackDir: string): Promise<RecoveryOffer | null> {
  return recoveryOffer(opened, await readingOf(sidecarPathFor(opened, fallbackDir), opened.filePath))
}

/**
 * Every project that was autosaved and never saved: the sidecars in bay's own folder, newest
 * first. One that will not read is listed as such rather than left out — a file the user cannot
 * see is one they cannot rescue by hand either.
 */
export async function listUnsaved(fallbackDir: string): Promise<RecoveryOffer[]> {
  let names: string[]
  try {
    names = await readdir(fallbackDir)
  } catch {
    return []
  }
  const suffix = `.${EXTENSION}${AUTOSAVE_SUFFIX}`
  const offers: RecoveryOffer[] = []
  for (const name of names) {
    // A dot-file here is `writeAtomic`'s temp, half-written by definition.
    if (!name.endsWith(suffix) || name.startsWith('.')) continue
    const target: AutosaveTarget = { id: name.slice(0, -suffix.length), filePath: null }
    const reading = await readingOf(join(fallbackDir, name), null)
    if (reading.kind === 'unreadable') {
      offers.push({ state: 'unreadable', target, name: null, sidecarPath: reading.sidecarPath, reason: reading.reason })
    } else if (reading.kind === 'project') {
      offers.push({ state: 'newer', target, name: reading.name, autosavedAt: reading.updatedAt, savedAt: null })
    }
  }
  const at = (offer: RecoveryOffer): number => (offer.state === 'newer' ? offer.autosavedAt : 0)
  return offers.sort((a, b) => at(b) - at(a))
}

/** Remove a project's sidecar. Missing is fine; anything else is the caller's to report. */
export async function removeSidecar(target: AutosaveTarget, fallbackDir: string): Promise<void> {
  await unlink(sidecarPathFor(target, fallbackDir)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

/**
 * Move a sidecar that will not load out of the way, under a name nothing reads back, and say
 * where. Never deleted: it may still be rescued by hand, and the next autosave of the project it
 * sits beside would otherwise be written straight over it.
 */
export async function setSidecarAside(target: AutosaveTarget, fallbackDir: string, now: number = Date.now()): Promise<string> {
  const from = sidecarPathFor(target, fallbackDir)
  const to = `${from}.unreadable-${now}`
  await rename(from, to)
  return to
}

/**
 * After a save: the work is in a file the user chose, so nothing is unsaved. Three sidecars can
 * hold it — beside the file it was saved to, beside the file it came from (Save As), and in bay's
 * folder if it had never been saved — and each would otherwise be offered as "unsaved work" for
 * a project whose work was just saved. Never throws: a sidecar that will not delete must not
 * turn a save that succeeded into one that failed.
 */
export async function clearSidecarsAfterSave(before: AutosaveTarget, savedTo: string, fallbackDir: string): Promise<void> {
  const targets: AutosaveTarget[] = [
    { id: before.id, filePath: savedTo },
    { id: before.id, filePath: null }
  ]
  if (before.filePath && before.filePath !== savedTo) targets.push({ id: before.id, filePath: before.filePath })
  for (const target of targets) await removeSidecar(target, fallbackDir).catch(() => undefined)
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
