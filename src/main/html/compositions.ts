/**
 * HyperFrames compositions, rendered by seeking an offscreen page.
 *
 * A composition is an HTML file whose animation hangs off one **paused** GSAP timeline at
 * `window.__timelines[<id>]`. Seeking it is `timeline.time(seconds)` and the resulting picture
 * depends on nothing but that number — measured, not assumed: 90 captures of a real composition
 * across forward, reverse and shuffled orderings gave identical pixels for identical times.
 * Scrubbing a timeline depends entirely on that.
 *
 * One window per asset, offscreen, held open. Creating a `BrowserWindow` is creating a renderer
 * process and loading a page, so doing it per frame would cost more than the frame; keeping one
 * per composition that is currently on a timeline is the shape that matches how they are used.
 * `release` is explicit rather than timed, because a window per asset left alive after the clip
 * is gone is a memory leak with an editor attached.
 *
 * **Nothing here is reachable from `pnpm test`** — it imports `electron`, and the suite runs
 * under plain Node. `pnpm typecheck` is the only gate it has, which is why everything that
 * could be pure logic lives in `./bitmap.ts` with tests instead.
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow } from 'electron'
import type {
  CompositionFrame,
  CompositionFrameRequest,
  ImportedAsset
} from '@shared/ipc'
import type { Asset } from '@shared/project'
import {
  compositionDurationUs,
  fatalFaults,
  readComposition,
  seekSecondsFor,
  type CompositionFault,
  type CompositionInfo
} from '@shared/composition'
import { allowPath } from '../protocol'
import { bgraToRgba, describeSizeMismatch } from './bitmap'

/**
 * How many composition windows may exist at once.
 *
 * Each one is a renderer process. Eight is enough for any timeline anyone is actually cutting
 * and small enough that a project which imported forty compositions does not open forty
 * processes; past it the least recently used window is closed and reopened on demand.
 */
const MAX_WINDOWS = 8

/** How long to wait for a page to load and register its timeline before giving up. */
const LOAD_TIMEOUT_MS = 10_000

interface Entry {
  window: BrowserWindow
  path: string
  info: CompositionInfo
  ready: Promise<void>
  /** The previous frame's bytes, to tell a held picture from a fresh one. */
  last: Buffer | null
  usedAt: number
}

const entries = new Map<string, Entry>()

export async function inspectComposition(
  path: string
): Promise<{ info: CompositionInfo | null; faults: CompositionFault[] }> {
  try {
    return readComposition(await readFile(path, 'utf8'))
  } catch (error) {
    return {
      info: null,
      faults: [
        {
          code: 'no-root',
          message: `${path} could not be read: ${(error as Error).message}`,
          line: null,
          fatal: true
        }
      ]
    }
  }
}

/**
 * Import compositions as assets.
 *
 * A composition is not probed with ffprobe — ffprobe would reject the file, and everything
 * ffprobe would have told us the composition declares itself. An unreadable one still becomes
 * an asset carrying `error`, the same as unreadable media does, so it lists and explains
 * rather than vanishing.
 */
export async function importCompositions(paths: string[]): Promise<ImportedAsset[]> {
  const imported: ImportedAsset[] = []
  for (const path of paths) {
    const { info, faults } = await inspectComposition(path)
    const fatal = fatalFaults(faults)
    allowPath(path)

    const asset: Asset = {
      id: randomUUID(),
      kind: 'html',
      name: basename(path),
      path,
      durationUs: info ? compositionDurationUs(info) : 0,
      width: info?.width ?? null,
      height: info?.height ?? null,
      fps: null,
      hasAudio: false,
      hasVideo: info !== null,
      posterPath: null,
      waveformPath: null,
      createdAt: Date.now(),
      ...(info ? { compositionId: info.compositionId } : {}),
      // Every fault, not the first: a composition with three problems has three, and the one
      // that hides best (a blocked remote resource) must not queue behind a louder one.
      ...(fatal.length > 0
        ? { error: fatal.map((f) => f.message).join(' ') }
        : {})
    }
    imported.push({ asset, reused: false })
  }
  return imported
}

