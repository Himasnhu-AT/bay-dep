# Subsystem map — web → native Rust

> Every web subsystem inventoried by the audit team, mapped to a native Rust implementation with crates, data structures, risks, and test cases. Reference material for the phase plans; task IDs live in **[task.md](task.md)**.
> 6 clusters · 64 subsystems.

## Editor core & state model
CROSS-CUTTING NATIVE ARCHITECTURE (opencut-core): (1) The Command enum IS the MCP surface. Every TS command class (~45 in apps/web/src/commands/**) and every TimelineManager/ScenesManager/ProjectManager dispatch method becomes a serde-tagged Command or Query variant; Editor::execute(Command)->CommandResult and Editor::query(Query)->QueryResult are the two MCP entry points. This gives undo/redo, autosave-dirty, and MCP for free from one dispatch path. (2) Singleton -> owned Editor. Replace EditorCore.getInstance() (a process-global that commands reach into at execute() time) with a caller-owned Editor struct; commands become pure (&mut EditorState)->CommandResult. This is the single biggest porting risk: TS managers hold &-refs to each other and mutate inside each other's notify() cycle, which Rust's borrow checker forbids. Resolution: centralize ALL mutable state in one EditorState and make the 12 'managers' stateless modules/impls over &mut EditorState + a Ctx, NOT 12 independently-locked objects (Arc<RwLock<Manager>>-per-manager invites deadlocks given the dense cross-references). (3) imbl persistent Vectors for SceneTracks/element/scene lists: almost every TS command undoes by restoring a captured whole-SceneTracks 'savedState' snapshot, and the live-drag previewOverlay merges patches over committed tracks every frame — persistent structures make both O(1)-clone with structural sharing instead of deep copies. (imbl v7 is the maintained fork; im/im-rc and rpds are alternatives — imbl chosen for Arc thread-safety + active maintenance.) (4) Reactivity: the nine-manager useSyncExternalStore bridge (subscribe-all + shallow-array-equality selector memoization) collapses into a coalesced EventBus: per-domain version counters + a DomainFlags bitflags emitted ONCE per committed command over tokio::sync::broadcast. The shallow-equality memoization is a UI concern that moves into the GPUI shell; MCP consumes coalesced change-notifications. (5) Clock injection: PlaybackManager's RAF/performance.now() becomes an injectable Clock so headless/MCP mode steps deterministically while the GPUI shell (or, ideally, the audio device clock) drives real time. (6) Reuse rust/crates/time for all MediaTime math (roundFrameTime/mediaTimeFromSeconds/clampMediaTime) to guarantee bit-parity with the web.

CLUSTER BOUNDARIES: several managers are thin state/orchestration shells over work owned by OTHER clusters — flagged per-subsystem to avoid double-implementing. Persistence/IndexedDB/OPFS + the 31-step migration chain (SaveManager/ProjectManager/ScenesManager call into it) = persistence cluster. Compositor/render-tree build + encode (RendererManager, thumbnails) = compositor/export cluster. Media decode/thumbnail/waveform + Web Audio decode (MediaManager, AudioManager) = media cluster. Placement/snapping/ripple-diff engines (invoked by insert/move/paste commands) = timeline-editing cluster. Animation sampling (keyframe pre-sample on delete, gain automation) = animation cluster.

EFFORT RANKING (this cluster): TimelineManager and AudioManager are the two 1-2 month efforts (largest surface / near-total rewrite respectively). Command+undo/redo and ProjectManager/ScenesManager are the 2-4 week core. SelectionManager, ClipboardManager, SaveManager, DiagnosticsManager are pure-logic days-scale ports and are the ideal first-landing slices to validate the owned-Editor + Command-enum + EventBus architecture before tackling the timeline/audio bulk.

RECOMMENDED CRATES (validated on crates.io Aug 2026): imbl (persistent structures), serde/serde_json (Command/Query + persistence + MCP), uuid, chrono, bitflags, tokio (broadcast/timers for events+autosave), arc-swap (lock-free snapshot reads), tracing/thiserror. For undo plumbing the `undo` crate (Record/History, command-pattern Edit trait) is usable but a hand-rolled Vec<HistoryEntry> maps the selectionOverride 'restore-only-when-declared' nuance and the ripple-inside-execute pass more directly. Audio: cpal (output), symphonia (decode), rubato (resample), rtrb (lock-free ring buffer to the callback), dasp (sample utils).

#### EditorCore singleton & lifecycle  `1-2 weeks`
**Web:** `apps/web/src/core/index.ts`, `apps/web/src/components/providers/editor-provider.tsx`, `apps/web/src/editor/use-editor.ts`
**Browser deps:** `Module-level singleton (browser tab lifetime)`, `EditorProvider ties creation to React mount and calls initializeGpuRenderer() / setDegraded()`
**Depends on:** Command pattern & undo/redo, Observable/subscription reactivity model, TimelineManager (mutation & query surface), ScenesManager, ProjectManager

**Features**
- Singleton getInstance()/reset() (reset is for test isolation)
- Constructs 12 managers in a fixed order (command FIRST because all mutations route through it)
- Constructor side-effects: registerDefaultEffects(), registerDefaultMasks(), registerTranscriptionDiagnostics()
- Wires playback.bindTimelineScope()
- Registers the 'prune empty overlay/audio tracks' reactor into the command manager
- Starts autosave (save.start())
- Managers cross-reference each other via a back-pointer (this.editor.<manager>)

**Native approach** — crates: `thiserror`, `tracing`
Replace the process-global singleton with an owned `Editor` struct the caller (MCP server / GPUI shell) constructs once and owns. Because the 12 managers freely reach across each other (this.editor.<x>), do NOT model them as 12 independently-borrowable objects. Instead centralize all mutable state in one `EditorState` and make each 'manager' a stateless module of free functions (or an impl block) taking `&mut EditorState` plus a `Ctx`. Construction registers default effect/mask definitions into registries held by EditorState and installs reactors. `reset()` becomes drop-and-recreate. This owned model is what the command/query MCP surface dispatches against.

_Data structures:_ `struct Editor { state: EditorState, history: History, events: EventBus }`, `struct EditorState { project: ProjectState, scenes: ScenesState, timeline: TimelineState, playback: PlaybackState, selection: SelectionState, clipboard: ClipboardState, media: MediaState, renderer: RendererState, diagnostics: Vec<Diagnostic>, save: SaveState, effect_registry, mask_registry }`, `struct Ctx<'a> { events: &'a EventBus, clock: &'a dyn Clock }`

_Risks:_
- The #1 architectural risk of the whole cluster: TS managers hold mutable references to each other and mutate inside each other's notify() cycle; Rust's borrow checker forbids simultaneous &mut aliasing. Central-state + stateless-modules avoids Arc<RwLock<..>>-per-manager deadlocks but requires reworking every call site that does this.editor.<a>.mutate() from inside this.editor.<b>.
- Construction ordering constraints (command must exist before managers that dispatch through it) must be preserved.

**Test cases**
- `core-construct` _(unit)_ — Editor::new() registers default effects/masks and installs the empty-track pruning reactor; a fresh editor has an empty history and a valid main scene
- `core-reset` _(unit)_ — Drop+recreate yields independent state (no shared history/selection leakage) — parity with EditorCore.reset() test contract

---

#### Command pattern & undo/redo  `2-4 weeks`
**Web:** `apps/web/src/core/managers/commands.ts`, `apps/web/src/commands/base-command.ts`, `apps/web/src/commands/batch-command.ts`, `apps/web/src/commands/index.ts`, `apps/web/src/commands/timeline/tracks-snapshot.ts`, `apps/web/src/commands/timeline/element/update-elements.ts`, `apps/web/src/commands/timeline/element/insert-element.ts`, `apps/web/src/commands/timeline/**`, `apps/web/src/commands/scene/**`, `apps/web/src/commands/project/**`, `apps/web/src/commands/media/**`, `apps/web/src/commands/preview-tracker.ts`
**Browser deps:** `structuredClone (preview-tracker.ts)`, `Commands re-fetch EditorCore.getInstance() internally at execute() time`
**Depends on:** TimelineManager (mutation & query surface), ScenesManager, SelectionManager, Observable/subscription reactivity model

**Features**
- execute({command}): snapshot selection -> command.execute() -> optional ripple pass -> apply CommandResult.selection patch -> run reactors -> push history entry -> clear redo
- push({command}): history push WITHOUT executing (used by commitPreview which already applied the change)
- undo(): pop, command.undo(), restore selection ONLY when the entry declared a selectionOverride (preserves UI-driven selection made between commands), push to redo
- redo(): re-run entry.command.redo() with fresh ripple + selection override + reactors
- canUndo/canRedo/clear/registerReactor
- BatchCommand: groups N commands into one undo step; undo in reverse; selection = last child that emitted one
- CommandResult.selection is an EditorSelectionPatch; createElementSelectionResult helper
- Command.redo() defaults to execute(); Command.undo() default throws
- Ripple auto-applied after any command when isRippleEnabled (diff before/after SceneTracks, shift downstream, write back via updateTracks)
- ~45 concrete command classes; nearly all undo by restoring a captured whole-SceneTracks savedState snapshot
- PreviewTracker<T>: structuredClone snapshot helper for live-drag begin/end

**Native approach** — crates: `imbl`, `serde`, `serde_json`, `uuid`
Model commands as a serde-tagged `Command` enum (one variant per current command class) so the SAME type is the MCP call surface: MCP `tools/call name=insert_element args={...}` deserializes into Command::InsertElement and Editor::execute dispatches it. Execution takes `&mut EditorState` + `&Ctx` (invert the TS pattern where commands reach the singleton). Because the overwhelming majority of TS commands undo by restoring a full SceneTracks snapshot, back SceneTracks with imbl persistent Vectors so each snapshot clone is O(1) pointer+refcount rather than a deep copy — this is what makes per-command savedState affordable. History mirrors CommandHistoryEntry exactly. Consider the `undo` crate's Record/History for the stack plumbing, but a hand-rolled Vec<HistoryEntry> maps the selectionOverride nuance more directly.

_Data structures:_ `enum Command { AddTrack{..}, InsertElement{..}, UpdateElements{updates:Vec<ElementUpdate>}, MoveElement{..}, SplitElements{..}, TracksSnapshot{before,after}, UpsertKeyframe{..}, AddClipEffect{..}, ApplyMotionPreset{..}, CreateScene{..}, ToggleBookmark{..}, UpdateProjectSettings{..}, RemoveMediaAsset{..}, Batch(Vec<Command>), ... }`, `struct HistoryEntry { command: Command, prev_selection: SelectionSnapshot, selection_override: Option<SelectionSnapshot>, inverse: Inverse }`, `enum Inverse { Tracks(SceneTracks), Settings(ProjectSettings), Scenes(Vector<Scene>), None }`, `struct History { undo: Vec<HistoryEntry>, redo: Vec<HistoryEntry>, reactors: Vec<Box<dyn Fn(&mut EditorState)>>, ripple_enabled: bool }`

_Risks:_
- selectionOverride semantics: undo must NOT touch selection unless the command declared an override at execute time — easy to regress into 'always restore', which breaks between-command UI selection.
- Ripple runs inside execute AND redo and re-enters updateTracks — ordering and idempotency must be preserved so a ripple isn't double-applied.
- BatchCommand selection = last child emitting a patch; undo must reverse child order.
- TS commands mutate global state as a side effect of execute(); the enum-dispatch rewrite must make every command a pure `(&mut EditorState) -> CommandResult` with no hidden singleton access.
- Persistent-structure memory: deep undo stacks retain many SceneTracks versions — bound history length or use structural sharing (imbl) to keep it flat.

**Test cases**
- `cmd-roundtrip` _(golden)_ — For each command variant: execute then undo restores the pre-execute SceneTracks/Project state byte-for-byte (serde_json golden)
- `cmd-undo-redo-invariant` _(property)_ — Random sequences of commands: after k undos + k redos, EditorState equals the state after the original k executes
- `cmd-selection-override` _(unit)_ — undo restores selection iff the command declared selectionOverride; commands without it leave a manually-changed selection untouched
- `cmd-batch-reverse` _(unit)_ — BatchCommand.undo reverses child order; selection result = last child that emitted a patch
- `cmd-ripple` _(golden)_ — With ripple enabled, execute shifts downstream elements identically to computeRippleAdjustments/applyRippleAdjustments; disabled => no shift
- `cmd-history-perf` _(perf)_ — 1000 UpdateElements on a 500-element timeline: execute+undo p99 latency and total resident memory (imbl snapshots) vs a Vec-clone baseline

---

#### Observable/subscription reactivity model  `1-2 weeks`
**Web:** `apps/web/src/editor/use-editor.ts`, `apps/web/src/core/managers/commands.ts`, `apps/web/src/core/managers/timeline-manager.ts`, `apps/web/src/core/managers/scenes-manager.ts`
**Browser deps:** `React useSyncExternalStore / useMemo / useRef / useCallback`, `Synchronous notify()->re-render inside the mutation call stack`
**Depends on:** EditorCore singleton & lifecycle

**Features**
- Every manager IS an observable external store: private Set<listener>, subscribe(fn)->unsub, private notify()
- No central store — state is distributed across managers
- useEditor(): returns singleton (no subscription)
- useEditor(selector): subscribes to NINE managers (playback, timeline, scenes, project, media, renderer, selection, clipboard, diagnostics — NOT command/save/audio), runs selector in getSnapshot, memoizes with shallow-array equality (isShallowEqual) so stable-ref arrays don't re-render
- useSyncExternalStore bridge; any manager notify() re-evaluates every selector, equality check prevents render storms

**Native approach** — crates: `bitflags`, `tokio (sync::broadcast)`, `arc-swap`
Collapse the 9 per-manager listener sets into one coalesced event/version model on the core. Each mutation bumps a monotonic per-domain version and marks a DomainFlags bit; the core emits a coalesced EditorEvent{changed: DomainFlags, versions} on a broadcast channel that the GPUI shell, MCP change-notifications, and SaveManager subscribe to. The shallow-array-equality memoization is NOT a core concern — it moves into the GPUI UI shell (GPUI Models/entities re-derive on the domains they care about). Core exposes pull-based `version(domain)->u64` for cheap diffing and push-based `subscribe()->Receiver<EditorEvent>`. Decide sync vs async delivery: prefer collecting changed-domain flags during a command and emitting ONE event at end of execute() (matches how a command produces one logical change), rather than per-notify().

_Data structures:_ `bitflags! DomainFlags { PLAYBACK, TIMELINE, SCENES, PROJECT, MEDIA, RENDERER, SELECTION, CLIPBOARD, DIAGNOSTICS }`, `struct EventBus { tx: broadcast::Sender<EditorEvent>, versions: [AtomicU64; N] }`, `struct EditorEvent { changed: DomainFlags }`

_Risks:_
- TS delivers notify() synchronously mid-mutation; a broadcast channel is async — must guarantee ordering and that SaveManager/UI never observe a torn intermediate state (emit after command commit).
- Feedback loops: the empty-track-pruning reactor and ripple mutate inside the change cycle — event emission must be post-reactor to avoid infinite loops.
- MCP wants coalesced notifications, not one-per-notify() storm — coalesce per command.

**Test cases**
- `obs-domain-flags` _(unit)_ — A timeline mutation marks TIMELINE (and SCENES via updateSceneTracks) but not e.g. PLAYBACK; version counter increments once per command
- `obs-coalesce` _(unit)_ — A BatchCommand of N edits emits exactly one coalesced EditorEvent
- `obs-no-loss` _(property)_ — Under M subscribers and K commands, every subscriber observes K events with monotonic versions and no gaps
- `obs-throughput` _(perf)_ — Notify/emit throughput for a 60fps drag (previewElements) vs the TS notify() baseline

---

#### TimelineManager (mutation & query surface)  `1-2 months`
**Web:** `apps/web/src/core/managers/timeline-manager.ts`, `apps/web/src/timeline/track-element-update.ts`, `apps/web/src/timeline/update-pipeline.ts`, `apps/web/src/timeline/types.ts`, `apps/web/src/commands/timeline/element/**`, `apps/web/src/commands/timeline/track/**`
**Browser deps:** `None in the manager itself (pure logic); structuredClone via PreviewTracker in the preview path`
**Depends on:** Command pattern & undo/redo, ScenesManager, PlaybackManager (playback clock), SelectionManager

**Features**
- Primary command-dispatch surface: addTrack/removeTrack, insertElement, updateElementTrim, updateElementRetime, moveElements, splitElements, deleteElements, duplicateElements, toggleTrackMute/Visibility, toggleElementsVisibility/Muted, updateElements(pushHistory?)
- Clip effects: addClipEffect, removeClipEffect, updateClipEffectParams(pushHistory?), toggleClipEffect, reorderClipEffects; applyMotionPreset
- Masks: removeMask, toggleMaskInverted, insert/deleteFreeformPathMaskPoints
- Keyframes: upsertKeyframes, removeKeyframes (pre-samples playhead value so 'what you see is what you get' when all keys deleted), retimeKeyframe, updateKeyframeCurves, upsert/removeEffectParamKeyframe — multi-keyframe edits wrapped in BatchCommand
- Query methods: getTotalDuration, getLastFrameTime, getTrackById, getElementsWithTracks, getPreviewTracks, getElementByRef, findTrackIdForElement
- Live drag preview WITHOUT history: previewElements/commitPreview/discardPreview maintain a previewOverlay (Map<elementId, Partial>) merged over committed tracks; commit writes a single TracksSnapshotCommand via command.push()
- updateTracks(): the single write hub — clears preview overlay, calls scenes.updateSceneTracks, notify()
- TimelineDragSource state holder

**Native approach** — crates: `imbl`, `uuid`, `serde`
This maps almost 1:1 onto the Command enum + query functions and is the richest slice of the MCP verb surface. Keep the thin dispatch methods as typed constructors of Command variants. previewOverlay = HashMap<ElementId, ElementPatch> merged into a derived preview_tracks; commit produces ONE TracksSnapshot command. Query fns are pure over &SceneTracks. Back element/track lists with imbl::Vector so previewElements can rebuild the overlay cheaply each drag frame and so per-command snapshots are cheap.

_Data structures:_ `struct SceneTracks { overlay: Vector<OverlayTrack>, main: VideoTrack, audio: Vector<AudioTrack> }`, `enum TimelineElement { Video(..), Image(..), Text(..), Sticker(..), Graphic(..), Effect(..), Audio(..) } each with BaseTimelineElement{ id, name, duration: MediaTime, start_time, trim_start, trim_end, source_duration?, animations?, params }`, `struct ElementPatch { start_time: Option<MediaTime>, duration: Option<MediaTime>, trim_start: Option<MediaTime>, trim_end: Option<MediaTime>, retime: Option<Option<RetimeConfig>>, hidden: Option<bool>, params_patch: Map<..>, ... } (typed sparse patch replacing Partial<TimelineElement>)`, `struct PreviewOverlay(HashMap<Uuid, ElementPatch>)`

_Risks:_
- Partial<TimelineElement> is a dynamically-typed patch in TS (Object.is per-key change detection, nested params bag); Rust needs either an Option-per-field typed patch or a serde_json merge — the params bag (ParamValues) is itself dynamic and shared with the params cluster.
- removeKeyframes pre-samples the playhead value via resolveAnimationTarget + resolveAnimationPathValueAtTime — depends on the animation cluster being callable from here.
- commitPreview pushes (not executes) a TracksSnapshot — must interoperate exactly with the history 'push without execute' path.
- Largest surface area of any subsystem; the empty-track-pruning reactor mutates the same tracks post-command.

**Test cases**
- `tl-preview-merge` _(golden)_ — previewElements over a set of patches yields the same derived tracks as applyPreviewOverlay; commitPreview == a direct updateTracks(after)
- `tl-preview-discard` _(property)_ — previewElements(...) then discardPreview() leaves committed tracks unchanged and pushes nothing to history
- `tl-kf-delete-presample` _(unit)_ — removeKeyframes on the last key of a property backfills the element's base value with the value sampled at the current playhead
- `tl-batch-keyframes` _(unit)_ — upsertKeyframes with >1 key wraps into a single BatchCommand (one undo step); with 1 key uses the bare command
- `tl-duration` _(golden)_ — getTotalDuration / getLastFrameTime match calculateTotalDuration + lastFrameMediaTime for representative tracks
- `tl-drag-perf` _(perf)_ — previewElements at 60fps for a 12-track / 500-element timeline stays within frame budget (imbl overlay merge)

---

#### ScenesManager  `2-4 weeks`
**Web:** `apps/web/src/core/managers/scenes-manager.ts`, `apps/web/src/timeline/scenes.ts`, `apps/web/src/timeline/bookmarks/index.ts`, `apps/web/src/commands/scene/**`
**Browser deps:** `storageService (IndexedDB) in loadProjectScenes`, `new Date() for updatedAt (nondeterministic)`
**Depends on:** Command pattern & undo/redo, ProjectManager, PlaybackManager (playback clock)

**Features**
- Active scene + scene list state
- create/delete/rename/switchTo scene (delete guarded by canDeleteScene)
- Bookmarks: toggle/remove/update/move + isBookmarked/getBookmarkAtTime (frame-quantized via getFrameTime + project fps)
- loadProjectScenes (from storage), initializeScenes (ensureMainScene, pick current/fallback, backfill main scene into project if added), clearScenes, setScenes, getActiveScene(OrNull), getScenes
- updateSceneTracks(): the mutation hub called by timeline.updateTracks — writes tracks + updatedAt into active scene, replaces it in list, AND syncs the whole scene list into project.active.scenes with a new updatedAt

**Native approach** — crates: `uuid`, `chrono`, `imbl`
Port scene CRUD as command variants. CRITICAL: eliminate the TS dual-source-of-truth where scene state lives in BOTH ScenesManager and ProjectManager.active.scenes and is re-synced on every mutation. In native, make the project the single owner of scenes (scenes: Vector<Scene> on ProjectState) and let ScenesState hold only current_scene_id + derived accessors. updateSceneTracks becomes the one funnel that writes into project.scenes and marks dirty. Frame-quantize bookmarks with the existing rust/crates/time FrameRate.

_Data structures:_ `struct Scene { id: Uuid, name: String, is_main: bool, tracks: SceneTracks, bookmarks: Vector<Bookmark>, created_at: DateTime, updated_at: DateTime }`, `struct Bookmark { time: MediaTime, note: Option<String>, color: Option<String>, duration: Option<MediaTime> }`, `struct ScenesState { current_scene_id: Option<Uuid> } // scenes owned by ProjectState`

_Risks:_
- Untangling the duplicated scene state (ScenesManager.list/active vs project.scenes) is a real refactor — every setScenes/updateSceneTracks path re-syncs both today.
- updatedAt uses new Date() — inject a clock for deterministic golden tests.
- ensureMainScene invariant (exactly one main scene) must hold across load/migrate.

**Test cases**
- `sc-ensure-main` _(unit)_ — initializeScenes on a scene list with no main scene adds exactly one main scene and marks the project dirty
- `sc-track-sync` _(golden)_ — updateSceneTracks writes tracks into the active scene AND into project.scenes with matching updated_at
- `sc-bookmark-quantize` _(unit)_ — isBookmarked/getBookmarkAtTime quantize the query time to the project frame grid before comparing
- `sc-delete-guard` _(property)_ — deleteScene rejects when canDeleteScene is false (e.g. last/main scene) and never removes the main scene

---

#### ProjectManager  `2-4 weeks`
**Web:** `apps/web/src/core/managers/project-manager.ts`, `apps/web/src/project/types.ts`, `apps/web/src/commands/project/update-project-settings.ts`, `apps/web/src/services/storage/migrations/index.ts`
**Browser deps:** `storageService (IndexedDB + OPFS)`, `CanvasRenderer + document.createElement('canvas').toDataURL (thumbnail)`, `loadFonts (Google Fonts network)`, `toast (sonner)`, `SceneExporter (WebCodecs/mediabunny) via renderer`
**Depends on:** Command pattern & undo/redo, ScenesManager, MediaManager (asset registry), RendererManager (render-tree state & export orchestration), SaveManager (autosave)

**Features**
- Active project + savedProjects metadata list; isLoading/isInitialized flags; migrationState
- createNewProject (default main scene, default fps/canvas/background, version=CURRENT_PROJECT_VERSION)
- loadProject: pause autosave -> ensureStorageMigrations (31-step chain) -> clear media/scenes -> load project -> initializeScenes -> loadProjectMedia -> loadFonts -> generate thumbnail if missing -> resume autosave
- saveCurrentProject, deleteProjects (+media), renameProject, duplicateProjects (deep copy + media copy + '(n) Name' numbering)
- updateSettings(pushHistory?) via UpdateProjectSettingsCommand (background/fps/canvas/etc.)
- ratchetFpsForImportedMedia (raises project fps on import), updateThumbnail(FromTimeline), prepareExit (thumbnail + flush)
- export orchestration: sets exportState, delegates to renderer.exportProject with progress/cancel
- getFilteredAndSortedProjects, timelineViewState get/set, invalidProjectIds tracking

**Native approach** — crates: `serde`, `serde_json`, `uuid`, `chrono`, `image`
ProjectState owns the canonical project (incl. scenes). Settings mutations go through UpdateProjectSettings command (undoable). Delegate the heavy browser-coupled steps to other clusters: migrations -> persistence cluster; thumbnail -> compositor cluster renders one frame, encode PNG with `image`; fonts -> text/font cluster; export encode -> compositor/export cluster. ProjectManager here is orchestration + state (a load/export state machine emitting progress events). duplicate numbering regex ports directly.

_Data structures:_ `struct Project { metadata: ProjectMetadata, scenes: Vector<Scene>, current_scene_id: Uuid, settings: ProjectSettings, version: u32, timeline_view_state: Option<TimelineViewState> }`, `struct ProjectSettings { fps: FrameRate, canvas_size: Size, canvas_size_mode: enum, last_custom_canvas_size: Option<Size>, original_canvas_size: Option<Size>, background: Background }`, `enum Background { Color(String), Blur{ intensity: f32 } }`, `struct ExportState { is_exporting: bool, progress: f32, result: Option<ExportResult> }, struct MigrationState { is_migrating: bool, from: Option<u32>, to: Option<u32>, project_name: Option<String> }`

_Risks:_
- Thumbnail/fonts/storage/export are all cross-cluster — keep ProjectManager as orchestration only or it balloons.
- Scene ownership overlaps ScenesManager (resolve to single owner).
- loadProject pauses autosave around a long async chain — cancellation/error paths and the resume-in-finally must be preserved so a failed load doesn't leave autosave paused.
- duplicateProjects copies every media asset (potentially large) — native should hardlink/copy-on-write files rather than duplicate blobs.

**Test cases**
- `pj-new-shape` _(golden)_ — createNewProject produces the exact default Project (fps, canvas, background=color(default), version=CURRENT) — serde golden
- `pj-dup-numbering` _(unit)_ — duplicateProjects names collisions '(2) Name', '(3) Name' based on existing max
- `pj-settings-undo` _(unit)_ — updateSettings(pushHistory=true) execute sets settings.background; undo restores prior settings + updatedAt
- `pj-fps-ratchet` _(property)_ — ratchetFpsForImportedMedia never lowers fps and matches getRaisedProjectFpsForImportedMedia for imported asset fps sets

---

#### PlaybackManager (playback clock)  `1-2 weeks`
**Web:** `apps/web/src/core/managers/playback-manager.ts`
**Browser deps:** `requestAnimationFrame / cancelAnimationFrame`, `performance.now()`
**Depends on:** TimelineManager (mutation & query surface), ProjectManager, Observable/subscription reactivity model

**Features**
- play/pause/toggle; seek (clamped to [0,duration]); currentTime/isPlaying getters
- Volume/mute: setVolume (clamps 0..1, mutes at 0), mute/unmute/toggleMute, previousVolume restore
- RAF wall-clock timer: elapsed = (performance.now()-start)/1000, rawTime = start + mediaTimeFromSeconds(elapsed), newTime = roundFrameTime(rawTime, fps); auto-pause + clamp at end
- Scrubbing flag
- Three listener channels: subscribe() (state), onUpdate(time) (tick), onSeek(time)
- bindTimelineScope(): subscribes timeline + scenes and reconciles (re-clamp, auto-pause) whenever tracks/scenes change

**Native approach** — crates: `opencut-time (existing rust/crates/time)`, `std::time::Instant`
PlaybackState holds is_playing/current_time/volume/muted. Replace RAF with an injectable Clock/tick driver so the core stays framework-agnostic: in MCP/headless mode a manual step-clock lets tools seek/step deterministically; in the GPUI shell the frame callback drives it; for real A/V sync the audio device clock (see AudioManager) should be the master and PlaybackManager reads it. Reuse rust/crates/time (MediaTime, mediaTimeFromSeconds, roundFrameTime, clampMediaTime) so tick math is bit-identical to the web. Preserve reconcile-on-timeline-change (clamp + auto-pause).

_Data structures:_ `struct PlaybackState { is_playing: bool, current_time: MediaTime, volume: f32, muted: bool, previous_volume: f32, is_scrubbing: bool, start_wall: Instant, start_time: MediaTime }`, `trait Clock { fn now_elapsed(&self) -> Duration }`

_Risks:_
- RAF/performance.now() are UI-thread specific — native must pick the tick master; audio-clock mastering is best for sync but couples to AudioManager.
- Determinism: tests need a mock clock; real-time playback needs a steady source.
- roundFrameTime/mediaTimeFromSeconds must exactly match TS (guaranteed by reusing the time crate).

**Test cases**
- `pb-tick-parity` _(golden)_ — For a mock elapsed sequence, current_time (roundFrameTime applied) matches the rust/crates/time reference values
- `pb-seek-clamp` _(unit)_ — seek clamps to [0, totalDuration]; seeking past end while playing pauses at end
- `pb-reconcile` _(unit)_ — shrinking the timeline below currentTime re-clamps and auto-pauses via reconcileTimelineScope
- `pb-play-invariant` _(property)_ — Random play/seek/pause sequences never leave current_time outside [0, duration]

---

#### SelectionManager  `days`
**Web:** `apps/web/src/core/managers/selection-manager.ts`, `apps/web/src/selection/editor-selection.ts`
**Browser deps:** `None — pure value logic (strong first-port candidate)`
**Depends on:** —

**Features**
- Holds selectedElements, selectedKeyframes + keyframeSelectionAnchor, selectedMaskPoints
- Mutually-exclusive setters (setSelectedElements clears keyframes+maskPoints, etc.)
- getActiveSelectionKind priority: mask-points > keyframes > elements
- getSnapshot / applySelectionPatch / restoreSnapshot (used by the command manager for undo)
- clearSelection / clearKeyframeSelection / clearMaskPointSelection / clearMostSpecificSelection

**Native approach** — crates: `serde`
Direct 1:1 port to a plain value struct. Snapshot = clone; patch = all-Option struct; restore = assign. The 'restore selection only when a command declared an override' policy lives in the command layer, not here. Expose selection as a Query in the MCP surface (get_selection) and setters as non-undoable state changes.

_Data structures:_ `struct SelectionSnapshot { selected_elements: Vec<ElementRef>, selected_keyframes: Vec<SelectedKeyframeRef>, keyframe_anchor: Option<SelectedKeyframeRef>, selected_mask_points: Option<MaskPointSelection> }`, `struct SelectionPatch { selected_elements: Option<Vec<ElementRef>>, selected_keyframes: Option<Vec<SelectedKeyframeRef>>, keyframe_anchor: Option<Option<SelectedKeyframeRef>>, selected_mask_points: Option<Option<MaskPointSelection>> }`, `struct MaskPointSelection { track_id: Uuid, element_id: Uuid, mask_id: Uuid, point_ids: Vec<Uuid> }`, `enum SelectionKind { MaskPoints, Keyframes, Elements }`

_Risks:_
- Minimal. Only subtlety: applyPatch must touch only provided (Some) fields — matches the TS undefined-vs-present checks.

**Test cases**
- `sel-exclusive` _(unit)_ — setSelectedElements clears keyframes + mask points; setSelectedKeyframes clears mask points
- `sel-kind-priority` _(unit)_ — getActiveSelectionKind returns mask-points over keyframes over elements when multiple are non-empty
- `sel-snapshot-roundtrip` _(property)_ — restoreSnapshot(getSnapshot()) is identity for arbitrary selection states
- `sel-patch-partial` _(unit)_ — applySelectionPatch updates only the fields present in the patch

---

#### ClipboardManager  `days`
**Web:** `apps/web/src/core/managers/clipboard-manager.ts`, `apps/web/src/clipboard/index.ts`, `apps/web/src/commands/timeline/clipboard/paste.ts`, `apps/web/src/commands/timeline/clipboard/paste-keyframes.ts`
**Browser deps:** `None for the manager (app-internal clipboard, not the OS clipboard); paste reads playback.getCurrentTime()`
**Depends on:** Command pattern & undo/redo, SelectionManager, PlaybackManager (playback clock), TimelineManager (mutation & query surface)

**Features**
- In-app clipboard: holds a ClipboardEntry (null when empty), hasEntry/getEntry
- copy(): builds entry from a CopyContext (selected elements + keyframes); returns false if nothing copyable
- paste({time?}): builds a paste command from a PasteContext (selection + time defaulting to current playhead) and executes it (undoable)

**Native approach** — crates: `serde`, `arboard (optional, for OS clipboard bridge)`
ClipboardState { entry: Option<ClipboardEntry> }. copy/paste build Command variants (paste executes; copy is a non-undoable state set). Make ClipboardEntry serde-serializable so it can optionally bridge to the OS clipboard (arboard) for cross-project/cross-instance paste, and be exposed via MCP (copy/paste tools). Paste placement reuses the timeline placement engine (separate cluster).

_Data structures:_ `enum ClipboardEntry { Elements { elements: Vec<TimelineElement>, origin_spans: Vec<TimeSpan> }, Keyframes { channels: Map<AnimationPath, ChannelData> } }`, `struct PasteContext { selected_elements, selected_keyframes, time: MediaTime }`

_Risks:_
- Decide OS-clipboard vs app-only clipboard semantics (web is app-only).
- Paste depends on the placement/insert cluster; keyframe paste depends on the animation cluster.

**Test cases**
- `cb-copy-empty` _(unit)_ — copy with empty selection returns false and leaves entry unchanged
- `cb-paste-noentry` _(unit)_ — paste with no entry returns false and executes no command
- `cb-paste-at-time` _(golden)_ — paste places copied elements at the given time (or playhead) producing the expected tracks and one undo step

---

#### SaveManager (autosave)  `days`
**Web:** `apps/web/src/core/managers/save-manager.ts`
**Browser deps:** `setTimeout / clearTimeout`
**Depends on:** Observable/subscription reactivity model, ProjectManager, ScenesManager

**Features**
- Debounced 800ms autosave; subscribes to scenes + timeline changes -> markDirty -> queueSave
- saveNow: guards (skip if already saving, not dirty, no active project, loading, or migrating); sets saving flag; calls project.saveCurrentProject; re-queues if dirtied during save
- pause/resume (resume flushes pending), markDirty({force}) bypasses pause, flush() (await immediate save), getIsDirty
- start()/stop() manage subscriptions + timer

**Native approach** — crates: `tokio (time, sync)`
A debounced background task subscribing to TIMELINE|SCENES domain events from the EventBus. On mark-dirty, reset a tokio sleep (800ms); on fire, run the persistence-cluster saveProject unless paused/loading/migrating. Preserve the single-writer guarantee (is_saving) and re-queue-if-dirtied semantics. flush() awaits an immediate save (used by prepareExit). Provide a synchronous flush path for app shutdown.

_Data structures:_ `struct SaveState { is_paused: bool, is_saving: bool, has_pending: bool, debounce: Duration }`, `a debounce task handle (tokio::task::JoinHandle) + a reset signal (Notify/watch)`

_Risks:_
- Async task lifecycle: cancel-on-stop, don't drop a pending save on shutdown (flush must win).
- Never save mid-migration or mid-load (mirror the guards).
- Debounce reset correctness under bursty edits (drag preview commits).

**Test cases**
- `sv-debounce` _(unit)_ — A burst of N markDirty within the window triggers exactly one save after the debounce elapses
- `sv-paused` _(unit)_ — While paused, markDirty is suppressed unless force=true; resume flushes a pending save
- `sv-requeue` _(unit)_ — markDirty during an in-flight save re-queues a follow-up save
- `sv-flush` _(integration)_ — flush() persists immediately and getIsDirty() clears once the write completes

---

#### MediaManager (asset registry)  `1-2 weeks`
**Web:** `apps/web/src/core/managers/media-manager.ts`, `apps/web/src/media/types.ts`
**Browser deps:** `storageService (IndexedDB metadata + OPFS blobs)`, `URL.revokeObjectURL (blob URL lifecycle)`, `videoCache / waveformCache (decode caches)`, `toast (sonner), quota-exceeded detection`
**Depends on:** Command pattern & undo/redo, ProjectManager, SaveManager (autosave)

**Features**
- In-memory MediaAsset[] registry (getAssets/setAssets), isLoadingMedia
- addMediaAsset: assigns uuid, optimistic insert, persist, ratchetFpsForImportedMedia, rollback + quota toast on failure
- removeMediaAsset(s): routed through RemoveMediaAssetCommand (single) or BatchCommand (many) — undoable
- loadProjectMedia (from storage), clearProjectMedia / clearAllAssets (revoke object URLs, clear videoCache + waveformCache)

**Native approach** — crates: `uuid`, `serde`
MediaState { assets: Vec<MediaAsset> } where an asset references a file path/handle in the native media store (OPFS -> filesystem, a separate persistence/media cluster) instead of a blob URL. Keep removeMediaAsset routed through a command so it stays undoable, and keep the import-time fps ratchet. Decode caches (videoCache/waveformCache) and blob-URL lifecycle are browser artifacts that disappear natively — replace with path/handle refs and OS-level file caches.

_Data structures:_ `struct MediaAsset { id: Uuid, kind: MediaKind /*Video|Image|Audio*/, path: PathBuf /*or handle*/, name: String, width: Option<u32>, height: Option<u32>, fps: Option<f32>, has_audio: Option<bool>, duration: Option<MediaTime> }`

_Risks:_
- Object-URL/decode-cache logic is browser-specific and belongs to the media-decode cluster; this subsystem is only the registry + command routing.
- Quota-exceeded becomes disk-space/IO errors with different handling.
- Optimistic insert + rollback ordering must be preserved so a failed persist doesn't leave a dangling asset.

**Test cases**
- `md-add-id` _(unit)_ — addMediaAsset assigns a fresh id, inserts once, and triggers the fps ratchet with the new asset
- `md-remove-batch` _(unit)_ — removeMediaAssets builds a BatchCommand for >1 id and a single command for exactly 1
- `md-clear` _(unit)_ — clearAllAssets empties the registry (and, natively, drops file handles)
- `md-serde` _(golden)_ — MediaAsset registry round-trips through serde with stable field ordering

---

#### RendererManager (render-tree state & export orchestration)  `1-2 weeks`
**Web:** `apps/web/src/core/managers/renderer-manager.ts`
**Browser deps:** `CanvasRenderer / OffscreenCanvas, canvas.toBlob`, `ClipboardItem / navigator.clipboard.write`, `SceneExporter (WebCodecs / mediabunny)`, `downloadBlob, opencut-wasm formatTimecode`
**Depends on:** TimelineManager (mutation & query surface), ProjectManager, MediaManager (asset registry), Observable/subscription reactivity model

**Features**
- Holds the current renderTree (RootNode) via setRenderTree/getRenderTree
- Degraded-mode flag (set when no GPU) via setDegraded/isDegraded
- saveSnapshot / copySnapshot: render a single frame at min(playhead,lastFrame) to PNG, download or copy to clipboard; filenames use formatTimecode
- exportProject: build scene, optionally mix audio buffer, drive SceneExporter with progress adjustment + cancel polling

**Native approach** — crates: `image`, `arboard`, `opencut-compositor (existing rust/crates/compositor)`, `opencut-time`
RendererState holds the render-tree handle + degraded flag and is state/orchestration only — the actual compositing (compositor crate) and video encode (export cluster) live elsewhere. Snapshot: render one frame via the compositor to an RGBA buffer -> encode PNG with `image` -> write to disk or OS clipboard (arboard). Export: a progress/cancel state machine emitting EditorEvents; hand the scene to the export cluster's encoder. Reuse the time crate for timecode filenames.

_Data structures:_ `struct RendererState { render_tree: Option<RootNode>, degraded: bool }`, `struct ExportJob { progress: f32, cancel: CancellationToken }`

_Risks:_
- Heavy lifting (compositor, encoder) is other clusters — keep this thin.
- Render-tree ownership across threads (render on a worker); decide Arc-shared vs message-passed tree.
- Cancel-token semantics must match the TS setInterval poll behavior.

**Test cases**
- `rd-tree-state` _(unit)_ — setRenderTree stores and getRenderTree returns it; setDegraded toggles and emits a RENDERER change once
- `rd-export-fsm` _(unit)_ — export state machine transitions idle->exporting->done and cancel short-circuits to cancelled
- `rd-snapshot-png` _(integration)_ — saveSnapshot renders a frame and produces valid PNG bytes with a timecode filename

---

#### DiagnosticsManager  `days`
**Web:** `apps/web/src/core/managers/diagnostics-manager.ts`, `apps/web/src/diagnostics/types.ts`, `apps/web/src/transcription/diagnostics.ts`
**Browser deps:** `None in the manager; individual check predicates may inspect browser-derived state (e.g. GPU degraded)`
**Depends on:** EditorCore singleton & lifecycle

**Features**
- Registry of DiagnosticRegistration = DiagnosticDefinition{id,scope,severity,message} + check(editor)->bool predicate
- getActive({scope?}): filters registrations by scope then returns only those whose check() currently returns true
- register() (notifies), subscribe/notify
- Transcription diagnostics registered at EditorCore construction

**Native approach** — crates: `none (std only)`
Vec<Diagnostic{ def, check: Box<dyn Fn(&EditorState)->bool> }>; getActive filters by scope and evaluates predicates over &EditorState. Expose via MCP as a 'warnings/health' query so agents can see editor state issues (no GPU, empty timeline, etc.). Keep predicates pure over &EditorState.

_Data structures:_ `struct Diagnostic { def: DiagnosticDefinition, check: Box<dyn Fn(&EditorState)->bool> }`, `struct DiagnosticDefinition { id: String, scope: String, severity: Severity /*Caution|Error*/, message: String }`

_Risks:_
- TS check closures capture the whole editor — keep them pure over &EditorState to avoid borrow conflicts.
- Registration timing (some diagnostics registered at construction) must be preserved.

**Test cases**
- `dg-scope-filter` _(unit)_ — getActive({scope}) returns only registrations with the matching scope
- `dg-check-gate` _(unit)_ — Only registrations whose check() returns true for the given state are active
- `dg-register-notify` _(unit)_ — register() adds a diagnostic and emits a DIAGNOSTICS change

---

#### AudioManager (playback mixing)  `1-2 months`
**Web:** `apps/web/src/core/managers/audio-manager.ts`, `apps/web/src/media/audio.ts`, `apps/web/src/media/audio-mastering.ts`, `apps/web/src/timeline/audio-state.ts`, `apps/web/src/retime/index.ts`
**Browser deps:** `Web Audio API (AudioContext, GainNode, AudioBufferSourceNode, OfflineAudioContext)`, `mediabunny (Input / AudioBufferSink / BlobSource)`, `soundtouchjs (pitch preservation)`, `setInterval / setTimeout`
**Depends on:** PlaybackManager (playback clock), TimelineManager (mutation & query surface), MediaManager (asset registry)

**Features**
- Real-time playback mixing: subscribes to playback (play/pause/volume), timeline, media, and seek events
- collectAudioClips from tracks; lookahead scheduler (2s window, 500ms interval) starting only clips entering the window
- Per-clip GainNode with animated volume via linearRampToValueAtTime (buildAudioGainAutomation); master gain from playback volume; mastering chain
- Retime: playbackRate for simple rate; pre-rendered retimed buffer (renderRetimedBuffer) when curve retime / animated volume / maintainPitch (soundtouch)
- Decode+resample via mediabunny Input/AudioBufferSink + OfflineAudioContext; decoded/prepared buffer caches keyed by source
- Latency compensation + resync when the audio callback falls behind (dropped-buffer counter)

**Native approach** — crates: `cpal`, `symphonia`, `rubato`, `rtrb`, `dasp`
Nearly a full rewrite — the most browser-coupled subsystem. Replace the Web Audio graph with a native mixer feeding a cpal output stream: the real-time audio callback pulls a fixed buffer, mixing all active clips with per-clip gain automation sampled at buffer boundaries. Decode with symphonia (media cluster), resample/time-stretch with rubato (+ a WSOLA/pitch algorithm for maintainPitch). The audio device clock should become the playback MASTER clock that PlaybackManager reads (best for A/V sync), replacing the lookahead+latency-compensation hacks needed under Web Audio. Use an rtrb ring buffer to hand mixed samples to the callback without locking.

_Data structures:_ `struct AudioClipSource { id, source_key, file/handle, start_time, duration, trim_start, trim_end, retime: Option<RetimeConfig>, volume, muted, element_ref }`, `struct Mixer { active: Vec<ActiveClip>, master_gain: f32 }`, `struct GainAutomation { points: Vec<(MediaTime, f32)> }`

_Risks:_
- Highest-effort, highest-risk subsystem in the cluster; overlaps heavily with the media-decode/mastering cluster (decode, resample, soundtouch parity).
- A/V sync master-clock decision (audio device vs frame clock) ripples into PlaybackManager.
- Real-time decode/resample must meet the audio-callback deadline (no allocation/locking in the callback).
- Sample-accurate gain automation from keyframed volume must match buildAudioGainAutomation / resolveEffectiveAudioGain used for export.

**Test cases**
- `au-collect` _(unit)_ — collectAudioClips extracts the expected clip set (with trim/retime/volume) from representative tracks
- `au-gain-automation` _(golden)_ — buildAudioGainAutomation ramp points at keyframed volume match the reference for a known channel
- `au-mix-deadline` _(perf)_ — Mixing N overlapping clips per audio callback stays within the real-time buffer deadline with no allocations
- `au-schedule` _(property)_ — For random timelines, scheduled clip playback has no gaps/overlaps and respects mute/trim boundaries

## Timeline system
SCOPE NOTE: "ripple" and "retime/speed" physically live outside apps/web/src/timeline (apps/web/src/ripple/*, apps/web/src/retime/*) but are timeline-domain logic and are included here per the cluster brief. The React components (*.tsx), hooks/* and controllers/* are the GPUI-interaction boundary; everything else in timeline/ is pure model/logic.

FOUNDATION ALREADY NATIVE: The integer-tick time type MediaTime(i64), FrameRate, timecode parsing and TICKS_PER_SECOND=120000 already exist in rust/crates/time (media_time.rs, frame_rate.rs, timecode.rs) and are exported to the web app via opencut-wasm + the rust/crates/bridge `#[export]` macro. The TS side (apps/web/src/wasm/media-time.ts) is a thin branded-number wrapper over these. This means the hardest correctness primitive (frame-exact tick arithmetic) is done — most timeline math is a mechanical port that becomes MORE correct in Rust because i64 replaces JS floats (the group-resize invariant trimStart+duration*rate+trimEnd==sourceDuration and the roundMediaTime -0 normalization are float hazards that vanish natively).

