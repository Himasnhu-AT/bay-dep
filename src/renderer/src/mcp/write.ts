/**
 * The tools that change the project.
 *
 * Everything here goes through the existing store actions, and each tool is wrapped in one
 * `transact` so that **one tool call is one undo step**. That is not tidiness: `undo` is
 * itself a tool, and its description promises it reverses exactly what the agent last did.
 * An `edit_item` that moved a clip and changed its volume as two entries would leave `undo`
 * putting the volume back and the clip where the agent dragged it — a half-reverted project
 * neither the user nor the agent asked for.
 *
 * The store's mutators refuse silently: `moveItem` returns without moving when the
 * destination is locked or occupied, and `patchItem` does nothing on a locked track. A
 * silent refusal reaching an agent as a successful call is the failure shape this codebase
 * keeps rediscovering, so every tool here checks the conditions *first* and fails with the
 * reason and the way out.
 */

import { completeBrfImports } from '@/lib/brfImport'
import {
  allItems,
  findAsset,
  framesToUs,
  itemEnd,
  timelineDuration,
  usToFrames,
  type Item,
  type Layout,
  type TrackKind
} from '@shared/project'
import { findTool, resolveId } from '@shared/mcp'
import { describeFont } from '@shared/fonts'
import { linkedPartners, withLinked } from '@shared/links'
import { cutoutPartner } from '@shared/behind-subject'
import { itemRippleNote, planItemRipple } from '@shared/item-ripple'
import { planSpeed, retimedLength, type SpeedPlan } from '@shared/speed'
import { asBlendMode, lookWarnings, mergeAdjustments } from './adjustments'
import { audioFinishPatch, audioFinishReport } from './audioFinish'
import { GRADEABLE_KINDS, gradeWarnings, mergeGrade } from './grade'
import { coerce } from '@shared/composition'
import { activeTimeline, isCropped, normaliseCrop } from '@shared/project'
import { bay } from '@/lib/bay'
import { stillDurationFrames } from '@/store/editing-prefs'
import {
  assertNoCollision,
  assertUnlocked,
  fail,
  project,
  resolveAsset,
  resolveItem,
  resolveTrack,
  store,
  timeline,
  usToFramesAtTimeline, type Handlers } from './helpers'
import { frameOrPlayhead, itemsCrossing } from './read'
import { mergeTextStyle } from './textStyle'
import { describeKeyframes, mergeKeyframes } from '@shared/keyframes'
import { KEYFRAME_PROPERTIES } from '@shared/project'

