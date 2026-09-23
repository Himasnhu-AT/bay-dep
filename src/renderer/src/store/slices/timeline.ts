/**
 * The timeline's shape and what sits on it besides clips: canvas and frame rate,
 * transitions, subtitles, captions, markers and scripted edits.
 */

import { CANVAS_PRESETS, activeTimeline, allItems, placementLayout, coverLayout, containLayout, defaultLayout, findAsset, findItem, itemEnd, type Asset, type Item, type Project, type Transition, retimeTimeline } from '@shared/project'
import { captionAssetName, captionLayout, captionStyle, checkCues } from '@shared/captions'
import { applyScriptOps } from '@shared/script'
import { clone, makeTrack, newId } from '../factory'
import type { EditorActions } from '../types'
import type { StoreKit } from '../kit'

type Actions = Pick<
  EditorActions,
  | 'setCanvasPreset'
  | 'setFps'
  | 'addTransition'
  | 'removeTransition'
  | 'applyScript'
  | 'patchTransition'
  | 'placeSubtitles'
  | 'resizeCanvas'
  | 'addCaptions'
  | 'addMarker'
  | 'moveMarker'
  | 'removeMarker'
>

export function timelineSlice({ set, get, edit, editTimeline, currentTimeline }: StoreKit): Actions {
  return {
    setCanvasPreset(presetId) {
      const preset = CANVAS_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      editTimeline((timeline) => {
        timeline.width = preset.width
        timeline.height = preset.height
        // Through `retimeTimeline` rather than a bare assignment: a preset carries a rate, and
        // a preset change that moved every clip in time without moving its frame numbers would
        // be a silent re-cut. It is a no-op while every preset is 30fps, which is exactly the
        // kind of latency that makes this the wrong line to leave for later.
        retimeTimeline(timeline, preset.fps)
      })
    },

    setFps(fps) {
      const timeline = activeTimeline(get().project)
      if (!timeline || !(fps > 0) || fps === timeline.fps) return { nudged: 0 }
      let nudged = 0
      editTimeline((draft) => {
        nudged = retimeTimeline(draft, fps).nudged
      })
      return { nudged }
    },

    // -- transitions --------------------------------------------------------
    addTransition(spec) {
      const timeline = currentTimeline()
      if (!timeline) return { error: 'No timeline is open.' }

      const from = findItem(timeline, spec.fromItemId)
      const to = findItem(timeline, spec.toItemId)
      if (!from) return { error: `No item ${spec.fromItemId} on this timeline.` }
      if (!to) return { error: `No item ${spec.toItemId} on this timeline.` }
      if (from.track.id !== to.track.id) {
        return {
          error:
            `Those items are on different tracks (${from.track.name} and ${to.track.name}). ` +
            `A transition crosses a cut, which only exists between two clips on one track.`
        }
      }
      if (itemEnd(from.item) !== to.item.from) {
        return {
          error:
            `Those items do not meet: ${spec.fromItemId} ends at frame ${itemEnd(from.item)} ` +
            `and ${spec.toItemId} starts at ${to.item.from}. A transition needs them abutting — ` +
            `move one so the gap is closed, then add it.`
        }
      }
      if (spec.durationInFrames < 2) {
        return { error: 'A transition needs at least 2 frames, one on each side of the cut.' }
      }

      // One transition per junction. A second would draw over the first and neither would be
      // the answer to "what is at this cut".
      const existing = (timeline.transitions ?? []).find(
        (t) => t.fromItemId === spec.fromItemId && t.toItemId === spec.toItemId
      )

      const id = existing?.id ?? newId('trn')
      editTimeline((tl) => {
        const list = tl.transitions ?? (tl.transitions = [])
        const next: Transition = {
          id,
          kind: spec.kind,
          fromItemId: spec.fromItemId,
          toItemId: spec.toItemId,
          durationInFrames: Math.max(2, Math.floor(spec.durationInFrames)),
          ...(spec.direction ? { direction: spec.direction } : {})
        }
        const at = list.findIndex((t) => t.id === id)
        if (at >= 0) list[at] = next
        else list.push(next)
      })
      return { id }
    },

    removeTransition(transitionId) {
      editTimeline((timeline) => {
        if (!timeline.transitions) return
        timeline.transitions = timeline.transitions.filter((t) => t.id !== transitionId)
      })
    },

    applyScript(timelineId, operations) {
      edit((project) => applyScriptOps(project, timelineId, operations, newId))
      // A deleted clip must not stay selected: the inspector would edit an item that is gone.
      const gone = new Set(operations.filter((op) => op.op === 'delete').map((op) => op.itemId))
      if (gone.size > 0) set((state) => ({ selection: state.selection.filter((id) => !gone.has(id)) }))
    },

    patchTransition(transitionId, patch) {
      editTimeline((timeline) => {
        const transition = timeline.transitions?.find((t) => t.id === transitionId)
        if (!transition) return
        Object.assign(transition, patch)
        if (transition.durationInFrames < 2) transition.durationInFrames = 2
      })
    },

    // -- subtitles and canvas ----------------------------------------------------
    placeSubtitles(sourceItemId, asset) {
      const timeline = currentTimeline()
      if (!timeline) return { error: 'No timeline is open.' }
      const source = allItems(timeline).find((item) => item.id === sourceItemId)
      if (!source) return { error: `There is no clip ${sourceItemId} on the open timeline.` }
      const from = source.from
      const to = itemEnd(source)
      const isSubtitles = (project: Project, item: Item): boolean =>
        findAsset(project, item.assetId)?.compositionId?.startsWith('subtitles-') === true
      const itemId = newId('itm')
      let replaced = 0
      let trackName = 'Subtitles'
      edit((project) => {
        const tl = activeTimeline(project)
        if (!tl) return
        if (!project.assets.some((a) => a.id === asset.id)) project.assets.push(clone(asset))
        let track = tl.tracks.find((t) => t.kind === 'video' && t.name === 'Subtitles')
        if (!track) {
          track = makeTrack('video', 1)
          track.name = 'Subtitles'
          // Pushed last: later video tracks draw on top, so subtitles sit above every picture.
          tl.tracks.push(track)
        }
        trackName = track.name
        const before = track.items.length
        track.items = track.items.filter(
          (item) => !(isSubtitles(project, item) && item.from < to && itemEnd(item) > from)
        )
        replaced = before - track.items.length
        track.items.push({
          id: itemId,
          assetId: asset.id,
          trackId: track.id,
          from,
          durationInFrames: to - from,
          sourceStartUs: 0,
          layout: defaultLayout(tl),
          volume: 1,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          speed: 1
        })
      })
      return { itemId, trackName, replaced }
    },

    resizeCanvas(width, height, fit) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 8192 || height > 8192) {
        return { error: `A canvas must be whole pixels from 16 to 8192 a side; got ${width}×${height}.` }
      }
      let refitted = 0
      editTimeline((timeline, project) => {
        const oldWidth = timeline.width
        const oldHeight = timeline.height
        timeline.width = width
        timeline.height = height
        for (const item of allItems(timeline)) {
          const asset = findAsset(project, item.assetId)
          if (!asset) continue
          const keep = { opacity: item.layout.opacity, rotation: item.layout.rotation }
          if ((asset.kind === 'video' || asset.kind === 'image') && asset.width && asset.height) {
            const fitted =
              fit === 'cover'
                ? coverLayout(timeline, asset.width, asset.height)
                : fit === 'contain'
                  ? containLayout(timeline, asset.width, asset.height)
                  : placementLayout(timeline, asset.width, asset.height)
            item.layout = { ...fitted, ...keep }
          } else if (asset.kind === 'html' || (asset.kind === 'brf' && !asset.width)) {
            item.layout = { ...defaultLayout(timeline), ...keep }
          } else {
            // Text and the rest: the same place in proportion, the same width in proportion.
            const sx = width / oldWidth
            const sy = height / oldHeight
            const cx = (item.layout.left + item.layout.width / 2) * sx
            const cy = (item.layout.top + item.layout.height / 2) * sy
            const w = item.layout.width * sx
            const h = item.layout.height * Math.min(sx, sy)
            item.layout = { ...item.layout, left: cx - w / 2, top: cy - h / 2, width: w, height: h }
          }
          refitted += 1
        }
      })
      return { refitted }
    },

    // -- captions -----------------------------------------------------------
    addCaptions(cues, look) {
      const timeline = currentTimeline()
      if (!timeline) return { error: 'No timeline is open.' }
      const problem = checkCues(cues, timeline.fps)
      if (problem) return { error: problem }

      const style = look?.style ?? captionStyle(timeline)
      const layout = look?.layout ?? captionLayout(timeline)
      const existing = new Set(timeline.tracks.map((t) => t.name))
      let trackName = 'Captions'
      for (let n = 2; existing.has(trackName); n += 1) trackName = `Captions ${n}`

      const trackId = newId('trk')
      const now = Date.now()
      const assets = new Map<string, Asset>()
      const ordered = [...cues].sort((a, b) => a.fromFrame - b.fromFrame)
      const items: Item[] = ordered.map((cue) => {
        let asset = assets.get(cue.text)
        if (!asset) {
          asset = {
            id: newId('ast'),
            kind: 'text',
            name: captionAssetName(cue.text),
            path: null,
            durationUs: 0,
            width: null,
            height: null,
            fps: null,
            hasAudio: false,
            hasVideo: false,
            posterPath: null,
            waveformPath: null,
            text: cue.text,
            createdAt: now
          }
          assets.set(cue.text, asset)
        }
        return {
          id: newId('itm'),
          assetId: asset.id,
          trackId,
          from: cue.fromFrame,
          durationInFrames: cue.toFrame - cue.fromFrame,
          sourceStartUs: 0,
          layout: { ...layout },
          volume: 1,
          fadeInFrames: 0,
          fadeOutFrames: 0,
          speed: 1,
          // Cloned per item: styles are per item by design, and a shared object would let one
          // caption's edit reach every other through the reference.
          text: clone(style)
        }
      })

      // One `edit()`, so assets, track and every item are one undo step by construction.
      edit((project) => {
        const tl = activeTimeline(project)
        if (!tl) return
        project.assets.push(...assets.values())
        const track = makeTrack('video', 1)
        track.id = trackId
        track.name = trackName
        track.items = items
        // Pushed last: later video tracks draw on top, so this is above every picture.
        tl.tracks.push(track)
      })
      return {
        trackId,
        trackName,
        itemIds: items.map((item) => item.id),
        assetIds: [...assets.values()].map((asset) => asset.id)
      }
    },

    // -- markers ------------------------------------------------------------
    addMarker(frame, label, color) {
      const timeline = currentTimeline()
      if (!timeline) return null
      const id = newId('mk')
      const name = label?.trim() || `Marker ${(timeline.markers?.length ?? 0) + 1}`
      editTimeline((tl) => {
        const list = tl.markers ?? (tl.markers = [])
        list.push({
          id,
          frame: Math.max(0, Math.round(frame)),
          label: name,
          ...(color ? { color } : {})
        })
      })
      return id
    },

    moveMarker(markerId, frame) {
      editTimeline((tl) => {
        const marker = tl.markers?.find((m) => m.id === markerId)
        if (!marker) return
        marker.frame = Math.max(0, Math.round(frame))
      })
    },

    removeMarker(markerId) {
      editTimeline((tl) => {
        if (!tl.markers) return
        tl.markers = tl.markers.filter((m) => m.id !== markerId)
        // Back to absent rather than an empty list, so a project that tried markers and removed
        // them all saves exactly as one that never had any.
        if (tl.markers.length === 0) delete tl.markers
      })
    }
  }
}
