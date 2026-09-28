/**
 * HyperFrames compositions as a source of pictures.
 *
 * A composition is an HTML file that declares its own timing and exposes a timeline — any
 * object with `time(seconds)` and `duration()` — at `window.__timelines[<data-composition-id>]`. Seeking it is `timeline.time(t)`,
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

/**
 * A knob a composition declares for its own contents.
 *
 * Declared by the author on `<html data-composition-variables='[...]'>`, which is what makes
 * this tractable at all: bay does not guess at which parts of arbitrary HTML are editable, it
 * renders the controls the composition says it has. A composition with no declarations is
 * simply not configurable, which is honest — the alternative is an inspector full of fields
 * that change nothing.
 *
 * The types are the HyperFrames set, because the compositions bay renders are written against
 * that contract and a second vocabulary would mean two things to satisfy.
 */
export type CompositionVariableType = 'string' | 'number' | 'color' | 'boolean' | 'enum'

export type CompositionVariableValue = string | number | boolean

export interface CompositionVariable {
  id: string
  type: CompositionVariableType
  label: string
  default: CompositionVariableValue
  /** `string` only. */
  placeholder?: string
  maxLength?: number
  /** `number` only. */
  min?: number
  max?: number
  step?: number
  unit?: string
  /** `enum` only, and required there — an enum with no options is a control with no choices. */
  options?: { value: string; label: string }[]
}

/** What bay reads out of a composition file before it can be placed on a timeline. */
export interface CompositionInfo {
  /** `data-composition-id` on the root. The key its timeline registers under. */
  compositionId: string
  /**
   * The knobs this composition declares, in the order it declared them.
   *
   * Order is the author's and is preserved: it is the order the controls appear in, and an
   * inspector that sorted them alphabetically would scatter a deliberate grouping.
   */
  variables: CompositionVariable[]
  /** `data-duration`, in seconds as authored. */
  durationSeconds: number
  /** The root's declared pixel size. A composition is authored at a fixed size. */
  width: number
  height: number
  /**
   * The sounds this composition declares, in document order — see {@link CompositionSound}.
   *
   * Reported even when empty, because "declares no sound" and "bay did not look" are different
   * answers, and a composition that is silent in bay has to be told apart from one bay skipped.
   * When this came through main's `inspectComposition`, only sounds that will actually play are
   * listed — a missing or undecodable file is a fault instead, never an entry.
   */
  audio: CompositionSound[]
}

/**
 * One sound a composition declares, read from an `<audio>` element.
 *
 * **Declared, not captured.** bay never listens to what a composition page plays — the page is
 * a hidden window seeked frame by frame, so its media elements neither run in real time nor
 * reach the mix. What bay does is read the same markup the HyperFrames mixer reads —
 * `audio[id][src]` with `data-start`, `data-duration`, `data-media-start` and `data-volume` —
 * and mix that file itself: in preview through the clip audio path, in export as one more
 * input to the ffmpeg graph. The HyperFrames vocabulary rather than a bay-specific attribute,
 * because a composition written to that contract should sound the same in both, and a second
 * vocabulary would be two things to satisfy.
 *
 * All times here are **seconds**, as authored, like `data-duration` on the root. They become
 * timeline positions in `composition-audio.ts`, and nowhere else.
 */
export interface CompositionSound {
  /** The element's `id`. Required, as in HyperFrames: an id-less `<audio>` is never mixed. */
  id: string
  /** `src` exactly as written. */
  src: string
  /**
   * The absolute file `src` names, resolved against the composition's own directory; null
   * when the reader was not told where the composition lives.
   */
  path: string | null
  /** `data-start`: when, in composition time, the sound begins. */
  startSeconds: number
  /** `data-duration`, or null to play until the file (or the composition) ends. */
  durationSeconds: number | null
  /** `data-media-start`: how far into the file playback begins. */
  mediaStartSeconds: number
  /** `data-volume`: a static linear gain, 0..{@link MAX_SOUND_VOLUME}. */
  volume: number
  /** 1-based line of the `<audio>` tag, so a fault about it can say where. */
  line: number
}

