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
  placementLayout,
  normaliseCrop,
  isCropped,
  NO_CROP,
  type Crop,
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
  type TextStyle,
  type Timeline,
  type Track,
  type TrackKind,
  type Transition,
  type TransitionDirection,
  type TransitionKind,
  retimeTimeline
} from '@shared/project'
import type { AgentEntry, AgentEvent, AgentGate, Proposal } from '@shared/agent'
import { pinKey, type Pin } from '@shared/pins'
import { describeChanges } from '@shared/diff'
import { rippleDelete, type RippleDeleteResult } from '@shared/ripple'
import { applyTrimPlan, planTrim, type TrimPlan, type TrimRefusal, type TrimSpec } from '@shared/trim'
import {
  captionAssetName,
  captionLayout,
  captionStyle,
  checkCues,
  type CaptionCue
} from '@shared/captions'
import { applyScriptOps, type ScriptOp } from '@shared/script'

const HISTORY_LIMIT = 100

/** The three regions around the preview that can be hidden. The preview itself cannot. */
export type RegionId = 'side' | 'inspector' | 'timeline'

/** What the window shows: the projects screen, or a project open in the editor. */
export type Screen = 'home' | 'editor'

export type PanelId = 'agent' | 'media' | 'text' | 'templates' | 'effects' | 'export'

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
  /**
   * Which regions are hidden. View state, never project state: it is not saved in the document
   * and never lands on the undo stack — hiding the inspector is not an edit.
   */
  hiddenRegions: Record<RegionId, boolean>
  /**
   * Debug mode: shows tools for reporting problems, such as exporting the agent transcript.
   * A per-machine preference (localStorage), off by default; View → Toggle Debug Mode.
   */
  debugMode: boolean
  /**
   * The projects screen or the editor. At launch this is `home`, and the project in the store
   * is an empty placeholder nobody chose — which is why the agent surface refuses to act on it.
   */
  screen: Screen
  /** Set while the user drags the playhead — playback yields to scrubbing. */
  scrubbing: boolean
  /** Non-blocking messages surfaced in the status bar. */
  toast: { id: number; kind: 'info' | 'error'; text: string } | null
  /**
   * Whether an in-app agent session is driving, and what it has been approved to do.
   *
   * `null` means no session — and therefore no gate, which is the state bay is in when Claude
   * Code drives it over the socket. Session state rather than project state: it must not be
   * saved, must not land on the undo stack, and must not survive a reload, because an approval
   * belongs to the conversation in front of you and one that outlived it would be a standing
   * permission nobody granted.
   */
  agentGate: AgentGate | null
  /**
   * The conversation, oldest first.
   *
   * A flat list rather than a tree of turns: a tool call and the text around it interleave, and
   * grouping them into turns would put the renderer in charge of deciding where a turn ended —
   * a judgement the stream already makes and one the panel would get wrong on a run that errors
   * halfway.
   */
  agentLog: AgentEntry[]
  /** True between `started` and `done`. What the stop button reads. */
  agentRunning: boolean
  /** The proposal waiting on the user, if any. */
  agentProposal: Proposal | null
  /** Whether an in-app agent conversation is running — separate from whether it is gated. */
  agentSessionActive: boolean
  /**
   * "Ask before editing": when on, the agent's writes wait for an approved proposal. Off by
   * default — the agent edits directly, every turn's changes are shown as a diff, and any turn
   * can be reverted. Remembered per machine.
   */
  agentApproval: boolean
  /** The project as it was when the current agent turn started; null between turns. */
  agentTurnBase: Project | null
  /** Before and after for each `changes` entry, by its id — what a revert restores. */
  agentCheckpoints: Record<string, { before: Project; after: Project }>
  /**
   * What the composer's `@` menu has pinned: assets, clips, time ranges. Sticky — they stay
   * until removed, and every message carries them — because "work only in 0:10–0:15" is usually
   * a whole conversation, not one sentence. The timeline draws the pinned ranges on its ruler.
   */
  agentPins: Pin[]
  dirty: boolean
  past: Project[]
  future: Project[]
}

