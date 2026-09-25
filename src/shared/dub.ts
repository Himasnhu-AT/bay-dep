/**
 * Translate and dub: the structure around the agent's translation. The agent is the translator;
 * bay supplies the cues, the time each one has, the rules, the check that a line fits, and the
 * fit of each generated line to its slot.
 *
 * Ported in part from OpenCreator's dubbing pipeline (`runtime/krillinai/internal/service/dubbing/`
 * — `planner.go`, `optimizer.go`, `fit.go` — and `service/translate.go`; Apache-2.0, © KrillinAI),
 * re-worded and changed where their traps were:
 *
 * - **Slots.** OpenCreator gives a cue `duration + GapTolerance` (1.5 s). Here a cue has until the
 *   next cue starts, capped at that same tolerance past its own end: a line may run into a pause,
 *   never over the next line.
 * - **Tempo.** `fit.go` computed `actual / available`, warned past 1.15 and 1.30, and applied it
 *   anyway, however large. Here a line needing up to `TEMPO_ACCEPT` is sped up quietly, up to
 *   `TEMPO_WARN` is sped up with a warning, and beyond that it is refused and not placed — a line
 *   played 1.6× fast is not a dub anyone keeps. Never slowed: a short line leaves silence.
 * - **Rewrite.** OpenCreator's one-shot LLM rewrite ("optimizer") becomes a rule the agent follows
 *   and a refusal that names every over-long line, its overage and how many characters to cut.
 * - **Silent fallback.** `translate.go` used the source text as the "translation" after three
 *   failed attempts. Nothing here substitutes anything: a missing cue is refused by name.
 *
 * Pure: both the tools and the tests read it. Timeline positions are frames; seconds appear only
 * as what a person reads and what the speech estimator speaks in.
 */

import { MAX_DUCK_DB } from './audio-gain'
import type { GenerationRequest } from './generation'
import type { Asset } from './project'
import { estimateSpeech, type SpeechPace } from './speech-duration'
import type { TimelineCue } from './transcribe'

/** How far past its own end a cue's line may run into a following pause (OpenCreator's GapTolerance). */
export const DUB_GAP_SECONDS = 1.5
/** A sentence longer than this is cut into more than one cue: one generated line per breath group. */
export const DUB_MAX_CUE_SECONDS = 12
/** Cues either side of the one being translated that the agent reads for context (translate.go). */
export const DUB_CONTEXT_CUES = 3
/** Up to this tempo a line is sped up without comment. */
export const TEMPO_ACCEPT = 1.25
/** Up to this tempo a line is sped up with a warning; beyond it the line is refused. */
export const TEMPO_WARN = 1.4
/** How far the original dialogue is ducked under the dub by default, in dB. */
export const DUB_DUCK_DB = 18

export type OriginalAudio = 'duck' | 'mute' | 'keep'

/** One line to dub, in timeline frames. */
export interface DubCue {
  /**
   * `c@<fromFrame>` — named by where the cue starts on the timeline, not by its position in the
   * list. A position (`c1`, `c2`) names a different sentence the moment the list changes (a
   * narrower range, a re-transcription that splits one sentence in two), and a translation sent
   * for the old `c2` would be spoken over the new one without a word of complaint. A start frame
   * names the same moment or nothing. Two cues starting on one frame are `c@F` and `c@F.2`.
   */
  id: string
  fromFrame: number
  toFrame: number
  /** Frames from `fromFrame` the dubbed line may take: to the next cue, at most the gap past its end. */
  slotFrames: number
  slotSeconds: number
  /** The source line, cleaned of sound tags. */
  text: string
}

const SOUND_TAG = /[([（【]\s*(music|applause|laughter|laughs?|noise|sound|silence|inaudible|掌声|音乐|笑声|噪音|静音)[^)\]）】]*[)\]）】]/giu

/**
 * A line as it should be spoken: sound tags removed ("(music)", "[applause]"), symbols a voice
 * would read aloud or stumble on dropped, whitespace collapsed. Ported from OpenCreator's
 * `CleanTextForSpeech`.
 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(SOUND_TAG, ' ')
    .replace(/[®™©]/gu, '')
    .replace(/——|--/gu, ', ')
    .replace(/&/gu, ' and ')
    .replace(/\s+/gu, ' ')
    .trim()
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Sentences on the timeline as cues with slots. `cues` are in timeline order (as
 * `segmentsToCues` returns them); `endFrame` is where the dubbed material ends — the clip's end or
 * the range's — and bounds the last slot. A cue with nothing left to say after cleaning is dropped.
 */
