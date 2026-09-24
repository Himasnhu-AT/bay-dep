/**
 * `find_highlights` and `mark_highlights` — the mechanical half of cutting shorts from a long talk.
 *
 * bay supplies what a function can be trusted with: the words as sentences on the timeline, the
 * rubric, and a check that refuses picks that overlap, leave the material or miss the length. The
 * agent does the reading and scoring. The rubric and its rewording are in `@shared/highlights`.
 *
 * Transcripts come from `transcribeSource`, the session cache `transcribe` and `add_subtitles`
 * fill, so "transcribe, then find highlights" runs whisper once.
 */

import {
  allItems,
  effectiveSpeed,
  findAsset,
  formatTimecode,
  timelineDuration,
  US_PER_SECOND,
  type Asset,
  type Item
} from '@shared/project'
import { segmentsToCues } from '@shared/transcribe'
import {
  checkPicks,
  CRITERIA,
  FOCUSES,
  GENRES,
  HIGHLIGHT_RULES,
  highlightScore,
  SCORE_NAMES,
  sentencesOf,
  type HighlightFocus,
  type HighlightGenre,
  type HighlightPick,
  type HighlightScores
} from '@shared/highlights'
import { fail, project, resolveAsset, resolveItem, store, timeline, type Handlers } from './helpers'
import { describeMarker } from './read'
import { transcribeSource } from './transcribe'

const DEFAULT_COLOR = '#F5A524'
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function focusOf(value: unknown): HighlightFocus {
  return value === 'viral' || value === 'knowledge' ? value : 'balanced'
}

function genreOf(value: unknown): HighlightGenre {
  return typeof value === 'string' && value in GENRES ? (value as HighlightGenre) : 'auto'
}

/** A clip whose own sound is speech bay could transcribe, or the reason it is not. */
function speechAsset(item: Item): Asset | string {
  const asset = findAsset(project(), item.assetId)
  if (!asset?.path) return `${item.id} has no media file (a title or generated clip has no speech)`
  if (!asset.hasAudio) return `${item.id} ("${asset.name}") has no audio track`
  return asset
}

/**
 * The clips to read, for a call with a range and no itemId: every clip overlapping the range that
 * carries its own sound. Two that play at the same time are refused rather than guessed between —
 * a music bed under the talk would otherwise be "transcribed" into the sentence list.
 */
function clipsInRange(from: number, to: number): Item[] {
  const tl = timeline()
  const muted = new Set(tl.tracks.filter((t) => t.muted).map((t) => t.id))
  const candidates = allItems(tl)
    .filter((item) => !muted.has(item.trackId) && !item.audioDetached)
    .filter((item) => item.from < to && item.from + item.durationInFrames > from)
    .filter((item) => typeof speechAsset(item) !== 'string')
    .sort((a, b) => a.from - b.from)
  if (candidates.length === 0) {
    fail(`No clip with sound plays between frames ${from} and ${to}. read_project lists the clips; pass an itemId, or a range that covers speech.`)
  }
  for (let i = 1; i < candidates.length; i++) {
    const a = candidates[i - 1]!
    const b = candidates[i]!
    if (b.from < a.from + a.durationInFrames) {
      fail(
        `More than one clip with sound plays at once in that range (${a.id} and ${b.id}, among ` +
          `${candidates.map((c) => c.id).join(', ')}), so bay cannot tell which is the speech. Pass the speech clip's itemId.`
      )
    }
  }
  return candidates
}

interface TimelineSentence {
  i: number
  fromFrame: number
  toFrame: number
  seconds: number
  at: string
  text: string
  itemId: string
}

async function sentencesOnTimeline(
  items: Item[],
  language: string | undefined,
  range: { from: number; to: number }
): Promise<{ sentences: TimelineSentence[]; droppedAtEdges: number }> {
  const fps = timeline().fps
  const out: Omit<TimelineSentence, 'i'>[] = []
  let droppedAtEdges = 0
  for (const item of items) {
    const asset = speechAsset(item)
    if (typeof asset === 'string') fail(`${asset}, so there is nothing to find highlights in.`)
    const transcript = await transcribeSource(asset.path!, language)
    // Only sentences the clip plays whole: a clip cut on half a sentence starts mid-thought,
    // which is the one thing a highlight must not do.
    const speed = effectiveSpeed(item.speed)
    const sourceFrom = item.sourceStartUs / US_PER_SECOND
    const sourceTo = sourceFrom + (item.durationInFrames / fps) * speed
    const all = sentencesOf(transcript.segments)
    const whole = all.filter((s) => s.endSeconds > sourceFrom && s.startSeconds < sourceTo)
    const inside = whole.filter((s) => s.startSeconds >= sourceFrom - 1e-6 && s.endSeconds <= sourceTo + 1e-6)
    droppedAtEdges += whole.length - inside.length
    for (const cue of segmentsToCues(inside, item, fps)) {
      if (cue.fromFrame < range.from || cue.toFrame > range.to) continue
      out.push({
        fromFrame: cue.fromFrame,
        toFrame: cue.toFrame,
        seconds: Math.round(((cue.toFrame - cue.fromFrame) / fps) * 10) / 10,
        at: formatTimecode(cue.fromFrame, fps, true),
        text: cue.text,
        itemId: item.id
      })
    }
  }
  out.sort((a, b) => a.fromFrame - b.fromFrame)
  return { sentences: out.map((s, i) => ({ i, ...s })), droppedAtEdges }
}

