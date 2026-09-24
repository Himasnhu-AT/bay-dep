/**
 * `detect_beats` — tempo, beats, bars and drop-outs of a piece of music.
 *
 * The analysis runs in main (`media/beats.ts`); this adapter decides which file, keeps the grid
 * on the asset, and maps it onto the clip. The mapping is `beatFramesForItem`, the same one the
 * timeline's snapping reads, so the frame an agent is told is the frame a drag lands on.
 *
 * The grid is written to the asset silently, like a poster: it is derived from the file, not an
 * edit anyone made, and an undo that forgot it would only cost a cached re-read.
 */

import { BEAT_ANALYSIS_VERSION, beatFramesForItem, hasSteadyBeat, timelineFrameAt, type BeatGrid } from '@shared/beats'
import { effectiveSpeed, findAsset, type Asset, type Item } from '@shared/project'
import { bay } from '@/lib/bay'
import { fail, project, resolveAsset, resolveItem, store, timeline, ToolError, type Handlers } from './helpers'

/** The colour of a drop-out marker, so it reads apart from the bars around it. */
const DROP_COLOR = '#E5484D'

const seconds = (us: number): number => Math.round(us / 1000) / 1000

/** The asset's grid, analysed now if it has none or has one from an older analysis or another bar length. */
export async function gridFor(asset: Asset, beatsPerBar: number): Promise<BeatGrid> {
  const held = asset.beats
  if (held && held.version === BEAT_ANALYSIS_VERSION && held.beatsPerBar === beatsPerBar) return held
  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot analyse audio.')
  if (!asset.path) fail(`"${asset.name}" has no media file to analyse.`)
  const result = await api.media.beats(asset.path, { beatsPerBar })
  if (!result.ok) throw new ToolError(`Beat detection failed on "${asset.name}": ${result.error}`)
  store().patchAsset(asset.id, { beats: result.grid })
  return result.grid
}

interface SuggestedMarker {
  frame: number
  label: string
  color?: string
}

/** Markers for add_marker, labelled by the song's own bar count so "Bar 9" means the same bar on every clip. */
function suggestMarkers(grid: BeatGrid, item: Item, fps: number, which: 'beats' | 'downbeats'): SuggestedMarker[] {
  const out: SuggestedMarker[] = []
  const firstDownbeat = grid.downbeatsUs.length > 0 ? grid.beatsUs.indexOf(grid.downbeatsUs[0]!) : -1
  if (which === 'downbeats') {
    grid.downbeatsUs.forEach((us, index) => {
      const frame = timelineFrameAt(item, us, fps)
      if (frame !== null) out.push({ frame, label: `Bar ${index + 1}` })
    })
  } else {
    grid.beatsUs.forEach((us, index) => {
      const frame = timelineFrameAt(item, us, fps)
      if (frame === null) return
      if (firstDownbeat < 0) {
        out.push({ frame, label: `Beat ${index + 1}` })
        return
      }
      const counted = index - firstDownbeat
      const bar = Math.floor(counted / grid.beatsPerBar) + 1
      const beat = (((counted % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar) + 1
      out.push({ frame, label: `${bar}.${beat}` })
    })
  }
  for (const drop of beatFramesForItem(grid, item, fps).dropouts) {
    out.push({ frame: drop.startFrame, label: drop.kind === 'percussion' ? 'Drums out' : 'Silence', color: DROP_COLOR })
  }
  return out.sort((a, b) => a.frame - b.frame)
}

export async function detectBeats(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const itemId = typeof args['itemId'] === 'string' ? args['itemId'] : null
  const assetId = typeof args['assetId'] === 'string' ? args['assetId'] : null
  if (!itemId && !assetId) {
    fail('detect_beats needs itemId (music on the timeline) or assetId (an imported file). read_project lists both.')
  }
  const found = itemId ? resolveItem(itemId) : null
  const asset = found ? findAsset(project(), found.item.assetId) : resolveAsset(assetId!)
  if (!asset?.path) fail('That clip has no media file to analyse (a title or a generated clip has no audio).')
  if (!asset.hasAudio) fail(`"${asset.name}" has no audio track, so it has no beat to find.`)
  const markers = args['markers'] === 'beats' || args['markers'] === 'downbeats' ? args['markers'] : null
  if (markers && !found) fail('markers needs itemId: markers are placed on the timeline, and a file on its own has no place there.')
  const beatsPerBar = typeof args['beatsPerBar'] === 'number' ? Math.round(args['beatsPerBar']) : 4

  const grid = await gridFor(asset, beatsPerBar)
  const steady = hasSteadyBeat(grid)
  const base = {
    asset: asset.name,
    bpm: grid.bpm,
    confidence: grid.confidence,
    steady,
    beatsPerBar: grid.beatsPerBar,
    downbeatConfidence: grid.downbeatConfidence
  }

  if (found) {
    const fps = timeline().fps
    const mapped = beatFramesForItem(grid, found.item, fps)
    const framesPerBeat = grid.bpm > 0 ? Math.round(((fps * 60) / grid.bpm / effectiveSpeed(found.item.speed)) * 100) / 100 : null
    return {
      ...base,
      itemId: found.item.id,
      framesPerBeat,
      beats: mapped.beats,
      downbeats: mapped.downbeats,
      dropouts: mapped.dropouts,
      ...(markers ? { markers: suggestMarkers(grid, found.item, fps, markers) } : {}),
      next: !steady
        ? 'No steady beat was found in this music — tell the user rather than cutting to a grid that is a guess.'
        : mapped.beats.length === 0
          ? 'The music has a beat, but none of it falls inside what this clip plays. Check its in-point, or analyse by assetId for the whole file.'
          : 'Beats are timeline frames for this clip. Cut on them with split_at / trim_item, or place shots at them with place_asset / edit_item.' +
            (markers ? ' Pass `markers` to add_marker as its `markers` list to put them on the timeline.' : '') +
            (mapped.downbeats.length === 0 ? ' No bar accent was clear, so downbeats is empty.' : '')
    }
  }
  return {
    ...base,
    beats: grid.beatsUs.map(seconds),
    downbeats: grid.downbeatsUs.map(seconds),
    dropouts: grid.dropouts.map((d) => ({ start: seconds(d.startUs), end: seconds(d.endUs), kind: d.kind })),
    next: 'Times are seconds from the start of the file. Call detect_beats with the itemId of a placed clip for timeline frames.'
  }
}

export const handlers: Handlers = {
  detect_beats: (args) => detectBeats(args)
}
