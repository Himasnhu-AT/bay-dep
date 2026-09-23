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
import { bay } from '@/lib/bay'
import { useEditor } from '@/store/editor'
import { fail, project, resolveAsset, resolveItem, timeline, ToolError } from './helpers'

type Transcript = { segments: TranscriptSegment[]; model: string; language: string }

/**
 * Transcripts already made this session, by file, language and model. `transcribe` and then
 * `add_subtitles` on the same clip is the usual order, and whisper on a long clip is not free —
 * the second asks for what the first already has. A file rewritten under the same path would be
 * served stale, which media files are not, in practice, while bay has them imported.
 */
const transcripts = new Map<string, Promise<Transcript>>()

/** Forget every cached transcript — for a test that answers one file differently per case. */
export function forgetTranscripts(): void {
  transcripts.clear()
}

/** The source file's speech, from whisper or the session's cache. Fails with a message to show. */
export async function transcribeSource(path: string, language?: string): Promise<Transcript> {
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot run the transcriber.')
  // The user's Settings decide whether a missing model may be fetched, and which model to use.
  const { autoDownloadModels, whisperModel } = useEditor.getState()
  const key = JSON.stringify([path, language ?? 'en', whisperModel])
  let pending = transcripts.get(key)
  if (!pending) {
    pending = api.media.transcribe(path, language, { download: autoDownloadModels, model: whisperModel }).then((result) => {
      if (!result.ok) throw new ToolError(result.error)
      return { segments: result.segments, model: result.model, language: result.language }
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

  const base = { model: result.model, language: result.language, asset: asset.name }
  if (found) {
    const cues = segmentsToCues(result.segments, found.item, timeline().fps)
    return {
      ...base,
      itemId: found.item.id,
      lines: cues.length,
      cues,
      next:
        cues.length > 0
          ? 'These cues are in timeline frames for this clip. Pass them to add_captions as `cues` (after the user approves, if approval is on).'
          : 'No speech was found in the part of the file this clip plays.'
    }
  }
  return {
    ...base,
    lines: result.segments.length,
    segments: result.segments,
    srt: segmentsToSrt(result.segments),
    next: 'Lines are in seconds from the start of the file. To caption a clip, call transcribe with its itemId instead.'
  }
}
