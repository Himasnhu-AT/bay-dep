/**
 * Pins: what the user points the agent at, from the composer's `@` menu.
 *
 * A pinned asset, clip or stretch of time travels with the message as a short context block the
 * model reads before the request. The block names ids and frames exactly, because the agent's
 * tools take ids and frames — "the interview clip" makes it search; `itm_ab12cd34` does not.
 *
 * A pinned **range** is also a promise the user is asking the agent to keep: change nothing
 * outside it. The block says so in those words, and the proposal the agent must make before any
 * write lists every call with its frames, so a plan that reaches outside the range is visible on
 * the card before anyone approves it.
 */

import { formatTimecode } from './project'

export type Pin =
  | {
      kind: 'asset'
      assetId: string
      name: string
      assetKind: string
      durationUs: number | null
    }
  | { kind: 'clip'; itemId: string; name: string; trackName: string; fromFrame: number; toFrame: number }
  /** Half-open, like `remove_range`: `toFrame` is the first frame NOT included. */
  | { kind: 'range'; fromFrame: number; toFrame: number }

/** A stable identity, so the same thing cannot be pinned twice. */
export function pinKey(pin: Pin): string {
  switch (pin.kind) {
    case 'asset':
      return `asset:${pin.assetId}`
    case 'clip':
      return `clip:${pin.itemId}`
    case 'range':
      return `range:${pin.fromFrame}-${pin.toFrame}`
  }
}

/** How a pin reads on its chip. */
export function pinLabel(pin: Pin, fps: number): string {
  switch (pin.kind) {
    case 'asset':
      return pin.name
    case 'clip':
      return `${pin.name} · ${pin.trackName}`
    case 'range':
      return `${formatTimecode(pin.fromFrame, fps, true)}–${formatTimecode(pin.toFrame, fps, true)}`
  }
}

/**
 * The message as the agent receives it: a context block, then what the user wrote.
 *
 * With no pins the text is sent exactly as typed — a context block with nothing in it is noise
 * the model would try to interpret.
 */
export function composeMessage(text: string, pins: readonly Pin[], fps: number): string {
  if (pins.length === 0) return text
  const tc = (frame: number): string => formatTimecode(frame, fps, true)
  const lines = pins.map((pin) => {
    switch (pin.kind) {
      case 'asset':
        return `- Asset "${pin.name}" (${pin.assetKind}, assetId ${pin.assetId}).`
      case 'clip':
        return (
          `- Clip "${pin.name}" on ${pin.trackName} (itemId ${pin.itemId}), ` +
          `${tc(pin.fromFrame)}–${tc(pin.toFrame)} (frames ${pin.fromFrame}–${pin.toFrame}).`
        )
      case 'range':
        return (
          `- Time range ${tc(pin.fromFrame)}–${tc(pin.toFrame)}: frames ${pin.fromFrame} up to ` +
          `but not including ${pin.toFrame}.`
        )
    }
  })
  const ranges = pins.filter((pin) => pin.kind === 'range')
  const rule =
    ranges.length > 0
      ? [
          '',
          'Work only inside the pinned time range' +
            (ranges.length > 1 ? 's' : '') +
            '. Do not move, trim, delete or add anything outside ' +
            (ranges.length > 1 ? 'them' : 'it') +
            ', and do not use an edit that shifts later clips (such as a ripple) unless I ask. ' +
            'If what I asked for cannot be done without touching the rest of the timeline, say so ' +
            'instead of doing it.'
        ]
      : []
  return ['I have pinned these for this request:', ...lines, ...rule, '', text].join('\n')
}

/** Something the `@` menu can offer. */
export interface MentionCandidate {
  pin: Pin
  /** What is matched against the query and shown as the row's title. */
  label: string
  /** The row's second line. */
  detail: string
  group: 'Time' | 'Clips' | 'Assets'
}

/**
 * Candidates matching what follows the `@`, best first.
 *
 * A word-start match ranks above a match inside a word, and both above nothing — so `@int` puts
 * "Interview.mp4" before "Painting.mp4". Case-insensitive. Groups keep their order (time first,
 * then clips, then assets) within each rank, so the menu does not reshuffle as the user types.
 */
export function matchMentions(
  query: string,
  candidates: readonly MentionCandidate[],
  limit = 12
): MentionCandidate[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return candidates.slice(0, limit)
  const scored: { candidate: MentionCandidate; rank: number; index: number }[] = []
  candidates.forEach((candidate, index) => {
    const label = candidate.label.toLowerCase()
    const at = label.indexOf(needle)
    if (at < 0) return
    const wordStart = at === 0 || /[\s._\-·]/.test(label[at - 1] ?? '')
    scored.push({ candidate, rank: wordStart ? 0 : 1, index })
  })
  scored.sort((a, b) => a.rank - b.rank || a.index - b.index)
  return scored.slice(0, limit).map((entry) => entry.candidate)
}

/**
 * The `@` or `/` the caret is in, if any: the trigger character's index and the text after it.
 *
 * A trigger counts only at the start of the text or after whitespace, so an email address or
 * "2@3" never opens the menu, and only until the first space — `@interview clip` is a mention of
 * "interview" followed by the word "clip". `/` counts only at the very start of the message,
 * because a slash mid-sentence ("in/out") is prose.
 */
export function activeTrigger(
  text: string,
  caret: number
): { char: '@' | '/'; start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)([@/])([^\s@/]*)$/.exec(before)
  if (!match) return null
  const char = match[2] as '@' | '/'
  const start = before.length - match[3]!.length - 1
  if (char === '/' && start !== 0) return null
  return { char, start, query: match[3]! }
}

/**
 * A time the user typed, as a frame: `1:02:15` (m:ss:ff), `0:01:02:15` (h:mm:ss:ff), `4.5s`,
 * `135f`, or a bare number of seconds. Null when it is none of those — the range editor then
 * says so rather than guessing, because a mis-read bound is a range the agent keeps to wrongly.
 */
export function parseTime(text: string, fps: number): number | null {
  const value = text.trim().toLowerCase()
  const rate = Math.max(1, Math.round(fps))
  let frames: number | null = null
  if (/^\d+(\.\d+)?f$/.test(value)) frames = Number(value.slice(0, -1))
  else if (/^\d+(\.\d+)?s?$/.test(value)) frames = Number(value.replace(/s$/, '')) * fps
  else if (/^\d+(:\d{1,2}){2,3}$/.test(value)) {
    const parts = value.split(':').map(Number)
    const [ff, ss, mm, hh = 0] = parts.reverse() as [number, number, number, number?]
    if (ss > 59 || mm > 59 || ff >= rate) return null
    frames = ((hh * 60 + mm) * 60 + ss) * rate + ff
  }
  if (frames === null || !Number.isFinite(frames) || frames < 0) return null
  return Math.round(frames)
}
