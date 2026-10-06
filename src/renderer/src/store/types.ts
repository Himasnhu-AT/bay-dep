/**
 * The editor store's shape: its state and every action, as the UI and the engine see them.
 * Split out of `editor.ts` so the store's behaviour and its contract can be read separately.
 */

import type {
  Asset,
  Crop,
  Frames,
  Item,
  KeyframeProperty,
  Layout,
  Project,
  TextStyle,
  Track,
  TrackKind,
  Transition,
  TransitionDirection,
  KeyframeEase,
  TransitionKind
} from '@shared/project'
import type { BrfCodeMeta, BrfDocument } from '@shared/brf'
import type { CanvasFit } from '@shared/project'
import type { AgentEntry, AgentEvent, AgentGate, Proposal } from '@shared/agent'
import type { Pin } from '@shared/pins'
import type { AgentAttachmentView } from '@shared/agent-attachments'
import type { RippleDeleteResult } from '@shared/ripple'
import type { SwitchSegment } from '@shared/speaker-switch'
import type { OpenSpanResult } from '@shared/insert-edit'
import type { TrackMove } from '@shared/track-move'
import type { TrimPlan, TrimRefusal, TrimSpec } from '@shared/trim'
import type { DetachResult, ReattachResult } from '@shared/links'
import type { BehindSubjectResult, BehindSubjectSpec } from '@shared/behind-subject'
import type { SpeedPlan } from '@shared/speed'
import type { ShapeMask } from '@shared/shape-mask'
import type { AdjustmentLayerResult, AdjustmentLayerSpec } from '@shared/adjustment-layer'
import type { CaptionCue } from '@shared/captions'
import type { ScriptOp } from '@shared/script'
import type { WhisperDownload } from '@shared/whisper'
import type { ClipboardPayload, PasteAttribute } from '@shared/clipboard'
import type { FreezeResult } from '@shared/freeze-frame'
import type { LoudnessTarget } from '@shared/loudness'
import type { AgentCheckpoint, AgentRevert } from './agent-turns'

/** What `placeDub` lays down: lines on one audio track, and what happens to the original sound. */
export interface DubPlacement {
  trackName: string
  clips: readonly { asset: Asset; from: Frames; durationInFrames: Frames; speed: number }[]
  original: { itemIds: readonly string[]; mode: 'duck' | 'mute' | 'keep'; amountDb: number }
}

export interface DubPlaced {
  trackId: string
  trackName: string
  /** The placed lines' item ids, in the order of `clips`. */
  itemIds: string[]
  /** Lines already on the track that a new one replaced. */
  replaced: number
  /** Items whose sound was ducked or muted (a mute is the deepest duck, keyed to the dub track). */
  ducked: string[]
  muted: string[]
  /** Ducks the originals already had that the dub's replaced: the item and the track it ducked under. */
  replacedDucks: { itemId: string; keyTrackId: string; keyTrackName: string }[]
  /** Original items left alone because their track is locked. */
  lockedOriginals: string[]
}

/** The three regions around the preview that can be hidden. The preview itself cannot. */
export type RegionId = 'side' | 'inspector' | 'timeline'

/** What the window shows: the projects screen, or a project open in the editor. */
export type Screen = 'home' | 'editor'

/** `linked: false` edits the one clip named and leaves the clips linked to it where they are. */
export interface LinkOptions {
  linked?: boolean
}

/**
 * A small editor hanging off the timeline for a clip command: Paste Attributes (from ⌥⇧⌘V or
 * the clip menu) and the clip menu's Speed…, at the point the menu was opened.
 */
export type ClipDialog =
  | { kind: 'pasteAttributes' }
  | { kind: 'speed'; itemId: string; x: number; y: number }

export type PanelId = 'agent' | 'media' | 'text' | 'templates' | 'effects' | 'export' | 'transcript'

/**
 * The workspace pages, on DaVinci Resolve's own ⇧-digit keys so its users' hands already know
 * them: Media ⇧2, Edit ⇧4, Color ⇧6, Audio (Resolve's Fairlight) ⇧7, Deliver ⇧8. A page is a
 * layout over the one project, never a mode: switching changes what is shown, not what edits do.
 * Five rather than Resolve's seven on purpose — Cut duplicates Edit here, and Fusion is `.brf`.
 */
export type WorkspacePage = 'media' | 'edit' | 'color' | 'audio' | 'deliver'

