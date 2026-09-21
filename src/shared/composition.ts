/**
 * HyperFrames compositions as a source of pictures.
 *
 * A composition is an HTML file that declares its own timing and exposes a **paused** GSAP
 * timeline at `window.__timelines[<data-composition-id>]`. Seeking it is `timeline.time(t)`,
 * and the picture that results is a function of `t` alone. That last property is the whole
 * reason this can be a clip at all, and it is measured rather than assumed — 90 captures
 * across forward, reverse and shuffled orderings produced identical pixels for identical
 * times. A source whose output depended on how the playhead arrived could not be scrubbed.
 *
 * bay needs almost nothing from the HyperFrames toolchain to render one. The engine package
 * is Puppeteer driving Chrome into FFmpeg; bay already *is* Chromium and already owns an
 * export pipeline, so what it consumes is the **contract** — the attributes below — and not
 * the renderer. Everything here is therefore a reader of that contract, with no dependency to
 * drift against.
 *
 * Two facts about this file's units, because they are the ones that bite. A composition
 * declares `data-duration` in **seconds**, because that is what HyperFrames authors write.
 * Everything inside bay is frames or microseconds. The conversion happens here, at the edge,
 * and nowhere else.
 */

import type { Micros } from './project'

/**
 * File extensions bay treats as a composition rather than as media.
 *
 * Here rather than beside the importer because two consumers must agree: the import dialog
 * offers these, and the importer routes on them. A picker offering an extension the importer
 * hands to ffprobe produces a "could not be read" asset for a file the user was invited to
 * choose — and the two lists living in different files is how they drift.
 */
export const COMPOSITION_EXTENSIONS = ['html', 'htm', 'xhtml'] as const

/** Is this a file bay should treat as a composition rather than hand to ffprobe? */
export function isCompositionPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  const extension = path.slice(dot + 1).toLowerCase()
  return (COMPOSITION_EXTENSIONS as readonly string[]).includes(extension)
}

/** How long a composition is allowed to be. A typo in `data-duration` should not allocate. */
export const MAX_COMPOSITION_SECONDS = 60 * 30

/** What bay reads out of a composition file before it can be placed on a timeline. */
export interface CompositionInfo {
  /** `data-composition-id` on the root. The key its timeline registers under. */
  compositionId: string
  /** `data-duration`, in seconds as authored. */
  durationSeconds: number
  /** The root's declared pixel size. A composition is authored at a fixed size. */
  width: number
  height: number
}

/**
 * A problem with a composition, phrased as something to do about it.
 *
 * `line` is 1-based and present whenever the fault is attributable to one; an agent that has
 * just written the file needs to know *where*, and "somewhere in your HTML" costs it a full
 * re-read. `fatal` distinguishes "bay cannot place this at all" from "this will render but
 * not the way you meant".
 */
export interface CompositionFault {
  code: CompositionFaultCode
  message: string
  line: number | null
  fatal: boolean
}

export type CompositionFaultCode =
  | 'no-root'
  | 'no-composition-id'
  | 'bad-duration'
  | 'no-size'
  | 'remote-resource'
  | 'wrapped-in-template'

/**
 * Read a composition's declared shape out of its HTML.
 *
 * Deliberately a string parser rather than a DOM one: this runs in the main process, where
 * there is no DOM, and it runs before bay has decided the file is worth opening a window for.
 * It reads only attributes the author wrote, so it cannot disagree with the renderer about
 * anything the renderer computes.
 *
 * Returns the faults alongside whatever it could read, rather than throwing, because a
 * composition with three problems should report three.
 */