/** HyperFrames' ceiling on `data-volume`: +12 dB. */
export const MAX_SOUND_VOLUME = 3.98

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
  | 'remote-script'
  | 'outside-folder'
  | 'wrapped-in-template'
  | 'bad-variables'
  | 'bad-audio'

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
export function readComposition(html: string, compositionPath?: string): {
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

  // Sounds first, because the remote-resource scan below must not report an <audio> twice: the
  // audio reader already says the same thing, plus the part that matters to it — that the sound
  // will not be mixed.
  const { audio, audioFaults, audioTags } = readAudio(html, lineOf, compositionPath ?? null)

  // bay's CSP permits no remote origin, so a composition that fetches its libraries or fonts
  // renders without them and looks merely wrong. Cheaper to say so here.
  // A remote *script* is its own code, because it is worse than a missing font: whatever the page
  // builds its timeline with never arrives, so the clip is a still frame. `write_composition`
  // refuses it (`faultsOnWrite`); here, where a file already on disk is read, it stays a warning
  // so a project that already holds one still opens.
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length
  }))
  for (const remote of html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+["']/gi)) {
    if (audioTags.some((tag) => remote.index >= tag.start && remote.index < tag.end)) continue
    if (scriptTags.some((tag) => remote.index >= tag.start && remote.index < tag.end)) {
      const line = lineOf(remote.index)
      faults.push({
        code: 'remote-script',
        message:
          `Line ${line} loads a script over the network (${truncate(remote[0])}). A composition ` +
          `may load only files in its own folder, so this script never runs and anything built ` +
          `with it (a GSAP timeline, say: "gsap is not defined") is missing — the clip renders ` +
          `as a still frame. bay ships no animation library. Delete the tag and register a plain ` +
          `timeline instead: window.__timelines["<id>"] = { time(t) { /* set styles from t */ }, ` +
          `duration: () => <seconds> } (bay://guide/composition/minimal). Or copy a library ` +
          `you are licensed to use next to the composition and load it by relative path.`,
        line,
        fatal: false
      })
      continue
    }
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

  // And a composition's window may load only from its own folder (main's sandbox), so a path that
  // climbs out of it, or names an absolute file, is blocked just as silently.
  for (const outside of html.matchAll(/(?:src|href)\s*=\s*["']((?:\.\.\/|\/(?!\/)|file:)[^"']*)["']/gi)) {
    if (audioTags.some((tag) => outside.index >= tag.start && outside.index < tag.end)) continue
    faults.push({
      code: 'outside-folder',
      message:
        `This composition loads ${truncate(outside[1] ?? '')}, which is outside its own folder. A ` +
        `composition may load only files in its folder or below — anything else is blocked with ` +
        `no error on the page. Copy the file next to the composition and reference it by relative path.`,
      line: lineOf(outside.index),
      fatal: false
    })
  }

  const { variables, variableFaults } = readVariables(html, lineOf)
  faults.push(...variableFaults)
  faults.push(...audioFaults)

  // A sound that starts at or after the composition ends is declared and never heard. Checked
  // here rather than in `readAudio` because it needs the duration, and only once that is good.
  const audible = audio.filter((sound) => {
    if (!(durationSeconds > 0) || sound.startSeconds < durationSeconds) return true
    faults.push({
      code: 'bad-audio',
      message:
        `<audio id="${sound.id}"> starts at ${sound.startSeconds}s, at or after the ` +
        `composition ends (data-duration="${durationAttr}"), so it is never heard. data-start ` +
        `is seconds from the start of this composition.`,
      line: sound.line,
      fatal: false
    })
    return false
  })

  const usable = compositionId.length > 0 && size !== null && Number.isFinite(durationSeconds)
  return {
    info:
      usable && durationSeconds > 0 && durationSeconds <= MAX_COMPOSITION_SECONDS
        ? {
            compositionId,
            durationSeconds,
            width: size.width,
            height: size.height,
            variables,
            audio: audible
          }
        : null,
    faults
  }
}

/** One attribute's value off a tag, entity-decoded, or undefined when it is absent. */
function attributeOf(tag: string, name: string): string | undefined {
  const found = new RegExp(
    `\\s${name.replace(/-/g, '\\-')}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'i'
  ).exec(tag)
  if (!found) return undefined
  return decodeEntities(found[1] ?? found[2] ?? found[3] ?? '')
}

/**
 * Where a sound's `src` points on disk, or why it cannot be played.
 *
 * Resolved the way the page itself resolves it — relative to the composition's own file —
 * because the composition window loads that file with `loadFile`, and a `src` that meant one
 * file to the page and another to bay's mix would be two meanings for one attribute.
 * Percent-escapes are decoded (`my%20whoosh.wav` is `my whoosh.wav` to a browser), and a query
 * or fragment is dropped, since neither names a different file.
 *
 * Pure string work rather than `node:path`, because this module is shared with the renderer.
 */
function resolveSoundSource(
  compositionPath: string,
  src: string
): { path: string } | { remote: true } | { unsupported: string } {
  const trimmed = src.trim()
  if (/^(?:https?:)?\/\//i.test(trimmed)) return { remote: true }
  let rest = trimmed
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (scheme) {
    const name = (scheme[1] ?? '').toLowerCase()
    if (name !== 'file') return { unsupported: name }
    rest = trimmed.replace(/^file:(?:\/\/[^/]*)?/i, '')
  }
  rest = rest.replace(/[?#].*$/, '')
  try {
    rest = decodeURIComponent(rest)
  } catch {
    // A stray `%` is a literal percent sign in a filename, which is how a browser reads it too.
  }
  const base = rest.startsWith('/') ? '' : compositionPath.slice(0, compositionPath.lastIndexOf('/'))
  const parts: string[] = []
  for (const part of `${base}/${rest}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return { path: `/${parts.join('/')}` }
}

/** A number off an attribute: null when absent, NaN when present and not a number. */
function numberAttribute(tag: string, name: string): number | null {
  const raw = attributeOf(tag, name)
  if (raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed.length === 0 ? Number.NaN : Number(trimmed)
}

/**
 * The sounds a composition declares, and everything that keeps one from playing.
 *
 * Nothing here is fatal. A composition whose whoosh cannot be found still renders its picture,
 * and refusing the clip over a sound would be out of proportion — but every sound that will
 * not play gets a fault saying so, with its line, because silence is the failure nobody sees.
 */
function readAudio(
  html: string,
  lineOf: (index: number) => number,
  compositionPath: string | null
): {
  audio: CompositionSound[]
  audioFaults: CompositionFault[]
  audioTags: { start: number; end: number }[]
} {
  const audio: CompositionSound[] = []
  const audioFaults: CompositionFault[] = []
  const audioTags: { start: number; end: number }[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(/<audio\b[^>]*>/gi)) {
    const tag = match[0]
    audioTags.push({ start: match.index, end: match.index + tag.length })
    const line = lineOf(match.index)
    const fault = (message: string): void => {
      audioFaults.push({ code: 'bad-audio', message, line, fatal: false })
    }

    const id = (attributeOf(tag, 'id') ?? '').trim()
    const src = (attributeOf(tag, 'src') ?? '').trim()
    const named = id.length > 0 ? `<audio id="${id}">` : 'An <audio> element'
    if (src.length === 0) {
      fault(
        `${named} has no src attribute, so it is not mixed. bay reads the src attribute only — ` +
          `not <source> children and not a src set from script — so name the file there, ` +
          `relative to this composition: src="./whoosh.wav".`
      )
      continue
    }
    if (id.length === 0) {
      fault(
        `An <audio> with src="${truncate(src)}" has no id, so it is not mixed — the HyperFrames ` +
          `mixer selects audio[id][src], and bay reads the same declarations so a composition ` +
          `sounds the same in both. Add id="whoosh".`
      )
      continue
    }
    if (seen.has(id)) {
      fault(`${named} repeats an id another <audio> already uses; only the first is mixed.`)
      continue
    }

    const remote = /^(?:https?:)?\/\//i.test(src)
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(src)?.[1]?.toLowerCase()
    if (remote) {
      fault(
        `${named} loads ${truncate(src)} over the network. bay permits no remote origin, so this ` +
          `sound is not mixed in preview or export. Save the file next to the composition and ` +
          `set src to its relative path.`
      )
      continue
    }
    if (scheme !== undefined && scheme !== 'file') {
      fault(
        `${named} has a ${scheme}: src, which bay cannot mix — only a file on disk can be an ` +
          `export input. Save the sound next to the composition and set src to its relative path.`
      )
      continue
    }
    let path: string | null = null
    if (compositionPath !== null) {
      const resolved = resolveSoundSource(compositionPath, src)
      if ('path' in resolved) path = resolved.path
    }

    let startSeconds = numberAttribute(tag, 'data-start')
    if (startSeconds === null) {
      fault(
        `${named} has no data-start, so bay starts it at 0s. Add data-start="0" to say so, or ` +
          `the second in this composition where it should begin.`
      )
      startSeconds = 0
    } else if (!Number.isFinite(startSeconds) || startSeconds < 0) {
      fault(
        `${named} has data-start="${attributeOf(tag, 'data-start')}", which is not a ` +
          `non-negative number of seconds, so it is not mixed.`
      )
      continue
    }

    let durationSeconds = numberAttribute(tag, 'data-duration')
    if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
      fault(
        `${named} has data-duration="${attributeOf(tag, 'data-duration')}", which is not a ` +
          `positive number of seconds; bay plays it until the file or the composition ends.`
      )
      durationSeconds = null
    }

    let mediaStartSeconds = numberAttribute(tag, 'data-media-start') ?? 0
    if (!Number.isFinite(mediaStartSeconds) || mediaStartSeconds < 0) {
      fault(
        `${named} has data-media-start="${attributeOf(tag, 'data-media-start')}", which is not ` +
          `a non-negative number of seconds; bay plays it from the start of the file.`
      )
      mediaStartSeconds = 0
    }

    let volume = numberAttribute(tag, 'data-volume') ?? 1
    if (!Number.isFinite(volume) || volume < 0) {
      fault(
        `${named} has data-volume="${attributeOf(tag, 'data-volume')}", which is not a ` +
          `non-negative gain; bay mixes it at 1.`
      )
      volume = 1
    } else if (volume > MAX_SOUND_VOLUME) {
      fault(
        `${named} has data-volume="${volume}", past the ${MAX_SOUND_VOLUME} (+12 dB) ceiling; ` +
          `bay mixes it at ${MAX_SOUND_VOLUME}.`
      )
      volume = MAX_SOUND_VOLUME
    }

    seen.add(id)
    audio.push({ id, src, path, startSeconds, durationSeconds, mediaStartSeconds, volume, line })
  }

  // The documented way to fade a HyperFrames sound is to tween its `volume` on the timeline.
  // bay seeks the page for pictures and mixes the file itself, so it never sees that tween —
  // saying so is the difference between "my fade is ignored" and a mystery.
  if (audio.length > 0) {
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      const body = script[1] ?? ''
      const at = /\bvolume\s*:/.exec(body)
      if (!at) continue
      const bodyStart = script.index + script[0].indexOf(body)
      audioFaults.push({
        code: 'bad-audio',
        message:
          "This composition tweens volume in script. bay mixes a composition's sounds at their " +
          'static data-volume and does not follow volume tweens, so that fade is not heard in ' +
          "bay. Fade the clip instead — the clip's fades and volume on the timeline apply to " +
          'every sound it declares.',
        line: lineOf(bodyStart + at.index),
        fatal: false
      })
      break
    }
  }

  return { audio, audioFaults, audioTags }
}

/**
 * The variables a composition declares, and anything wrong with the declaration.
 *
 * A malformed declaration is never fatal. The composition still renders — it just renders at
 * its defaults with no controls — and refusing to place a clip because a JSON attribute has a
 * trailing comma would be wildly out of proportion to the harm.
 */
function readVariables(
  html: string,
  lineOf: (index: number) => number
): { variables: CompositionVariable[]; variableFaults: CompositionFault[] } {
  const match = /<html[^>]*\bdata-composition-variables\s*=\s*(['"])([\s\S]*?)\1/i.exec(html)
  if (!match) return { variables: [], variableFaults: [] }

  const line = lineOf(match.index)
  const reject = (message: string): { variables: CompositionVariable[]; variableFaults: CompositionFault[] } => ({
    variables: [],
    variableFaults: [{ code: 'bad-variables', message, line, fatal: false }]
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(decodeEntities(match[2] ?? ''))
  } catch (error) {
    return reject(
      `data-composition-variables is not valid JSON (${(error as Error).message}), so this ` +
        `composition offers no controls. It still renders at its defaults.`
    )
  }
  if (!Array.isArray(parsed)) {
    return reject('data-composition-variables must be a JSON array of declarations.')
  }

  const variables: CompositionVariable[] = []
  const variableFaults: CompositionFault[] = []
  const seen = new Set<string>()

  for (const [index, raw] of parsed.entries()) {
    const at = `declaration ${index + 1}`
    if (typeof raw !== 'object' || raw === null) {
      variableFaults.push({ code: 'bad-variables', message: `${at} is not an object.`, line, fatal: false })
      continue
    }
    const entry = raw as Record<string, unknown>
    const id = typeof entry['id'] === 'string' ? entry['id'].trim() : ''
    if (id.length === 0) {
      variableFaults.push({ code: 'bad-variables', message: `${at} has no id.`, line, fatal: false })
      continue
    }
    if (seen.has(id)) {
      // Two controls writing one name is a control that silently loses.
      variableFaults.push({
        code: 'bad-variables',
        message: `${at} repeats the id "${id}"; only the first is used.`,
        line,
        fatal: false
      })
      continue
    }
    const type = entry['type']
    if (!isVariableType(type)) {
      variableFaults.push({
        code: 'bad-variables',
        message: `"${id}" has type ${JSON.stringify(type)}, which is not one of string, number, color, boolean, enum.`,
        line,
        fatal: false
      })
      continue
    }
    if (type === 'enum' && !Array.isArray(entry['options'])) {
      variableFaults.push({
        code: 'bad-variables',
        message: `"${id}" is an enum with no options, which is a control with no choices in it.`,
        line,
        fatal: false
      })
      continue
    }

    seen.add(id)
    const declared: CompositionVariable = {
      id,
      type,
      label: typeof entry['label'] === 'string' && entry['label'].length > 0 ? entry['label'] : id,
      default: coerce(entry['default'], type) ?? fallbackFor(type)
    }
    if (typeof entry['placeholder'] === 'string') declared.placeholder = entry['placeholder']
    if (typeof entry['maxLength'] === 'number') declared.maxLength = entry['maxLength']
    if (typeof entry['min'] === 'number') declared.min = entry['min']
    if (typeof entry['max'] === 'number') declared.max = entry['max']
    if (typeof entry['step'] === 'number') declared.step = entry['step']
    if (typeof entry['unit'] === 'string') declared.unit = entry['unit']
    if (type === 'enum') {
      declared.options = (entry['options'] as unknown[])
        .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
        .map((o) => ({
          value: String(o['value'] ?? ''),
          label: String(o['label'] ?? o['value'] ?? '')
        }))
    }
    variables.push(declared)
  }

  return { variables, variableFaults }
}

function isVariableType(value: unknown): value is CompositionVariableType {
  return (
    value === 'string' || value === 'number' || value === 'color' ||
    value === 'boolean' || value === 'enum'
  )
}

function fallbackFor(type: CompositionVariableType): CompositionVariableValue {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'color') return '#ffffff'
  return ''
}

/**
 * A value as its declared type, or null when it cannot be one.
 *
 * Coerced rather than rejected because these come out of a hand-written HTML attribute, where
 * `"default": "12"` for a number is a typo and not a different intention.
 */
export function coerce(
  value: unknown,
  type: CompositionVariableType
): CompositionVariableValue | null {
  if (value === undefined || value === null) return null
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
    return null
  }
  return typeof value === 'object' ? null : String(value)
}

/** `&quot;` and friends, because the declaration lives inside an HTML attribute. */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
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

/**
 * The faults as `write_composition` weighs them: a remote script is fatal there.
 *
 * Fatal on write and a warning on read, deliberately. At write time the author is the caller and
 * can fix it in the next call, the file is on disk to edit, and there is no configuration in which
 * the script runs — the sandbox cancels the request, the CSP forbids it, and nothing warns on the
 * page. Accepting it means placing a clip that is a still frame and reporting success. On read the
 * file may be an existing project's, whose owner is not the one calling: refusing it there would
 * stop a project that opened yesterday from opening today. A remote font or stylesheet stays a
 * warning on both sides, because the page still renders, only with a substituted face.
 */
export function faultsOnWrite(faults: readonly CompositionFault[]): CompositionFault[] {
  return faults.map((fault) => (fault.code === 'remote-script' ? { ...fault, fatal: true } : fault))
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

/**
 * The values a composition should render with: its declared defaults, with this clip's
 * overrides on top.
 *
 * Per **item**, not per asset, and that is the point of the feature. One lower-third
 * composition placed four times should be able to name four different people; storing the
 * values on the asset would make every instance say the same thing and turn a template into a
 * single-use graphic.
 *
 * Undeclared keys are dropped rather than passed through. An override for a variable the
 * composition no longer declares is a leftover from an earlier version of the file, and
 * forwarding it would set a CSS custom property nothing reads — invisible, permanent, and
 * impossible to clear from the inspector because no control would be drawn for it.
 */
export function resolveVariables(
  info: Pick<CompositionInfo, 'variables'>,
  overrides: Record<string, CompositionVariableValue> | undefined
): Record<string, CompositionVariableValue> {
  const out: Record<string, CompositionVariableValue> = {}
  for (const variable of info.variables) {
    const override = overrides?.[variable.id]
    const coerced = override === undefined ? null : coerce(override, variable.type)
    out[variable.id] = coerced ?? variable.default
  }
  return out
}

/**
 * A stable string for a set of values, for cache keys.
 *
 * Sorted by id so two items with the same values in a different insertion order share a cached
 * frame rather than rendering it twice. Without this in the key, two lower thirds naming
 * different people would show whichever one rendered first — the cache would hand the second
 * clip the first clip's picture, and nothing would look broken.
 */
export function variablesKey(values: Record<string, CompositionVariableValue>): string {
  const ids = Object.keys(values).sort()
  if (ids.length === 0) return ''
  return ids.map((id) => `${id}=${String(values[id])}`).join('\u0001')
}

/**
 * The values as CSS custom properties — the same values, with their declared units attached.
 *
 * A number is two different strings depending on where it lands. `--inset: 96` makes
 * `left: var(--inset)` invalid CSS, so the declaration is dropped and the element falls back to
 * its unpositioned default; the author sees their box pinned to the frame edge and no error
 * anywhere. `--inset: 96px` is what they meant. But `data-var-text="inset"` wants `96`, because
 * a caption reading "96px" is not what anyone declared a number for.
 *
 * So both forms are produced, and which one is used depends on where the value is going.
 */
export function cssVariables(
  info: Pick<CompositionInfo, 'variables'>,
  values: Record<string, CompositionVariableValue>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const variable of info.variables) {
    const value = values[variable.id]
    if (value === undefined) continue
    out[variable.id] =
      variable.type === 'number' && variable.unit ? `${value}${variable.unit}` : String(value)
  }
  return out
}