export const WORKSPACE_PAGES: readonly WorkspacePage[] = ['media', 'edit', 'color', 'audio', 'deliver']

/**
 * The window's layout mode: `resolve` is the page layout above (library, inspector, timeline, the
 * page bar, the agent as a dock); `ai` puts the agent at the centre with only the viewer and the
 * media pool beside it, and opens everything else on demand (`AiPanel`). Like a page, a mode is
 * a layout over the one project and never changes what an edit does. Remembered per machine
 * (`bay.workspace.layoutMode`); see `store/layoutMode.ts` for the default and how to flip it.
 */
export type LayoutMode = 'resolve' | 'ai'

/**
 * What the AI layout opens on demand. `inspector` and `pages` share the right-hand drawer, so at
 * most one of them is open; the timeline drawer runs along the bottom, independently.
 */
export type AiPanel = 'timeline' | 'inspector' | 'pages'

/** The inspector's tabs, in Resolve's order. `timeline` is what shows with nothing selected. */
export type InspectorTab = 'video' | 'title' | 'audio' | 'effects' | 'transition' | 'color' | 'file' | 'timeline'

/** The library slot's tabs (top-left on the Edit page). */
export type LibraryTab = 'media' | 'effects' | 'index' | 'transcript'

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
  /** Which workspace page is showing. Remembered per machine (`bay.workspace.page`). */
  page: WorkspacePage
  /** Resolve's pages or the agent-first AI layout. Remembered per machine (`bay.workspace.layoutMode`). */
  layoutMode: LayoutMode
  /** Which on-demand panels the AI layout has open. Not remembered: AI mode opens on its three regions. */
  aiPanels: Record<AiPanel, boolean>
  /** The inspector tab last chosen; the inspector falls back when it does not apply. */
  inspectorTab: InspectorTab
  /** The library slot's tab. */
  libraryTab: LibraryTab
  /** The agent dock beside the workspace, available on every page. */
  agentDocked: boolean
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
  /** The Settings dialog. Opened from the top bar, the projects screen, or ⌘,. */
  settingsOpen: boolean
  /**
   * The Preferences page to show when it next opens (`'providers'`, `'agent'`…), or null for
   * wherever it was left. Set by `setSettingsOpen(true, page)`; the dialog reads and clears it.
   */
  settingsPage: string | null
  /**
   * Let a transcription fetch a whisper model when this Mac has none. On by default: the user
   * asked for captions, and a download they can watch and cancel beats an error telling them to
   * go and find a file. Main reaches the network for it only when this says yes.
   */
  autoDownloadModels: boolean
  /** The whisper model chosen in Settings, by file name; null lets bay pick. */
  whisperModel: string | null
  /** The model download in progress (or the last one to fail), pushed from main. */
  whisperDownload: WhisperDownload | null
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
  /** When the model started thinking, if it is thinking now (ms since the epoch); else null. */
  agentThinkingSince: number | null
  /** The project as it was when the current agent turn started; null between turns. */
  agentTurnBase: Project | null
  /**
   * Files the agent rewrote this turn (compositions), with what each held before its first
   * write — null when the file did not exist. A composition rewrite changes the picture without
   * changing the project, so the project diff alone would show nothing to revert.
   */
  agentTurnFiles: Record<string, { before: string | null; after: string }>
  /** Whether the project took a real (non-silent) change during the current turn. */
  agentTurnEdited: boolean
  /** Whether any of those changes came from the user rather than the agent's tool calls. */
  agentTurnUserEdited: boolean
  /** An MCP client on bay's socket (not the agent, not the user) edited during this turn. */
  agentTurnClientEdited: boolean
  /** What each `changes` entry can restore, by its id. Capped at `MAX_AGENT_CHECKPOINTS`. */
  agentCheckpoints: Record<string, AgentCheckpoint>
  /** Every revert still reachable by undo/redo, so the cards follow the project back and forth. */
  agentReverts: AgentRevert[]
  /**
   * Bumped per path when a composition file is rewritten underneath the app (a revert restoring
   * it). The engine drops that composition's cached frames when its count moves.
   */
  compositionEpochs: Record<string, number>
  /**
   * What the composer's `@` menu has pinned: assets, clips, time ranges. Sticky — they stay
   * until removed, and every message carries them — because "work only in 0:10–0:15" is usually
   * a whole conversation, not one sentence. The timeline draws the pinned ranges on its ruler.
   */
  agentPins: Pin[]
  /**
   * The timeline's In and Out points (I / O), in timeline frames, or null when unset. Half-open
   * like `remove_range`: `rangeOut` is the first frame *after* the range. View state — not saved,
   * not undoable. Read by the ruler's shading, Remove Range, Loop Playback and Export's range.
   */
  rangeIn: Frames | null
  rangeOut: Frames | null
  /** Whether timeline drags snap to edges, the playhead, markers and beats (N). Per viewer. */
  snapping: boolean
  /** Whether clicking a linked clip selects its partners too (⇧⌘L). Per viewer; on by default. */
  linkedSelection: boolean
  /** Loop Playback (⌘L): play In→Out (or the whole timeline) over and over. */
  loop: boolean
  /** Clips copied or cut (⌘C / ⌘X), bay's own clipboard. Survives switching projects. */
  clipboard: ClipboardPayload | null
  clipDialog: ClipDialog | null
  dirty: boolean
  past: Project[]
  future: Project[]
}