/** The script that seeks the composition and waits for the paint that results. */
function seekScript(compositionId: string, seconds: number): string {
  return `(async () => {
    const tl = window.__timelines && window.__timelines[${JSON.stringify(compositionId)}]
    if (!tl) return { ok: false, why: 'no timeline registered as ' + ${JSON.stringify(compositionId)} }
    tl.time(${seconds})
    // Two frames: the first lets the tween's style writes land, the second lets the
    // compositor paint them. Measured sufficient — seeking the same time from three
    // different directions produced byte-identical captures.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { ok: true, at: tl.time() }
  })()`
}

async function open(request: CompositionFrameRequest): Promise<Entry | null> {
  const existing = entries.get(request.assetId)
  if (existing && existing.path === request.path) {
    existing.usedAt = Date.now()
    return existing
  }
  if (existing) release(request.assetId)

  const { info } = await inspectComposition(request.path)
  if (!info) return null

  if (entries.size >= MAX_WINDOWS) {
    const oldest = [...entries.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)[0]
    if (oldest) release(oldest[0])
  }

  const window = new BrowserWindow({
    show: false,
    width: info.width,
    height: info.height,
    webPreferences: {
      offscreen: true,
      // A composition is local HTML that must not reach the network, matching the renderer's
      // own CSP. It also gets no preload and no node integration: it is untrusted content
      // that an agent may have written.
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  const ready = (async () => {
    await window.loadFile(request.path)
    await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready
      // A composition may build its timeline inside an async callback, so the registry can be
      // a frame or two behind the load event. Waiting here rather than failing the first seek
      // turns a race into a bounded wait.
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (window.__timelines && window.__timelines[${JSON.stringify(info.compositionId)}]) return true
        await new Promise((r) => setTimeout(r, 16))
      }
      return false
    })()`)
  })()

  const entry: Entry = { window, path: request.path, info, ready, last: null, usedAt: Date.now() }
  entries.set(request.assetId, entry)
  return entry
}

export async function compositionFrameAt(
  request: CompositionFrameRequest
): Promise<CompositionFrame | null> {
  const entry = await open(request)
  if (!entry) return null

  try {
    await withTimeout(entry.ready, LOAD_TIMEOUT_MS, `${request.path} did not finish loading`)

    const seek = (await entry.window.webContents.executeJavaScript(
      seekScript(request.compositionId, seekSecondsFor(entry.info, request.atUs))
    )) as { ok: boolean; why?: string }
    if (!seek?.ok) return null

    const image = await entry.window.webContents.capturePage()
    const resized =
      request.width === entry.info.width && request.height === entry.info.height
        ? image
        : image.resize({ width: request.width, height: request.height, quality: 'better' })

    const raw = resized.toBitmap()
    const mismatch = describeSizeMismatch(raw.length, request.width, request.height)
    if (mismatch) return null

    const held = entry.last !== null && entry.last.equals(raw)
    entry.last = raw
    entry.usedAt = Date.now()

    // A fresh ArrayBuffer rather than a view onto the Buffer's pool: `Buffer` instances share
    // an allocation, so handing its `.buffer` across IPC would send whatever else happened to
    // be in that pool alongside the frame.
    const out = new ArrayBuffer(raw.length)
    const pixels = new Uint8Array(out)
    pixels.set(raw)
    bgraToRgba(pixels)
    return {
      data: out,
      width: request.width,
      height: request.height,
      held
    }
  } catch {
    // A composition that throws is a composition that draws nothing; the caller already has to
    // handle a source that is not ready, and a rejected frame would become a timeout instead.
    return null
  }
}

export function release(assetId: string): void {
  const entry = entries.get(assetId)
  if (!entry) return
  entries.delete(assetId)
  if (!entry.window.isDestroyed()) entry.window.destroy()
}

export function releaseAll(): void {
  for (const id of [...entries.keys()]) release(id)
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ])
}
