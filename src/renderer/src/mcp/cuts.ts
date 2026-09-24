/**
 * `detect_cuts` — shot changes inside a video file.
 *
 * The detection runs in main (`media/scene-cuts.ts`, ffmpeg's `scdet`); this adapter decides
 * which file and maps the cuts onto the timeline. The mapping is `cutFrameOnItem`: the first frame
 * of the new shot, so a cut's frame here is the frame `split_at` needs to land on it.
 */

import { clampCutThreshold, DEFAULT_CUT_THRESHOLD, type SceneCut } from '@shared/ipc'
import { allItems, effectiveSpeed, findAsset, itemEnd, US_PER_SECOND, type Asset, type Item } from '@shared/project'
import { bay } from '@/lib/bay'
import { fail, project, resolveAsset, resolveItem, timeline, ToolError, type Handlers } from './helpers'

const seconds = (us: number): number => Math.round(us / 1000) / 1000

async function cutsOf(asset: Asset, threshold: number | undefined): Promise<SceneCut[]> {
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot analyse video.')
  if (!asset.path) fail(`"${asset.name}" has no media file to analyse.`)
  const result = await api.media.cuts(asset.path, threshold === undefined ? {} : { threshold })
  if (!result.ok) throw new ToolError(`Cut detection failed on "${asset.name}": ${result.error}`)
  return result.cuts
}

/**
 * The timeline frame a shot change starts on: the FIRST frame whose source time is at or after
 * the cut. Nearest (the beat mapping, `timelineFrameAt`) is right for a beat, which is a moment;
 * a cut is a boundary, and rounding down to a frame before it puts the old shot's last picture
 * after the split — a one-frame flash of the wrong shot. The epsilon keeps a cut that lands
 * exactly on a frame (2 s at 30 fps is 60.000000001 after the float division) on that frame.
 * Null when the clip does not play it.
 */
export function cutFrameOnItem(item: Item, us: number, fps: number): number | null {
  if (us < item.sourceStartUs) return null
  const elapsedSeconds = (us - item.sourceStartUs) / effectiveSpeed(item.speed) / US_PER_SECOND
  const frame = item.from + Math.ceil(elapsedSeconds * fps - 1e-6)
  return frame < itemEnd(item) ? frame : null
}

/** The cuts a placed clip plays, as timeline frames. A cut on the clip's first frame is its own edit, not one inside it. */
export function cutsOnItem(cuts: readonly SceneCut[], item: Item, fps: number): { frame: number; seconds: number; score: number }[] {
  const out: { frame: number; seconds: number; score: number }[] = []
  for (const cut of cuts) {
    const frame = cutFrameOnItem(item, cut.us, fps)
    if (frame === null || frame <= item.from) continue
    out.push({ frame, seconds: seconds(cut.us), score: cut.score })
  }
  return out
}

export async function detectCuts(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const itemId = typeof args['itemId'] === 'string' ? args['itemId'] : null
  const assetId = typeof args['assetId'] === 'string' ? args['assetId'] : null
  if (!itemId && !assetId) {
    fail('detect_cuts needs itemId (a clip on the timeline) or assetId (an imported file). read_project lists both.')
  }
  const found = itemId ? resolveItem(itemId) : null
  const asset = found ? findAsset(project(), found.item.assetId) : resolveAsset(assetId!)
  if (!asset?.path) fail('That clip has no media file to analyse (a title or a generated clip has no shots).')
  if (!asset.hasVideo || asset.kind !== 'video') fail(`"${asset.name}" is not a video, so it has no shots to cut between.`)
  const threshold = typeof args['threshold'] === 'number' && Number.isFinite(args['threshold']) ? args['threshold'] : undefined

  const cuts = await cutsOf(asset, threshold)
  const fps = timeline().fps
  // The threshold scdet actually ran with: main clamps to 1–100, so a 0 or 250 asked for is not what was used.
  const base = { asset: asset.name, threshold: threshold === undefined ? DEFAULT_CUT_THRESHOLD : clampCutThreshold(threshold) }

  if (found) {
    const onClip = cutsOnItem(cuts, found.item, fps)
    return {
      ...base,
      itemId: found.item.id,
      cutsInFile: cuts.length,
      cuts: onClip,
      next:
        onClip.length > 0
          ? 'Frames are timeline frames inside this clip — split_at on one cuts exactly at the shot change. Check a low-score cut with frame_grid first.'
          : cuts.length > 0
            ? 'The file has cuts, but none inside the part this clip plays.'
            : 'No shot changes were found: this is one continuous shot at this threshold.'
    }
  }

  const placements = allItems(timeline())
    .filter((item) => item.assetId === asset.id)
    .map((item) => ({ itemId: item.id, frames: cutsOnItem(cuts, item, fps).map((c) => c.frame) }))
  return {
    ...base,
    cuts: cuts.map((cut) => ({ seconds: seconds(cut.us), score: cut.score })),
    ...(placements.length > 0 ? { placements } : {}),
    next:
      cuts.length === 0
        ? 'No shot changes were found: this is one continuous shot at this threshold.'
        : 'Times are seconds from the start of the file.' +
          (placements.length > 0 ? ' `placements` gives the same cuts as timeline frames for each clip of this file.' : ' Place it, or call detect_cuts with the itemId of a placed clip, for timeline frames.')
  }
}

export const handlers: Handlers = {
  detect_cuts: (args) => detectCuts(args)
}
