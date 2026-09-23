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
  activeTimeline,
  allItems,
  placementLayout,
  coverLayout,
  containLayout,
  normaliseCrop,
  isCropped,
  NO_CROP,
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
  type Project,
  type Timeline,
  type TrackKind,
  type Transition,
  retimeTimeline
} from '@shared/project'
import type { AgentEntry } from '@shared/agent'
import { pinKey } from '@shared/pins'
import { describeChanges } from '@shared/diff'
import { rippleDelete, type RippleDeleteResult } from '@shared/ripple'
import { applyTrimPlan, planTrim } from '@shared/trim'
import {
  captionAssetName,
  captionLayout,
  captionStyle,
  checkCues
} from '@shared/captions'
import { applyScriptOps } from '@shared/script'

import { remember, remembered } from './prefs'
import {
  clone,
  emptyProject,
  makeTrack,
  newId,
  nextTrackName,
  trackWithRoom
} from './factory'
import {
  MAX_AGENT_CHECKPOINTS,
  agentActingDepth,
  agentFileWriterNow
} from './agent-turns'
import type { EditorState, EditorStore } from './types'

// The store's public surface, unchanged for every importer.
export { emptyProject, newId } from './factory'
export {
  MAX_AGENT_CHECKPOINTS,
  asAgent,
  revertImpact,
  setAgentFileWriter,
  type AgentCheckpoint,
  type AgentRevert
} from './agent-turns'
export type { EditorActions, EditorState, EditorStore, PanelId, RegionId, Screen } from './types'

