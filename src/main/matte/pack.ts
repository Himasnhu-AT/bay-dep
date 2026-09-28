/**
 * The matte pack: one file per (content, range, engine, parameters), in the cache.
 *
 *     [frame 0][frame 1] … [frame n-1][index JSON][u32 LE: index bytes]["BAYMATT1"]
 *
 * Each frame is `width × height` bytes of 8-bit alpha, raw-deflated (`MATTE_FRAME_CODEC`), so the
 * renderer fetches one frame with a `bay://` Range request and inflates it with
 * `DecompressionStream('deflate-raw')` — no PNG decoder, no second media element. The index goes
 * last because frame sizes are known only once they are written; the footer finds it.
 *
 * Written to `<key>.bmat.part` and renamed on the last frame, so a reader never sees half a pack
 * and a crash leaves only a `.part`, which the next job overwrites.
 *
 * No Electron import; the tests run it on temp directories.
 */

import { open, readFile, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import type { SubjectMatteReport } from '@shared/matte'

export const PACK_MAGIC = 'BAYMATT1'
const FOOTER = 4 + PACK_MAGIC.length
/** Past this an index cannot be real (18 000 frames × ~40 bytes is ~700 KB) and the file is not believed. */
const MAX_INDEX_BYTES = 64 * 1024 * 1024

export interface PackIndex {
  version: 1
  engine: string
  engineBuild: string
  width: number
  height: number
  fromUs: number
  toUs: number
  codec: string
  /** `[ptsUs, offset, length]` per frame, ascending by time. */
  frames: [number, number, number][]
  report: Omit<SubjectMatteReport, 'cached' | 'bytes' | 'megabytesPerMinute'>
}

export class MattePackWriter {
  readonly #handle: FileHandle
  readonly #part: string
  readonly #final: string
  readonly #frames: [number, number, number][] = []
  #offset = 0
  #width = 0
  #height = 0
  #lastPts = Number.NEGATIVE_INFINITY

  private constructor(handle: FileHandle, part: string, final: string) {
    this.#handle = handle
    this.#part = part
    this.#final = final
  }

  static async create(finalPath: string): Promise<MattePackWriter> {
    const part = `${finalPath}.part`
    const handle = await open(part, 'w')
    return new MattePackWriter(handle, part, finalPath)
  }

  get frames(): number {
    return this.#frames.length
  }

  get bytesWritten(): number {
    return this.#offset
  }

  async append(ptsUs: number, width: number, height: number, alpha: Uint8Array): Promise<void> {
    if (this.#frames.length === 0) {
      this.#width = width
      this.#height = height
    } else if (width !== this.#width || height !== this.#height) {
      throw new Error(`The matte changed size mid-clip (${this.#width}×${this.#height} to ${width}×${height}).`)
    }
    if (alpha.length !== width * height) throw new Error(`A ${width}×${height} matte frame must be ${width * height} bytes; got ${alpha.length}.`)
    // Strictly ascending: `matteFrameIndex` binary-searches this list, and a frame decoded twice at
    // one timestamp (an edit-list quirk) would make "the frame at t" ambiguous. The later one is dropped.
    if (!(ptsUs > this.#lastPts)) return
    this.#lastPts = ptsUs
    // Level 6: 1.6 ms and 9.0 KB a frame on a real 512×384 matte, against 4.9 ms and 8.7 KB at 9.
    const packed = deflateRawSync(alpha, { level: 6 })
    await this.#handle.write(packed, 0, packed.length, this.#offset)
    this.#frames.push([Math.round(ptsUs), this.#offset, packed.length])
    this.#offset += packed.length
  }

  /** Writes the index and footer, syncs, and renames into place. Returns the pack's size. */
  async finish(meta: Omit<PackIndex, 'version' | 'width' | 'height' | 'frames' | 'codec'>): Promise<{ bytes: number; index: PackIndex }> {
    const index: PackIndex = { version: 1, codec: 'deflate-raw-gray8', width: this.#width, height: this.#height, frames: this.#frames, ...meta }
    const json = Buffer.from(JSON.stringify(index), 'utf8')
    const footer = Buffer.alloc(FOOTER)
    footer.writeUInt32LE(json.length, 0)
    footer.write(PACK_MAGIC, 4, 'latin1')
    await this.#handle.write(json, 0, json.length, this.#offset)
    await this.#handle.write(footer, 0, footer.length, this.#offset + json.length)
    await this.#handle.sync()
    await this.#handle.close()
    await rename(this.#part, this.#final)
    return { bytes: this.#offset + json.length + footer.length, index }
  }

  /** Abandons the pack: closes and deletes the `.part`. */
  async abort(): Promise<void> {
    await this.#handle.close().catch(() => {})
    await rm(this.#part, { force: true })
  }
}

/**
 * The index of a finished pack, or null when there is no pack or it cannot be believed — a wrong
 * magic, an index that does not parse, or frames that run past the data. A pack that is not
 * believed is computed again, never drawn from.
 */
export async function readPackIndex(path: string): Promise<{ index: PackIndex; bytes: number } | null> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return null
  }
  if (size < FOOTER) return null
  const handle = await open(path, 'r')
  try {
    const footer = Buffer.alloc(FOOTER)
    await handle.read(footer, 0, FOOTER, size - FOOTER)
    if (footer.toString('latin1', 4) !== PACK_MAGIC) return null
    const length = footer.readUInt32LE(0)
    if (length <= 0 || length > MAX_INDEX_BYTES || length > size - FOOTER) return null
    const json = Buffer.alloc(length)
    await handle.read(json, 0, length, size - FOOTER - length)
    let index: PackIndex
    try {
      index = JSON.parse(json.toString('utf8')) as PackIndex
    } catch {
      return null
    }
    const dataEnd = size - FOOTER - length
    if (index.version !== 1 || !Array.isArray(index.frames) || !(index.width > 0) || !(index.height > 0)) return null
    let last = Number.NEGATIVE_INFINITY
    for (const frame of index.frames) {
      if (!Array.isArray(frame) || frame.length !== 3) return null
      const [pts, offset, bytes] = frame
      if (!(pts > last) || offset < 0 || bytes <= 0 || offset + bytes > dataEnd) return null
      last = pts
    }
    return { index, bytes: size }
  } finally {
    await handle.close()
  }
}

/** One frame's alpha, inflated — for tests and for checks in main; the renderer reads through `bay://`. */
export async function readPackFrame(path: string, index: PackIndex, i: number): Promise<Uint8Array> {
  const entry = index.frames[i]
  if (!entry) throw new Error(`frame ${i} is not in this pack (${index.frames.length} frames)`)
  const data = await readFile(path)
  return new Uint8Array(inflateRawSync(data.subarray(entry[1], entry[1] + entry[2])))
}