export interface EditorActions {
  // project ------------------------------------------------------------------
  setProject(project: Project, options?: { resetHistory?: boolean }): void
  renameProject(name: string): void
  setCanvasPreset(presetId: string): void
  // agent ---------------------------------------------------------------------
  /** Begin an in-app agent session: from here writes are gated until something is approved. */
  startAgentSession(): void
  /** Append what the user typed, so it reads in order beside the replies. */
  logUserMessage(text: string, pins?: Pin[]): void
  /** Fold one runtime event into the conversation. */
  applyAgentEvent(event: AgentEvent): void
  /** Throw the conversation away. The gate and the session are untouched. */
  clearAgentLog(): void
  /** End it. Writes stop being gated, because nothing in-app is driving any more. */
  endAgentSession(): void
  /**
   * Record that the user approved one option of a proposal. Replaces any previous approval:
   * approving a new plan is not an extension of the old one, and leaving both live would let
   * an agent mix operations from two plans the user considered separately.
   */
  approveProposal(proposal: Proposal, optionId: string): void
  setAgentApproval(on: boolean): void
  /**
   * Put the project back as it was before an agent turn. Undoable, like any edit. If the project
   * has changed since that turn, those later changes go too — the confirmation says so.
   */
  revertAgentChange(id: string): void
  addAgentPin(pin: Pin): void
  removeAgentPin(key: string): void
  clearAgentPins(): void
  /** Turn down the pending proposal. Nothing is approved; the session stays gated. */
  declineProposal(): void
  /** Withdraw approval, leaving the session gated with nothing permitted. */
  revokeApproval(): void
  /**
   * Mark one approved operation as carried out. Called by the executor *after* the tool
   * succeeded, never before: a call that threw changed nothing, and spending the approval on
   * it would block the retry the error message is asking for.
   */
  consumeApproval(index: number): void
  /**
   * Change the timeline's frame rate, moving every clip so it stays at the same wall-clock
   * time. Returns how many clips had to be nudged a frame to keep the order legal, so the UI
   * can say so — a retime that silently moved something is the kind of edit people discover
   * three exports later.
   */
  setFps(fps: number): { nudged: number }

  // assets -------------------------------------------------------------------
  addAssets(assets: Asset[]): void
  removeAsset(assetId: string): void
  /**
   * Change what an asset *is*, for every item that places it: its name, and for a text asset
   * the words it draws. An undoable edit, unlike `patchAsset`, which exists for poster and
   * waveform arrivals that are not edits at all. `text` on a non-text asset is ignored here and
   * refused by the tool, which can say why.
   */
  editAsset(assetId: string, patch: { name?: string; text?: string }): void
  patchAsset(assetId: string, patch: Partial<Asset>): void

