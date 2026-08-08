# Phase 1 — bay-core — headless framework-agnostic engine

[← Phase 0](phase-0.md) · [Plan](plan.md) · [Tasks](task.md) · [Phase 2 →](phase-2.md)

**Estimated duration:** 9-12 months · **Tasks:** 67

## Goal
Build the entire editing engine as one headless crate with NO UI and NO framework dependency: the domain model + params/color/fps foundations, SQLite/blob persistence + both migration chains, the owned Editor with the Command/Query dispatch surface (undo/redo, autosave, EventBus), the full pure timeline-editing kernel set, animation/keyframes/motion-presets, effects/masks/graphics/gradients (reusing the native GPU crates), media decode + offline audio + text/fonts + subtitle formats + transcription, and the rendering pipeline (scene-build -> resolve -> native raster -> frame-descriptor -> compositor -> export). Exit milestone: a fixture project loads through migrations, is edited via the Command API with correct undo/redo, autosaves to SQLite+blob, resolves+composites through the native compositor, and exports to MP4/WebM with mixed audio — all headless, all golden-tested.

## ✅ Exit gate (must all pass to advance)
- [ ] HEADLESS END-TO-END MILESTONE: a CLI loads a fixture project through the 31-step migration chain, edits it via the Command API with correct undo/redo, autosaves to SQLite+blob, resolves+composites through the native compositor, and exports to MP4 AND WebM with mixed audio
- [ ] Tier-0 descriptor goldens, tier-1 CPU-raster goldens (0-tol), and tier-2 GPU frame goldens (tolerant, software adapter) all green cross-platform
- [ ] Both migration chains pass per-step + full-chain goldens; command undo/redo property tests pass; serde roundtrip matches captured web JSON
- [ ] The Command/Query enum is complete enough to be the MCP surface (Phase 2 has no missing verbs)
- [ ] Perf smoke passes (drag preview within frame budget, audio callback no-underrun) — 4K60 and hw-decode stability are deferred to Phase 4
- [ ] Every cross-cluster dependency named in the inventories is provided by a real task (params/gradients/fps/graphics/stickers/subtitle-formats/motion-presets all landed)

## Test strategy for this phase
Land the pure days-scale slices first (Selection, Clipboard, bookmarks, fps, params, audio-gain, subtitle formats) to validate the owned-Editor+Command+EventBus+imbl architecture before the 1-2 month bulk (TimelineManager, resolve, raster, text, decode, audio). Every pure kernel gets property tests for its invariant (trim/span, undo/redo, interval algebra, snapshot roundtrip) plus goldens ported from the existing TS __tests__. Rendering uses the three-tier golden ladder; text goldens are regenerated natively (never shared with web). Migration + serde use provenance-correct web-captured fixtures. Perf benches (criterion) gate the hot paths at agreed budgets.

## Deliverables
- bay-core crate: domain model + params/color/fps foundations with i64-tick MediaTime parity
- Single-file SQLite store + native blob store + both migration chains (project v0..31 and keybindings v2..7) with full-chain goldens + a browser-export importer
- Owned Editor with the serde-tagged Command/Query dispatch surface: undo/redo, ripple, autosave, coalesced EventBus, and all 12 managers-as-modules over one EditorState
- Full pure timeline kernel set (core-model, update-pipeline, placement, snapping, group-move/resize, ripple, retime, bookmarks, drop-target, ruler) backed by imbl
- Animation math + keyframe CRUD + param channels + motion presets; effects registry + native GPU pipeline; masks shapes/raster/interaction-math/JFA feather; graphics registry; gradients parser+rasterizer
- Media decode (hwaccel), offline audio (decode/resample/retime/mix/master/waveform), thumbnails, import pipeline, real-time cpal playback engine, ASR runner; text layout+fonts; subtitle SRT/ASS formats + caption chunking; sticker source vendoring
- Rendering pipeline: scene-build -> resolve -> tiny-skia raster -> in-process FrameDescriptor -> native compositor -> MP4/WebM export with audio
- Three-tier golden suites (descriptor/CPU-raster/GPU-tolerant) + migration-fixture + parity + perf-bench suites green in CI

## Workstreams & tasks

### Workstream: Foundations

#### `P1-FND-04` — time crate serde/non-wasm extension
Add a non-wasm/serde path to rust/crates/time so MediaTime serializes as i64 ticks and roundMediaTime/mediaTimeFromSeconds/roundFrameTime/clampMediaTime are callable outside wasm, guaranteeing bit-parity with the web.

> **Test gate:** Golden: add/sub/clamp/roundFrame/snapSeek match the TS media-time fixtures; MediaTime serde emits integer ticks, never floats.