export interface EditorActions {
  // project ------------------------------------------------------------------
  setProject(project: Project, options?: { resetHistory?: boolean }): void
  renameProject(name: string): void
  /** A named canvas size, refitting clips the way `resizeCanvas` (and `set_canvas`) does. */
  setCanvasPreset(presetId: string, fit?: CanvasFit): { refitted: number } | { error: string }
  /** The colour shown wherever no video covers the canvas. `#RRGGBB`. */
  setBackground(color: string): void
  /**
   * Remember (a target) or forget (null) the loudness the last mastered export of a timeline used
   * (`Timeline.delivery`). Keyed by project and timeline id because an export finishes minutes
   * after it started, when another project or timeline may be open; a mismatch does nothing.
   * Not an undo step (past and future are left alone), but it marks the document dirty.
   */
  rememberDelivery(projectId: string, timelineId: string, loudness: LoudnessTarget | null): void
  // agent ---------------------------------------------------------------------
  /** Begin an in-app agent session: from here writes are gated until something is approved. */
  startAgentSession(): void
  /** Append what the user typed, so it reads in order beside the replies. */
  logUserMessage(text: string, pins?: Pin[], attachments?: AgentAttachmentView[]): void
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
  /** An agent tool rewrote a file this turn; remember what it held first so a revert can restore it. */
  recordAgentFileWrite(path: string, before: string | null, after: string): void
  /** A composition file changed on disk; cached frames of it are stale. */
  markCompositionChanged(path: string): void
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
   * refused by the tool, which can say why. `brf` replaces a motion asset's document, and with it
   * the duration, size and variables it declares.
   */
  editAsset(
    assetId: string,
    patch: { name?: string; text?: string; brf?: BrfDocument; brfCode?: { source: string; meta: BrfCodeMeta } }
  ): void
  patchAsset(assetId: string, patch: Partial<Asset>): void
  /**
   * Point missing assets at the files where they are now (`@shared/relink`): each is replaced by
   * its freshly probed asset, keeping its name and date, and every item that placed it follows.
   * One undoable edit however many were relinked.
   */
  relinkAssets(relinks: { assetId: string; replacement: Asset }[]): void

