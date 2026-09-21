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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow } from 'electron'
import type {
  CompositionFrame,
  CompositionFrameRequest,
  ImportedAsset
} from '@shared/ipc'
import type { Asset } from '@shared/project'
import {
  COMPOSITION_EXTENSIONS,
  isCompositionPath,
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

/** Resolved the same way main resolves its own preload: this bundle is ESM, so no __dirname. */
const here = fileURLToPath(new URL('.', import.meta.url))

/**
 * A session of its own, so a composition's storage, cookies and cache never touch the app's.
 * Named rather than incognito because the windows are reused across a session and a cold HTTP
 * cache per frame would show up as latency nobody could explain.
 */
const COMPOSITION_PARTITION = 'persist:bay-compositions'

/** How long to wait for a page to load and register its timeline before giving up. */
const LOAD_TIMEOUT_MS = 10_000


interface Entry {
  window: BrowserWindow
  path: string
  info: CompositionInfo
  ready: Promise<void>
  /** The previous frame's bytes, to tell a held picture from a fresh one. */
  last: Buffer | null
  /** The variable values currently applied to this page, as JSON, or null if none yet. */
  variables: string | null
  usedAt: number
}

const entries = new Map<string, Entry>()

export async function inspectComposition(
  path: string,
  includeHtml = false
): Promise<{ info: CompositionInfo | null; faults: CompositionFault[]; html?: string }> {
  try {
    const html = await readFile(path, 'utf8')
    return { ...readComposition(html), ...(includeHtml ? { html } : {}) }
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
 * Build the asset for one composition.
 *
 * A composition is never probed with ffprobe — ffprobe rejects the file, and everything it
 * would have reported the composition declares about itself. An unreadable one still becomes an
 * asset carrying `error`, the same as unreadable media does, so it lists in the media pool and
 * explains rather than vanishing.
 *
 * Exported as a single-asset builder rather than a batch importer so `media/import.ts` can own
 * deduplication and path registration for every kind alike. Two import paths, each with their
 * own idea of whether a file had already been imported, is how the same file ends up in the
 * pool twice with different ids.
 */
export async function compositionAsset(path: string): Promise<Asset> {
  const { info, faults } = await inspectComposition(path)
  const fatal = fatalFaults(faults)

  return {
    id: randomUUID(),
    kind: 'html',
    name: basename(path),
    path,
    durationUs: info ? compositionDurationUs(info) : 0,
    width: info?.width ?? null,
    height: info?.height ?? null,
    fps: null,
    // A composition can hold <audio>, but bay does not yet mix a composition's own sound —
    // saying it has audio would put a silent waveform in the inspector and an empty track in
    // an export. Claimed when it is true, not before.
    hasAudio: false,
    hasVideo: info !== null,
    posterPath: null,
    waveformPath: null,
    createdAt: Date.now(),
    ...(info
      ? { compositionId: info.compositionId, compositionVariables: info.variables }
      : {}),
    // Every fatal fault, not the first: a composition with three problems has three, and the
    // one that hides best must not queue behind a louder one.
    ...(fatal.length > 0 ? { error: fatal.map((f) => f.message).join(' ') } : {})
  }
}

export async function importCompositions(paths: string[]): Promise<ImportedAsset[]> {
  const imported: ImportedAsset[] = []
  for (const path of paths) {
    allowPath(path)
    imported.push({ asset: await compositionAsset(path), reused: false })
  }
  return imported
}

/**
 * Apply this clip's variable values to the page.
 *
 * Three bindings, matching the composition contract: every scalar becomes a `--{id}` custom
 * property on the root, `data-var-text` substitutes an element's own text, and `data-var-src`
 * substitutes a `src`. Text substitution deliberately writes only the element's **own** text
 * node, so a heading containing an animated `<span>` keeps its children.
 *
 * Applied before the seek and re-applied whenever the values differ from the last set, because
 * two clips of one composition share a window: rendering clip B after clip A without reapplying
 * would give B whichever text A had left behind.
 */
function variablesScript(
  values: Record<string, string | number | boolean>,
  css: Record<string, string>
): string {
  return `(() => {
    const values = ${JSON.stringify(values)}
    const css = ${JSON.stringify(css)}
    const root = document.querySelector('[data-composition-id]')
    if (!root) return false
    // The CSS form, with units: --inset: 96px, not 96.
    for (const [id, value] of Object.entries(css)) {
      root.style.setProperty('--' + id, value)
    }
    for (const el of document.querySelectorAll('[data-var-text]')) {
      const id = el.getAttribute('data-var-text')
      if (!(id in values)) continue
      let wrote = false
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          if (wrote) node.textContent = ''
          else { node.textContent = String(values[id]); wrote = true }
        }
      }
      if (!wrote) el.prepend(document.createTextNode(String(values[id])))
    }
    for (const el of document.querySelectorAll('[data-var-src]')) {
      const id = el.getAttribute('data-var-src')
      if (id in values && values[id]) el.setAttribute('src', String(values[id]))
    }
    return true
  })()`
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
    // A composition that does not paint its own background must capture as TRANSPARENT, not
    // as white. Without these two, `capturePage` composites the page onto opaque white and
    // every pixel comes back with alpha 255 — measured: 57,600 of 57,600. An overlay built
    // that way is a white rectangle over the footage, so lower thirds, captions, logos and
    // titles-over-video are all impossible, and the failure looks like the clip beneath having
    // vanished rather than like the overlay being wrong.
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    webPreferences: {
      // Offscreen rendering crashes the browser process outright at 1920x1080 — measured, and
      // it takes the whole app with it, which is not a size anyone can avoid: 1080p is the
      // default composition size. A plain hidden window paints and captures just as well.
      offscreen: false,
      // A composition is local HTML an agent may have written, so it gets no node integration
      // and a session of its own — it cannot reach Node, and nothing it stores touches the
      // app's.
      nodeIntegration: false,
      partition: COMPOSITION_PARTITION,
      backgroundThrottling: false,
      // `contextIsolation: false` so the preload lands in the page's own world, which is the
      // only place `window.__timelines` is any use. It is the whole reason this preload exists:
      // the published composition contract says a composition may assign into that registry
      // without creating it, and bay loads no runtime that would. The preload exposes nothing
      // else, and with node integration off there is no Node surface for it to leak.
      contextIsolation: false,
      sandbox: false,
      preload: join(here, '../preload/composition.mjs')
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

  const entry: Entry = {
    window, path: request.path, info, ready, last: null, variables: null, usedAt: Date.now()
  }
  entries.set(request.assetId, entry)
  return entry
}

/**
 * Is this one of the hidden windows a composition renders in?
 *
 * Exported because a composition window is a real `BrowserWindow`, so anything in main that
 * reaches for "the app window" via `BrowserWindow.getAllWindows()` will find one of these
 * instead the moment a composition is on the timeline. That is not hypothetical: it is how
 * every MCP tool call came to be delivered to a composition page with no listener, where it
 * sat until main's thirty second timeout while main, the renderer and the socket were all
 * healthy and nothing logged a thing.
 */
export function isCompositionWindow(window: BrowserWindow): boolean {
  for (const entry of entries.values()) {
    if (entry.window === window) return true
  }
  return false
}

export async function compositionFrameAt(
  request: CompositionFrameRequest
): Promise<CompositionFrame | null> {
  const entry = await open(request)
  if (!entry) return null

  try {
    await withTimeout(entry.ready, LOAD_TIMEOUT_MS, `${request.path} did not finish loading`)

    // Re-applied only when the values actually changed: it is a full DOM pass, and an export
    // runs it once per frame otherwise for no benefit.
    const wanted = JSON.stringify([request.variables ?? {}, request.cssVariables ?? {}])
    if (wanted !== entry.variables) {
      await entry.window.webContents.executeJavaScript(
        variablesScript(request.variables ?? {}, request.cssVariables ?? {})
      )
      entry.variables = wanted
    }

    const seek = (await entry.window.webContents.executeJavaScript(
      seekScript(request.compositionId, seekSecondsFor(entry.info, request.atUs))
    )) as { ok: boolean; why?: string }
    if (!seek?.ok) return null

    const image = await entry.window.webContents.capturePage()
    // ALWAYS resize, even when the request matches the composition's authored size.
    // `capturePage` returns **backing-store** pixels, so on a Retina display a 1920x1080 window
    // comes back 3840x2160. Skipping the resize because "the sizes already match" therefore
    // produced a buffer four times the expected length, the size check rejected it, and every
    // frame at exactly 1080p came back null — while 640x360 worked, because that request did
    // not match and so did get resized. The preview went black at the one size compositions
    // are actually authored at.
    const raw = image
      .resize({ width: request.width, height: request.height, quality: 'better' })
      .toBitmap()
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
  if (!entry.window.isDestroyed()) {
    // Detach before destroying: an attached debugger on a destroyed window logs a warning on
    // every release, which is noise in a log people are meant to read.
    try {
      if (entry.window.webContents.debugger.isAttached()) entry.window.webContents.debugger.detach()
    } catch {
      // Already gone.
    }
    entry.window.destroy()
  }
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


/**
 * Write a composition to disk.
 *
 * The only file bay writes on an agent's behalf. Everything else an agent does lands in the
 * project document, which is undoable and which the user is watching; a file on disk is
 * neither. So this refuses anything that is not a composition path rather than quietly
 * becoming a general-purpose file writer with a video editor attached — the extension check is
 * the whole security boundary and is meant to be read as one.
 *
 * Existing files are overwritten, because editing a composition is the normal case and a
 * refusal would force every edit through a delete. Directories are created, because a
 * composition usually wants a folder of its own for its vendored fonts and libraries.
 */
export async function writeComposition(
  path: string,
  html: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isCompositionPath(path)) {
    return {
      ok: false,
      error:
        `${path} is not a composition path. bay writes compositions and nothing else, so the ` +
        `path must end ${COMPOSITION_EXTENSIONS.map((e) => `.${e}`).join(', ')}.`
    }
  }
  if (!path.startsWith('/')) {
    return { ok: false, error: `${path} is not absolute. Give a full path from the root.` }
  }
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, html, 'utf8')
    allowPath(path)
    // A composition loads its fonts and libraries as siblings, so the directory has to be
    // reachable too — otherwise the file renders without the things it references and looks
    // merely wrong.
    allowPath(dirname(path))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `${path} could not be written: ${(error as Error).message}` }
  }
}