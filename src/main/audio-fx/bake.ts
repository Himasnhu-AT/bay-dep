/**
 * Baked audio effects: a source's whole audio stream rendered once through a chain's dynamics and
 * noise-removal stages by bay's ffmpeg, into a content-addressed WAV that the preview and the
 * export both play (`@shared/audio-effects` says why these stages are baked rather than run live).
 *
 * **The whole stream, not the clip's range.** A clip is trimmed, slipped, split, given J/L leads
 * and transition handles — every one of those reads a different stretch of source, and a bake
 * keyed by range would be re-rendered by each. Keyed by the file's content and the chain alone,
 * one bake serves every clip of that file with that chain, the two halves of a split share it (so
 * a compressor's gain is continuous across the cut), and trimming costs nothing.
 *
 * **24-bit PCM in a WAV.** Lossless, so the bake adds nothing of its own; sample-accurate to seek,
 * which a compressed file is not; and 48 kHz, the export's rate, so it is never resampled on the
 * way into the mix. It is large — about 1 GB an hour in stereo — which is why this family has its
 * own size cap (`sweepBakes`) instead of sharing the 512 MB budget posters and peaks live under.
 *
 * Nothing here imports Electron: the directory, the binary and the path rule are handed in
 * (`host.ts` does that), so the suite renders through the real ffmpeg.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import {
  activeEffects,
  afftdnFloor,
  bakeFilterGraph,
  bakeSignature,
  checkEffect,
  MAX_AUDIO_EFFECTS,
  quietLevelDb,
  stagesBeforeDenoise,
  type AudioEffect
} from '@shared/audio-effects'
import type { AudioBakeRequest, AudioBakeResult } from '@shared/audio-bake'
import { run } from '../ffmpeg/ffmpeg'
import { contentKey as fileContentKey } from '../vision/cache'

export const AUDIO_FX_CACHE_FAMILY = 'audiofx'

/** Bakes this session has made or read are never swept; everything else is, oldest first, past this. */
export const AUDIO_FX_CACHE_BYTES = 4 * 1024 * 1024 * 1024

/** A bake of a very long file is slow, not stuck; past this it is stuck. */
const BAKE_TIMEOUT_MS = 30 * 60 * 1000

export interface BakerOptions {
  /** Where bakes are written. Created on first use. */
  dir: string
  ffmpeg: () => string
  /** The `bay://` rule: a path the renderer may not read is not one it may have processed. */
  isAllowed: (path: string) => boolean
  /** Called with every bake that exists after a request — made or found — so it can be served. */
  onReady?: (path: string) => void
  contentKey?: (path: string) => Promise<string>
}

/** The effects of a request, checked the way a tool call's are, then reduced to what does something. */
export function bakedChain(effects: unknown): { ok: true; chain: AudioEffect[] } | { ok: false; error: string } {
  if (!Array.isArray(effects)) return { ok: false, error: 'effects is a list of effects.' }
  if (effects.length > 2 * MAX_AUDIO_EFFECTS) return { ok: false, error: 'Too many effects to bake.' }
  const checked: AudioEffect[] = []
  for (const [index, each] of effects.entries()) {
    const result = checkEffect(each, `e${index}`)
    if (!result.ok) return { ok: false, error: result.error }
    checked.push(result.value)
  }
  const chain = activeEffects(checked)
  if (chain.length === 0) return { ok: false, error: 'None of these effects does anything, so there is nothing to bake.' }
  return { ok: true, chain }
}

/** The arguments of one bake. The graph is always built here from checked effects, never received. */
export function bakeArgs(source: string, chain: readonly AudioEffect[], output: string, noiseFloorDb?: number): string[] {
  return [
    '-v', 'error', '-y', '-nostdin',
    '-i', source,
    '-filter_complex', bakeFilterGraph(chain, noiseFloorDb),
    '-map', '[out]',
    '-c:a', 'pcm_s24le',
    // A WAV's size field is 32 bits; past 4 GB (about four hours of stereo) ffmpeg writes RF64.
    '-rf64', 'auto',
    '-f', 'wav',
    output
  ]
}

/** The bake's name: the file's content and what was done to it. 32 hex characters. */
export function bakeKey(content: string, chain: readonly AudioEffect[]): string {
  return createHash('sha256').update(`${content}\0${bakeSignature(chain)}`).digest('hex').slice(0, 32)
}

/** Interleaved samples per measuring window: 50 ms of stereo at the bake's rate. */
const QUIET_WINDOW_SAMPLES = 4800

/**
 * How loud the quiet stretches of `source` are after `before` (the stages ahead of the noise
 * removal), in dB RMS — `quietLevelDb` over 50 ms windows of every channel, decoded by ffmpeg and
 * summed here as it streams, so an hour of sound is never held in memory.
 */