  // items --------------------------------------------------------------------
  /**
   * Places an asset at `atFrame` (the playhead when omitted) on a track with room and returns the
   * new item id. `trackId` is the lane it was aimed at: used when it is the right kind and free
   * there, otherwise the nearest track that is (a new one if none) — placement never overlaps
   * (`placementTrack`). `span` places only that part of the source, at that length.
   */
  placeAsset(
    assetId: string,
    atFrame?: Frames,
    trackId?: string,
    span?: { sourceStartUs: number; durationInFrames: Frames }
  ): string | null
  /**
   * Moves a clip, and everything linked to it (`@shared/links`) by the same number of frames on
   * their own tracks — unless `linked: false`. Refuses the whole move, silently like every
   * mutator here, if any linked clip is locked, would collide or would start before frame 0.
   */
  moveItem(itemId: string, toFrame: Frames, toTrackId?: string, options?: LinkOptions): void
  /** Trims one edge; linked clips' same edge moves by the same frames unless `linked: false`. */
  trimItem(itemId: string, edge: 'start' | 'end', toFrame: Frames, options?: LinkOptions): void
  /**
   * Slip, slide or roll one clip — see `@shared/trim` for what each keeps still.
   *
   * Returns the plan it applied, or the refusal with the legal range. Unlike `trimItem`, which
   * clamps a drag to what fits, this never clamps: the caller asked for a specific number of
   * frames, and "moved by 12 when you asked for 40" reported as success is a lie. The timeline
   * clamps its gestures *before* calling, using the same planner.
   */
  trimEdit(spec: TrimSpec, options?: LinkOptions): TrimPlan | TrimRefusal
  /** Splits the selection (or everything at the frame); a selected clip's linked clips split too. */
  splitAt(frame?: Frames, options?: { allTracks?: boolean }): void
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
  /**
   * Several ripple deletes as one edit and one undo step, applied last-first so each range's
   * frames still mean what they meant before any was removed. Ranges are half-open
   * `[fromFrame, toFrame)` and must not overlap. The results are summed; `removedFrames` is the total.
   */
  rippleDeleteRanges(ranges: readonly { fromFrame: Frames; toFrame: Frames }[]): RippleDeleteResult | null
  duplicateSelected(): void
  /**
   * Sets fields on one item. The sync fields — `from`, `durationInFrames`, `sourceStartUs`,
   * `speed` — move linked clips by the same amount unless `linked: false`; everything else is the
   * item's own.
   */
  patchItem(itemId: string, patch: Partial<Omit<Item, 'id' | 'trackId'>>, options?: LinkOptions): void
  /**
   * Changes a clip's speed so it plays the same footage (`@shared/speed`): its length changes, is
   * clamped to the footage, and stops at the next clip unless `ripple` moves later clips.
   * `edit_item({ speed })` runs the same plan. Returns what it did, or null for no such clip.
   */
  setClipSpeed(itemId: string, speed: number, options?: { ripple?: boolean }): SpeedPlan | null
  /** "Detach audio": each clip's sound onto a linked audio item (`@shared/links`). */
  detachAudio(itemIds: string[], trackId?: string): DetachResult
  /** The reverse: the picture sounds again and its linked audio item is removed. */
  reattachAudio(itemIds: string[]): ReattachResult
  /** Breaks the links of these clips and their partners. Returns the ids that were linked. */
  unlinkItems(itemIds: string[]): string[]
  /**
   * "Text behind the subject" (`@shared/behind-subject`): the clip, then the title (moved above the
   * clip if it was under it), then a linked, silent cut-out copy of the clip with a subject mask, in
   * one undo step. The subject matte itself is the caller's to compute and record first
   * (`put_behind_subject`). Returns what it made, or why not.
   */
  putBehindSubject(spec: BehindSubjectSpec): BehindSubjectResult
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
  /**
   * Put a key on one property at an item-relative frame — replacing one already there — or, with
   * `value` null, remove the key at that frame. The inspector's diamond and auto-key both land here.
   */
  setKeyframe(itemId: string, property: KeyframeProperty, frame: Frames, value: number | null): void
  /**
   * Replace a clip's shape masks (`@shared/shape-mask`: rect, ellipse, path), in list order; an
   * empty list removes them. A subject mask the clip already has stays first. Aimed at a subject
   * cut-out, it lands on the cut-out's clip, whose picture the cut-out draws. A list that fails
   * `checkMasks` changes nothing.
   */
  setShapeMasks(itemId: string, masks: ShapeMask[]): void
  /**
   * "Add adjustment layer" (`@shared/adjustment-layer`): a clip with no picture of its own whose
   * grade, adjustments and masks apply to everything drawn under it. The asset (one per project)
   * and the item are one undo step, and the new layer is selected. With no span given it covers
   * the selected clips, or starts at the playhead; with no track, it goes above everything.
   * Returns what it made, or why not.
   */
  addAdjustmentLayer(spec?: Partial<AdjustmentLayerSpec>): AdjustmentLayerResult

