/**
 * The visual index on disk: one file per (file content, model, sampling), under a versioned
 * directory (`<cache>/vision-<scheme>`), swept like the thumbnail cache when the scheme moves.
 *
 * Keyed by the file's **content**, not its path: a clip moved to another drive, or imported into a
 * second project, is the same footage and is not indexed twice. Hashing every byte of a 40 GB
 * camera original to find that out would cost more than indexing it, so the content key is a
 * SHA-256 of the size and three 1 MiB windows (start, middle, end) — enough to tell two real
 * video files apart, and ~3 MiB of reads however long the file. A re-export over the same name
 * changes the size or the windows, so it is a new key and a new index.
 *
 * No Electron import; the caller passes the directory.
 */

import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CACHE_SCHEME } from '../media/cache-key'

export const VISION_CACHE_FAMILY = 'vision'
export const visionCacheDir = (cacheRoot: string): string => join(cacheRoot, `${VISION_CACHE_FAMILY}-${CACHE_SCHEME}`)

const WINDOW = 1024 * 1024

/** SHA-256 over the file's size and its first, middle and last MiB. */
export async function contentKey(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const hash = createHash('sha256')
    hash.update(`${size}\0`)
    const starts = size <= 3 * WINDOW ? [0] : [0, Math.floor(size / 2 - WINDOW / 2), size - WINDOW]
    const buffer = Buffer.alloc(size <= 3 * WINDOW ? size : WINDOW)
    for (const start of starts) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      hash.update(buffer.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

/** The index file's name: content, model and interval all change what is in it. */
export function indexFileName(content: string, modelId: string, intervalUs: number): string {
  const key = createHash('sha256').update(`${content}\0${modelId}\0${intervalUs}`).digest('hex').slice(0, 32)
  return `${key}.json`
}

export interface FrameIndex {
  modelId: string
  intervalUs: number
  dims: number
  timesUs: number[]
  /** `timesUs.length × dims` floats, unit vectors, row by row. */
  vectors: Float32Array
}

interface StoredIndex {
  modelId: string
  intervalUs: number
  dims: number
  timesUs: number[]
  vectors: string
}

export async function writeFrameIndex(dir: string, name: string, index: FrameIndex): Promise<void> {
  await mkdir(dir, { recursive: true })
  const stored: StoredIndex = {
    modelId: index.modelId,
    intervalUs: index.intervalUs,
    dims: index.dims,
    timesUs: index.timesUs,
    vectors: Buffer.from(index.vectors.buffer, index.vectors.byteOffset, index.vectors.byteLength).toString('base64')
  }
  // Written aside and renamed, so a reader never sees half an index (and a crash leaves none).
  const part = join(dir, `${name}.part`)
  await writeFile(part, JSON.stringify(stored))
  await rename(part, join(dir, name))
}

/**
 * The index, or null when there is none or it cannot be believed — a file for another model, or
 * one whose vectors do not fill `times × dims`, is treated as absent and indexed again.
 */
export async function readFrameIndex(dir: string, name: string, modelId: string): Promise<FrameIndex | null> {
  let stored: StoredIndex
  try {
    stored = JSON.parse(await readFile(join(dir, name), 'utf8')) as StoredIndex
  } catch {
    return null
  }
  if (stored.modelId !== modelId || !Array.isArray(stored.timesUs) || !(stored.dims > 0)) return null
  const bytes = Buffer.from(stored.vectors ?? '', 'base64')
  if (bytes.byteLength !== stored.timesUs.length * stored.dims * 4) return null
  const vectors = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  return { modelId: stored.modelId, intervalUs: stored.intervalUs, dims: stored.dims, timesUs: stored.timesUs, vectors }
}

export async function hasFrameIndex(dir: string, name: string): Promise<boolean> {
  return stat(join(dir, name)).then(
    (s) => s.isFile(),
    () => false
  )
}
