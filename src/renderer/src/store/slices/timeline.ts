/**
 * The timeline's shape and what sits on it besides clips: canvas and frame rate,
 * transitions, subtitles, captions, markers, review comments and scripted edits.
 */

import { CANVAS_PRESETS, checkCanvasSize, activeTimeline, allItems, placementLayout, coverLayout, containLayout, defaultLayout, findAsset, findItem, itemEnd, type Asset, type Item, type Project, type Transition, retimeTimeline } from '@shared/project'
import { captionAssetName, captionLayout, captionStyle, checkCues } from '@shared/captions'
import { applyScriptOps } from '@shared/script'
import { linkedPartners } from '@shared/links'
import { DUB_MUTE_DB } from '@shared/dub'
import { clone, makeTrack, newId, nextMarkerName } from '../factory'
import type { DubPlaced, EditorActions } from '../types'
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
  | 'placeDub'
  | 'resizeCanvas'
  | 'setBackground'
  | 'rememberDelivery'
  | 'addCaptions'
  | 'addMarker'
  | 'moveMarker'
  | 'removeMarker'
  | 'patchMarker'
  | 'addComment'
  | 'editComment'
  | 'resolveComment'
  | 'removeComment'
>

export function timelineSlice({ set, get, edit, editTimeline, currentTimeline }: StoreKit): Actions {
  return {
    setCanvasPreset(presetId, fit = 'auto') {
      const preset = CANVAS_PRESETS.find((p) => p.id === presetId)
      if (!preset) return { error: `There is no canvas preset "${presetId}".` }
      // The same path as `set_canvas`: a preset is only a named size, and a size change refits
      // what was laid out for the old one. This used to set width and height alone (and retime to
      // the preset's 30fps), so the human's canvas change left clips framed for the old shape
      // while the agent's refitted them. The rate stays the project's; Frame rate changes it.
      return get().resizeCanvas(preset.width, preset.height, fit)
    },

    setBackground(color) {
      // Hex only: the compositor paints it as a fillStyle, and an unparseable colour there keeps
      // the previous fill rather than failing, which would be a background that silently ignored
      // the change.
      if (!/^#[0-9a-f]{6}$/i.test(color)) return
      editTimeline((timeline) => {
        if (timeline.background.toLowerCase() !== color.toLowerCase()) timeline.background = color
      })
    },

    rememberDelivery(projectId, timelineId, loudness) {
      if (get().project.id !== projectId) return
      // Not an undo step: it lands when an export finishes, minutes after anything the user did,
      // so a history entry would clear their redo and make the next ⌘Z appear to do nothing —
      // and, outside any agent tool call, mark the agent's turn as the user's edit. Silent, then,
      // but the decision belongs in the saved `.bay`, so the document is dirty.
      const before = get().project
      edit((project) => {
        const timeline = project.timelines.find((candidate) => candidate.id === timelineId)
        if (!timeline) return
        if (loudness) {
          timeline.delivery = { ...timeline.delivery, loudness: { integratedLufs: loudness.integratedLufs, truePeakDb: loudness.truePeakDb } }
          return
        }
        if (!timeline.delivery?.loudness) return
        const rest = { ...timeline.delivery }
        delete rest.loudness
        if (Object.keys(rest).length > 0) timeline.delivery = rest
        else delete timeline.delivery
      }, { silent: true })
      if (get().project !== before) set({ dirty: true })
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
          ...(spec.direction ? { direction: spec.direction } : {}),
          ...(spec.ease ? { ease: spec.ease } : {})
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
        // Linear is stored as absence, so a transition put back to linear saves as it was.
        if (transition.ease === undefined || transition.ease === 'linear') delete transition.ease
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

    placeDub(spec) {
      const timeline = currentTimeline()
      if (!timeline) return { error: 'No timeline is open.' }
      const existing = timeline.tracks.find((t) => t.kind === 'audio' && t.name === spec.trackName)
      if (existing?.locked) return { error: `The track "${spec.trackName}" is locked. Unlock it, then place the dub again.` }
      // The new lines are checked against each other as well as against what is on the track:
      // two lines laid over one another would both play.
      const order = [...spec.clips].sort((a, b) => a.from - b.from)
      for (const [i, clip] of order.entries()) {
        const next = order[i + 1]
        if (next && clip.from + clip.durationInFrames > next.from) {
          return {
            error: `Two dub lines overlap: one at frame ${clip.from} runs ${clip.durationInFrames} frames, past the next at ${next.from}. Nothing was placed.`
          }
        }
      }
      const itemIds = spec.clips.map(() => newId('itm'))
      const placed: DubPlaced = {
        trackId: existing?.id ?? '',
        trackName: spec.trackName,
        itemIds,
        replaced: 0,
        ducked: [],
        muted: [],
        replacedDucks: [],
        lockedOriginals: []
      }
      edit((project) => {
        const tl = activeTimeline(project)
        if (!tl) return
        for (const clip of spec.clips) {
          if (!project.assets.some((a) => a.id === clip.asset.id)) project.assets.push(clone(clip.asset))
        }
        let track = tl.tracks.find((t) => t.kind === 'audio' && t.name === spec.trackName)
        if (!track) {
          track = makeTrack('audio', tl.tracks.filter((t) => t.kind === 'audio').length + 1)
          track.name = spec.trackName
          tl.tracks.push(track)
        }
        placed.trackId = track.id
        const before = track.items.length
        track.items = track.items.filter(
          (item) => !spec.clips.some((clip) => item.from < clip.from + clip.durationInFrames && itemEnd(item) > clip.from)
        )
        placed.replaced = before - track.items.length
        for (const [i, clip] of spec.clips.entries()) {
          track.items.push({
            id: itemIds[i]!,
            assetId: clip.asset.id,
            trackId: track.id,
            from: clip.from,
            durationInFrames: clip.durationInFrames,
            sourceStartUs: 0,
            layout: defaultLayout(tl),
            volume: 1,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            speed: clip.speed
          })
        }
        track.items.sort((a, b) => a.from - b.from)
        if (spec.original.mode === 'keep') return
        // The sound of each original clip: its own, or the audio item it was detached onto.
        const sounding = new Map<string, Item>()
        for (const id of spec.original.itemIds) {
          const item = allItems(tl).find((candidate) => candidate.id === id)
          if (!item) continue
          const sources = item.audioDetached ? linkedPartners(tl, item.id).filter((p) => !p.audioDetached) : [item]
          for (const source of sources) sounding.set(source.id, source)
        }
        const locked = new Set(tl.tracks.filter((t) => t.locked).map((t) => t.id))
        for (const item of sounding.values()) {
          if (item.trackId === track.id) continue
          if (locked.has(item.trackId)) {
            placed.lockedOriginals.push(item.id)
            continue
          }
          // A mute is a duck too — the deepest one, keyed to the dub track — so the original is
          // silent under the dubbed lines only, and silent even when its volume is keyframed
          // (`item.volume` is not read where keys exist; a duck multiplies after them).
          const previous = item.duck
          if (previous && previous.keyTrackId !== track.id) {
            placed.replacedDucks.push({
              itemId: item.id,
              keyTrackId: previous.keyTrackId,
              keyTrackName: tl.tracks.find((t) => t.id === previous.keyTrackId)?.name ?? previous.keyTrackId
            })
          }
          item.duck = {
            keyTrackId: track.id,
            amountDb: spec.original.mode === 'mute' ? DUB_MUTE_DB : spec.original.amountDb,
            attackFrames: Math.round(tl.fps * 0.25),
            releaseFrames: Math.round(tl.fps * 0.5)
          }
          ;(spec.original.mode === 'mute' ? placed.muted : placed.ducked).push(item.id)
        }
      })
      return placed
    },

    resizeCanvas(width, height, fit) {
      const problem = checkCanvasSize(width, height)
      if (problem) return { error: problem }
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
            caption: true,
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
      const name = label?.trim() || nextMarkerName(timeline.markers)
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
    },

    patchMarker(markerId, patch) {
      editTimeline((tl) => {
        const marker = tl.markers?.find((m) => m.id === markerId)
        if (!marker) return
        const label = patch.label?.trim()
        if (label) marker.label = label
        if (patch.color === null) delete marker.color
        else if (patch.color !== undefined) marker.color = patch.color
      })
    },

    // -- review comments ----------------------------------------------------
    addComment(frame, text, options = {}) {
      if (!currentTimeline()) return null
      const words = text.trim()
      if (!words) return null
      const at = Math.max(0, Math.round(frame))
      const end = options.endFrame === undefined ? undefined : Math.round(options.endFrame)
      const id = newId('cm')
      editTimeline((tl) => {
        const list = tl.comments ?? (tl.comments = [])
        list.push({
          id,
          frame: at,
          ...(end !== undefined && end > at ? { endFrame: end } : {}),
          text: words,
          author: options.author ?? 'user',
          resolved: false,
          createdAt: Date.now()
        })
      })
      return id
    },

    editComment(commentId, patch) {
      editTimeline((tl) => {
        const comment = tl.comments?.find((c) => c.id === commentId)
        if (!comment) return
        const words = patch.text?.trim()
        if (words && words !== comment.text) comment.text = words
        if (patch.frame !== undefined) {
          const at = Math.max(0, Math.round(patch.frame))
          // A moved span keeps its length.
          if (comment.endFrame !== undefined && patch.endFrame === undefined) comment.endFrame += at - comment.frame
          comment.frame = at
        }
        if (patch.endFrame === null) delete comment.endFrame
        else if (patch.endFrame !== undefined) {
          const end = Math.round(patch.endFrame)
          if (end > comment.frame) comment.endFrame = end
          else delete comment.endFrame
        }
        if (patch.resolved === false && comment.resolved) {
          comment.resolved = false
          delete comment.resolvedNote
        } else if (patch.resolved === true && !comment.resolved) comment.resolved = true
      })
    },

    resolveComment(commentId, note) {
      editTimeline((tl) => {
        const comment = tl.comments?.find((c) => c.id === commentId)
        if (!comment) return
        const words = note?.trim()
        if (comment.resolved && (!words || words === comment.resolvedNote)) return
        comment.resolved = true
        if (words) comment.resolvedNote = words
      })
    },

    removeComment(commentId) {
      editTimeline((tl) => {
        if (!tl.comments?.some((c) => c.id === commentId)) return
        tl.comments = tl.comments.filter((c) => c.id !== commentId)
        // Absent rather than empty, as markers are.
        if (tl.comments.length === 0) delete tl.comments
      })
    }
  }
}
