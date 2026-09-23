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
  /**
   * The line's words with their own times, when whisper was asked for tokens (`-ojf`). What
   * word-by-word subtitles are made of; absent from plain `-oj` output.
   */
  words?: TranscriptWord[]
}

/** One spoken word, in seconds from the start of the source file. Punctuation stays attached. */
export interface TranscriptWord {
  startSeconds: number
  endSeconds: number
  text: string
}

/** A word shorter than this is stretched to it: whisper stamps some tokens with zero length. */
const MIN_WORD_SECONDS = 0.08

/**
 * whisper's tokens as words. Read off real `-ojf` output (`fixtures-whisper-jfk-full.json`): a
 * token starting with a space begins a word, one without continues it ("over"+"think"+"er",
 * ","), and bracketed tokens (`[_BEG_]`, `[_TT_50]`) are timing markers, not speech.
 */
function wordsFromTokens(tokens: unknown): TranscriptWord[] | undefined {
  if (!Array.isArray(tokens)) return undefined
  const words: TranscriptWord[] = []
  for (const raw of tokens) {
    const token = raw as { text?: unknown; offsets?: { from?: unknown; to?: unknown } }
    const text = String(token.text ?? '')
    if (/^\[_?[A-Z_0-9]*_?\]$/.test(text.trim()) || !text.trim()) continue
    const from = Number(token.offsets?.from) / 1000
    const to = Number(token.offsets?.to) / 1000
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    const last = words[words.length - 1]
    if (last && !text.startsWith(' ')) {
      last.text += text
      last.endSeconds = Math.max(last.endSeconds, to)
      continue
    }
    words.push({ startSeconds: from, endSeconds: Math.max(from, to), text: text.trim() })
  }
  // Ordered and never empty in time: a zero-length word would never be on screen to highlight.
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const previous = words[i - 1]
    if (previous && word.startSeconds < previous.endSeconds) word.startSeconds = previous.endSeconds
    if (word.endSeconds - word.startSeconds < MIN_WORD_SECONDS) word.endSeconds = word.startSeconds + MIN_WORD_SECONDS
  }
  return words.length > 0 ? words : undefined
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
    const words = wordsFromTokens((row as { tokens?: unknown }).tokens)
    out.push({ startSeconds: from / 1000, endSeconds: to / 1000, text, ...(words ? { words } : {}) })
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
  return toTimeline(segments, clip, fps)
}

/**
 * The words a clip plays, on the timeline — the same mapping as `segmentsToCues`, per word. Empty
 * when the transcript carries no word times (whisper run without tokens).
 */
export function segmentsToWords(
  segments: readonly TranscriptSegment[],
  clip: Pick<Item, 'from' | 'durationInFrames' | 'sourceStartUs' | 'speed'>,
  fps: number
): TimelineCue[] {
  return toTimeline(segments.flatMap((segment) => segment.words ?? []), clip, fps)
}

/**
 * Source-time spans onto the timeline: shifted by where the clip starts in the file and on the
 * timeline, scaled by its speed, clipped to its edges. A span that straddles the clip's in or
 * out point keeps only the part the clip shows; one entirely outside is dropped.
 */
function toTimeline(
  spans: readonly { startSeconds: number; endSeconds: number; text: string }[],
  clip: Pick<Item, 'from' | 'durationInFrames' | 'sourceStartUs' | 'speed'>,
  fps: number
): TimelineCue[] {
  const speed = effectiveSpeed(clip.speed)
  const sourceStart = clip.sourceStartUs / US_PER_SECOND
  const toFrame = (sourceSeconds: number): number =>
    clip.from + Math.round(((sourceSeconds - sourceStart) / speed) * fps)
  const end = clip.from + clip.durationInFrames
  const cues: TimelineCue[] = []
  for (const span of spans) {
    const from = Math.max(clip.from, toFrame(span.startSeconds))
    const to = Math.min(end, toFrame(span.endSeconds))
    if (to - from < 1) continue
    // Abutting spans stay abutting: rounding must not make one overlap the next.
    const previous = cues[cues.length - 1]
    const start = previous && from < previous.toFrame ? previous.toFrame : from
    if (to - start < 1) continue
    cues.push({ fromFrame: start, toFrame: to, text: span.text })
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
