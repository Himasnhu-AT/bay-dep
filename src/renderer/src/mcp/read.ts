/**
 * The tools that answer questions without changing anything.
 *
 * `read_project` is the one everything else depends on: every id the write tools accept
 * comes from here, so its job is to make a second orienting call unnecessary. That shapes
 * two decisions. Item ends are included even though they are `from + durationInFrames`,
 * because an agent planning an insert needs them and arithmetic is somewhere it can go
 * wrong silently. And asset durations are reported **in frames at this timeline's rate**
 * alongside seconds, because everything else in the surface is frames and converting is the
 * single most likely place for an agent to guess.
 */

import { allItems, findAsset, itemEnd, timelineDuration, type Item } from '@shared/project'
import { fail, project, resolveItem, store, timeline, usToFramesAtTimeline } from './helpers'

function describeItem(item: Item): Record<string, unknown> {
  const asset = findAsset(project(), item.assetId)
  return {
    id: item.id,
    from: item.from,
    durationInFrames: item.durationInFrames,
    endFrame: itemEnd(item),
    asset: asset
      ? { id: asset.id, name: asset.name, kind: asset.kind }
      : { id: item.assetId, name: null, kind: null, missing: true }
  }
}

export function readProject(): Record<string, unknown> {
  const tl = timeline()
  const state = store()
  return {
    // Said once, here, because this is the tool an agent calls first and every other time
    // in this surface is measured in these units.
    timeUnit: 'frames',
    project: { name: state.project.name, savedTo: state.project.filePath ?? null },
    timeline: {
      id: tl.id,
      name: tl.name,
      width: tl.width,
      height: tl.height,
      fps: tl.fps,
      background: tl.background,
      durationInFrames: timelineDuration(tl)
    },
    playhead: state.playhead,
    tracks: tl.tracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      name: track.name,
      locked: track.locked,
      muted: track.muted,
      hidden: track.hidden,
      items: track.items.map(describeItem)
    })),
    assetCount: state.project.assets.length
  }
}

export function browseAssets(): Record<string, unknown> {
  const p = project()
  if (p.assets.length === 0) {
    return {
      assets: [],
      note: 'The media pool is empty. Use import_media with absolute paths before placing anything.'
    }
  }
  return {
    timeUnit: 'frames',
    assets: p.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      path: asset.path,
      // Both, deliberately: frames is what every other tool takes, seconds is what a human
      // brief is written in and what the agent is usually reasoning from.
      durationInFrames: usToFramesAtTimeline(asset.durationUs),
      durationSeconds: Number((asset.durationUs / 1_000_000).toFixed(3)),
      width: asset.width,
      height: asset.height,
      hasVideo: asset.hasVideo,
      hasAudio: asset.hasAudio,
      ...(asset.error ? { error: asset.error, placeable: false } : { placeable: true })
    }))
  }
}

export function inspectItem(args: Record<string, unknown>): Record<string, unknown> {
  const { item, track } = resolveItem(String(args.itemId))
  const asset = findAsset(project(), item.assetId)
  const tl = timeline()
  return {
    timeUnit: 'frames',
    id: item.id,
    track: { id: track.id, name: track.name, kind: track.kind, locked: track.locked },
    timing: {
      from: item.from,
      durationInFrames: item.durationInFrames,
      endFrame: itemEnd(item),
      sourceStartUs: item.sourceStartUs,
      speed: item.speed
    },
    layout: { ...item.layout },
    canvas: { width: tl.width, height: tl.height },
    audio: { volume: item.volume, fadeInFrames: item.fadeInFrames, fadeOutFrames: item.fadeOutFrames },
    asset: asset
      ? {
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          path: asset.path,
          durationInFrames: usToFramesAtTimeline(asset.durationUs),
          width: asset.width,
          height: asset.height,
          hasAudio: asset.hasAudio,
          ...(asset.error ? { error: asset.error } : {})
        }
      : { id: item.assetId, missing: true }
  }
}

/**
 * The frame a time-defaulting tool should use when the caller did not name one.
 *
 * Shared so `preview_frame` and `split_at` cannot disagree about what "defaults to the
 * playhead" means.
 */
export function frameOrPlayhead(args: Record<string, unknown>): number {
  const given = args.frame
  if (given === undefined) return store().playhead
  const frame = Number(given)
  if (!Number.isFinite(frame)) fail(`"frame" must be a number, but got ${JSON.stringify(given)}.`)
  return Math.max(0, Math.round(frame))
}

/** Items crossing `frame`, used to explain a split that had nothing to cut. */
export function itemsCrossing(frame: number): Item[] {
  return allItems(timeline()).filter((item) => frame > item.from && frame < itemEnd(item))
}