export function measureQuietLevel(
  ffmpeg: string,
  source: string,
  before: readonly AudioEffect[],
  signal?: AbortSignal
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ['-v', 'error', '-nostdin', '-i', source, '-filter_complex', bakeFilterGraph(before), '-map', '[out]', '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'], signal }
    )
    const windows: number[] = []
    let sum = 0
    let count = 0
    let carry: Buffer = Buffer.alloc(0)
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
      const whole = data.length - (data.length % 4)
      for (let offset = 0; offset < whole; offset += 4) {
        const sample = data.readFloatLE(offset)
        sum += sample * sample
        count += 1
        if (count === QUIET_WINDOW_SAMPLES) {
          windows.push(10 * Math.log10(Math.max(sum / count, 1e-24)))
          sum = 0
          count = 0
        }
      }
      carry = data.subarray(whole)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (text: string) => {
      stderr = (stderr + text).slice(-2000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(quietLevelDb(windows))
      else reject(new Error(stderr.trim() || `ffmpeg exited with ${code} while measuring the noise.`))
    })
  })
}

export class AudioFxBaker {
  readonly #options: BakerOptions
  readonly #running = new Map<string, Promise<AudioBakeResult>>()
  /** Keys made or read this session: what `sweep` must leave alone. */
  readonly #used = new Set<string>()
  readonly #stop = new AbortController()

  constructor(options: BakerOptions) {
    this.#options = options
  }

  get usedKeys(): ReadonlySet<string> {
    return this.#used
  }

  /** The bake for `request`, from the cache or rendered now. Two requests for one bake share a run. */
  async ensure(request: AudioBakeRequest): Promise<AudioBakeResult> {
    if (!request || typeof request.path !== 'string' || !request.path) {
      return { ok: false, error: 'A bake needs the path of the file whose sound is processed.' }
    }
    const chain = bakedChain(request.effects)
    if (!chain.ok) return chain
    if (!this.#options.isAllowed(request.path)) {
      return { ok: false, error: `bay may not read ${request.path}, so its sound cannot be processed. Import the file first.` }
    }
    let content: string
    try {
      content = await (this.#options.contentKey ?? fileContentKey)(request.path)
    } catch {
      return { ok: false, error: `The file ${request.path} could not be read, so its sound cannot be processed.` }
    }
    const key = bakeKey(content, chain.chain)
    const existing = this.#running.get(key)
    if (existing) return existing
    const job = this.#bake(request.path, chain.chain, key).finally(() => this.#running.delete(key))
    this.#running.set(key, job)
    return job
  }

  async #bake(source: string, chain: readonly AudioEffect[], key: string): Promise<AudioBakeResult> {
    const output = join(this.#options.dir, `${key}.wav`)
    this.#used.add(key)
    try {
      const found = await stat(output)
      if (found.isFile() && found.size > 44) {
        // Read again: the newest use is what the sweep orders by.
        const now = new Date()
        await utimes(output, now, now).catch(() => {})
        this.#options.onReady?.(output)
        return { ok: true, key, path: output }
      }
    } catch {
      // Not there yet.
    }
    const part = join(this.#options.dir, `${key}.part`)
    try {
      await mkdir(this.#options.dir, { recursive: true })
      // Noise removal needs this recording's own noise level, measured where the stage sits.
      const before = stagesBeforeDenoise(chain)
      const floor = before
        ? afftdnFloor(await measureQuietLevel(this.#options.ffmpeg(), source, before, this.#stop.signal))
        : undefined
      await run(this.#options.ffmpeg(), bakeArgs(source, chain, part, floor), undefined, {
        timeoutMs: BAKE_TIMEOUT_MS,
        signal: this.#stop.signal
      })
      // Renamed only when complete, so a half-written bake is never at a name a clip would play.
      await rename(part, output)
    } catch (error) {
      await rm(part, { force: true }).catch(() => {})
      const why = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `The sound of ${source} could not be processed: ${why}` }
    }
    this.#options.onReady?.(output)
    return { ok: true, key, path: output }
  }

  /** Removes bakes not used this session, oldest first, until the family is under `capBytes`. */
  sweep(capBytes: number = AUDIO_FX_CACHE_BYTES): Promise<string[]> {
    return sweepBakes(this.#options.dir, capBytes, this.#used)
  }

  /** Quit: running bakes are killed; their `.part` files are removed by the failed run. */
  dispose(): void {
    this.#stop.abort()
  }
}

/**
 * Brings the bake directory under `capBytes`: `.part` files a crash left go first, then whole
 * bakes by last use, oldest first — never one in `keep`, which a clip may be playing right now.
 * A bake removed here is rendered again the next time a clip asks for it. Only files with a bake's
 * name (32 hex + `.wav`/`.part`) are touched.
 */
export async function sweepBakes(dir: string, capBytes: number, keep: ReadonlySet<string>): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const removed: string[] = []
  const bakes: { path: string; key: string; size: number; usedAt: number }[] = []
  for (const name of names) {
    const match = /^([0-9a-f]{32})\.(wav|part)$/.exec(name)
    if (!match) continue
    const path = join(dir, name)
    const key = match[1]!
    if (match[2] === 'part') {
      if (keep.has(key)) continue
      await rm(path, { force: true }).catch(() => {})
      removed.push(path)
      continue
    }
    try {
      const info = await stat(path)
      bakes.push({ path, key, size: info.size, usedAt: info.mtimeMs })
    } catch {
      // Gone between the listing and the stat.
    }
  }
  let total = bakes.reduce((sum, b) => sum + b.size, 0)
  for (const bake of bakes.sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= capBytes) break
    if (keep.has(bake.key)) continue
    await rm(bake.path, { force: true }).catch(() => {})
    removed.push(bake.path)
    total -= bake.size
  }
  return removed
}