  // items --------------------------------------------------------------------
  /** Places an asset at `atFrame`, choosing a track that has room. Returns the new item id. */
  placeAsset(assetId: string, atFrame?: Frames, trackId?: string): string | null
  moveItem(itemId: string, toFrame: Frames, toTrackId?: string): void
  trimItem(itemId: string, edge: 'start' | 'end', toFrame: Frames): void
  /**
   * Slip, slide or roll one clip — see `@shared/trim` for what each keeps still.
   *
   * Returns the plan it applied, or the refusal with the legal range. Unlike `trimItem`, which
   * clamps a drag to what fits, this never clamps: the caller asked for a specific number of
   * frames, and "moved by 12 when you asked for 40" reported as success is a lie. The timeline
   * clamps its gestures *before* calling, using the same planner.
   */
  trimEdit(spec: TrimSpec): TrimPlan | TrimRefusal
  splitAt(frame?: Frames): void
  deleteSelected(): void
  /**
   * Removes a span of timeline and closes the hole, keeping every unlocked track in step.
   *
   * `deleteSelected` lifts and leaves the gap; this one ripples. With no range given it uses
   * the span the selection covers — from the earliest selected frame to the latest — which
   * means selecting two clips with a gap between them removes the gap too. That is what
   * "remove this stretch" means, and the alternative (closing up only the clips and keeping
   * the hole between them) is not an operation anybody wants.
   */
  rippleDelete(fromFrame?: Frames, toFrame?: Frames): RippleDeleteResult | null
  duplicateSelected(): void
  patchItem(itemId: string, patch: Partial<Omit<Item, 'id' | 'trackId'>>): void
  /**
   * Set one of a composition clip's declared variables, on that clip alone.
   *
   * A value equal to the composition's default is **removed** rather than stored. Otherwise a
   * project records every knob the user ever touched and then touched back, and the stored
   * value silently stops tracking the composition when its default changes.
   */
  setCompositionVariable(itemId: string, id: string, value: string | number | boolean): void
  /** Set one edge of a clip's crop, as a fraction of the source. */
  setCrop(itemId: string, edge: keyof Crop, fraction: number): void
  patchLayout(itemId: string, patch: Partial<Layout>): void

  // tracks -------------------------------------------------------------------
  addTrack(kind: TrackKind): string
  removeTrack(trackId: string): void
  patchTrack(trackId: string, patch: Partial<Pick<Track, 'locked' | 'muted' | 'hidden' | 'name'>>): void

  // transitions ---------------------------------------------------------------
  /**
   * Add a transition across the cut between two adjacent items. Returns its id, or a reason
   * it was refused — the caller needs to be able to say *why*, not just that nothing happened.
   *
   * Refuses a pair that is not adjacent rather than storing one that `resolveTransition` will
   * silently drop later. A transition that exists in the project and never draws is the
   * failure this codebase keeps finding; catching it at the write is the only place the
   * caller still has the context to fix it.
   */
  addTransition(spec: {
    fromItemId: string
    toItemId: string
    kind: TransitionKind
    durationInFrames: Frames
    direction?: TransitionDirection
  }): { id: string } | { error: string }
  removeTransition(transitionId: string): void
  /**
   * Apply a diffed script (see `@shared/script`) as one edit. The operations were validated by
   * `diffScript` against this exact timeline; callers wrap this in `transact` like any tool.
   */
  applyScript(timelineId: string, operations: readonly ScriptOp[]): void
  patchTransition(
    transitionId: string,
    patch: Partial<Pick<Transition, 'kind' | 'durationInFrames' | 'direction'>>
  ): void

  // captions ------------------------------------------------------------------
  /**
   * Place caption cues as text items on a new video track above every other, in one undo step.
   *
   * A new track rather than free space on an existing one, because captions must draw over
   * the picture and a track's position in the stack is what decides that; and a dedicated one
   * so that muting, hiding or deleting the captions is one track-level action. Refuses the
   * whole set if any cue is unplaceable — half a caption file is worse than none, because the
   * missing lines are the ones nobody checks.
   *
   * Identical lines share one text asset, since text lives on the asset: a repeated "[music]"
   * is one asset placed many times, not many copies of one string.
   */
  addCaptions(
    cues: readonly CaptionCue[],
    look?: { style?: TextStyle; layout?: Layout }
  ): { trackId: string; trackName: string; itemIds: string[]; assetIds: string[] } | { error: string }

  // markers -----------------------------------------------------------------
  /**
   * Put a marker on the active timeline. Returns its id, or null when there is no timeline.
   * With no label it is numbered, because an unlabelled flag in a row of them is a flag nobody
   * can refer to.
   */
  addMarker(frame: Frames, label?: string, color?: string): string | null
  moveMarker(markerId: string, frame: Frames): void
  removeMarker(markerId: string): void

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
  /** Show or hide one region. */
  setRegionHidden(region: RegionId, hidden: boolean): void
  toggleRegion(region: RegionId): void
  toggleDebugMode(): void
  /** Open a project in the editor: it becomes the document, with fresh history. */
  enterProject(project: Project): void
  /** Back to the projects screen. The caller decides what happens to unsaved work first. */
  showHome(): void
  notify(text: string, kind?: 'info' | 'error'): void
  dismissToast(): void

