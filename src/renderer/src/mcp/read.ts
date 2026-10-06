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

import { describeChain } from './audioEffects'
import {
  allItems,
  findAsset,
  isCropped,
  itemEnd,
  timelineDuration,
  type Item,
  type Marker
} from '@shared/project'
import { fail, project, resolveItem, store, timeline, usToFramesAtTimeline, type Handlers } from './helpers'
import { audioFinishReport } from './audioFinish'
import { resolveGrade } from '@shared/grade'
import { describeEffects } from './effects'
import { describeKeyframes } from '@shared/keyframes'
import { describeAnimation } from '@shared/animation'
import { linkedPartners } from '@shared/links'
import { binOf, binsOf } from '@shared/bins'
import type { Bin } from '@shared/project'
import { describeFont, importedFonts } from '@shared/fonts'
import { retimeReport } from './retime'

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
    ...(findAsset(project(), item.assetId) ? {} : { assetMissing: true }),
    // A linked pair is one clip to move, trim and delete, so a scan of the timeline must show it
    // without an inspect per item.
    ...(item.linkId ? { linkedItemIds: linkedPartners(timeline(), item.id).map((p) => p.id) } : {}),
    ...(item.audioDetached ? { audioDetached: true } : {})
  }
}

/** One marker as every tool result reports it. */
export function describeMarker(marker: Marker): Record<string, unknown> {
  return {
    id: marker.id,
    frame: marker.frame,
    label: marker.label,
    ...(marker.color ? { color: marker.color } : {})
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
      ...(track.solo ? { solo: true } : {}),
      // The track's effect chain, when it has one (audio_effects with trackId changes it).
      ...(track.audioEffects?.length ? { audioEffects: describeChain(track.audioEffects) } : {}),
      items: track.items.map(describeItem)
    })),
    // Always present, empty or not: an agent that has to test for the key before reading it
    // will eventually forget, and "no markers" is an answer worth stating.
    markers: [...(tl.markers ?? [])].sort((a, b) => a.frame - b.frame).map(describeMarker),
    // The typefaces the project brings, by family — what text, .brf and compositions may name.
    // Always present, like markers: "no imported fonts" is an answer worth stating.
    fonts: importedFonts(state.project.assets).map((asset) => ({
      assetId: asset.id,
      family: asset.font.family,
      ...(asset.font.axes.length > 0 ? { axes: asset.font.axes.map((a) => `${a.tag} ${a.min}–${a.max}`) } : {})
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
  const bins = binsOf(p)
  const binSummary = (bin: Bin | null): { id: string; name: string } | null => (bin ? { id: bin.id, name: bin.name } : null)
  return {
    timeUnit: 'frames',
    ...(bins.length > 0
      ? {
          bins: bins.map((bin) => ({
            id: bin.id,
            name: bin.name,
            assetCount: p.assets.filter((asset) => binOf(p, asset)?.id === bin.id).length
          }))
        }
      : {}),
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
      // Only when import recorded it (1 mono, 2 stereo); older assets simply do not say.
      ...(asset.channels ? { channels: asset.channels } : {}),
      // Only in a pool that has bins, and then on every asset: null is the top of the pool.
      ...(bins.length > 0 ? { bin: binSummary(binOf(p, asset)) } : {}),
      ...(asset.error
        ? { error: asset.error, placeable: false }
        : asset.kind === 'font'
          ? { placeable: false, font: describeFont(asset) }
          : asset.kind === 'lut'
            ? { placeable: false }
            : { placeable: true })
    }))
  }
}