export function dubCues(cues: readonly TimelineCue[], endFrame: number, fps: number): DubCue[] {
  const gap = Math.round(DUB_GAP_SECONDS * fps)
  const kept = cues
    .map((cue) => ({ ...cue, text: cleanForSpeech(cue.text) }))
    .filter((cue) => cue.text !== '' && cue.toFrame > cue.fromFrame)
  const seen = new Map<number, number>()
  return kept.map((cue, i) => {
    const next = kept[i + 1]
    // The slot ends at the next cue's start and at the dubbed range's end, whatever the cue's own
    // end says: a sentence whisper timed past the next one's start still may not be spoken over
    // it. Only the gap tolerance is measured from the cue's own end. Zero is possible (two cues
    // on one frame, a cue at the range's end); apply_dub refuses such a line by name.
    const slotEnd = Math.min(next ? next.fromFrame : endFrame, endFrame, cue.toFrame + gap)
    const slotFrames = Math.max(0, slotEnd - cue.fromFrame)
    const count = (seen.get(cue.fromFrame) ?? 0) + 1
    seen.set(cue.fromFrame, count)
    return {
      id: count === 1 ? `c@${cue.fromFrame}` : `c@${cue.fromFrame}.${count}`,
      fromFrame: cue.fromFrame,
      toFrame: cue.toFrame,
      slotFrames,
      slotSeconds: round2(slotFrames / fps),
      text: cue.text
    }
  })
}

/**
 * A short fingerprint of a plan: the clip, the range and every cue's id, span, slot and words.
 * `plan_dub` returns it and `apply_dub` checks it when it is passed back, so translations written
 * against one reading of the clip are never voiced against another (FNV-1a, 2×32 bits: an
 * identity check against accidents, not a secret).
 */