  // history ------------------------------------------------------------------
  undo(): void
  redo(): void
  markSaved(): void
  /**
   * Run several mutations as one undoable step.
   *
   * Exists because "one edit is one undo step" is a promise the agent surface makes, and
   * some operations need more than one store call to keep it — moving an item to another
   * track is `patchItem` plus `moveItem`, and a ripple delete is a delete plus one move per
   * item after it. Without grouping, `undo` gives back a fraction of what was done, which is
   * worse than not undoing at all: the project is left in a state neither the user nor the
   * agent asked for.
   *
   * Nested calls join the outer transaction rather than closing it. A transaction that
   * changes nothing pushes no entry — an empty undo step is a control that does nothing.
   * If `work` throws, whatever it managed to change is still committed as one entry, so the
   * user can take back a half-finished edit.
   */
  transact(work: () => void): void
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
  /**
   * Open transaction, if any: the project as it stood before it began, plus whether anything
   * inside it has actually asked for a history entry. Depth rather than a boolean so a
   * `transact` inside a `transact` joins the outer one instead of closing it early.
   */
  let txDepth = 0
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
      if (txDepth > 0) {
        // Inside a transaction the mutation lands but the history entry does not: the whole
        // group gets one, pushed on close. Without this, a tool that needs two store calls
        // makes two undo steps and `undo` reverses half of what it did.
        txRecorded = true
        return { project: next, dirty: true }
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
    hiddenRegions: { side: false, inspector: false, timeline: false },
    debugMode: (() => {
      try {
        return globalThis.localStorage?.getItem('bay.debugMode') === '1'
      } catch {
        return false
      }
    })(),
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
    agentCheckpoints: {},
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
      const checkpoint = get().agentCheckpoints[id]
      if (!checkpoint) return
      set((state) => {
        const index = state.agentLog.findIndex((e) => e.kind === 'changes' && e.id === id)
        const past = [...state.past, state.project]
        if (past.length > HISTORY_LIMIT) past.shift()
        return {
          project: checkpoint.before,
          past,
          future: [],
          selection: [],
          dirty: true,
          // This turn and every later one are gone from the timeline now; say so on their cards.
          agentLog: state.agentLog.map((entry, i) =>
            entry.kind === 'changes' && i >= index ? { ...entry, state: 'reverted' as const } : entry
          )
        }
      })
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
            return { agentRunning: true, agentTurnBase: state.agentTurnBase ?? state.project }

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

          case 'tool':
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
            // A turn that changed the project leaves a diff behind, with what a revert needs.
            // Compared by reference first: a turn that only read never pays for the diff.
            const base = state.agentTurnBase
            const lines = base && base !== state.project ? describeChanges(base, state.project) : []
            const changeId = newId('chg')
            const withChanges: AgentEntry[] =
              lines.length > 0 ? [...log, { kind: 'changes', id: changeId, lines, state: 'applied' }] : log
            return {
              agentRunning: false,
              agentTurnBase: null,
              ...(lines.length > 0 && base
                ? { agentCheckpoints: { ...state.agentCheckpoints, [changeId]: { before: base, after: state.project } } }
                : {}),
              agentLog:
                event.reason === 'complete'
                  ? withChanges
                  : [...withChanges, { kind: 'error', id: newId('msg'), text: event.message ?? 'The run stopped.' }]
            }
          }
        }
      })
    },

    clearAgentLog() {
      set({ agentLog: [], agentProposal: null, agentCheckpoints: {} })
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
        agentCheckpoints: {}
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
