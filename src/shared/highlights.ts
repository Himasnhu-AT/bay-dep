/**
 * Highlights: the scaffolding an agent needs to pick short clips out of a long talk, and the
 * checks its picks must pass before they land on the timeline.
 *
 * bay does not score the clips. The agent reads the words and scores them itself — it is the
 * only party here that understands what was said — so `find_highlights` hands it sentence-aligned
 * spans with times and a rubric, and `mark_highlights` refuses picks that overlap, run off the
 * material or miss the target length, naming each one. That split is deliberate: a clip that
 * starts mid-sentence or overlaps its neighbour is a mechanical fault a function can catch every
 * time, while "is this funny" is not.
 *
 * The rubric (the four 0–100 scores, "stands alone without the original", no overlaps, a target
 * length, a viral/knowledge/balanced focus and genre hints) follows the Auto Clips analyzer in
 * OpenCreator (`apps/daemon/src/creator/clip/analyzer.ts`, krillinai/OpenCreator, Apache-2.0),
 * reworded here. Two things differ on purpose. OpenCreator stores the scores and never uses them;
 * here they rank, weighted by the focus (`highlightScore`). And one bad candidate there fails the
 * whole analysis; here the check names each fault so the agent can fix just that pick.
 */

import type { TranscriptSegment } from './transcribe'

/** One sentence, in seconds from the start of the source file. */
export interface Sentence {
  startSeconds: number
  endSeconds: number
  text: string
}

export interface SentenceOptions {
  /** A silence at least this long ends a sentence even without punctuation. Default 1.2 s. */
  pauseSeconds?: number
  /** A run-on (whisper sometimes punctuates nothing) is cut at this length. Default 30 s. */
  maxSeconds?: number
}

/** A unit ends a sentence when its text ends in terminal punctuation, closing quotes allowed. */
const TERMINAL = /[.!?…。！？]["'”’)\]]*$/

/**
 * The transcript as sentences.
 *
 * whisper here runs with `-ml 42`, so its segments are *lines* about 42 characters long, not
 * sentences — a clip cut on a segment boundary starts mid-thought. With word times (`-ojf`) the
 * words are regrouped at terminal punctuation; without them the lines are joined the same way.
 * A long pause or a run-on past `maxSeconds` also closes a sentence, because a transcript with
 * no punctuation would otherwise come back as one 40-minute "sentence".
 */
export function sentencesOf(segments: readonly TranscriptSegment[], options: SentenceOptions = {}): Sentence[] {
  const pause = options.pauseSeconds ?? 1.2
  const max = options.maxSeconds ?? 30
  const everyHasWords = segments.length > 0 && segments.every((s) => (s.words?.length ?? 0) > 0)
  const units = (everyHasWords ? segments.flatMap((s) => s.words ?? []) : segments)
    .map((u) => ({ startSeconds: u.startSeconds, endSeconds: u.endSeconds, text: u.text.trim() }))
    .filter((u) => u.text !== '' && Number.isFinite(u.startSeconds) && Number.isFinite(u.endSeconds))

  const out: Sentence[] = []
  let current: { startSeconds: number; endSeconds: number; parts: string[] } | null = null
  const close = (): void => {
    if (current) out.push({ startSeconds: current.startSeconds, endSeconds: current.endSeconds, text: current.parts.join(' ') })
    current = null
  }
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!
    if (current && unit.startSeconds - current.endSeconds >= pause) close()
    if (!current) current = { startSeconds: unit.startSeconds, endSeconds: unit.endSeconds, parts: [] }
    current.parts.push(unit.text)
    current.endSeconds = Math.max(current.endSeconds, unit.endSeconds)
    if (TERMINAL.test(unit.text) || current.endSeconds - current.startSeconds >= max) close()
  }
  close()
  return out
}

// ---------------------------------------------------------------------------
// The rubric
// ---------------------------------------------------------------------------

export type HighlightFocus = 'viral' | 'knowledge' | 'balanced'
export type ScoreName = 'hook' | 'information' | 'emotion' | 'completeness'
export type HighlightScores = Record<ScoreName, number>

export const SCORE_NAMES: readonly ScoreName[] = ['hook', 'information', 'emotion', 'completeness']

/** What each score measures, 0–100, in the words the agent scores against. */
export const CRITERIA: Record<ScoreName, string> = {
  hook: 'How hard the first two or three seconds pull in someone scrolling past: a question, a bold claim, a surprise, a vivid line.',
  information: 'How much a viewer learns or can use afterwards: facts, a method, a clear takeaway.',
  emotion: 'How strongly it makes someone feel something — laughter, anger, awe, recognition.',
  completeness: 'Whether the point starts and lands inside the clip: no "as I said", no answer without its question, no cut-off punchline.'
}

export const FOCUSES: Record<HighlightFocus, { emphasis: string; weights: HighlightScores }> = {
  viral: {
    emphasis: 'Favour clips with a gripping opening and a clear feeling, that would travel on social platforms on their own.',
    weights: { hook: 0.35, information: 0.1, emotion: 0.35, completeness: 0.2 }
  },
  knowledge: {
    emphasis: 'Favour clips that make one complete, dense point a stranger can follow with no context.',
    weights: { hook: 0.15, information: 0.4, emotion: 0.1, completeness: 0.35 }
  },
  balanced: {
    emphasis: 'Weigh the opening, what is learned, the feeling and whether the point is whole about equally.',
    weights: { hook: 0.25, information: 0.25, emotion: 0.25, completeness: 0.25 }
  }
}

