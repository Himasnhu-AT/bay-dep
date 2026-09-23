/**
 * Local speech-to-text, as far as it can be pure: reading whisper.cpp's output, and turning a
 * transcript of a *source file* into caption cues on the *timeline*.
 *
 * whisper.cpp runs in main (see `src/main/media/transcribe.ts`); it transcribes the source file
 * from its start. A clip on the timeline usually plays a window of that file, maybe at another
 * speed, from some frame — so a transcript line at 0:21 in the file belongs at a different place
 * on the timeline, or nowhere. That mapping lives here, once, tested, rather than in every caller.
 */

import { effectiveSpeed, US_PER_SECOND, type Item } from './project'

/** One spoken line, in seconds from the start of the source file. */
export interface TranscriptSegment {
  startSeconds: number
  endSeconds: number
  text: string
}

/**
 * whisper.cpp's `-oj` JSON as segments. Shape read off real output (see
 * `fixtures-whisper-jfk.json`): `transcription[].offsets.{from,to}` in milliseconds, text with a
 * leading space. Empty lines — whisper emits them for silence — are dropped.
 */
export function parseWhisperJson(json: unknown): TranscriptSegment[] {
  const rows = (json as { transcription?: unknown })?.transcription
  if (!Array.isArray(rows)) return []
  const out: TranscriptSegment[] = []
  for (const row of rows) {
    const offsets = (row as { offsets?: { from?: unknown; to?: unknown } }).offsets
    const text = String((row as { text?: unknown }).text ?? '').trim()
    const from = Number(offsets?.from)
    const to = Number(offsets?.to)
    if (!text || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue
    // whisper marks non-speech as bracketed tags; a caption reading "[BLANK_AUDIO]" is noise.
    if (/^\[[^\]]*\]$|^\([^)]*\)$/.test(text)) continue
    out.push({ startSeconds: from / 1000, endSeconds: to / 1000, text })
  }
  return out
}

export interface TimelineCue {
  fromFrame: number
  toFrame: number
  text: string
}

/**
 * The lines a clip actually plays, on the timeline: shifted by where the clip starts in the file
 * and on the timeline, scaled by its speed, and clipped to its edges. A line that straddles the
 * clip's in or out point keeps only the part the clip shows; a line entirely outside is dropped.
 */
export function segmentsToCues(
  segments: readonly TranscriptSegment[],
  clip: Pick<Item, 'from' | 'durationInFrames' | 'sourceStartUs' | 'speed'>,
  fps: number
): TimelineCue[] {
  const speed = effectiveSpeed(clip.speed)
  const sourceStart = clip.sourceStartUs / US_PER_SECOND
  const toFrame = (sourceSeconds: number): number =>
    clip.from + Math.round(((sourceSeconds - sourceStart) / speed) * fps)
  const end = clip.from + clip.durationInFrames
  const cues: TimelineCue[] = []
  for (const segment of segments) {
    const from = Math.max(clip.from, toFrame(segment.startSeconds))
    const to = Math.min(end, toFrame(segment.endSeconds))
    if (to - from < 1) continue
    // Abutting lines stay abutting: rounding must not make one overlap the next.
    const previous = cues[cues.length - 1]
    const start = previous && from < previous.toFrame ? previous.toFrame : from
    if (to - start < 1) continue
    cues.push({ fromFrame: start, toFrame: to, text: segment.text })
  }
  return cues
}

/** Segments as SRT, for saving beside the media or handing to add_captions as `srt`. */
export function segmentsToSrt(segments: readonly TranscriptSegment[]): string {
  const stamp = (seconds: number): string => {
    const ms = Math.max(0, Math.round(seconds * 1000))
    const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
  }
  return segments
    .map((segment, index) => `${index + 1}\n${stamp(segment.startSeconds)} --> ${stamp(segment.endSeconds)}\n${segment.text}\n`)
    .join('\n')
}