  // editing verbs (slices/editing.ts) ---------------------------------------------
  /** Copy the selected clips (with linked partners when linked selection is on). Returns how many. */
  copySelection(): number
  /** Copy, then lift the selection. */
  cutSelection(): void
  /**
   * Paste the clipboard with its earliest clip at `at` (default: the playhead), each clip on the
   * track it came from or the next free one of its kind. Selects what it pasted.
   */
  paste(at?: Frames, trackId?: string): string[]
  /** Give the selected clips the chosen attributes of the first copied clip. One undo step. */
  pasteAttributes(attributes: readonly PasteAttribute[]): number
  /** Switch clips off (or back on): all off if any is on. Defaults to the selection. */
  toggleDisabled(itemIds?: string[]): void
  /**
   * Switch exactly these clips on or off — not their linked partners, which a caller expands to
   * if it means to. Locked tracks are skipped. Returns the ids whose state changed. One undo step.
   */
  setItemsEnabled(itemIds: readonly string[], enabled: boolean): string[]
  /**
   * Apply a speaker switch: razor each angle (`itemIds[i]` is angle i; the wide, if any, is last)
   * where it goes on or off screen and disable the off pieces (`applyAngleSwitch`,
   * `@shared/speaker-switch`). One undo step.
   */
  applyAngleSwitch(itemIds: readonly string[], segments: readonly SwitchSegment[]): { createdItemIds: string[]; disabledItemIds: string[] }
  /** Move the selection by `delta` frames, refusing (with a toast naming the blocker) if blocked. */
  nudgeSelection(delta: Frames): boolean
  /**
   * Move clips to new frames and tracks together — a multi-clip drag across lanes, planned by
   * `planTrackShift` (`@shared/track-move`). All or none, one undo step; a refusal is returned.
   */
  moveItemsToTracks(moves: readonly TrackMove[]): { ok: true } | { error: string }
  /** Close the gap containing `frame` on one track — see `planCloseGap` in `@shared/editing`. */
  closeGapAt(trackId: string, frame: Frames): { closedFrames: number; from: Frames; to: Frames } | { error: string }
  /**
   * Trim the clips under the playhead (selected ones, or all on unlocked tracks) so their start or
   * end is the playhead. `ripple` also closes the gap that leaves on each clip's track.
   */
  trimToPlayhead(edge: 'start' | 'end', ripple: boolean): void
  /** Remove In→Out across every unlocked track and close it up: the `remove_range` tool's path. */
  removeInOutRange(): void
  /**
   * Make room for a source clip of `frames` at `atFrame`: `insert` opens the time on every
   * unlocked track (later clips slide right, sync kept); `overwrite` clears it on `trackId` only
   * and moves nothing. Places nothing — the caller places into the room inside one `transact`.
   * `null` when refused (the reason is toasted).
   */
  openSpan(atFrame: Frames, frames: Frames, mode: 'insert' | 'overwrite', trackId?: string): OpenSpanResult | null
  setClipDialog(dialog: ClipDialog | null): void
  /**
   * Insert a still of `still` (already imported) at `frame` of `itemId`, opening that much time on
   * every unlocked track, and add the asset — one undo step. See `@shared/freeze-frame`.
   */
  insertFreezeFrame(spec: { itemId: string; frame: Frames; frames: Frames; still: Asset }): FreezeResult | { error: string }