export function dubPlanId(itemId: string, range: { from: number; to: number }, cues: readonly DubCue[]): string {
  const text = JSON.stringify([itemId, range.from, range.to, cues.map((c) => [c.id, c.fromFrame, c.toFrame, c.slotFrames, c.text])])
  let a = 0x811c9dc5
  let b = 0x01000193 ^ text.length
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code ^ (i & 0xff), 0x01000193) >>> 0
  }
  return `plan-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

/**
 * The refusal for translated cues whose slot has no frames — a cue starting where the next one
 * or the range does — or null when every translated cue has room. Through `plan_dub` today cues
 * abut (`segmentsToCues` never lets one start before the previous ends), so this fires only for a
 * cue list from elsewhere; `dubCues` accepts any list, so the one voicing it checks.
 */
export function noRoomRefusal(cues: readonly DubCue[], translated: ReadonlySet<string>): string | null {
  const none = cues.filter((cue) => translated.has(cue.id) && cue.slotFrames < 1).map((cue) => cue.id)
  if (none.length === 0) return null
  return (
    `${none.join(', ')} ${none.length === 1 ? 'has' : 'have'} no room: ${none.length === 1 ? 'it starts' : 'each starts'} where the next cue or the range ends, so no line can play there. ` +
    'Leave them out (with partial: true), or fold their words into the cue before.'
  )
}

/** One generated line as it is about to be placed. */
export interface PlacedLine {
  cueId: string
  from: number
  durationInFrames: number
}

/**
 * Lines placed in one go never overlap each other: each ends at the next one's start at the
 * latest, and a line left with no frames is dropped. Slots already stop at the next cue, so this
 * only changes anything when two lines share a start — but it is the placement's own rule, not a
 * hope about its input. Returns the lines kept (trimmed where needed) and the ids trimmed or dropped.
 */
export function separateLines<L extends PlacedLine>(lines: readonly L[]): { kept: L[]; trimmed: string[]; dropped: string[] } {
  const sorted = [...lines].sort((a, b) => a.from - b.from)
  const kept: L[] = []
  const trimmed: string[] = []
  const dropped: string[] = []
  for (const [i, line] of sorted.entries()) {
    const next = sorted[i + 1]
    const end = next ? Math.min(line.from + line.durationInFrames, next.from) : line.from + line.durationInFrames
    const frames = end - line.from
    if (frames < 1) {
      dropped.push(line.cueId)
      continue
    }
    if (frames < line.durationInFrames) trimmed.push(line.cueId)
    kept.push(frames === line.durationInFrames ? line : { ...line, durationInFrames: frames })
  }
  return { kept, trimmed, dropped }
}

/**
 * What a slot holds in the target language at a pace: seconds, and roughly how many syllables
 * or characters (the estimator's own unit) that is. A guide for writing, not a limit.
 */
export function speechBudget(
  slotSeconds: number,
  language: string,
  pace: SpeechPace = 'normal'
): { seconds: number; about: number; unit: 'syllables' | 'characters' } {
  const probe = estimateSpeech('a', { language, pace })
  return { seconds: slotSeconds, about: Math.floor(slotSeconds * probe.ratePerSecond), unit: probe.unit }
}

export type TempoVerdict = 'fits' | 'tempo' | 'warn' | 'refuse'

/**
 * How a line of `seconds` is fitted to a slot of `slotSeconds`: the tempo it plays at (≥ 1, never
 * slowed) and whether that is fine (`fits`, `tempo`), worth a warning, or refused. The tempo is
 * rounded *up* to a thousandth so the line never overruns its slot by the rounding.
 */
export function fitTempo(seconds: number, slotSeconds: number): { tempo: number; verdict: TempoVerdict } {
  if (!(slotSeconds > 0)) return { tempo: Number.POSITIVE_INFINITY, verdict: 'refuse' }
  const ratio = seconds / slotSeconds
  if (!(ratio > 1)) return { tempo: 1, verdict: 'fits' }
  const tempo = Math.ceil(ratio * 1000 - 1e-9) / 1000
  if (tempo <= TEMPO_ACCEPT) return { tempo, verdict: 'tempo' }
  if (tempo <= TEMPO_WARN) return { tempo, verdict: 'warn' }
  return { tempo, verdict: 'refuse' }
}

/** How many characters to cut from `text` for it to read in `slotSeconds` at its own pace. */
export function suggestedCut(text: string, seconds: number, slotSeconds: number): { cut: number; keep: number } {
  const length = [...text].length
  if (!(seconds > slotSeconds) || seconds <= 0) return { cut: 0, keep: length }
  const keep = Math.max(1, Math.floor((length * slotSeconds) / seconds))
  return { cut: length - keep, keep }
}

/** One line judged against its slot, before any money is spent. */
export interface LineCheck {
  cueId: string
  slotSeconds: number
  estimatedSeconds: number
  tempo: number
  verdict: TempoVerdict
}

/**
 * The refusal for lines whose *estimate* needs more than `TEMPO_ACCEPT`: every one, each with its
 * overage and the cut that would make it fit. Null when all fit. Written for the agent's next call:
 * the ids to rewrite and by how much, so the retry can succeed.
 */
export function overLongRefusal(lines: readonly (LineCheck & { text: string })[], language: string): string | null {
  const over = lines.filter((line) => line.tempo > TEMPO_ACCEPT)
  if (over.length === 0) return null
  const each = over.map((line) => {
    const overBy = round2(line.estimatedSeconds - line.slotSeconds)
    const { cut, keep } = suggestedCut(line.text, line.estimatedSeconds, line.slotSeconds)
    return (
      `${line.cueId}: estimated ${line.estimatedSeconds}s for a ${line.slotSeconds}s slot — ${overBy}s over ` +
      `(needs ${line.tempo}×; bay speeds a line up to ${TEMPO_ACCEPT}×). Cut about ${cut} characters (to ${keep} or fewer).`
    )
  })
  return (
    `${over.length} of ${lines.length} translated line${lines.length === 1 ? '' : 's'} will not fit ${over.length === 1 ? 'its slot' : 'their slots'}, ` +
    `so nothing was generated or spent. ${each.join(' ')} Rewrite ${over.length === 1 ? 'it' : 'each'} shorter so it reads naturally in ` +
    `its slot — keep the core meaning, add no new facts — check with estimate_speech { language: "${language}", targetSeconds }, ` +
    'and call apply_dub again with every line.'
  )
}

/**
 * How to translate, adapted from OpenCreator's subtitle-translation prompt (`translate.go`,
 * `SplitTextWithContextPrompt`) and its voice-over rewrite prompt (`optimizer.go`), re-worded for
 * an agent working through a list rather than one sentence per request.
 */
export function dubInstructions(language: string): string[] {
  return [
    `Translate each cue's text into ${language}, as one line of natural, idiomatic speech — not word for word.`,
    `Read the ${DUB_CONTEXT_CUES} cues before and after a cue for context (who is speaking, what "it" refers to), but translate only that cue's own words: never move content between cues, because each line is spoken in its own slot.`,
    'Keep the meaning and add no facts. Drop stutters, repeated words and fillers (um, uh, you know). Keep a fragment a fragment.',
    'Keep names and brands as they are unless the language has an established form. Write numbers, units and symbols the way they should be said aloud.',
    'Use the target language\'s own punctuation. Output only the spoken words: no notes, quotes or brackets.',
    `Each cue has a budget: its slotSeconds, and about how many syllables or characters fit (budget). Check a line with estimate_speech { text, language: "${language}", targetSeconds: slotSeconds }. If it runs over, rewrite it as one shorter, more natural spoken line that keeps the core meaning, adds no new facts, and reads naturally within slotSeconds. bay speeds a line up to ${TEMPO_ACCEPT}× to fit, so small overruns are fine; larger ones are refused by apply_dub.`
  ]
}

