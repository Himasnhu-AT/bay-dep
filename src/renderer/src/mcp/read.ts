/**
 * The tools that answer questions without changing anything.
 *
 * `read_project` is the one everything else depends on: every id the write tools accept
 * comes from here, so its job is to make a second orienting call unnecessary. That shapes
 * three decisions, each measured on a 200-clip timeline.
 *
 * **Item ends are included** even though they are `from + durationInFrames`. It costs 9% of
 * the payload; an agent planning an insert needs them, and arithmetic is somewhere it goes
 * wrong silently. Cutting a correctness aid to save 9% would be optimising the number that
 * is easy to see rather than the one that matters.
 *
 * **Asset durations are in frames at this timeline's rate**, alongside seconds, because
 * everything else in the surface is frames and converting is where an agent guesses.
 *
 * **Assets are listed once and items carry an id.** The nested `{ id, name, kind }` block
 * used to repeat identically on every item — the same 36-character uuid two hundred times,
 * 31% of a 200-clip payload (36,286 bytes down to 25,189). It is the rare change where the
 * cheap win and the readable one are the same edit: the repetition was noise between the
 * fields that matter.
 */

import { allItems, findAsset, itemEnd, timelineDuration, type Item } from '@shared/project'
import { fail, project, resolveItem, store, timeline, usToFramesAtTimeline } from './helpers'

function describeItem(item: Item): Record<string, unknown> {
  return {
    id: item.id,
    from: item.from,
    durationInFrames: item.durationInFrames,
    endFrame: itemEnd(item),
    assetId: item.assetId,
    // The one thing that stays on the item rather than moving to the lookup. A missing
    // asset is rare, so it costs nothing here, and it is a correctness signal an agent
    // scanning items must not have to resolve an id to notice.
    ...(findAsset(project(), item.assetId) ? {} : { assetMissing: true })
  }
}

/** The assets the timeline actually uses, once each, for `assetId` to be resolved against. */
function assetsInUse(tl: ReturnType<typeof timeline>): Record<string, unknown> {
  const used: Record<string, unknown> = {}
  for (const track of tl.tracks) {
    for (const item of track.items) {
      if (used[item.assetId]) continue
      const asset = findAsset(project(), item.assetId)
      used[item.assetId] = asset
        ? { name: asset.name, kind: asset.kind, ...(asset.error ? { error: asset.error } : {}) }
        : { name: null, kind: null, missing: true }
    }
  }
  return used
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
    // Keyed by the `assetId` each item carries. Only what the timeline uses — the full pool,
    // including anything imported but not placed, is `browse_assets`.
    assets: assetsInUse(tl),
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
      // Seconds, because that is the unit `edit_item` accepts. A surface that takes seconds
      // and reports microseconds is a trap with a plausible-looking value in it — 10 read
      // back as 10000000 invites a round trip that lands the clip 115 days into the file.
      sourceStartSeconds: item.sourceStartUs / 1_000_000,
      speed: item.speed,
      // What is left of the source from here, so a caller can size a trim or a transition's
      // handles without deriving it from two other numbers in different units.
      ...(asset && asset.durationUs > 0
        ? {
            sourceRemainingSeconds: Math.max(0, asset.durationUs - item.sourceStartUs) / 1_000_000
          }
        : {})
    },
    layout: { ...item.layout },
    canvas: { width: tl.width, height: tl.height },
    // Only on text items, and only once something has been set: absent means the item draws
    // the default look, which is a different statement from "styled, with these defaults".
    ...(item.text ? { text: item.text } : {}),
    // Absent means "no adjustments", which is a different statement from "adjustments, all at
    // their identity values" — the second is a caller having set something that does nothing.
    ...(item.adjustments ? { adjustments: item.adjustments } : {}),
    ...(item.blendMode ? { blendMode: item.blendMode } : {}),
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
