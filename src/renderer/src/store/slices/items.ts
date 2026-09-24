/**
 * Assets, clips and tracks: importing, placing, moving, trimming, splitting and deleting.
 */

import { brfAssetFields, brfCodeAssetFields } from '@shared/brf'
import { activeTimeline, placementLayout, normaliseCrop, isCropped, NO_CROP, defaultLayout, defaultTextStyle, findAsset, findItem, findTrack, framesToUs, itemEnd, itemsOverlap, usToFrames, type Item, type TrackKind } from '@shared/project'
import { rippleDelete, type RippleDeleteResult } from '@shared/ripple'
import { applyRelinks } from '@shared/relink'
import { cloneKeyframes, shiftKeyframes, sliceKeyframes, withKeyframe } from '@shared/keyframes'
import { applyTrimPlan, planTrim, type TrimPlan } from '@shared/trim'
import { detachAudio, linkedPartners, reattachAudio, unlinkItems, withLinked } from '@shared/links'
import { clone, makeTrack, newId, nextTrackName, trackWithRoom } from '../factory'
import type { EditorActions } from '../types'
import type { StoreKit } from '../kit'
import { editingPrefs, stillDurationFrames } from '../editing-prefs'

type Actions = Pick<
  EditorActions,
  | 'addAssets'
  | 'removeAsset'
  | 'editAsset'
  | 'patchAsset'
  | 'relinkAssets'
  | 'placeAsset'
  | 'moveItem'
  | 'trimItem'
  | 'trimEdit'
  | 'splitAt'
  | 'deleteSelected'
  | 'rippleDelete'
  | 'setCrop'
  | 'setCompositionVariable'
  | 'duplicateSelected'
  | 'patchItem'
  | 'detachAudio'
  | 'reattachAudio'
  | 'unlinkItems'
  | 'patchLayout'
  | 'setKeyframe'
  | 'addTrack'
  | 'removeTrack'
  | 'patchTrack'
>

