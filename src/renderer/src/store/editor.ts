/**
 * The editor store — the single source of truth the UI renders from and the engine reads.
 *
 * Two deliberate choices:
 *
 * - **The playhead lives here, in frames.** Every surface (transport, timeline, preview,
 *   inspector) reads the same integer, so they cannot disagree about where we are. The
 *   playback clock writes to it at the timeline's frame rate, not the display's.
 * - **Undo is snapshot-based over `project` only.** Selection, zoom and the playhead are
 *   view state and are deliberately excluded — undoing a trim should not also scroll you
 *   somewhere else. Snapshots are cheap here because a project is small JSON; if that ever
 *   stops being true the fix is a patch log, not a smaller snapshot.
 */

import { create } from 'zustand'
import {
  CANVAS_PRESETS,
  PROJECT_VERSION,
  activeTimeline,
  allItems,
  coverLayout,
  defaultLayout,
  findAsset,
  findItem,
  findTimeline,
  findTrack,
  framesToUs,
  itemEnd,
  itemsOverlap,
  timelineDuration,
  usToFrames,
  type Asset,
  type Frames,
  type Item,
  type Layout,
  type Project,
  type Timeline,
  type Track,
  type TrackKind
} from '@shared/project'

const HISTORY_LIMIT = 100

export type PanelId = 'media' | 'text' | 'effects' | 'export'

export interface EditorState {
  project: Project
  /** Item ids. Multi-select is supported; most operations act on all of them. */
  selection: string[]
  playhead: Frames
  playing: boolean
  /** Horizontal timeline scale, in CSS pixels per frame. */
  pixelsPerFrame: number
  /** Which left-hand panel is showing. */
  panel: PanelId
  /** Set while the user drags the playhead — playback yields to scrubbing. */
  scrubbing: boolean
  /** Non-blocking messages surfaced in the status bar. */
  toast: { id: number; kind: 'info' | 'error'; text: string } | null
  dirty: boolean
  past: Project[]
  future: Project[]
}

export interface EditorActions {
  // project ------------------------------------------------------------------
  setProject(project: Project, options?: { resetHistory?: boolean }): void
  renameProject(name: string): void
  setCanvasPreset(presetId: string): void

  // assets -------------------------------------------------------------------
  addAssets(assets: Asset[]): void
  removeAsset(assetId: string): void
  renameAsset(assetId: string, name: string): void
  patchAsset(assetId: string, patch: Partial<Asset>): void

  // items --------------------------------------------------------------------
  /** Places an asset at `atFrame`, choosing a track that has room. Returns the new item id. */
  placeAsset(assetId: string, atFrame?: Frames, trackId?: string): string | null
  moveItem(itemId: string, toFrame: Frames, toTrackId?: string): void
  trimItem(itemId: string, edge: 'start' | 'end', toFrame: Frames): void
  splitAt(frame?: Frames): void
  deleteSelected(): void
  duplicateSelected(): void
  patchItem(itemId: string, patch: Partial<Omit<Item, 'id' | 'trackId'>>): void
  patchLayout(itemId: string, patch: Partial<Layout>): void

  // tracks -------------------------------------------------------------------
  addTrack(kind: TrackKind): string
  removeTrack(trackId: string): void
  patchTrack(trackId: string, patch: Partial<Pick<Track, 'locked' | 'muted' | 'hidden' | 'name'>>): void

  // selection / view ---------------------------------------------------------
  select(itemIds: string[], additive?: boolean): void
  clearSelection(): void
  setPlayhead(frame: Frames): void
  nudgePlayhead(deltaFrames: Frames): void
  setPlaying(playing: boolean): void
  togglePlay(): void
  setScrubbing(scrubbing: boolean): void
  setPixelsPerFrame(pixelsPerFrame: number): void
  zoomBy(factor: number): void
  setPanel(panel: PanelId): void
  notify(text: string, kind?: 'info' | 'error'): void
  dismissToast(): void

  // history ------------------------------------------------------------------
  undo(): void
  redo(): void
  markSaved(): void
}

export type EditorStore = EditorState & EditorActions

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