export type DubLineStatus = 'queued' | 'running' | 'done' | 'failed'

/** One line of a dub as it is kept between polls, and across a reload (main keeps the record). */
export interface DubLineData {
  cue: DubCue
  text: string
  request: GenerationRequest
  estimatedSeconds: number
  costUsd: number
  status: DubLineStatus
  jobId?: string
  error?: string
  /** The imported line, once it landed — kept so placing again after an undo imports and pays nothing. */
  asset?: Asset
  measuredSeconds?: number
}

/** A dub in flight or done: what `apply_dub` started and `track_dub` follows. Plain data. */
export interface DubRecordData {
  id: string
  itemId: string
  language: string
  fps: number
  trackName: string
  original: { mode: OriginalAudio; amountDb: number }
  lines: DubLineData[]
  totalEstimatedCostUsd: number
  createdAt: number
  /** `dubPlanId` of the plan the lines were checked against. */
  planId: string
  /**
   * Order among dubs on the same track: a dub applied later has a higher number. A line of an
   * older dub is never placed over a line a newer one already placed.
   */
  generation: number
  /** Main's hold on the budget for lines not started yet; dropped once none is left to start. */
  reservationId?: string
  /** The items the last placement made, to tell a placement undone from one still standing. */
  placedItemIds?: string[]
  /** Set once placed (or once nothing was left to place): what every later poll returns. */
  result?: Record<string, unknown>
}

/** A record read back from main, or null when it is not one this build can resume. */
export function readDubRecord(value: unknown): DubRecordData | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Partial<DubRecordData>
  const ok =
    typeof r.id === 'string' &&
    typeof r.itemId === 'string' &&
    typeof r.language === 'string' &&
    typeof r.fps === 'number' &&
    typeof r.trackName === 'string' &&
    typeof r.createdAt === 'number' &&
    typeof r.planId === 'string' &&
    typeof r.generation === 'number' &&
    !!r.original &&
    Array.isArray(r.lines) &&
    r.lines.every((line) => !!line && typeof line === 'object' && !!line.cue && typeof line.cue.id === 'string' && typeof line.status === 'string' && !!line.request)
  return ok ? (r as DubRecordData) : null
}

/**
 * The original dialogue under `original: "mute"`: a duck at the deepest the duck allows, keyed
 * to the dub track — so it is silent exactly where a dubbed line plays and nowhere else, and it
 * multiplies after volume keyframes (`itemAudioGainAt`), which `item.volume = 0` did not: a clip
 * with volume keys ignores its static volume, so the "muted" original played on.
 */
export const DUB_MUTE_DB = MAX_DUCK_DB

/** The audio track a dub in `language` is placed on. Found by this name, so dubbing again replaces lines rather than stacking. */
export function dubTrackName(language: string): string {
  return `Dub (${language})`
}
