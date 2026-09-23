/**
 * Captions: SRT and WebVTT in, frame-timed cues out.
 *
 * Pure, so the whole of it is testable without a renderer, and shared, so the store and the
 * agent surface cannot disagree about what a file says.
 *
 * **Microseconds while parsing, frames only at the end.** A subtitle file is timed in wall
 * clock, like a source, so it is parsed into the model's source unit and converted once with
 * `usToFrames` — the one conversion `project.ts` owns. Rounding at every hop is how a caption
 * track drifts a frame by the end of a long programme.
 *
 * **Refuse, don't guess.** A malformed timestamp, a cue that ends before it starts, a block
 * with no timing line: each fails the whole parse with the line it is on. A parser that skipped
 * what it did not understand would place 199 of 200 captions and report success, and the
 * missing one is always the one someone notices on air. The single exception is a cue with no
 * text at all, which is dropped and *counted* — it would draw nothing, and refusing a whole
 * file over an empty cue that auto-generated subtitles are full of helps nobody.
 *
 * **Overlap is checked in frames, not microseconds.** Captions land as items on one track, and
 * items on one track may not overlap; what matters is whether they collide *after* rounding.
 * Two cues overlapping by a millisecond — rolling captions do this constantly — round onto the
 * same frame and simply abut. Two that genuinely overlap are refused with both named.
 */

import {
  defaultTextStyle,
  usToFrames,
  US_PER_SECOND,
  type Frames,
  type Layout,
  type Micros,
  type TextStyle,
  type Timeline
} from './project'

/** One caption, timed on the timeline. `toFrame` is the first frame it is *not* shown. */
export interface CaptionCue {
  fromFrame: Frames
  toFrame: Frames
  text: string
  /** Where it came from, for messages: `line 12` of a file, or `cues[3]` of an argument. */
  where?: string
}

/** One cue as a subtitle file times it, before it meets a frame rate. */
export interface TimedCue {
  startUs: Micros
  endUs: Micros
  text: string
  /** 1-based line of the timing line in the file. */
  line: number
}

export type SubtitleParse =
  | { ok: true; format: 'srt' | 'vtt'; cues: TimedCue[]; droppedEmpty: number }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/**
 * `HH:MM:SS,mmm`, `HH:MM:SS.mmm` or `MM:SS.mmm`, as microseconds; null if it is none of them.
 *
 * Both separators are accepted in both formats — SRT's comma and VTT's full stop get swapped
 * by every tool that has ever converted one to the other, and neither reading is ambiguous.
 * The fraction is a decimal fraction, so `1,5` is one and a half seconds, not one and five
 * thousandths. Minutes and seconds past 59 are refused rather than carried: `00:75:00` is a
 * typo, and silently reading it as 01:15:00 would move every caption after it.
 */
export function parseTimestamp(value: string): Micros | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (minutes > 59 || seconds > 59) return null
  const fraction = Number((match[4] ?? '0').padEnd(3, '0'))
  return ((hours * 60 + minutes) * 60 + seconds) * US_PER_SECOND + fraction * 1000
}