function rubric(args: Record<string, unknown>): Record<string, unknown> {
  const focus = focusOf(args.focus)
  const genre = genreOf(args.genre)
  const count = typeof args.count === 'number' ? Math.round(args.count) : 3
  const minSeconds = typeof args.minSeconds === 'number' ? args.minSeconds : 30
  const maxSeconds = typeof args.maxSeconds === 'number' ? args.maxSeconds : 60
  if (maxSeconds < minSeconds) fail(`maxSeconds (${maxSeconds}) is below minSeconds (${minSeconds}). Pass a range, such as 30 and 60.`)
  return {
    task:
      `Choose at most ${count} clips of ${minSeconds}–${maxSeconds} seconds that each work on their own, ` +
      `score each one, and keep the best. Fewer is better than padding with weak clips.`,
    focus: { name: focus, emphasis: FOCUSES[focus].emphasis, weights: FOCUSES[focus].weights },
    genre: { name: genre, hint: GENRES[genre] },
    count,
    durationSeconds: { min: minSeconds, max: maxSeconds },
    criteria: CRITERIA,
    rules: HIGHLIGHT_RULES
  }
}

export async function findHighlights(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const itemId = typeof args.itemId === 'string' ? args.itemId : null
  const assetId = typeof args.assetId === 'string' ? args.assetId : null
  const hasRange = args.fromFrame !== undefined || args.toFrame !== undefined
  const language = typeof args.language === 'string' ? args.language : undefined
  if (itemId && assetId) fail('Pass itemId (a clip on the timeline) or assetId (a whole file), not both.')
  if (!itemId && !assetId && !hasRange) {
    fail('find_highlights needs itemId (a speech clip on the timeline), fromFrame/toFrame (a range one speech clip covers) or assetId (a whole file). read_project lists them.')
  }
  const scaffold = rubric(args)

  if (assetId) {
    if (hasRange) fail('fromFrame/toFrame are timeline frames and apply to a clip, not to a file. Pass itemId with the range, or assetId alone.')
    const asset = resolveAsset(assetId)
    if (!asset.path) fail(`"${asset.name}" has no media file, so it has no speech.`)
    if (!asset.hasAudio) fail(`"${asset.name}" has no audio track, so there is nothing to find highlights in.`)
    const transcript = await transcribeSource(asset.path, language)
    const sentences = sentencesOf(transcript.segments).map((s, i) => ({
      i,
      startSeconds: round(s.startSeconds),
      endSeconds: round(s.endSeconds),
      seconds: round(s.endSeconds - s.startSeconds),
      text: s.text
    }))
    return {
      units: 'seconds from the start of the file',
      asset: asset.name,
      assetId: asset.id,
      bounds: { startSeconds: 0, endSeconds: round(asset.durationUs / US_PER_SECOND) },
      sentenceCount: sentences.length,
      sentences,
      rubric: scaffold,
      next:
        sentences.length === 0
          ? 'No speech was found in this file.'
          : 'These times are seconds in the file, not the timeline. To mark picks, place the file (place_asset) and call ' +
            'find_highlights with its itemId, so the sentences come back in timeline frames for mark_highlights.'
    }
  }

  const fullLength = timelineDuration(timeline())
  const from = typeof args.fromFrame === 'number' ? args.fromFrame : 0
  const to = typeof args.toFrame === 'number' ? args.toFrame : Number.POSITIVE_INFINITY
  if (to <= from) fail(`toFrame (${to}) must be after fromFrame (${from}); the range is half-open.`)

  let items: Item[]
  if (itemId) {
    const { item } = resolveItem(itemId)
    const asset = speechAsset(item)
    if (typeof asset === 'string') fail(`${asset}, so there is nothing to find highlights in.`)
    items = [item]
  } else {
    items = clipsInRange(from, Number.isFinite(to) ? to : fullLength)
  }
  const bounds = {
    fromFrame: Math.max(from, Math.min(...items.map((i) => i.from))),
    toFrame: Math.min(to, Math.max(...items.map((i) => i.from + i.durationInFrames)))
  }
  const { sentences, droppedAtEdges } = await sentencesOnTimeline(items, language, { from: bounds.fromFrame, to: bounds.toFrame })
  const fps = timeline().fps
  return {
    units: 'timeline frames (toFrame half-open)',
    fps,
    itemIds: items.map((i) => i.id),
    bounds,
    sentenceCount: sentences.length,
    ...(droppedAtEdges > 0
      ? { droppedAtEdges, droppedNote: `${droppedAtEdges} sentence(s) cut by a clip edge were left out, because a highlight must not start or end mid-sentence.` }
      : {}),
    sentences,
    rubric: scaffold,
    next:
      sentences.length === 0
        ? 'No whole sentence was found in this range.'
        : 'Read the sentences, choose and score clips by the rubric (each from a sentence\'s fromFrame to the same or a ' +
          'later sentence\'s toFrame), then call mark_highlights with { highlights: [{ title, fromFrame, toFrame, scores, reason }], ' +
          `focus: "${focusOf(args.focus)}", minSeconds, maxSeconds }. It refuses overlaps and out-of-range picks, naming each.`
  }
}

