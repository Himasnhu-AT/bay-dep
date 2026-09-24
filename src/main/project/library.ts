/**
 * The projects screen's two small decisions, kept out of Electron so they can be tested.
 *
 * - **Where a new project goes, and what it is called.** A project here is a file, and a project
 *   the user has not saved yet has no file — so "Create new project" behind a save dialog would
 *   be a question before the user has done anything. New projects are written straight into one
 *   folder under a name that does not collide, and appear on the projects screen at once.
 * - **What a project looks like on that screen.** The poster of its first clip that has one,
 *   inlined as a data URL: the projects screen shows before any project is open, so nothing has
 *   allowlisted those poster files for `bay://` yet.
 */

import type { Project } from '@shared/project'

/*
 * Three words, adjective–colour–animal: "Quiet Amber Heron". A name a person can say and find
 * again in a grid of thumbnails, where "Untitled project 7" is a number they have to decode —
 * the way ChatCut names new projects. Every word is short, plain and unambiguous as a filename.
 */
const ADJECTIVES = [
  'Quiet', 'Bright', 'Gentle', 'Swift', 'Brave', 'Calm', 'Clever', 'Early', 'Golden', 'Honest',
  'Lucky', 'Mellow', 'Nimble', 'Patient', 'Primary', 'Rapid', 'Silent', 'Steady', 'Sunny',
  'Tidy', 'Vivid', 'Warm', 'Wild', 'Young', 'Bold', 'Crisp', 'Fresh', 'Lively', 'Proud', 'Shy'
]
const COLOURS = [
  'Amber', 'Azure', 'Coral', 'Crimson', 'Ivory', 'Jade', 'Indigo', 'Lilac', 'Olive', 'Ochre',
  'Rose', 'Ruby', 'Sage', 'Scarlet', 'Silver', 'Slate', 'Tan', 'Teal', 'Umber', 'Violet'
]
const ANIMALS = [
  'Heron', 'Otter', 'Fox', 'Moth', 'Lynx', 'Falcon', 'Badger', 'Wren', 'Hare', 'Orca', 'Finch',
  'Gecko', 'Ibis', 'Koala', 'Lark', 'Marten', 'Newt', 'Owl', 'Panda', 'Quail', 'Raven', 'Seal',
  'Stoat', 'Swift', 'Tapir', 'Vole', 'Whale', 'Yak', 'Zebra', 'Crane'
]

/** The word lists, for the test that every generated name is a safe filename. */
export const NAME_WORDS = { ADJECTIVES, COLOURS, ANIMALS } as const

/**
 * A random three-word name not already taken.
 *
 * Compared case-insensitively, because the macOS default filesystem is: "quiet amber heron.bay"
 * and "Quiet Amber Heron.bay" are one file there, and picking the one that "does not exist"
 * would overwrite the other. 18,000 combinations make a collision rare; after a bounded number
 * of draws it falls back to numbering the last draw, so a full folder can never loop forever.
 * `random` is injected so the test can drive the collision path deterministically.
 */
export function uniqueProjectName(
  taken: readonly string[],
  random: () => number = Math.random
): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()))
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length) % list.length]!
  let candidate = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    candidate = `${pick(ADJECTIVES)} ${pick(COLOURS)} ${pick(ANIMALS)}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
  for (let n = 2; ; n += 1) {
    const numbered = `${candidate} ${n}`
    if (!lower.has(numbered.toLowerCase())) return numbered
  }
}

/** Largest poster inlined. A poster is a small JPEG; anything bigger is not one. */
export const MAX_POSTER_BYTES = 400_000

/**
 * The project's poster as a data URL, or undefined when it has none that can be read.
 *
 * Never throws: a missing poster is a blank tile, and a project that fails to appear in the list
 * because its thumbnail was deleted would be a much worse bug than the blank tile.
 */
export async function posterFor(
  project: Pick<Project, 'assets'>,
  readFile: (path: string) => Promise<Uint8Array>,
  /**
   * A poster file for an asset that records none. A saved `.bay` usually has `posterPath: null`
   * — posters are made each session and never saved — so without this almost no project would
   * have a thumbnail. Main passes the thumbnail cache here; it may make the image.
   */
  locate: (asset: Project['assets'][number]) => Promise<string | null> = async () => null
): Promise<string | undefined> {
  for (const asset of project.assets) {
    if (asset.error) continue
    try {
      const posterPath = asset.posterPath ?? (await locate(asset))
      if (!posterPath) continue
      const bytes = await readFile(posterPath)
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_POSTER_BYTES) continue
      const type = posterPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
      return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
    } catch {
      // Gone, or unreadable: try the next asset rather than give up on the project.
    }
  }
  return undefined
}