export async function importMedia(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const paths = args.paths as string[]
  if (paths.length === 0) fail('No paths were given, so there is nothing to import.')
  const relative = paths.filter((p) => !p.startsWith('/'))
  if (relative.length > 0) {
    fail(
      `These paths are not absolute: ${relative.join(', ')}. bay resolves nothing relative to a ` +
        `working directory, because it has no relationship to yours — pass full paths.`
    )
  }

  const api = bay()
  if (!api) fail('This window has no bridge to the app, so media cannot be imported.')

  let imported
  try {
    imported = await api.media.importPaths(paths)
  } catch (error) {
    fail(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  imported = await completeBrfImports(imported)
  store().addAssets(imported.map((entry) => entry.asset))
  return {
    assets: imported.map((entry) => ({
      id: entry.asset.id,
      name: entry.asset.name,
      kind: entry.asset.kind,
      path: entry.asset.path,
      durationInFrames: usToFramesAtTimeline(entry.asset.durationUs),
      hasAudio: entry.asset.hasAudio,
      hasVideo: entry.asset.hasVideo,
      reused: entry.reused,
      ...(entry.asset.error
        ? { error: entry.asset.error, placeable: false }
        : entry.asset.kind === 'font'
          ? { placeable: false, font: describeFont(entry.asset) }
          : entry.asset.kind === 'lut'
          ? {
              placeable: false,
              lutSize: entry.asset.lut?.size,
              use: `A colour LUT — apply it with edit_item { grade: { lut: { assetId: "${entry.asset.id}", intensity: 1 } } }.`
            }
          : { placeable: true })
    })),
    // Said explicitly because the catalog warns about it and an agent that retries a
    // corrupt file burns a turn discovering the same thing.
    unreadable: imported.filter((e) => e.asset.error).length
  }
}

export function placeAsset(args: Record<string, unknown>): Record<string, unknown> {
  const asset = resolveAsset(String(args.assetId))
  if (asset.error) {
    fail(
      `Asset ${asset.name} could not be read (${asset.error}), so it cannot be placed. ` +
        `Re-importing will not help — the file itself is the problem.`
    )
  }

  if (asset.kind === 'font') {
    const family = asset.font?.family ?? asset.name
    fail(
      `${asset.name} is a font, which is not placed: name its family "${family}" instead — ` +
        `text.fontFamily on a text item, font in .brf text, or font-family in a composition.`
    )
  }

  if (asset.kind === 'lut') {
    fail(
      `${asset.name} is a colour LUT, which has no picture of its own to place. Apply it to a clip ` +
        `with edit_item { itemId, grade: { lut: { assetId: "${asset.id}", intensity: 1 } } }.`
    )
  }

  const tl = timeline()
  const atFrame = args.atFrame === undefined ? store().playhead : Number(args.atFrame)
  const wantedKind: TrackKind =
    asset.hasVideo || asset.kind === 'image' || asset.kind === 'text' ? 'video' : 'audio'

  let trackId: string | undefined
  if (args.trackId !== undefined) {
    const track = resolveTrack(String(args.trackId))
    if (track.kind !== wantedKind) {
      fail(
        `${asset.name} needs a ${wantedKind} track but ${track.name} is ${track.kind}. ` +
          `Omit trackId to let bay pick one, or add_track with kind "${wantedKind}".`
      )
    }
    assertUnlocked(track, `placing ${asset.name}`)
    const duration = Math.max(
      1,
      asset.durationUs > 0 ? usToFramesAtTimeline(asset.durationUs) : stillDurationFrames(tl.fps)
    )
    // Checked at the frame the store will use: the store places at the rounded, non-negative
    // frame, and treats `trackId` as where the clip was aimed — a clash there would send it to
    // another track without a word. The agent named this track, so it gets the conflict instead.
    assertNoCollision(track, { id: '', from: Math.max(0, Math.round(atFrame)), durationInFrames: duration })
    trackId = track.id
  }

  let placed: string | null = null
  store().transact(() => {
    placed = store().placeAsset(asset.id, atFrame, trackId)
  })
  if (!placed) fail(`${asset.name} could not be placed at frame ${atFrame}.`)

  const { item, track } = resolveItem(placed)
  // A video with sound arrives with its sound on its own linked clip (Preferences › Editing);
  // name it, so the agent does not find an item it did not ask for and wonder where it came from.
  const sound = item.linkId
    ? activeTimeline(store().project)
        ?.tracks.flatMap((t) => t.items.map((i) => ({ i, t })))
        .find(({ i, t }) => i.linkId === item.linkId && i.id !== item.id && t.kind === 'audio')
    : undefined
  return {
    itemId: item.id,
    trackId: track.id,
    trackName: track.name,
    from: item.from,
    durationInFrames: item.durationInFrames,
    endFrame: itemEnd(item),
    ...(sound
      ? {
          soundItemId: sound.i.id,
          soundTrack: sound.t.name,
          note: `Its sound is a separate clip linked to it on ${sound.t.name} (${sound.i.id}); they move, trim and delete together. Set volume/fades on the sound clip.`
        }
      : {})
  }
}

/** edit_item arguments that set a picture field — on a subject cut-out, its clip's (`CUTOUT_PICTURE_FIELDS`). */
const PICTURE_ARGS = ['left', 'top', 'width', 'height', 'opacity', 'rotation', 'scale', 'crop', 'keyframes', 'grade', 'adjustments', 'fadeInFrames', 'fadeOutFrames'] as const

export function editItem(args: Record<string, unknown>): Record<string, unknown> {
  const { item, track } = resolveItem(String(args.itemId))
  assertUnlocked(track, `editing ${item.id}`)
  // A subject cut-out draws with its clip's picture (`cutoutAsDrawn`): its framing, crop, keys,
  // grade and look are the clip's, so an edit of them belongs on the clip.
  const clip = cutoutPartner(timeline(), item)
  if (clip) {
    const picture = PICTURE_ARGS.filter((key) => args[key] !== undefined)
    if (picture.length > 0) {
      fail(
        `${item.id} is the subject cut-out of clip ${clip.id} and draws with that clip's picture, so ${picture.join(', ')} ` +
          `must be set on the clip: edit_item({ itemId: "${clip.id}", … }). The cut-out follows it — zoom, crop, keyframes and grade included.`,
        'This is the subject cut-out of the clip under the title. Select that clip to change its framing, crop, keyframes or grade — the cut-out follows it.'
      )
    }
  }

  const destination = args.trackId === undefined ? track : resolveTrack(String(args.trackId))
  if (destination.id !== track.id) {
    if (destination.kind !== track.kind) {
      fail(
        `Item ${item.id} is on a ${track.kind} track and ${destination.name} is ` +
          `${destination.kind}. An item cannot change kind; place a different asset instead.`
      )
    }
    assertUnlocked(destination, `moving ${item.id} onto ${destination.name}`)
  }

  const from = args.from === undefined ? item.from : Math.max(0, Math.round(Number(args.from)))
  let durationInFrames =
    args.durationInFrames === undefined
      ? item.durationInFrames
      : Math.max(1, Math.round(Number(args.durationInFrames)))

  // Speed keeps the footage, as in every editor and in the clip menu's Speed… (`@shared/speed`):
  // with no durationInFrames, the clip's length changes so the same stretch of source plays,
  // clamped to the footage. In place, it stops at the next clip on its (or a linked clip's)
  // track unless `ripple` moves the later clips; moved in the same call, a collision is refused
  // like any other move. An explicit durationInFrames is kept as given.
  if (args.speed !== undefined && !(Number(args.speed) > 0)) {
    fail(`speed must be greater than 0; got ${JSON.stringify(args.speed)}.`)
  }
  let speedPlan: SpeedPlan | null = null
  if (args.speed !== undefined && args.durationInFrames === undefined) {
    const speed = Number(args.speed)
    if (from === item.from && destination.id === track.id) {
      speedPlan = planSpeed(project(), timeline(), item.id, speed, { ripple: args.ripple === true })
      if (speedPlan) durationInFrames = speedPlan.length
    } else {
      const { wanted, available } = retimedLength(item, findAsset(project(), item.assetId)?.durationUs ?? 0, speed, timeline().fps)
      durationInFrames = Math.min(wanted, available)
    }
  }

  const timingChanged =
    from !== item.from || durationInFrames !== item.durationInFrames || destination.id !== track.id
  // A speed plan already fits its length (clamped or rippled), so only other timing is checked.
  if (timingChanged && !speedPlan) {
    assertNoCollision(destination, { id: item.id, from, durationInFrames })
  }
  // Linked clips (a picture and its detached sound) take the same change of position, length,
  // in-point and speed, so they are checked here too — a refusal after the fact would leave the
  // agent believing both moved. `linked: false` changes this clip alone.
  const linked = args.linked !== false
  const partners = linked ? linkedPartners(timeline(), item.id) : []
  if (partners.length > 0 && !speedPlan && (from !== item.from || durationInFrames !== item.durationInFrames)) {
    for (const partner of partners) {
      const partnerTrack = resolveTrack(partner.trackId)
      assertUnlocked(partnerTrack, `moving ${partner.id}, which is linked to ${item.id} (pass linked: false to edit ${item.id} alone)`)
      const partnerFrom = partner.from + (from - item.from)
      if (partnerFrom < 0) {
        fail(
          `${partner.id} is linked to ${item.id} and would start at frame ${partnerFrom}. Move ${item.id} ` +
            `to frame ${item.from - partner.from} or later, or pass linked: false to move it alone.`
        )
      }
      assertNoCollision(partnerTrack, {
        id: partner.id,
        from: partnerFrom,
        durationInFrames: Math.max(1, partner.durationInFrames + (durationInFrames - item.durationInFrames))
      })
    }
  }

  const layout: Layout = { ...item.layout }
  for (const key of ['left', 'top', 'width', 'height', 'opacity', 'rotation'] as const) {
    if (args[key] !== undefined) layout[key] = Number(args[key])
  }
  if (layout.width < 1 || layout.height < 1) {
    fail(`width and height must be at least 1 pixel; got ${layout.width}x${layout.height}.`)
  }
  if (args.scale !== undefined) {
    const scale = Number(args.scale)
    if (!Number.isFinite(scale) || scale < 0 || scale > 100) {
      fail(`scale is a zoom about the item's centre, 0..100 with 1 unchanged; got ${JSON.stringify(args.scale)}.`)
    }
    // 1 is stored as absence, so an unzoomed clip carries no field and skips the transform.
    if (scale === 1) delete layout.scale
    else layout.scale = scale
  }

  const patch: Partial<Omit<Item, 'id' | 'trackId'>> = { from, durationInFrames, layout }
  if (args.volume !== undefined) patch.volume = Number(args.volume)
  if (args.speed !== undefined && !speedPlan) patch.speed = Number(args.speed)
  if (args.fadeInFrames !== undefined) patch.fadeInFrames = Math.round(Number(args.fadeInFrames))
  if (args.fadeOutFrames !== undefined) patch.fadeOutFrames = Math.round(Number(args.fadeOutFrames))

  // Which part of the source plays here. **Seconds in, seconds out** — the schema takes
  // seconds because six zeros are easy to get wrong and the error is silent: a clip reading
  // from the wrong place still plays and nothing in the result says otherwise. So the
  // conversion happens here, at the boundary, and `inspect_item` reports the same unit.
  //
  // It deliberately does not touch `from`. Only what plays at that position changes, and
  // conflating the two produces a clip that appears to jump when it is retimed — which reads
  // as a timeline bug rather than a unit one.
  const sourceAsset = findAsset(project(), item.assetId)
  let sourceTailWarning: string | null = null
  if (args.sourceStartSeconds !== undefined) {
    const seconds = Number(args.sourceStartSeconds)
    if (!Number.isFinite(seconds) || seconds < 0) {
      fail(
        `sourceStartSeconds must be a number of seconds from the beginning of the file, at ` +
          `least 0; got ${JSON.stringify(args.sourceStartSeconds)}.`
      )
    }
    const sourceStartUs = Math.round(seconds * 1_000_000)
    // Stills have no source duration and can be held anywhere, so there is nothing to run off
    // the end of. Reporting a limit for them would refuse the clips where this is safest.
    if (sourceAsset && sourceAsset.durationUs > 0 && sourceStartUs >= sourceAsset.durationUs) {
      const length = (sourceAsset.durationUs / 1_000_000).toFixed(2)
      fail(
        `${seconds}s is past the end of ${sourceAsset.name}, which is ${length}s long, so the ` +
          `clip would have no footage in it at all. Use a value below ${length}.`
      )
    }
    patch.sourceStartUs = sourceStartUs
  }

  // A start point *inside* the source whose tail runs past the end is warned about rather than
  // refused, and the distinction matters: pushing a clip's read point forward to give it
  // handles for a transition does exactly this, so refusing it would block the workflow the
  // field was added for. The clip still plays; it runs out early.
  if (sourceAsset && sourceAsset.durationUs > 0) {
    const startUs = patch.sourceStartUs ?? item.sourceStartUs
    const givenSpeed = args.speed !== undefined ? Number(args.speed) : item.speed
    const speed = givenSpeed > 0 ? givenSpeed : 1
    const consumedUs = framesToUs(durationInFrames, timeline().fps) * speed
    if (startUs + consumedUs > sourceAsset.durationUs) {
      const availableFrames = Math.floor(
        usToFrames(Math.max(0, sourceAsset.durationUs - startUs), timeline().fps) / speed
      )
      sourceTailWarning =
        `The clip is ${durationInFrames} frames long but only ${availableFrames} frames of ` +
        `${sourceAsset.name} remain from this start point, so the tail has no footage. ` +
        `Shorten it to ${availableFrames} frames, or start earlier in the source.`
    }
  }

  if (args.crop !== undefined) {
    const given = args.crop
    if (typeof given !== 'object' || given === null || Array.isArray(given)) {
      fail('`crop` must be an object of { left, top, right, bottom } fractions from 0 to 1.')
    }
    const edges = ['left', 'top', 'right', 'bottom'] as const
    const unknown = Object.keys(given as object).filter(
      (k) => !(edges as readonly string[]).includes(k)
    )
    if (unknown.length > 0) {
      fail(`crop has no edge "${unknown[0]}". The edges are ${edges.join(', ')}.`)
    }
    const next = { ...normaliseCrop(item.crop) }
    for (const edge of edges) {
      const value = (given as Record<string, unknown>)[edge]
      if (value === undefined) continue
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        // Refused rather than clamped: a clamp reads back as the number having been accepted.
        fail(`crop.${edge} is ${JSON.stringify(value)}; it must be a fraction from 0 to 1.`)
      }
      next[edge] = n
    }
    const normalised = normaliseCrop(next)
    patch.crop = isCropped(normalised) ? normalised : undefined
  }

  if (args.variables !== undefined) {
    const asset = project().assets.find((a) => a.id === item.assetId)
    if (asset?.kind !== 'html' && asset?.kind !== 'brf') {
      fail(
        `Item ${item.id} draws ${asset ? `a ${asset.kind} asset` : 'no asset'}, so it has no ` +
          `variables. Only html compositions and .brf motion declare them.`
      )
    }
    const declared = asset.compositionVariables ?? []
    if (declared.length === 0) {
      fail(
        asset.kind === 'brf'
          ? `${asset.name} declares no variables, so there is nothing to set. Add a "vars" object ` +
              `to its document with write_brf (assetId ${asset.id}) and refer to them as "$name".`
          : `${asset.name} declares no variables, so there is nothing to set. Add them to the file ` +
              `with data-composition-variables on its <html> element, then re-import it.`
      )
    }
    const given = args.variables
    if (typeof given !== 'object' || given === null || Array.isArray(given)) {
      fail('`variables` must be an object of { id: value }.')
    }
    const next: Record<string, string | number | boolean> = { ...(item.variables ?? {}) }
    for (const [id, value] of Object.entries(given as Record<string, unknown>)) {
      const spec = declared.find((v) => v.id === id)
      if (!spec) {
        // Naming the real ones is what lets the next call work; "unknown variable" ends the run.
        fail(
          `${asset.name} declares no variable "${id}". It declares: ` +
            `${declared.map((v) => `${v.id} (${v.type})`).join(', ')}.`
        )
      }
      const coerced = coerce(value, spec.type)
      if (coerced === null) {
        fail(`"${id}" is a ${spec.type}, and ${JSON.stringify(value)} is not one.`)
      }
      if (spec.type === 'enum' && !(spec.options ?? []).some((o) => o.value === coerced)) {
        fail(
          `"${id}" is an enum and ${JSON.stringify(coerced)} is not one of its options: ` +
            `${(spec.options ?? []).map((o) => o.value).join(', ')}.`
        )
      }
      // Matching the default is stored as absence, the same as the inspector does, so a
      // project does not accumulate a record of every knob touched and touched back.
      if (coerced === spec.default) delete next[id]
      else next[id] = coerced
    }
    patch.variables = Object.keys(next).length > 0 ? next : undefined
  }

  if (args.adjustments !== undefined) {
    patch.adjustments = mergeAdjustments(item.adjustments, args.adjustments)
  }
  if (args.grade !== undefined) {
    const asset = findAsset(project(), item.assetId)
    // Refused rather than stored: a grade on a text or audio clip reads back exactly as written
    // and changes nothing, because the grade pass only runs on picture sources.
    if (args.grade !== null && (!asset || !(GRADEABLE_KINDS as readonly string[]).includes(asset.kind))) {
      fail(
        `Item ${item.id} draws ${asset ? `a ${asset.kind} asset` : 'a missing asset'}, which has no ` +
          `picture to grade. grade applies to ${GRADEABLE_KINDS.join(', ')} clips` +
          (asset?.kind === 'text' ? ' — for type, set text.color instead.' : '.')
      )
    }
    patch.grade = mergeGrade(item.grade, args.grade, (id) => findAsset(project(), id))
  }
  if (args.blendMode !== undefined) {
    const spec = findTool('edit_item')
    const allowed =
      (spec?.inputSchema.properties.blendMode as { enum?: string[] } | undefined)?.enum ?? []
    patch.blendMode = asBlendMode(args.blendMode, allowed)
  }

  if (args.text !== undefined) {
    // Refused rather than stored on a clip that cannot draw it. A `text` field on a video
    // item would read back exactly as it was written and change nothing on the canvas,
    // which is the shape of a control that does not do what it says.
    const asset = findAsset(project(), item.assetId)
    if (asset?.kind !== 'text') {
      fail(
        `Item ${item.id} draws ${asset ? `a ${asset.kind} asset` : 'a missing asset'}, so it has ` +
          `no type to style. Text styling applies only to items whose asset is kind "text" — ` +
          `create one with a text asset and place that.`
      )
    }
    patch.text = mergeTextStyle(item.text, args.text)
  }

  // J/L cuts and ducking: validated in `audioFinish.ts`, where the gain rules they feed live.
  Object.assign(patch, audioFinishPatch(args, item, track, project(), timeline()))

  // Keyframes: validated against the clip as it will be after this call (its new length), so a
  // key refused as past the end names the end the agent is about to have.
  if (args.keyframes !== undefined) {
    const asset = findAsset(project(), item.assetId)
    const merged = mergeKeyframes(item.keyframes, args.keyframes, {
      itemId: item.id,
      from,
      durationInFrames,
      hasPicture: track.kind === 'video',
      hasAudio: Boolean(asset?.hasAudio) || asset?.kind === 'html'
    })
    if (!merged.ok) fail(merged.error, merged.userMessage)
    patch.keyframes = merged.keyframes
  }

  const fadeIn = patch.fadeInFrames ?? item.fadeInFrames
  const fadeOut = patch.fadeOutFrames ?? item.fadeOutFrames
  // A speed change that shortens the clip keeps its fades inside it (`applySpeedPlan`); only
  // fades given in this call are refused for not fitting.
  const fadesGiven = args.fadeInFrames !== undefined || args.fadeOutFrames !== undefined
  if (fadeIn + fadeOut > durationInFrames && (!speedPlan || fadesGiven)) {
    fail(
      `fadeInFrames ${fadeIn} + fadeOutFrames ${fadeOut} is longer than the clip ` +
        `(${durationInFrames} frames). Shorten the fades or lengthen the clip.`
    )
  }

  store().transact(() => {
    // The track change has to go through `moveItem` — `patchItem` deliberately omits
    // `trackId` — and everything else rides in one `patchItem`, `layout` included, because
    // layout is a field of Item. Inside one transaction that is still a single undo step.
    // The move is not linked: `patchItem` below carries the change of `from` to linked clips, and
    // a linked move here as well would shift them twice.
    if (destination.id !== track.id) store().moveItem(item.id, from, destination.id, { linked: false })
    if (speedPlan) {
      // Speed and length through the shared plan (linked clips and ripple included); the rest of
      // the patch without them, so the length is not applied twice.
      const { durationInFrames: _length, ...rest } = patch
      store().patchItem(item.id, rest, { linked })
      store().setClipSpeed(item.id, speedPlan.speed, { ripple: args.ripple === true })
    } else {
      store().patchItem(item.id, patch, { linked })
    }
  })
  const speedReport = speedPlan ? describeSpeedPlan(speedPlan) : null

  const after = resolveItem(item.id)
  // Ordered by how well each fault hides: the tail warning is about footage that is missing
  // from a clip that still plays, and identity adjustments produce a picture identical to the
  // one before. Neither is visible as a fault, so neither may be left to be noticed.
  const look = lookWarnings(after.item, after.track, timeline())
  const sound = audioFinishReport(after.item, project(), timeline())
  const warnings = [
    ...(speedReport?.warning ? [speedReport.warning] : []),
    ...(sourceTailWarning ? [sourceTailWarning] : []),
    ...shadowedByKeys(args, after.item),
    ...gradeWarnings(after.item.grade, findAsset(project(), after.item.assetId)),
    ...sound.warnings,
    ...look.warnings
  ]
  return {
    itemId: after.item.id,
    trackId: after.track.id,
    from: after.item.from,
    durationInFrames: after.item.durationInFrames,
    endFrame: itemEnd(after.item),
    layout: { ...after.item.layout },
    volume: after.item.volume,
    speed: after.item.speed,
    fadeInFrames: after.item.fadeInFrames,
    fadeOutFrames: after.item.fadeOutFrames,
    // Seconds, matching the unit the argument is in. Reporting microseconds from a surface
    // that accepts seconds is a trap with a plausible-looking value in it.
    sourceStartSeconds: after.item.sourceStartUs / 1_000_000,
    ...(after.item.text ? { text: after.item.text } : {}),
    ...(after.item.crop ? { crop: after.item.crop } : {}),
    ...(after.item.variables ? { variables: after.item.variables } : {}),
    ...(after.item.adjustments ? { adjustments: after.item.adjustments } : {}),
    ...(after.item.blendMode ? { blendMode: after.item.blendMode } : {}),
    ...(after.item.grade ? { grade: after.item.grade } : {}),
    ...(after.item.keyframes
      ? { keyframes: after.item.keyframes, animation: describeKeyframes(after.item) }
      : {}),
    ...(look.filter !== null ? { filter: look.filter } : {}),
    ...(sound.report ?? {}),
    ...linkReport(after.item.id),
    ...(speedReport?.report ?? {}),
    ...(warnings.length > 0 ? { warnings } : {})
  }
}

/** What a speed change did to the timeline, for the agent: lengths, the clamp and the ripple, by id. */
function describeSpeedPlan(plan: SpeedPlan): { report: Record<string, unknown>; warning: string | null } {
  const tl = timeline()
  const name = (id: string): string => tl.tracks.find((t) => t.id === id)?.name ?? id
  const report: Record<string, unknown> = {
    retimed: {
      fromDurationInFrames: plan.fromLength,
      durationInFrames: plan.length,
      sameFootageDurationInFrames: plan.wanted,
      ...(plan.shifts.length > 0
        ? { rippled: plan.shifts.map((s) => ({ itemId: s.itemId, from: s.to })), rippledTracks: plan.rippledTrackIds.map(name) }
        : {})
    }
  }
  const clamp = plan.clampedBy
  const warning =
    clamp?.kind === 'next-clip'
      ? `At ${plan.speed}x the clip needs ${plan.wanted} frames to play the same footage, but ${clamp.itemId} starts at ` +
        `frame ${clamp.at} on ${name(clamp.trackId)}, so it is ${plan.length} frames and plays less of its source. ` +
        `Pass ripple: true to move the later clips instead.`
      : clamp?.kind === 'footage'
        ? `Only ${clamp.available} frames of footage remain from the in-point at ${plan.speed}x, so the clip is ` +
          `${plan.length} frames, not ${plan.wanted}.`
        : plan.outOfSyncTrackIds.length > 0
          ? itemRippleNote(plan.rippledTrackIds.map(name), plan.outOfSyncTrackIds.map(name))
          : null
  return { report, warning }
}

/**
 * A static field set in this call on a property whose keys decide it at every frame: stored, and
 * drawn nowhere. Said, because it reads back as accepted and changes nothing on screen.
 */
function shadowedByKeys(args: Record<string, unknown>, item: Item): string[] {
  const out: string[] = []
  for (const property of KEYFRAME_PROPERTIES) {
    if (args[property] === undefined) continue
    const keys = item.keyframes?.[property]
    if (!keys || keys.length === 0) continue
    out.push(
      `${property} ${JSON.stringify(args[property])} is stored but changes nothing: ${property} has ` +
        `${keys.length} keyframe${keys.length === 1 ? '' : 's'}, which set it at every frame. Edit the ` +
        `keys (keyframes: { ${property}: [...] }), or pass keyframes: { ${property}: null } to go back to the static value.`
    )
  }
  return out
}

/**
 * The link fields a result reports for `itemId`: what it is linked to, and whether its sound is
 * detached. Empty for a clip that is neither, so ordinary results do not grow.
 */
export function linkReport(itemId: string): Record<string, unknown> {
  const found = allItems(timeline()).find((i) => i.id === itemId)
  if (!found) return {}
  const partners = linkedPartners(timeline(), itemId).map((p) => p.id)
  return {
    ...(partners.length > 0 ? { linkedItemIds: partners } : {}),
    ...(found.audioDetached ? { audioDetached: true } : {})
  }
}

/**
 * `remove_range` — take a passage out and close the hole, across every unlocked track.
 *
 * The distinction from `delete_items(ripple: true)` is worth stating because an agent will
 * otherwise reach for the wrong one: that tool removes *clips* and shifts only the tracks it
 * removed from, which desynchronises everything else and is documented as doing so. This one
 * removes *time*, on every unlocked track at once, so sync is preserved by construction. It is
 * also the only one of the two that can cut the middle out of a single long take, because
 * `delete_items` can only remove items whole.
 */
export function removeRange(args: Record<string, unknown>): Record<string, unknown> {
  const from = Math.round(args.fromFrame as number)
  const to = Math.round(args.toFrame as number)

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    fail('fromFrame and toFrame must both be numbers of frames.')
  }
  if (to <= from) {
    fail(
      `toFrame (${to}) must be greater than fromFrame (${from}) — toFrame is the first frame ` +
        `kept, so an equal pair removes nothing. To remove one frame, pass toFrame = fromFrame + 1.`
    )
  }
  if (from < 0) fail(`fromFrame cannot be negative, and ${from} is.`)

  const before = timelineDuration(timeline())
  const result = store().rippleDelete(from, to)

  if (!result || result.removedFrames === 0) {
    fail(
      `Nothing occupies frames ${from}-${to}, so there was nothing to remove. The timeline is ` +
        `${before} frames long.`
    )
  }

  const tl = timeline()
  const desyncedTracks = tl.tracks
    .filter((track) => result.desyncedTrackIds.includes(track.id))
    .map((track) => ({ id: track.id, name: track.name }))

  return {
    removedFrames: result.removedFrames,
    removedItems: result.removedItemIds,
    trimmedItems: result.trimmedItemIds,
    createdItems: result.createdItemIds,
    removedTransitions: result.removedTransitionIds,
    durationInFrames: timelineDuration(tl),
    ...(desyncedTracks.length > 0
      ? {
          desyncedTracks,
          note:
            `${desyncedTracks.map((t) => t.name).join(', ')} ` +
            `${desyncedTracks.length === 1 ? 'is' : 'are'} locked, so ` +
            `${desyncedTracks.length === 1 ? 'it was' : 'they were'} not shifted and ` +
            `${desyncedTracks.length === 1 ? 'is' : 'are'} now ${result.removedFrames} frames ` +
            `out of sync with everything else. Unlock and redo the cut, or move ` +
            `${desyncedTracks.length === 1 ? 'that track' : 'those tracks'} back by hand.`
        }
      : {})
  }
}