const HISTORY_LIMIT = 100

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
  /**
   * Open transaction, if any: the project as it stood before it began, plus whether anything
   * inside it has actually asked for a history entry. Depth rather than a boolean so a
   * `transact` inside a `transact` joins the outer one instead of closing it early.
   */
  let txDepth = 0
  /**
   * The project as last saved or opened — by identity, since every edit makes a new object.
   * Undo and redo compare against it, so undoing back to the saved state reads as saved rather
   * than leaving "Unsaved changes" up over a file that already holds exactly this.
   */
  let savedProject: Project | null = null
  let txBefore: Project | null = null
  let txRecorded = false

  function edit(mutator: (project: Project) => void, options?: { silent?: boolean }): void {
    set((state) => {
      const before = state.project
      const next = clone(before)
      mutator(next)

      // A mutator that declined to do anything must leave no trace. Several of them refuse
      // by design — `moveItem` onto occupied time, `patchTrack` on a missing track, a split
      // exactly on an item edge — and without this each refusal stamped `updatedAt`, marked
      // the document dirty and pushed a history entry that undoes nothing. An undo step that
      // restores the state you are already in is a control that does nothing, and a row of
      // them makes Cmd+Z feel broken.
      //
      // Compared before `updatedAt` is stamped, so the clone is byte-identical when nothing
      // changed. The stringify is affordable because edits happen at human scale — a drag
      // commits on drop, not per mousemove — and the alternative, asking every mutator to
      // report whether it did anything, is a thing thirty call sites can forget.
      if (JSON.stringify(before) === JSON.stringify(next)) return state

      next.updatedAt = Date.now()
      if (options?.silent) {
        return { project: next }
      }
      const turn = turnMarks(state)
      if (txDepth > 0) {
        // Inside a transaction the mutation lands but the history entry does not: the whole
        // group gets one, pushed on close. Without this, a tool that needs two store calls
        // makes two undo steps and `undo` reverses half of what it did.
        txRecorded = true
        return { project: next, dirty: true, ...turn }
      }
      const past = [...state.past, before]
      if (past.length > HISTORY_LIMIT) past.shift()
      return { project: next, past, future: [], dirty: true, ...turn }
    })
  }

  /**
   * What a real change to the project means for the agent turn in progress, if one is: the turn
   * changed something, and — when no agent tool call is running — the user did.
   */
  function turnMarks(state: EditorState): Partial<EditorState> {
    if (!state.agentRunning) return {}
    return agentActingDepth() > 0 ? { agentTurnEdited: true } : { agentTurnEdited: true, agentTurnUserEdited: true }
  }

  /**
   * Put files back to what one side of a set of turns held — `before` for a revert, `after` for
   * undoing one. Earliest turn's `before` wins per path; latest turn's `after`. A file that did not
   * exist before is left alone: the revert removes what uses it, and deleting a file the user may
   * have opened elsewhere is not a revert's call to make.
   */
  function restoreFiles(ids: string[], side: 'before' | 'after'): void {
    const checkpoints = get().agentCheckpoints
    const target = new Map<string, string>()
    const ordered = side === 'before' ? [...ids].reverse() : ids
    for (const id of ordered) {
      for (const file of checkpoints[id]?.files ?? []) {
        const contents = file[side]
        if (contents !== null) target.set(file.path, contents)
      }
    }
    if (target.size === 0) return
    const writer = agentFileWriterNow()
    if (!writer) {
      get().notify('The project was restored, but the composition files could not be: this window cannot write files.', 'error')
      return
    }
    for (const [path, contents] of target) {
      void writer(path, contents).then(
        (result) => {
          if (result.ok) get().markCompositionChanged(path)
          else get().notify(`Could not restore ${path}: ${result.error ?? 'the write failed'}.`, 'error')
        },
        (error: unknown) => get().notify(`Could not restore ${path}: ${String(error)}.`, 'error')
      )
    }
  }

  /**
   * After undo or redo lands on `project`, bring the change cards along: undoing a revert makes
   * its turns applied again (and rewrites their files); redoing it reverts them again.
   */
  function followReverts(project: Project): void {
    for (const record of get().agentReverts) {
      const to = project === record.replaced ? 'applied' : project === record.restored ? 'reverted' : null
      if (!to) continue
      const changed: string[] = []
      set((state) => ({
        agentLog: state.agentLog.map((entry) => {
          if (entry.kind !== 'changes' || !record.ids.includes(entry.id) || entry.state === to || entry.state === 'expired') {
            return entry
          }
          changed.push(entry.id)
          return { ...entry, state: to }
        })
      }))
      if (changed.length > 0) restoreFiles(changed, to === 'applied' ? 'after' : 'before')
    }
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
    hiddenRegions: { side: false, inspector: false, timeline: false },
    debugMode: (() => {
      try {
        return globalThis.localStorage?.getItem('bay.debugMode') === '1'
      } catch {
        return false
      }
    })(),
    settingsOpen: false,
    autoDownloadModels: remembered('bay.autoDownloadModels') !== '0',
    whisperModel: remembered('bay.whisperModel'),
    whisperDownload: null,
    screen: 'home',
    scrubbing: false,
    toast: null,
    agentGate: null,
    agentLog: [],
    agentRunning: false,
    agentProposal: null,
    agentPins: [],
    agentSessionActive: false,
    agentApproval: (() => {
      try {
        return globalThis.localStorage?.getItem('bay.agentApproval') === '1'
      } catch {
        return false
      }
    })(),
    agentTurnBase: null,
    agentTurnFiles: {},
    agentTurnEdited: false,
    agentTurnUserEdited: false,
    agentCheckpoints: {},
    agentReverts: [],
    compositionEpochs: {},
    dirty: false,
    past: [],
    future: [],

    // -- project ------------------------------------------------------------
    setProject(project, options) {
      // A project handed in whole is as it stands on disk (opened, created, or just saved).
      savedProject = project
      set((state) => {
        // A different project makes every checkpoint a snapshot of something else: reverting one
        // would put that project's contents in this window, and a save would write them over
        // this file. So they go, and their cards say they can no longer be reverted. A turn in
        // progress (the agent opened this project itself) diffs from here on.
        const switched = project.id !== state.project.id
        const agent: Partial<EditorState> = switched
          ? {
              agentCheckpoints: {},
              agentReverts: [],
              agentTurnFiles: {},
              agentTurnEdited: false,
              agentTurnUserEdited: false,
              agentTurnBase: state.agentRunning ? project : null,
              agentProposal: null,
              agentPins: [],
              agentGate: state.agentGate ? { approved: null } : null,
              agentLog: state.agentLog.map((entry) =>
                entry.kind === 'changes' && entry.state !== 'expired' ? { ...entry, state: 'expired' as const } : entry
              )
            }
          : {}
        return {
          project,
          selection: [],
          playhead: 0,
          playing: false,
          dirty: false,
          past: options?.resetHistory === false ? state.past : [],
          future: [],
          ...agent
        }
      })
    },

    renameProject(name) {
      edit((project) => {
        project.name = name
      })
    },

    startAgentSession() {
      // Gated only when the user asked to approve edits; otherwise the agent edits directly and
      // the diffs are the review.
      set({ agentSessionActive: true, agentGate: get().agentApproval ? { approved: null } : null })
    },

    setAgentApproval(on) {
      try {
        globalThis.localStorage?.setItem('bay.agentApproval', on ? '1' : '0')
      } catch {
        // Applies for this session even when it cannot be remembered.
      }
      const active = get().agentSessionActive
      set({ agentApproval: on, ...(active ? { agentGate: on ? { approved: null } : null } : {}) })
    },

    revertAgentChange(id) {
      const state = get()
      const checkpoint = state.agentCheckpoints[id]
      const index = state.agentLog.findIndex((e) => e.kind === 'changes' && e.id === id)
      const entry = state.agentLog[index]
      if (!checkpoint || !entry || entry.kind !== 'changes' || entry.state !== 'applied') return
      // Mid-turn, the revert would become part of the running turn's own diff, and the agent
      // would carry on editing a project it no longer has.
      if (state.agentRunning) {
        state.notify('Wait for the agent to finish, or stop it, before reverting.', 'error')
        return
      }
      // This turn and every later applied one: they were built on what this one did.
      const ids = state.agentLog
        .filter((e, i) => i >= index && e.kind === 'changes' && e.state === 'applied')
        .map((e) => e.id)
      // A fresh object, stamped like any edit — and the identity undo/redo recognise it by.
      const restored = { ...checkpoint.before, updatedAt: Date.now() }
      set((current) => {
        const past = [...current.past, current.project]
        if (past.length > HISTORY_LIMIT) past.shift()
        return {
          project: restored,
          past,
          future: [],
          selection: [],
          dirty: true,
          agentReverts: [...current.agentReverts, { restored, replaced: current.project, ids }],
          agentLog: current.agentLog.map((e) =>
            e.kind === 'changes' && ids.includes(e.id) ? { ...e, state: 'reverted' as const } : e
          )
        }
      })
      restoreFiles(ids, 'before')
    },

    recordAgentFileWrite(path, before, after) {
      set((state) => {
        if (!state.agentRunning) return {}
        const first = state.agentTurnFiles[path]
        return { agentTurnFiles: { ...state.agentTurnFiles, [path]: { before: first ? first.before : before, after } } }
      })
    },

    markCompositionChanged(path) {
      set((state) => ({ compositionEpochs: { ...state.compositionEpochs, [path]: (state.compositionEpochs[path] ?? 0) + 1 } }))
    },

    logUserMessage(text, pins) {
      set((state) => ({
        agentLog: [
          ...state.agentLog,
          { kind: 'user', id: newId('msg'), text, ...(pins && pins.length > 0 ? { pins } : {}) }
        ]
      }))
    },

    applyAgentEvent(event) {
      set((state) => {
        const log = state.agentLog
        switch (event.type) {
          case 'started':
            return state.agentRunning
              ? {}
              : {
                  agentRunning: true,
                  agentTurnBase: state.project,
                  agentTurnFiles: {},
                  agentTurnEdited: false,
                  agentTurnUserEdited: false
                }

          case 'text':
          case 'thinking': {
            // Appended to the open block of the same kind rather than pushed as its own entry:
            // a delta is a fragment of a sentence, and one entry per fragment would render as
            // one paragraph per token.
            const last = log[log.length - 1]
            const kind = event.type === 'text' ? 'assistant' : 'thought'
            if (last && last.kind === kind) {
              const merged = { ...last, text: last.text + event.delta }
              return { agentLog: [...log.slice(0, -1), merged] }
            }
            return { agentLog: [...log, { kind, id: newId('msg'), text: event.delta }] }
          }

          case 'tool': {
            // The same call arrives twice: when the model starts writing it (no arguments yet)
            // and when its arguments settle. The second fills in the first's card.
            const index = log.findIndex((e) => e.kind === 'tool' && e.id === event.callId)
            if (index >= 0) {
              const entry = log[index] as Extract<AgentEntry, { kind: 'tool' }>
              if (Object.keys(event.args).length === 0) return {}
              const { input: _streamed, ...settled } = entry
              const updated: AgentEntry = { ...settled, tool: event.tool, args: event.args }
              return { agentLog: [...log.slice(0, index), updated, ...log.slice(index + 1)] }
            }
            return {
              agentLog: [
                ...log,
                {
                  kind: 'tool',
                  id: event.callId,
                  tool: event.tool,
                  args: event.args,
                  state: 'running'
                }
              ]
            }
          }

          case 'tool-input': {
            const index = log.findIndex((e) => e.kind === 'tool' && e.id === event.callId)
            if (index < 0) return {}
            const entry = log[index] as Extract<AgentEntry, { kind: 'tool' }>
            // Kept whole while it streams — the card shows its tail — and dropped once the
            // arguments settle, since then the arguments say the same thing parsed.
            const updated: AgentEntry = { ...entry, input: (entry.input ?? '') + event.delta }
            return { agentLog: [...log.slice(0, index), updated, ...log.slice(index + 1)] }
          }

          case 'tool-result': {
            // Patched in place, so a call becomes its own result rather than spawning a second
            // card the reader has to pair up by eye.
            const index = log.findIndex((e) => e.kind === 'tool' && e.id === event.callId)
            if (index < 0) return {}
            const entry = log[index] as Extract<AgentEntry, { kind: 'tool' }>
            const updated: AgentEntry = {
              ...entry,
              state: event.ok ? 'done' : 'failed',
              result: event.summary
            }
            return { agentLog: [...log.slice(0, index), updated, ...log.slice(index + 1)] }
          }

          case 'proposal':
            return {
              agentProposal: event.proposal,
              agentLog: [...log, { kind: 'proposal', id: event.proposal.id, proposal: event.proposal }]
            }

          case 'done': {
            // A turn that changed something leaves a diff behind, with what a revert needs. Keyed
            // on whether a real edit happened (not on the project's identity, which a poster
            // arriving also changes), and on the files it rewrote, which the project does not show.
            const base = state.agentTurnBase
            const files = Object.entries(state.agentTurnFiles).map(([path, file]) => ({ path, ...file }))
            const edited = base !== null && state.agentTurnEdited && base !== state.project
            const lines = edited ? describeChanges(base, state.project) : []
            if (edited && lines.length === 0) {
              lines.push({ kind: 'changed', text: 'Changed settings this summary does not list' })
            }
            for (const file of files) {
              const name = file.path.split(/[\\/]/).pop() ?? file.path
              lines.push(file.before === null ? { kind: 'added', text: `Created “${name}”` } : { kind: 'changed', text: `Rewrote “${name}”` })
            }
            const changeId = newId('chg')
            const note = state.agentTurnUserEdited
              ? 'Includes edits you made while the agent was working — reverting takes those too.'
              : undefined
            let checkpoints = state.agentCheckpoints
            let entries: AgentEntry[] = log
            if (lines.length > 0 && base) {
              checkpoints = { ...checkpoints, [changeId]: { before: base, after: state.project, files } }
              entries = [...log, { kind: 'changes', id: changeId, lines, state: 'applied', ...(note ? { note } : {}) }]
              // Oldest first out: its card stays, readable, but can no longer be reverted.
              const ids = Object.keys(checkpoints)
              const expired = new Set(ids.slice(0, Math.max(0, ids.length - MAX_AGENT_CHECKPOINTS)))
              if (expired.size > 0) {
                checkpoints = Object.fromEntries(Object.entries(checkpoints).filter(([id]) => !expired.has(id)))
                entries = entries.map((e) =>
                  e.kind === 'changes' && expired.has(e.id) ? { ...e, state: 'expired' as const } : e
                )
              }
            }
            return {
              agentRunning: false,
              agentTurnBase: null,
              agentTurnFiles: {},
              agentTurnEdited: false,
              agentTurnUserEdited: false,
              agentCheckpoints: checkpoints,
              agentLog:
                event.reason === 'complete'
                  ? entries
                  : [...entries, { kind: 'error', id: newId('msg'), text: event.message ?? 'The run stopped.' }]
            }
          }
        }
      })
    },

    clearAgentLog() {
      set({ agentLog: [], agentProposal: null, agentCheckpoints: {}, agentReverts: [] })
    },

    endAgentSession() {
      set({ agentGate: null, agentSessionActive: false, agentTurnBase: null })
    },

    approveProposal(proposal, optionId) {
      set({ agentProposal: null })
      const option = proposal.options.find((o) => o.id === optionId)
      if (!option) return
      set({
        agentGate: {
          approved: {
            approvalId: newId('apr'),
            proposalId: proposal.id,
            option,
            consumed: []
          }
        }
      })
    },

    addAgentPin(pin) {
      const pins = get().agentPins
      if (pins.some((existing) => pinKey(existing) === pinKey(pin))) return
      set({ agentPins: [...pins, pin] })
    },

    removeAgentPin(key) {
      set({ agentPins: get().agentPins.filter((pin) => pinKey(pin) !== key) })
    },

    clearAgentPins() {
      set({ agentPins: [] })
    },

    declineProposal() {
      set({ agentProposal: null })
    },

    revokeApproval() {
      // Back to a gated session with nothing permitted, not to no session at all: the agent is
      // still driving, it just may no longer write.
      if (get().agentGate) set({ agentGate: { approved: null } })
    },

    consumeApproval(index) {
      const gate = get().agentGate
      const current = gate?.approved
      if (!current || current.consumed.includes(index)) return
      set({ agentGate: { approved: { ...current, consumed: [...current.consumed, index] } } })
    },

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

    editAsset(assetId, patch) {
      edit((project) => {
        const asset = findAsset(project, assetId)
        if (!asset) return
        if (patch.name !== undefined) asset.name = patch.name
        if (patch.text !== undefined && asset.kind === 'text') asset.text = patch.text
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
        // Cover or contain, decided by how much of the source cover would crop. A phone video
        // on a landscape timeline keeps under a third of its picture under cover, and arriving
        // as a band out of the middle reads as bay having mangled the clip.
        const layout =
          asset.width && asset.height
            ? placementLayout(tl, asset.width, asset.height)
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

    trimEdit(spec) {
      const project = get().project
      const timeline = activeTimeline(project)
      if (!timeline) return { ok: false, error: 'No timeline is open.' }
      // Planned against the live project and applied to `edit()`'s clone. The plan names items
      // by id and carries absolute values, so it lands identically on the copy — and a refusal
      // never reaches `edit()` at all, so it cannot leave an empty undo step behind.
      const plan = planTrim(project, timeline, spec)
      if (!plan.ok) return plan
      editTimeline((tl) => applyTrimPlan(tl, plan))
      return plan
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
          } else if (asset.kind === 'html') {
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

    setRegionHidden(region, hidden) {
      const current = get().hiddenRegions
      if (current[region] === hidden) return
      set({ hiddenRegions: { ...current, [region]: hidden } })
    },

    setSettingsOpen(open) {
      set({ settingsOpen: open })
    },

    setAutoDownloadModels(on) {
      remember('bay.autoDownloadModels', on ? '1' : '0')
      set({ autoDownloadModels: on })
    },

    setWhisperModel(file) {
      remember('bay.whisperModel', file)
      set({ whisperModel: file })
    },

    setWhisperDownload(download) {
      set({ whisperDownload: download })
    },

    toggleDebugMode() {
      const next = !get().debugMode
      set({ debugMode: next })
      try {
        globalThis.localStorage?.setItem('bay.debugMode', next ? '1' : '0')
      } catch {
        // Not remembered this time; still on for this session.
      }
    },

    toggleRegion(region) {
      const current = get().hiddenRegions
      set({ hiddenRegions: { ...current, [region]: !current[region] } })
    },

    enterProject(project) {
      get().setProject(project)
      set({ screen: 'editor' })
    },

    showHome() {
      // The agent conversation belongs to the project it was about; carrying it onto the next
      // project would put one timeline's proposals in front of another's.
      set({
        screen: 'home',
        agentLog: [],
        agentProposal: null,
        agentGate: null,
        agentPins: [],
        agentSessionActive: false,
        agentTurnBase: null,
        agentTurnFiles: {},
        agentTurnEdited: false,
        agentTurnUserEdited: false,
        agentCheckpoints: {},
        agentReverts: []
      })
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
      const state = get()
      const previous = state.past[state.past.length - 1]
      if (!previous) return
      set({
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future],
        selection: [],
        dirty: previous !== savedProject,
        ...turnMarks(state)
      })
      followReverts(previous)
    },

    redo() {
      const state = get()
      const next = state.future[0]
      if (!next) return
      set({
        project: next,
        past: [...state.past, state.project],
        future: state.future.slice(1),
        selection: [],
        dirty: next !== savedProject,
        ...turnMarks(state)
      })
      followReverts(next)
    },

    markSaved() {
      savedProject = get().project
      set({ dirty: false })
    },

    transact(work) {
      if (txDepth > 0) {
        // Already inside one: join it. Closing here would end the outer group early and
        // split one logical edit across two undo steps, which is the bug this prevents.
        work()
        return
      }
      txBefore = get().project
      txRecorded = false
      txDepth += 1
      try {
        work()
      } finally {
        txDepth -= 1
        const before = txBefore
        txBefore = null
        const recorded = txRecorded
        txRecorded = false
        set((state) => {
          // No history entry for a transaction that recorded nothing, and none if the
          // project came back to the object it started from — an undo step that restores
          // the state you are already in is a control that does nothing.
          if (!recorded || !before || before === state.project) return state
          const past = [...state.past, before]
          if (past.length > HISTORY_LIMIT) past.shift()
          return { past, future: [], dirty: true }
        })
      }
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