ARCHITECTURE RECOMMENDATION: Land the pure subsystems (core-model → placement → snapping → group-move/group-resize → ripple → update-pipeline) in opencut-core as a framework-agnostic crate with a pure `fn(state, input) -> new_state` shape. They already have this shape in TS (strategy/result records, no side effects, immutable SceneTracks spreads). MCP and GPUI then both drive the same kernels. Only the controllers/* and hooks/* and *.tsx are GPUI-specific and should be rewritten, not ported — but their inner decision kernels (pixelToTime, isClickGesture, snap resolution, buildMoveGroup/resolveGroupMove/computeGroupResize) are already extracted into the pure modules.

IMMUTABILITY: The entire cluster is written in a persistent/COW style (findTrackInSceneTracks/updateTrackInSceneTracks return new trees via spreads). This maps cleanly to rpds/imbl persistent Vectors which give O(1) clone + structural sharing — valuable for the undo/redo command stack (apps/web/src/core/managers/commands.ts) and for the ripple before/after diffing.

CROSS-CLUSTER DEPS (out of scope but load-bearing): animation (clampAnimationsToDuration, getElementKeyframes, resolveNumberAtTime, cloneAnimations), params (ParamValues registry), effects/masks/graphics default-instance builders, media (MediaAsset.hasAudio), fps utils. These are consumed by update-pipeline, snapping, audio-state, audio-separation and element-utils.

#### timeline-core-model  `2-4 weeks`
**Web:** `apps/web/src/timeline/types.ts`, `apps/web/src/timeline/tracks.ts`, `apps/web/src/timeline/track-capabilities.ts`, `apps/web/src/timeline/track-element-update.ts`, `apps/web/src/timeline/scenes.ts`, `apps/web/src/timeline/creation.ts`, `apps/web/src/timeline/defaults.ts`, `apps/web/src/timeline/index.ts`, `apps/web/src/timeline/element-utils.ts`, `apps/web/src/wasm/media-time.ts`
**Browser deps:** `AudioElement.buffer?: AudioBuffer / VideoElement decode is browser-side (WebAudio/WebCodecs); native replaces with symphonia-decoded buffers`, `generateUUID (crypto.randomUUID) via @/utils/id`
**Depends on:** —

**Features**
- SceneTracks shape {overlay: OverlayTrack[], main: VideoTrack, audio: AudioTrack[]} - the canonical timeline tree
- Discriminated-union TimelineTrack (video/text/audio/graphic/effect) and TimelineElement (audio/video/image/text/sticker/graphic/effect) with per-type fields
- ElementRef, TScene, Bookmark, RetimeConfig, ClipboardItem, DropTarget/ComputeDropTargetParams shared types
- Element-class subsets: MASKABLE/RETIMABLE/VISUAL types and type guards (isVisualElement/isMaskableElement/isRetimableElement/canElementHaveAudio/hasMediaId)
- Track capability guards (canTrackHaveAudio, canTrackBeHidden)
- Immutable tree navigation/update: findTrackInSceneTracks, updateTrackInSceneTracks, updateElementInSceneTracks (with elementPredicate)
- calculateTotalDuration over all tracks; getElementsAtTime; getElementFontFamilies
- Scene lifecycle: getMainScene, ensureMainScene, buildDefaultScene, canDeleteScene, getFallbackSceneAfterDelete, findCurrentScene, getProjectDurationFromScenes, updateSceneInArray
- Element constructors (buildTextElement/buildEffectElement/buildStickerElement/buildGraphicElement/buildElementFromMedia/buildLibraryAudioElement) with default param seeding
- Branded integer-tick MediaTime arithmetic (add/sub/max/min/clamp/round/roundFrame/snapSeek/lastFrame/parseTimecode) - already a wrapper over rust/crates/time

**Native approach** — crates: `serde`, `serde_json`, `uuid`, `rpds or imbl (persistent Vector for COW SceneTracks)`, `opencut time crate (existing)`
Model TimelineTrack and TimelineElement as Rust enums with struct variants; SceneTracks as a struct holding persistent Vectors (rpds::Vector / imbl::Vector) so clone-on-write matches the TS spread semantics with structural sharing. Derive serde for project persistence and MCP payloads. Reuse the existing MediaTime(i64) newtype instead of the branded-number shim. params (ParamValues) is an open Record<string, ParamValue> in TS - model as a typed enum ParamValue plus HashMap<String,ParamValue> (or IndexMap to preserve order). Provide the update helpers as free functions returning a new SceneTracks.

_Data structures:_ `enum TrackType`, `enum TimelineTrack { Video{..}, Text{..}, Audio{..}, Graphic{..}, Effect{..} }`, `enum TimelineElement { Audio, Video, Image, Text, Sticker, Graphic, Effect }`, `struct SceneTracks { overlay: Vector<OverlayTrack>, main: VideoTrack, audio: Vector<AudioTrack> }`, `struct ElementRef { track_id, element_id }`, `struct TScene`, `struct Bookmark { time: MediaTime, note, color, duration }`

_Risks:_
- params as an untyped bag: choosing a typed ParamValue enum vs serde_json::Value affects every param-touching call site across effects/graphics/text
- AudioBuffer is a browser object embedded in the element model - native must decouple element metadata from decoded PCM (store mediaId, decode lazily via symphonia)
- Ubiquitous immutable-spread updates: without a persistent Vector the naive Vec clone per keystroke is O(n) and will show up in drag/resize hot loops
- Enum-per-element vs trait-object: matching TS union exhaustiveness (VISUAL/MASKABLE/RETIMABLE subsets) needs care so guards stay total

**Test cases**
- `core-serde-roundtrip` _(golden)_ — Serialize a representative SceneTracks (all 5 track types, retime, animations, params) to JSON and back; byte-compare against a golden fixture captured from the web app to prove wire compatibility
- `core-update-helpers` _(unit)_ — updateElementInSceneTracks/updateTrackInSceneTracks hit the correct track in overlay/main/audio, are no-ops for unknown ids, and honor elementPredicate
- `core-total-duration` _(unit)_ — calculateTotalDuration returns max(startTime+duration) across all tracks; ZERO for empty; correct with elements only on audio
- `core-immutability` _(property)_ — For random tracks and updates, the input SceneTracks is never mutated and untouched sub-trees are pointer-shared (structural sharing holds)
- `core-mediatime-parity` _(golden)_ — Reuse existing rust/crates/time tests; assert add/sub/clamp/roundFrame/snapSeek match the TS media-time.ts fixtures

---

#### update-pipeline  `1-2 weeks`
**Web:** `apps/web/src/timeline/update-pipeline.ts`, `apps/web/src/timeline/__tests__/update-pipeline.test.ts`
**Browser deps:** —
**Depends on:** timeline-core-model, retime-speed

**Features**
- Rule-based element patch application: shallow-merge patch (+ nested params merge), then run derive rules, then enforce rules, tracking changedFields
- Derive rule 'retime': when retime changes, clamp rate and recompute duration from sourceDuration/trim so visible source span is preserved
- Enforce rule 'duration': clamp animation keyframes to the new duration (clampAnimationsToDuration)
- Enforce rule 'startTime': main-track elements pin to ZERO when they would become the earliest element; non-negative clamp elsewhere
- getSourceDuration fallback derivation from trim + retimed clip span when sourceDuration absent

**Native approach** — crates: `opencut time crate`, `core-model + retime-speed crates (internal)`
Port as an ordered list of rules; each rule is a struct/closure implementing apply(element, original, patch, ctx) -> (element, changed_fields). A trigger set (Vec<FieldId>) gates each rule against the accumulated changedFields Set (HashSet<FieldId>). Keep the two phases (derive then enforce) explicit. FieldId can be a small enum rather than stringly-typed 'keyof' to avoid typos.

_Data structures:_ `enum ElementField { Retime, Duration, StartTime, Params, ... }`, `struct ElementUpdateContext { tracks: &SceneTracks, track_id }`, `trait Rule { fn triggers(&self)->&[ElementField]; fn apply(..)->RuleResult }`, `struct RuleResult { element, changed_fields: Vec<ElementField> }`

_Risks:_
- Order-sensitivity: retime-derive must run before duration-enforce (animation clamp) - the phase split must be preserved exactly
- Cross-cluster dep on animation.clampAnimationsToDuration - needs the animation crate ported or stubbed
- Main-track 'earliest element' pin is subtle (<= comparison, excludes self) and duplicated with placement/main-track.ts - unify to one native helper

**Test cases**
- `up-retime-derives-duration` _(golden)_ — Port update-pipeline.test.ts: patching retime.rate recomputes duration and reports changedFields=[retime,duration]
- `up-main-track-pin` _(unit)_ — Setting startTime on a main-track element that becomes earliest pins it to ZERO; a later element keeps its requested start
- `up-invariant` _(property)_ — After any retime/trim patch, trimStart + duration*rate + trimEnd == sourceDuration holds exactly in integer ticks
- `up-negative-clamp` _(unit)_ — Negative requested startTime on a non-main track clamps to ZERO

---

#### placement-engine  `2-4 weeks`
**Web:** `apps/web/src/timeline/placement/resolve.ts`, `apps/web/src/timeline/placement/overlap.ts`, `apps/web/src/timeline/placement/compatibility.ts`, `apps/web/src/timeline/placement/insert-index.ts`, `apps/web/src/timeline/placement/main-track.ts`, `apps/web/src/timeline/placement/apply.ts`, `apps/web/src/timeline/placement/track-factory.ts`, `apps/web/src/timeline/placement/types.ts`, `apps/web/src/timeline/placement/index.ts`, `apps/web/src/timeline/placement/__tests__/resolve.test.ts`
**Browser deps:** —
**Depends on:** timeline-core-model

**Features**
- resolveTrackPlacement: strategy-driven placement over the ordered [overlay..., main, audio...] display list
- 5 strategies: explicit(trackId), firstAvailable, preferIndex(hover/vertical-drag direction, createNewTrackOnly), aboveSource(sourceTrackIndex), alwaysNew(highest|default)
- Overlap test canPlaceTimeSpansOnTrack (half-open interval overlap, excludeElementId self-skip)
- Element->track type compatibility map (image/video->video, sticker/graphic->graphic, etc.) + validateElementTrackCompatibility with error message
- Insert-index math for new tracks per type (audio below main, effect at top, overlay at overlay.length) and resolvePreferredNewTrackPlacement with above/below normalization around the main track
- enforceMainTrackStart / getEarliestMainTrackElement: main-track first element pinned to ZERO
- applyPlacement: immutably append elements to an existing track OR splice a newly built track (buildEmptyTrack) into overlay/audio at a normalized index
- PlacementResult union (existingTrack{trackId,index,type,adjustedStartTime?} | newTrack{insertIndex,insertPosition,type})

**Native approach** — crates: `uuid`, `core-model crate (internal)`
Near-mechanical 1:1 port; this is the densest pure-logic island and the highest-value native target. Model PlacementStrategy and PlacementResult as enums, PlacementSubject as an enum. Keep the ordered display list as a helper (overlay ++ [main] ++ audio). ELEMENT_TRACK_MAP becomes a const match. applyPlacement returns (SceneTracks, target_track_id) Option. The whole module is total functions with no I/O beyond uuid generation (inject an id source for deterministic tests).

_Data structures:_ `enum PlacementStrategy { Explicit, FirstAvailable, PreferIndex{..}, AboveSource{..}, AlwaysNew{position} }`, `enum PlacementResult { ExistingTrack{..}, NewTrack{insert_index, insert_position, track_type} }`, `struct PlacementTimeSpan { start_time: MediaTime, duration: MediaTime, exclude_element_id: Option<String> }`, `enum InsertPosition { Above, Below }`

_Risks:_
- Display-index bookkeeping (overlay.len as main index, audio offset overlay.len+1) is replicated in placement, group-move, and drop-target - extract one shared TrackPlacement helper or the three will drift
- adjustedStartTime is only present when it differs from requested (Option semantics) - callers branch on presence; keep Option<MediaTime> not a sentinel
- Inject the UUID source so golden tests are deterministic

**Test cases**
- `place-resolve-golden` _(golden)_ — Port placement/__tests__/resolve.test.ts wholesale as the acceptance suite for every strategy x track-type combination
- `place-overlap` _(property)_ — canPlaceTimeSpansOnTrack returns false iff any span half-open-overlaps a non-excluded element; touching edges (end==start) do not overlap
- `place-insert-index` _(unit)_ — getDefault/getHighestInsertIndexForTrack and resolvePreferredNewTrackPlacement return correct indices for audio-below-main and overlay-above-main normalization
- `place-apply-splice` _(golden)_ — applyPlacement inserts a new track at the normalized index and leaves siblings untouched; existingTrack path appends elements without reordering
- `place-main-pin` _(unit)_ — enforceMainTrackStart pins to ZERO when requested <= earliest, else passes through; excludeElementId excludes the moving element

---

#### snapping  `1-2 weeks`
**Web:** `apps/web/src/timeline/snapping/build.ts`, `apps/web/src/timeline/snapping/resolve.ts`, `apps/web/src/timeline/snapping/threshold.ts`, `apps/web/src/timeline/snapping/types.ts`, `apps/web/src/timeline/snapping/index.ts`, `apps/web/src/timeline/element-snap-source.ts`, `apps/web/src/timeline/playhead-snap-source.ts`, `apps/web/src/timeline/animation-snap-points.ts`, `apps/web/src/timeline/bookmarks/snap-source.ts`
**Browser deps:** `Threshold input is a pixel count and zoom level - a viewport concern; GPUI supplies zoom/px-per-second`
**Depends on:** timeline-core-model

**Features**
- buildTimelineSnapPoints: aggregate SnapPoints from a list of lazy sources (source() -> Iterable<SnapPoint>)
- Snap sources: element start/end edges (excludeElementIds), playhead, bookmarks (excludeBookmarkTime), animation keyframes (element.startTime + keyframe.time)
- resolveTimelineSnap: nearest snap point within maxSnapDistance (linear scan, closest wins) -> {snappedTime, snapPoint, snapDistance}
- getTimelineSnapThresholdInTicks: convert a pixel threshold (default 10px) to ticks given zoom (px/sec -> ticks)

**Native approach** — crates: `opencut time crate`, `core-model crate (internal)`
Sources become closures/iterators (impl Fn() -> impl Iterator<Item=SnapPoint>) or a Vec collected eagerly. resolveTimelineSnap ports directly. For large timelines, replace the O(n) scan with a sorted Vec<MediaTime> + binary search or an interval/BTreeMap index (perf subsystem) since resolve runs every mousemove during drag/resize/scrub. SnapPoint is a small struct; SnapPointType an enum.

_Data structures:_ `enum SnapPointType { ElementStart, ElementEnd, Playhead, Bookmark, Keyframe }`, `struct SnapPoint { time: MediaTime, kind, element_id: Option, track_id: Option }`, `struct SnapResult { snapped_time, snap_point: Option<SnapPoint>, snap_distance }`, `(perf) BTreeMap<MediaTime, SnapPoint> or sorted Vec for nearest-neighbor`

_Risks:_
- Hot path: snap points are rebuilt every mousemove in the TS controllers - native should cache/incrementally maintain the point set across a gesture rather than rebuild
- Keyframe snap depends on animation.getElementKeyframes (cross-cluster)
- Tie-breaking: current impl keeps the first of equal distance (strictly < comparison) - preserve to avoid jitter parity bugs

**Test cases**
- `snap-nearest` _(unit)_ — resolveTimelineSnap picks the closest point within threshold, returns identity+null outside threshold, and keeps first-seen on ties
- `snap-sources` _(unit)_ — element/playhead/bookmark/keyframe sources emit the right times and honor exclude sets
- `snap-threshold` _(unit)_ — getTimelineSnapThresholdInTicks scales inversely with zoom (10px at 50px/s at zoom 1 = 0.2s = 24000 ticks)
- `snap-perf` _(perf)_ — 10k-element timeline: build+resolve under a mousemove budget; assert indexed variant beats linear scan

---

#### group-move  `2-4 weeks`
**Web:** `apps/web/src/timeline/group-move/build-group.ts`, `apps/web/src/timeline/group-move/resolve-move.ts`, `apps/web/src/timeline/group-move/snap.ts`, `apps/web/src/timeline/group-move/track-placement.ts`, `apps/web/src/timeline/group-move/types.ts`, `apps/web/src/timeline/group-move/index.ts`
**Browser deps:** —
**Depends on:** timeline-core-model, placement-engine, snapping

**Features**
- buildMoveGroup: from an anchor + selection, build members with per-member timeOffset (relative to anchor), trackSection (overlay/main/audio), sectionIndex, displayIndex; dedupe by elementId
- resolveGroupMove: two modes - existing-track move and new-track creation
- Existing-track: reassign each member to a display-index-relative compatible track (search up from anchor for members above, down for members below, skipping used tracks/types), clamp anchor start (min so no member goes negative; main-track pin against stationary elements), validate no overlaps (incl. among the moving spans themselves)
- New-track: require all members audio XOR all non-audio, compute block start index, create one track per member, map moves
- snapGroupEdges: snap the whole group by testing every member start AND end edge against the shared snap-point set, pick globally closest, back-solve anchor start
- track-placement helpers: getDisplayTracks, getTrackPlacementById, getTrackPlacementByDisplayIndex (section/displayIndex math)

**Native approach** — crates: `uuid`, `core-model + placement + snapping crates (internal)`
Port directly; reuse placement-engine's overlap and compatibility helpers and the shared TrackPlacement helper. GroupMoveTarget is an enum (ExistingTrack{anchor_target_track_id} | NewTracks{anchor_insert_index, new_track_ids}). The compatible-track search is a bounded loop with a used-set (HashSet<TrackId>). clampAnchorStartTime folds member offsets and a main-track stationary-earliest check. Inject new_track_ids (or a UUID source) for determinism.

_Data structures:_ `struct GroupMember extends ElementRef { element_type, duration, time_offset: MediaTime, track_section, section_index, display_index }`, `struct MoveGroup { anchor, members }`, `enum GroupMoveTarget { ExistingTrack{..}, NewTracks{..} }`, `struct GroupMoveResult { moves: Vec<PlannedElementMove>, create_tracks: Vec<PlannedTrackCreation>, target_selection: Vec<ElementRef> }`

_Risks:_
- Highest-complexity pure module: the bidirectional findCompatibleTrackPlacement with running upper/lower boundary indices is easy to get subtly wrong - the golden suite must cover interleaved multi-type selections
- Audio/non-audio exclusivity for new-track moves must match placement insert-index rules exactly
- Overlap validation must consider the moving spans against each other (hasOverlappingTimeSpans) AND against stationary elements (canPlaceTimeSpansOnTrack with moving ids filtered out) - both, in that order
- Returns null on any inconsistency - callers treat null as 'reject drop'; preserve the exact null conditions

**Test cases**
- `gm-build-offsets` _(unit)_ — buildMoveGroup computes timeOffsets relative to anchor, correct section/displayIndex, dedupes anchor-in-selection
- `gm-existing-multitype` _(golden)_ — Move a mixed overlay+main+audio selection onto a new anchor track; assert each member lands on a compatible display-index-adjacent track with no overlaps
- `gm-clamp` _(unit)_ — clampAnchorStartTime prevents any member going negative and pins when a member on main would precede the earliest stationary main element
- `gm-newtracks` _(golden)_ — All-audio and all-overlay new-track moves produce correct createTracks indices; mixed audio/non-audio returns null
- `gm-snap-edges` _(property)_ — snapGroupEdges never moves the group when no member edge is within threshold; when snapped, at least one member edge lands exactly on a snap point
- `gm-overlap-reject` _(unit)_ — resolveGroupMove returns null when moves would overlap stationary elements or each other

---

#### group-resize  `2-4 weeks`
**Web:** `apps/web/src/timeline/group-resize/compute-resize.ts`, `apps/web/src/timeline/group-resize/types.ts`, `apps/web/src/timeline/group-resize/index.ts`, `apps/web/src/timeline/controllers/resize-controller.ts (buildResizeMembers, hasResizeChanges - pure helpers)`
**Browser deps:** `FrameRate comes from opencut-wasm (already native in rust/crates/time)`
**Depends on:** timeline-core-model, retime-speed

**Features**
- computeGroupResize: apply one shared drag delta to multiple elements' left or right edge, clamped to the tightest per-member bound
- Per-member min/max delta: minDuration = 1 frame; left/right neighbor bounds; source-extent bounds (can't extend past real media)
- Frame-snap the clamped delta once, then re-clamp (honoring source-extent bound over frame alignment)
- Retime-aware source<->clip delta conversion (getSourceDeltaForClipDelta, getVisibleSourceSpanForDuration, getDurationForVisibleSourceSpan)
- buildResizeUpdate: derive trimStart/trimEnd/startTime/duration patch preserving the trim+span invariant
- buildResizeMembers: from selection, compute leftNeighborBound/rightNeighborBound per element (max end of left non-selected, min start of right non-selected)
- -0 normalization to ZERO

**Native approach** — crates: `opencut time crate (FrameRate, round_to_frame, ticks_per_frame)`, `core-model + retime crates (internal)`
Direct port; native i64 tick math makes the trim/span invariant EXACT by construction (the TS comment about per-field rounding not composing is a float artifact - integers compose). minDuration derived from fps.denominator/numerator. Bounds are Option<MediaTime> (rightNeighbor/source may be unbounded). The single-snap-then-reclamp sequence and the 'source-extent bound wins over frame alignment' rule must be preserved. -0 case disappears in Rust.

_Data structures:_ `enum ResizeSide { Left, Right }`, `struct GroupResizeMember extends ElementRef { start_time, duration, trim_start, trim_end, source_duration: Option, retime: Option<RetimeConfig>, left_neighbor_bound: Option<MediaTime>, right_neighbor_bound: Option<MediaTime> }`, `struct GroupResizeUpdate { ..ElementRef, patch: {trim_start, trim_end, start_time, duration} }`, `struct GroupResizeResult { delta_time, updates }`

_Risks:_
- Retime source<->clip conversions round independently and must match the TS rounding (roundMediaTime = round-half-away-from-zero) to keep frame parity
- Source-extent maximum extension math (getMinimum/MaximumAllowedDeltaTime) is intricate for retimed clips - golden tests with rate != 1 are mandatory
- buildResizeMembers currently lives in a controller file but is pure - relocate to the pure crate

**Test cases**
- `gr-invariant` _(property)_ — For random members/sides/deltas, trimStart + duration*rate + trimEnd == sourceDuration remains exact after resize
- `gr-retime-golden` _(golden)_ — Resize a 2x-retimed clip's right edge; assert trimEnd and duration match a captured web fixture tick-for-tick
- `gr-bounds` _(unit)_ — Delta clamps to min-duration (1 frame), to neighbor bounds, and to source extent; the tightest bound across members wins
- `gr-frame-snap` _(unit)_ — Clamped delta snaps to a frame once; at a non-frame-aligned source-extent limit the bound is honored over frame alignment
- `gr-members` _(unit)_ — buildResizeMembers computes correct left/right neighbor bounds ignoring selected siblings

---

#### ripple  `1-2 weeks`
**Web:** `apps/web/src/ripple/diff.ts`, `apps/web/src/ripple/apply.ts`, `apps/web/src/ripple/shift.ts`, `apps/web/src/ripple/index.ts`
**Browser deps:** —
**Depends on:** timeline-core-model

**Features**
- computeRippleAdjustments: diff before/after SceneTracks per track to find freed intervals (element deleted OR trimmed shorter) minus intervals newly occupied (joinedIntervals), skipping elements that merely moved to another track
- Interval set algebra: normalizeIntervals (merge overlapping/sorted), subtractIntervalSets (source minus overlapping), pushInterval (drop empty)
- buildAdjustments: each freed interval -> {trackId, afterTime, shiftAmount}
- applyRippleAdjustments: group by track, apply in descending afterTime order, shift elements at/after afterTime left by shiftAmount
- rippleShiftElements: pure per-track shift

**Native approach** — crates: `core-model crate (internal)`
Pure interval-arithmetic port; no external crate needed (or use a small interval-tree if profiling demands). Model Interval{start,end} and ElementSpan{id,start,end}. The before/after diff maps naturally to HashMap<ElementId, ElementSpan>. Descending-afterTime application order is critical and must be preserved. Consider a persistent Vector so apply returns a new SceneTracks cheaply for the undo stack.

_Data structures:_ `struct Interval { start_time: MediaTime, end_time: MediaTime }`, `struct ElementSpan { id, start_time, end_time }`, `struct RippleAdjustment { track_id, after_time: MediaTime, shift_amount: MediaTime }`, `HashMap<String, ElementSpan> before/after by id`

_Risks:_
- Cross-track move detection relies on a global allAfterElementIds set - a deleted-here-but-present-elsewhere element must NOT create a freed interval
- Interval subtraction edge cases (touching/nested/multiple overlaps) are the classic source of off-by-one; property tests essential
- Order of application (descending afterTime) prevents double-shifting - a straightforward but easy-to-miss invariant

**Test cases**
- `rip-delete` _(golden)_ — Delete a mid-track element; downstream elements shift left by exactly its duration; other tracks untouched
- `rip-trim` _(unit)_ — Trimming an element shorter frees only the vacated tail interval
- `rip-cross-track-move` _(unit)_ — An element moved to another track produces no ripple on its old track
- `rip-interval-algebra` _(property)_ — subtractIntervalSets/normalizeIntervals: result intervals are disjoint, sorted, within source, and exclude all overlapping regions
- `rip-monotonic` _(property)_ — Applying adjustments never increases total duration and never produces negative start times

---

#### retime-speed  `2-4 weeks`
**Web:** `apps/web/src/retime/rate.ts`, `apps/web/src/retime/resolve.ts`, `apps/web/src/retime/split.ts`, `apps/web/src/retime/presets.ts`, `apps/web/src/retime/audio-stretch.ts`, `apps/web/src/retime/index.ts`, `apps/web/src/retime/__tests__/split.test.ts`, `apps/web/src/retime/__tests__/resolve.test.ts`, `apps/web/src/commands/timeline/element/keyframes/retime-keyframe.ts`
**Browser deps:** `audio-stretch.ts: WebAudio AudioBuffer, BaseAudioContext, OfflineAudioContext (createBuffer/startRendering/copyToChannel), createBufferSource`, `soundtouchjs PitchShifter (npm) for pitch-preserving time-stretch`, `sourceBuffer.getChannelData / sampleRate (WebAudio decoded PCM)`
**Depends on:** timeline-core-model

**Features**
- Rate policy: clampRetimeRate (0.01-5, invalid->1), canMaintainPitch, shouldMaintainPitch
- Time mapping: getSourceTimeAtClipTime (clip*rate), getClipTimeAtSourceTime, getEffectiveRateAt, getTimelineDurationForSourceSpan (span/rate), getSourceSpanAtClipTime (>=0)
- splitRetimeAtClipTime / adjustRetimeForTrimChange (currently pass-through for constant rate)
- buildConstantRetime preset
- audio-stretch: renderRetimedBuffer - linear-resample path (speed change, pitch follows) and pitch-preserving path (soundtouchjs PitchShifter tempo=rate, plus a pre-resample to target sample rate)

**Native approach** — crates: `signalsmith-stretch or ssstretch (pitch-preserving time-stretch, replaces soundtouchjs)`, `rubato (high-quality sample-rate conversion / linear-resample path)`, `symphonia (decode source media to PCM)`, `opencut time crate`
Split cleanly: the rate math (rate.ts/resolve.ts/split.ts/presets.ts) is trivial pure arithmetic that ports in an afternoon and feeds update-pipeline/group-resize. The real work is audio-stretch: replace the WebAudio+soundtouchjs offline-render pipeline with a direct-buffer pipeline - decode with symphonia, resample with rubato, and for maintain-pitch run signalsmith-stretch (colinmarc/signalsmith-stretch-rs or bmisiak/ssstretch, both MIT wrappers of the same C++ lib that produce far higher quality than soundtouchjs). Offline render becomes plain buffer-in/buffer-out; no OfflineAudioContext.

_Data structures:_ `struct RetimeConfig { rate: f64, maintain_pitch: bool }`, `PCM as Vec<Vec<f32>> or interleaved Vec<f32> with channel count + sample rate`, `resampler/stretcher instances (rubato::SincFixedIn, signalsmith Stretch)`

_Risks:_
- Output parity with soundtouchjs is effectively impossible to byte-match - accept a quality UPGRADE and validate perceptually (manual A/B) plus energy/duration checks rather than golden byte compare
- signalsmith-stretch/ssstretch pull a C++ dependency (cc/bindgen build) - a native/desktop-only dep, not WASM-friendly; fine for GPUI target
- Sample-rate handling: the TS code pre-resamples because soundtouchjs ignores native rate - rubato lets you avoid that dance, but retime-of-retime and trimStart offsetting must stay sample-accurate
- getEffectiveRateAt is currently constant-rate; a future variable-speed ramp would change the whole mapping - keep the seam

**Test cases**
- `rt-rate-clamp` _(unit)_ — clampRetimeRate: NaN/<=0 -> 1; clamps to [0.01,5]; maintain-pitch policy gates on finite positive rate
- `rt-mapping` _(golden)_ — Port resolve.test.ts/split.test.ts: source<->clip time and duration-for-span mappings match fixtures
- `rt-resample-len` _(unit)_ — renderRetimedBuffer output length == ceil(clipDuration*targetSampleRate) for both resample and pitch-preserve paths
- `rt-stretch-quality` _(manual)_ — A/B listen: 0.5x and 2x with maintainPitch; assert pitch unchanged and no soundtouchjs-grade artifacts
- `rt-stretch-perf` _(perf)_ — Time-stretch a 60s stereo clip within an interactive budget; compare rubato+signalsmith throughput to the WASM baseline

---

#### bookmarks-model  `days`
**Web:** `apps/web/src/timeline/bookmarks/utils.ts`, `apps/web/src/timeline/bookmarks/index.ts`, `apps/web/src/timeline/bookmarks/snap-source.ts`
**Browser deps:** `bookmarks/components/*.tsx, bookmarks/hooks/use-bookmark-drag.ts, preview-overlay-source.tsx are React/DOM (UI - excluded from this pure subsystem)`
**Depends on:** timeline-core-model, snapping

**Features**
- Bookmark array ops keyed by exact tick time: findBookmarkIndex, isBookmarkAtTime, toggleBookmarkInArray (add+sort or remove), removeBookmarkFromArray, updateBookmarkInArray, moveBookmarkInArray (re-sort)
- getFrameTime (roundFrameTime), getBookmarkAtTime, getBookmarksActiveAtTime (time within [start, start+duration])
- getBookmarkSnapPoints (feeds snapping, excludeBookmarkTime)

**Native approach** — crates: `opencut time crate (roundFrameTime)`, `core-model crate (internal)`
Trivial port over Vec<Bookmark> kept sorted by time. Exact-tick equality (integer) is the identity key - cleaner in Rust than the JS === on branded numbers. Snap source emits SnapPoint{kind: Bookmark}. The drag hook and components are GPUI-side.

_Data structures:_ `struct Bookmark { time: MediaTime, note: Option<String>, color: Option<String>, duration: Option<MediaTime> }`, `Vec<Bookmark> (sorted invariant)`

_Risks:_
- Sorted-invariant must be maintained on every mutation (toggle/move re-sort) - encapsulate in a small type to avoid callers breaking it
- getBookmarksActiveAtTime uses inclusive end (time <= end) - preserve inclusivity

**Test cases**
- `bm-toggle` _(unit)_ — toggleBookmarkInArray adds (sorted) when absent and removes when present at exact tick
- `bm-move` _(unit)_ — moveBookmarkInArray relocates and re-sorts; no-op for missing fromTime
- `bm-active` _(unit)_ — getBookmarksActiveAtTime includes zero-duration bookmarks only at exact time and ranged bookmarks across [start,end]
- `bm-sorted` _(property)_ — After any sequence of ops the array stays sorted by time

---

#### audio-separation-and-state  `1-2 weeks`
**Web:** `apps/web/src/timeline/audio-separation/index.ts`, `apps/web/src/timeline/audio-separation/__tests__/audio-separation.test.ts`, `apps/web/src/timeline/audio-state.ts`, `apps/web/src/timeline/audio-constants.ts`, `apps/web/src/timeline/audio-display.ts`, `apps/web/src/timeline/__tests__/audio-state.test.ts`
**Browser deps:** —
**Depends on:** timeline-core-model

**Features**
- Source-audio state predicates: isSourceAudioEnabled/isSourceAudioSeparated, canExtractSourceAudio/canRecoverSourceAudio/canToggleSourceAudio (needs MediaAsset.hasAudio), doesElementHaveEnabledAudio, getSourceAudioActionLabel
- buildSeparatedAudioElement: derive a standalone upload-audio element from a video element (copy trim/retime/sourceDuration, clone only volume animations with fresh keyframe ids, default volume/muted params)
- Volume model: clampDb (VOLUME_DB_MIN..MAX), dBToLinear (10^(db/20)), getElementVolume, isElementMuted, hasAnimatedVolume
- resolveEffectiveAudioGain at a local time (animation-resolved dB -> linear, muted/track-muted -> 0)
- buildWaveformGainSamples (N samples across duration), buildAudioGainAutomation (ramp points at stepSeconds for playback graph)

**Native approach** — crates: `core-model + animation crates (internal)`
Pure predicate and math port. resolveEffectiveAudioGain calls into the animation value resolver (cross-cluster) at integer tick times. dB<->linear is trivial. buildSeparatedAudioElement is a structural transform reusing element constructors and the animation clone helper (with new ids). The automation sampler feeds whatever native audio graph the compositor/playback layer uses.

_Data structures:_ `reuse TimelineElement (Audio|Video)`, `struct GainPoint { local_time: f64, gain: f64 }`, `MediaAudioState { has_audio: bool }`

_Risks:_
- Depends on animation.resolveNumberAtTime and cloneAnimations (cross-cluster) - gain automation and animated volume can't be validated until the animation crate exists
- resolveEffectiveAudioGain mixes seconds (localTime f64) and ticks (Math.round(localTime*TICKS_PER_SECOND)) - keep the unit boundary explicit in Rust to avoid tick/second confusion
- buildSeparatedAudioElement must clone ONLY the volume animation channel with regenerated keyframe ids

**Test cases**
- `as-predicates` _(unit)_ — canExtract/Recover/Toggle source audio respect element type, isSourceAudioEnabled, and MediaAsset.hasAudio; port audio-separation.test.ts
- `as-build-separated` _(golden)_ — buildSeparatedAudioElement copies trim/retime/sourceDuration and clones volume animation with fresh ids against a fixture
- `as-db-linear` _(unit)_ — dBToLinear and clampDb: 0dB->1.0, clamped range, non-finite->0dB; port audio-state.test.ts
- `as-gain-automation` _(property)_ — buildAudioGainAutomation emits points across [from,to] at step, always includes the endpoint, and gains are 0 when muted

---

#### scale-ruler-viewport-utils  `1-2 weeks`
**Web:** `apps/web/src/timeline/scale.ts`, `apps/web/src/timeline/pixel-utils.ts`, `apps/web/src/timeline/zoom-utils.ts`, `apps/web/src/timeline/ruler-utils.ts`, `apps/web/src/timeline/drag-utils.ts`
**Browser deps:** `pixel-utils reads window.devicePixelRatio (device-pixel grid snapping)`, `drag-utils takes a DOMRect and scrollLeft (viewport geometry)`
**Depends on:** timeline-core-model

**Features**
- Scale constants (BASE_TIMELINE_PIXELS_PER_SECOND=50, zoom 0.1..100)
- px<->time: getTimelinePixelsPerSecond, timelineTimeToPixels, timelineTimeToSnappedPixels, snapPixelToDeviceGrid, getCenteredLineLeft; getMouseTimeFromClientX
- Zoom math: getTimelineZoomMin (fit-to-duration with padding ratio), getTimelinePaddingPx, getZoomPercent, exponential sliderToZoom/zoomToSlider
- Ruler: getRulerConfig (CapCut-style label/tick interval selection by zoom+fps, ensuring ticks divide labels), shouldShowLabel, formatRulerLabel (MM:SS / H:MM:SS / Xf)

**Native approach** — crates: `opencut time crate`, `gpui (supplies window scale factor + element bounds at the boundary)`
Pure numeric port; these are view-layer helpers so GPUI supplies the equivalents of devicePixelRatio (window scale factor) and DOMRect (element bounds). Keep the ruler interval heuristics identical for visual parity with the web editor. sliderToZoom/zoomToSlider are exact float formulas. formatRulerLabel string formatting ports directly.

_Data structures:_ `struct RulerConfig { label_interval_seconds: f64, tick_interval_seconds: f64 }`, `const LABEL/TICK_FRAME_INTERVALS, SECOND_MULTIPLIERS arrays`

_Risks:_
- devicePixelRatio and DOMRect are the only real browser touchpoints - they become GPUI window/bounds; keep the pure math independent of them (pass scale as a param)
- Ruler interval selection has several fallbacks (ensureTickDividesLabel) - golden tests across zoom levels prevent visual drift
- epsilon-based second-boundary checks (shouldShowLabel/isSecondBoundary) should stay float to match the web app exactly

**Test cases**
- `sv-zoom-roundtrip` _(property)_ — zoomToSlider(sliderToZoom(p)) == p within tolerance across the zoom range
- `sv-ruler-golden` _(golden)_ — getRulerConfig across a matrix of zoom x fps matches captured web fixtures; ticks always divide labels
- `sv-format-label` _(unit)_ — formatRulerLabel yields MM:SS on second boundaries, H:MM:SS past an hour, and Xf between seconds
- `sv-px-time` _(unit)_ — timelineTimeToPixels and getMouseTimeFromClientX are inverse (mod device snapping) at fixed zoom

---

#### drop-target-computation  `1-2 weeks`
**Web:** `apps/web/src/timeline/components/drop-target.ts`, `apps/web/src/timeline/components/track-layout.ts`, `apps/web/src/timeline/components/layout.ts`
**Browser deps:** `Track pixel heights (getTrackHeight) and TIMELINE_TRACK_GAP_PX are UI/theme layout constants`, `Mouse x/y and pixelsPerSecond/zoom are viewport inputs`
**Depends on:** timeline-core-model, placement-engine

**Features**
- computeDropTarget: from mouse x/y + tracks + drag params, produce a DropTarget (existing track vs new track, insert position, snapped xPosition, optional target element for effect/mask drops)
- Vertical hit-testing getTrackAtY over cumulative track heights + inter-track gaps (gap resolves up/down by drag direction)
- findElementAtPosition for targetElementTypes (drop onto a specific element, e.g. effect/mask)
- Empty-timeline and out-of-bounds (above all / below all) fallbacks via resolveTrackPlacement
- getDropLineY for the drop indicator; getTrackHeight per track type (UI layout constant)

**Native approach** — crates: `placement + core-model crates (internal)`, `gpui (supplies layout heights + pointer coords)`
computeDropTarget is a pure function that happens to consume UI layout constants (track heights). Port it into the pure crate but parameterize the height provider (pass a fn(TrackType)->px or a LayoutMetrics struct) so GPUI supplies real heights. It delegates the hard decisions to placement-engine's resolveTrackPlacement, so this is mostly the y-hit-test + x->time conversion glue. getDropLineY is view-only and can live GPUI-side.

_Data structures:_ `struct DropTarget { track_index, is_new_track, insert_position: Option, x_position: MediaTime, target_element: Option<{element_id, track_id}> }`, `struct ComputeDropTargetParams { .. }`, `struct LayoutMetrics { track_height: fn(TrackType)->f32, track_gap_px }`

_Risks:_
- Sits exactly on the model/UI boundary: it needs pixel track heights, so it belongs in a 'view-model' layer that both the pure crate and GPUI agree on - don't bake theme constants into core
- Gap hit-testing depends on verticalDragDirection and only triggers when a direction is present - preserve the branch
- x->time uses mouseX/(pixelsPerSecond*zoomLevel) but elsewhere pixelsPerSecond already includes zoom - watch the double-zoom convention when porting

**Test cases**
- `dt-existing` _(golden)_ — Hovering the top/bottom half of a compatible track yields existingTrack with adjusted xPosition (main-track pin) matching a fixture
- `dt-new-track` _(unit)_ — Hovering an incompatible track or a gap yields newTrack with correct insertIndex/insertPosition
- `dt-target-element` _(unit)_ — With targetElementTypes set, dropping over a matching element returns that element as target
- `dt-bounds` _(unit)_ — Empty timeline, above-all, and below-all mouseY produce the correct new-track fallbacks

---

#### interaction-controllers-gpui  `2-4 months`
**Web:** `apps/web/src/timeline/controllers/drag-drop-controller.ts`, `apps/web/src/timeline/controllers/element-interaction-controller.ts`, `apps/web/src/timeline/controllers/resize-controller.ts`, `apps/web/src/timeline/controllers/seek-controller.ts`, `apps/web/src/timeline/controllers/zoom-controller.ts`, `apps/web/src/timeline/controllers/playhead-controller.ts`, `apps/web/src/timeline/controllers/keyframe-drag-controller.ts`, `apps/web/src/timeline/hooks/use-edge-auto-scroll.ts`, `apps/web/src/timeline/hooks/use-scroll-sync.ts`, `apps/web/src/timeline/hooks/element/use-keyframe-box-select.ts`, `apps/web/src/timeline/components/selection-hit-testing.ts`, `apps/web/src/timeline/timeline-store.ts`
**Browser deps:** `React MouseEvent / native MouseEvent, event.button/clientX/clientY/timeStamp/target`, `DOM element refs via configRef getters: getBoundingClientRect, scrollLeft, contains()`, `window addEventListener(mousemove/mouseup), requestAnimationFrame, setTimeout debounce`, `React ref/subscription plumbing (subscribers Set, configRef.current)`
**Depends on:** timeline-core-model, placement-engine, group-move, group-resize, snapping, drop-target-computation, scale-ruler-viewport-utils

**Features**
- Session state machines converting pointer/keyboard input into model ops: idle/pending/dragging/scrubbing/resizing
- DragDropController: external file/media/text/sticker/graphic/effect drops, dragenter/over/leave counting, computeDropTarget on move, insert at target
- ElementInteractionController: internal element move - click vs drag discrimination, buildMoveGroup on drag start, live drop target + resolveGroupMove every move, snapGroupEdges, commit on up
- ResizeController: buildResizeMembers, snapped delta (edge snap resolution), computeGroupResize live, commit
- SeekController/PlayheadController: click-vs-drag gesture detection, pixelToTime, frame-snap seek, scrub with snapping, view-state persistence
- ZoomController: exponential slider<->zoom, pre-zoom scroll + playhead-anchor scroll preservation, debounced scroll save
- KeyframeDragController: keyframe time drag with threshold activation
- Edge auto-scroll, scroll sync between ruler/tracks, box-selection hit-testing

**Native approach** — crates: `gpui (event handling, focus, scroll, drag)`, `all pure timeline crates above (internal)`
REWRITE, not port. The pure decision kernels are already extracted (pixelToTime, isClickGesture, resolveTimelineSnap, buildMoveGroup/resolveGroupMove, computeGroupResize, computeDropTarget) and move into opencut-core; the controllers themselves become thin GPUI event->kernel->dispatch adapters. Replace the configRef/getter indirection with GPUI Context reads (viewport scale, scroll offset, element bounds from GPUI layout). Session enums map directly to Rust enums held in the GPUI view Model. window listeners become GPUI mouse/drag event handlers; requestAnimationFrame becomes GPUI's frame scheduling; the debounced scroll-save becomes a GPUI timer. Because the kernels are headless, the MCP layer can drive the same move/resize/seek operations without GPUI at all.

_Data structures:_ `enum DragDropState/DragOverState`, `enum ElementInteraction Session { Idle, Pending{snapshot}, Dragging{group, progress} }`, `enum ResizeSession/ScrubSession/KeyframeDrag Session`, `GPUI view Model holding current session + a reference to the timeline document`

_Risks:_
- Largest rewrite surface in the cluster and the least directly portable - GPUI's event/gesture/scroll model differs fundamentally from DOM MouseEvents + getBoundingClientRect
- Viewport state (scrollLeft, container rect, devicePixelRatio, playhead-anchor scroll math in ZoomController) all lives in the DOM today and must be re-sourced from GPUI
- Click-vs-drag thresholds (5px/500ms) and edge auto-scroll timing tie into the platform input loop - parity requires tuning against GPUI's event cadence
- The controllers are the integration point for undo/redo (timeline-store + core/managers/commands.ts) - the commit boundaries must map onto the native command stack
- Keep the pure kernels covered by the golden suites so the GPUI rewrite is validated against known-good decisions rather than reimplemented blindly

**Test cases**
- `ic-gesture-kernel` _(unit)_ — isClickGesture (5px/500ms) and pixelToTime/scrub clamping are unit-tested as pure functions independent of GPUI
- `ic-drag-move` _(integration)_ — Simulate a GPUI pointer-down/move/up over an element; assert the resulting model matches resolveGroupMove output for the same coordinates
- `ic-resize` _(integration)_ — Drive a resize gesture with snapping enabled; assert final trims equal computeGroupResize for the snapped delta
- `ic-seek-snap` _(integration)_ — Click vs drag on ruler/tracks: click seeks (frame-snapped), drag scrubs; playhead-handle clicks are ignored for seek
- `ic-zoom-anchor` _(manual)_ — Zooming keeps the playhead (or cursor) anchored and restores scroll position, matching the web editor feel
- `ic-edge-autoscroll` _(manual)_ — Dragging near the timeline edge auto-scrolls at the expected rate

## Rendering, preview & export
CRITICAL REUSE FACT: the wgpu compositor is already fully native (rust/crates/compositor,effects,masks,gpu) AND the entire FrameDescriptor wire format already exists as native Rust structs in rust/crates/compositor/src/frame.rs (FrameDescriptor, FrameItemDescriptor, LayerDescriptor, QuadTransformDescriptor, LayerMaskDescriptor, EffectPassDescriptor, EffectUniformValueDescriptor). So the native port does NOT reimplement compositing — it replaces (a) the TS scene-graph/resolve that produces resolved nodes, (b) the Canvas2D rasterization that turns text/color/gradient/mask-shapes/graphics into RGBA textures, (c) the serde-wasm-bindgen boundary (dropped entirely — build the Rust structs in-process and upload wgpu::Textures directly), and (d) mediabunny/WebCodecs export -> native ffmpeg mux. The compositor input contract is stable and load-bearing: keep it identical so golden tests can diff at the descriptor level.

WHAT'S ALREADY NATIVE AND REUSED AS-IS: rust/crates/compositor/src/compositor.rs (Compositor::render_frame / render_frame_to_texture, layer/blend/mask pipelines with LayerUniformBuffer/BlendUniformBuffer/MaskUniformBuffer, texture_pool, texture_store), rust/crates/effects (EffectPipeline, gaussian_blur.wgsl — note only 'gaussian-blur' is wired), rust/crates/masks (JFA feather), rust/crates/gpu (GpuContext, Bgra8Unorm, blit/fullscreen shaders). The wasm boundary (rust/wasm/src/compositor.rs, gpu.rs) is the ONLY compositor code replaced — by a native GpuContext bound to a GPUI/winit surface (preview) or an offscreen texture (export). The wasm path branches WebGPU-surface vs WebGL-texture; native is always the surface path (render_frame) or render_frame_to_texture (export), which is simpler.

TWO-RASTERIZER STRATEGY (key decision): the TS renderer rasterizes non-media layers (color/gradient, text, mask shapes, graphic vector shapes, blur backdrop) on Canvas2D into OffscreenCanvas then uploads as textures; media (video/image/sticker) are 'external' textures uploaded by source identity. Keep that exact split. For the CPU raster stage pick tiny-skia (deterministic, stable, ideal for golden tests + the export path). OPTIONALLY add a vello fast-path for interactive preview that renders vector/text straight into a wgpu texture (no CPU round-trip) — but vello is alpha and non-deterministic across drivers, so it must NOT be the golden path.

DETERMINISM / GOLDEN STRATEGY (cross-cutting): GPU output varies by driver, so golden testing is three-tier. Tier 0 (cheapest, highest value): descriptor-level golden — serialize the FrameDescriptor the native scene-builder+resolve produces for a fixture project and diff JSON vs a committed snapshot; catches scene/resolve regressions with zero GPU (the existing apps/web/src/services/renderer/__tests__/scene-builder-background.test.ts is the TS precedent). Tier 1 (exact, CPU): golden-PNG the tiny-skia raster outputs (text/color/gradient/mask/graphic) at 0 tolerance — pure and deterministic. Tier 2 (tolerant, GPU): render whole composited frames through a software adapter (lavapipe/llvmpipe via WGPU_ADAPTER_NAME, or a headless offscreen GpuContext) and diff vs committed goldens with a small per-pixel tolerance + max-diff-count budget. IMPORTANT: text goldens must be regenerated against the native raster (cosmic-text != Canvas2D metrics), they cannot be shared with the web renderer.

CROSS-CLUSTER DEPENDENCIES (out of scope, depended on): (1) Timeline/state cluster owns SceneTracks/TimelineElement/MediaAsset/params/retime — scene-builder consumes these; commit/preview-overlay API backs the handle controllers. (2) Animation cluster owns resolveTransformAtTime/resolveOpacityAtTime/resolveColorAtTime/resolveEffectParamsAtTime/getElementLocalTime + bezier sampler — resolve.ts calls these every node every frame. (3) Media/decode cluster owns videoCache.getFrameAt (native video decode -> RGBA frame) + image decode — the single biggest external dependency of resolve; MUST expose a stable id+version for the external-texture cache. (4) Text cluster owns measureTextElement/typography/layout/background + fonts/atlas -> becomes cosmic-text/parley + fontdb; blocks both the raster and the geometry subsystems. (5) Effects cluster owns effectsRegistry + resolveEffectPasses + the WGSL shader set (only gaussian-blur wired). (6) Masks cluster owns mask definitions + builtin shape path builders (the CPU shapes I rasterize) + the native JFA feather crate. (7) Graphics cluster owns GraphicDefinition.render (Canvas2D path draw -> kurbo paths). (8) Gradients cluster owns drawCssBackground (CSS gradient parsing -> lightningcss). (9) Audio cluster owns createTimelineAudioBuffer (mixed PCM) that export muxes. (10) Playback clock feeds preview render time. Effort numbers assume those clusters deliver native equivalents.

SEQUENCING for core-first: build in this order — (A) Scene-graph model + scene builder (pure, unblocks descriptor goldens), (B) Pure geometry (pure, unblocks selection/hit-test and later UI), (C) Frame-descriptor bridge + wgpu compositor integration (small, reuses native crates, gets pixels on screen), (D) Canvas2D->native raster + resolve (the long pole, gated on text/fonts + media decode), (E) Export/muxing (reuses D's offscreen path), (F) Interactive preview GPUI shell (last, UI). The renderer can produce correct composited frames as soon as C+D land even before any GPUI UI exists — that is the natural first end-to-end milestone (headless render of a fixture project to PNG/MP4).

#### Scene-graph model + scene builder  `2-4 weeks`
**Web:** `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/scene-builder.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/base-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/root-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/visual-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/video-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/image-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/text-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/sticker-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/graphic-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/color-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/blur-background-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/effect-layer-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/rendering/animation-values.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/rendering/index.ts`
**Browser deps:** `None intrinsic — pure data transform (JS Map + object spreads). Consumes @/timeline, @/media/types, @/project/types, @/rendering shapes`
**Depends on:** Timeline/state model (SceneTracks, elements, params), Media assets map, Animation transform readers, Effects & Masks value types

**Features**
- Walks SceneTracks bottom-to-top (overlays reversed, main last), filters hidden tracks/elements, emits one node per element
- Node kinds: Video, Image, Text, Sticker, Graphic, EffectLayer, Color, BlurBackground under a Root that carries total duration
- Background: ColorNode for solid/gradient (skips 'transparent'), or BlurBackgroundNode(s) over main-track media for blur
- Reads transform/opacity/blendMode from element.params via buildTransformFromParams/readOpacityFromParams/readBlendModeFromParams
- isPreview flag caps image source size to 2048px for preview; export uses full res
- Stable element sort by (startTime, id) for deterministic draw order

**Native approach** — crates: `(pure Rust, no external crate)`, `smallvec`, `glam`
Replace the class hierarchy (BaseNode/VisualNode subclasses) with a single enum RenderNode { Root{duration,children}, Video(VisualParams+VideoSource), Image, Text, Sticker, Graphic, Color{css}, BlurBackground, EffectLayer{effect_type,params,offset,duration} }. build_scene(canvas_size, tracks:&SceneTracks, media:&HashMap<MediaId,MediaAsset>, duration, background:&Background, is_preview:bool) -> RenderNode. Keep the exact bottom-to-top ordering and (startTime,id) sort. Transform/opacity/blend readers become pure fns over the params map. Lowest-risk port — already side-effect-free TS.

_Data structures:_ `enum RenderNode (tagged, owns children Vec)`, `struct VisualParams { time_offset, duration, trim_start, trim_end, retime:Option<RetimeConfig>, transform:Transform, animations:Option<ElementAnimations>, opacity:f32, blend_mode:BlendMode, effects:Vec<Effect>, masks:Vec<Mask> }`, `struct Transform { position:Vec2, scale:Vec2, rotate_deg:f32 }`, `enum Background { Color(String), Blur{intensity:f32} }`

_Risks:_
- Node identity/caching: TS stores `resolved` and per-node source caches (GraphicNode cachedKey, image/sticker module caches) ON the node object; an enum tree rebuilt each scene-change loses that. Move caches into a resolver-owned keyed store.
- buildTransformFromParams / blend-mode parsing must match the params-cluster registry exactly or transforms drift; needs a shared param-key contract test.

**Test cases**
- `scene-build-order` _(unit)_ — 3-overlay + main SceneTracks fixture: node order is bottom-to-top with main last and elements sorted by (startTime,id).
- `scene-build-background-color` _(unit)_ — Port of scene-builder-background.test.ts: Color('#ff0000') adds exactly one Color node; 'transparent' adds none; Blur adds BlurBackground nodes not Color.
- `scene-build-hidden-filter` _(unit)_ — Hidden tracks and hidden/absent-media elements are skipped; video whose asset type mismatches is dropped.
- `scene-build-golden-descriptor` _(golden)_ — Serialize the built RenderNode tree for a fixed multi-track fixture to JSON and diff against a committed snapshot (zero GPU).

---

#### Render-tree resolve (per-frame state sampling)  `1-2 months`
**Web:** `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/resolve.ts`
**Browser deps:** `videoCache.getFrameAt returns a frame whose .canvas is an OffscreenCanvas/VideoFrame-backed surface`, `loadImageSource uses HTMLImageElement + OffscreenCanvas downscale; loadStickerSource loads Iconify SVG URL as <img> at 200x200`, `getTextMeasurementContext() = Canvas2D context for measureText`, `async/Promise.all fan-out over children (decode + image load are async)`
**Depends on:** Media/decode cluster (frame provider, image decode), Animation cluster (transform/opacity/color/effect-param sampling), Text cluster (measure), Effects registry, Graphics param resolve, Stickers source bytes, time crate

**Features**
- Walks node tree; samples each node AT time; off-clip nodes resolve to null (clipTime<0 || >=duration)
- Video: source time = trimStart + getSourceTimeAtClipTime(retime); fetches decoded frame from videoCache.getFrameAt
- Image/Sticker: loads (cached) source, computes contain-scale transform + effect passes
- Graphic: resolves per-frame animated params (resolveGraphicElementParamsAtTime)
- Text: measures at localTime, resolves textColor/backgroundColor/strokeColor/strokeWidth (canvas-scaled), effect passes, measured layout
- BlurBackground: resolves backdrop frame + separable Gaussian passes (sigma from intensity scaled to res ref 1920x1080)
- EffectLayer: resolves scene-effect passes from registry, null if empty
- Contain-scale (min(w/sw,h/sh)) + effectWidth/Height for per-layer effect uniforms
- resolveEffectPassGroups: filters enabled effects, samples each effect's params at time (keyframeable) → EffectPass[][]

**Native approach** — crates: `image`, `resvg + usvg + tiny-skia (sticker SVG)`, `glam`, `(video decode from media cluster)`
Port resolveNode as a match over RenderNode producing a parallel Resolved tree (Option per node), same clip-window null semantics. Replace videoCache.getFrameAt with the media cluster's native frame API (owned RGBA buffer + wh, or a wgpu::Texture). Replace loadImageSource with the image crate (decode once, cache by path in a resolver HashMap, downscale via image::imageops for the 2048 preview cap). Replace sticker <img>+SVG with usvg::Tree::from_data + resvg::render into a tiny_skia::Pixmap at intrinsic size. Text measure delegates to the text cluster's native measure (cosmic-text/parley). For export use synchronous sequential decode (deterministic); for preview decode off-thread and reuse last frame (the loop already skips unchanged (frame,tree)).

_Data structures:_ `enum Resolved { VisualSource{transform,opacity,effect_passes:Vec<Vec<EffectPass>>,source:TextureSource,source_wh}, Text{..,measured:MeasuredText}, Graphic{..,resolved_params}, BlurBackground{backdrop:TextureSource,passes:Vec<EffectPass>}, EffectLayer{passes} }`, `enum TextureSource { Rgba(Arc<RgbaFrame>), Texture(wgpu::Texture), Canvas(SkPixmap) }`, `struct ResolveCtx { time:MediaTime, width, height, video:&dyn FrameProvider, images:&mut ImageCache }`

_Risks:_
- Async decode model: TS awaits every frame; a native preview must not block the UI thread. Needs a frame-provider returning last-good-frame while decode is in flight, or the compositor stalls. Trickiest behavioral port.
- Contain-scale + effectWidth/Height rounding (Math.round/Math.abs) must match TS bit-for-bit or effect radii shift a pixel and break tolerant goldens.
- Sticker source: web resolves an Iconify CDN URL — native must vendor sticker SVGs locally (no network in desktop core).
- getSourceTimeAtClipTime(retime) + roundMediaTime must use the already-native `time` crate to stay tick-exact with playback.

**Test cases**
- `resolve-clip-window` _(unit)_ — Node offset=10 duration=5 resolves Some at t=12, None at t=9 and t=15 (half-open).
- `resolve-contain-scale` _(unit)_ — 1920x1080 into 1280x720 with scaleX=2 → exact effectWidth/Height and center match TS reference.
- `resolve-effect-params-keyframed` _(property)_ — Keyframed blur intensity: resolved sigma at sampled times equals intensityToSigma(sample) within f32 eps.
- `resolve-source-time-retime` _(unit)_ — Video retime rate=2.0 trimStart=T → sourceTime tick-exact vs `time` crate.
- `resolve-sticker-svg` _(golden)_ — Rasterize a known sticker SVG at 200x200 via resvg → golden PNG, 0 tolerance.

---

#### Canvas2D -> native 2D rasterization (text, color/gradient, mask shapes, graphics)  `1-2 months`
**Web:** `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/canvas-utils.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/text-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/text/primitives.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/graphic-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/nodes/color-node.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/compositor/frame-descriptor.ts`
**Browser deps:** `OffscreenCanvas + OffscreenCanvasRenderingContext2D (createCanvasSurface)`, `ctx.fillText/strokeText/measureText/font/textAlign/textBaseline/letterSpacing/roundRect/fill(Path2D)/stroke(Path2D)/drawImage-with-transform`, `Path2D in mask/graphic definitions`, `CSS gradient parsing via drawCssBackground (createLinearGradient/createRadialGradient)`
**Depends on:** Text/fonts cluster (font DB, shaping), Graphics definitions, Masks builtin shape path builders, Gradients CSS parsing, Masks crate (JFA feather, native)

**Features**
- Color layer: solid fillRect OR CSS gradient (drawCssBackground) full-canvas
- Text layer: per-line fillText with letterSpacing, baseline, alignment, line-height, rounded-rect background, underline/line-through, stroke (strokeText under fill), font-size scaled to canvas height
- Graphic layer: definition.render draws rect/ellipse/polygon/star into a source canvas, cached by (definitionId,params)
- Mask shape layer: fillPath(Path2D)/drawOpaque/drawWithFeather then drawn through the element quad transform into a full-canvas mask texture
- Mask stroke layer: renderStroke or strokeFromPath as a separate overlay
- Blur backdrop: cover-scale draw of decoded frame full-canvas
- Outputs RGBA surfaces uploaded as textures; rendered textures content-hashed to skip redraw+reupload

**Native approach** — crates: `tiny-skia (deterministic CPU raster)`, `cosmic-text OR parley + swash/skrifa (shape+layout+glyph raster)`, `kurbo (paths)`, `resvg/usvg`, `csscolorparser + lightningcss (gradient strings)`, `OPTIONAL vello (GPU preview fast-path only)`
Introduce RasterSurface = tiny_skia::Pixmap (RGBA8 premultiplied — verify vs compositor). Each 'rendered' texture becomes fn(&mut Pixmap). Color/gradient: tiny_skia Paint SolidColor or Linear/RadialGradient from the parsed CSS; fill full canvas. Text: replace the Canvas2D stack with cosmic-text (Buffer with font/size/weight/style/line-height/letter-spacing, layout, SwashCache glyph raster at resolved color); rounded-rect bg via kurbo RoundedRect fill; stroke via glyph-outline stroking (skrifa outlines -> kurbo -> tiny_skia stroke) since cosmic-text has no strokeText; port visualCenterOffset/block metrics from layout.ts. Graphics: port each GraphicDefinition.render to a kurbo BezPath fill/stroke. Mask shapes: build shape path, fill white, apply quad transform (tiny_skia::Transform), rasterize canvas-sized alpha pixmap; feather>0 still goes to the native JFA masks crate. Upload pixmaps as wgpu textures. Keep the content-hash cache.

_Data structures:_ `struct RasterSurface(tiny_skia::Pixmap)`, `enum RenderedTexture { Color(String), Gradient(ParsedGradient), Text(Box<ResolvedText>), Graphic{def_id,params}, MaskShape{mask,transform}, MaskStroke{..}, BlurBackdrop{frame,cover} }`, `struct MeasuredText { lines:Vec<ShapedLine>, block:BlockMetrics, resolved_background:Option<TextBg>, visual_rect:Rect }`, `struct ParsedGradient { kind:Linear|Radial, stops:Vec<(f32,Color)>, geometry }`

_Risks:_
- TEXT IS THE HARDEST PART. Canvas2D fillText metrics (measureText width, actualBoundingBox, letterSpacing, default sans-serif fallback, baseline=middle) will NOT match cosmic-text pixel-for-pixel. Text goldens must be regenerated against the native raster (not shared with web); expect a multi-week tuning loop on line-break/centering/letter-spacing. Drives the whole effort estimate.
- Premultiplied vs straight alpha: tiny-skia is premultiplied; the layer.wgsl shader samples + applies opacity — verify the alpha convention end-to-end or edges halo.
- Font loading/fallback + color emoji: needs a FontSystem (fontdb) with bundled + system fonts and a fallback chain, plus emoji via swash. Cross-cluster with fonts.
- vello fast-path is alpha and non-deterministic across GPUs — keep it OUT of the golden path.
- CSS gradient parsing accepts arbitrary syntax from saved projects; prefer lightningcss to match browser semantics rather than a from-scratch parser.

**Test cases**
- `raster-color-fill` _(golden)_ — Solid color full-canvas → golden PNG, 0 tolerance.
- `raster-gradient` _(golden)_ — linear- and radial-gradient strings from a real project → golden PNG, small tolerance.
- `raster-text-basic` _(golden)_ — Multi-line centered text with letterSpacing + line-through + rounded bg → native golden PNG; assert deterministic across runs.
- `raster-text-stroke` _(golden)_ — Text with strokeWidth>0 renders outline under fill; golden PNG.
- `raster-graphic-shapes` _(golden)_ — rectangle/ellipse/polygon/star at 512px → golden PNG per shape.
- `raster-mask-shape-transform` _(golden)_ — Ellipse mask under a rotated/flipped quad transform → alpha golden PNG matching TS quad draw.
- `raster-text-measure-parity` _(unit)_ — measured block width/height and visualCenterOffset within an agreed epsilon of recorded reference values.

---

#### Frame-descriptor build + texture cache/bridge (serde boundary removal)  `1-2 weeks`
**Web:** `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/compositor/frame-descriptor.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/compositor/wasm-compositor.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/compositor/types.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/canvas-renderer.ts`, `/Users/himanshu/codes/synthai/vii/rust/crates/compositor/src/frame.rs`
**Browser deps:** `serde-wasm-bindgen: FrameDescriptor deserialized in rust/wasm/src/compositor.rs`, `opencut-wasm exports initCompositor/resizeCompositor/getCompositorCanvas/uploadTexture/releaseTexture/renderFrame/getLastFrameProfile`, `OffscreenCanvas backing store for rendered textures; uploadTexture does a GPU canvas import`, `WeakMap<object,number> for external identity; JSON.stringify for content hashes`, `HTMLCanvasElement mount (getCompositorCanvas)`
**Depends on:** Native compositor crate (exists), Media frame provider versioning, Raster subsystem (produces pixmaps)

**Features**
- Flattens the resolved tree into FrameDescriptor { width,height,clear,items[] } + a TextureUploadDescriptor list
- Each visual layer → {type:layer, textureId, quad transform (center/size/rotation/flip), opacity, blendMode, effectPassGroups, mask}
- Scene effects → {type:sceneEffect, effectPassGroups}
- Textures 'external' (media, cached by source identity via WeakMap counter) or 'rendered' (color/text/mask/graphic/blur, cached by contentHash string)
- syncTextures: diff descriptor ids vs cache → releaseTexture removed, upload new/changed; persistent OffscreenCanvas per rendered id redrawn only on hash change
- render(frame) = renderFrame into wgpu; getOutputCanvas mounts compositor canvas zero-copy
- CanvasRenderer.render orchestrates resolve → buildFrame → ensureInitialized(size) → syncTextures → renderFrame with perf spans

**Native approach** — crates: `reuse rust/crates/compositor frame.rs structs (ALREADY EXIST)`, `wgpu`, `ahash/fxhash`
This subsystem mostly EVAPORATES. The Rust FrameDescriptor/LayerDescriptor/QuadTransformDescriptor/LayerMaskDescriptor/EffectPassDescriptor already exist in frame.rs, so build_frame_descriptor constructs those structs in-process — NO serde, NO JS boundary. Replace the two-tier cache with a native TextureCache: external textures key by id + a source version (media provider bumps on change) instead of WeakMap identity; rendered textures key by content hash (reuse the exact TS hash strings or hash structurally). On change, rasterize into a pooled Pixmap and compositor.upsert_texture(id, wgpu_texture); on removal release_texture(id). Then Compositor::render_frame (surface preview) or render_frame_to_texture (export). CanvasRenderer becomes NativeRenderer owning GpuContext + Compositor + TextureCache. Keep the (frame,tree) skip-render optimization.

_Data structures:_ `struct TextureCache { rendered:HashMap<String,(Pixmap,ContentHash,u32,u32)>, external:HashMap<String,(SourceVersion,u32,u32)> }`, `reuse compositor::frame::FrameDescriptor et al (no new wire type)`, `struct NativeRenderer { gpu:GpuContext, compositor:Compositor, cache:TextureCache, width, height, fps }`

_Risks:_
- External-texture identity: WeakMap identity doesn't exist in Rust; the media frame provider must expose a stable id + version so the cache decides upload-vs-skip, else every frame re-uploads and tanks perf.
- content-hash strings currently include JSON.stringify(params) — define a stable, order-deterministic Rust serialization or hashes churn and defeat caching.
- Upload path: web imports a canvas via the driver; native uses queue.write_texture and must respect 256-byte row-pitch alignment.
- Pixel format: gpu crate uses Bgra8Unorm, tiny-skia is RGBA — needs a swizzle on upload or in-shader.

**Test cases**
- `framedesc-golden` _(golden)_ — Build the FrameDescriptor for a fixture resolved tree and diff serialized form vs committed snapshot (order, transforms, blend, mask, effect groups).
- `cache-skip-unchanged` _(unit)_ — Two identical builds produce identical content hashes and zero re-uploads (assert upload counter).
- `cache-release-removed` _(unit)_ — A layer present in frame N absent in N+1 triggers exactly one release_texture(id) + cache removal.
- `external-version-bump` _(unit)_ — Same external id with bumped version → one re-upload; unchanged version → none.
- `quad-transform-parity` _(unit)_ — computeVisualTransform (center,size,rotation,flipX/Y) matches TS for scaleX<0 flip and contain-scale.

---

#### wgpu compositor integration + GPU init (reuse native crate)  `2-4 weeks`
**Web:** `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/gpu-renderer.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/mask-feather.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/effect-preview.ts`, `/Users/himanshu/codes/synthai/vii/rust/wasm/src/compositor.rs`, `/Users/himanshu/codes/synthai/vii/rust/wasm/src/gpu.rs`, `/Users/himanshu/codes/synthai/vii/rust/crates/compositor/src/compositor.rs`
**Browser deps:** `opencut-wasm initializeGpu/applyEffectPasses/applyMaskFeather (wasm-bindgen)`, `wgpu surface bound to HtmlCanvasElement (SurfaceTarget::Canvas); WebGL vs WebGPU branch`, `OffscreenCanvas in/out of applyEffect/applyMaskFeather`, `compositor mounts getCompositorCanvas() into the DOM`
**Depends on:** gpu/compositor/effects/masks crates (exist), GPUI/window surface handle, Effects registry

**Features**
- initializeGpuRenderer / isGpuAvailable — GPU capability detection + degraded-mode fallback
- gpuRenderer.applyEffect (standalone effect chain on an OffscreenCanvas) — used for effect-preview thumbnails
- gpuRenderer.applyMaskFeather — standalone JFA feather on a mask canvas
- effectPreviewService: 160px effect thumbnail applying passes to a test image (/effects/preview.jpg)
- Compositor create/resize/present against a canvas surface (WebGPU) or WebGL texture path

**Native approach** — crates: `wgpu (Vulkan/Metal/DX12)`, `raw-window-handle (GPUI/winit surface)`, `pollster (block for export)`, `reuse compositor/effects/masks/gpu crates unchanged`
The compositing/effect/mask GPU code is already native and reused verbatim. Only the wasm boundary is replaced by a native GpuContext: request an Instance/Adapter/Device once at startup (native picks the real GPU; degraded = no adapter or software). Preview: create a wgpu::Surface from the GPUI window's raw-window-handle and call Compositor::render_frame each frame. Export: no surface — Compositor::render_frame_to_texture then copy the texture to a CPU buffer (map_async + poll) for ffmpeg. gpuRenderer.applyEffect/applyMaskFeather map to the effects/masks crates' apply_with_encoder against an offscreen texture (native GPUI panel requests a 160px thumbnail the same way). isGpuAvailable = adapter-request success; keep a CPU/degraded fallback (skip effects, simple blit).

_Data structures:_ `struct GpuRuntime { instance, adapter, device, queue, context:GpuContext }`, `enum RenderTarget { Surface(wgpu::Surface), OffscreenTexture(wgpu::Texture) }`, `struct ThumbnailRenderer (source texture + passes -> readback pixmap)`

_Risks:_
- The gpu crate's wasm feature enables wgpu/webgl + Bgra8Unorm; native must configure the surface format correctly (surface caps may prefer another format than Bgra8Unorm — present blit must match).
- Surface creation is GPUI/winit-specific (raw-window-handle version compatibility with wgpu 29) — known integration friction.
- Export readback (map_async) is async + needs device.poll; must not deadlock; use pollster + honor 256-byte row alignment.
- Degraded/no-GPU mode: desktop still needs output — decide hard-require GPU vs ship a llvmpipe/software fallback (bigger binary).

**Test cases**
- `gpu-init-headless` _(integration)_ — Request adapter/device headlessly (software adapter allowed in CI); GpuRuntime + Compositor::new succeed.
- `compositor-single-layer` _(golden)_ — Upload one solid texture, render_frame_to_texture, read back → expected fill within tolerance.
- `compositor-mask-feather` _(golden)_ — Layer + feathered ellipse mask → readback golden with tolerance (JFA wiring).
- `effect-preview-blur` _(golden)_ — Apply gaussian-blur passes to the test image at 160px → readback golden with tolerance.

---

#### Export pipeline + native muxing  `2-4 weeks`
**Web:** `/Users/himanshu/codes/synthai/vii/apps/web/src/services/renderer/scene-exporter.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/export/index.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/export/defaults.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/export/mime-types.ts`
**Browser deps:** `mediabunny (Output/Mp4OutputFormat/WebMOutputFormat/CanvasSource/AudioBufferSource) — WebCodecs encode+mux`, `WebCodecs AudioEncoder for aac-support probe`, `CanvasSource reads the compositor HTMLCanvasElement each frame (getOutputCanvas)`, `AudioBuffer (Web Audio) as mixed audio input`, `Blob / URL.createObjectURL / anchor download`, `eventemitter3`
**Depends on:** NativeRenderer offscreen readback, Audio cluster (mixed PCM buffer), time crate (ticks/fps), fps utils

**Features**
- SceneExporter: fresh CanvasRenderer at export res, frame-by-frame loop (frameCount = duration/ticksPerFrame), renders each frame, feeds CanvasSource to mediabunny
- Formats mp4 (avc/h264 + aac) and webm (vp9 + opus); quality tiers low/medium/high/very_high → mediabunny QUALITY_* bitrates
- Audio: optional single mixed AudioBuffer as AudioBufferSource; aac→opus fallback via AudioEncoder.isConfigSupported
- Progress/complete/error/cancelled events; cancellable mid-loop
- Output ArrayBuffer via BufferTarget; downloadBuffer creates Blob + object URL + <a> click
- PNG single-frame snapshot to file/clipboard (adjacent in renderer-manager)

**Native approach** — crates: `ffmpeg-sidecar (spawn ffmpeg, pipe raw RGBA frames) RECOMMENDED`, `OR ffmpeg-next (libav in-process, tighter control, hard Windows build)`, `OR video-rs`, `crossbeam-channel (progress)`, `reuse NativeRenderer.render_frame_to_texture + readback`
Reuse the offscreen render path: for each frame index i (timeTicks = i*ticksPerFrame), resolve+build+render_frame_to_texture at export res, read back to RGBA/BGRA, push to encoder. Recommend ffmpeg-sidecar: spawn `ffmpeg -f rawvideo -pix_fmt rgba -s WxH -r FPS -i pipe:0 [-i audio] -c:v libx264/libvpx-vp9 -b:v <bitrate> -c:a aac/opus out`, write frame bytes to stdin, parse progress from stderr. Map quality tiers to explicit bitrates (port qualityMap). Audio from the audio cluster's mixed PCM (createTimelineAudioBuffer equivalent) — second input pipe or temp WAV -i. Emit progress over a channel; cancel by killing the child + temp cleanup. downloadBuffer becomes a native save-file dialog/write. ffmpeg-next is the alternative for no external binary + exact codec control at a much harder cross-platform build.

_Data structures:_ `struct ExportParams { width,height,fps:FrameRate, format:ExportFormat, quality:ExportQuality, include_audio:bool, audio:Option<PcmBuffer> }`, `enum ExportFormat { Mp4, Webm } / enum ExportQuality { Low,Medium,High,VeryHigh }`, `enum ExportEvent { Progress(f32), Complete(PathBuf), Error(String), Cancelled }`, `struct FrameReadback { rgba:Vec<u8>, width, height }`

_Risks:_
- ffmpeg-sidecar ships/downloads a ~100MB ffmpeg binary and depends on it at runtime — licensing (libx264 GPL) + bundling story must be decided; ffmpeg-next avoids the sidecar but is a brutal Windows build.
- Frame timing: web uses variable-duration CanvasSource.add(time,1/fps); native rawvideo assumes CFR — confirm the timeline is CFR at export (it is, ticksPerFrame fixed) or emit explicit PTS.
- GPU→CPU readback per frame is the bottleneck; double-buffer readback vs encode to keep ffmpeg fed.
- Color: compositor is Bgra8Unorm — pass -pix_fmt bgra or swizzle, else colors invert.
- Audio codec fallback logic simplifies vs WebCodecs since ffmpeg always has aac/opus.

**Test cases**
- `export-framecount` _(unit)_ — frameCount = floor(duration/ticksPerFrame) and timeTicks = i*ticksPerFrame match TS for 24/30/29.97 fps.
- `export-short-mp4` _(integration)_ — Export 1s solid-color timeline to mp4; ffprobe: 1 video track, duration±1 frame, WxH; first frame decodes to expected color (tolerant golden).
- `export-webm-vp9` _(integration)_ — Same for webm/vp9; ffprobe container + codec.
- `export-with-audio` _(integration)_ — Export with a mixed sine PCM; audio track present, sample-rate/channels preserved, A/V durations align.
- `export-cancel` _(unit)_ — Cancel mid-loop kills the encoder, emits Cancelled, leaves no partial output/temp files.
- `export-progress-monotonic` _(property)_ — Progress events non-decreasing in [0,1], ending at 1.0 on success.

---

#### Pure geometry: hit-test, element bounds, coordinate transforms, snapping  `2-4 weeks`
**Web:** `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/hit-test.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/element-bounds.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/preview-coords.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/preview-snap.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/zoom.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/overlays.ts`
**Browser deps:** `DOMRect in screenToCanvas (replaceable with a plain rect)`, `text bounds calls measureTextElement via a throwaway document.createElement('canvas') 2D context — the ONLY browser touch`, `everything else pure trig/number math`
**Depends on:** Text cluster (native measure), Animation transform sampling, Timeline element/media types

**Features**
- point-in-rotated-rect hit testing; getHitElements returns top-to-bottom stack; resolvePreferredHit biases toward selected
- getVisibleElementsWithBounds: per-element bounds at currentTime (video/image/sticker/graphic via contain-scale, text via measured visualRect) with animated transform
- corner/edge/rotation handle positions from bounds
- screen↔canvas↔overlay coordinate transforms with pan/zoom
- snapping: snapScale/snapScaleAxes/snapRotation (90° steps, 5° threshold), snap lines to canvas center/edges, MIN_SCALE clamp, screen-pixel→logical thresholds
- zoom clamp, pan bounds

**Native approach** — crates: `glam`, `(otherwise pure Rust)`
Port straight into opencut-core as framework-agnostic geometry — high-value shared logic the GPUI shell reuses. point_in_rotated_rect, hit_test, resolve_preferred_hit, get_visible_elements_with_bounds, corner/edge positions, screen_to_canvas/canvas_to_overlay/position_to_overlay, and the snap fns port 1:1 (pure). Replace DOMRect with a Rect struct. The one dependency is text bounds: route measureTextElement to the native text-cluster measure (same as resolve), not a canvas. Keep the exact contain-scale + rotation math so handles land where the compositor draws pixels. Expose as a preview_geometry module used by both the renderer (overlays) and the GPUI interaction layer.

_Data structures:_ `struct ElementBounds { center:Vec2, size:Vec2, rotation_deg:f32 }`, `struct ElementWithBounds { track_id, element_id, element_ref, bounds }`, `struct ViewportGeometry { canvas:Vec2, center:Vec2, scale:f32, viewport:Vec2 }`, `struct SnapLine { axis:Axis, position:f32 } / struct SnapResult`

_Risks:_
- Text bounds needs native text measurement to match the raster subsystem exactly, or selection handles won't align with rendered glyphs (double dependency on text).
- Snap thresholds are in screen pixels — must thread the real device scale factor from GPUI.
- Half-open interval and (startTime,id) sort must match scene-builder so hit order == draw order.

**Test cases**
- `hit-rotated-rect` _(property)_ — Random rects+rotations: a point mapped into local space is inside the half-extents iff pointInRotatedRect true (inverse-rotation round trip).
- `hit-stack-order` _(unit)_ — Overlapping elements: getHitElements returns topmost-first matching draw order; resolvePreferredHit picks selected even if lower.
- `coords-roundtrip` _(property)_ — screenToCanvas ∘ canvasToOverlay-inverse round-trips within eps across pan/zoom.
- `snap-rotation-90` _(unit)_ — Rotation within 5° of a 90° step snaps; outside does not; shift disables.
- `bounds-contain-scale` _(unit)_ — video/image/sticker/graphic bounds equal getVisualElementBounds reference for asymmetric scale + rotation.

---

#### Interactive preview viewport + transform/mask handle controllers (UI shell)  `1-2 months`
**Web:** `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/index.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/preview-viewport.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/transform-handles.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/handle-primitives.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/mask-handles.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/preview-interaction-overlay.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/overlay-layer.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/snap-guides.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/text-edit-overlay.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/toolbar.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/context-menu.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/cursors.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/components/guide-popover.tsx`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/controllers/preview-interaction-controller.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/controllers/transform-handle-controller.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/hooks/use-preview-interaction.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/hooks/use-transform-handles.ts`, `/Users/himanshu/codes/synthai/vii/apps/web/src/preview/preview-store.ts`
**Browser deps:** `React 19 hooks (useRafLoop, useContainerSize, useFullscreen, useSyncExternalStore via useEditor)`, `DOM pointer events + setPointerCapture/releasePointerCapture`, `WheelEvent (deltaMode normalization), requestAnimationFrame`, `contentEditable + CSS (-webkit-text-stroke) for text edit overlay`, `HTML/CSS absolute overlays; Radix context menu; use-deep-compare-effect`, `the compositor HTMLCanvasElement mounted into a div`
**Depends on:** Pure geometry subsystem, NativeRenderer, Timeline preview-overlay API (state cluster), Masks cluster (mask handle params), Text cluster (edit overlay), GPUI shell

**Features**
- Preview panel: mounts the compositor canvas zero-copy, RAF loop skipping unchanged (frame,tree), wheel pan/zoom (ctrl=zoom, exp curve, capped), fullscreen
- RenderTreeController: rebuilds the scene on deep changes (tracks/media/background/size) and pushes to the renderer
- Transform handles: corner-scale (uniform), edge-scale (per-axis), rotation — live preview via previewElements/commitPreview/discardPreview (single undo entry), scale-animation reset when keyframed, snapping + guides, pointer capture
- Mask handles: SDF-based mask shape param editing (305 LOC)
- Text edit overlay: contentEditable WYSIWYG matching the render (font, stroke, alignment)
- Overlay plugin planes (under/over interaction), snap guide lines, cursors, context menu, toolbar

**Native approach** — crates: `gpui (0.2.2)`, `reuse preview_geometry (pure) + NativeRenderer`
The GPUI UI shell, built LAST per the core-first plan. The heavy math is in the pure-geometry subsystem and the controllers are state machines. Port TransformHandleController + PreviewInteractionController as plain Rust structs — they already take adapter traits (viewport/input/scene/timeline). Only React glue (hooks, pointer wiring, DOM overlays, contentEditable) is rewritten in GPUI: render compositor output into a GPUI element (share the wgpu surface or blit a texture), draw handles/snap-guides as GPUI elements positioned via preview_geometry, translate GPUI mouse/scroll into onPointerDown/Move/Up. previewElements/commitPreview/discardPreview map to the timeline manager preview-overlay API (state cluster). Text editing overlay becomes a GPUI text input mirroring the raster layout.

_Data structures:_ `enum TransformSession { Idle, CornerScale{..}, EdgeScale{..}, Rotation{..} } (ports 1:1)`, `trait ViewportAdapter/InputAdapter/SceneReader/TimelineOps (already the TS interface shape)`, `struct PreviewView (GPUI element owning renderer + controllers)`

_Risks:_
- GPUI is young (0.2.2), sparsely documented; embedding a wgpu-rendered texture into a GPUI element / sharing the device is unproven — likely the biggest UI integration risk in the whole port.
- Pointer capture + high-frequency move events must drive preview/commit without flooding undo (overlay preview is state-cluster-owned).
- contentEditable WYSIWYG has no direct GPUI equivalent — needs a custom text input mirroring the raster layout exactly (ties to the text raster risk).
- Mask handles (SDF param editing, 305 LOC) depend on the masks cluster param model.
- This is UI, not core — keep it out of opencut-core; only controllers/geometry belong in core.

**Test cases**
- `controller-corner-scale` _(unit)_ — CornerScaleSession: down at a corner + move → previewElements gets expected scaleX/scaleY (distance ratio) and clears scale animation when keyframed; commit → single snapshot.
- `controller-edge-scale-axis` _(unit)_ — EdgeScale 'right' changes only scaleX using rotation-projected delta; 'bottom' only scaleY.
- `controller-rotation-wrap` _(property)_ — Rotation delta wraps correctly across ±180° and snaps to 90° unless shift held.
- `controller-discard-on-cancel` _(unit)_ — cancel()/destroy() calls discardPreview and releases pointer capture, leaving no committed change.
- `preview-skip-unchanged` _(unit)_ — Render loop with identical (frame,tree) invokes renderer zero times; changing time or tree invokes exactly once.
- `preview-e2e-drag` _(manual)_ — In the GPUI shell, drag a corner handle: composited layer scales live and produces one undo entry.

## Effects, animation/keyframes & masks
Cluster crux: three concerns share the same shape — a data-driven registry of definitions (EffectDefinition / MaskDefinition), a per-frame *sampling* layer (channel/curve math, effect-param resolution, mask shape geometry), and a *rasterization/GPU* layer. The GPU layer is ALREADY native Rust (rust/crates/effects: gaussian-blur + brightness pipelines with uniform packing + tests; rust/crates/masks: JFA-SDF two-sided distance + analytic feather, but GPU-untested). What is still TS and must be ported is (a) all channel/curve MATH (bezier solve, interpolation, extrapolation, normalization, clamp/split, curve<->normalized-cubic-bezier bridge), (b) the effect registry + per-effect uniform BUILDERS (currently TS closures; Rust pack_effect_uniforms hard-codes per shader and rejects unknown uniforms — the two representations are duplicated and must be unified), and (c) mask SHAPE RASTERIZATION, which today runs entirely on browser Canvas2D Path2D + OffscreenCanvasRenderingContext2D (fill/stroke/createLinearGradient) inside frame-descriptor.buildMaskArtifacts, then uploads the alpha texture to wgpu. That Canvas2D dependency is the single biggest native gap in the cluster; tiny-skia is the drop-in CPU replacement (same fill/stroke/linear-gradient/clip model), with kurbo for curve math and cosmic-text+swash for the text mask. IMPORTANT correctness facts to preserve on port: (1) keyframe times are MediaTime integer ticks RELATIVE to element start, resolved via getElementLocalTime clamped to [0,duration]; the tick math already lives in the Rust `time` crate so channel math must consume MediaTime, not seconds. (2) bezier segments solve *progress-for-time* by 20-iteration bisection over the time-axis cubic, THEN evaluate the value-axis cubic — a naive t-uniform sampling will not match. (3) color paths are COMPOSITE channels (r/g/b/a scalar sub-channels in linear RGBA) — resolve/keyframe-query fold them back to a formatted color string; discrete channels are step-held. (4) split mask zeroes GPU feather and bakes a linear-gradient feather on the CPU (frame-descriptor.ts:408) to avoid JFA's two-sided edge artifact — the native rasterizer must reproduce drawWithFeather vs drawWithFeather-fastpath vs fillPath branching. (5) only masks[0] is honored today (frame-descriptor.ts:388). Only ONE effect (blur) is user-registered though the Rust pipeline also carries brightness; adding effects is the stated product goal, so the native EffectDefinition representation should make uniform-building data-driven rather than a Rust match arm per shader. Suggested Cargo layout: extend rust/crates/effects with a platform-agnostic `registry`/`definition` module (no wgpu), add a new rust/crates/animation crate (pure math, depends on `time`), and add a rust/crates/mask-raster module (tiny-skia, no wgpu) feeding the existing rust/crates/masks GPU feather. Graph-editor UI and mask-handle hooks are React/SVG/pointer/localStorage and are GPUI rewrites, but their underlying math (snap, geometry, computeParamUpdate, curve-bridge, easing presets) is pure and ports with the core.

#### animation-channel-curve-math  `1-2 weeks`
**Web:** `apps/web/src/animation/types.ts`, `apps/web/src/animation/bezier.ts`, `apps/web/src/animation/interpolation.ts`, `apps/web/src/animation/resolve.ts`, `apps/web/src/animation/values.ts`, `apps/web/src/animation/channel-data.ts`, `apps/web/src/animation/path.ts`, `apps/web/src/animation/property-groups.ts`, `apps/web/src/animation/index.ts`, `apps/web/src/rendering/animation-values.ts`, `apps/web/src/animation/__tests__/animated-params.test.ts`
**Browser deps:** `MediaTime brand from @/wasm (integer ticks) — already backed by the native `time` crate, only a numeric newtype at runtime`, `no DOM/Canvas/GPU — pure arithmetic; @/utils/math clamp and @/params color parsing are the only non-time imports`
**Depends on:** time crate (MediaTime tick math), params color parse/format (parseColorToLinearRgba/formatLinearRgba)

**Features**
- ANIMATION_PROPERTY_PATHS (transform.positionX/Y, scaleX/Y, rotate, opacity, volume, color, background.color/paddingX/Y/offsetX/Y/cornerRadius) + dynamic GraphicParamPath (params.<key>) and EffectParamPath (effects.<id>.params.<key>)
- ScalarChannel (keys + before/after extrapolation hold|linear) and DiscreteChannel; composite ChannelData for colors (r/g/b/a leaf channels in linear RGBA)
- getScalarChannelValueAtTime: sort+normalize keys, clamp handles to neighbor span, before-first/after-last extrapolation, per-segment step|linear|bezier
- bezier segment eval: solveBezierProgressForTime (20-iter bisection on time-axis cubic) then getBezierPoint on value-axis cubic; default 1/3-span handles
- getDiscreteChannelValueAtTime (last key at/before time, step-held)
- resolveAnimationPathValueAtTime overloads (number/string/boolean/color) + composite color fold via parseColorToLinearRgba/formatLinearRgba
- getElementLocalTime: timelineTime - elementStart clamped to [0,duration]
- resolveTransformAtTime / resolveOpacityAtTime / resolveNumberAtTime / resolveColorAtTime consumed per-frame by the render tree
- channel-data type guards (leaf vs composite), legacy storage-key filtering (bindings/channels)

**Native approach** — crates: `time (existing workspace crate)`, `serde`, `serde_json`, `palette or a small linear-rgba helper`, `proptest (dev)`, `approx (dev)`
New pure crate rust/crates/animation depending only on `time`. Mirror the TS enums as Rust enums (ScalarSegmentType, TangentMode, ChannelExtrapolationMode) and structs (ScalarAnimationKey{ id:String, time:MediaTime, value:f32, left_handle:Option<CurveHandle>, right_handle:Option<CurveHandle>, segment_to_next, tangent_mode }, ScalarChannel, DiscreteChannel, ChannelData::Leaf|Composite(BTreeMap<String,Channel>)). Port getScalarChannelValueAtTime byte-for-byte including the 20-iteration bisection (keep iteration count to match float output). Represent ElementAnimations as BTreeMap<String,ChannelData> keyed by path string so dynamic effect/graphic paths work unchanged. Color fold uses linear-RGBA f32 components. Expose resolve_transform_at_time/opacity/number/color for the compositor scene-builder to call.

_Data structures:_ `ScalarAnimationKey`, `CurveHandle{dt:MediaTime, dv:f32}`, `ScalarChannel{keys:Vec, extrapolation:Option<(before,after)>}`, `DiscreteChannel`, `enum ChannelData { Leaf(Channel), Composite(BTreeMap<String,Channel>) }`, `ElementAnimations = BTreeMap<String,ChannelData>`, `enum AnimationValue { Number(f32), Color([f32;4]), Discrete(DiscreteValue) }`

_Risks:_
- f32 vs JS f64: bisection midpoints and lerp must match TS closely for golden parity — decide tolerance or replicate in f64 then downcast
- handle normalization clamps to neighbor span and depends on sort stability; JS sort is stable, Rust sort_by is stable — OK but tie-break on equal times must match
- color round-trip through parse/format linear RGBA must match the TS @/params implementation exactly (gamma, clamping, hex formatting)
- BTreeMap ordering differs from JS insertion order for getElementKeyframes enumeration — preserve deterministic order but verify UI ordering expectations

**Test cases**
- `anim-math-golden-bezier` _(golden)_ — Sample a bezier segment (asymmetric handles) at 32 uniform times; compare to captured TS getScalarChannelValueAtTime output within tolerance
- `anim-math-prop-normalize-idempotent` _(property)_ — normalizeScalarChannel(normalize(x)) == normalize(x) for random key sets
- `anim-math-prop-time-monotonic` _(property)_ — for strictly increasing time within a monotonic segment, solved progress is non-decreasing (bisection correctness)
- `anim-math-unit-extrapolation` _(unit)_ — before/after hold vs linear extrapolation past first/last key with 0/1/2 keys
- `anim-math-unit-discrete-step` _(unit)_ — discrete channel returns last key at/before time; empty channel returns fallback
- `anim-math-unit-color-composite` _(unit)_ — composite r/g/b/a channels fold to expected formatted color; missing channel uses fallback component
- `anim-math-golden-transform` _(golden)_ — resolveTransformAtTime over a keyframed clip matches TS animated-params.test.ts fixtures

---

#### animation-keyframe-crud  `2-4 weeks`
**Web:** `apps/web/src/animation/keyframes.ts`, `apps/web/src/animation/keyframe-query.ts`, `apps/web/src/animation/curve-bridge.ts`, `apps/web/src/animation/graph-channels.ts`, `apps/web/src/commands/timeline/element/keyframes/`, `apps/web/src/commands/timeline/element/effects/`, `apps/web/src/commands/timeline/element/masks/`
**Browser deps:** `MediaTime + roundMediaTime from @/wasm (native `time` crate)`, `generateUUID / id utils for new keyframe ids (crypto.randomUUID in browser)`, `no DOM — pure state transforms; consumed by undo/redo commands`
**Depends on:** animation-channel-curve-math, time crate, timeline element/command layer (out-of-cluster boundary)

**Features**
- keyframe CRUD: getChannel, upsertPathKeyframe, upsertKeyframe, removeKeyframe, retimeKeyframe, setChannel, setBindingComponentChannel, updateScalarKeyframeCurve
- channel lifecycle: cloneAnimations (fresh keyframe ids), clampAnimationsToDuration, splitAnimationsAtTime, removeElementKeyframe, retimeElementKeyframe
- keyframe-query: getElementKeyframes (dedup across composite components, prefer componentIndex 0), hasKeyframesForPath, getKeyframeAtTime, getKeyframeById, per-keyframe interpolation label
- curve-bridge: getNormalizedCubicBezierForScalarSegment / getCurveHandlesForNormalizedCubicBezier (handle<->[x1,y1,x2,y2] with flat-segment referenceSpanValue fallback, roundMediaTime on dt)
- graph-channels: getEditableScalarChannels/getEditableScalarChannel/getScalarKeyframeContext (easingMode shared vs independent for r/g/b/a), keyframe neighbor context for the graph editor
- tangent modes auto|aligned|broken|flat and segment types step|linear|bezier maintained on edit

**Native approach** — crates: `time (existing)`, `uuid`, `serde`, `im or standard clone (persistent maps optional)`, `proptest (dev)`
Add a keyframe module to rust/crates/animation. All functions are pure (animations in, animations out) so they port to functions returning owned ElementAnimations. Keep the exact dedup rule in getElementKeyframes (sort by time then componentIndex, collapse equal-time matches preferring componentIndex 0). curve-bridge stays f32/MediaTime with the same clamp01 and roundMediaTime rounding. Replace generateUUID with uuid::Uuid::new_v4 behind a trait/injected id-source so tests can seed deterministic ids (mirrors buildSeparatedAudioElement fresh-id cloning). These functions back the GPUI/MCP editing commands; wire them into a command/undo layer owned by the timeline cluster, not here.

_Data structures:_ `reuse ElementAnimations/ScalarChannel from animation-channel-curve-math`, `NormalizedCubicBezier = [f32;4]`, `ScalarCurveKeyframePatch`, `ScalarGraphKeyframeContext{ channel, keyframe, index, prev, next }`, `trait IdSource for deterministic keyframe ids`

_Risks:_
- keyframes.ts is ~30k of edge-case-heavy logic (clamp-to-duration, split-at-time, retime with re-sort) — highest port surface in the cluster; needs faithful golden fixtures
- id generation nondeterminism breaks golden tests unless injected
- clampAnimationsToDuration and splitAnimationsAtTime interact with element trim/retime semantics owned by the timeline cluster — contract must be agreed at the boundary
- shared-vs-independent easing mode inference for color channels must match to keep graph editor behavior

**Test cases**
- `kf-crud-unit-upsert-remove` _(unit)_ — upsertKeyframe adds/updates by id and time; removeKeyframe drops it; empty channel is pruned
- `kf-crud-unit-retime-resort` _(unit)_ — retimeKeyframe past a neighbor re-sorts and re-normalizes handles
- `kf-crud-prop-clone-fresh-ids` _(property)_ — cloneAnimations preserves times/values/curves but assigns all-new unique ids
- `kf-crud-golden-split` _(golden)_ — splitAnimationsAtTime on a multi-channel clip matches TS output (left/right partition + boundary keyframe)
- `kf-crud-golden-query-dedup` _(golden)_ — getElementKeyframes over composite color channel dedups to one keyframe per time (componentIndex-0 preference)
- `kf-curve-bridge-roundtrip` _(property)_ — handles->normalized cubic->handles round-trips within epsilon incl. flat-segment referenceSpanValue path

---

#### animation-param-channels  `days`
**Web:** `apps/web/src/animation/effect-param-channel.ts`, `apps/web/src/animation/graphic-param-channel.ts`, `apps/web/src/animation/graph-channels.ts`, `apps/web/src/animation/property-groups.ts`
**Browser deps:** `none beyond animation-channel-curve-math; string path parsing only`
**Depends on:** animation-channel-curve-math, effects-registry (ParamValue type), params registry

**Features**
- effect param path build/parse/is (effects.<id>.params.<key> with EFFECT_PARAM_PATH_PREFIX/SUFFIX)
- resolveEffectParamsAtTime: per-param, use animated channel if present else static value (drives GPU uniform inputs per frame)
- removeEffectParamKeyframe / graphic param channel equivalents
- ANIMATION_PROPERTY_GROUPS linking transform.scale -> scaleX/scaleY for grouped editing

**Native approach** — crates: `time (existing)`, `serde`
Small module in rust/crates/animation. Path build/parse is pure string work; effectId may itself contain dots so replicate the exact indexOf(SUFFIX) split (not a naive rsplit). resolve_effect_params_at_time takes a param map + animations and returns resolved ParamValues; it is the bridge that feeds the effects uniform builders each frame, so it must live where both the animation crate and the effects registry can call it (or expose a callback). Keep property-group linkage as static data.

_Data structures:_ `ParamValues = BTreeMap<String, ParamValue>`, `enum ParamValue { Number(f32), Color(String), Bool(bool), Str(String), ... }`, `EffectParamPath newtype`

_Risks:_
- effectId containing the SUFFIX substring would mis-parse — must match TS separatorIndex logic exactly
- ParamValue enum must be shared with the params/effects registry to avoid a second value type
- motion-preset feature (planned) remaps effects.<id>.params.* paths when stamping presets — id-remap helper should live here

**Test cases**
- `param-ch-unit-path-roundtrip` _(unit)_ — build/parse effect param path round-trips; ids with dots and empty key rejected
- `param-ch-unit-resolve-mixed` _(unit)_ — resolveEffectParamsAtTime returns animated value for keyframed params, static for others
- `param-ch-prop-id-remap` _(property)_ — remapping effect ids consistently rewrites matching animation path prefixes and nothing else

---

#### animation-graph-editor-ui  `1-2 months`
**Web:** `apps/web/src/timeline/components/graph-editor/bezier-graph.tsx`, `apps/web/src/timeline/components/graph-editor/use-controller.ts`, `apps/web/src/timeline/components/graph-editor/easing-presets.ts`, `apps/web/src/timeline/components/graph-editor/custom-presets-store.ts`, `apps/web/src/timeline/components/graph-editor/session.ts`, `apps/web/src/timeline/components/graph-editor/popover.tsx`
**Browser deps:** `React 19 + JSX components`, `SVG/DOM rendering of curve and handles, pointer events for dragging`, `localStorage persistence (custom presets)`, `useSyncExternalStore subscription pattern`
**Depends on:** animation-keyframe-crud, animation-channel-curve-math (curve-bridge), GPUI shell, desktop persistence layer

**Features**
- interactive bezier curve editor: drag keyframes and left/right handles, tangent-mode aware (auto/aligned/broken/flat)
- easing presets (built-in + custom NormalizedCubicBezier), apply preset to a segment
- custom-presets-store: hand-rolled useSyncExternalStore over localStorage key 'graph-editor-presets' (EasingPreset[] {id,label,value,isCustom})
- edit session lifecycle (batch a drag into one undo step), popover UI

**Native approach** — crates: `gpui (0.2.2)`, `the native animation crate for curve math + curve-bridge`, `serde_json for preset persistence`, `directories/OS config path for preset storage`
UI rewrite in GPUI: render the curve by evaluating getBezierPoint over the segment and draw keyframe/handle affordances; hit-test handles and translate drag deltas into CurveHandle updates via the already-ported curve-bridge and updateScalarKeyframeCurve. Replace localStorage with a small JSON file in the app config dir (or the storage layer the desktop app adopts). Keep EasingPreset as data and share built-in presets with any MCP surface. Tangent-mode constraint logic (aligned keeps handles collinear, flat zeroes slope) is pure and should be extracted into the animation crate so both UI and headless edits use it.

_Data structures:_ `EasingPreset{ id:String, label:String, value:[f32;4], is_custom:bool }`, `GraphEditSession (batched edit + undo token)`, `reuse ScalarGraphKeyframeContext`

_Risks:_
- pointer-precision and pixel<->time/value mapping must feel identical; different from web coordinate mapping
- custom preset store format should stay JSON-compatible if presets ever migrate from the web app
- tangent-mode auto-smoothing math is currently entangled in the React controller — extract before UI work or it gets reimplemented twice

**Test cases**
- `graph-ui-unit-preset-persist` _(unit)_ — save/remove custom preset persists and reloads from the config file
- `graph-ui-unit-tangent-modes` _(unit)_ — aligned keeps handles collinear, flat produces zero-slope handles, broken is independent
- `graph-ui-manual-drag` _(manual)_ — drag a handle in the running GPUI app and confirm the preview curve/keyframe updates and batches into one undo
- `graph-ui-golden-preset-apply` _(golden)_ — applying a built-in easing preset yields the same handle values as the web easing-presets.ts

---

#### effects-registry-and-definitions  `1-2 weeks`
**Web:** `apps/web/src/effects/types.ts`, `apps/web/src/effects/registry.ts`, `apps/web/src/effects/index.ts`, `apps/web/src/effects/definitions/index.ts`, `apps/web/src/effects/definitions/blur.ts`, `apps/web/src/effects/definitions/brightness.ts`, `apps/web/src/effects/__tests__/brightness.test.ts`, `apps/web/src/effects/components/effects-tab.tsx`, `apps/web/src/effects/components/assets-view.tsx`, `apps/web/src/services/renderer/resolve.ts`
**Browser deps:** `none intrinsic — pure config + math; generateUUID for instance ids; effects-tab.tsx/assets-view.tsx are React panels`
**Depends on:** params registry (ParamDefinition/ParamValue), rust/crates/effects GPU pipeline (consumer), animation-param-channels (animated effect params feed uniforms)

**Features**
- Effect instance {id,type,params,enabled} vs EffectDefinition {type,name,keywords,params:ParamDefinition[], renderer}
- EffectsRegistry (DefinitionRegistry) + registerDefaultEffects (blur only user-facing today)
- resolveEffectPasses: definition -> EffectPass[] {shader, uniforms} via per-pass uniform closures OR buildPasses
- buildDefaultEffectInstance (buildDefaultParamValues from ParamDefinition), EFFECT_TARGET_ELEMENT_TYPES = visual elements
- blur pass math: intensityToSigma (reference 1920x1080), buildGaussianBlurPasses (separable H/V, iteration count from sigma, per-pass sigma/step clamps, MAX_ITERATIONS=8)
- resolveEffectPassGroups filters/chains passes in the render resolve
- data-driven param panel + keyword search browse list

**Native approach** — crates: `serde`, `uuid`, `existing rust/crates/effects (extend with a no-wgpu registry module)`
The core problem is the TS uniform BUILDER closures have no serializable form and the Rust pack_effect_uniforms hard-codes each shader's uniform contract (match arm per shader, rejects unknown names). Unify by defining a native EffectDefinition in Rust: params:Vec<ParamDefinition>, plus a UniformBuilder per pass expressed either as (a) a Rust fn keyed by effect type in a registry (simplest, matches how the GPU crate already dispatches), or (b) a small data-driven UniformSpec (e.g. u_sigma = intensityToSigma(intensity, resolution, ref)) evaluated at frame time. Port intensityToSigma and buildGaussianBlurPasses verbatim (integer iteration ceil, sqrt split, MAX_SINGLE_PASS_SIGMA=10/MAX_STEP=4/MAX_ITERATIONS=8). resolveEffectPasses becomes a method that yields Vec<EffectPass> (the same type effects/types.rs already defines) so the existing pipeline consumes it directly — closing the TS/Rust duplication. Keep a DefinitionRegistry<String,EffectDefinition> with keyword search for the browse UI/MCP.

_Data structures:_ `EffectDefinition{ type_:String, name, keywords:Vec<String>, params:Vec<ParamDefinition>, renderer:EffectRenderer }`, `enum EffectRenderer { Passes(Vec<PassTemplate>), Dynamic(fn(&ParamValues,u32,u32)->Vec<EffectPass>) }`, `reuse effects::EffectPass{shader:String, uniforms:HashMap<String,UniformValue>}`, `ParamDefinition (shared with params/masks registries)`

_Risks:_
- uniform builders as closures do not serialize — must pick fn-registry vs mini-expression-language; fn-registry is pragmatic but means each new effect still needs a Rust code change (acceptable given shaders already do)
- float parity of intensityToSigma/iteration count vs TS for golden pass lists
- pack_effect_uniforms currently DUPLICATES the uniform contract; if registry emits uniforms, decide single source of truth to avoid drift (the current UnsupportedUniform errors are a symptom of this split)
- ParamDefinition/ParamValue types are shared across effects+masks+params — unify once

**Test cases**
- `effects-reg-unit-register-get` _(unit)_ — after registerDefaultEffects, registry.get('blur') exists; unknown type errors; keyword search finds it
- `effects-reg-unit-default-instance` _(unit)_ — buildDefaultEffectInstance yields default param values from ParamDefinition and enabled=true
- `effects-reg-golden-blur-passes` _(golden)_ — buildGaussianBlurPasses at sigma spanning 1..8 iterations matches TS pass count and per-pass sigma/step/direction
- `effects-reg-unit-intensity-sigma` _(unit)_ — intensityToSigma matches TS at reference and scaled resolutions incl. 0.001 floor
- `effects-reg-unit-uniform-contract` _(unit)_ — resolved passes feed pack_effect_uniforms without UnsupportedUniform/MissingUniform for blur and brightness

---

#### effects-gpu-pipeline  `1-2 weeks`
**Web:** `rust/crates/effects/src/pipeline.rs`, `rust/crates/effects/src/types.rs`, `rust/crates/effects/src/effects.rs`, `rust/crates/effects/src/shaders/gaussian_blur.wgsl`, `rust/crates/effects/src/shaders/brightness.wgsl`, `apps/web/src/services/renderer/compositor/frame-descriptor.ts (effectPassGroups build)`
**Browser deps:** `ALREADY NATIVE — wgpu 29 + bytemuck; wasm feature only toggles wgpu/webgl backend. No browser dependency to remove; native build just drops the wasm cfg.`
**Depends on:** effects-registry-and-definitions (pass source), gpu crate (GpuContext), compositor cluster (texture format/handoff)

**Features**
- EffectPipeline: shared fullscreen vertex + per-shader fragment, ping-pong render-texture chain over EffectPass[] (apply / apply_with_encoder)
- gaussian-blur (separable, +/-30 tap loop, sigma/step/direction uniforms) and brightness pipelines registered in a HashMap
- pack_effect_uniforms: per-shader uniform packing into shared EffectUniformBuffer{resolution,direction,scalars[4]} with strict validation (Missing/Invalid/Unsupported/UnknownShader)
- EffectsError typed errors; unit tests for uniform packing (GPU pipeline itself untested by convention)

**Native approach** — crates: `wgpu (29, existing)`, `bytemuck (existing)`, `thiserror (existing)`, `gpu crate (existing GpuContext)`
Largely done. For native: build the effects crate without target_arch=wasm32 gating (currently gated in rust/wasm/src/wasm.rs), pick a native wgpu backend (Metal/DX12/Vulkan) via GpuContext, and feed it EffectPass lists from the ported native effects-registry instead of serde-wasm-bindgen-deserialized JS objects. Consolidate the uniform contract so pack_effect_uniforms is driven by the registry (see effects-registry risks) rather than a growing match. Add real GPU golden tests now possible off-browser (headless adapter).

_Data structures:_ `EffectPass{shader,uniforms}`, `EffectUniformBuffer{resolution:[f32;2],direction:[f32;2],scalars:[f32;4]}`, `HashMap<String,RenderPipeline>`

_Risks:_
- texture format is currently Bgra8Unorm from the compositor path; native surface/format assumptions must match the compositor cluster
- adding effects still requires a shader module + pipeline entry + uniform-packing arm — coupling to effects-registry should be resolved to make this one-touch
- no existing GPU-level tests; establishing headless wgpu golden-image tests is new infrastructure for this repo

**Test cases**
- `effects-gpu-unit-pack` _(unit)_ — existing pack_effect_uniforms tests (brightness/blur/unknown/missing) — carry forward
- `effects-gpu-golden-blur` _(golden)_ — headless wgpu: blur a known input texture, compare output PNG hash to a fixture (new)
- `effects-gpu-golden-brightness` _(golden)_ — headless brightness at amount 1.5 matches reference image
- `effects-gpu-perf-blur-4k` _(perf)_ — 8-iteration separable blur on 3840x2160 stays within a frame budget on the native backend

---

#### masks-shapes-and-rasterization  `1-2 months`
**Web:** `apps/web/src/masks/types.ts`, `apps/web/src/masks/registry.ts`, `apps/web/src/masks/index.ts`, `apps/web/src/masks/dimensions.ts`, `apps/web/src/masks/feather.ts`, `apps/web/src/masks/utils.ts`, `apps/web/src/masks/param-update.ts`, `apps/web/src/masks/builtin/box-like.ts`, `apps/web/src/masks/builtin/definitions/rectangle.ts`, `apps/web/src/masks/builtin/definitions/ellipse.ts`, `apps/web/src/masks/builtin/definitions/heart.ts`, `apps/web/src/masks/builtin/definitions/diamond.ts`, `apps/web/src/masks/builtin/definitions/star.ts`, `apps/web/src/masks/builtin/definitions/split.ts`, `apps/web/src/masks/builtin/definitions/cinematic-bars.ts`, `apps/web/src/masks/builtin/definitions/text.ts`, `apps/web/src/masks/freeform/definition.ts`, `apps/web/src/masks/freeform/path.ts`, `apps/web/src/services/renderer/compositor/frame-descriptor.ts (buildMaskArtifacts)`
**Browser deps:** `Canvas2D Path2D (bezierCurveTo/lineTo/moveTo/closePath) — used by every shape body/stroke`, `OffscreenCanvasRenderingContext2D: fill, stroke, createLinearGradient/addColorStop (split feather), fillRect, fillStyle`, `text mask needs Canvas2D text metrics + glyph fill (font loading via @/fonts)`, `frame-descriptor draws into an OffscreenCanvas then hands the texture to wgpu`
**Depends on:** masks-interaction (geometry helpers), params registry (ParamDefinition), text/font cluster (glyph rasterization for text mask), masks-gpu-feather (feather stage), compositor cluster (texture upload)

**Features**
- 8 builtin shapes (rectangle, ellipse, heart, diamond, star, split, cinematic-bars, text) + freeform cubic-bezier paths, each with body renderer (fillPath | drawOpaque | drawWithFeather) and optional stroke (strokeFromPath | renderStroke)
- MaskDefinition registry with BASE_MASK_PARAM_DEFINITIONS injected (feather/strokeWidth/strokeColor) + per-shape params (centerX/Y, width/height, rotation, scale, strokeAlign)
- box-like geometry: normalized center/size relative to element bounds, rotation, stroke-align offset (inside/center/outside)
- shape path math: heart/star/diamond analytic control points, ellipse, split half-plane polygon clip with epsilon/area guards, cinematic-bars
- text mask: content/font family/weight/style/size/letterSpacing/lineHeight glyph fill
- freeform: cubic bezier segments, split-point insertion (de Casteljau), closest-point-on-segment search, recenter, local<->canvas transforms, Path2D + SVG builders
- feather: JFA GPU path for fillPath/drawOpaque; drawWithFeather bakes feather on CPU (split uses analytic linear gradient) and zeros GPU feather; MAX_FEATHER cap
- rasterization to an alpha mask texture uploaded to the compositor (frame-descriptor buildMaskArtifacts + drawTransformedCanvas), contentHash cache keys, inverted param

**Native approach** — crates: `tiny-skia (linebender, active 2026 — Path/PathBuilder, Paint fill+stroke, Stroke, LinearGradient shader, Mask/clip, premultiplied RGBA Pixmap)`, `kurbo 0.12 (bezier/curve math, de Casteljau subdivision, nearest-point)`, `cosmic-text + swash (or fontdue) for text-mask glyph rasterization`, `lyon_tessellation (alternative: GPU-tessellated fill instead of CPU raster)`, `wgpu (upload Pixmap -> texture)`
Replace the Canvas2D rasterization with tiny-skia, which mirrors the exact primitives used: PathBuilder.move_to/cubic_to/line_to/close for the shape bodies (heart/star control points and freeform segments port 1:1), Paint with a white fill into an alpha Pixmap, Stroke for stroke paths with align-offset applied to the built path (getStrokeOffset), and LinearGradient for the split mask's analytic feather. Preserve the body-kind branching (fillPath vs drawWithFeather vs drawWithFeather.opaqueFastPath) and the frame-descriptor rule that drawWithFeather zeroes GPU feather. Port box-like geometry, split half-plane clipping (with NORMAL_SNAP_EPSILON and MIN_POLYGON_AREA_PX guards), and freeform path.ts (insert via de Casteljau, closest-point 24-sample+refine) as pure Rust. Text mask uses cosmic-text layout + swash glyph outlines rasterized into the Pixmap. Then either upload the alpha Pixmap to a wgpu texture and reuse the existing JFA feather (masks-gpu-feather), or tessellate with lyon and rasterize on GPU. Keep MaskDefinition as a registry so params/UI/MCP stay data-driven.

_Data structures:_ `enum Mask { Split, CinematicBars, Rectangle, Ellipse, Heart, Diamond, Star, Text, Freeform } with per-variant params`, `BaseMaskParams{feather:f32, inverted:bool, stroke_color:String, stroke_width:f32, stroke_align:enum}`, `FreeformPathPoint{id, x,y, in_x,in_y, out_x,out_y}`, `MaskRenderer{ body:MaskBody, stroke:Option<MaskStroke> } as an enum of closures->tiny_skia::Path builders`, `MaskDefinition registry keyed by MaskType`

_Risks:_
- tiny-skia coverage/anti-aliasing will not be bit-identical to the browser Canvas2D rasterizer — golden mask tests need tolerance, not exact hash; edge AA differences can shift JFA feather slightly
- text mask fidelity: matching browser font selection/hinting/letterSpacing/lineHeight is the hardest single item — swash/cosmic-text differ from the browser text stack (shared with the text cluster's font work)
- split analytic gradient must reproduce the two-endpoint linear gradient direction exactly or feathered edges drift
- stroke-align inside/center/outside is done by offsetting the built path by strokeWidth/2 (getStrokeOffset) rather than a true stroke expansion — replicate the offset-path approach, not tiny-skia's default centered stroke
- content-hash cache keys embed JSON.stringify(params) — native cache keying must be stable/deterministic (BTreeMap + canonical serialization)
- only masks[0] honored today — keep the limitation or expand deliberately

**Test cases**
- `masks-shape-golden-rect` _(golden)_ — rasterize rectangle/ellipse/heart/star/diamond at fixed params to an alpha buffer; compare to a reference image within AA tolerance
- `masks-split-golden-feather` _(golden)_ — split mask with feather>0 produces the analytic linear-gradient ramp matching the web output direction/extent
- `masks-split-unit-halfplane` _(unit)_ — opaqueFastPath polygon clip against canvas edges: axis-aligned and 45deg lines, corner-on-line epsilon, degenerate area rejected
- `masks-freeform-prop-split-insert` _(property)_ — insertPointIntoFreeformSegment via de Casteljau keeps the curve shape (sampled points unchanged) while adding an anchor
- `masks-freeform-unit-closest-point` _(unit)_ — findClosestPointOnFreeformSegment returns t within [0.001,0.999] near the true nearest point on a known curve
- `masks-stroke-unit-align-offset` _(unit)_ — getStrokeOffset inside/center/outside offsets the built path by the expected amount
- `masks-text-golden` _(golden)_ — text mask 'AB' at a bundled font matches a reference alpha image within tolerance
- `masks-raster-perf` _(perf)_ — rasterize a freeform mask with 40 anchors at 1080p within budget

---

#### masks-interaction-and-snapping  `2-4 weeks`
**Web:** `apps/web/src/masks/geometry.ts`, `apps/web/src/masks/snap.ts`, `apps/web/src/masks/handle-positions.ts`, `apps/web/src/masks/use-mask-handles.ts`, `apps/web/src/masks/param-update.ts`, `apps/web/src/masks/components/`, `apps/web/src/masks/__tests__/snap.test.ts`, `apps/web/src/preview/mask-handles.tsx`
**Browser deps:** `React hook use-mask-handles.ts and mask-handles.tsx (pointer events, overlay rendering)`, `depends on preview/preview-snap and preview/element-bounds (out-of-cluster preview module) — pure math but not in this cluster`, `cursor strings / DOM overlay descriptors (MaskOverlay line/rect/shape/canvas-path)`
**Depends on:** masks-shapes-and-rasterization, preview/transform cluster (preview-snap, element-bounds), GPUI shell

**Features**
- handle geometry: box mask (corners/edges/rotation/feather/scale) and line mask (split) handle positions + overlays, display-scale aware
- computeParamUpdate per shape: drag delta -> param delta (position, rotation atan2, feather along shape normal, edge/corner/scale resize with MIN_MASK_DIMENSION clamps)
- snapping: snapBoxMaskInteraction / snapSplitMaskInteraction over position/rotation/size using shared preview-snap primitives; maps mask-local snap lines to global canvas space
- geometry helpers: normalized center<->local, snap geometry (position/size/rotation), rectangle-params type guard
- computeFeatherUpdate (feather drag projected onto shape normal), MAX_FEATHER clamp

**Native approach** — crates: `gpui (handles/overlay UI + pointer input)`, `the native masks crate (geometry/snap/param-update math)`, `glam or nalgebra (2D vector/rotation math)`
Split cleanly: the MATH (geometry.ts, snap.ts, param-update.ts, handle-positions.ts) is pure and ports into the native masks crate — atan2 rotation, half-plane feather projection, clamped resize ratios, and the snap functions (which just need a native equivalent of preview-snap's snapPosition/snapRotation/snapScale/snapScaleAxes). The UI (use-mask-handles hook, mask-handles.tsx overlays) becomes a GPUI layer that consumes MaskHandlePosition/MaskOverlay descriptors and emits drag deltas back into computeParamUpdate + snap. Keep the descriptor types (handle kind/cursor/overlay) as data so the UI is thin. Note snapping shares primitives with the preview/transform cluster — coordinate the native preview-snap port with that cluster to avoid duplication.

_Data structures:_ `MaskHandleId enum (position/rotation/feather/scale/edge{side}/corner{x,y}/anchor{pointId}/segment{index})`, `MaskHandlePosition{id,x,y,cursor,kind,...}`, `MaskOverlay enum (Line/Rect/Shape/CanvasPath)`, `MaskSnapResult{params, active_lines:Vec<SnapLine>}`, `ElementBounds (from preview cluster)`

_Risks:_
- preview-snap primitives (snapScaleAxes with preferredEdges, snapPosition rotated-box logic) live outside this cluster; the native port must be shared, not re-implemented per cluster
- feather-along-normal direction differs between box (-sin,cos) and split (-cos,-sin) — keep per-shape
- display-scale/handle hit-radius tuning must feel right in GPUI vs DOM
- rotation modulo/normalization to [0,360) must match to avoid handle jumps

**Test cases**
- `masks-snap-unit-existing` _(unit)_ — port masks/__tests__/snap.test.ts fixtures (position/rotation/size snapping) to Rust
- `masks-geom-unit-center-roundtrip` _(unit)_ — get/setMaskLocalCenter round-trips; zero-bounds guarded to 0
- `masks-param-update-unit-resize` _(unit)_ — edge/corner/scale computeBoxMaskParamUpdate clamps to MIN_MASK_DIMENSION and matches ratio math
- `masks-param-update-unit-rotation` _(unit)_ — rotation from atan2 delta normalizes into [0,360)
- `masks-feather-unit-projection` _(unit)_ — computeFeatherUpdate projects drag onto shape normal and clamps to MAX_FEATHER

---

#### masks-gpu-feather  `days`
**Web:** `rust/crates/masks/src/masks.rs`, `rust/crates/masks/src/sdf.rs`, `rust/crates/masks/src/feather.rs`, `rust/crates/masks/src/shaders/jfa_init.wgsl`, `rust/crates/masks/src/shaders/jfa_step.wgsl`, `rust/crates/masks/src/shaders/jfa_distance.wgsl`, `apps/web/src/services/renderer/compositor (mask.wgsl consumption in compositor cluster)`
**Browser deps:** `ALREADY NATIVE — wgpu 29 + bytemuck; only wasm cfg gating in rust/wasm. No browser API used.`
**Depends on:** masks-shapes-and-rasterization (produces the input alpha texture), gpu crate, compositor cluster (mask.wgsl blend)

**Features**
- Jump-Flood-Algorithm SDF: init + log2(max(w,h)) halving step passes, ping-pong textures, inside+outside seed fields (SignedDistanceFieldTextures)
- MaskFeatherPipeline: two-sided distance (outside-inside) -> smoothstep(-feather_half, feather_half, signed_distance) -> alpha, feather param in pixels
- seed encode/decode across RGBA8 (16-bit coords), no-seed sentinel; nearest sampling
- apply_mask_feather / apply_mask_feather_with_encoder producing a feathered alpha texture

**Native approach** — crates: `wgpu (29, existing)`, `bytemuck (existing)`, `gpu crate (existing)`
Essentially complete and platform-agnostic; native build just removes wasm gating and runs against a native adapter. Main gap is that it is GPU-untested (repo convention). Add headless wgpu golden tests: rasterize a known mask (from masks-shapes) -> JFA feather -> compare the alpha ramp. Verify the JFA step count and RGBA8 16-bit seed encoding hold at large resolutions (4K) where coordinate precision matters. Confirm the frame-descriptor contract that split/drawWithFeather masks arrive with feather=0 so no double-feather occurs.

_Data structures:_ `SignedDistanceFieldTextures{inside_texture, outside_texture}`, `JfaInitUniformBuffer{resolution, invert}`, `JfaStepUniformBuffer{resolution, step_size}`, `DistanceUniformBuffer{resolution, feather_half}`

_Risks:_
- RGBA8 seed encoding caps coordinates at 65535; fine for <=64k px but verify at 4K+ and document
- two-sided distance has known edge artifacts near canvas borders (the reason split mask uses analytic CPU feather) — keep the CPU fallback branch
- no GPU tests today; headless golden-image infra is new for the repo
- nearest_sampler / texture format assumptions must match the compositor cluster's mask.wgsl

**Test cases**
- `masks-jfa-golden-circle` _(golden)_ — headless: feather a filled circle mask, assert the alpha ramp width matches feather and is radially symmetric
- `masks-jfa-unit-seed-codec` _(unit)_ — encode/decode seed coordinates round-trip across the RGBA8 split incl. no-seed sentinel
- `masks-jfa-perf-4k` _(perf)_ — full JFA (init + ~12 steps) + distance pass on 3840x2160 within a frame budget
- `masks-jfa-unit-stepcount` _(unit)_ — step count = ceil(log2(max(w,h))) for representative sizes

## Media, audio & text/fonts
Cluster boundary facts. (1) Everything decode/demux-related funnels through ONE npm dep, mediabunny (^1.29.1), used in exactly 4 places: apps/web/src/media/mediabunny.ts (probe+thumbnail), apps/web/src/media/audio.ts (resolveAudioBufferForAsset), apps/web/src/core/managers/audio-manager.ts (streaming AudioBufferSink playback), apps/web/src/services/video-cache/service.ts (CanvasSink frame decode). All time is in TICKS_PER_SECOND (from @/wasm) — the Rust `time` crate already owns this constant, so native code should reuse it, not reinvent seconds<->ticks. (2) Audio is 100% WebAudio: AudioBuffer is the universal in-memory currency (Float32 planar, per-buffer sampleRate), OfflineAudioContext does all resampling, AudioContext+GainNode+setInterval lookahead does all playback, DynamicsCompressor is the only "mastering". EXPORT_SAMPLE_RATE=44100, MAX_AUDIO_CHANNELS=2 are hardcoded. Native must replace the AudioBuffer abstraction with a planar f32 buffer struct + explicit resampler (rubato) since there is no OfflineAudioContext. (3) Time-stretch pitch preservation is the ONE npm dep besides mediabunny/transformers: soundtouchjs (^0.3.0), used only in apps/web/src/retime/audio-stretch.ts. (4) Text is entirely Canvas2D measureText/fillText/strokeText — NOT GPU, NOT the effects/ Rust crate. Fonts are loaded as CSS @font-face via document.fonts.load + a prebuilt /public/fonts/font-atlas.json preview atlas (this atlas is a UI thumbnail sheet, NOT a glyph atlas). fonts/use-font-atlas.ts is a font-NAME picker, per the audit. (5) Transcription is Whisper via @huggingface/transformers (^3.8.1, ONNX, q4, WebGPU) in a Web Worker; input is always 16kHz mono Float32Array produced by decodeAudioToFloat32 after extractTimelineAudio renders a full-timeline WAV. Existing Rust crates (rust/crates/{compositor,gpu,effects,masks,time,bridge}) are wgpu/video-frame consumers — the native text subsystem must produce glyph bitmaps/quads that feed compositor (cross-cluster dep, not owned here). The single biggest greenfield risk across the cluster is matching browser Canvas2D text metrics (actualBoundingBoxAscent/Descent, letterSpacing, "middle" baseline centering via visualCenterOffset) byte-for-byte against a native shaper — golden tests are mandatory. Existing pure-logic modules that port almost verbatim (no browser deps): apps/web/src/timeline/audio-state.ts (dB<->linear, keyframe gain), apps/web/src/media/waveform-summary.ts (RMS/peak bucketing), apps/web/src/transcription/caption.ts (caption chunking), apps/web/src/text/layout.ts (rect math) — these are days-level ports and should be done first as the stable core the harder subsystems build on.

#### media-demux-decode  `2-4 months`
**Web:** `apps/web/src/media/mediabunny.ts`, `apps/web/src/services/video-cache/service.ts`, `apps/web/src/media/processing.ts`
**Browser deps:** `mediabunny (Input, BlobSource, ALL_FORMATS, VideoSampleSink, CanvasSink, AudioBufferSink, WrappedCanvas)`, `browser WebCodecs VideoDecoder under mediabunny (hence canDecode() false for HEVC on Chrome)`, `File/Blob.arrayBuffer()`, `OffscreenCanvas/Canvas for CanvasSink output`, `URL.createObjectURL`
**Depends on:** audio-decode-resample

**Features**
- Container demux for ALL_FORMATS (mp4/mov/webm/mkv/etc) via mediabunny Input+BlobSource
- computeDuration()
- getPrimaryVideoTrack()/getPrimaryAudioTrack()
- videoTrack.canDecode() capability probe (drives HEVC 'cannot preview' toast in processing.ts)
- computePacketStats(100).averagePacketRate for fps estimate
- displayWidth/displayHeight, codec name (VideoCodec)
- VideoSampleSink.getSample(1) single-frame decode for import thumbnail
- CanvasSink(poolSize:3, fit:contain) streaming frame decode with .canvases(time) async iterator
- VideoCache: seek vs iterate heuristic (iterate when target within [lastTime, lastTime+2s]), one-frame prefetch (nextFrame/prefetchPromise), per-mediaId frame-chain serialization + seekGenerations to cancel stale seeks
- WrappedCanvas {timestamp,duration} frame validity window

**Native approach** — crates: `ffmpeg-next (or ffmpeg-sys-next)`, `gstreamer-rs (alternative)`, `symphonia (audio-only demux/probe fallback)`, `core-video/core-foundation + objc2 (VideoToolbox glue on macOS)`, `cros-libva (VAAPI) / nvidia bindings via ffmpeg hwaccel`
Replace mediabunny with ffmpeg-next as the single demux+decode engine (matches its ALL_FORMATS breadth and gives hardware decode via avcodec hwaccel: VideoToolbox on macOS, NVDEC on NVIDIA, VAAPI on Linux — selected by AVHWDeviceType, with SW fallback = the native analog of canDecode()). Build a MediaProbe (duration, tracks, codec, w/h, avg fps from packet stats) and two decode paths: (a) a DecoderPool/FrameSink replacing CanvasSink+VideoCache that yields VideoFrame {pts_ticks, duration_ticks, planes} on a seek(pts) API, porting VideoCache's iterate-vs-seek heuristic and single-frame prefetch onto ffmpeg's avformat_seek_file + decoder flush; (b) a single-frame grab for thumbnails. Keep TICKS_PER_SECOND from the time crate as the pts unit. Frames land as GPU textures for the existing compositor crate (zero-copy from VideoToolbox surfaces where possible, else upload NV12/RGBA).

_Data structures:_ `MediaProbe {duration_ticks, video: Option<VideoTrackInfo>, audio: Option<AudioTrackInfo>, can_hw_decode: bool}`, `VideoTrackInfo {codec, display_w, display_h, avg_fps, rotation}`, `VideoFrame {pts_ticks, duration_ticks, plane_layout, texture_or_cpu_buffer}`, `FrameCache {seek_generation: u64, current: Option<VideoFrame>, next: Option<VideoFrame>, last_time_ticks, iterate_window_ticks} (port of VideoSinkData)`, `HwAccelContext {device_type, pix_fmt}`

_Risks:_
- ffmpeg licensing/linking (LGPL build, GPL-encoders avoidance) and per-platform hwaccel packaging is the heaviest packaging burden in the whole cluster
- frame-accurate seek semantics differ from mediabunny's async-iterator model — the VideoCache prefetch/generation logic must be re-derived and golden-tested against decoded PTS sequences
- VideoToolbox/NVDEC surface formats (NV12/P010, 10-bit HDR) must be color-converted correctly to match browser output
- matching mediabunny's averagePacketRate fps estimate exactly (rounding in processing.ts) affects downstream timing

**Test cases**
- `demux-probe-golden` _(golden)_ — Probe a fixture set (h264 mp4, hevc mov, vp9 webm, av1 mkv, audio-only mp3/wav) and assert duration_ticks, w/h, codec, avg_fps, has_audio match a recorded table (mirrors readVideoFile output).
- `seek-frame-pts` _(golden)_ — Seek to a list of timestamps and assert returned frame pts/duration fall in the same validity windows VideoCache.isFrameValid would accept; verify seekGeneration cancellation returns the previously-cached frame.
- `hwdecode-fallback` _(integration)_ — Force hwaccel unavailable and assert SW decode still produces identical frames (bit-tolerant) and can_hw_decode flag matches capability.
- `decode-perf` _(perf)_ — 1080p60 h264: sustained decode+seek throughput with hw vs sw; assert seek latency under a target and no unbounded memory growth over 10k random seeks.

---

#### audio-decode-resample  `2-4 weeks`
**Web:** `apps/web/src/media/audio.ts`
**Browser deps:** `mediabunny AudioBufferSink`, `WebAudio AudioContext.decodeAudioData`, `OfflineAudioContext (used purely as a resampler)`, `AudioBuffer.copyToChannel/getChannelData`, `fetch() for library audio`
**Depends on:** —

**Features**
- resolveAudioBufferForAsset: mediabunny AudioBufferSink.buffers(0) full decode of a media file's primary audio track, concatenated across chunks
- native->target sampleRate resampling via OfflineAudioContext buffer-source render (audio.ts:308-332 and audio-manager.ts:640-663)
- direct decodeAudioData path for audio-type assets and library-audio fetch()
- decodeAudioToFloat32: decode + mono mixdown (sum/numChannels) to a single Float32Array at requested sampleRate (used to feed Whisper at 16kHz)
- MAX_AUDIO_CHANNELS=2 clamp

**Native approach** — crates: `symphonia (mp3/aac/flac/wav/ogg/opus decode, pure Rust)`, `rubato (SincFixedIn / FftFixedIn sample-rate conversion — the OfflineAudioContext replacement)`, `ffmpeg-next (fallback for exotic codecs symphonia lacks)`
Decode with symphonia (falling back to ffmpeg-next for codecs symphonia can't handle — reuse the demux subsystem's decoder), producing an AudioBufferF32 {sample_rate, channels: Vec<Vec<f32>>}. Replace the OfflineAudioContext resample trick with rubato's SincFixedIn resampler (high quality) or FftFixedIn (fast). Provide decode_to_mono_f32(target_rate) = decode + average channels + resample, matching decodeAudioToFloat32 exactly for the Whisper feed. Clamp to 2 channels. Cache decoded buffers keyed by asset id (mirrors audio-manager's decodedBuffers map).

_Data structures:_ `AudioBufferF32 {sample_rate: u32, len: usize, channels: Vec<Vec<f32>>} (the AudioBuffer replacement, planar)`, `ResamplerSpec {from_rate, to_rate, channels, quality}`, `DecodedAudioCache: HashMap<AssetId, Arc<AudioBufferF32>>`

_Risks:_
- rubato output length / boundary handling differs from OfflineAudioContext's linear-interpolation render — waveform/mix goldens must be recomputed, not compared to the browser byte-for-byte
- symphonia gaps for some AAC/HEVC-audio variants force the ffmpeg fallback, doubling the decode code path
- mono-mixdown rounding must match (sum then divide) to keep Whisper input identical

**Test cases**
- `decode-samplecount` _(property)_ — For random native/target rate pairs, decoded+resampled length ≈ ceil(totalSamples*target/native) within 1 sample (matches audio.ts:309).
- `mono-mixdown` _(golden)_ — Stereo fixture -> decode_to_mono_f32(16000) matches a recorded Float32 vector within tolerance; assert exact channel-average formula.
- `decode-formats` _(integration)_ — Decode mp3/wav/flac/opus/m4a fixtures; assert sample_rate, channel count, and duration within one frame of the container duration.

---

#### audio-mix-export  `2-4 weeks`
**Web:** `apps/web/src/media/audio.ts`, `apps/web/src/media/mediabunny.ts`
**Browser deps:** `AudioContext/OfflineAudioContext.createBuffer`, `AudioBuffer.getChannelData`, `DataView/ArrayBuffer for WAV encode`, `TICKS_PER_SECOND from @/wasm`
**Depends on:** audio-decode-resample, audio-retime-pitch, audio-gain-model, audio-mastering

**Features**
- collectAudibleCandidates / collectAudioElements / collectAudioMixSources / collectAudioClips: gather audible elements across overlay+main+audio tracks honoring track.muted, element muted, isSourceAudioEnabled (doesElementHaveEnabledAudio), duration>0
- createTimelineAudioBuffer: allocate 2ch output at 44100, per-element render (retime-aware) and mixAudioChannels: linear-interpolated resample of source at getSourceTimeAtClipTime + per-sample gain (animated via resolveEffectiveAudioGain or static), additive accumulate into output
- extractTimelineAudio: full-timeline render -> 16-bit PCM WAV Blob (interleave + float->int16 + RIFF header)
- empty/silent-timeline WAV fallbacks
- extractPeakRange / extractRmsRange / getSampleBucketRange helpers

**Native approach** — crates: `hound (WAV read/write)`, `rubato (for any per-element resample)`, `(reuses audio-decode-resample, audio-retime-pitch, audio-gain-model)`
Port the mixer directly: TimelineAudioMixer.render(tracks, assets, duration_ticks, sample_rate) -> AudioBufferF32. Reuse decoded AudioBufferF32 from audio-decode-resample; for each collected clip compute output sample range from startTime, walk output samples mapping clipTime->sourceTime via the ported getSourceTimeAtClipTime (retime crate/module), do linear interpolation between neighboring source samples, multiply by gain (static or resolveEffectiveAudioGain when hasAnimatedVolume), and add into the 2ch accumulator. Apply mastering (see audio-mastering). Encode WAV with hound (replace the hand-rolled RIFF writer) or keep a tiny custom int16 encoder for byte-exact parity. Keep collect* filtering logic verbatim (pure over SceneTracks).

_Data structures:_ `CollectedAudioClip {element_ref, buffer: Arc<AudioBufferF32>, start_ticks, duration_ticks, trim_start_ticks, trim_end_ticks, volume, muted, retime: Option<RetimeConfig>}`, `MixOutput {sample_rate, channels:[Vec<f32>;2]}`, `the collect* functions as pure fns over SceneTracks + MediaAsset map`

_Risks:_
- linear interpolation + additive mix must match the JS loop exactly (mixAudioChannels:842-865) for golden parity — off-by-one in sourceIndex/clip end breaks it
- per-sample resolveEffectiveAudioGain when animated is O(samples*keyframes); needs the same precompute strategy or it dominates export time
- interleave + float->int16 rounding (sample<0 ? *0x8000 : *0x7fff) must be replicated bit-for-bit for WAV goldens

**Test cases**
- `mix-two-clips-golden` _(golden)_ — Two overlapping clips with different volumes -> assert mixed output equals a recorded reference produced by the JS mixer (within f32 epsilon).
- `wav-encode-bytes` _(golden)_ — Encode a known Float32 buffer and byte-compare the 44-byte RIFF header + int16 payload against createWavBlob output.
- `empty-silent-fallback` _(unit)_ — totalDuration=0 and no-audible-elements cases produce the exact silent-WAV sizes (EMPTY_TIMELINE_SILENT_DURATION_SECONDS / MIN_SILENT_DURATION_SECONDS).
- `animated-gain-mix` _(property)_ — Clip with volume keyframes: per-sample gain equals resolveEffectiveAudioGain at that clipTime; monotone ramp stays within keyframe bounds.
- `export-perf` _(perf)_ — 10-min timeline, 8 audio clips: full extractTimelineAudio render time and peak memory under target.

---

#### audio-playback-scheduling  `1-2 months`
**Web:** `apps/web/src/core/managers/audio-manager.ts`
**Browser deps:** `WebAudio AudioContext (currentTime clock, createBufferSource, createGain, start(when,offset), gain.setValueAtTime/linearRampToValueAtTime/cancelScheduledValues)`, `mediabunny AudioBufferSink streaming iterator + Input`, `window.setInterval/clearInterval`, `OfflineAudioContext (in decode/prepare paths)`
**Depends on:** audio-decode-resample, audio-retime-pitch, audio-gain-model, audio-mastering

**Features**
- Real-time timeline audio playback synced to playback clock (getPlaybackTime = startTime + (ctx.currentTime - startContextTime))
- 2s lookahead scheduler on a 500ms setInterval; per-clip AsyncGenerator streaming (AudioBufferSink.buffers(sourceStartTime)) OR prepared-buffer path when curve-retime / animated volume / pitch-preserve
- per-clip GainNode with clip.volume and scheduled linearRampToValueAtTime automation (buildAudioGainAutomation)
- playbackRate.value for resample-retime clips
- drift/latency compensation (consecutiveDroppedBufferCount>=5 -> playbackLatencyCompensationSeconds, resync)
- seek/scrub handling, session invalidation (playbackSessionId), master GainNode = playback volume via mastering chain input
- sink/input/decodedBuffer/preparedClipBuffer caches keyed by sourceKey

**Native approach** — crates: `cpal (cross-platform audio output: CoreAudio/WASAPI/ALSA)`, `rtrb or ringbuf (lock-free sample ring to the audio callback)`, `(reuses audio-decode-resample, audio-retime-pitch, audio-gain-model, audio-mastering)`
Replace WebAudio's scheduler+graph with a cpal output stream feeding from a real-time mixer. Two-thread design: a control/scheduler thread holds the playback clock and a lookahead window (port the 2s/500ms logic to a monotonic timer), decodes/prepares clip buffers off the audio thread (reuse decode+retime caches keyed by sourceKey), and pushes ready ClipVoices into a lock-free structure; the cpal callback sums active voices at the output sample rate, applies per-voice gain envelopes (port buildAudioGainAutomation -> a sample-accurate envelope sampled in the callback, replacing linearRampToValueAtTime) and the master gain, then the mastering limiter. The drift-compensation logic becomes trivial because the callback is the sample clock (no ctx.currentTime skew) — but seek/session invalidation and the prepared-vs-streaming decision port directly.

_Data structures:_ `PlaybackClock {start_ticks, start_instant: Instant, latency_comp}`, `ClipVoice {buffer: Arc<AudioBufferF32>, start_ticks, trim_start, retime, gain_envelope: Envelope, playback_rate}`, `Envelope {points: Vec<(time, gain)>} sampled per output frame`, `VoiceSet: lock-free set of active voices; session_id: AtomicU64 for invalidation`, `caches: sinks/decoded/prepared keyed by SourceKey (mirror audio-manager maps)`

_Risks:_
- real-time correctness: the entire subsystem moves from a forgiving browser scheduler to a hard-real-time cpal callback where allocation/locking = glitches — all decode/resample/retime MUST stay off the audio thread
- matching perceived A/V sync and the streaming-vs-prepared heuristic (shouldUsePreparedClipBuffer) so scrub/seek feel identical
- cpal device sample-rate may differ from 44100 -> envelope + resample must run at device rate
- this is the trickiest audio subsystem to get click-free

**Test cases**
- `clock-map` _(unit)_ — getPlaybackTime mapping and seek repositioning produce correct source offsets (sourceStartTime = trimStart + getSourceTimeAtClipTime) for retimed/non-retimed clips.
- `scheduler-window` _(unit)_ — Given clip list + clock, the set of clips activated in a lookahead tick matches audio-manager.scheduleUpcomingClips (start<=windowEnd, end>currentTime, not muted).
- `envelope-sampling` _(property)_ — Sampled per-frame gain envelope matches buildAudioGainAutomation linear segments within epsilon at random times.
- `glitch-perf` _(perf)_ — 8 simultaneous voices at 48kHz: audio callback stays under buffer deadline with zero underruns over 60s (measured via ringbuf starvation counter).
- `seek-invalidation` _(integration)_ — Rapid seeks bump session id and old voices stop; no stale audio plays.

---

#### audio-mastering  `1-2 weeks`
**Web:** `apps/web/src/media/audio-mastering.ts`
**Browser deps:** `WebAudio DynamicsCompressorNode (the actual limiter DSP)`, `GainNode`, `OfflineAudioContext render`
**Depends on:** —

**Features**
- Master limiter chain: input GainNode -> DynamicsCompressor(threshold -1dB, knee 0, ratio 20, attack 1ms, release 120ms) -> outputGain 0.98 (createAudioMasteringChain, used by both export and live playback)
- applyAudioMasteringToBuffer: peak-detect, skip if <=0.98, else OfflineAudioContext render through the chain and hard-clamp to +/-0.98
- getAudioBufferPeak / clampAudioBufferPeak

**Native approach** — crates: `custom DSP (no external needed) — optionally dasp for buffer helpers`
Implement a native feed-forward limiter matching DynamicsCompressorNode semantics: envelope follower with attack/release time constants, soft-knee (knee=0 => hard knee) gain computer at threshold/ratio, applied as a per-sample gain, then outputGain*0.98 and clamp. Provide both a streaming form (for the cpal audio callback in playback) and a buffer form (applyAudioMasteringToBuffer for export). Peak-detect fast path to skip when peak<=0.98. The exact DynamicsCompressor curve is documented in the WebAudio spec — port that formula for parity rather than a generic compressor.

_Data structures:_ `LimiterState {envelope: f32, attack_coeff, release_coeff, threshold_db, ratio, knee_db, makeup}`, `MasterChain {input_gain, limiter: LimiterState, output_gain: 0.98}`

_Risks:_
- DynamicsCompressorNode's exact detection (RMS-ish, lookahead, curve) is only loosely specified and browser-implementation-specific — perfect parity is impossible; golden tests must allow perceptual tolerance, and the team should decide whether to match Chrome's implementation or ship a cleaner limiter
- stereo-linked vs per-channel gain reduction choice affects output

**Test cases**
- `peak-skip` _(unit)_ — Buffer with peak<=0.98 returns unchanged (fast path); buffer with peak>1 is limited and final peak<=0.98.
- `limiter-step` _(golden)_ — Step-input impulse: attack/release envelope shape matches expected time constants within tolerance.
- `clamp-guard` _(property)_ — For arbitrary input, output samples never exceed +/-0.98 after clampAudioBufferPeak.

---

#### audio-retime-pitch  `2-4 weeks`
**Web:** `apps/web/src/retime/audio-stretch.ts`, `apps/web/src/retime/resolve.ts`, `apps/web/src/retime/rate.ts`
**Browser deps:** `soundtouchjs (WSOLA/phase-vocoder time-stretch)`, `OfflineAudioContext (resample + stretch render)`, `AudioBuffer copyToChannel/getChannelData`
**Depends on:** audio-gain-model

**Features**
- renderRetimedBuffer: two modes — (a) pitch-changing resample (buildResampledBuffer: linear-interp read at getSourceTimeAtClipTime, used when not maintaining pitch), (b) pitch-preserved time-stretch via soundtouchjs PitchShifter(4096 buffer, tempo=rate, pitch=1) rendered through OfflineAudioContext
- clampRetimeRate / shouldMaintainPitch guards
- source<->clip time mapping (getSourceTimeAtClipTime / getClipTimeAtSourceTime) supporting constant and curve retime modes

**Native approach** — crates: `rubato (resample path)`, `signalsmith-stretch (Rust bindings to Signalsmith Stretch — high-quality time/pitch) OR soundtouch via a soundtouch-sys FFI binding OR a WSOLA implementation`, `(reuses audio-gain-model time mapping)`
Split into resample-retime (rate change, pitch follows) = rubato at the effective rate with linear-interpolated source read matching buildResampledBuffer, and pitch-preserved-retime = a native time-stretcher. Prefer signalsmith-stretch (permissive, excellent quality, well-suited to editor use) as the soundtouchjs replacement; keep tempo=rate, pitch=1 semantics. Port getSourceTimeAtClipTime/getClipTimeAtSourceTime (constant + curve modes) into the retime module — these are pure math and already have __tests__ (split.test.ts, resolve.test.ts) to mirror.

_Data structures:_ `RetimeConfig {rate, maintainPitch, mode: Constant|Curve, curve params} (already a TS type; port to Rust enum)`, `StretchJob {source: AudioBufferF32, trim_start, clip_duration, rate, target_rate}`, `time-map fns as pure Rust`

_Risks:_
- choosing a stretcher whose artifacts/latency match user expectation set by soundtouchjs; signalsmith and soundtouch differ audibly
- curve-mode retime (variable rate) needs sample-accurate instantaneous-rate integration to avoid drift
- soundtouchjs's 4096 block + its specific resample-first quirk (audio-stretch.ts:94) means existing exports won't be bit-identical — goldens must be regenerated

**Test cases**
- `time-map-property` _(property)_ — getClipTimeAtSourceTime(getSourceTimeAtClipTime(t)) ≈ t for constant and curve modes across random rates (port of resolve.test.ts).
- `resample-length` _(unit)_ — buildResampledBuffer-equivalent output length = ceil(clipDuration*targetRate) for random rates.
- `stretch-duration` _(golden)_ — Pitch-preserved stretch of a fixture at rate 0.5/2.0 yields expected output duration and preserved fundamental frequency (FFT peak) within tolerance.

---

#### audio-gain-model  `days`
**Web:** `apps/web/src/timeline/audio-state.ts`, `apps/web/src/timeline/audio-separation/index.ts`, `apps/web/src/timeline/audio-constants.ts`
**Browser deps:** `none (pure logic over @/animation resolveNumberAtTime + TICKS_PER_SECOND)`
**Depends on:** —

**Features**
- dB<->linear (dBToLinear, clampDb against VOLUME_DB_MIN/MAX)
- getElementVolume/isElementMuted from element.params
- hasAnimatedVolume (keyframe presence on 'volume' path)
- resolveEffectiveAudioGain (keyframe-resolved dB at localTime, honoring track/element mute) — used by mix, playback, waveform overlay
- buildWaveformGainSamples, buildAudioGainAutomation (dense automation points)
- doesElementHaveEnabledAudio / source-audio-separation guards

**Native approach** — crates: `none — pure Rust port`
Straight verbatim port into the native core; depends only on the animation/keyframe resolver (resolveNumberAtTime + hasKeyframesForPath) which the timeline/animation cluster owns. Expose the same fns so mix-export, playback, and waveform overlays share one gain source of truth. This is a foundational, low-risk port that should land early.

_Data structures:_ `reuses AudioCapableElement / ElementAnimations from the timeline model port`, `GainAutomationPoint {local_time, gain}`

_Risks:_
- localTime unit: resolveEffectiveAudioGain rounds localTime*TICKS_PER_SECOND before keyframe lookup (audio-state.ts:71) — must match the animation cluster's tick convention exactly
- depends on the animation keyframe resolver being ported first (cross-cluster)

**Test cases**
- `db-linear` _(property)_ — dBToLinear(clampDb(x)) monotone, clamps at VOLUME_DB_MIN/MAX, 0dB->1.0.
- `gain-at-keyframes` _(golden)_ — resolveEffectiveAudioGain at keyframed times reproduces linear-ramp values; muted element/track -> 0 (mirrors audit's audio-state test plan).
- `automation-density` _(unit)_ — buildAudioGainAutomation covers [from,to] with step points + final endpoint, values = resolveEffectiveAudioGain.

---

#### waveform  `1-2 weeks`
**Web:** `apps/web/src/media/waveform-summary.ts`, `apps/web/src/services/waveform-cache/service.ts`, `apps/web/src/media/audio.ts`
**Browser deps:** `AudioContext.decodeAudioData (in WaveformCache.buildSummary)`, `AudioBuffer.getChannelData`, `fetch() for url sources`
**Depends on:** audio-decode-resample

**Features**
- buildSourceWaveformSummary: peak per fixed bucketSize(128 samples) over full decoded buffer -> SourceWaveformSummary {sampleRate,totalSamples,bucketSize,amplitudes:Float32Array}
- sampleSourceWaveformSummary: resample summary into display buckets
- buildWaveformSampleBuckets: map clip pixels -> source sample ranges honoring retime
- computeRmsBuckets: max-RMS over 20ms windows per bucket (transient-preserving)
- computePeakBuckets/extractPeakRange/extractRmsRange
- WaveformCache: per-sourceKey memoized summaries (Promise map), builds from AudioBuffer or file/url decode

**Native approach** — crates: `(reuses audio-decode-resample for the decode step)`, `dashmap (concurrent cache)`
Port all bucketing math verbatim (it is pure over channel Float32 slices). Replace decodeAudioData in WaveformCache with the audio-decode-resample decoder to produce AudioBufferF32, then run buildSourceWaveformSummary. Keep the memoized-by-sourceKey cache (DashMap<SourceKey, Arc<SourceWaveformSummary>>). Store amplitudes as Vec<f32>. RMS 20ms-window and peak logic map 1:1.

_Data structures:_ `SourceWaveformSummary {source_key, sample_rate, total_samples, bucket_size:u32, amplitudes: Vec<f32>}`, `SampleBucket {start:usize, end:usize}`, `WaveformCache: DashMap<SourceKey, Arc<SourceWaveformSummary>>`

_Risks:_
- retime-aware buildWaveformSampleBuckets shares getSourceTimeAtClipTime with audio-retime — keep one implementation
- float bucket index rounding (floor/ceil in sampleSourceWaveformSummary) must match to keep waveform visuals identical
- summary amplitudes are peak while overlay uses RMS in places — preserve both code paths

**Test cases**
- `peak-bucket-golden` _(golden)_ — Known buffer -> amplitudes array equals recorded reference for bucketSize=128.
- `rms-window` _(property)_ — computeRmsBuckets on a silent-then-tone buffer places energy in the correct bucket (transient not smeared) matching the 20ms-window max-RMS definition.
- `summary-resample` _(unit)_ — sampleSourceWaveformSummary into N display buckets reproduces JS output for retimed and non-retimed clips.
- `waveform-perf` _(perf)_ — Summarize a 10-min stereo 48kHz buffer under target time; cache hit is O(1).

---

#### thumbnails  `1-2 weeks`
**Web:** `apps/web/src/media/thumbnail.ts`, `apps/web/src/media/processing.ts`, `apps/web/src/media/mediabunny.ts`
**Browser deps:** `Canvas2D getContext('2d')/drawImage/toDataURL`, `HTMLImageElement (image decode)`, `mediabunny VideoSampleSink for the video first-frame`, `HTMLVideoElement/HTMLAudioElement loadedmetadata for duration`, `URL.createObjectURL`
**Depends on:** media-demux-decode

**Features**
- thumbnailSize: aspect-preserving fit into 1280x720 max
- renderThumbnailDataUrl: draw callback into a Canvas2D, export toDataURL('image/jpeg',0.8)
- video import thumbnail = VideoSampleSink.getSample(1).draw(...) (mediabunny.ts:48-64)
- image import thumbnail = HTMLImageElement decode + drawImage into canvas (processing.ts generateImageThumbnail)
- getMediaDuration via hidden <video>/<audio> loadedmetadata (audio duration path)

**Native approach** — crates: `image (encode JPEG, decode png/jpg/webp/gif)`, `fast_image_resize (SIMD aspect-fit downscale)`, `(reuses media-demux-decode for the video first-frame; audio-decode-resample or ffmpeg probe for audio duration)`
thumbnailSize is pure math (port verbatim). For images, decode with the image crate and downscale with fast_image_resize, encode JPEG q~0.8 (map toDataURL quality). For video, grab frame at pts≈0/first-frame via the demux-decode FrameSink, convert to RGBA, resize, JPEG-encode. Replace the object-URL data-URL contract with either an in-memory RGBA buffer handed to the compositor/UI or a JPEG byte blob persisted to storage. getMediaDuration for audio comes from the symphonia/ffmpeg probe, not a media element.

_Data structures:_ `ThumbnailSize {w,h}`, `Thumbnail {rgba: Vec<u8> or jpeg_bytes: Vec<u8>, w, h}`

_Risks:_
- JPEG encoder quality/chroma-subsampling won't be byte-identical to the browser's toDataURL — thumbnails are visual-only so tolerance tests suffice
- which video frame is 'first' differs slightly (getSample(1) vs pts 0) and can change the thumbnail image
- color-space conversion from decoder pixel formats to RGBA must be correct

**Test cases**
- `thumb-size-math` _(golden)_ — thumbnailSize for a table of input dimensions matches JS output exactly (portrait, landscape, oversized both dims).
- `image-thumb` _(integration)_ — Decode+resize+encode a fixture image; assert output dims and a perceptual-hash match to a reference within tolerance.
- `video-first-frame` _(integration)_ — Extract first-frame thumbnail from an h264 fixture; assert non-empty JPEG of expected dimensions.

---

#### media-import-pipeline  `1-2 weeks`
**Web:** `apps/web/src/media/processing.ts`, `apps/web/src/media/use-file-upload.ts`, `apps/web/src/media/use-paste-media.ts`, `apps/web/src/media/media-utils.ts`, `apps/web/src/media/types.ts`, `apps/web/src/media/upload-toast.ts`
**Browser deps:** `File/FileList/Blob, MIME type sniffing via file.type`, `URL.createObjectURL`, `sonner toasts (UI)`, `IndexedDB storage service (other cluster) for quota check`, `mediabunny (readVideoFile)`
**Depends on:** media-demux-decode, thumbnails, audio-decode-resample

**Features**
- processMediaAssets: per-file type detection (getMediaTypeFromFile by MIME), storage-quota precheck (storageService.canStoreFile), probe (video via readVideoFile, image via generateImageThumbnail, audio via getMediaDuration), assemble ProcessedMediaAsset {name,type,file,url,thumbnailUrl,duration,w,h,fps,hasAudio}
- progress callbacks + toasts (unsupported type, storage limit, codec cannot-decode HEVC guidance)
- file-drop / paste ingestion hooks
- MediaAsset model (mediaId, type, file, thumbnail, dimensions)

**Native approach** — crates: `infer or tree_magic_mini (content-based type detection instead of MIME)`, `(reuses media-demux-decode probe, thumbnails, audio-decode-resample)`
Port processMediaAssets as a MediaImporter service: detect type by content (infer) rather than browser MIME, run the demux-decode probe for video (duration/w/h/fps/codec/canDecode/hasAudio), thumbnails subsystem for image/video thumbnails, probe for audio duration; produce a MediaAsset with a file path/handle instead of a File+objectURL. Replace toast strings with structured import-result diagnostics the UI shell renders. Storage/quota check delegates to the persistence cluster. Keep the codec-support messaging (HEVC guidance) driven by can_hw/sw decode.

_Data structures:_ `MediaAsset {id, type: Image|Video|Audio, path/handle, thumbnail, duration_ticks, w, h, fps, has_audio}`, `ImportResult {asset: Option<MediaAsset>, diagnostics: Vec<ImportWarning>}`, `ImportProgress {completed, total}`

_Risks:_
- content-based type detection may classify differently than browser MIME (edge formats) changing which pipeline runs
- objectURL-centric downstream code assumes a URL; native must supply a stable path/handle abstraction
- fps rounding (Math.round of averagePacketRate) must match to keep imported clip timing identical

**Test cases**
- `type-detect` _(golden)_ — getMediaTypeFromFile equivalent over a fixture set (image/video/audio/unknown) matches expected MediaType/None.
- `probe-assembly` _(integration)_ — Import a video fixture -> ProcessedMediaAsset fields (duration, w/h, fps, hasAudio, thumbnail present) match readVideoFile output table.
- `unsupported-codec-diag` _(unit)_ — A non-decodable (HEVC) fixture yields the cannot-preview diagnostic and canDecode=false but still imports metadata.

---

#### text-layout-measure  `1-2 months`
**Web:** `apps/web/src/text/primitives.ts`, `apps/web/src/text/measure-element.ts`, `apps/web/src/text/layout.ts`, `apps/web/src/text/background.ts`, `apps/web/src/text/typography.ts`, `apps/web/src/text/__tests__/text-stroke.test.ts`
**Browser deps:** `Canvas2D CanvasRenderingContext2D/OffscreenCanvas: font parsing, measureText -> TextMetrics (width, actualBoundingBoxAscent/Descent), letterSpacing property, textBaseline 'middle', fillText/strokeText/roundRect/fillRect`, `document.fonts availability implied for font selection`
**Depends on:** fonts

**Features**
- TextLayoutParams (content, fontSize, fontFamily, weight, style, align, decoration, letterSpacing, lineHeight) -> ResolvedTextLayout (scaledFontSize relative to FONT_SIZE_SCALE_REFERENCE canvas height, fontString, letterSpacing px, lineHeightPx, fontSizeRatio)
- measureTextLayout: per-line ctx.measureText with letterSpacing, textBaseline 'middle' -> lineMetrics + TextBlockMeasurement {visualCenterOffset,height,maxWidth}
- drawMeasuredTextLayout: multiline fillText at lineY = i*lineHeightPx - visualCenterOffset, rounded-rect background (padding/offset/cornerRadius via getTextBackgroundRect), text decoration (underline/line-through using actualBoundingBoxAscent/Descent)
- strokeMeasuredTextLayout: strokeText outline (lineJoin/lineCap round)
- measureTextElement: reads element.params via typed fallbacks, resolves keyframed background padding/offset/cornerRadius, computes visualRect
- getTextVisualRect/getTextBackgroundRect rect math

**Native approach** — crates: `cosmic-text (shaping + line layout + font fallback; wraps rustybuzz+swash+fontdb)`, `rustybuzz (HarfBuzz-port shaping, if going lower-level)`, `swash (glyph outline + rasterization, metrics)`, `fontdb (font matching by family/weight/style)`
Replace Canvas2D measure/draw with cosmic-text: build a Buffer with Attrs (family, weight, style), set metrics from scaledFontSize/lineHeightPx, apply letter spacing, shape+layout per line (split on \n like measureTextLayout), and read run advances to reproduce lineMetrics.width and a TextBlockMeasurement (maxWidth, height=lines*lineHeightPx, visualCenterOffset=(lines-1)*lineHeightPx/2). Rasterize glyphs with swash into an RGBA layer (or emit textured quads) that the existing compositor/gpu crate composites — this is the cross-cluster handoff replacing fillText. Port background rect math, decoration (underline/strike using ascent/descent from swash metrics), and stroke (swash outline stroking or an outline+fill pass) verbatim. Keep FONT_SIZE_SCALE_REFERENCE scaling and the 'middle' baseline centering. Provide a headless measure API so preview/edit-overlay and export share metrics.

_Data structures:_ `ResolvedTextLayout {scaled_font_size, letter_spacing_px, line_height_px, font_size_ratio, align, decoration}`, `MeasuredTextLayout {lines: Vec<ShapedLine>, line_metrics: Vec<LineMetrics{width,ascent,descent}>, block: TextBlockMeasurement}`, `TextBlockMeasurement {visual_center_offset, height, max_width}`, `GlyphQuad {atlas_uv, dst_rect, color} for compositor handoff`

_Risks:_
- METRIC PARITY is the single hardest problem in the cluster: cosmic-text/swash advances, ascent/descent, and letterSpacing semantics will not exactly equal Chrome's Canvas2D TextMetrics — text position/size will shift, breaking existing projects' visual layout unless carefully calibrated with goldens and possibly per-font correction
- letterSpacing application differs (Canvas adds after each glyph incl trailing; harfbuzz clusters differ) affecting maxWidth
- 'middle' baseline + actualBoundingBoxAscent/Descent fallbacks (0.8/0.2*fontSize) must be reproduced
- emoji/color fonts, RTL/complex scripts, and font fallback chains behave differently than the browser's implicit ', sans-serif' fallback
- stroke rendering (round join/cap, strokeText winding) is nontrivial to match with outlines

**Test cases**
- `measure-golden` _(golden)_ — For a matrix of (font, size, weight, style, letterSpacing, multiline) inputs, assert line widths, maxWidth, height, visualCenterOffset within a small tolerance of recorded Canvas2D values.
- `background-rect` _(golden)_ — getTextBackgroundRect/getTextVisualRect for padding/offset/cornerRadius/align combos match JS rect math exactly (pure math, zero tolerance).
- `decoration-placement` _(unit)_ — Underline/line-through y-position and thickness (ratios 0.07 / 0.35) reproduce drawTextDecoration for left/center/right align.
- `stroke-render` _(golden)_ — Rasterized stroke of a glyph string perceptually matches strokeMeasuredTextLayout reference (SSIM/pHash) within tolerance.
- `layout-perf` _(perf)_ — Shape+measure a 500-char multiline block under target; cache shaping for unchanged params.

---

#### fonts  `2-4 weeks`
**Web:** `apps/web/src/fonts/google-fonts.ts`, `apps/web/src/fonts/system-fonts.ts`, `apps/web/src/fonts/use-font-atlas.ts`, `apps/web/src/fonts/types.ts`
**Browser deps:** `Google Fonts CDN (fonts.googleapis.com/css2) network fetch`, `document.fonts (FontFaceSet) load()/ready`, `<link rel=stylesheet> injection`, `Image() preloading of AVIF chunk sheets`, `fetch('/fonts/font-atlas.json')`
**Depends on:** —

**Features**
- loadFullFont: inject Google Fonts CSS2 @font-face for a family/weights, await document.fonts.load
- loadFonts: load all non-system families used in a project
- SYSTEM_FONTS allowlist (Arial, Helvetica, Times New Roman, ... plus generic families)
- font-atlas.json + AVIF chunk preview sheet loader (getCachedFontAtlas/loadFontAtlas/preloadChunkImages) driving the font-picker UI thumbnails
- fontNames = atlas fonts + system fonts, sorted
- FontAtlas/FontAtlasEntry/FontOption/GoogleFontMeta types

**Native approach** — crates: `fontdb (in-memory font database, register system + downloaded fonts)`, `font-kit (OS font enumeration: CoreText/DirectWrite/Fontconfig)`, `woff2/ttf-parser (decode webfont payloads)`, `reqwest/ureq (download Google Fonts .woff2/.ttf on demand)`
Replace CSS @font-face + document.fonts with an explicit FontRegistry backed by fontdb: enumerate installed system fonts via font-kit at startup (superset of the SYSTEM_FONTS list), and for Google fonts download the .ttf/.woff2 (decode woff2 to OTF), register into fontdb keyed by family/weight/style so cosmic-text can match them. Cache downloaded font files on disk (persistence cluster). Replace the AVIF preview-atlas UI thumbnails with either bundled font previews or on-the-fly rasterized specimen strings (the atlas is purely a picker thumbnail, not needed for rendering). Provide loadFontsForProject that ensures all families referenced by text elements are registered before layout/export.

_Data structures:_ `FontRegistry { db: fontdb::Database, loaded: HashSet<FamilyKey> }`, `FamilyKey {family, weight, style}`, `FontSource enum {System(id), GoogleDownloaded(path), UserUploaded(path)}`, `GoogleFontMeta {family, category}`

_Risks:_
- Google Fonts licensing/network in a desktop app: bundling vs on-demand download, offline behavior
- matching the exact font file the browser served (Google serves per-browser subset woff2; a downloaded ttf may have slightly different metrics/hinting) — feeds the text metric-parity risk
- system font availability differs per OS -> a project made on one machine may substitute fonts on another (browser had the same problem, but the substitution set differs)
- the /public/fonts/font-atlas.json preview pipeline has no native equivalent and must be redesigned or dropped

**Test cases**
- `system-enum` _(integration)_ — font-kit enumeration includes the SYSTEM_FONTS allowlist families on each target OS (or documents substitutes).
- `google-register` _(integration)_ — Download+register a Google family (e.g. Roboto 400/700) and resolve it via fontdb by FamilyKey.
- `fontnames-sort` _(unit)_ — Merged+sorted font-name list (registry + system) matches the useFontAtlas fontNames ordering.
- `missing-font-fallback` _(unit)_ — Requesting an unregistered family falls back deterministically (documented) rather than panicking.

---

#### transcription-subtitles  `1-2 months`
**Web:** `apps/web/src/services/transcription/service.ts`, `apps/web/src/services/transcription/worker.ts`, `apps/web/src/transcription/models.ts`, `apps/web/src/transcription/audio.ts`, `apps/web/src/transcription/caption.ts`, `apps/web/src/transcription/types.ts`, `apps/web/src/subtitles/components/assets-view.tsx`
**Browser deps:** `@huggingface/transformers (ONNX Runtime Web, WASM/WebGPU backends)`, `Web Worker + postMessage`, `WebGPU/WASM SIMD for inference`, `HF Hub model download + browser cache`, `transferable Float32Array`
**Depends on:** audio-mix-export, audio-decode-resample

**Features**
- Whisper ASR via @huggingface/transformers pipeline('automatic-speech-recognition') in a Web Worker (dtype q4, device auto/WebGPU)
- 4 model tiers (tiny/small/medium/large-v3-turbo) with HF ids; default whisper-small; model download progress aggregation across files
- transcribe(audio: Float32Array 16kHz mono, language, chunk_length_s=30, stride_length_s=5, return_timestamps) -> {text, segments[{text,start,end}]}
- cancel/terminate, model-switch reinit lifecycle
- input prep: extractTimelineAudio (full-timeline WAV) -> decodeAudioToFloat32 at 16kHz
- buildCaptionChunks: split segments into N-words-per-caption chunks with MIN_CAPTION_DURATION, monotonic non-overlapping timing
- insert captions as a text track (insertCaptionChunksAsTextTrack)

**Native approach** — crates: `whisper-rs (bindings to whisper.cpp; Metal/CUDA/Vulkan/CoreML accel)`, `OR candle + candle-transformers (pure-Rust Whisper, GPU via candle backends)`, `hf-hub (model download)`, `(reuses audio-mix-export extractTimelineAudio + audio-decode-resample for 16kHz mono feed)`
Replace the transformers.js worker with a native Whisper runner. whisper-rs (whisper.cpp) is the pragmatic choice: GGML model files per tier, hardware acceleration via Metal (macOS)/CUDA (NVIDIA)/Vulkan, run on a background thread (not the UI thread). Map the model tiers to GGML model ids and download via hf-hub with the same progress semantics. Feed it the same 16kHz mono f32 produced by the mix-export + decode-resample path (extractTimelineAudio equivalent). whisper.cpp yields segments with timestamps -> map to TranscriptionSegment; port buildCaptionChunks and caption-track insertion verbatim (pure logic). candle-transformers is the pure-Rust alternative if avoiding C deps. Keep language 'auto' handling and chunk/stride config.

_Data structures:_ `TranscriptionSegment {text, start, end}`, `CaptionChunk {text, start_time, duration}`, `WhisperRunner {ctx: whisper context, model_id, thread/handle}`, `TranscriptionModel {id, name, ggml_or_hf_id, description}`, `progress aggregation {loaded, total per file}`

_Risks:_
- model size/download UX (large-v3-turbo is ~1.5GB) and disk caching/packaging decisions
- accuracy/timestamp parity: whisper.cpp vs transformers.js ONNX q4 differ subtly in segment boundaries -> caption timings won't be identical (acceptable, but goldens must tolerate)
- hardware accel matrix (Metal/CUDA/Vulkan/CPU) and build flags per platform
- threading: must run off the UI thread with cancellation matching the worker's cancel()
- whisper-rs C/C++ build + linking adds packaging weight (like ffmpeg)

**Test cases**
- `caption-chunk-golden` _(golden)_ — buildCaptionChunks over recorded segments produces identical chunk text + monotonic non-overlapping timings (pure logic, zero tolerance) — port of caption behavior.
- `whisper-smoke` _(integration)_ — Transcribe a short known-speech fixture with the tiny model; assert WER below a threshold and segments have plausible timestamps.
- `cancel-lifecycle` _(unit)_ — Cancel mid-run stops promptly and leaves the runner reusable; model switch reinitializes.
- `feed-16k-mono` _(unit)_ — The extract->decode_to_mono_f32(16000) feed produces the exact sample count/rate the runner expects.

## Persistence, project model & MCP
SCOPE-WIDE FINDINGS (read before the per-subsystem entries):

1. STORAGE TOPOLOGY (real). Everything editor-side lives client-side; server (apps/web/src/db/schema.ts, Drizzle/Postgres) holds ONLY auth+feedback, so there is NOTHING to port there. The client split is: (a) IndexedDB DB `video-editor-projects` store `projects` (whole SerializedProject per key = project id); (b) per-project IndexedDB DB `video-editor-media-{projectId}` store `media-metadata` (MediaAssetData); (c) OPFS directory `media-files-{projectId}` (one File per mediaId = the actual bytes); (d) IndexedDB `video-editor-saved-sounds` store `saved-sounds` (single record key `user-sounds`); (e) IndexedDB `video-editor-motion-presets` store `motion-presets` (single record key `user-presets`). All five map cleanly onto one SQLite DB + a media/ blob directory tree.

2. MediaTime IS THE INVARIANT. Every time field (startTime/duration/trimStart/trimEnd, bookmark time, playheadTime, keyframe time, metadata.duration) is a branded integer-tick `MediaTime` (apps/web/src/wasm/media-time.ts) already backed by the Rust `time` crate. Native persistence must round/serialize as i64 ticks, never f64 seconds. `roundMediaTime` is applied on load in service.ts (lines 47, 221, 278) — the native loader must replicate that rounding or golden output diverges.

3. LATENT WEB BUG worth knowing when porting: migrations/runner.ts:41 constructs `new IndexedDBAdapter("video-editor-projects","projects",1)` with POSITIONAL args, but IndexedDBAdapter's ctor destructures an OBJECT `{dbName,storeName,version}` (indexeddb-adapter.ts:8). So the runner's adapter currently opens `dbName=undefined`. Tests call the pure `transformProjectVNToVN1` fns directly and pass, masking it. The native port should drive migrations off the SAME store the loader reads — do not replicate this bug.

4. MIGRATION-CHAIN SHAPE. 31 sequential steps, `CURRENT_PROJECT_VERSION=31` (migrations/index.ts). Each step = pure fn `transformProjectVNToVN1({project}) -> {project, skipped, reason?}` over `Record<string,unknown>` (untyped, defensive against malformed legacy data) + a thin `StorageMigration` class (from/to/run) + a `__tests__/vN.test.ts`. Version detection (runner.ts:125 getProjectVersion): explicit `version:number` for v2+, else `scenes[]` present => v1, else v0. Complexity is HIGHLY non-uniform: v9→v10 is a pure version bump (no-op); v19→v20 backfills `isSourceAudioEnabled`; v30→v31 renames mask type "custom"->"freeform"; v1→v2 (17KB) reshapes the ENTIRE legacy flat-track model into scenes+SceneTracks with a legacy-context map; v21→v22 (10KB) does sRGB->LINEAR color conversion via the `culori` npm lib (needs an exact Rust equivalent, see Migration subsystem). Policy (migrations/AGENTS.md): migrations are ADDITIVE ONLY — never delete/rename persisted fields (enables future down-migrations) — the native port must honor this or golden fixtures with extra legacy fields will fail equality.

5. GOLDEN FIXTURE STATE TODAY. __tests__/fixtures/{v0,v1,v2,v3,v5}.ts are hand-authored per-version project snapshots; tests use type-narrowing accessors (helpers.ts asRecord/asRecordArray) rather than deep-equality, and cover only ~19 of 31 steps. The native strategy should UPGRADE this to true golden JSON files captured from the running web app (one per version 0..31) + full-chain golden (v0 fixture migrated all the way to v31), which today does not exist and is the highest-value test asset for the port.

6. MCP: no MCP code exists anywhere in rust/ today (greenfield). rmcp is the official SDK (crates.io `rmcp`, tokio-based, implements MCP 2026-07-28 spec). The MCP server is a THIN transport shell over opencut-core — the same crate the GPUI shell uses — so it must not embed any domain logic; it exposes tools/resources that call opencut-core's project/persistence API.

7. DEPENDENCY DIRECTION. This cluster is FOUNDATIONAL: the domain-model structs (subsystem 1) are the shared vocabulary that the timeline engine, animation, effects, and renderer clusters all consume. Persistence (2-6) depends only on subsystem 1. MCP (7) depends on 1-6 plus the command/timeline engine cluster for mutating tools. Build order: 1 -> {2,4,6} -> 3 -> 5 -> 7.

CRATE SUMMARY (researched on crates.io, Aug 2026): serde/serde_json (model + JSON compat with the web SerializedProject wire shape), rusqlite 0.38 (single-file SQLite, best fit for a desktop single-file store; no async overhead), rmcp + rmcp-macros (MCP server), tokio (rmcp runtime), palette (exact sRGB<->linear for the v21->v22 color migration, replacing culori), chrono or time (ISO-8601 date (de)serialization matching `.toISOString()`), uuid (ids), directories/dirs (per-OS app data dir for the SQLite file + media/ tree), thiserror (error types), insta (snapshot/golden testing), proptest (round-trip/property), criterion (perf), tempfile (isolated store per test).

#### Project & timeline domain model (opencut-core types)  `1-2 weeks`
**Web:** `apps/web/src/project/types.ts`, `apps/web/src/timeline/types.ts`, `apps/web/src/media/types.ts`, `apps/web/src/animation/types.ts`, `apps/web/src/effects/types.ts`, `apps/web/src/masks/types.ts`, `apps/web/src/params/index.ts`
**Browser deps:** `TypeScript structural/union types (no runtime); discriminated unions on string literal 'type'`, `MediaTime is a branded number (number & {__mediaTime}) from the WASM time module`, `Date objects (in-memory) distinct from their ISO-string serialized form`, `AudioBuffer (Web Audio) referenced by BaseAudioElement.buffer — a runtime-only, non-persisted field`
**Depends on:** opencut-core::time (existing rust/crates/time)

**Features**
- TProject { metadata, scenes[], currentSceneId, settings, version, timelineViewState? } as the root persisted document
- TProjectSettings { fps: FrameRate, canvasSize, canvasSizeMode?, lastCustomCanvasSize?, originalCanvasSize?, background }
- TBackground discriminated union: {type:'color', color:string} | {type:'blur', blurIntensity:number}
- TProjectMetadata { id, name, thumbnail?, duration: MediaTime, createdAt: Date, updatedAt: Date }
- TScene { id, name, isMain, tracks: SceneTracks, bookmarks: Bookmark[], createdAt, updatedAt } and Bookmark { time: MediaTime, note?, color?, duration? }
- SceneTracks { overlay: OverlayTrack[], main: VideoTrack, audio: AudioTrack[] } with exactly one main video track
- 5 track types (video|text|audio|graphic|effect) and 7 element types (Video/Image/Text/Sticker/Graphic/Effect/Audio) all extending BaseTimelineElement (id,name,MediaTime start/duration/trim,animations?,params)
- Element sub-data carried inline: effects: Effect[], masks: Mask[], animations: ElementAnimations, retime: RetimeConfig, sticker intrinsic size, video isSourceAudioEnabled
- Untyped params bag (ParamValues) per element — the data-driven property system
- Type-level element category sets (MASKABLE/RETIMABLE/VISUAL_ELEMENT_TYPES) used by validation and commands

**Native approach** — crates: `serde`, `serde_derive`, `opencut-time (existing rust/crates/time)`, `uuid`
Define the canonical model as Rust structs/enums in a new `opencut-core` crate module `model/` (project.rs, scene.rs, track.rs, element.rs, background.rs). Reuse the existing `time` crate's MediaTime as the tick type (add a non-wasm/serde path so ticks serialize as i64). Model TBackground and each element/track family as serde-tagged enums: #[serde(tag = "type")] to match the on-disk discriminant exactly. Keep `params` as a typed newtype over serde_json::Map (ParamValues) so unknown/forward-compatible keys survive round-trips (mirrors the untyped web bag). The AudioBuffer field becomes #[serde(skip)] runtime-only Option, matching stripAudioBuffers on the web side. This module is the shared vocabulary every other native cluster imports.

_Data structures:_ `struct Project { metadata: ProjectMetadata, scenes: Vec<Scene>, current_scene_id: String, settings: ProjectSettings, version: u32, timeline_view_state: Option<TimelineViewState> }`, `enum Background { Color { color: String }, Blur { blur_intensity: f64 } } with #[serde(tag="type", rename_all="lowercase")]`, `struct BaseElement { id, name, duration: MediaTime, start_time: MediaTime, trim_start, trim_end, source_duration: Option<MediaTime>, animations: Option<ElementAnimations>, params: ParamValues }`, `enum Track { Video(VideoTrack), Text(TextTrack), Audio(AudioTrack), Graphic(GraphicTrack), Effect(EffectTrack) } and struct SceneTracks { overlay: Vec<Track>, main: VideoTrack, audio: Vec<AudioTrack> }`, `newtype ParamValues(serde_json::Map<String, serde_json::Value>) to preserve arbitrary param keys`, `MediaTime(i64) reused from the time crate; serde as i64 ticks`

_Risks:_
- Serde enum tagging must EXACTLY reproduce TS discriminants (e.g. audio elements are double-discriminated: type:'audio' AND sourceType:'upload'|'library') — a mismatch silently breaks JSON compatibility with existing exported projects
- The untyped `params` bag is load-bearing (text props, graphic params live there); over-typing it would drop forward-compatible keys and break round-trip goldens
- Optional-with-default fields (canvasSizeMode?, hidden?, isSourceAudioEnabled?) must use #[serde(default, skip_serializing_if)] to avoid emitting keys the web app never wrote, or additive-only golden equality fails

**Test cases**
- `model-golden-roundtrip` _(golden)_ — For a captured real v31 project JSON exported from the web app, serde deserialize into Project then serialize back and assert byte/JSON-value equality (proves enum tags, optional-field elision, and MediaTime i64 encoding all match the web wire format).
- `model-background-union` _(unit)_ — Deserialize {type:'color',color:'#ff0000'} and {type:'blur',blurIntensity:10} into Background and re-serialize; assert the tag/field layout is preserved and an unknown 'type' errors cleanly.
- `model-params-passthrough` _(property)_ — proptest: for arbitrary JSON objects placed in element.params, round-trip through ParamValues preserves every key/value (forward-compat guarantee).
- `model-mediatime-ticks` _(unit)_ — Assert all time fields serialize as integer ticks (i64) not floats, and match roundMediaTime output for fractional inputs.

---

#### Project (de)serialization layer (SerializedProject wire format)  `1-2 weeks`
**Web:** `apps/web/src/services/storage/types.ts`, `apps/web/src/services/storage/service.ts`, `apps/web/src/timeline/scenes.ts`
**Browser deps:** `Date.prototype.toISOString() / new Date(string) for date (de)serialization`, `structuredClone-free plain-object serialization (IndexedDB stores structured clones; here the value is a plain JSON-compatible object)`, `roundMediaTime from the WASM time module applied at load boundaries`
**Depends on:** Project & timeline domain model (opencut-core types)

**Features**
- saveProject: strips audio buffers (stripAudioBuffers), ISO-serializes createdAt/updatedAt on both metadata and every scene, computes metadata.duration via getProjectDurationFromScenes fallback, writes one SerializedProject record keyed by project id
- loadProject: runs migrations first (ensureMigrations), validates metadata is an object (skips malformed), revives ISO strings back to Date, normalizeBookmarks (accepts legacy number[] OR object bookmarks, rounds MediaTime), roundMediaTime on duration, defaults currentSceneId to ''
- loadAllProjects / loadAllProjectsMetadata (sorts by updatedAt desc, tolerates malformed rows)
- SerializedProject/SerializedScene/SerializedProjectMetadata types = TProject with Date fields replaced by ISO strings
- MediaAssetData metadata shape (id,name,type,size,lastModified,width?,height?,duration?,fps?,hasAudio?,ephemeral?,thumbnailUrl?)

**Native approach** — crates: `serde`, `serde_json`, `chrono`, `opencut-time`
Provide a `persist/serde.rs` in opencut-core with two representations: the in-memory Project (Dates as chrono::DateTime<Utc>, MediaTime ticks) and an on-disk SerializedProject (dates as RFC3339 strings) — implement via serde with `#[serde(with = "chrono::serde::ts_...")]`-style or a custom module that emits exactly `.toISOString()` format (millisecond precision, 'Z' suffix). Port stripAudioBuffers (drop runtime AudioBuffer before write), normalizeBookmarks (accept both a JSON number and an object, round to ticks), the malformed-metadata skip, and the getProjectDurationFromScenes duration fallback as pure functions. Keep the SerializedProject as the canonical JSON both the SQLite store (subsystem 3) and any file export/import use, so the native format stays byte-compatible with the web export for interop.

_Data structures:_ `struct SerializedProject { metadata: SerializedMetadata (createdAt/updatedAt: String), scenes: Vec<SerializedScene>, current_scene_id, settings, version, timeline_view_state }`, `fn normalize_bookmarks(raw: &serde_json::Value) -> Vec<Bookmark> (mirrors number|object handling + tick rounding)`, `fn project_duration_from_scenes(scenes: &[Scene]) -> MediaTime`, `chrono::DateTime<Utc> <-> RFC3339 string conversion module reproducing JS toISOString (always UTC, 3-digit millis)`

_Risks:_
- JS toISOString always yields UTC with exactly millisecond precision and 'Z'; chrono's default RFC3339 can emit nanoseconds/offsets — must pin the format or dates round-trip-diff against existing records
- normalizeBookmarks accepts a bare number (legacy) — the Rust deserializer must use serde_json::Value untagged handling, not a strict struct, or old projects fail to load
- Duration fallback + roundMediaTime must run in the same order as the web loader (service.ts:221) or metadata.duration goldens diverge by 1 tick

**Test cases**
- `serde-date-format` _(golden)_ — Serialize a project with a known createdAt and assert the exact string '2024-01-15T10:00:00.000Z' (matches JS toISOString); parse it back to the same instant.
- `serde-bookmark-legacy` _(unit)_ — normalize_bookmarks over [1.5, 3.0] (legacy number[]) and over [{time,note,color,duration}] yields correctly rounded MediaTime bookmarks; garbage entries are dropped.
- `serde-strip-audio` _(unit)_ — saveProject-equivalent drops the runtime audio buffer field and the reload has no buffer, matching web stripAudioBuffers.
- `serde-malformed-skip` _(unit)_ — A record with null/absent metadata is skipped (returns None) rather than panicking, matching loadProject's guard.
- `serde-fullproject-golden` _(golden)_ — Round-trip a captured real exported project through Serialized<->in-memory<->Serialized and assert JSON-value equality.

---

#### Structured store (IndexedDB -> SQLite)  `1-2 weeks`
**Web:** `apps/web/src/services/storage/indexeddb-adapter.ts`, `apps/web/src/services/storage/service.ts`, `apps/web/src/services/storage/types.ts`, `apps/web/src/sounds/types.ts`, `apps/web/src/motion-presets/types.ts`
**Browser deps:** `IndexedDB (indexedDB.open, object stores, transactions, onupgradeneeded creates store with keyPath 'id', getAllKeys/getAll)`, `One physical IndexedDB database per (projects | media-per-project | saved-sounds | motion-presets)`, `Structured clone semantics of stored values (plain JSON-compatible objects here)`
**Depends on:** Project (de)serialization layer (SerializedProject wire format)

**Features**
- Generic key/value StorageAdapter<T> (get/set/remove/list/clear/getAll) over IndexedDB; set() injects an `id` keyPath
- projectsAdapter (DB video-editor-projects, store projects): whole SerializedProject per project id
- per-project mediaMetadataAdapter (DB video-editor-media-{projectId}, store media-metadata): MediaAssetData rows
- savedSoundsAdapter (single record 'user-sounds' -> SavedSoundsData { sounds[], lastModified })
- presetsAdapter (single record 'user-presets' -> MotionGraphicsPresetsData { presets[], lastModified }) — motion-graphics effect+keyframe bundles
- getStorageInfo / getProjectStorageInfo (counts), deleteProject / deleteProjectMedia / clearAllData
- loadAllProjectsMetadata reads all rows and projects out just metadata (gallery view)

**Native approach** — crates: `rusqlite`, `serde_json`, `directories`, `thiserror`, `r2d2 + r2d2_sqlite (optional pooling)`
Replace the 4 IndexedDB DB families with ONE SQLite file (e.g. {app_data_dir}/opencut/store.db) holding tables: projects(id TEXT PRIMARY KEY, updated_at TEXT, doc TEXT/JSONB), media_metadata(project_id TEXT, media_id TEXT, meta JSON, PRIMARY KEY(project_id,media_id)), saved_sounds(id TEXT PK, doc JSON) with the single 'user-sounds' row, motion_presets(id TEXT PK, doc JSON) with the single 'user-presets' row, and schema_meta(k,v) for the store schema version. Model the web's generic StorageAdapter<T> as a `KvStore` trait so call sites port 1:1; back projects/media by dedicated tables (indexed on updated_at for the gallery sort that loadAllProjectsMetadata does). Use a WAL-mode connection; keep the whole SerializedProject as a JSON text column (no need to shred the timeline into rows — the document is the unit of save/load, exactly like IndexedDB). Store dates as the same ISO strings so the SQLite doc is byte-identical to the IndexedDB value, which lets a one-shot importer migrate an existing user's browser export.

_Data structures:_ `trait KvStore { fn get(&self,key)->Result<Option<Value>>; fn set(&self,key,&Value); fn remove; fn list()->Vec<String>; fn clear(); }`, `struct SqliteStore { conn: rusqlite::Connection } implementing KvStore per logical table`, `table projects(id PK, updated_at TEXT indexed, doc TEXT) — doc = SerializedProject JSON`, `table media_metadata(project_id, media_id, meta TEXT, PRIMARY KEY(project_id,media_id))`, `singleton-row tables saved_sounds / motion_presets keyed by literal 'user-sounds'/'user-presets'`, `PRAGMA journal_mode=WAL, foreign_keys=ON`

_Risks:_
- IndexedDB is schemaless and case/collation-agnostic on keys; SQLite TEXT PK uses BINARY collation — must ensure project ids are used verbatim (they are UUIDs, low risk) 
- loadAllProjectsMetadata currently deserializes the FULL doc then projects metadata; a naive port that json_extract per row is fine, but must reproduce the malformed-row skip and updatedAt-desc ordering
- Concurrency: the GPUI shell and the MCP server (subsystem 7) may both open the store — need WAL + a single pooled connection or a store actor to avoid SQLITE_BUSY
- The web adapter's set() merges {id:key, ...value}; a value already containing an 'id' field must not double-write — replicate that the id column IS the record key, not a duplicated body field

**Test cases**
- `store-kv-roundtrip` _(unit)_ — set/get/remove/list/clear over a temp SQLite store round-trips a SerializedProject value; list() returns exactly the inserted keys.
- `store-metadata-projection` _(unit)_ — loadAllProjectsMetadata-equivalent returns metadata only, sorted by updatedAt desc, and skips a row whose doc has null metadata.
- `store-per-project-media` _(integration)_ — Save 3 media_metadata rows under project A and 2 under project B; deleteProjectMedia(A) removes only A's rows and leaves B intact.
- `store-import-from-indexeddb-export` _(golden)_ — Given a JSON dump equivalent to a browser IndexedDB export, the importer produces a SQLite store whose read-back docs equal the source docs byte-for-byte.
- `store-concurrent-access` _(integration)_ — Two connections (shell + MCP) writing different projects concurrently under WAL both succeed with no SQLITE_BUSY and no lost update.

---

#### Media blob store (OPFS -> native filesystem)  `days`
**Web:** `apps/web/src/services/storage/opfs-adapter.ts`, `apps/web/src/services/storage/service.ts`
**Browser deps:** `OPFS: navigator.storage.getDirectory(), getDirectoryHandle({create}), getFileHandle, createWritable, directory.keys() async iterator, removeEntry`, `File / Blob objects and URL.createObjectURL for handing bytes to the decoder/renderer`, `File.type / File.text() for the SVG sniff and MIME handling`
**Depends on:** Structured store (IndexedDB -> SQLite)

**Features**
- One binary File per media asset, keyed by mediaId, under a per-project directory media-files-{projectId}
- get/set/remove/list/clear over the directory (set overwrites; remove tolerates NotFound)
- saveMediaAsset writes the blob THEN the metadata, with rollback (removes the blob) if metadata write fails, and maps quota errors to StorageQuotaExceededError
- loadMediaAsset reads the File, sniffs SVG-as-image (reads text, checks '<svg'), and builds an object URL
- OPFSAdapter.isSupported() capability gate

**Native approach** — crates: `std::fs`, `directories`, `tokio::fs (if async)`, `infer or tree_magic_mini (MIME/SVG sniff)`, `thiserror`
Replace OPFS with a plain on-disk tree: {app_data_dir}/opencut/media/{projectId}/{mediaId} storing raw bytes, mirroring the OPFS directory-per-project model exactly. Implement the same StorageAdapter surface (get->read file, set->atomic write via tempfile+rename, remove->tolerate NotFound, list->read_dir, clear->remove_dir_all+recreate). Native code hands the renderer a filesystem path or an mmap'd byte slice instead of an object URL — the decoder cluster consumes bytes/paths directly, so the object-URL indirection disappears. Port the SVG-as-image sniff (read first bytes, check for '<svg') and the write-blob-then-metadata ordering with rollback. Because files are real paths, the SQLite media_metadata row should store a relative path, letting the whole {app_data_dir}/opencut folder be copied/backed-up as a self-contained project bundle.

_Data structures:_ `struct FsBlobStore { root: PathBuf } with per-project subdir resolution project_dir(project_id) -> root.join(project_id)`, `atomic write: write to {mediaId}.tmp then fs::rename to {mediaId}`, `media path stored as relative 'media/{projectId}/{mediaId}' in the SQLite metadata row`

_Risks:_
- Atomicity: OPFS createWritable is effectively atomic-on-close; must reproduce via temp-file+rename to avoid torn media files on crash
- The save-then-rollback ordering (blob first, metadata second, delete blob on metadata failure) must be preserved so a crashed write never leaves orphan metadata pointing at a missing file
- Quota mapping: OPFS throws QuotaExceededError; on a filesystem the analog is ENOSPC — map io::Error kind to a StorageQuotaExceededError equivalent (see Quota subsystem)
- mediaId values are used as filenames — must validate they contain no path separators (they are generated ids, but defense-in-depth against traversal, especially since MCP tools may pass ids)

**Test cases**
- `blob-roundtrip` _(unit)_ — set/get/remove/list/clear a byte blob under a per-project dir in a tempdir; list returns exactly stored mediaIds; remove of a missing key is a no-op.
- `blob-atomic-write` _(unit)_ — A write that panics mid-stream (simulated) leaves no partial {mediaId} file, only a leftover .tmp, so reads still see the previous version.
- `blob-save-rollback` _(integration)_ — saveMediaAsset with a forced metadata-write failure deletes the just-written blob, leaving neither blob nor metadata (matches service.ts cleanup).
- `blob-svg-sniff` _(unit)_ — A .svg-content file with empty MIME is detected as SVG image, matching the web loadMediaAsset branch.
- `blob-traversal-guard` _(unit)_ — A mediaId containing '../' or a separator is rejected before touching the filesystem.

---

#### 31-version migration chain (port + golden strategy)  `1-2 months`
**Web:** `apps/web/src/services/storage/migrations/index.ts`, `apps/web/src/services/storage/migrations/runner.ts`, `apps/web/src/services/storage/migrations/base.ts`, `apps/web/src/services/storage/migrations/transformers/ (v0-to-v1 .. v30-to-v31, types.ts, utils.ts)`, `apps/web/src/services/storage/migrations/transformers/v1-to-v2.ts`, `apps/web/src/services/storage/migrations/transformers/v21-to-v22.ts`, `apps/web/src/services/storage/migrations/transformers/v30-to-v31.ts`, `apps/web/src/services/storage/migrations/__tests__/ (fixtures/, helpers.ts, v*.test.ts)`
**Browser deps:** `IndexedDB (runner reads/writes the projects store between steps)`, `culori npm package (v21->v22 colour parsing + sRGB conversion)`, `Plain-object JSON manipulation (no schema); setTimeout for the min-display delay; console for progress`
**Depends on:** Structured store (IndexedDB -> SQLite), Project (de)serialization layer (SerializedProject wire format)

**Features**
- Sequential 31-step upgrade chain, CURRENT_PROJECT_VERSION = 31; each step is a pure fn transformProjectVNToVN1({project}) -> {project, skipped, reason?}
- Version inference for legacy records: explicit version field (v2+), else scenes[] present => v1, else v0 (runner.ts getProjectVersion)
- Runner: sort migrations by from, for each project run only steps whose from == currentVersion, persist after each step, stop on skipped; one-time cleanup of legacy 'video-editor-meta' DB; min 1s progress-dialog display
- Additive-only policy (never delete/rename persisted fields — supports future down-migrations)
- Wide complexity range: no-op version bumps (v9->v10), field backfills (v19->v20 isSourceAudioEnabled default true), enum renames (v30->v31 mask custom->freeform), full structural reshape (v1->v2, ~17KB: legacy flat tracks -> scenes+SceneTracks via a legacy-context map), and colour-space conversion (v21->v22: sRGB->linear RGBA using the culori npm lib)
- Defensive handling of malformed/partial legacy data (all transformers operate on Record<string,unknown> with isRecord/getProjectId guards)

**Native approach** — crates: `serde_json`, `palette`, `csscolorparser`, `thiserror`, `insta (test)`, `proptest (test)`
Port the chain into opencut-core `migrations/` operating on serde_json::Value (the direct analog of Record<string,unknown> — keep it UNTYPED so defensive legacy handling ports 1:1; do NOT deserialize into the strong model until after v31). Each step becomes fn transform_vN_to_vN1(project: Value) -> MigrationOutcome { project, skipped, reason }. A `run_migrations` driver reproduces getProjectVersion inference and the from==current gating, persisting through subsystem 3 after each step. Replace culori in v21->v22 with `csscolorparser` (parse CSS colour strings) + `palette` (Srgb::into_linear) — and pin the exact sRGB transfer function the web used (the code inlines srgbToLinear with the 0.04045/12.92 and 1.055/2.4 constants, so implement that literal formula, NOT palette's default, to guarantee identical linear values). Drop the 1s min-display delay (UI concern). GOLDEN STRATEGY: capture one real project JSON per source version 0..30 from the running web app (script the web storageService to dump each fixture), commit them as fixtures/vN.json, and for each N assert transform_vN_to_vN1(vN.json) == vN1.json (per-step golden) PLUS a full-chain golden: v0.json migrated through all 31 steps equals a committed v31 golden. Use `insta` snapshots so regenerating goldens is one command. This is the single most valuable test asset and does not exist today (web tests cover ~19/31 steps and use narrowing accessors, not equality).

_Data structures:_ `type Project = serde_json::Value (untyped, matches ProjectRecord)`, `struct MigrationOutcome { project: Value, skipped: bool, reason: Option<String> }`, `trait Migration { fn from(&self)->u32; fn to(&self)->u32; fn run(&self, Value)->MigrationOutcome } + a static ordered Vec<Box<dyn Migration>>`, `fn infer_version(&Value)->u32 (explicit version | scenes[] => 1 | 0)`, `exact sRGB->linear: v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055).powf(2.4) reproduced verbatim for v21->v22`

_Risks:_
- COLOUR MATH DRIFT: v21->v22 must produce bit-for-bit (or within a tiny epsilon) identical linear RGBA to culori+the inlined formula, or every project created before v22 renders with subtly wrong colours — pin the transfer function and golden-test against real web output, do not trust a library default
- v1->v2 is a large structural reshape with a legacy-context map (legacyTracksBySceneId, mediaTypesById); porting it wrong corrupts the oldest projects — needs its own dense golden set including empty/malformed/edge fixtures (v0.ts already enumerates projectWithNoId/NullValues/Malformed)
- Additive-only policy: the Rust port must preserve unknown/legacy fields through every step (serde_json::Value naturally does; a premature typed model would DROP them and fail additive goldens)
- Ordering & idempotency: re-running a step on an already-migrated project must skip (each web transformer checks version >= target); the port must keep the same skip/reason strings if any consumer asserts on them
- Fixture provenance: hand-authored fixtures may not reflect real field ordering/extra keys real users have — capture goldens from the actual web app, not by hand, to catch fields the audit didn't enumerate

**Test cases**
- `mig-per-step-golden` _(golden)_ — For every N in 0..30, transform_vN_to_vN1(fixtures/vN.json) equals committed fixtures/vN1.json exactly (31 goldens, captured from the running web app).
- `mig-full-chain-golden` _(golden)_ — v0.json driven through the whole ordered chain yields a project == committed v31 golden; the resulting version field is 31.
- `mig-color-v21-v22` _(golden)_ — v21->v22 converts a set of known CSS colours (hex, rgb(), named, alpha) to linear RGBA matching values captured from the web culori path within 1e-6, using the inlined sRGB formula.
- `mig-version-inference` _(unit)_ — infer_version: explicit version wins; a record with only scenes[] => 1; bare record => 0 (mirrors runner.getProjectVersion).
- `mig-idempotent-skip` _(property)_ — proptest: applying transform_vN_to_vN1 twice equals applying it once (second application skips), for representative fixtures across the chain.
- `mig-malformed-tolerance` _(unit)_ — projectWithNoId / projectWithNullValues / projectMalformed pass through each step without panic, returning skipped where the web returns skipped.
- `mig-additive-preservation` _(property)_ — An extra unknown field injected at v_k survives untouched through all remaining steps to v31 (additive-only guarantee).
- `mig-chain-perf` _(perf)_ — criterion: migrating a large real project (many scenes/elements) v0->v31 completes within a budget (e.g. <50ms) so cold project open stays snappy.

---

#### Storage quota / capacity gate  `days`
**Web:** `apps/web/src/services/storage/quota.ts`, `apps/web/src/services/storage/use-storage-persistence.ts`, `apps/web/src/services/storage/components/storage-persistence-dialog.tsx`, `apps/web/src/services/storage/service.ts`
**Browser deps:** `navigator.storage.estimate() and navigator.storage.persist() (StorageManager API)`, `DOMException names QuotaExceededError / NS_ERROR_DOM_QUOTA_REACHED`, `React dialog component (UI-only)`
**Depends on:** Media blob store (OPFS -> native filesystem)

**Features**
- readStorageQuotaStatus: reads navigator.storage.estimate() -> {quota,usage}, computes headroom = quota-usage and available = headroom - 50MB reserve
- evaluateStorageCapacity: canStore decision (enough-space | insufficient-space | estimate-unavailable) given requiredBytes
- StorageService.canStoreFile gate before saving media; StorageQuotaExceededError + isStorageQuotaExceededError (recognizes QuotaExceededError / NS_ERROR_DOM_QUOTA_REACHED / 'quota' substring)
- formatStorageBytes human display; 50MB STORAGE_HEADROOM_RESERVE_BYTES
- Persistent-storage request UX (navigator.storage.persist) — the dialog

**Native approach** — crates: `sysinfo`, `fs2 (or fs4)`, `thiserror`
Replace navigator.storage.estimate with real free-disk-space on the volume holding {app_data_dir}/opencut, via fs4::available_space / sysinfo disks. Keep the SAME capacity model: available = free_space - 50MB reserve, and the same three-state result enum, so call sites port unchanged. Map ENOSPC io::Error to StorageQuotaExceededError. There is no 'persist' concept on desktop (data is already durable), so the persistence-request dialog and use-storage-persistence collapse to a no-op / capability-true. Keep formatStorageBytes as a pure port for the shell's storage UI.

_Data structures:_ `struct QuotaStatus { total: Option<u64>, used: Option<u64>, headroom: Option<u64>, available: Option<u64> }`, `enum CapacityCheck { EnoughSpace(u64), InsufficientSpace(u64), EstimateUnavailable }`, `const HEADROOM_RESERVE_BYTES: u64 = 50 * 1024 * 1024`

_Risks:_
- Free-space queries are per-volume; must query the volume actually containing the store dir, not the process cwd
- estimate-unavailable path: fs queries rarely fail, but must preserve the 'assume canStore=true' fallback so media import isn't blocked when disk info is unreadable
- ENOSPC detection differs by OS; centralize the io::Error->quota mapping so the blob store (subsystem 4) and MCP tools report the same error type

**Test cases**
- `quota-evaluate` _(unit)_ — evaluateStorageCapacity truth table: required <= available => EnoughSpace; required > available => InsufficientSpace; available None => EstimateUnavailable/canStore true.
- `quota-reserve` _(unit)_ — available = max(free - 50MB, 0); a nearly-full disk yields available 0 and blocks a non-zero write.
- `quota-format-bytes` _(unit)_ — formatStorageBytes matches web output for a spread of values (B/KB/MB/GB, precision rules).
- `quota-enospc-map` _(unit)_ — An io::Error of kind ENOSPC/StorageFull maps to the StorageQuotaExceededError equivalent, matching isStorageQuotaExceededError.

---

#### Native MCP server (rmcp over opencut-core)  `2-4 weeks`
**Web:** `apps/web/src/services/storage/service.ts`, `apps/web/src/core/managers/project-manager.ts`, `apps/web/src/core/managers/save-manager.ts`, `apps/web/src/project/types.ts`, `AGENTS.md (architecture: logic in rust/, UI shells replaceable)`
**Browser deps:** `None — this subsystem does not exist on the web; it is the native surface that replaces the browser's implicit 'the app IS the API' by exposing opencut-core to agents/tools`
**Depends on:** Structured store (IndexedDB -> SQLite), Media blob store (OPFS -> native filesystem), 31-version migration chain (port + golden strategy), Project & timeline domain model (opencut-core types)

**Features**
- (New/greenfield) Programmatic access to the same project model the GPUI shell edits: list/open/create/delete projects, read project metadata + timeline, mutate the timeline (add/remove/move/trim elements, set background, edit keyframes) through the command layer, import/export media
- Resources: expose each project (and its scenes/tracks) as an MCP resource; expose the media inventory
- Tools mirror the editing verbs that exist on the web managers (project-manager.updateSettings, timeline-manager mutations) but routed through opencut-core's command/undo system
- Shares a single opencut-core instance + persistence with the desktop shell (per AGENTS.md: logic lives in the core, shells are replaceable)

**Native approach** — crates: `rmcp`, `rmcp-macros`, `tokio`, `serde`, `serde_json`, `schemars (tool input schemas)`, `thiserror`, `tracing`
Build a thin `opencut-mcp` crate (workspace member alongside apps/desktop and rust/crates/*) that depends on opencut-core and exposes NO domain logic of its own. Use rmcp (official SDK, tokio-based, MCP 2026-07-28) with the #[tool_router]/#[tool] macros: each tool is a small async handler that locks a shared core handle (Arc<Mutex<EditorCore>> or a core actor/mpsc command channel) and calls the SAME command/timeline/project API the GPUI shell uses, so persistence, migrations, undo, and autosave all go through subsystems 1-6 unchanged. Expose projects as MCP resources (uri opencut://project/{id}) whose contents are the SerializedProject JSON (subsystem 2), and media as opencut://project/{id}/media/{mediaId}. Serve stateless over the 2026-07-28 spec (rmcp default) via stdio for a local desktop connector and optionally streamable-HTTP. Because the core owns a single SQLite connection (subsystem 3), route all core access through one actor to serialize writes and avoid SQLITE_BUSY between the MCP server and the shell. Tool input/output types are #[derive(Serialize,Deserialize,JsonSchema)] structs derived from the domain model so the tool schemas stay in lockstep with the persisted model.

_Data structures:_ `struct OpencutMcp { core: CoreHandle } where CoreHandle is an mpsc/actor front to the single EditorCore + store`, `#[tool] async fn list_projects() -> Vec<ProjectMetadata>; open_project{id}; create_project{name}; delete_project{id}`, `#[tool] async fn set_background{project_id, background: Background}; add_element{...}; move_element{...}; upsert_keyframe{...} — each returns a CommandResult summary`, `MCP Resource provider mapping opencut://project/{id} -> SerializedProject JSON, opencut://project/{id}/timeline -> scenes/tracks view`, `enum McpError (thiserror) mapping core/persistence/quota errors to JSON-RPC error responses`

_Risks:_
- Shared mutable core: the MCP server and GPUI shell mutating the same project concurrently need a single serialization point (actor/command queue) or edits race and autosave clobbers — design the core handle as the single writer from day one
- rmcp is young and the 2026-07-28 spec is recent; API churn is likely — pin the version and isolate rmcp behind the tool handlers so a bump doesn't ripple into opencut-core
- Tool schema drift: if tool input structs are hand-written rather than derived from the domain model, they will drift from the persisted shape — derive JsonSchema from the model types
- Undo/redo semantics over MCP: agents issuing many tool calls can flood history; decide batching (BatchCommand analog) and whether MCP edits are undoable in the shell's history
- Auth/trust boundary: an MCP tool that imports media takes a file path/bytes — reuse the blob store's traversal guard and quota gate; do not let a tool write arbitrary paths

**Test cases**
- `mcp-list-open-roundtrip` _(integration)_ — create_project -> list_projects shows it -> open_project returns its timeline; delete_project removes it; all changes are visible in the SQLite store.
- `mcp-set-background-persists` _(integration)_ — set_background tool sets {type:color} on a project; reloading the project from the store (subsystem 3) reflects it and the change went through the command layer (undoable).
- `mcp-resource-json` _(golden)_ — Reading opencut://project/{id} returns SerializedProject JSON equal to what the persistence layer would write for that project.
- `mcp-concurrent-writer` _(integration)_ — An MCP mutation and a shell-simulated mutation issued concurrently are serialized by the core actor with no lost update and no SQLITE_BUSY.
- `mcp-tool-schema` _(unit)_ — Each tool's generated JSON schema deserializes a representative argument payload and rejects a malformed one (schema stays in sync with the domain model).
- `mcp-media-guard` _(unit)_ — An import-media tool call with a traversal path or oversized file is rejected by the blob-store guard / quota gate, returning a structured McpError.