export const GENRES = {
  auto: 'Decide from the words; assume no particular kind of content.',
  talk: 'A talk or someone arguing a view.',
  podcast: 'A podcast conversation between hosts or guests.',
  tutorial: 'A tutorial or an explanation of how something works.',
  interview: 'An interview with one person.',
  entertainment: 'Entertainment.',
  sports: 'Sport.',
  gaming: 'Gaming.',
  news: 'News or current affairs.'
} as const
export type HighlightGenre = keyof typeof GENRES

/** The rules every pick must keep, in the order the agent should check them. */
export const HIGHLIGHT_RULES: readonly string[] = [
  'Each clip must stand on its own for someone who never saw the original: it opens on the start of a thought, not mid-sentence, and it ends where the point lands.',
  'Start and end on sentence boundaries from the list — a sentence\'s from and the same or a later sentence\'s to.',
  'No two clips overlap. Touching is fine.',
  'Every clip lies inside the material given, and its length is inside the target range.',
  'Score each clip 0–100 on hook, information, emotion and completeness, as whole numbers, honestly: a clip everyone scores 90 on everything tells the user nothing.',
  'Titles are short and specific — what the clip is about, not "Great moment".'
]

/** One number to rank by: the four scores weighted by the focus, 0–100. */
export function highlightScore(scores: HighlightScores, focus: HighlightFocus): number {
  const weights = FOCUSES[focus].weights
  let total = 0
  for (const name of SCORE_NAMES) total += scores[name] * weights[name]
  return Math.round(total)
}

// ---------------------------------------------------------------------------
// Checking picks
// ---------------------------------------------------------------------------

export interface HighlightPick {
  title: string
  fromFrame: number
  toFrame: number
  scores?: HighlightScores
  reason?: string
}

export interface PickLimits {
  /** Half-open: `toFrame` may equal `bounds.to`. */
  bounds: { from: number; to: number }
  fps: number
  minSeconds?: number
  maxSeconds?: number
}

/**
 * Every fault in a list of picks, as sentences naming the pick and what to change — empty when
 * the list is good. Checks everything before reporting, so one refusal lists every fault rather
 * than the agent discovering them one call at a time.
 */
export function checkPicks(picks: readonly HighlightPick[], limits: PickLimits): string[] {
  const faults: string[] = []
  const seconds = (frames: number): string => `${(frames / limits.fps).toFixed(1)}s`
  const name = (index: number): string => {
    const title = picks[index]?.title
    return `highlights[${index}]${typeof title === 'string' && title.trim() ? ` ("${title.trim()}")` : ''}`
  }

  picks.forEach((pick, index) => {
    const who = name(index)
    if (typeof pick.title !== 'string' || pick.title.trim() === '') faults.push(`${who} has no title. Give it a short, specific one.`)
    if (!Number.isInteger(pick.fromFrame) || !Number.isInteger(pick.toFrame)) {
      faults.push(`${who}: fromFrame and toFrame must be whole frame numbers.`)
      return
    }
    if (pick.toFrame <= pick.fromFrame) {
      faults.push(`${who} ends (frame ${pick.toFrame}) at or before it starts (frame ${pick.fromFrame}).`)
      return
    }
    if (pick.fromFrame < limits.bounds.from || pick.toFrame > limits.bounds.to) {
      faults.push(
        `${who} (frames ${pick.fromFrame}–${pick.toFrame}) runs outside the material, frames ` +
          `${limits.bounds.from}–${limits.bounds.to}. Keep it inside.`
      )
    }
    const length = (pick.toFrame - pick.fromFrame) / limits.fps
    if (limits.minSeconds !== undefined && length < limits.minSeconds - 1e-9) {
      faults.push(`${who} is ${seconds(pick.toFrame - pick.fromFrame)}, shorter than the ${limits.minSeconds}s minimum. Extend it to the end of a later sentence, or drop it.`)
    }
    if (limits.maxSeconds !== undefined && length > limits.maxSeconds + 1e-9) {
      faults.push(`${who} is ${seconds(pick.toFrame - pick.fromFrame)}, longer than the ${limits.maxSeconds}s maximum. End it on an earlier sentence.`)
    }
    if (pick.scores !== undefined) {
      for (const score of SCORE_NAMES) {
        const value = (pick.scores as Partial<Record<ScoreName, unknown>>)[score]
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
          faults.push(`${who}: scores.${score} must be a number from 0 to 100, but got ${JSON.stringify(value)}.`)
        }
      }
    }
  })

  // Overlap is judged in time order, whatever order the picks came in.
  const order = picks
    .map((pick, index) => ({ pick, index }))
    .filter(({ pick }) => Number.isInteger(pick.fromFrame) && Number.isInteger(pick.toFrame) && pick.toFrame > pick.fromFrame)
    .sort((a, b) => a.pick.fromFrame - b.pick.fromFrame)
  for (let i = 1; i < order.length; i++) {
    const before = order[i - 1]!
    const after = order[i]!
    if (after.pick.fromFrame < before.pick.toFrame) {
      faults.push(
        `${name(after.index)} (from frame ${after.pick.fromFrame}) overlaps ${name(before.index)} ` +
          `(to frame ${before.pick.toFrame}) by ${before.pick.toFrame - after.pick.fromFrame} frames. ` +
          `Move one boundary to a sentence edge, or keep the stronger clip.`
      )
    }
  }
  return faults
}