export function inspectItem(args: Record<string, unknown>): Record<string, unknown> {
  const { item, track } = resolveItem(String(args.itemId))
  const asset = findAsset(project(), item.assetId)
  const tl = timeline()
  const soundFinish = audioFinishReport(item, project(), tl)
  const partners = linkedPartners(tl, item.id)
  const pictureOf = partners.find((p) => p.audioDetached)
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
      // handles without deriving it from two other numbers in different units. A reversed clip
      // reads down from its start point, so what is left is what lies before it.
      ...(asset && asset.durationUs > 0
        ? {
            sourceRemainingSeconds:
              (item.reverse ? Math.max(0, item.sourceStartUs) : Math.max(0, asset.durationUs - item.sourceStartUs)) / 1_000_000
          }
        : {}),
      ...retimeReport(item, tl.fps)
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
    // Same absent-means-unset convention: a grade that exists is reported whole, with whether the
    // compositor will actually run it, since an all-neutral grade is stored and changes nothing.
    ...(item.grade ? { grade: item.grade, gradeActive: resolveGrade(item.grade) !== null } : {}),
    // Masks as stored: a subject cut-out's `{ kind: 'subject' }`, then any shapes, in the order they combine.
    ...(item.masks ? { masks: item.masks } : {}),
    // The effect stack in draw order, each with its id (what edit_effects addresses) and whether
    // it will run a pass. Absent means the clip has none.
    ...(item.effects && item.effects.length > 0 ? { effects: describeEffects(item) } : {}),
    // `edit_item` accepts `crop` and `variables`, and this reported neither — so an agent could
    // set them and had no way to read them back. That breaks three things at once: it cannot
    // verify its own edit, it cannot make a relative change ("crop a little more"), and it
    // cannot see what the *user* changed — which is what this tool's own description tells it
    // to do before editing anything it did not just create. Same absent-means-unset convention
    // as `adjustments` above: an all-zero crop is reported as no crop, because "cropped by
    // nothing" is a statement about a caller having set something that does nothing.
    ...(item.crop && isCropped(item.crop) ? { crop: item.crop } : {}),
    ...(item.variables ? { variables: item.variables } : {}),
    // Keys as stored (item-relative frames) and what they do in timeline frames. Absent means no
    // property is animated; where one is, its static field above is not what draws.
    ...(item.keyframes
      ? { keyframes: item.keyframes, animation: describeKeyframes(item) }
      : {}),
    // Animation presets as stored, and the timeline frames each end occupies on this clip.
    ...(item.animation ? { presets: { ...item.animation, plays: describeAnimation(item) } } : {}),
    // What this clip moves, trims, splits and deletes with (see detach_audio).
    ...(partners.length > 0 ? { link: { linkedItemIds: partners.map((p) => p.id) } } : {}),
    audio: item.audioDetached
      ? {
          detached: true,
          soundItemIds: partners.filter((p) => !p.audioDetached && p.assetId === item.assetId).map((p) => p.id),
          note:
            'This clip plays no sound of its own: it was detached. Its fades fade only the picture; ' +
            'level, fades and duck of the sound are on ' +
            (partners.length > 0 ? partners.map((p) => p.id).join(', ') : 'an audio item that is no longer linked') +
            '. detach_audio { action: "reattach" } gives it back.'
        }
      : {
      ...(pictureOf ? { detachedFrom: pictureOf.id } : {}),
      volume: item.volume,
      fadeInFrames: item.fadeInFrames,
      fadeOutFrames: item.fadeOutFrames,
      // J/L offsets as they resolve now and the duck, with any clamp said in words — the same
      // report edit_item returns, so a read and a write cannot describe one clip differently.
      ...(soundFinish.report ?? {}),
      // The clip's own effect chain, in order, with the ids audio_effects edits by.
      ...(item.audioEffects?.length ? { effects: describeChain(item.audioEffects) } : {}),
      ...(soundFinish.warnings.length > 0 ? { notes: soundFinish.warnings } : {})
        },
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
          // What an html asset's composition *declares* it can be given. Without it an agent
          // holding a composition item knows `variables` is an accepted argument and cannot
          // know a single id to put in it, so the field is unusable without reading the file.
          ...(asset.compositionVariables?.length
            ? { compositionVariables: asset.compositionVariables }
            : {}),
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

export const handlers: Handlers = {
  read_project: () => readProject(),
  browse_assets: () => browseAssets(),
  inspect_item: (args) => inspectItem(args),
}
