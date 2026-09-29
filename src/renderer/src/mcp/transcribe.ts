/**
 * `transcribe` — speech to text on this Mac, as captions-ready cues.
 *
 * The transcription runs in main (whisper.cpp); this adapter decides what it is transcribing and
 * where the lines belong. Given a clip, the lines come back already on the timeline — shifted by
 * the clip's in-point and position, scaled by its speed, clipped to its edges — so they go
 * straight into add_captions. The mapping is `segmentsToCues`, shared and tested; doing it here
 * by hand is how captions end up a few seconds early.
 */

import { findAsset } from '@shared/project'
import { segmentsToCues, segmentsToSrt, type TranscriptSegment } from '@shared/transcribe'
import { transcriptFindings } from '@shared/findings'
import { bay } from '@/lib/bay'
import { useEditor } from '@/store/editor'
import { fail, project, resolveAsset, resolveItem, timeline, ToolError, type Handlers } from './helpers'

type Transcript = { segments: TranscriptSegment[]; model: string; language: string }

/**
 * Transcripts already made this session, by file, language and model. `transcribe` and then
 * `add_subtitles` on the same clip is the usual order, and whisper on a long clip is not free —
 * the second asks for what the first already has. A file rewritten under the same path would be
 * served stale, which media files are not, in practice, while bay has them imported.
 */
const transcripts = new Map<string, Promise<Transcript>>()

/**
 * The same transcripts once they have arrived, readable without waiting — for the Transcript
 * panel, which draws words the moment a transcription (its own, the agent's, or `add_subtitles`'s)
 * finishes, and must not start whisper just to learn whether one exists.
 */
const settled = new Map<string, Transcript>()
const listeners = new Set<() => void>()

function keyOf(path: string, language: string | undefined): string {
  return JSON.stringify([path, language ?? 'en', useEditor.getState().whisperModel])
}

/** A transcript this session already has for `path`, or undefined. Never runs whisper. */
export function cachedTranscript(path: string, language?: string): Transcript | undefined {
  return settled.get(keyOf(path, language))
}

/**
 * Any transcript this session has for `path`, whatever language or model made it — for labels
 * (`frame_grid`), where words from a French transcription or last model are still the words said.
 * Prefers the one `cachedTranscript` would return, then the newest. Never runs whisper.
 */
export function anyTranscriptFor(path: string): Transcript | undefined {
  const preferred = cachedTranscript(path)
  if (preferred) return preferred
  let newest: Transcript | undefined
  for (const [key, transcript] of settled) {
    const [keyPath] = JSON.parse(key) as [string, string, unknown]
    if (keyPath === path) newest = transcript
  }
  return newest
}

/** Called whenever a transcript arrives. Returns the unsubscribe. */
export function onTranscript(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Forget every cached transcript — for a test that answers one file differently per case. */
export function forgetTranscripts(): void {
  transcripts.clear()
  settled.clear()
}

/** The source file's speech, from whisper or the session's cache. Fails with a message to show. */
export async function transcribeSource(path: string, language?: string): Promise<Transcript> {
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot run the transcriber.')
  // The user's Settings decide whether a missing model may be fetched, and which model to use.
  const { autoDownloadModels, whisperModel } = useEditor.getState()
  const key = keyOf(path, language)
  let pending = transcripts.get(key)
  if (!pending) {
    pending = api.media.transcribe(path, language, { download: autoDownloadModels, model: whisperModel }).then((result) => {
      if (!result.ok) throw new ToolError(result.error)
      const transcript = { segments: result.segments, model: result.model, language: result.language }
      settled.set(key, transcript)
      for (const listener of listeners) listener()
      return transcript
    })
    transcripts.set(key, pending)
    // A failure is not remembered: the fix (a model, a setting) should work on the next call.
    pending.catch(() => transcripts.delete(key))
  }
  return pending
}

export async function transcribe(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const itemId = typeof args['itemId'] === 'string' ? args['itemId'] : null
  const assetId = typeof args['assetId'] === 'string' ? args['assetId'] : null
  if (!itemId && !assetId) {
    fail('transcribe needs itemId (a clip on the timeline) or assetId (an imported file). read_project lists both.')
  }
  const found = itemId ? resolveItem(itemId) : null
  const asset = found ? findAsset(project(), found.item.assetId) : resolveAsset(assetId!)
  if (!asset?.path) fail('That clip has no media file to transcribe (a title or a generated clip has no speech).')
  if (!asset.hasAudio) fail(`"${asset.name}" has no audio track, so there is nothing to transcribe.`)

  const language = typeof args['language'] === 'string' ? args['language'] : undefined
  const result = await transcribeSource(asset.path, language)

  // A window in the file's own seconds. The transcript is cached per file, so reading a long talk
  // a stretch at a time costs one transcription, and each answer fits in the agent's context.
  const from = finiteArg(args['fromSeconds'])
  const to = finiteArg(args['toSeconds'])
  const windowed = from !== null || to !== null
  const inWindow = result.segments.filter(
    (segment) => (from === null || segment.endSeconds > from) && (to === null || segment.startSeconds < to)
  )
  const page = windowed ? inWindow : inWindow.slice(0, PAGE_LINES)
  const rest = inWindow.length - page.length
  const more =
    rest > 0
      ? {
          more: { lines: rest, fromSeconds: page[page.length - 1]!.endSeconds },
          next: `This is the first ${page.length} of ${inWindow.length} lines. Call transcribe again with the same id and fromSeconds: ${page[page.length - 1]!.endSeconds} for the next stretch (it is cached, so it is instant), or pass fromSeconds/toSeconds to read any stretch.`
        }
      : {}

  const base = { model: result.model, language: result.language, asset: asset.name }
  if (found) {
    const cues = segmentsToCues(page, found.item, timeline().fps)
    return {
      ...base,
      itemId: found.item.id,
      lines: cues.length,
      cues,
      findings: transcriptFindings(result.segments, cues.length),
      next:
        cues.length > 0
          ? 'These cues are in timeline frames for this clip. Pass them to add_captions as `cues` (after the user approves, if approval is on).'
          : 'No speech was found in the part of the file this clip plays.',
      ...more
    }
  }
  return {
    ...base,
    lines: page.length,
    segments: page,
    findings: transcriptFindings(result.segments),
    // The SRT repeats every line; it is only worth its size when it is the whole, short file.
    ...(windowed || rest > 0 ? {} : { srt: segmentsToSrt(page) }),
    next: 'Lines are in seconds from the start of the file. To caption a clip, call transcribe with its itemId instead.',
    ...more
  }
}

/** Lines per answer when no window is given: about 12 minutes of talk, well inside a turn's budget. */
const PAGE_LINES = 250

function finiteArg(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export const handlers: Handlers = {
  transcribe: (args) => transcribe(args),
}
