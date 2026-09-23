/**
 * `add_subtitles` and `set_canvas` — the two steps a short-form edit needs that bay's other tools
 * cannot do: word-by-word subtitles in a chosen design, and a vertical frame.
 *
 * Subtitles: the clip's speech is transcribed (cached — `transcribe` first is free), its words
 * mapped onto the clip, turned into one composition by `@shared/subtitles`, written by main where
 * bay keeps generated files, imported, and placed over the clip by the store in one undo step.
 */

import { CANVAS_PRESETS, findAsset } from '@shared/project'
import { SUBTITLE_STYLES, findSubtitleStyle, subtitleComposition, type SubtitleWord } from '@shared/subtitles'
import { segmentsToCues, segmentsToWords, type TimelineCue } from '@shared/transcribe'
import { bay } from '@/lib/bay'
import { fail, project, resolveItem, store, timeline } from './helpers'
import { transcribeSource } from './transcribe'

/**
 * When whisper gave lines but no word times, each line's words share its time evenly. Coarser
 * than real word times, and far better than one static line for a design built on words.
 */
function spreadCues(cues: readonly TimelineCue[]): TimelineCue[] {
  return cues.flatMap((cue) => {
    const parts = cue.text.split(/\s+/).filter(Boolean)
    const each = (cue.toFrame - cue.fromFrame) / Math.max(1, parts.length)
    return parts.map((text, i) => ({
      text,
      fromFrame: Math.round(cue.fromFrame + i * each),
      toFrame: Math.round(cue.fromFrame + (i + 1) * each)
    }))
  })
}

export async function addSubtitles(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const styleId = typeof args['style'] === 'string' ? args['style'] : 'spotlight'
  const style = findSubtitleStyle(styleId)
  if (!style) fail(`There is no subtitle style "${styleId}". Choose one of: ${SUBTITLE_STYLES.map((s) => s.id).join(', ')}.`)
  const { item } = resolveItem(String(args['itemId'] ?? ''))
  const asset = findAsset(project(), item.assetId)
  if (!asset?.path) fail('That clip has no media file to transcribe (a title or a generated clip has no speech).')
  if (!asset.hasAudio) fail(`"${asset.name}" has no audio track, so there is nothing to subtitle.`)
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot write the subtitles.')

  const language = typeof args['language'] === 'string' ? args['language'] : undefined
  const transcript = await transcribeSource(asset.path, language)
  const tl = timeline()
  let words = segmentsToWords(transcript.segments, item, tl.fps)
  const timed = words.length > 0
  if (!timed) words = spreadCues(segmentsToCues(transcript.segments, item, tl.fps))
  if (words.length === 0) fail('No speech was found in the part of the file this clip plays, so there is nothing to subtitle.')

  const toSeconds = (frame: number): number => (frame - item.from) / tl.fps
  const subtitleWords: SubtitleWord[] = words.map((w) => ({ start: toSeconds(w.fromFrame), end: toSeconds(w.toFrame), text: w.text }))
  let html: string
  try {
    html = subtitleComposition(style.id, subtitleWords, {
      width: tl.width,
      height: tl.height,
      durationSeconds: item.durationInFrames / tl.fps,
      ...(typeof args['accent'] === 'string' ? { accent: args['accent'] } : {}),
      ...(typeof args['scale'] === 'number' ? { scale: args['scale'] } : {}),
      ...(typeof args['bottom'] === 'number' ? { bottom: args['bottom'] } : {})
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }

  const written = await api.composition.writeGenerated(`subtitles-${style.id}-${asset.name}`, html)
  if (!written.ok) fail(written.error)
  const [imported] = await api.media.importPaths([written.path])
  if (!imported?.asset || imported.asset.error) {
    fail(`The subtitles were written to ${written.path} but could not be imported: ${imported?.asset.error ?? 'nothing came back'}.`)
  }
  const placed = store().placeSubtitles(item.id, { ...imported.asset, name: `Subtitles · ${style.name} · ${asset.name}` })
  if ('error' in placed) fail(placed.error)

  return {
    style: style.id,
    itemId: placed.itemId,
    track: placed.trackName,
    words: subtitleWords.length,
    ...(placed.replaced > 0 ? { replaced: `${placed.replaced} earlier subtitle clip(s) over this clip` } : {}),
    ...(timed ? {} : { note: 'whisper gave no word times, so each line\'s words share its time evenly.' }),
    model: transcript.model,
    next: 'Look at a frame mid-sentence with preview_frame to check the size and position; call again with another style to swap.'
  }
}

export function setCanvas(args: Record<string, unknown>): Record<string, unknown> {
  const presetId = typeof args['preset'] === 'string' ? args['preset'] : null
  const preset = presetId ? CANVAS_PRESETS.find((p) => p.id === presetId) : undefined
  if (presetId && !preset) fail(`There is no canvas preset "${presetId}". Presets: ${CANVAS_PRESETS.map((p) => p.id).join(', ')}.`)
  const width = preset?.width ?? Number(args['width'])
  const height = preset?.height ?? Number(args['height'])
  if (!preset && (!Number.isFinite(width) || !Number.isFinite(height))) {
    fail(`Pass a preset (${CANVAS_PRESETS.map((p) => p.id).join(', ')}) or both width and height.`)
  }
  const fit = args['fit'] === 'cover' || args['fit'] === 'contain' ? args['fit'] : 'auto'
  const before = timeline()
  const was = `${before.width}×${before.height}`
  const result = store().resizeCanvas(width, height, fit)
  if ('error' in result) fail(result.error)
  return {
    canvas: `${width}×${height}`,
    was,
    refitted: result.refitted,
    next: 'Templates and subtitles already placed were written for the old shape; add them again. Check a frame with preview_frame.'
  }
}