export function splitAt(args: Record<string, unknown>): Record<string, unknown> {
  const frame = frameOrPlayhead(args)
  const tl = timeline()

  let targets: Item[]
  if (args.itemIds === undefined) {
    targets = itemsCrossing(frame)
    if (targets.length === 0) {
      const nearest = allItems(tl)
        .map((i) => ({ id: i.id, from: i.from, end: itemEnd(i) }))
        .sort((a, b) => Math.abs(a.from - frame) - Math.abs(b.from - frame))
        .slice(0, 3)
      fail(
        `Nothing crosses frame ${frame}, so there is nothing to cut — a cut on an item's edge ` +
          `would make a zero-length clip. ` +
          (nearest.length > 0
            ? `Nearest items: ${nearest.map((n) => `${n.id} (${n.from}-${n.end})`).join(', ')}.`
            : 'The timeline is empty.')
      )
    }
  } else {
    const ids = args.itemIds as string[]
    const known = allItems(tl).map((i) => i.id)
    targets = ids.map((given) => {
      const resolved = resolveId(given, known)
      if (!resolved.ok) fail(resolved.error)
      // Same as in `resolveItem`: narrowing for the compiler, not a reachable branch.
      const found = allItems(tl).find((i) => i.id === resolved.id)
      if (!found) fail(`No item ${resolved.id} on the active timeline.`)
      return found
    })
    const uncut = targets.filter((i) => frame <= i.from || frame >= itemEnd(i))
    if (uncut.length > 0) {
      fail(
        `Frame ${frame} is not inside ${uncut.map((i) => `${i.id} (${i.from}-${itemEnd(i)})`).join(', ')}. ` +
          `A cut on or outside an item's edge would make a zero-length clip.`
      )
    }
  }

  // A cut clip's linked clips are cut with it (the store expands the selection), so they are
  // checked here too.
  const cutIds = withLinked(tl, targets.map((i) => i.id))
  const cut = allItems(tl).filter((i) => cutIds.includes(i.id) && frame > i.from && frame < itemEnd(i))
  const locked = cut.filter((i) => tl.tracks.find((t) => t.id === i.trackId)?.locked)
  if (locked.length > 0) {
    fail(
      `${locked.map((i) => i.id).join(', ')} ${locked.length === 1 ? 'is' : 'are'} on a locked ` +
        `track, so the cut is refused. Unlock it in the UI first.`
    )
  }

  const before = allItems(tl).length
  store().transact(() => {
    store().select(targets.map((i) => i.id))
    store().splitAt(frame)
  })
  const created = allItems(timeline()).length - before
  if (created === 0) fail(`Frame ${frame} produced no cut. Nothing on the timeline changed.`)

  const alsoCut = cut.filter((i) => !targets.some((t) => t.id === i.id)).map((i) => i.id)
  return {
    frame,
    itemsCut: targets.length + alsoCut.length,
    newItems: store().selection,
    ...(alsoCut.length > 0 ? { linkedAlsoCut: alsoCut } : {}),
    note:
      `${targets.length + alsoCut.length} item${targets.length + alsoCut.length === 1 ? '' : 's'} cut at frame ${frame}` +
      (alsoCut.length > 0 ? `, including ${alsoCut.join(', ')}, linked to what you named.` : '.')
  }
}