export function readComposition(html: string): {
  info: CompositionInfo | null
  faults: CompositionFault[]
} {
  const faults: CompositionFault[] = []
  const lineOf = (index: number): number => html.slice(0, index).split('\n').length

  const rootMatch = /<[a-zA-Z][^>]*\bdata-composition-id\s*=\s*["']([^"']*)["'][^>]*>/.exec(html)
  if (!rootMatch) {
    faults.push({
      code: 'no-root',
      message:
        'No element carries data-composition-id, so there is no composition root. The root is ' +
        'the element bay renders and the id is the key its timeline registers under — add ' +
        '<div data-composition-id="my-comp" data-duration="5" style="width:1920px;height:1080px">.',
      line: null,
      fatal: true
    })
    return { info: null, faults }
  }

  const rootTag = rootMatch[0]
  const rootLine = lineOf(rootMatch.index)
  const compositionId = (rootMatch[1] ?? '').trim()
  if (compositionId.length === 0) {
    faults.push({
      code: 'no-composition-id',
      message:
        'data-composition-id is empty. It has to name the key the timeline registers under, ' +
        'as window.__timelines["<id>"], or bay has nothing to seek.',
      line: rootLine,
      fatal: true
    })
  }

  // A standalone composition's root must not be inside <template>: the content would never be
  // in the document, and the page would render blank with no error anywhere.
  const beforeRoot = html.slice(0, rootMatch.index)
  const opens = (beforeRoot.match(/<template\b/gi) ?? []).length
  const closes = (beforeRoot.match(/<\/template\s*>/gi) ?? []).length
  if (opens > closes) {
    faults.push({
      code: 'wrapped-in-template',
      message:
        'The composition root is inside a <template>, so nothing renders and the page is blank. ' +
        'A <template> wrapper is for a sub-composition loaded through data-composition-src; a ' +
        'file bay opens directly must have its root in the document.',
      line: rootLine,
      fatal: true
    })
  }

  const durationAttr = /\bdata-duration\s*=\s*["']([^"']*)["']/.exec(rootTag)?.[1]
  const durationSeconds = durationAttr === undefined ? NaN : Number(durationAttr)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    faults.push({
      code: 'bad-duration',
      message:
        durationAttr === undefined
          ? 'The root has no data-duration, so bay cannot tell how long the clip is. Add ' +
            'data-duration="5" for five seconds.'
          : `data-duration="${durationAttr}" is not a positive number of seconds.`,
      line: rootLine,
      fatal: true
    })
  } else if (durationSeconds > MAX_COMPOSITION_SECONDS) {
    faults.push({
      code: 'bad-duration',
      message:
        `data-duration="${durationAttr}" is ${Math.round(durationSeconds / 60)} minutes, past ` +
        `the ${MAX_COMPOSITION_SECONDS / 60}-minute ceiling. This is almost always seconds and ` +
        `milliseconds confused — data-duration is in seconds.`,
      line: rootLine,
      fatal: true
    })
  }

  const size = readRootSize(rootTag)
  if (!size) {
    faults.push({
      code: 'no-size',
      message:
        'The root has no width and height in pixels. A composition is authored at a fixed size ' +
        'and an unsized root collapses to nothing, which renders as an empty frame rather than ' +
        'as an error — set style="width:1920px;height:1080px" on it.',
      line: rootLine,
      fatal: true
    })
  }

  // bay's CSP permits no remote origin, so a composition that fetches its libraries or fonts
  // renders without them and looks merely wrong. Cheaper to say so here.
  for (const remote of html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+["']/gi)) {
    faults.push({
      code: 'remote-resource',
      message:
        `This composition loads ${truncate(remote[0])} over the network. bay permits no remote ` +
        `origin — the request is blocked with no error on the page, so a missing library renders ` +
        `as a still frame and a missing font silently substitutes. Vendor the file next to the ` +
        `composition and reference it by relative path.`,
      line: lineOf(remote.index),
      fatal: false
    })
  }

  const usable = compositionId.length > 0 && size !== null && Number.isFinite(durationSeconds)
  return {
    info:
      usable && durationSeconds > 0 && durationSeconds <= MAX_COMPOSITION_SECONDS
        ? { compositionId, durationSeconds, width: size.width, height: size.height }
        : null,
    faults
  }
}

/** Width and height off the root's inline style, or its width/height attributes. */
function readRootSize(rootTag: string): { width: number; height: number } | null {
  const style = /\bstyle\s*=\s*["']([^"']*)["']/.exec(rootTag)?.[1] ?? ''
  const fromStyle = (prop: string): number | null => {
    const found = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([0-9.]+)px`, 'i').exec(style)
    return found ? Number(found[1]) : null
  }
  const fromAttr = (name: string): number | null => {
    const found = new RegExp(`\\b${name}\\s*=\\s*["']([0-9.]+)(?:px)?["']`, 'i').exec(rootTag)
    return found ? Number(found[1]) : null
  }
  const width = fromStyle('width') ?? fromAttr('width')
  const height = fromStyle('height') ?? fromAttr('height')
  if (width === null || height === null) return null
  if (!(width > 0) || !(height > 0)) return null
  return { width, height }
}

function truncate(text: string, max = 70): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** The fatal faults, which are the ones that stop a composition being placed at all. */
export function fatalFaults(faults: readonly CompositionFault[]): CompositionFault[] {
  return faults.filter((fault) => fault.fatal)
}

/** A composition's authored duration as bay counts source time. */
export function compositionDurationUs(info: CompositionInfo): Micros {
  return Math.round(info.durationSeconds * 1_000_000)
}

/**
 * The instant in the composition that item time `sourceUs` refers to, in **seconds**.
 *
 * Seconds because that is what `timeline.time()` takes, and the conversion belongs at this
 * boundary rather than at every call site. Clamped into the composition: seeking past the end
 * of a GSAP timeline holds its last frame, which is the right picture, but asking for it is
 * better expressed than relied upon.
 */
export function seekSecondsFor(info: CompositionInfo, sourceUs: Micros): number {
  const seconds = sourceUs / 1_000_000
  if (!Number.isFinite(seconds) || seconds < 0) return 0
  return Math.min(seconds, info.durationSeconds)
}