export function itemsSlice({ set, get, edit, editTimeline }: StoreKit): Actions {
  return {
    // -- assets -------------------------------------------------------------
    addAssets(assets) {
      if (assets.length === 0) return
      edit((project) => {
        for (const asset of assets) {
          if (!project.assets.some((existing) => existing.id === asset.id)) {
            project.assets.push(asset)
          }
        }
      })
    },

    removeAsset(assetId) {
      edit((project) => {
        project.assets = project.assets.filter((a) => a.id !== assetId)
        for (const timeline of project.timelines) {
          for (const track of timeline.tracks) {
            track.items = track.items.filter((item) => item.assetId !== assetId)
          }
        }
      })
    },

    relinkAssets(relinks) {
      if (relinks.length === 0) return
      edit((project) => {
        applyRelinks(project, relinks)
      })
    },

    editAsset(assetId, patch) {
      edit((project) => {
        const asset = findAsset(project, assetId)
        if (!asset) return
        if (patch.name !== undefined) asset.name = patch.name
        if (patch.text !== undefined && asset.kind === 'text') asset.text = patch.text
        if (patch.brf !== undefined && asset.kind === 'brf') {
          delete asset.brfCode
          Object.assign(asset, brfAssetFields(patch.brf))
        }
        if (patch.brfCode !== undefined && asset.kind === 'brf') {
          delete asset.brf
          Object.assign(asset, brfCodeAssetFields(patch.brfCode.source, patch.brfCode.meta))
        }
      })
    },

    patchAsset(assetId, patch) {
      // Poster paths and waveforms arrive asynchronously long after the import that
      // triggered them. They are not edits, so they must not land on the undo stack.
      edit((project) => {
        const asset = findAsset(project, assetId)
        if (asset) Object.assign(asset, patch)
      }, { silent: true })
    },

    // -- items --------------------------------------------------------------
    placeAsset(assetId, atFrame, trackId) {
      const state = get()
      const timeline = activeTimeline(state.project)
      const asset = findAsset(state.project, assetId)
      if (!timeline || !asset) return null
      if (asset.error) {
        get().notify(`${asset.name} could not be read, so it cannot be placed.`, 'error')
        return null
      }
      if (asset.kind === 'font') {
        // A typeface draws nothing by itself; text names its family.
        get().notify(`${asset.name} is a font — choose "${asset.font?.family ?? asset.name}" in a text clip's Font.`, 'info')
        return null
      }
      if (asset.kind === 'lut') {
        // A LUT has no picture; placing it would make a clip that draws nothing forever.
        get().notify(`${asset.name} is a colour LUT — apply it to a clip from Grade in the inspector.`, 'info')
        return null
      }

      const from = Math.max(0, Math.round(atFrame ?? state.playhead))
      const kind: TrackKind = asset.hasVideo || asset.kind === 'image' || asset.kind === 'text'
        ? 'video'
        : 'audio'

      // A still has no duration of its own, so it gets the default from Settings › Editing.
      const naturalFrames =
        asset.durationUs > 0 ? usToFrames(asset.durationUs, timeline.fps) : stillDurationFrames(timeline.fps)
      const duration = Math.max(1, naturalFrames)

      const explicitTrack = trackId ? findTrack(timeline, trackId) : undefined
      let target = explicitTrack ?? trackWithRoom(timeline, kind, from, duration)

      const itemId = newId('itm')
      editTimeline((tl) => {
        let track = target ? findTrack(tl, target.id) : undefined
        if (!track) {
          // Nothing had room, so the clip gets a new lane rather than overwriting one.
          track = makeTrack(kind, tl.tracks.filter((t) => t.kind === kind).length + 1)
          track.name = nextTrackName(tl, kind)
          tl.tracks.push(track)
        }
        // Cover or contain, decided by how much of the source cover would crop. A phone video
        // on a landscape timeline keeps under a third of its picture under cover, and arriving
        // as a band out of the middle reads as bay having mangled the clip. Settings › Editing
        // can fix it to always Fit or always Fill; this is the one placement path, so the
        // setting reaches `place_asset`, a drop, a double-click and the source viewer alike.
        const layout =
          asset.width && asset.height
            ? placementLayout(tl, asset.width, asset.height, editingPrefs().newClipFit)
            : defaultLayout(tl)
        const item: Item = {
          id: itemId,
          assetId,
          trackId: track.id,
          from,
          durationInFrames: duration,
          sourceStartUs: 0,
          layout,
          volume: 1,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          speed: 1,
          // A title gets an explicit style, so what the Type section shows is what draws. Left
          // unset, it fell back to the pre-TextStyle look (40% of the box: 432 px on 1080)
          // while the panel said 96. This is the one placement path — the Text panel, "Add text
          // here" and `place_asset` all arrive here — so every new title is the same item.
          ...(asset.kind === 'text' ? { text: defaultTextStyle() } : {})
        }
        track.items.push(item)
        track.items.sort((a, b) => a.from - b.from)
      })
      target = null
      set({ selection: [itemId] })
      return itemId
    },

    moveItem(itemId, toFrame, toTrackId, options) {
      editTimeline((timeline) => {
        const found = findItem(timeline, itemId)
        if (!found) return
        const { item, track } = found
        const destination = toTrackId ? findTrack(timeline, toTrackId) : track
        if (!destination || destination.locked || track.locked) return

        const from = Math.max(0, Math.round(toFrame))
        const moved: Item = { ...item, from, trackId: destination.id }

        const collides = destination.items.some(
          (other) => other.id !== item.id && itemsOverlap(other, moved)
        )
        if (collides) return

        // Linked clips move by the same frames on their own tracks, or nothing moves: half a
        // linked move is a picture out of sync with its own sound.
        const delta = from - item.from
        const partners = options?.linked === false || delta === 0 ? [] : linkedPartners(timeline, itemId)
        const followers: { item: Item; from: number }[] = []
        for (const partner of partners) {
          const partnerTrack = findTrack(timeline, partner.trackId)
          const next = partner.from + delta
          if (!partnerTrack || partnerTrack.locked || next < 0) return
          const shifted = { ...partner, from: next }
          const clash = partnerTrack.items.some(
            (other) =>
              other.id !== partner.id &&
              !partners.some((p) => p.id === other.id) &&
              itemsOverlap(other, shifted)
          )
          if (clash) return
          followers.push({ item: partner, from: next })
        }

        track.items = track.items.filter((i) => i.id !== item.id)
        destination.items.push(moved)
        destination.items.sort((a, b) => a.from - b.from)
        for (const follower of followers) {
          follower.item.from = follower.from
          findTrack(timeline, follower.item.trackId)?.items.sort((a, b) => a.from - b.from)
        }
      })
    },

    trimItem(itemId, edge, toFrame, options) {
      editTimeline((timeline) => {
        const found = findItem(timeline, itemId)
        if (!found) return
        const { item } = found
        const frame = Math.round(toFrame)
        // The edge's movement in frames, applied to every linked clip's same edge — so a picture
        // and its detached sound trimmed together stay in sync however they were placed.
        const delta =
          edge === 'start'
            ? Math.max(0, Math.min(frame, itemEnd(item) - 1)) - item.from
            : Math.max(1, frame - item.from) - item.durationInFrames
        if (delta === 0) return
        const group = [item, ...(options?.linked === false ? [] : linkedPartners(timeline, itemId))]
        const plans: { item: Item; from: number; durationInFrames: number; sourceStartUs: number }[] = []
        for (const member of group) {
          const memberTrack = findTrack(timeline, member.trackId)
          if (!memberTrack || memberTrack.locked) return
          let next: { from: number; durationInFrames: number; sourceStartUs: number }
          if (edge === 'start') {
            const nextFrom = member.from + delta
            if (nextFrom < 0 || nextFrom > itemEnd(member) - 1) return
            // Trimming the head must move the read point into the source by the same
            // amount, or the clip slides its content instead of revealing less of it.
            const nextSourceStart = member.sourceStartUs + framesToUs(delta, timeline.fps) * member.speed
            if (nextSourceStart < 0) return
            next = {
              from: nextFrom,
              durationInFrames: member.durationInFrames - delta,
              sourceStartUs: Math.round(nextSourceStart)
            }
          } else {
            const nextDuration = member.durationInFrames + delta
            if (nextDuration < 1) return
            next = { from: member.from, durationInFrames: nextDuration, sourceStartUs: member.sourceStartUs }
          }
          const collides = memberTrack.items.some(
            (other) =>
              other.id !== member.id &&
              itemsOverlap(other, { ...member, from: next.from, durationInFrames: next.durationInFrames })
          )
          if (collides) return
          plans.push({ item: member, ...next })
        }
        for (const plan of plans) {
          // Keys stay on the timeline frame, and the footage, they were on (`@shared/keyframes`):
          // an in-point that moves by N shifts every clip's keys (picture and linked sound) by -N.
          const headShift = plan.from - plan.item.from
          plan.item.from = plan.from
          plan.item.durationInFrames = plan.durationInFrames
          plan.item.sourceStartUs = plan.sourceStartUs
          if (plan.item.keyframes && headShift !== 0) plan.item.keyframes = shiftKeyframes(plan.item.keyframes, -headShift)
          if (plan.item.fadeInFrames > plan.item.durationInFrames) plan.item.fadeInFrames = plan.item.durationInFrames
          if (plan.item.fadeOutFrames > plan.item.durationInFrames) plan.item.fadeOutFrames = plan.item.durationInFrames
        }
      })
    },

    trimEdit(spec, options) {
      const project = get().project
      const timeline = activeTimeline(project)
      if (!timeline) return { ok: false, error: 'No timeline is open.' }
      // Planned against the live project and applied to `edit()`'s clone. The plan names items
      // by id and carries absolute values, so it lands identically on the copy — and a refusal
      // never reaches `edit()` at all, so it cannot leave an empty undo step behind.
      const plan = planTrim(project, timeline, spec)
      if (!plan.ok) return plan
      const partners = options?.linked === false ? [] : linkedPartners(timeline, spec.itemId)
      if (partners.length === 0) {
        editTimeline((tl) => applyTrimPlan(tl, plan))
        return plan
      }
      // The same slip, slide or roll on each linked clip, planned in turn against the timeline as
      // the ones before it left it, so a linked picture and its sound stay in sync. Any refusal
      // refuses the whole edit, named, with the way to trim the one clip alone.
      const scratch = clone(project)
      const scratchTimeline = activeTimeline(scratch)
      if (!scratchTimeline) return plan
      applyTrimPlan(scratchTimeline, plan)
      const plans: TrimPlan[] = [plan]
      for (const partner of partners) {
        const next = planTrim(scratch, scratchTimeline, { ...spec, itemId: partner.id })
        if (!next.ok) {
          return {
            ok: false,
            error:
              `${spec.itemId} is linked to ${partner.id}, which cannot follow: ${next.error} ` +
              `Unlink them (detach_audio with action "unlink") to ${spec.mode} ${spec.itemId} alone.`,
            ...(plan.range ? { range: plan.range } : {})
          }
        }
        applyTrimPlan(scratchTimeline, next)
        plans.push(next)
      }
      editTimeline((tl) => {
        for (const each of plans) applyTrimPlan(tl, each)
      })
      return { ...plan, changes: plans.flatMap((each) => each.changes) }
    },

    splitAt(frame, options) {
      const state = get()
      const timeline = activeTimeline(state.project)
      if (!timeline) return
      const at = Math.round(frame ?? state.playhead)
      // A selected clip splits with the clips linked to it, so a cut picture and its sound come
      // out as two linked pairs rather than a picture cut over a sound that is not. "Split all
      // tracks" (⇧⌘B) ignores the selection and cuts everything the playhead crosses.
      const targets =
        state.selection.length > 0 && !options?.allTracks ? withLinked(timeline, state.selection) : null

      const created: string[] = []
      editTimeline((tl) => {
        for (const track of tl.tracks) {
          if (track.locked) continue
          const additions: Item[] = []
          for (const item of track.items) {
            if (targets && !targets.includes(item.id)) continue
            // A cut exactly on an edge is not a cut — it would make a zero-length clip.
            if (at <= item.from || at >= itemEnd(item)) continue
            const leftDuration = at - item.from
            const rightDuration = item.durationInFrames - leftDuration
            const right: Item = {
              ...item,
              id: newId('itm'),
              from: at,
              durationInFrames: rightDuration,
              sourceStartUs:
                item.sourceStartUs + Math.round(framesToUs(leftDuration, tl.fps) * item.speed),
              layout: { ...item.layout },
              fadeInFrames: 0,
              // Each half keeps the keys that shape it, so the pair draws exactly what the whole did.
              keyframes: sliceKeyframes(item.keyframes, leftDuration, item.durationInFrames)
            }
            if (!right.keyframes) delete right.keyframes
            if (item.keyframes) item.keyframes = sliceKeyframes(item.keyframes, 0, leftDuration)
            item.durationInFrames = leftDuration
            item.fadeOutFrames = Math.min(item.fadeOutFrames, leftDuration)
            right.fadeOutFrames = Math.min(right.fadeOutFrames, rightDuration)
            additions.push(right)
            created.push(right.id)
          }
          if (additions.length > 0) {
            track.items.push(...additions)
            track.items.sort((a, b) => a.from - b.from)
          }
        }
      })
      if (created.length > 0) set({ selection: created })
      else get().notify('Nothing to split at the playhead.')
    },

    deleteSelected() {
      const selection = get().selection
      if (selection.length === 0) return
      editTimeline((timeline) => {
        // Deleting a linked clip deletes what it is linked to: a detached sound left behind by its
        // picture, or a picture left silent by its sound, is never what "delete this clip" meant.
        const ids = withLinked(timeline, selection)
        for (const track of timeline.tracks) {
          if (track.locked) continue
          track.items = track.items.filter((item) => !ids.includes(item.id))
        }
      })
      set({ selection: [] })
    },

    rippleDelete(fromFrame, toFrame) {
      const state = get()
      const timeline = activeTimeline(state.project)
      if (!timeline) return null

      let start = fromFrame
      let end = toFrame
      if (start === undefined || end === undefined) {
        const selected = timeline.tracks
          .flatMap((track) => track.items)
          .filter((item) => state.selection.includes(item.id))
        if (selected.length === 0) {
          state.notify('Select what to remove first, then ripple delete.')
          return null
        }
        start = Math.min(...selected.map((item) => item.from))
        end = Math.max(...selected.map((item) => itemEnd(item)))
      }

      // A holder rather than a `let`: TypeScript cannot see that a closure passed to
      // `editTimeline` runs, so it narrows a closure-assigned local to `never`.
      const holder: { value: RippleDeleteResult | null } = { value: null }
      // One undo step: the removal and every shift it caused are one action to the user, and
      // reversing half of it would leave the tracks out of sync — the exact state the
      // operation exists to avoid. It is one step by construction, because the whole ripple
      // runs inside this single `editTimeline`. There was a `transact` around it; wrapping one
      // `edit()` in a transaction changes nothing, and removing it survived the undo-step gate
      // (`mcp/one-undo-step.test.ts`), which is what fails if this ever becomes two edits.
      editTimeline((tl) => {
        holder.value = rippleDelete(tl, start!, end!, () => newId('itm'))
      })

      const removed = holder.value
      if (!removed || removed.removedFrames === 0) return removed
      set({ selection: [] })
      if (removed.desyncedTrackIds.length > 0) {
        const names = timeline.tracks
          .filter((track) => removed.desyncedTrackIds.includes(track.id))
          .map((track) => track.name)
          .join(', ')
        // Named rather than counted: the user has to unlock a specific track to fix it.
        state.notify(
          `${names} ${names.includes(',') ? 'are' : 'is'} locked, so ${
            names.includes(',') ? 'they' : 'it'
          } did not move and is now ${removed.removedFrames} frames out of sync.`,
          'error'
        )
      }
      return removed
    },

    setCrop(itemId, edge, fraction) {
      editTimeline((tl) => {
        const found = findItem(tl, itemId)
        if (!found) return
        const next = normaliseCrop({ ...(found.item.crop ?? NO_CROP), [edge]: fraction })
        // Four zeroes is stored as absence, so an uncropped clip carries no crop at all and
        // the compositor's fast path stays the common one.
        if (!isCropped(next)) delete found.item.crop
        else found.item.crop = next
      })
    },

    setCompositionVariable(itemId, id, value) {
      editTimeline((tl, project) => {
        const found = findItem(tl, itemId)
        if (!found) return
        const asset = findAsset(project, found.item.assetId)
        const declared = asset?.compositionVariables?.find((v) => v.id === id)
        // A value for something the composition does not declare would set a CSS property
        // nothing reads: invisible, and with no control drawn to clear it again.
        if (!declared) return

        const next = { ...(found.item.variables ?? {}) }
        if (value === declared.default) delete next[id]
        else next[id] = value

        if (Object.keys(next).length === 0) delete found.item.variables
        else found.item.variables = next
      })
    },

    duplicateSelected() {
      const ids = get().selection
      if (ids.length === 0) return
      const created: string[] = []
      editTimeline((timeline) => {
        for (const track of timeline.tracks) {
          if (track.locked) continue
          const additions: Item[] = []
          for (const item of track.items) {
            if (!ids.includes(item.id)) continue
            const copy: Item = {
              ...item,
              id: newId('itm'),
              from: itemEnd(item),
              layout: { ...item.layout },
              ...(item.keyframes ? { keyframes: cloneKeyframes(item.keyframes) } : {})
            }
            if (track.items.some((other) => itemsOverlap(other, copy))) continue
            additions.push(copy)
            created.push(copy.id)
          }
          if (additions.length > 0) {
            track.items.push(...additions)
            track.items.sort((a, b) => a.from - b.from)
          }
        }
      })
      if (created.length > 0) set({ selection: created })
    },

    patchItem(itemId, patch, options) {
      editTimeline((timeline) => {
        const found = findItem(timeline, itemId)
        if (!found || found.track.locked) return
        const before = { ...found.item }
        Object.assign(found.item, patch)
        if (found.item.durationInFrames < 1) found.item.durationInFrames = 1
        if (found.item.from < 0) found.item.from = 0
        if (options?.linked === false) return
        // The sync fields carry to linked clips as the same change — a delta for positions, the
        // value for speed — so a linked picture and its sound stay in step. Everything else (level,
        // fades, look) is each clip's own.
        const after = found.item
        for (const partner of linkedPartners(timeline, itemId)) {
          if (findTrack(timeline, partner.trackId)?.locked) continue
          if (after.from !== before.from) partner.from = Math.max(0, partner.from + after.from - before.from)
          if (after.durationInFrames !== before.durationInFrames) {
            partner.durationInFrames = Math.max(1, partner.durationInFrames + after.durationInFrames - before.durationInFrames)
          }
          if (after.sourceStartUs !== before.sourceStartUs) {
            partner.sourceStartUs = Math.max(0, partner.sourceStartUs + after.sourceStartUs - before.sourceStartUs)
          }
          if (after.speed !== before.speed) partner.speed = after.speed
        }
        for (const track of timeline.tracks) track.items.sort((a, b) => a.from - b.from)
      })
    },

    detachAudio(itemIds, trackId) {
      const holder: { value: ReturnType<typeof detachAudio> | null } = { value: null }
      editTimeline((tl, project) => {
        holder.value = detachAudio(project, tl, itemIds, {
          ...(trackId ? { trackId } : {}),
          makeId: newId,
          makeAudioTrack: (timeline) => {
            const track = makeTrack('audio', 1)
            track.name = nextTrackName(timeline, 'audio')
            return track
          }
        })
      })
      const result = holder.value ?? {
        detached: [],
        refused: itemIds.map((itemId) => ({ itemId, reason: 'no timeline is open' })),
        warnings: [],
        createdTrackIds: [],
        addedTransitionIds: []
      }
      if (result.detached.length > 0) {
        set({ selection: result.detached.flatMap((pair) => [pair.pictureId, pair.audioId]) })
      }
      return result
    },

    reattachAudio(itemIds) {
      const holder: { value: ReturnType<typeof reattachAudio> | null } = { value: null }
      editTimeline((tl) => {
        holder.value = reattachAudio(tl, itemIds)
      })
      return (
        holder.value ?? {
          reattached: [],
          refused: itemIds.map((itemId) => ({ itemId, reason: 'no timeline is open' }))
        }
      )
    },

    unlinkItems(itemIds) {
      const holder: { value: string[] } = { value: [] }
      editTimeline((tl) => {
        holder.value = unlinkItems(tl, itemIds)
      })
      return holder.value
    },

    patchLayout(itemId, patch) {
      editTimeline((timeline) => {
        const found = findItem(timeline, itemId)
        if (!found || found.track.locked) return
        Object.assign(found.item.layout, patch)
      })
    },

    setKeyframe(itemId, property, frame, value) {
      editTimeline((timeline) => {
        const found = findItem(timeline, itemId)
        if (!found || found.track.locked) return
        const next = withKeyframe(found.item.keyframes, property, Math.round(frame), value)
        if (next) found.item.keyframes = next
        else delete found.item.keyframes
      })
    },

    // -- tracks -------------------------------------------------------------
    addTrack(kind, index) {
      const id = newId('trk')
      editTimeline((timeline) => {
        const track = makeTrack(kind, 1)
        track.id = id
        track.name = nextTrackName(timeline, kind)
        if (index === undefined) timeline.tracks.push(track)
        else timeline.tracks.splice(Math.max(0, Math.min(timeline.tracks.length, Math.round(index))), 0, track)
      })
      return id
    },

    removeTrack(trackId) {
      editTimeline((timeline) => {
        // The last video track is load-bearing: without one there is nowhere to place a
        // clip, and the canvas has nothing to compose.
        const track = findTrack(timeline, trackId)
        if (!track) return
        const remaining = timeline.tracks.filter((t) => t.kind === track.kind).length
        if (remaining <= 1) return
        timeline.tracks = timeline.tracks.filter((t) => t.id !== trackId)
      })
    },

    patchTrack(trackId, patch) {
      editTimeline((timeline) => {
        const track = findTrack(timeline, trackId)
        if (!track) return
        Object.assign(track, patch)
        // Not soloed is stored as absence, so a project that tried solo saves as one that never did.
        if (track.solo === false) delete track.solo
      })
    }
  }
}
