/**
 * Cache keys for derived media.
 *
 * The key includes the file's mtime and size, not just its path. A user who re-exports over
 * the same filename gets new posters and a new waveform; a user who merely relaunches bay
 * gets the ones already on disk. Keying on path alone is how a stale poster outlives the
 * footage it came from.
 */

import { createHash } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Bumped whenever the key derivation or the file layout changes.
 *
 * It is in the *directory name*, not only in the hash, and that is the point. A change to
 * this scheme is a legitimate thing to do — but with a flat directory the old entries simply
 * stop being addressable and stay on disk for the life of the install: silently orphaned
 * rather than invalidated. Nothing in bay evicts them, so they are never reclaimed. Putting
 * the version in the path makes the stale set a directory you can identify and delete, which
 * is what `sweepStaleCaches` does at startup.
 *
 * Deliberately *not* pinned as a literal in a test, unlike `LAST_PROJECT_KEY`: that key is a
 * promise to data already on disk and must never move, whereas this one exists in order to
 * move. The test asserts the sweep works, not that the number is any particular value.
 */
export const CACHE_SCHEME = 'v1'

export interface FileStamp {
  path: string
  mtimeMs: number
  size: number
}

export async function stampOf(path: string): Promise<FileStamp> {
  const absolute = resolve(path)
  const info = await stat(absolute)
  return { path: absolute, mtimeMs: info.mtimeMs, size: info.size }
}

export function cacheKey(stamp: FileStamp, ...parts: (string | number)[]): string {
  // The scheme is deliberately *not* hashed in. It used to be, as belt-and-braces beside the
  // versioned directory — and it was unfalsifiable: the scheme is constant within a run, so
  // including it shifts every key uniformly and no input can tell the two versions apart.
  // Entries from different schemes already live in different directories and can never meet.
  const hash = createHash('sha1')
  hash.update(stamp.path)
  hash.update('\0')
  hash.update(String(Math.round(stamp.mtimeMs)))
  hash.update('\0')
  hash.update(String(stamp.size))
  for (const part of parts) {
    hash.update('\0')
    hash.update(String(part))
  }
  return hash.digest('hex').slice(0, 24)
}

/**
 * Removes cache directories written by an older scheme.
 *
 * Conservative by construction: it only ever considers direct children of bay's own cache
 * directory whose names match `<family>-<scheme>` for a family it is told about, and only
 * removes those whose scheme is not the current one. An unrecognised name is left alone —
 * deleting something bay did not write, because it happened to sit in the cache directory,
 * is a much worse failure than leaving a few stale megabytes.
 */
export async function sweepStaleCaches(
  cacheDirectory: string,
  families: readonly string[] = ['thumbs', 'peaks']
): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(cacheDirectory)
  } catch {
    return []
  }

  const removed: string[] = []
  for (const entry of entries) {
    const separator = entry.lastIndexOf('-')
    // A bare `thumbs` or `peaks` with no scheme suffix is the pre-versioning layout, and it
    // is the one stale cache *every* existing install has. Skipping it — which an earlier
    // version of this function did, by requiring a separator — meant the sweep ignored the
    // only directory it was certain to find.
    const family = separator <= 0 ? entry : entry.slice(0, separator)
    const scheme = separator <= 0 ? '' : entry.slice(separator + 1)
    if (!families.includes(family)) continue
    if (scheme === CACHE_SCHEME) continue
    try {
      await rm(join(cacheDirectory, entry), { recursive: true, force: true })
      removed.push(entry)
    } catch {
      // A cache directory that will not delete is not worth failing a launch over.
    }
  }
  return removed
}