const round = (n: number): number => Math.round(n * 100) / 100

function asPick(entry: unknown, index: number): HighlightPick {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    fail(`highlights[${index}] must be { title, fromFrame, toFrame, scores?, reason? }.`)
  }
  const e = entry as Record<string, unknown>
  const pick: HighlightPick = {
    title: typeof e.title === 'string' ? e.title : '',
    fromFrame: typeof e.fromFrame === 'number' ? e.fromFrame : Number.NaN,
    toFrame: typeof e.toFrame === 'number' ? e.toFrame : Number.NaN
  }
  if (e.scores !== undefined) {
    if (typeof e.scores !== 'object' || e.scores === null) fail(`highlights[${index}].scores must be { hook, information, emotion, completeness }.`)
    pick.scores = e.scores as HighlightScores
  }
  if (typeof e.reason === 'string') pick.reason = e.reason
  return pick
}

export function markHighlights(args: Record<string, unknown>): Record<string, unknown> {
  const list = args.highlights
  if (!Array.isArray(list) || list.length === 0) {
    fail('highlights is empty. Pass [{ title, fromFrame, toFrame, scores?, reason? }, …] — the picks you made from find_highlights.')
  }
  const color = args.color === undefined ? DEFAULT_COLOR : String(args.color).trim()
  if (!HEX.test(color)) fail(`color must be a hex colour such as "${DEFAULT_COLOR}", but got "${color}".`)
  const focus = focusOf(args.focus)
  const ends = args.ends !== false
  const picks = list.map(asPick)
  const tl = timeline()
  const length = timelineDuration(tl)
  if (length === 0) fail('The timeline is empty, so there is nothing to mark highlights on.')

  const minSeconds = typeof args.minSeconds === 'number' ? args.minSeconds : undefined
  const maxSeconds = typeof args.maxSeconds === 'number' ? args.maxSeconds : undefined
  const faults = checkPicks(picks, {
    bounds: { from: 0, to: length },
    fps: tl.fps,
    ...(minSeconds !== undefined ? { minSeconds } : {}),
    ...(maxSeconds !== undefined ? { maxSeconds } : {})
  })
  if (faults.length > 0) fail(`No markers were placed. Fix ${faults.length === 1 ? 'this' : 'these'} and call again: ${faults.join(' ')}`)

  const scored = picks.every((p) => p.scores !== undefined)
  // Ranked by the focus's weighting when every pick is scored; otherwise in time order.
  const ranked = picks
    .map((pick, index) => ({ pick, index, score: pick.scores ? highlightScore(pick.scores, focus) : null }))
    .sort((a, b) => (scored ? (b.score ?? 0) - (a.score ?? 0) || a.pick.fromFrame - b.pick.fromFrame : a.pick.fromFrame - b.pick.fromFrame))

  const ids: string[] = []
  const placed: Record<string, unknown>[] = []
  store().transact(() => {
    ranked.forEach(({ pick, score }, rank) => {
      const tag = `H${rank + 1}`
      const title = pick.title.trim()
      const start = store().addMarker(pick.fromFrame, `${tag} ${title}${score !== null ? ` (${score})` : ''}`, color)
      const end = ends ? store().addMarker(pick.toFrame, `${tag} end`, color) : null
      if (start) ids.push(start)
      if (end) ids.push(end)
      placed.push({
        rank: rank + 1,
        title,
        fromFrame: pick.fromFrame,
        toFrame: pick.toFrame,
        seconds: round((pick.toFrame - pick.fromFrame) / tl.fps),
        at: `${formatTimecode(pick.fromFrame, tl.fps, true)}–${formatTimecode(pick.toFrame, tl.fps, true)}`,
        ...(pick.scores ? { scores: Object.fromEntries(SCORE_NAMES.map((n) => [n, pick.scores![n]])), score } : {}),
        ...(pick.reason ? { reason: pick.reason } : {}),
        markerIds: [start, end].filter((id): id is string => typeof id === 'string')
      })
    })
  })
  const markers = (timeline().markers ?? []).filter((m) => ids.includes(m.id)).map(describeMarker)
  return {
    highlights: placed,
    ranking: scored ? `by ${focus} weighting (${JSON.stringify(FOCUSES[focus].weights)})` : 'in time order — pass scores on every pick to rank them',
    markers,
    next:
      'The picks are marked. For a rough cut of just these clips, remove_range each gap between them, starting from the ' +
      'last so earlier frames do not move under you; for separate shorts, export_timeline each range (its toFrame is ' +
      'inclusive, so pass a pick\'s toFrame − 1).'
  }
}

export const handlers: Handlers = {
  find_highlights: (args) => findHighlights(args),
  mark_highlights: (args) => markHighlights(args)
}
