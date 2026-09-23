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
import { segmentsToCues, segmentsToSrt } from '@shared/transcribe'
import { bay } from '@/lib/bay'
import { useEditor } from '@/store/editor'
import { fail, project, resolveAsset, resolveItem, timeline } from './helpers'

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

  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot run the transcriber.')
  const language = typeof args['language'] === 'string' ? args['language'] : undefined
  // The user's Settings decide whether a missing model may be fetched, and which model to use.
  const { autoDownloadModels, whisperModel } = useEditor.getState()
  const result = await api.media.transcribe(asset.path, language, { download: autoDownloadModels, model: whisperModel })
  if (!result.ok) fail(result.error)

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
