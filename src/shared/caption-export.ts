/**
 * The timeline's captions as an SRT file — the reverse of `add_captions`.
 *
 * Captions are the text items on the tracks `add_captions` makes (`Captions`, `Captions 2`, …),
 * so that is what is exported: one cue per item, in time order, timed in the timeline's frames
 * turned back into milliseconds. Text items on other tracks are titles, not captions, and word-
 * by-word subtitles are compositions with no text items at all, so neither is included.
 */

import { findAsset, framesToUs, type Project, type Timeline } from './project'

const CAPTION_TRACK = /^Captions(?: \d+)?$/

function srtStamp(us: number): string {
  const ms = Math.max(0, Math.round(us / 1000))
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

/** The caption cues on a timeline, in time order: frames and words. */
export function timelineCaptions(project: Pick<Project, 'assets'>, timeline: Timeline): { fromFrame: number; toFrame: number; text: string }[] {
  const cues: { fromFrame: number; toFrame: number; text: string }[] = []
  for (const track of timeline.tracks) {
    if (!CAPTION_TRACK.test(track.name)) continue
    for (const item of track.items) {
      const asset = findAsset(project as Project, item.assetId)
      const text = asset?.kind === 'text' ? (asset.text ?? '').trim() : ''
      if (text) cues.push({ fromFrame: item.from, toFrame: item.from + item.durationInFrames, text })
    }
  }
  return cues.sort((a, b) => a.fromFrame - b.fromFrame || a.toFrame - b.toFrame)
}

/** SRT text for the timeline's captions, or null when it has none. */
export function captionsToSrt(project: Pick<Project, 'assets'>, timeline: Timeline): string | null {
  const cues = timelineCaptions(project, timeline)
  if (cues.length === 0) return null
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtStamp(framesToUs(cue.fromFrame, timeline.fps))} --> ${srtStamp(framesToUs(cue.toFrame, timeline.fps))}\n${cue.text}\n`
    )
    .join('\n')
}