export function deleteItems(args: Record<string, unknown>): Record<string, unknown> {
  const tl = timeline()
  const known = allItems(tl).map((i) => i.id)
  const given = (args.itemIds as string[]).map((each) => {
    const resolved = resolveId(each, known)
    if (!resolved.ok) fail(resolved.error)
    return resolved.id
  })
  if (given.length === 0) fail('No itemIds were given, so there is nothing to delete.')
  // A linked clip goes with what it is linked to — the store deletes both — so the ripple below
  // must be computed over both, and the result names what was deleted beyond what was asked.
  const ids = withLinked(tl, given)

  const doomed = allItems(tl).filter((i) => ids.includes(i.id))
  const lockedTracks = tl.tracks.filter(
    (t) => t.locked && doomed.some((i) => i.trackId === t.id)
  )
  if (lockedTracks.length > 0) {
    fail(
      `${lockedTracks.map((t) => t.name).join(', ')} ${lockedTracks.length === 1 ? 'is' : 'are'} ` +
        `locked, so nothing was deleted. Unlock in the UI, or delete only items on free tracks.`
    )
  }

  const ripple = args.ripple === true
  // Planned before the delete (`@shared/item-ripple`), because after it the items are gone and
  // the shift cannot be derived. The clip menu's "Ripple Delete (This Track Only)" calls this
  // function, so the menu and the agent close the same gaps and name the same tracks.
  const plan = ripple ? planItemRipple(tl, ids) : null
  const shifts = plan?.shifts ?? []

  store().transact(() => {
    store().select(ids)
    store().deleteSelected()
    // Unlinked: every survivor that shifts is in the list, so letting a move carry its linked
    // clip as well would shift that clip twice.
    for (const shift of shifts) store().moveItem(shift.itemId, shift.to, undefined, { linked: false })
  })

  const alsoDeleted = ids.filter((id) => !given.includes(id))
  const trackName = (id: string): string => tl.tracks.find((t) => t.id === id)?.name ?? id
  const rippledTracks = (plan?.rippledTrackIds ?? []).map(trackName)
  const outOfSyncTracks = (plan?.outOfSyncTrackIds ?? []).map(trackName)
  return {
    deleted: ids,
    ...(alsoDeleted.length > 0 ? { linkedAlsoDeleted: alsoDeleted } : {}),
    rippled: ripple ? shifts.length : 0,
    ...(rippledTracks.length > 0 ? { rippledTracks } : {}),
    ...(outOfSyncTracks.length > 0 ? { outOfSyncTracks } : {}),
    durationInFrames: timelineDuration(timeline()),
    ...(ripple && shifts.length > 0 ? { note: itemRippleNote(rippledTracks, outOfSyncTracks) } : {})
  }
}

