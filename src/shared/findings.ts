/**
 * What a finished result is checked against before the agent may call it done.
 *
 * "Done" used to mean "the tool returned". An export that finished with no audio track, a file
 * three seconds short, or a transcription that heard nothing all returned cleanly — and an agent
 * reading `stage: 'done'` told the user their video was ready. A finding is the sentence that
 * stops that: `blocking` means the result is wrong and must be fixed (or reported) before
 * anyone calls it finished; `warn` means it is probably fine and worth a look.
 *
 * The checks are pure — they take what was measured and what was expected — so they are held
 * still by tests without ffmpeg. Measuring is the caller's job: main probes the delivered file
 * (`export/encode.ts`), the renderer hands over the transcript it already has.
 */

import type { TranscriptSegment } from './transcribe'

export interface Finding {
  severity: 'blocking' | 'warn'
  /** What is wrong, as the user would be told it. */
  message: string
  /** What to do about it, when there is something to do. */
  fix?: string
}

/** What was measured of a delivered export. `null` fields were not measurable. */
export interface DeliveredFile {
  /** Bytes on disk; null when nothing is there. */
  sizeBytes: number | null
  hasVideo: boolean
  hasAudio: boolean
  /** Container duration; null when the probe could not say. */
  durationUs: number | null
}

export interface ExpectedExport {
  /** The format carries pictures (every format but the audio-only ones). */
  video: boolean
  /** The timeline has sound the export mixed — so the file must carry an audio stream. */
  audio: boolean
  /** The range's length: frames / fps. */
  durationUs: number
}

/** How far a delivered file's length may stray from the range before it is wrong: 2%. */
export const DURATION_TOLERANCE = 0.02

/**
 * The findings for a delivered export. `probeError` is what the prober said when it could not
 * read the file at all — which is itself the finding, since a file ffprobe cannot open is a file
 * no player will open either.
 */
export function exportFindings(
  file: DeliveredFile | null,
  expected: ExpectedExport,
  probeError?: string
): Finding[] {
  const out: Finding[] = []
  if (!file || file.sizeBytes === null) {
    return [
      {
        severity: 'blocking',
        message: 'The export reported done, but there is no file at the output path.',
        fix: 'Export again; if it repeats, choose another destination folder.'
      }
    ]
  }
  if (file.sizeBytes === 0) {
    return [
      {
        severity: 'blocking',
        message: 'The exported file is empty (0 bytes).',
        fix: 'Export again; check the destination disk has space.'
      }
    ]
  }
  if (probeError !== undefined) {
    return [
      {
        severity: 'blocking',
        message: `The exported file could not be read back: ${probeError}`,
        fix: 'Export again; a file that cannot be read back will not play anywhere.'
      }
    ]
  }
  if (expected.video && !file.hasVideo) {
    out.push({
      severity: 'blocking',
      message: 'The exported file has no video stream.',
      fix: 'Export again to a video format (mp4, mov or webm).'
    })
  }
  if (expected.audio && !file.hasAudio) {
    out.push({
      severity: 'blocking',
      message: 'The timeline has sound, but the exported file has no audio stream.',
      fix: 'Check the export message for why the audio mix failed, fix the clip it names, and export again.'
    })
  }
  if (file.durationUs === null) {
    out.push({ severity: 'warn', message: 'The exported file does not state its length, so it could not be checked.' })
  } else if (expected.durationUs > 0) {
    const drift = Math.abs(file.durationUs - expected.durationUs) / expected.durationUs
    if (drift > DURATION_TOLERANCE) {
      const got = (file.durationUs / 1_000_000).toFixed(2)
      const want = (expected.durationUs / 1_000_000).toFixed(2)
      out.push({
        severity: 'blocking',
        message: `The exported file is ${got}s long; the range exported is ${want}s (${Math.round(drift * 100)}% off).`,
        fix: 'Export again; if the length is still wrong, report it rather than delivering the file.'
      })
    }
  }
  return out
}

/**
 * The findings for a transcription. `playedCues` is how many lines landed inside a clip, when the
 * transcription was of a placed clip — whisper can hear a whole file and the clip play none of it.
 */
export function transcriptFindings(segments: readonly TranscriptSegment[], playedCues?: number): Finding[] {
  if (segments.length === 0) {
    return [
      {
        severity: 'blocking',
        message: 'No speech was found in this file.',
        fix: 'Check the file has spoken audio and the language is right; do not caption it with guessed words.'
      }
    ]
  }
  const words = segments.map((s) => s.text.trim()).join(' ').trim()
  if (words.length === 0) {
    return [
      {
        severity: 'blocking',
        message: `The transcript has ${segments.length} line${segments.length === 1 ? '' : 's'} and no words in any of them.`,
        fix: 'Try another language or a larger model in Settings; do not caption it with guessed words.'
      }
    ]
  }
  if (playedCues === 0) {
    return [
      {
        severity: 'warn',
        message: 'The file has speech, but none of it falls inside the part this clip plays.',
        fix: 'Check the clip’s in-point, or transcribe by assetId for the whole file.'
      }
    ]
  }
  return []
}

/** True when any finding must be fixed before the result is called done. */
export function hasBlocking(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === 'blocking')
}
