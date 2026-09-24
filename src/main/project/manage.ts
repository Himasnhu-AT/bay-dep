/**
 * The pure half of renaming, duplicating and trashing a project from the projects screen —
 * which file a request may touch, and which name a file ends up with. `store.ts` does the I/O.
 *
 * **Which file.** The renderer names the file, and the renderer is the half of bay that shows
 * other people's content. So main only acts on a path that is already a project bay listed (the
 * recents table) and ends `.bay`: a renderer that asked to trash `~/.ssh/id_rsa`, or any file it
 * could name, gets a refusal. Both checks are needed — a recents row is written from a project's
 * own `filePath`, and a hand-edited `.bay` saved under another extension would otherwise pass.
 *
 * **Which name.** Names are compared case-insensitively, as the Mac's default disk compares them:
 * "Trip.bay" and "trip.bay" are one file there, and a rename that believed the second free would
 * overwrite the first.
 */

import { basename, dirname, join, resolve, sep } from 'node:path'

export const PROJECT_EXTENSION = 'bay'

/** Null when main may act on `filePath`; otherwise the reason, to be thrown as is. */
export function refuseUnlisted(filePath: string, listed: readonly string[]): string | null {
  if (typeof filePath !== 'string' || filePath === '') return 'No project file was named.'
  if (!filePath.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)) {
    return `${basename(filePath)} is not a bay project, so it was left alone.`
  }
  const wanted = resolve(filePath)
  if (!listed.some((path) => resolve(path) === wanted)) {
    return `${basename(filePath)} is not on the projects list, so it was left alone. Open it once to add it.`
  }
  return null
}

/** Characters a file name cannot carry on macOS (`/`, and `:` which Finder shows as `/`). */
export function fileStem(name: string): string {
  return name.replace(/[/\\:]/g, '-').replace(/^\.+/, '').trim()
}

/** The stems of `.bay` files in a folder listing, for the name checks below. */
export function projectStems(entries: readonly string[]): string[] {
  const suffix = `.${PROJECT_EXTENSION}`
  return entries
    .filter((entry) => entry.toLowerCase().endsWith(suffix))
    .map((entry) => entry.slice(0, -suffix.length))
}

/**
 * Where a renamed project's file goes: `<name>.bay` beside it when no *other* project there has
 * that name; the path it already has when one does (the document is renamed either way), or when
 * the name makes no usable file name.
 */
export function renamedPath(filePath: string, name: string, taken: readonly string[]): string {
  const stem = fileStem(name)
  if (stem === '') return filePath
  const own = basename(filePath).slice(0, -(PROJECT_EXTENSION.length + 1)).toLowerCase()
  const lower = stem.toLowerCase()
  if (lower !== own && taken.some((other) => other.toLowerCase() === lower)) return filePath
  return join(dirname(filePath), `${stem}.${PROJECT_EXTENSION}`)
}

/** "<name> copy", then "<name> copy 2", … — the first no project file in the folder has. */
export function copyName(name: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((stem) => stem.toLowerCase()))
  const base = `${name} copy`
  if (!lower.has(fileStem(base).toLowerCase())) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`
    if (!lower.has(fileStem(candidate).toLowerCase())) return candidate
  }
}

/** A project's folder for the list view: the home folder as `~`. */
export function displayFolder(filePath: string, home: string): string {
  const folder = dirname(filePath)
  const root = home.endsWith(sep) ? home.slice(0, -1) : home
  if (root && (folder === root || folder.startsWith(root + sep))) return `~${folder.slice(root.length)}`
  return folder
}