export function addTrack(args: Record<string, unknown>): Record<string, unknown> {
  const kind = String(args.kind) as TrackKind
  let id = ''
  store().transact(() => {
    id = store().addTrack(kind)
  })
  const track = timeline().tracks.find((t) => t.id === id)
  if (!track) fail('The track was not created.')
  const sameKind = timeline().tracks.filter((t) => t.kind === kind)
  return {
    trackId: track.id,
    name: track.name,
    kind: track.kind,
    ...(kind === 'video'
      ? {
          note:
            `${track.name} is the topmost video track, so items on it draw over the ` +
            `${sameKind.length - 1} below.`
        }
      : {})
  }
}

export function setPlayhead(args: Record<string, unknown>): Record<string, unknown> {
  const wanted = Math.max(0, Math.round(Number(args.frame)))
  store().setPlayhead(wanted)
  const actual = store().playhead
  const duration = timelineDuration(timeline())
  return {
    playhead: actual,
    // The store clamps to the timeline's end. Reporting the request back unchanged would
    // have the agent believe it is somewhere it is not.
    ...(actual !== wanted
      ? { requested: wanted, clampedTo: actual, timelineDurationInFrames: duration }
      : {})
  }
}

export function undo(args: Record<string, unknown> = {}): Record<string, unknown> {
  const state = store()
  const before = timelineDuration(timeline())
  const itemsBefore = allItems(timeline()).length
  if (args.position !== undefined) {
    // To a point in the history (`read_history`), back or forward: as many undos or redos as
    // that takes, each a real one. Refused, with the range there is, for a point that is not.
    const was = state.past.length
    const jumped = state.jumpToHistory(Number(args.position))
    if ('error' in jumped) fail(`${jumped.error} Call read_history for the positions.`)
    const after = timeline()
    return {
      position: jumped.position,
      undid: Math.max(0, was - jumped.position),
      redid: Math.max(0, jumped.position - was),
      remainingUndoSteps: store().past.length,
      timeline: { durationInFrames: timelineDuration(after), itemCount: allItems(after).length },
      changed: { durationWas: before, itemCountWas: itemsBefore }
    }
  }
  if (state.past.length === 0) {
    fail('There is nothing to undo — no change has been made to this project yet.')
  }
  state.undo()
  const after = timeline()
  return {
    undone: true,
    remainingUndoSteps: store().past.length,
    timeline: {
      durationInFrames: timelineDuration(after),
      itemCount: allItems(after).length
    },
    changed: { durationWas: before, itemCountWas: itemsBefore }
  }
}

export const handlers: Handlers = {
  import_media: (args) => importMedia(args),
  place_asset: (args) => placeAsset(args),
  edit_item: (args) => editItem(args),
  split_at: (args) => splitAt(args),
  delete_items: (args) => deleteItems(args),
  remove_range: (args) => removeRange(args),
  add_track: (args) => addTrack(args),
  set_playhead: (args) => setPlayhead(args),
  undo: (args) => undo(args),
}
