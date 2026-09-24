/**
 * The Transcript panel's model: the words the timeline speaks, where each one sits, and which
 * spans of time deleting some of them removes.
 *
 * Transcripts are of *source files* (whisper runs on the file from its start); the words a clip
 * plays are mapped onto the timeline by `segmentsToWords` — the one mapping `transcribe` and
 * `add_subtitles` use — so a word here is at the frame the agent would be told it is at, and a
 * clip trimmed, moved or sped up carries its words with it.
 *
 * Cutting words removes *time* (`remove_range`), never clips: a transcript-driven cut is the
 * middle of one long take, and only a range cut keeps every other track in sync. Ranges are
 * returned last-first so each removal leaves the frames of the ones still to go untouched.
 */

import { segmentsToCues, segmentsToWords, type TranscriptSegment } from './transcribe'
import { findAsset, type Item, type Project, type Timeline } from './project'

export interface TimelineWord {
  itemId: string
  fromFrame: number
  toFrame: number
  text: string
}

/**
 * The clips whose speech the panel shows: every clip with a sound file, in time order — or only
 * the selected ones, when any selected clip has sound. A picture whose sound was detached is
 * left out: its sound is the linked audio clip, which is listed instead, so no word appears twice.
 */
export function speechItems(project: Pick<Project, 'assets'>, timeline: Timeline, selection: readonly string[]): Item[] {
  const spoken = timeline.tracks
    .flatMap((track) => track.items)
    .filter((item) => {
      if (item.audioDetached) return false
      const asset = findAsset(project as Project, item.assetId)
      return Boolean(asset?.path && asset.hasAudio && (asset.kind === 'video' || asset.kind === 'audio'))
    })
    .sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1))
  const chosen = spoken.filter((item) => selection.includes(item.id))
  return chosen.length > 0 ? chosen : spoken
}

/**
 * Every word the given clips play, in timeline order, from their transcripts. A clip whose
 * transcript has no word times contributes its lines as whole units — coarser, still cuttable.
 * Clips with no transcript yet are returned as `untranscribed`.
 */
export function timelineWords(
  items: readonly Item[],
  transcriptOf: (item: Item) => readonly TranscriptSegment[] | undefined,
  fps: number
): { words: TimelineWord[]; untranscribed: Item[] } {
  const words: TimelineWord[] = []
  const untranscribed: Item[] = []
  for (const item of items) {
    const segments = transcriptOf(item)
    if (!segments) {
      untranscribed.push(item)
      continue
    }
    const timed = segmentsToWords(segments, item, fps)
    const spans = timed.length > 0 ? timed : segmentsToCues(segments, item, fps)
    for (const span of spans) words.push({ itemId: item.id, fromFrame: span.fromFrame, toFrame: span.toFrame, text: span.text.trim() })
  }
  words.sort((a, b) => a.fromFrame - b.fromFrame || a.toFrame - b.toFrame)
  return { words: words.filter((word) => word.text.length > 0), untranscribed }
}

/** The word being spoken at `frame`, as an index into `words`, or -1 between words. */
export function wordAt(words: readonly TimelineWord[], frame: number): number {
  let low = 0
  let high = words.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const word = words[mid]!
    if (frame < word.fromFrame) high = mid - 1
    else if (frame >= word.toFrame) low = mid + 1
    else return mid
  }
  return -1
}

/**
 * The spans of timeline that deleting the selected words removes: each run of consecutive
 * selected words is one span, from its first word's start to its last word's end (half-open,
 * as `remove_range` takes it). Overlapping spans are merged. Last-first.
 */
export function cutRanges(words: readonly TimelineWord[], selected: ReadonlySet<number>): { fromFrame: number; toFrame: number }[] {
  const runs: { fromFrame: number; toFrame: number }[] = []
  let start = -1
  for (let i = 0; i <= words.length; i += 1) {
    const inside = i < words.length && selected.has(i)
    if (inside && start === -1) start = i
    if (!inside && start !== -1) {
      runs.push({ fromFrame: words[start]!.fromFrame, toFrame: words[i - 1]!.toFrame })
      start = -1
    }
  }
  const merged: { fromFrame: number; toFrame: number }[] = []
  for (const run of runs.sort((a, b) => a.fromFrame - b.fromFrame)) {
    const last = merged[merged.length - 1]
    if (last && run.fromFrame <= last.toFrame) last.toFrame = Math.max(last.toFrame, run.toFrame)
    else merged.push({ ...run })
  }
  return merged.filter((range) => range.toFrame > range.fromFrame).reverse()
}

/**
 * Where `query` occurs, as runs of word indices in order — a phrase can span words, so
 * "thank you" finds the two words together. Case and punctuation around words are ignored.
 */
export function findWords(words: readonly TimelineWord[], query: string): number[][] {
  const clean = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, '').trim()
  const terms = clean(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const out: number[][] = []
  for (let i = 0; i + terms.length <= words.length; i += 1) {
    const matches = terms.every((term, k) => {
      const word = clean(words[i + k]!.text)
      // Only the last term may be a prefix, so "thank yo" finds "thank you" as it is typed.
      return k === terms.length - 1 ? word.startsWith(term) || (terms.length === 1 && word.includes(term)) : word === term
    })
    if (matches) out.push(terms.map((_, k) => i + k))
  }
  return out
}
