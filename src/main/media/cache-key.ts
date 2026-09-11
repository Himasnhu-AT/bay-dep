/**
 * Cache keys for derived media.
 *
 * The key includes the file's mtime and size, not just its path. A user who re-exports over
 * the same filename gets new posters and a new waveform; a user who merely relaunches bay
 * gets the ones already on disk. Keying on path alone is how a stale poster outlives the
 * footage it came from.
 */

import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

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