let idCounter = 0
export function newId(prefix: string): string {
  idCounter += 1
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`
}

function makeTrack(kind: TrackKind, index: number): Track {
  return {
    id: newId('trk'),
    kind,
    name: `${kind === 'video' ? 'V' : 'A'}${index}`,
    locked: false,
    muted: false,
    hidden: false,
    items: []
  }
}

export function emptyTimeline(preset = CANVAS_PRESETS[0]!): Timeline {
  return {
    id: newId('tl'),
    name: 'Timeline 1',
    fps: preset.fps,
    width: preset.width,
    height: preset.height,
    background: '#000000',
    tracks: [makeTrack('video', 1), makeTrack('audio', 1)]
  }
}

export function emptyProject(): Project {
  const timeline = emptyTimeline()
  const now = Date.now()
  return {
    id: newId('prj'),
    name: 'Untitled',
    version: PROJECT_VERSION,
    assets: [],
    timelines: [timeline],
    activeTimelineId: timeline.id,
    createdAt: now,
    updatedAt: now,
    filePath: null
  }
}

/** Structured clone, with a JSON fallback for the odd environment that lacks it. */
function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function nextTrackName(timeline: Timeline, kind: TrackKind): string {
  const count = timeline.tracks.filter((t) => t.kind === kind).length
  return `${kind === 'video' ? 'V' : 'A'}${count + 1}`
}

/** The first track of `kind` with room for [from, from+duration), or null if none has. */
function trackWithRoom(
  timeline: Timeline,
  kind: TrackKind,
  from: Frames,
  duration: Frames
): Track | null {
  const probe = { from, durationInFrames: duration } as Item
  for (const track of timeline.tracks) {
    if (track.kind !== kind || track.locked) continue
    if (!track.items.some((existing) => itemsOverlap(existing, probe))) return track
  }
  return null
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let toastCounter = 0

export const useEditor = create<EditorStore>((set, get) => {
  /**
   * Every mutation of `project` goes through here. It snapshots the previous project for
   * undo, stamps `updatedAt`, clears the redo stack and marks the document dirty — so no
   * caller has to remember to do any of that, and none of them can forget.
   */
  function edit(mutator: (project: Project) => void, options?: { silent?: boolean }): void {
    set((state) => {
      const before = state.project
      const next = clone(before)
      mutator(next)
      next.updatedAt = Date.now()
      if (options?.silent) {
        return { project: next }
      }
      const past = [...state.past, before]
      if (past.length > HISTORY_LIMIT) past.shift()
      return { project: next, past, future: [], dirty: true }
    })
  }

  /** Runs `mutator` against the active timeline, or does nothing if there isn't one. */
  function editTimeline(mutator: (timeline: Timeline, project: Project) => void): void {
    edit((project) => {
      const timeline = activeTimeline(project)
      if (!timeline) return
      mutator(timeline, project)
    })
  }

  function currentTimeline(): Timeline | undefined {
    return activeTimeline(get().project)
  }

  return {
    project: emptyProject(),
    selection: [],
    playhead: 0,
    playing: false,
    pixelsPerFrame: 4,
    panel: 'media',
    scrubbing: false,
    toast: null,
    dirty: false,
    past: [],
    future: [],

    // -- project ------------------------------------------------------------
    setProject(project, options) {
      set((state) => ({
        project,
        selection: [],
        playhead: 0,
        playing: false,
        dirty: false,
        past: options?.resetHistory === false ? state.past : [],
        future: []
      }))
    },

    renameProject(name) {
      edit((project) => {
        project.name = name
      })
    },

    setCanvasPreset(presetId) {
      const preset = CANVAS_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      editTimeline((timeline) => {
        timeline.width = preset.width
        timeline.height = preset.height
        timeline.fps = preset.fps
      })
    },

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

    renameAsset(assetId, name) {
      edit((project) => {
        const asset = findAsset(project, assetId)
        if (asset) asset.name = name
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

      const from = Math.max(0, Math.round(atFrame ?? state.playhead))
      const kind: TrackKind = asset.hasVideo || asset.kind === 'image' || asset.kind === 'text'
        ? 'video'
        : 'audio'

      // A still has no duration of its own, so it gets a sensible default rather than 0.
      const naturalFrames =
        asset.durationUs > 0 ? usToFrames(asset.durationUs, timeline.fps) : timeline.fps * 5
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
        const layout =
          asset.width && asset.height
            ? coverLayout(tl, asset.width, asset.height)
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
          speed: 1
        }
        track.items.push(item)
        track.items.sort((a, b) => a.from - b.from)
      })
      target = null
      set({ selection: [itemId] })
      return itemId
    },

    moveItem(itemId, toFrame, toTrackId) {
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

        track.items = track.items.filter((i) => i.id !== item.id)
        destination.items.push(moved)
        destination.items.sort((a, b) => a.from - b.from)
      })
    },

    trimItem(itemId, edge, toFrame) {
      editTimeline((timeline) => {
        const found = findItem(timeline, itemId)
        if (!found) return
        const { item, track } = found
        if (track.locked) return
        const frame = Math.round(toFrame)

        if (edge === 'start') {
          const maxStart = itemEnd(item) - 1
          const nextFrom = Math.max(0, Math.min(frame, maxStart))
          const delta = nextFrom - item.from
          if (delta === 0) return
          // Trimming the head must move the read point into the source by the same
          // amount, or the clip slides its content instead of revealing less of it.
          const nextSourceStart = item.sourceStartUs + framesToUs(delta, timeline.fps) * item.speed
          if (nextSourceStart < 0) return
          const collides = track.items.some(
            (other) =>
              other.id !== item.id &&
              itemsOverlap(other, { ...item, from: nextFrom, durationInFrames: item.durationInFrames - delta })
          )
          if (collides) return
          item.from = nextFrom
          item.durationInFrames -= delta
          item.sourceStartUs = Math.round(nextSourceStart)
        } else {
          const nextDuration = Math.max(1, frame - item.from)
          const collides = track.items.some(
            (other) =>
              other.id !== item.id &&
              itemsOverlap(other, { ...item, durationInFrames: nextDuration })
          )
          if (collides) return
          item.durationInFrames = nextDuration
        }
        if (item.fadeInFrames > item.durationInFrames) item.fadeInFrames = item.durationInFrames
        if (item.fadeOutFrames > item.durationInFrames) item.fadeOutFrames = item.durationInFrames
      })
    },

    splitAt(frame) {
      const state = get()
      const timeline = activeTimeline(state.project)
      if (!timeline) return
      const at = Math.round(frame ?? state.playhead)
      const targets = state.selection.length > 0 ? state.selection : null

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
              fadeInFrames: 0
            }
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
      const ids = get().selection
      if (ids.length === 0) return
      editTimeline((timeline) => {
        for (const track of timeline.tracks) {
          if (track.locked) continue
          track.items = track.items.filter((item) => !ids.includes(item.id))
        }
      })
      set({ selection: [] })
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
              layout: { ...item.layout }
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

    patchItem(itemId, patch) {
      editTimeline((timeline) => {
        const found = findItem(timeline, itemId)
        if (!found || found.track.locked) return
        Object.assign(found.item, patch)
        if (found.item.durationInFrames < 1) found.item.durationInFrames = 1
        if (found.item.from < 0) found.item.from = 0
      })
    },

    patchLayout(itemId, patch) {
      editTimeline((timeline) => {
        const found = findItem(timeline, itemId)
        if (!found || found.track.locked) return
        Object.assign(found.item.layout, patch)
      })
    },

    // -- tracks -------------------------------------------------------------
    addTrack(kind) {
      const id = newId('trk')
      editTimeline((timeline) => {
        const track = makeTrack(kind, 1)
        track.id = id
        track.name = nextTrackName(timeline, kind)
        timeline.tracks.push(track)
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
        if (track) Object.assign(track, patch)
      })
    },

    // -- selection / view ---------------------------------------------------
    select(itemIds, additive) {
      set((state) => {
        if (!additive) return { selection: itemIds }
        const merged = new Set(state.selection)
        for (const id of itemIds) {
          if (merged.has(id)) merged.delete(id)
          else merged.add(id)
        }
        return { selection: [...merged] }
      })
    },

    clearSelection() {
      set({ selection: [] })
    },

    setPlayhead(frame) {
      const timeline = currentTimeline()
      const max = timeline ? timelineDuration(timeline) : 0
      set({ playhead: Math.max(0, Math.min(Math.round(frame), Math.max(0, max))) })
    },

    nudgePlayhead(deltaFrames) {
      get().setPlayhead(get().playhead + deltaFrames)
    },

    setPlaying(playing) {
      const timeline = currentTimeline()
      if (playing && timeline && timelineDuration(timeline) === 0) return
      set({ playing })
    },

    togglePlay() {
      get().setPlaying(!get().playing)
    },

    setScrubbing(scrubbing) {
      set({ scrubbing })
    },

    setPixelsPerFrame(pixelsPerFrame) {
      set({ pixelsPerFrame: Math.max(0.05, Math.min(60, pixelsPerFrame)) })
    },

    zoomBy(factor) {
      get().setPixelsPerFrame(get().pixelsPerFrame * factor)
    },

    setPanel(panel) {
      set({ panel })
    },

    notify(text, kind = 'info') {
      toastCounter += 1
      set({ toast: { id: toastCounter, kind, text } })
    },

    dismissToast() {
      set({ toast: null })
    },

    // -- history ------------------------------------------------------------
    undo() {
      set((state) => {
        const previous = state.past[state.past.length - 1]
        if (!previous) return state
        return {
          project: previous,
          past: state.past.slice(0, -1),
          future: [state.project, ...state.future],
          selection: [],
          dirty: true
        }
      })
    },

    redo() {
      set((state) => {
        const next = state.future[0]
        if (!next) return state
        return {
          project: next,
          past: [...state.past, state.project],
          future: state.future.slice(1),
          selection: [],
          dirty: true
        }
      })
    },

    markSaved() {
      set({ dirty: false })
    }
  }
})

// ---------------------------------------------------------------------------
// Selectors — importing these keeps components subscribed to one slice, not the store
// ---------------------------------------------------------------------------

export const selectTimeline = (state: EditorStore): Timeline | undefined =>
  findTimeline(state.project, state.project.activeTimelineId)

export const selectDuration = (state: EditorStore): Frames => {
  const timeline = selectTimeline(state)
  return timeline ? timelineDuration(timeline) : 0
}

export const selectSelectedItems = (state: EditorStore): Item[] => {
  const timeline = selectTimeline(state)
  if (!timeline) return []
  return allItems(timeline).filter((item) => state.selection.includes(item.id))
}

export const selectFps = (state: EditorStore): number => selectTimeline(state)?.fps ?? 30