/** `00:01:02.345` — how a timestamp reads back in a message. */
export function formatTimestamp(us: Micros): string {
  const totalMs = Math.round(us / 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:` +
    `${pad(totalSeconds % 60)}.${pad(ms, 3)}`
  )
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&lrm;': '',
  '&rlm;': ''
}

/**
 * The words a cue line draws. Markup is removed rather than rendered: `<i>`, `<b>`, `<u>`,
 * VTT voice and class spans (`<v Anna>`, `<c.loud>`), karaoke timestamps (`<00:00:01.000>`)
 * and SSA override blocks (`{\an8}`) — bay's text items have one style per item, so a tag
 * left in would be drawn as literal angle brackets.
 */
function cueText(lines: string[]): string {
  return lines
    .map((line) =>
      line
        .replace(/<[^>]*>/g, '')
        .replace(/\{\\[^}]*\}/g, '')
        .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|lrm|rlm);/g, (entity) => ENTITIES[entity] ?? entity)
        .trim()
    )
    .filter((line) => line.length > 0)
    .join('\n')
}

/**
 * Parse an SRT or WebVTT document. The format is WebVTT when the first line says `WEBVTT`,
 * SRT otherwise.
 */
export function parseSubtitles(source: string): SubtitleParse {
  // Bare `\r` is a line end too (classic Mac exports), so it is normalised before splitting.
  // There is no explicit byte-order-mark strip: every line is read through `trim()`, which
  // treats U+FEFF as whitespace, and a strip that nothing could observe was deleted.
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const firstContent = lines.find((line) => line.trim().length > 0)?.trim() ?? ''
  if (firstContent === '') {
    return { ok: false, error: 'The subtitle text is empty, so there are no captions to place.' }
  }
  const format: 'srt' | 'vtt' = /^WEBVTT(\s|$)/.test(firstContent) ? 'vtt' : 'srt'

  // Group into blocks of consecutive non-blank lines, remembering where each starts.
  const blocks: { start: number; lines: string[] }[] = []
  let current: { start: number; lines: string[] } | null = null
  lines.forEach((line, index) => {
    if (line.trim() === '') {
      current = null
      return
    }
    if (!current) {
      current = { start: index + 1, lines: [] }
      blocks.push(current)
    }
    current.lines.push(line)
  })

  const cues: TimedCue[] = []
  let droppedEmpty = 0
  for (const [blockIndex, block] of blocks.entries()) {
    const head = block.lines[0]!.trim()
    if (format === 'vtt') {
      if (blockIndex === 0 && head.startsWith('WEBVTT')) continue
      // Comments and the style and region definitions WebVTT allows between cues.
      if (/^(NOTE|STYLE|REGION)(\s|$)/.test(head)) continue
    }

    const timingAt = block.lines.findIndex((line) => line.includes('-->'))
    if (timingAt < 0) {
      return {
        ok: false,
        error:
          `Line ${block.start} starts a block with no timing line ("${head.slice(0, 40)}"). Every ` +
          `cue needs one such as "00:00:01,000 --> 00:00:03,500"${format === 'srt' ? ' after its number' : ''}.`
      }
    }
    const line = block.start + timingAt
    const timing = block.lines[timingAt]!
    const [startText = '', rest = ''] = timing.split('-->')
    // Anything after the end time on a VTT timing line is cue settings (`align:start`).
    const endText = rest.trim().split(/\s+/)[0] ?? ''
    const startUs = parseTimestamp(startText)
    const endUs = parseTimestamp(endText)
    if (startUs === null || endUs === null) {
      const bad = startUs === null ? startText.trim() : endText
      return {
        ok: false,
        error:
          `Line ${line} has a timestamp bay cannot read: "${bad}". Timestamps look like ` +
          `00:01:02,345 (SRT) or 00:01:02.345 (WebVTT), with minutes and seconds below 60.`
      }
    }
    if (endUs <= startUs) {
      return {
        ok: false,
        error:
          `The cue on line ${line} ends at ${formatTimestamp(endUs)}, which is not after it ` +
          `starts at ${formatTimestamp(startUs)}. Fix its end time.`
      }
    }
    const text = cueText(block.lines.slice(timingAt + 1))
    if (text === '') {
      droppedEmpty += 1
      continue
    }
    cues.push({ startUs, endUs, text, line })
  }

  if (cues.length === 0) {
    return {
      ok: false,
      error:
        droppedEmpty > 0
          ? `${droppedEmpty === 1 ? 'The only cue is' : `All ${droppedEmpty} cues are`} empty, so ` +
            `there are no words to place.`
          : 'No cues were found. An SRT cue is a number, a timing line such as ' +
            '"00:00:01,000 --> 00:00:03,500", and its text, separated by blank lines.'
    }
  }
  return { ok: true, format, cues, droppedEmpty }
}

/** File-timed cues onto a timeline's frame grid, through the model's own conversion. */
export function cuesToFrames(cues: readonly TimedCue[], fps: number): CaptionCue[] {
  return cues.map((cue) => ({
    fromFrame: usToFrames(cue.startUs, fps),
    toFrame: usToFrames(cue.endUs, fps),
    text: cue.text,
    where: `line ${cue.line}`
  }))
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 32 ? `${flat.slice(0, 31)}…` : flat
}

function label(cue: CaptionCue, index: number): string {
  return `cue ${index + 1}${cue.where ? ` (${cue.where})` : ''}, frames ${cue.fromFrame}-${cue.toFrame} "${snippet(cue.text)}"`
}

/**
 * Whether these cues can all sit on one track. Returns the first problem, naming the cue — or
 * for an overlap, *both* cues and the frame that would fix it — or null when they can.
 *
 * `fps` is only for the message: a cue that rounded to nothing is shorter than a frame *at this
 * rate*, and saying which rate is what tells the caller why a file that plays fine elsewhere
 * was refused.
 */
export function checkCues(cues: readonly CaptionCue[], fps: number): string | null {
  if (cues.length === 0) return 'No cues were given, so there are no captions to place.'
  for (const [index, cue] of cues.entries()) {
    if (!Number.isInteger(cue.fromFrame) || !Number.isInteger(cue.toFrame)) {
      return `${label(cue, index)} has a frame that is not a whole number.`
    }
    if (cue.fromFrame < 0) {
      return `${label(cue, index)} starts before frame 0. Shift it later, or drop it.`
    }
    if (cue.toFrame <= cue.fromFrame) {
      return cue.toFrame === cue.fromFrame
        ? `${label(cue, index)} is shorter than one frame at ${Number(fps.toFixed(3))}fps, so it ` +
            `would never be seen. Lengthen it or drop it.`
        : `${label(cue, index)} ends before it starts. toFrame is the first frame not shown.`
    }
    if (cue.text.trim() === '') return `${label(cue, index)} has no text.`
  }

  const order = cues.map((cue, index) => ({ cue, index })).sort((a, b) => a.cue.fromFrame - b.cue.fromFrame)
  for (let i = 1; i < order.length; i += 1) {
    const earlier = order[i - 1]!
    const later = order[i]!
    if (later.cue.fromFrame < earlier.cue.toFrame) {
      return (
        `${label(earlier.cue, earlier.index)} overlaps ${label(later.cue, later.index)} by ` +
        `${earlier.cue.toFrame - later.cue.fromFrame} frames. Captions share one track, so they ` +
        `cannot overlap: end the first at frame ${later.cue.fromFrame}, or start the second at ` +
        `${earlier.cue.toFrame}.`
      )
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

/**
 * Where captions sit: a band across the lower third, inset from the edges, with the words
 * anchored to its bottom so one line and three lines share a baseline region rather than one
 * floating up the frame.
 */
export function captionLayout(timeline: Pick<Timeline, 'width' | 'height'>): Layout {
  const insetX = Math.round(timeline.width * 0.05)
  return {
    left: insetX,
    top: Math.round(timeline.height * 0.6),
    width: timeline.width - insetX * 2,
    height: Math.round(timeline.height * 0.32),
    opacity: 1,
    rotation: 0
  }
}

/**
 * The caption look: white on a translucent plate, sized to the frame's height so a vertical
 * video's captions are not the size of a landscape one's. The plate is what makes captions
 * legible over any footage without knowing what the footage is.
 */
export function captionStyle(timeline: Pick<Timeline, 'height'>): TextStyle {
  const fontSize = Math.max(12, Math.round(timeline.height * 0.05))
  return {
    ...defaultTextStyle(fontSize),
    verticalAlign: 'bottom',
    background: {
      color: '#000000B3',
      padding: Math.round(fontSize * 0.3),
      radius: Math.round(fontSize * 0.15)
    }
  }
}

/** The media-pool name for a caption's text asset: its first words. */
export function captionAssetName(text: string): string {
  return `Caption: ${snippet(text)}`
}