#### `P1-FND-01` — Domain model (bay-core types)
Define Project/ProjectSettings/Background/Scene/Bookmark/SceneTracks and the 5 track + 7 element serde-tagged enums (matching TS discriminants exactly, incl. audio's double sourceType discriminant), with ParamValues as a typed newtype over serde_json::Map to preserve forward-compatible keys; AudioBuffer field is #[serde(skip)] runtime-only.

> **Test gate:** Golden roundtrip: a captured real v31 project JSON deserializes and re-serializes to JSON-value equality (proves enum tags, optional-field elision, i64 ticks).

#### `P1-FND-02` — Params registry + color model (FOUNDATIONAL)
Port dep/apps/web/src/params: ParamDefinition/ParamValue, buildDefaultParamValues, and parseColorToLinearRgba/formatLinearRgba. This is the single source of the shared value type that animation, effects, masks, graphics, gradients, and text all reference; it MUST land before them.

> **Test gate:** Unit: buildDefaultParamValues seeds every element/effect/mask/graphic default; color parse/format round-trips linear RGBA against captured web values (gamma/clamp/hex-format exact).

#### `P1-FND-03` — fps utils
Port dep/apps/web/src/fps: frameRateToFloat, standard-rate snapping/tolerance, detect-fps-from-asset, getRaisedProjectFpsForImportedMedia, presets/defaults — the shared module consumed by placement, export framecount, ruler, and the project fps-ratchet.

> **Test gate:** Property: getRaisedProjectFpsForImportedMedia never lowers fps and matches web output; unit tests for rate snapping across 24/25/30/29.97/60.

### Workstream: Persistence

#### `P1-PER-01` — SerializedProject (de)serialization layer
Two representations (in-memory chrono DateTime + ticks vs on-disk ISO strings) with a chrono module reproducing JS toISOString exactly (UTC, 3-digit millis, 'Z'); port stripAudioBuffers, normalizeBookmarks (accept legacy number[] OR object), malformed-metadata skip, and getProjectDurationFromScenes fallback + load-time roundMediaTime.

> **Test gate:** Golden: serialize a known createdAt to '...T...000Z'; normalize_bookmarks handles legacy numbers and objects; full-project Serialized<->in-memory roundtrip equals captured web JSON.

#### `P1-PER-02` — Structured store (IndexedDB -> SQLite) + KvStore
Collapse the 4 IndexedDB DB families into one WAL-mode SQLite file (projects, media_metadata, saved_sounds, motion_presets, schema_meta) behind a KvStore trait; store SerializedProject as a JSON doc column indexed on updated_at; keep the doc byte-identical to the IndexedDB value to enable a one-shot browser-export importer.

> **Test gate:** Unit KvStore roundtrip; metadata-only projection sorted by updated_at desc skipping malformed rows; golden import from an IndexedDB-export dump equals source docs.

#### `P1-PER-03` — Media blob store (OPFS -> native filesystem)
Per-project media/{projectId}/{mediaId} raw-byte tree with atomic temp-file+rename writes, blob-then-metadata ordering with rollback, SVG-as-image sniff, and a mediaId path-traversal guard; store relative paths so the app folder is a self-contained backup unit.

> **Test gate:** Unit: roundtrip + missing-key no-op; simulated mid-write crash leaves no partial file; forced metadata failure deletes the just-written blob; '../' mediaId rejected.

#### `P1-PER-04` — 31-version project migration chain + golden strategy
Port all 31 sequential steps over serde_json::Value (untyped, additive-only), version inference (explicit | scenes[]=>1 | 0), and the driver that persists after each step; reproduce the v21->v22 sRGB->linear transfer function INLINE (0.04045/12.92, 1.055/2.4) — not palette's default — and the large v1->v2 reshape. Do NOT replicate the web runner's undefined-dbName bug.

> **Test gate:** Golden: per-step vN->vN+1 for all 31 steps against web-captured fixtures; full-chain v0->v31 equals the v31 golden; v21->v22 color within 1e-6; property test proves unknown fields survive to v31 (additive) and steps are idempotent.

#### `P1-PER-05` — Storage quota / capacity gate
Replace navigator.storage.estimate with real free-disk-space (fs4/sysinfo) on the store volume; keep the same available = free - 50MB reserve model and three-state result; map ENOSPC to StorageQuotaExceededError; persist-request UX collapses to a no-op.

> **Test gate:** Unit: capacity truth table (enough/insufficient/unavailable); available clamps at 0 near-full and blocks writes; ENOSPC maps to the quota error type.

#### `P1-PER-06` — Keybindings persisted-state + 6-step migration chain
Completeness-critic addition the persistence cluster missed: port the actions/keybindings store and its OWN v2->v7 migration chain (5 transformers) with the same per-step + full-chain golden rigor as the project chain; wired into P1-PER-02.

> **Test gate:** Golden: per-step v2->v7 and full-chain v2->v7 against web-captured keybindings fixtures; malformed bindings pass through without corruption.

### Workstream: Editor core & managers

#### `P1-CORE-03` — Observable / EventBus reactivity model
Collapse the 9 per-manager listener sets into a coalesced EventBus: bitflags DomainFlags, per-domain AtomicU64 version counters, a tokio broadcast channel emitting ONE EditorEvent at end of each committed command (post-reactor, post-ripple) so SaveManager/MCP/UI never see torn state.

> **Test gate:** Unit: a timeline mutation marks TIMELINE|SCENES not PLAYBACK, version increments once; a BatchCommand of N edits emits exactly one event; property: M subscribers observe K monotonic gapless events.

#### `P1-CORE-04` — SelectionManager
1:1 pure port: SelectionSnapshot/SelectionPatch (all-Option), mutually-exclusive setters, getActiveSelectionKind priority (mask-points>keyframes>elements), applyPatch touches only Some fields. Ideal first-landing slice.

> **Test gate:** Unit exclusivity + kind priority; property: restoreSnapshot(getSnapshot()) is identity; applyPatch updates only present fields.

#### `P1-CORE-02` — Command pattern & undo/redo
Serde-tagged Command enum (one variant per ~45 TS command classes) = the shared MCP surface; execute(&mut EditorState,&Ctx)->CommandResult; History with prev_selection, selectionOverride (restore selection ONLY when declared), Inverse-snapshot undo backed by imbl for O(1) clones, ripple-inside-execute/redo, BatchCommand reverse-undo, and push-without-execute for commitPreview.

> **Test gate:** Golden per-variant execute+undo byte-parity; property: k undos+redos == original state; unit: selectionOverride policy, batch reverse order; golden: ripple parity; perf: 1000 UpdateElements on 500 elements p99 + resident memory vs Vec-clone baseline.

#### `P1-CORE-01` — Owned Editor + EditorState central model + lifecycle
Replace the process-global singleton with an owned Editor { state, history, events }; construct managers-as-modules in fixed order (command semantics first), register default effects/masks and the empty-track-pruning reactor, wire playback timeline scope; reset() = drop+recreate.

> **Test gate:** Unit: Editor::new registers defaults + pruning reactor and yields a valid main scene + empty history; drop+recreate yields independent state (no history/selection leakage) — parity with EditorCore.reset().

#### `P1-CORE-05` — ClipboardManager
ClipboardState { entry: Option<ClipboardEntry> }; copy = non-undoable state set (false on empty), paste builds+executes a Command at playhead/time; serde-serializable entry with an optional arboard OS-clipboard bridge decision.

> **Test gate:** Unit: copy-empty returns false; paste-no-entry executes nothing; golden: paste places elements at time producing expected tracks + one undo step.

#### `P1-CORE-06` — SaveManager (autosave)
Debounced 800ms tokio task subscribing to TIMELINE|SCENES EventBus flags; single-writer is_saving guard, re-queue-if-dirtied, pause/resume(flush), force markDirty, and a synchronous flush for shutdown; never save mid-migration/mid-load.

> **Test gate:** Unit: N markDirty in-window = one save; paused suppresses unless force, resume flushes; in-flight dirty re-queues; integration: flush persists immediately and clears dirty.

#### `P1-CORE-07` — DiagnosticsManager
Vec<Diagnostic{def, check: Box<dyn Fn(&EditorState)->bool>}>; getActive filters by scope then evaluates pure predicates; register transcription diagnostics at construction; exposed later as an MCP health query.

> **Test gate:** Unit: scope filter; only checks returning true are active; register emits one DIAGNOSTICS change.

#### `P1-CORE-08` — ProjectManager
ProjectState owns the canonical project (incl. scenes); createNewProject default shape, load/export state machines emitting progress events, updateSettings via undoable command, ratchetFpsForImportedMedia, duplicate '(n) Name' numbering; heavy steps (thumbnail/fonts/migrations/export) delegated to other clusters — orchestration only.

> **Test gate:** Golden: createNewProject default Project shape; unit: dup numbering, updateSettings undo restores prior settings; property: fps ratchet never lowers and matches web.

#### `P1-CORE-09` — ScenesManager (single-owner scenes)
Eliminate the TS dual-source-of-truth: project owns scenes: Vector<Scene>, ScenesState holds only current_scene_id + accessors; updateSceneTracks is the one funnel writing into project.scenes + marking dirty; ensureMainScene invariant; frame-quantized bookmarks via injected clock.

> **Test gate:** Unit: initializeScenes adds exactly one main scene + marks dirty; golden: updateSceneTracks writes active scene AND project.scenes with matching updated_at; property: deleteScene never removes main/last.

#### `P1-CORE-10` — PlaybackManager (clock injection)
PlaybackState (is_playing/current_time/volume/muted/scrubbing); replace RAF/performance.now with an injectable Clock (manual step-clock headless, audio-device or frame clock live); reuse the time crate for tick math; reconcile-on-timeline-change (re-clamp + auto-pause).

> **Test gate:** Golden: mock elapsed sequence -> current_time matches time-crate reference; unit: seek clamp + auto-pause-at-end; unit: shrinking timeline re-clamps; property: current_time always in [0,duration].

#### `P1-CORE-11` — MediaManager (asset registry)
MediaState { assets: Vec<MediaAsset> } referencing native file paths/handles (not blob URLs); optimistic insert + rollback + quota mapping, removeMediaAsset(s) routed through single/Batch command (undoable), import-time fps ratchet; decode/blob-URL caches disappear (owned by media cluster).

> **Test gate:** Unit: addMediaAsset assigns fresh id + triggers ratchet; removeMediaAssets builds Batch for >1 / single for 1; golden: registry serde stable field order.

#### `P1-CORE-12` — RendererManager (render-tree state & export orchestration)
RendererState { render_tree, degraded }; snapshot renders one frame to RGBA -> PNG via image crate; export = progress/cancel state machine emitting EditorEvents and handing the scene to the export cluster; thin state/orchestration only.

> **Test gate:** Unit: setRenderTree/getRenderTree, setDegraded emits one RENDERER change; unit: export FSM idle->exporting->done and cancel short-circuits; integration: saveSnapshot produces valid PNG with timecode filename.

### Workstream: Timeline editing engine (pure kernels)

#### `P1-TL-01` — timeline-core-model
SceneTracks + TimelineTrack/TimelineElement enums backed by imbl::Vector for COW parity with TS spreads; immutable tree nav/update (find/update Track/Element in SceneTracks), calculateTotalDuration, element constructors with default param seeding; reuse MediaTime, decouple element metadata from decoded PCM.

> **Test gate:** Golden serde roundtrip vs web fixture (all 5 track types, retime, animations, params); unit: update helpers hit correct track + honor predicate; property: input never mutated + untouched subtrees pointer-shared.

#### `P1-TL-08` — retime-speed (rate math)
clampRetimeRate/canMaintainPitch, source<->clip time mapping (getSourceTimeAtClipTime etc.), duration-for-span, split/adjust-for-trim, buildConstantRetime — trivial pure arithmetic feeding update-pipeline/group-resize (audio time-stretch lives in P1-MED-04).

> **Test gate:** Golden: port resolve.test.ts/split.test.ts mappings; unit: clampRetimeRate (NaN/<=0->1, clamp[0.01,5]).

#### `P1-TL-02` — update-pipeline
Ordered derive-then-enforce rules with a changedFields set and an ElementField enum (not stringly-typed): retime-derive recomputes duration before duration-enforce clamps animation keyframes; main-track earliest pins to ZERO; getSourceDuration fallback.

> **Test gate:** Golden: patching retime.rate recomputes duration + reports [retime,duration]; unit: main-track pin + negative clamp; property: trimStart+duration*rate+trimEnd==sourceDuration exact in i64.

#### `P1-TL-03` — placement-engine
Near-1:1 port of the densest pure island: 5 strategies (explicit/firstAvailable/preferIndex/aboveSource/alwaysNew), half-open overlap test, element->track compatibility, insert-index math, enforceMainTrackStart, applyPlacement; inject a UUID source for determinism; extract the shared display-index TrackPlacement helper.

> **Test gate:** Golden: port resolve.test.ts wholesale (every strategy x track-type); property: overlap iff half-open intersect, touching edges don't; golden: applyPlacement splice leaves siblings untouched.

#### `P1-TL-04` — snapping
buildTimelineSnapPoints from lazy sources (element edges/playhead/bookmarks/keyframes with exclude sets), resolveTimelineSnap nearest-within-threshold with first-wins ties, pixel->tick threshold; back the hot path with a sorted Vec/BTreeMap binary search instead of O(n) scan.

> **Test gate:** Unit: nearest within threshold + identity outside + first-on-ties; unit: threshold scales inversely with zoom; perf: 10k-element build+resolve under mousemove budget, indexed beats linear.

#### `P1-TL-05` — group-move
Highest-complexity pure module: buildMoveGroup (per-member offsets/section/displayIndex, dedupe anchor), resolveGroupMove existing-track (bidirectional compatible-track search with used-set, clamp anchor, overlap validation against moving-vs-moving THEN moving-vs-stationary) and new-track (audio XOR non-audio), snapGroupEdges (all member edges, global closest, back-solve anchor); returns None to reject.

> **Test gate:** Unit: offsets/dedupe; golden: mixed overlay+main+audio lands on compatible display-adjacent tracks no overlaps; unit: clamp + main pin; golden: all-audio/all-overlay new-track indices, mixed returns None; property: snap only when an edge within threshold.

#### `P1-TL-06` — group-resize
computeGroupResize: shared delta to left/right edges clamped to tightest per-member bound (min 1 frame, neighbor bounds, source-extent), single frame-snap then re-clamp (source bound wins over frame alignment), retime source<->clip conversion; i64 makes the trim/span invariant exact by construction; relocate buildResizeMembers into the pure crate.

> **Test gate:** Property: trim+duration*rate+trimEnd==sourceDuration exact after any resize; golden: 2x-retimed right-edge resize tick-for-tick vs web; unit: tightest bound wins + frame-snap-vs-source-bound; unit: neighbor bounds ignore selected siblings.

#### `P1-TL-07` — ripple
Pure interval algebra: diff before/after SceneTracks per track for freed intervals minus joined intervals (skip cross-track moves via a global allAfterElementIds set), normalize/subtract interval sets, buildAdjustments, apply in DESCENDING afterTime order to avoid double-shift; imbl for cheap new-SceneTracks.

> **Test gate:** Golden: mid-track delete shifts downstream by its duration, other tracks untouched; unit: trim frees only vacated tail; unit: cross-track move produces no ripple; property: subtract yields disjoint/sorted/within-source; property: never increases duration or produces negative starts.

#### `P1-TL-09` — bookmarks-model
Vec<Bookmark> kept sorted by exact tick; toggle/remove/update/move (re-sort), getFrameTime quantize, getBookmarksActiveAtTime inclusive end; encapsulate the sorted invariant; snap source emits Bookmark SnapPoints.

> **Test gate:** Unit: toggle add-sorted/remove; move relocate+re-sort; active includes zero-duration only at exact time; property: array stays sorted after any op sequence.

#### `P1-TL-11` — scale-ruler-viewport-utils (pure math)
Port px<->time, exponential slider<->zoom, getTimelineZoomMin fit-to-duration, CapCut-style getRulerConfig (ticks divide labels) and formatRulerLabel; pass device scale + bounds as params (GPUI supplies them later), keep math independent of DOM.

> **Test gate:** Property: zoomToSlider(sliderToZoom(p))==p; golden: getRulerConfig across zoom x fps matrix (ticks divide labels); unit: label formatting + px/time inverse.

#### `P1-TL-12` — drop-target-computation
computeDropTarget parameterized by a LayoutMetrics height provider (not baked theme constants): y-hit-test over cumulative heights + gaps (direction-resolved), x->time, findElementAtPosition for effect/mask drops, empty/out-of-bounds fallbacks via placement-engine; getDropLineY stays UI-side.

> **Test gate:** Golden: top/bottom-half hover yields existingTrack with main-pin xPosition; unit: incompatible/gap -> newTrack indices; unit: targetElement match; unit: empty/above/below fallbacks.

#### `P1-TL-13` — TimelineManager (mutation & query surface)
The richest MCP verb slice: thin dispatch methods construct Command variants (add/insert/move/split/delete/duplicate, trim/retime, clip-effects, masks, keyframes wrapped in Batch when >1, applyMotionPreset); previewOverlay = HashMap<ElementId,ElementPatch> merged into derived preview_tracks; commitPreview pushes ONE TracksSnapshot; typed sparse ElementPatch replaces Partial<TimelineElement>; pure query fns over &SceneTracks.

> **Test gate:** Golden: previewElements == applyPreviewOverlay, commitPreview == direct updateTracks(after); property: preview+discard leaves tracks unchanged, pushes nothing; unit: removeKeyframes last-key backfills sampled playhead value, upsert>1 wraps one Batch; perf: 60fps preview on 12-track/500-element within frame budget.

### Workstream: Animation & keyframes

#### `P1-ANIM-01` — animation-channel-curve-math
New pure crate depending only on time+params: ScalarChannel/DiscreteChannel/composite color ChannelData; getScalarChannelValueAtTime porting the 20-iteration time-axis bisection THEN value-axis cubic (naive uniform t won't match), extrapolation hold|linear, color fold via linear-RGBA; resolveTransform/Opacity/Number/Color for the render tree. Decide f32-vs-f64 to hit parity.

> **Test gate:** Golden: asymmetric-handle bezier at 32 times within tolerance; property: normalize idempotent + monotonic-segment solved progress non-decreasing; unit: extrapolation with 0/1/2 keys, discrete step-hold, composite color fold; golden: resolveTransform vs animated-params fixtures.

#### `P1-ANIM-02` — animation-keyframe-crud
Port keyframes.ts/keyframe-query.ts/curve-bridge.ts: upsert/remove/retime/setChannel, cloneAnimations (fresh ids via injected IdSource), clampAnimationsToDuration, splitAnimationsAtTime, getElementKeyframes dedup (prefer componentIndex 0), curve<->normalized-cubic-bezier bridge with flat-segment fallback.

> **Test gate:** Unit: upsert/remove/retime re-sort; property: clone assigns all-new unique ids preserving values/curves; golden: split partition + query dedup; property: handles<->cubic roundtrip within epsilon.

#### `P1-ANIM-03` — animation-param-channels
effects.<id>.params.<key> path build/parse using the exact SUFFIX indexOf split (ids may contain dots), resolveEffectParamsAtTime bridging animated-or-static params into effect uniforms each frame, graphic-param equivalent, ANIMATION_PROPERTY_GROUPS linkage; shares ParamValue with P1-FND-02.

> **Test gate:** Unit: path roundtrip (dotted ids, empty key rejected); unit: resolve returns animated for keyframed / static otherwise; property: id-remap rewrites only matching prefixes.

#### `P1-ANIM-04` — motion-presets
Completeness-critic addition (currently split across 3 clusters): preset-ops capture effects+animations from an element and stamp onto others with effect-id remapping, plus the CRUD store (SQLite motion_presets table from P1-PER-02) and the ApplyMotionPreset command.

> **Test gate:** Golden: capture+stamp reproduces web preset-ops output with remapped ids; unit: ApplyMotionPreset is one undo step; store CRUD roundtrip.

### Workstream: Effects, masks, graphics & gradients

#### `P1-FX-01` — effects-registry-and-definitions
Unify the TS uniform-builder closures and the Rust per-shader match: a native EffectDefinition (params + a fn-registry or data-driven UniformSpec) whose resolveEffectPasses yields the existing effects::EffectPass type directly (closing the duplication); port intensityToSigma + buildGaussianBlurPasses verbatim; keyword-searchable DefinitionRegistry.

> **Test gate:** Unit: register/get/keyword-search; buildDefaultEffectInstance defaults; golden: blur pass count + per-pass sigma/step/direction across sigma 1..8; unit: resolved passes feed pack_effect_uniforms with no Unsupported/Missing errors.

#### `P1-FX-02` — effects-gpu-pipeline (native de-wasm)
Build the existing effects crate without wasm gating against a native wgpu backend, fed by P1-FX-01's pass lists (no serde-wasm-bindgen); consolidate the uniform contract to the registry; add headless-adapter GPU golden tests (new infra for this repo).

> **Test gate:** Carry-forward pack_effect_uniforms unit tests; golden: headless blur + brightness output PNG vs fixture; perf: 8-iteration blur on 4K within a frame budget.

#### `P1-MASK-02` — masks-interaction-and-snapping (math)
Port the pure geometry/snap/param-update/handle-position math (atan2 rotation, half-plane feather projection along per-shape normal, clamped resize ratios, MIN_MASK_DIMENSION/MAX_FEATHER) into the masks crate; share preview-snap primitives with P1-RND-02 rather than duplicating. UI is Phase 3.

> **Test gate:** Unit: port snap.test.ts fixtures; center roundtrip guarded at zero bounds; edge/corner/scale clamp + rotation normalized to [0,360); feather projects onto normal + clamps.

#### `P1-MASK-01` — masks-shapes-and-rasterization (tiny-skia)
Replace Canvas2D with tiny-skia: 8 builtin shape path builders + freeform cubic-bezier (de Casteljau insert, closest-point), fill/stroke with stroke-align as an offset path (getStrokeOffset), split analytic linear-gradient feather (zeroing GPU feather), text mask via cosmic-text+swash; preserve fillPath/drawWithFeather/opaqueFastPath branching and content-hash cache keys (canonical BTreeMap serialization).

> **Test gate:** Golden (AA tolerance): rect/ellipse/heart/star/diamond alpha; split analytic feather ramp direction/extent; unit: half-plane clip epsilon/degenerate; property: de Casteljau insert preserves curve; unit: stroke-align offsets; golden: text mask 'AB'.

#### `P1-MASK-03` — masks-gpu-feather (native de-wasm)
Reuse the JFA-SDF crate against a native adapter (remove wasm gating), fed the alpha texture from P1-MASK-01; verify RGBA8 16-bit seed encoding + step count at 4K; honor the frame-descriptor contract that split/drawWithFeather arrive with feather=0.

> **Test gate:** Golden: feathered circle alpha ramp width + radial symmetry; unit: seed codec roundtrip incl. no-seed sentinel; unit: step count == ceil(log2(max(w,h))); perf: full JFA on 4K within budget.

#### `P1-GFX-01` — graphics-definitions registry
Completeness-critic addition: port dep/apps/web/src/graphics — DefinitionRegistry, rectangle/ellipse/polygon/star GraphicDefinition.render as kurbo BezPath fill/stroke, default-instance builders, stroke handling, and resolveGraphicElementParamsAtTime (called every frame by resolve).

> **Test gate:** Golden: each shape at 512px vs reference PNG; unit: default-instance param seeding; unit: resolveGraphicElementParamsAtTime returns animated values at sampled times.

#### `P1-GRAD-01` — gradients parser + tiny-skia rasterizer
Completeness-critic addition (1577 LOC reduced to a footnote in the inventories): a full CSS gradient parser (linear/radial/conic, directions, stops+positions, interpolation) feeding tiny-skia Linear/Radial gradient shaders; shared by background color, text background, and graphic fills.

> **Test gate:** Golden PNG (small tolerance): linear + radial gradient strings from real projects; unit: parser handles hex/rgb()/named/angles/side-corner and rejects malformed.

### Workstream: Media & audio

#### `P1-MED-02` — audio-decode-resample
Replace mediabunny+OfflineAudioContext: decode with symphonia (ffmpeg fallback), produce planar AudioBufferF32, resample with rubato (SincFixedIn/FftFixedIn); decode_to_mono_f32(target) = decode + channel-average + resample matching decodeAudioToFloat32 for the 16kHz Whisper feed; cache by asset id; clamp 2 channels.

> **Test gate:** Property: resampled length ~ ceil(n*target/native)±1; golden: stereo->mono_16k matches recorded vector; integration: mp3/wav/flac/opus/m4a decode with correct rate/channels/duration.

#### `P1-MED-01` — media-demux-decode (ffmpeg-next + hwaccel)
Replace mediabunny: MediaProbe (duration/tracks/codec/wh/avg-fps/can_hw_decode) and a DecoderPool/FrameSink with seek(pts) porting VideoCache's iterate-vs-seek heuristic + single-frame prefetch + seek-generation cancellation onto avformat_seek + decoder flush; hwaccel via P0-MED-01 backend with SW fallback; frames land as GPU textures via the P0-MED-02 color stage.

> **Test gate:** Golden probe table (h264/hevc/vp9/av1/audio-only); golden: seeked frame PTS fall in VideoCache-valid windows + stale seeks return cached frame; integration: hw-unavailable SW fallback identical; perf: 1080p60 seek latency + no memory growth over 10k seeks.

#### `P1-MED-03` — audio gain & source-audio model (merged)
Merges the double-listed audio-gain-model + audio-separation-and-state (same files): dB<->linear, getElementVolume/isElementMuted, hasAnimatedVolume, resolveEffectiveAudioGain (keyframe-resolved at rounded local ticks honoring mute), buildWaveformGainSamples/buildAudioGainAutomation, buildSeparatedAudioElement (clone ONLY volume channel with fresh ids), source-audio predicates. Foundational for mix+playback.

> **Test gate:** Property: dBToLinear(clampDb) monotone, 0dB->1.0; golden: gain at keyframed times = linear ramps, muted->0; golden: buildSeparatedAudioElement copies trim/retime + clones volume with fresh ids; unit: automation density covers [from,to]+endpoint.

#### `P1-MED-04` — audio-retime-pitch (rubato + signalsmith)
Two paths: resample-retime via rubato (linear-interp source read matching buildResampledBuffer) and pitch-preserved stretch via ssstretch/signalsmith-stretch replacing soundtouchjs (tempo=rate, pitch=1); port source<->clip mapping (constant+curve). Accept a quality UPGRADE, validate perceptually not byte-for-byte.

> **Test gate:** Property: clip<->source mapping roundtrip (port resolve.test.ts); unit: output length == ceil(clipDuration*targetRate); golden: 0.5x/2.0x stretch duration + preserved FFT fundamental within tolerance.

#### `P1-MED-06` — audio-mastering (native limiter)
Port the WebAudio DynamicsCompressor chain to a native feed-forward limiter (envelope follower, threshold -1dB/ratio 20/attack 1ms/release 120ms, outputGain 0.98, clamp) matching the spec formula; streaming form (for the cpal callback) + buffer form (export) with a peak<=0.98 fast path. Accept perceptual tolerance.

> **Test gate:** Unit: peak<=0.98 unchanged, peak>1 limited to <=0.98; golden: impulse attack/release envelope within tolerance; property: output never exceeds ±0.98.

#### `P1-MED-05` — audio-mix-export (offline mixer + WAV)
Port the mixer: collect* filtering (track/element mute, source-audio-enabled, duration>0) over SceneTracks, createTimelineAudioBuffer with per-clip retime-aware linear-interp read + per-sample gain (static or resolveEffectiveAudioGain) additive into 2ch@44100, apply mastering, encode 16-bit WAV; precompute animated gain to avoid O(samples*keyframes); replicate int16 rounding exactly.

> **Test gate:** Golden: two overlapping clips different volumes match JS mixer within f32 eps; golden: WAV header+payload byte-compare; unit: empty/silent fallbacks; property: animated gain within keyframe bounds; perf: 10-min 8-clip render time + peak memory.

#### `P1-MED-07` — waveform
Port all bucketing math (peak-per-128-sample summary, RMS 20ms-window max, sample-bucket mapping with retime) over AudioBufferF32 from P1-MED-02; memoized DashMap cache keyed by sourceKey; share getSourceTimeAtClipTime with retime.

> **Test gate:** Golden: amplitudes vs reference at bucketSize=128; property: RMS transient not smeared; unit: resample into N buckets for retimed/non-retimed; perf: 10-min stereo summarize under budget, cache hit O(1).

#### `P1-MED-08` — thumbnails
thumbnailSize (pure), image decode+downscale (image + fast_image_resize) JPEG q0.8, video first-frame via the P1-MED-01 FrameSink -> RGBA -> resize -> JPEG; audio duration from the probe; hand out bytes/RGBA not object URLs.

> **Test gate:** Golden: thumbnailSize table (portrait/landscape/oversized); integration: image thumb dims + perceptual-hash match; integration: h264 first-frame non-empty JPEG of expected size.

#### `P1-MED-09` — media-import-pipeline
Port processMediaAssets as a MediaImporter: content-based type detection (infer, not MIME), probe (P1-MED-01) for video, thumbnails, audio duration, produce MediaAsset with a path/handle + structured ImportResult diagnostics (incl. HEVC cannot-preview) replacing toasts; quota via P1-PER-05.

> **Test gate:** Golden: type detection over image/video/audio/unknown fixtures; integration: video import fields (duration/wh/fps/hasAudio/thumbnail) vs readVideoFile table; unit: HEVC yields cannot-preview diagnostic + still imports metadata.

#### `P1-MED-10` — audio-playback-scheduling (cpal engine)
Replace the WebAudio graph+scheduler with a cpal output stream + off-thread control thread: port the 2s/500ms lookahead, streaming-vs-prepared heuristic, per-voice gain envelope sampled in the callback (replacing linearRampToValueAtTime), master gain + limiter, rtrb lock-free handoff; ALL decode/resample/stretch off the audio thread; audio device clock can master PlaybackManager. Engine lands here; A/V-sync validated in Phase 3.

> **Test gate:** Unit: clock mapping + seek source offsets; unit: lookahead activation set matches scheduleUpcomingClips; property: sampled envelope == buildAudioGainAutomation; perf: 8 voices @48kHz zero underruns over 60s (rtrb starvation counter); integration: rapid seeks bump session id, stale voices stop.

#### `P1-ASR-01` — transcription ASR runner
Replace the transformers.js worker with whisper-rs (whisper.cpp, Metal/CUDA/Vulkan; candle fallback) on a background thread; map the 4 model tiers to GGML ids, download via hf-hub with progress; feed the 16kHz mono f32 from P1-MED-05+P1-MED-02; segments -> TranscriptionSegment; caption chunking + insertion delegated to P1-TXT-03. UI trigger is Phase 3.

> **Test gate:** Integration: tiny model on a known-speech fixture WER below threshold + plausible timestamps; unit: cancel stops promptly + runner reusable; unit: the extract->decode_to_mono_f32(16000) feed produces the expected sample count/rate.

### Workstream: Text & fonts

#### `P1-TXT-01` — fonts (FontRegistry)
Replace CSS @font-face + document.fonts with a fontdb-backed FontRegistry: enumerate system fonts (font-kit), download+register Google families on demand (hf/reqwest + woff2 decode), disk-cache font files; drop the AVIF preview-atlas (picker-only). loadFontsForProject ensures referenced families are registered before layout/export.

> **Test gate:** Integration: system enum includes the SYSTEM_FONTS allowlist per OS (or documents substitutes); download+resolve Roboto 400/700 by FamilyKey; unit: merged+sorted font-name list matches web ordering; missing family falls back deterministically.

#### `P1-TXT-02` — text-layout-measure (metric parity)
Replace Canvas2D measure/draw with the P0-TXT-01 shaper: Buffer per line with Attrs + metrics + letterSpacing, reproduce lineMetrics/maxWidth/height/visualCenterOffset ((lines-1)*lineHeight/2) and FONT_SIZE_SCALE_REFERENCE scaling + 'middle' baseline; rasterize glyphs to RGBA/quads for the compositor; port background-rect, decoration, and stroke (swash outline). Regenerate ALL text goldens natively + per-font calibration.

> **Test gate:** Golden (native, small tolerance): line widths/maxWidth/height/visualCenterOffset across font/size/weight/style/letterSpacing/multiline; golden (0-tol pure): background/visual rect math; unit: decoration y+thickness ratios; golden: stroke SSIM; perf: 500-char block shape+measure under budget.

#### `P1-TXT-03` — subtitle formats + caption chunking
Completeness-critic split from transcription: pure SRT + ASS (514 LOC) parse/build, build-subtitle-text-element (348 LOC), insert-as-text-track, and buildCaptionChunks (N-words-per-caption, MIN_CAPTION_DURATION, monotonic non-overlapping). Consumed by P1-ASR-01 and the Phase 3 subtitles UI.

> **Test gate:** Golden (0-tol): buildCaptionChunks text + monotonic timings vs recorded segments; golden: SRT and ASS parse->build roundtrip against fixtures; unit: build-subtitle-text-element param shape.

### Workstream: Content (engine-side)

#### `P1-STK-01` — stickers source vendoring + resolver + intrinsic-size
Completeness-critic addition: vendor sticker SVGs locally (no Iconify CDN in desktop core), a sticker-id resolver + provider data (flags/logos/shapes/countries), and intrinsic-size capture at insert; rasterize via usvg+resvg. The library BROWSER UI is Phase 3 (P3-AST-02); this delivers the bytes P1-RND-05 resolve needs.

> **Test gate:** Golden: rasterize a known sticker SVG at 200x200 (0 tolerance); unit: resolver returns vendored bytes for provider ids; unit: intrinsic-size capture matches web.

### Workstream: Rendering pipeline (headless)

#### `P1-RND-01` — Scene-graph model + scene builder
Replace the class hierarchy with a RenderNode enum; build_scene walks SceneTracks bottom-to-top (overlays reversed, main last), filters hidden, (startTime,id) stable sort, background Color/Blur, transform/opacity/blend readers over params; move per-node caches into a resolver-owned keyed store. Lowest-risk port; unblocks descriptor goldens.

> **Test gate:** Unit: node order bottom-to-top main-last + sorted; unit: Color adds one node, transparent none, Blur adds BlurBackground; unit: hidden/absent-media skipped; golden: serialized RenderNode tree vs committed snapshot (zero GPU).

#### `P1-RND-02` — Preview geometry (hit-test/bounds/coords/snap)
Port dep/apps/web/src/preview pure math into core: point-in-rotated-rect, hit stack, visible-element bounds (contain-scale + text visualRect via P1-TXT-02), handle positions, screen/canvas/overlay transforms, snapScale/Axes/Rotation + snap lines; Rect replaces DOMRect; shared by resolve overlays and the Phase 3 interaction layer.

> **Test gate:** Property: inverse-rotation hit roundtrip; unit: hit stack == draw order + preferred-hit selected; property: coord roundtrip within eps; unit: 90° rotation snap; unit: bounds vs reference for asymmetric scale+rotation.

#### `P1-RND-03` — Frame-descriptor build + texture cache/bridge
The serde-wasm boundary EVAPORATES: build the existing frame.rs FrameDescriptor structs in-process from the resolved tree; a native TextureCache (external keyed by id+source-version replacing WeakMap, rendered keyed by stable content hash) driving compositor upsert/release; keep the (frame,tree) skip optimization. Can be exercised early with a stub resolved tree for the first-pixels milestone.

> **Test gate:** Golden: FrameDescriptor serialized form vs committed snapshot; unit: identical builds -> identical hashes + zero re-upload; unit: removed layer -> exactly one release; unit: external version bump -> one re-upload; unit: quad transform (flip/contain-scale) parity.

#### `P1-RND-04` — wgpu compositor integration + GPU init
A native GpuContext requesting Instance/Adapter/Device once (degraded = no adapter/software); preview = surface + render_frame, export = render_frame_to_texture + readback; gpuRenderer.applyEffect/applyMaskFeather map to the effects/masks crates against offscreen textures; reuse compositor/effects/masks/gpu verbatim.

> **Test gate:** Integration: headless adapter GpuContext + Compositor::new succeed (software allowed in CI); golden: single solid layer readback; golden: layer+feathered mask readback (tolerance); golden: blur effect-preview at 160px.

#### `P1-RND-05` — Render-tree resolve (per-frame sampling)
Port resolveNode as a match producing a parallel Resolved tree with half-open clip-null semantics; video frames from P1-MED-01 (last-good-frame while decode in flight — no UI-thread block), images via image crate cache, stickers via P1-STK-01, text via P1-TXT-02, graphics via P1-GFX-01, effect passes via P1-FX-01, blur backdrop; contain-scale + effectWidth/Height rounding must match TS.

> **Test gate:** Unit: clip window Some/None at boundaries; unit: contain-scale effectWidth/Height vs TS; property: keyframed blur sigma == intensityToSigma(sample); unit: retime sourceTime tick-exact; golden: sticker SVG raster.

#### `P1-RND-06` — Canvas2D -> native 2D rasterization
RasterSurface = tiny_skia::Pixmap; color/gradient (P1-GRAD-01), text (P1-TXT-02 glyph raster + rounded-rect bg + stroke), graphic (P1-GFX-01 kurbo), mask shapes (P1-MASK-01) through the quad transform, blur backdrop cover-draw; verify premultiplied-vs-straight alpha end-to-end and the RGBA/Bgra swizzle on upload.

> **Test gate:** Golden (0-tol): color fill; golden (small tol): gradients; golden (native): multi-line centered text w/ letterSpacing+strike+bg, text stroke; golden: graphic shapes, mask-shape under rotated/flipped quad; unit: measured block width/visualCenterOffset within epsilon.

#### `P1-RND-07` — Export pipeline + native muxing
Reuse the offscreen path: per frame i (i*ticksPerFrame) resolve+build+render_frame_to_texture at export res, readback RGBA, feed the P0-MED-01 encoder (ffmpeg-next libx264/vpx-vp9 + aac/opus, quality tiers -> explicit bitrates), audio from P1-MED-05, progress channel, cancel = kill + temp cleanup, CFR PTS, pix-fmt/swizzle correct; downloadBuffer -> save-file write.

> **Test gate:** Unit: frameCount/timeTicks for 24/30/29.97; integration: 1s mp4 (ffprobe track/duration/wh + first-frame color) and webm/vp9; integration: with mixed sine PCM (A/V durations align); unit: cancel leaves no partial/temp; property: progress non-decreasing ending at 1.0.

---
[← Phase 0](phase-0.md) · [Plan](plan.md) · [Tasks](task.md) · [Phase 2 →](phase-2.md)