  // tracks -------------------------------------------------------------------
  /**
   * A new empty track, named next in its kind. `index` is its place in `timeline.tracks` — the
   * array, not the display: video draws in array order (later on top), so a video track "above
   * V1" goes after it. Absent appends, which puts a new video track on top of the picture.
   */
  addTrack(kind: TrackKind, index?: number): string
  removeTrack(trackId: string): void
  patchTrack(trackId: string, patch: Partial<Pick<Track, 'locked' | 'muted' | 'hidden' | 'name' | 'solo' | 'volume' | 'pan'>>): void

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
    /** Absent is linear. */
    ease?: KeyframeEase
  }): { id: string } | { error: string }
  removeTransition(transitionId: string): void
  /**
   * Apply a diffed script (see `@shared/script`) as one edit. The operations were validated by
   * `diffScript` against this exact timeline; callers wrap this in `transact` like any tool.
   */
  applyScript(timelineId: string, operations: readonly ScriptOp[]): void
  patchTransition(
    transitionId: string,
    patch: Partial<Pick<Transition, 'kind' | 'durationInFrames' | 'direction' | 'ease'>>
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
  /**
   * Put a clip's generated subtitles (a composition, see `@shared/subtitles`) over it on the
   * "Subtitles" track, replacing subtitles already over that clip — choosing another design swaps
   * the file rather than stacking two. One undo step.
   */
  placeSubtitles(sourceItemId: string, asset: Asset): { itemId: string; trackName: string; replaced: number } | { error: string }
  /**
   * Put a dub's generated lines (`@shared/dub`) on the audio track named `trackName` (made if
   * missing), each at its frame and speed, replacing lines already on that track where a new one
   * lands; then duck or mute the original dialogue — the clips named, or the audio items their
   * sound was detached onto — under that track. Assets not yet in the project are added. One undo
   * step. Refused, changing nothing, when the dub track is locked.
   */
  placeDub(spec: DubPlacement): DubPlaced | { error: string }
  /**
   * Change the canvas and re-fit what was fitted to the old one: video and images by `fit`
   * (`auto` picks cover or contain the way placement does), compositions to the full frame, text
   * kept at the same place in proportion. One undo step.
   */
  resizeCanvas(width: number, height: number, fit: CanvasFit): { refitted: number } | { error: string }
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
  /** Rename or recolour a marker. An empty label is refused; a null colour returns to the default. */
  patchMarker(markerId: string, patch: { label?: string; color?: string | null }): void

  // review comments -----------------------------------------------------------
  /**
   * Leave a review comment on the active timeline. Returns its id, or null when there is no
   * timeline or the text is empty. `endFrame` (exclusive, > frame) makes it about a span.
   */
  addComment(frame: Frames, text: string, options?: { endFrame?: Frames; author?: 'user' | 'agent' }): string | null
  /**
   * Change a comment's words, place or state. Empty text is ignored; `endFrame: null` makes it
   * a moment again; `resolved: false` reopens it and drops the resolution note.
   */
  editComment(commentId: string, patch: { text?: string; frame?: Frames; endFrame?: Frames | null; resolved?: boolean }): void
  /** Mark a comment done, with what was done about it. */
  resolveComment(commentId: string, note?: string): void
  removeComment(commentId: string): void

  // selection / view ---------------------------------------------------------
  select(itemIds: string[], additive?: boolean): void
  clearSelection(): void
  setPlayhead(frame: Frames): void
  nudgePlayhead(deltaFrames: Frames): void
  setPlaying(playing: boolean): void
  togglePlay(): void
  setScrubbing(scrubbing: boolean): void
  /** Set In (null clears it). An In at or after Out clears Out. */
  setRangeIn(frame: Frames | null): void
  /** Set Out, exclusive (null clears it). An Out at or before In clears In. */
  setRangeOut(frame: Frames | null): void
  clearRange(): void
  setSnapping(on: boolean): void
  toggleSnapping(): void
  toggleLinkedSelection(): void
  toggleLoop(): void
  setPixelsPerFrame(pixelsPerFrame: number): void
  zoomBy(factor: number): void
  setPanel(panel: PanelId): void
  setPage(page: WorkspacePage): void
  /** Switch layout mode (remembered). Entering either mode starts with the AI drawers closed. */
  setLayoutMode(mode: LayoutMode): void
  toggleLayoutMode(): void
  /** Open or close one AI-layout panel; opening `inspector` closes `pages` and vice versa. */
  setAiPanel(panel: AiPanel, open: boolean): void
  toggleAiPanel(panel: AiPanel): void
  closeAiPanels(): void
  setInspectorTab(tab: InspectorTab): void
  setLibraryTab(tab: LibraryTab): void
  setAgentDocked(docked: boolean): void
  /** Show or hide one region. */
  setRegionHidden(region: RegionId, hidden: boolean): void
  toggleRegion(region: RegionId): void
  toggleDebugMode(): void
  setSettingsOpen(open: boolean, page?: string): void
  setAutoDownloadModels(on: boolean): void
  setWhisperModel(file: string | null): void
  setWhisperDownload(download: WhisperDownload | null): void
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
   * Save As wrote the document to `filePath` under `name`: the open project, and every snapshot
   * in its history, now belong to that file — so ⌘S after Save As writes the new file, and an
   * undo does not hand the old path back. Not an edit; marks the document saved.
   */
  markSavedAs(filePath: string, name: string): void
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
  /**
   * `transact` for a pointer gesture: the edits between `beginGesture` and `endGesture` land
   * live (the preview draws each one) and are one undo step. A drag spans many events, so it
   * cannot be one callback. Every `beginGesture` must be paired — end it on pointerup, cancel
   * and lost capture — or history stops recording.
   */
  beginGesture(): void
  endGesture(): void
}

export type EditorStore = EditorState & EditorActions
