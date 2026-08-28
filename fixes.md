# fixes — sixteen defects: ten from an audit, six found while building on it

Every one of these is the same failure in a different place: **a control that does not do what
it says.** A tile that adds an effect nothing renders, a validator that accepts a channel
nothing reads, a schema that hides an effect the engine has, an import that succeeds and places
nothing — none of them fail. They all return success and produce no change, which is the only
kind of bug a person cannot find by looking at the screen.

Eight are fixed here. Eight are open, with what would verify each one, so nobody has to
re-discover them.

**State at time of writing:** every fix below is covered by a named test, and each entry says
which. `./test.sh` was last seen fully green mid-change; while several of these were being
written in parallel it stops at `cargo fmt --check` on files belonging to work still in flight,
so run it once the tree is quiet and do not take an entry's word for a green gate. A skip is
never a pass, and neither is a stale one.

Line numbers were read on 2026-08-27. Several of these files are under concurrent edit and the
numbers move; the surrounding names are what to search for.

---

## Fixed

### 1. A group accepted six animation channels it could not carry

`bay-agent`'s `animate` validated a group `animate` against `Element::ANIMATABLE` — all thirteen
transform properties — while `ElementGroup::sampled_transform`
(`rust/crates/bay-project/src/scene.rs:90`) read seven of them. An agent that keyed `cropLeft`
or `tiltY` on a group got a written channel, a successful tool result, a project file that
round-tripped it, and a frame that never moved.

Sampling the other six would not have helped, and that is the part worth recording:
`compose_group_transform` (`rust/crates/bay-project/src/scene.rs:240`) folds a group's transform
into each child's and carries exactly seven fields — x, y, scale, scaleX, scaleY, rotation,
opacity. Crop and tilt are dropped there too. Even a group whose *static* `crop_left` is 0.3
crops nothing.

**Chosen: narrow the validator, and refuse the six by name.** Not because sampling is hard, but
because there is no honest thing for it to mean. Cropping a group is one rectangle losing its
left edge, which needs the group rasterised to its own surface and cut — a pass the compositor
does not have. Applying the group's crop to each child instead is four elements each losing
their own left edge, a different picture that happens to be reachable. Implementing the wrong
one of those quietly is worse than refusing both loudly, and the refusal now says where the
channel does work: on the child element, where all thirteen are real.

- `rust/crates/bay-project/src/scene.rs:70` — `ElementGroup::ANIMATABLE`, the seven, with why
  the six are not there.
- `rust/crates/bay-agent/src/plan.rs:1496` — validates against it, and the message tells an
  agent to animate crop on the child instead of leaving it guessing.

Verified by:
- `bay-project` `every_group_animatable_channel_changes_the_sampled_transform` — each of the
  seven, sampled, moves the transform. Nothing is offered that does nothing.
- `bay-project` `the_channels_a_group_refuses_would_have_sampled_into_nowhere` — the six really
  are inert. If a later build teaches composition to carry crop or tilt, **this test fails**,
  and `ElementGroup::ANIMATABLE` is what has to grow.
- `bay-project` `group_crop_and_tilt_do_not_compose_onto_a_child` — the fact the decision rests
  on, tested at the composition function rather than inferred from it.
- `bay-agent` `a_group_takes_every_channel_that_composes_onto_its_children`,
  `a_group_refuses_the_channels_it_cannot_carry_by_name`,
  `the_channels_a_group_refuses_still_animate_on_an_element`.

### 2. `drop-shadow` was renderable, legal, and missing from `effect_add`'s schema

`SUPPORTED_EFFECTS` (`rust/crates/bay-agent/src/plan.rs:619`) listed six effects; `effect_add`'s
`type` enum in `bay-mcp/src/tools.rs` wrote out five. The two lists were maintained by hand next
to each other and drifted. An agent reading the tool definition could not discover `drop-shadow`
at all — the effect it most obviously wants for a card or a title — and a call naming it looked
like a schema violation going in while being perfectly legal going through.

Fixed by deriving the enum, so the drift cannot recur:

- `rust/crates/bay-agent/src/plan.rs:619` — `SUPPORTED_EFFECTS` is now `pub`. It is the one list.
- `rust/crates/bay-mcp/src/tools.rs:43` — `EFFECT_TYPES`, a `LazyLock` reading it (sorted, so a
  cached tool definition does not churn between builds), following `MOVE_IDS` at
  `tools.rs:25`.
- `rust/crates/bay-mcp/src/tools.rs:1321` — the schema uses it.
- `rust/crates/bay-mcp/src/tools.rs:1335` — and the `params` description now documents
  drop-shadow's six parameters, which no surface stated. Offering an effect whose parameters are
  undocumented is only half a fix.

Verified by, in `bay-mcp/tests/tool_vocabulary.rs`, both directions — read off the *published*
`definitions()` JSON, not off the const, so re-inlining a literal fails the test:
- `every_effect_the_engine_renders_is_offered_by_effect_add`
- `every_effect_effect_add_offers_is_one_the_engine_renders`

### 3. `lut` had no tile — a whole grading capability unreachable by clicking

The quieter half of the same rule. `EFFECT_BLOCKS` (`rust/crates/bay-core/src/blocks.rs:177`)
named five of the six shaders the compositor compiles. `lut` was implemented in the shader,
translated by `bay-preview`, validated by `check`, exposed over MCP — and had no tile, so it
could not be reached from the app at all. A tile naming a missing shader is a dead control and
is caught by a test; a shader with *no* tile is a missing control, and only a person reading
both lists side by side would ever find it.

- `rust/crates/bay-core/src/blocks.rs:209` — the `fx.lut` tile ("Look").
- `rust/crates/bay-core/src/blocks.rs:398` — its `plan` arm, seeded from `default_effect_params`.
- `rust/crates/bay-core/src/blocks.rs:606` — an explicit `lut` arm in `default_effect_params`.
  It seeds the same 1.0 the fallback did, but `amount` on a lut is *how much of the grade to
  apply*, not "no change" as it is for the colour adjustments; a grade arriving at 0 would be
  another silent control, and telling that from a subtle look by eye is exactly what nobody can
  do.

The tile attaches the built-in **Neutral Contrast** grade rather than opening a file picker,
because a `lut` effect with no `asset` behind it is dropped by the render path
(`bay-preview/src/lib.rs:48`) — a tile that added one would add a row to the inspector and change
no pixel, the exact failure this module exists to prevent. Built-ins are generated on the
machine, so it works on an install that has never downloaded anything, and a `.cube` can replace
it afterwards without removing the effect. Neutral Contrast because it is a finish rather than a
statement; a tile reached for before anyone has decided what the film looks like should not
decide that on their behalf.

Verified by:
- `bay-core` `every_effect_tile_names_a_shader_the_engine_implements` — the pre-existing test,
  still passing, now also asserting that a `lut` tile carries a grade the build can generate.
- `bay-core` `every_shader_the_engine_implements_has_a_tile` — new, and the converse. This is
  the test whose absence let `lut` go missing.
- `bay-mcp` `the_effect_palette_and_the_planner_name_the_same_shaders` — pins the palette equal
  to `SUPPORTED_EFFECTS` in both directions. It lives in `bay-mcp` because that is the only
  crate that can see both `bay-core` and `bay-agent`; `bay-core` cannot check this itself, which
  is why the two drifted.

### 4. Waveform extraction decoded synchronously inside `render()`

Owned by another agent in this change; recorded here for completeness. `ensure_waveforms` ran
ffmpeg decodes on the UI thread inside `render()`, so opening a project with audio froze the
window for as long as the decode took — the same defect as "decode never runs on the interactive
render path", on the audio side.

**In progress.** At the time of writing it has become `request_waveforms`
(`rust/crates/bay-ui/src/editor_view.rs:722`), dispatching to a worker, with the render tick
requesting an animation frame while `self.waveforms.has_pending()`
(`editor_view.rs:3901`) so finished peaks appear without waiting for an unrelated repaint. The
verification belongs to that agent, not to this document — do not read the code shape above as a
passing test.

---

### 11. Two test binaries shared one scratch directory, so concurrent runs failed each other

`registry::tests::Scratch::new` built its directory as `temp_dir()/bay-registry-{name}` and
opened by calling `remove_dir_all` on it. The name carries the test's name and nothing else, so a
second test binary running the same test — another checkout, or an agent building in a git
worktree alongside this one — resolved the same path and wiped the first run's registry between
its `register()` and its `live()`. The symptom was
`a_headless_server_is_never_the_window_to_focus` asserting one live instance and finding zero:
notes the test had written itself, gone.

The port beside it already had this exact fix, with the reasoning written down at
`registry.rs:369` — *"Derived from the pid, so two test binaries — or two checkouts building at
once — cannot pick the same one"*. The directory never got the same treatment, so the collision
moved from the port to the path and stopped being visible.

This is the rule in `CLAUDE.md` that names these tests by name: *a test that fails for reasons
outside the repository teaches people to re-run until green, which is how a real failure gets
ignored.* It failed once in a full-workspace run and then passed 73/73 five times in a row when
run alone — which is exactly the shape that gets filed as flake and re-run.

- `rust/crates/bay-agent/src/registry.rs:392` — the scratch directory is now per-process, for the
  same stated reason the port beside it is.

Measured by running two copies of the test binary concurrently and counting failed runs:

| | failed runs |
|---|---|
| before | 11 of 12 |
| after | 0 of 16 |

Found by running the suite under a worktree-parallel agent team, which is what put two test
binaries on the machine at once. Worth keeping in mind: this class of defect is invisible to a
single-threaded developer and routine under parallel agents.

### 12. ProRes mastering used the profile meant for camera footage

`ExportSettings` offers ProRes as the handoff format and `ExportPreset::Master` promises "no
generation loss". It asked `prores_ks` for **profile 3, ProRes 422 HQ**, at `yuv422p10le`
(`rust/crates/bay-preview/src/lib.rs`, `VideoCodec::encoder_args`).

422 is the ProRes profile for camera originals, and its 4:2:2 layout halves horizontal chroma
resolution. That is invisible on a photographed image, whose chroma is smooth. bay does not
produce photographed images — it renders type, rules and flat colour, where a coloured stem can
be one pixel wide and its chroma is the signal.

Measured by encoding a known frame and decoding it back, max error in code values per channel:

| content | 422 HQ (before) | 4444 (after) |
|---|---|---|
| one hard red/blue edge | 2 | 0 |
| 2px coloured strokes on white | 2 | 0 |
| **1px coloured strokes on white** | **61** | **0** |
| 1px red-on-blue, maximum chroma swing | 153 | 0 |

The cliff is sharp and it lands exactly where small text lives. Anything coarser than one pixel
survived either profile, which is why nothing caught it: a test using a big coloured rectangle
would have passed on both.

Fixed by asking for **profile 4, ProRes 4444**, at `yuv444p10le` — the profile ProRes has for
graphics and compositing handoff. It round-trips 8-bit RGB exactly. The cost is roughly 1.4x the
file size, on a format chosen for fidelity and already an order of magnitude larger than the
delivery codecs.

Verified when: `a_prores_master_returns_the_pixels_it_was_given`
(`bay-preview/tests/render.rs`) composites 1px coloured stripes, exports through the `Master`
preset, decodes the result and asserts **exact** equality — not a tolerance, because 4:4:4
10-bit round-trips 8-bit RGB losslessly, so any drift means the profile or pixel format moved.

**A note on the thing that led here, because it is worth not re-raising.** This was opened as
"bay ships a 10-bit ProRes container carrying 8-bit content", which sounds like a file telling a
lie about itself. On investigation it is not a defect:

- **ProRes has no 8-bit form.** `prores_ks` and `prores_aw` accept `yuv422p10le`,
  `yuv444p10le`, `yuva444p10le` and nothing else. There is no flag that would make the container
  match an 8-bit source, so "stop advertising 10-bit" is not an available move.
- **A codec's bit depth is not a provenance claim.** Transcoding 8-bit sources into ProRes is
  the ordinary post-production case, not an unusual one. The headroom is what stops the *encode*
  adding a second rounding on top of the one the source already carries; encoding 8-bit content
  into a hypothetical 8-bit ProRes would be worse, not more honest.

The real defect was next to it, in the profile rather than the depth. Recorded here so the
bit-depth question is answered once.

### 6. `export_video` ran the whole encode on the UI thread, and was the one ungated output path

`export_video` called `renderer.export_video(…)` straight through, on the main thread, inside
the event handler. The window froze for the length of the encode — no progress, no cancel. And
it was ungated, which was the more serious half. bay had two ways to produce a file:

| | `render` over MCP | the window's Export button |
|---|---|---|
| `render_gate` | yes, via `bay-agent/src/slow.rs` | **no** |
| `frame_check` | yes | **no** |
| resolution | the project's canvas | **capped at 1280px wide** |
| thread | a worker with its own GPU device | **the UI thread** |

Everything `render_gate` refuses — off-canvas elements, type below legibility, missing media,
black gaps, a silent export — was refused for an agent and shipped for a person clicking the
button, at a lower resolution than they asked for and with no note that it was reduced.

**Fixed by deleting the second path rather than gating it.** Both toolbar buttons are gone, and
the Deliver page starts renders by handing arguments to `bay_agent::slow::run("render", …)` on
`cx.background_executor()` — the identical call `app_view.rs` makes for an agent. That matters
more than it sounds: the gate is reached because *that function* reaches it, not because the
page remembered to. There is no second implementation left to drift.

The worker builds its own `PreviewRenderer`, which is what `slow.rs` already decided and says
why: *"a second adapter is what makes rendering concurrent with editing rather than instead of
it."* Borrowing the editor's would have darkened the preview for the length of the encode and
would still have been a third way to encode.

- `rust/crates/bay-ui/src/editor/deliver.rs` — the page, `queue_render`, and the cancel button.
- `rust/crates/bay-ui/src/editor/toolbar.rs` — where the two exports used to be; the header
  says what was there and why it is not.
- `rust/crates/bay-agent/src/deliver.rs` — the form as a headless value. `pages.md` rule 4: if
  a headless test cannot reach a behaviour it is in the wrong crate, and "does every control on
  this page reach the encoder?" must be answerable without a window.

Verified by, with real exit codes:

- `bay-ui` `deliver::tests::no_ui_call_site_encodes_for_itself` — walks every `.rs` in the
  crate and fails on any `export_video(` / `export_video_observed(` call site. **This is the
  test that stops the shape growing back**, which deleting the button alone would not. It
  asserts it scanned at least ten files first, so a scan broken by a layout change fails rather
  than passes; the needle is assembled from two halves so the test's own source is not a hit.
- `bay-mcp` `render_queue::a_render_the_frame_check_refuses_does_not_write_a_file` — the gate,
  on the path the page uses: a still-frame project comes back refused by name, names the
  override, and leaves no file. Its twin
  `the_override_is_a_real_escape_and_not_a_refusal_in_disguise` writes the file with
  `ignoreChecks` and stamps the reason into the result, so the first is measuring the gate
  rather than an unrelated failure to encode.
- `bay-mcp` `render_queue::a_render_answers_with_a_job_before_it_has_encoded_anything` —
  dispatch returns in under two seconds with a job id already in the queue. This is the
  property a progress bar needs and the old button structurally could not have.
- `bay-mcp` `render_queue::a_render_reports_frames_while_it_encodes_and_a_path_when_it_is_done`
  — asserts the result is the project's own 320×180, which is the 1280 cap being gone rather
  than merely believed gone.
- `bay-mcp` `render_queue::a_queued_render_can_be_cancelled_while_it_runs`.

Found while fixing it, and worth keeping: the first version of the progress test **failed**
with `render refused by frame checks (frozen, anchor-scale, bottom-dead)`. The same project
through the old button wrote the file and said nothing. That is this entry, observed.

### 16. There was no out point, so a range could not be rendered at all

Found while building the Deliver page's range control, and it had to be fixed before the
control could exist.

`render_duration` (`rust/crates/bay-agent/src/slow.rs`) refused any explicit `duration` that
ended before the populated timeline:

> render refused: duration 61.00s ends at 61.00s, but the populated timeline continues to
> 155.00s (94.00s would be omitted).

Correct, and for the caller it was written for. `duration` is a convenience — "encode this much
from the in point" — and an agent passing one that stops short has almost always forgotten the
tail, which is a defect that produces a plausible file nobody inspects.

But `duration` was the *only* way to say how much to render, so the guard also meant bay had no
out point. Exporting the first thirty seconds of a two-minute film required deleting ninety
seconds of it. A range control drawn on top of that would have been a control the engine
refuses — the same class as everything else in this file, arriving from the opposite direction.

**Fixed by separating the two meanings rather than weakening the guard.** `duration` and
`endSeconds` compute the same number and mean opposite things, so they are two arguments with a
`Requested` enum between them: `Duration` keeps the check, `Until` is an out point and the tail
it leaves out is the point. Passing both is refused rather than guessed — picking one silently
is how a render comes back the wrong length with nothing on screen to explain it. The
`duration` refusal now names `endSeconds`, so the way out is discoverable from the error.

- `rust/crates/bay-agent/src/slow.rs` — `Requested`, `requested_range`, `render_duration`.
- `rust/crates/bay-mcp/src/tools.rs` — the `render` schema, so an agent can find it too.

Verified by:
- `bay-agent` `an_out_point_renders_a_section_the_duration_guard_would_refuse` — the same 61
  seconds, refused as a duration and allowed as an out point.
- `bay-agent` `an_explicit_duration_cannot_silently_cut_off_the_timeline` — the pre-existing
  guard, still refusing, and now asserted to name the escape.
- `bay-agent` `duration_and_an_out_point_together_are_refused_rather_than_guessed`,
  `an_out_point_before_the_in_point_is_refused_by_name`,
  `an_out_point_never_runs_past_the_end_of_the_timeline`,
  `no_range_argument_still_means_the_rest_of_the_timeline`.
- `bay-mcp` `render_queue::an_out_point_is_accepted_where_a_short_duration_is_refused` — both
  halves over the dispatcher, which is where the two callers actually meet.


## Open

### 15. The streaming audio engine is wired to nothing

M9 built a callback-driven block mixer on a lock-free ring, with frame-exact clip windows, peak
and K-weighted RMS metering, pan on clips and tracks, track gain and solo, and six undoable
commands. All of it is tested. **None of it is called.** `StreamEngine`, `BlockMixer` and
`LevelMeter` appear only in `bay-audio`'s own tests and `bay-core/tests/mixer.rs`.

The live playback path is still the one M9 was built to replace: `editor/transport.rs::start_audio`
mixes the whole remaining timeline through `bay_audio::mix_stereo` into a single
`rodio::SamplesBuffer` and appends it to a sink. So a fader moved during playback is **not
audible** — the mix already happened — and there is no running `LevelMeter` for a meter to read.

This is the register's usual shape with the stakes raised: not a control that lies, but an entire
milestone whose justification was "a fader you can hear move" and which cannot currently be heard.
The commit that landed it says exactly that in its title. Every test M9 wrote passes; none of them
exercises the path a user takes.

Worth stating as a general lesson, because it is cheap to repeat: a milestone verified only by its
own unit tests can be complete and unreachable at the same time. The question that catches it is
not "do the tests pass" but "what calls this".

Found by the agent building the Audio page, on reading the engine it was told to bind to.

Verified when: moving a fader during playback changes what is heard, and a meter reads from a
running `LevelMeter` rather than a placeholder.

### 14. The inspector's add-effect row is a hand-written list, and it is now 5 of 7

`bay-ui/src/editor/inspector.rs:733` declares `[(&str, &str, &str); 5]` — brightness, contrast,
saturation, blur, drop-shadow. It has never offered `lut`, and it does not offer
`lift-gamma-gain`. Both of those *work*: the shader compiles, the palette tile plans them, the
MCP tool exposes them, `check` validates their assets.

The comment directly above that array already makes the right argument for the *seed* — that
`default_effect_params` belongs in `bay-core` because "when this view owned its own copy the same
effect arrived with different parameters depending on whether a person clicked a button or an
agent called a tool". The same reasoning applies to the *list* and was not carried through, which
is why it drifted the moment an effect was added.

This is the inverse of the usual entry here: not a control that lies, but a capability with no
control. Nothing is enforcing the pairing, so it will drift again on the next effect.

Fix: derive the row from `Panel::Effects.blocks()` and lower each button through
`bay_core::blocks::plan()` — the path the palette already takes. Then a button and a tile produce
*identical* commands by construction, which is the property
`every_effect_tile_names_a_shader_the_engine_implements` already guards, and adding an effect
surfaces it in both places at once. `SUPPORTED_EFFECTS` → `EFFECT_TYPES` was the same fix applied
to the MCP schema in entry 2.

Verified when: adding an effect to `blocks.rs` makes it appear in the inspector with no second
edit, and a test asserts the inspector's set equals the palette's.

### 13. The narration tests hardcode two ports, so a second test binary fails them

`Studio::for_test(library_root, speech_port)` exists precisely to keep the narration tests off a
shared machine resource. Its own doc comment says so: *"`CLAUDE.md` requires that a test never
depend on a shared machine resource. Driving the narration tests through the real port made them
fail whenever anything else on the machine — another test binary, a `bay --mcp` someone left
running — held it, which is precisely how a real failure gets dismissed as flake."*

The two callers then pass **literals**:

- `rust/crates/bay-mcp/src/server.rs:2104` — `Studio::for_test(test_library_root(), 7451)`
- `rust/crates/bay-mcp/src/server.rs:2164` — `Studio::for_test(test_library_root(), 7452)`

So the fix moved off the product's fixed port 7334 and onto two different fixed ports. Any second
test binary — another checkout, an agent building in a worktree, a concurrent `cargo test` — takes
the same two. The property that caused the original bug survived the fix that was meant to remove
it, which is the same thing that happened to the registry scratch directory in entry 11: one axis
was made per-process and the other was left global.

Measured, on a quiet machine with 91 GiB free and load ~2:

| how the tests were run | result |
|---|---|
| `a_real_narration…` alone | ok, 39.02 s |
| the whole `narration_tests` module, 12 tests | ok, 14.72 s |
| the full `bay-mcp --lib` binary, 61 tests | **FAILED, 300.78 s** |

The failure is `could not reach the sidecar: Resource temporarily unavailable`. That string is
**EAGAIN, errno 35** — and it is worth writing down what it is *not*, because it cost most of a
day. It is not ENOSPC (errno 28), so it is not a full disk. It is not a spawn failure, because
`TcpStream::connect_timeout` is a separate 3-second call that succeeded — something was listening.
It is what `read` returns when the `SO_RCVTIMEO` set by `set_read_timeout`
(`bay-speech/src/engine.rs:556`) expires, and `/speak` is called with `SPEAK_TIMEOUT = 300 s`
(`:39`, used at `:469`). The 300.78 s in the table is that one timeout elapsing once, not retries.

Would be fixed by binding an OS-assigned port — `TcpListener::bind((Ipv4Addr::LOCALHOST, 0))`,
read the port, drop the listener — which is what `bay-agent`'s registry tests already do for the
same reason. Verified when the full `bay-mcp --lib` binary passes while a second copy of it runs
concurrently; a test that only passes when run alone is the thing being fixed.

Worth noting for whoever picks this up: this is the third shared-resource test defect found in one
session, after the registry scratch directory and this. All three were invisible to a single
developer working alone and routine under parallel agents. The class is worth a sweep rather than
three more individual fixes.


### 5. Importing audio into a project with no audio lane succeeds and places nothing

**The UI half is fixed** (2026-08-28). `place_media_at` no longer names a lane in a literal: the
match arms construct the element only, and `resolve_lane` asks the scene — `tracks.main.id` for
picture, the first audio lane for sound, creating one when the scene has none. Two tests hold it:
`audio_lands_in_a_scene_that_has_no_audio_lane` clears the audio lanes and asserts a clip is
placed; `video_lands_on_a_scene_whose_main_lane_is_not_named_track_main` renames the main lane and
asserts the same. `drop_onto_new_track` picks its lane from the media kind for the same reason —
audio dropped below the lanes used to create an *overlay* called "Overlay 1".

**The engine half is still open**, and it is the half the entry was really about: lowering
`AddElement` against a track that does not exist is still `scene.tracks.track(track_id)?`, so it
is still no patch, no undo entry, no error and no status line. The view now avoids asking a bad
question; nothing yet stops anyone else asking one, and an MCP client placing media has exactly
the problem described below. Fixing that means either a fallible lowering or a
create-lane-if-missing placement command in `bay-core`.

The original entry follows.


`place_media` (`rust/crates/bay-ui/src/editor_view.rs:1235`) chooses a lane by media kind and
names it with a **string literal**: `"track-audio"` for audio, `"track-main"` for video and
images. It then executes `Command::AddElement` and ignores the result. Lowering that command is
`scene.tracks.track(track_id)?` (`rust/crates/bay-core/src/command.rs:880`) — a `?` on an
`Option`, so a track that does not exist produces `None`: no patch, no undo entry, no error, no
status line. The file imports, the media panel lists it, the timeline does not change, and
nothing anywhere says why.

Two bugs share the literal:

- **No audio lane.** `Scene::empty` (`bay-core`) creates one video track and no audio lane, so
  any project that has not yet grown one swallows every audio import.
- **Any scene after the first.** `Scene::empty` names its main track `{scene_id}-main`. Only the
  starter scene's track is literally `track-main`. On scene two, video and image placement miss
  as silently as audio does.

Would be fixed by resolving the lane from `scene.tracks` — the audio lane if there is one, else
creating one in the same transaction as the element, the way `add_shape` already creates the
overlay lanes it needs (`bay-agent/src/plan.rs`, tested by
`a_high_layer_creates_the_lanes_it_needs_in_one_transaction`). The resolution belongs in
`bay-core`, not in the view: an MCP client placing media has exactly the same problem.

Verified when: importing audio into a scene with no audio lane places a clip (or reports why it
cannot); placing any media on a non-starter scene lands on that scene's own main track; and
`Command::AddElement` against a track that does not exist is a visible failure rather than a
`None`. A test naming a track id that is not `track-main` is the one that would have caught this.

### 7. `SceneEffect` is fully implemented and constructed nowhere

`FrameItemDescriptor::SceneEffect` (`rust/crates/bay-compositor/src/frame.rs:26`) is handled by
the compositor in **both** render paths — offscreen at `compositor.rs:333` and onscreen at
`compositor.rs:389`. Nothing in the workspace ever builds one. Grep finds three hits: the
definition and the two arms that consume it.

This is not dead code in the ordinary sense. It is a working adjustment-layer / master-grade
capability — effect passes applied to the composited scene rather than to one clip — with no
model field, no tool, and no tile to reach it. A colour grade over the whole film is currently
done by attaching the same effect to every clip, which drifts the moment a clip is added.

Would be fixed by a scene-level `effects` list in `bay-project` (kebab-case wire format,
`#[serde(default)]` so older projects load), lowered into a `SceneEffect` item after the last
element, plus the tool and the tile. The engine half is already written and already tested by
the compositor's own paths — this is model and surface work, not render work.

Verified when: a project with a scene-level grade renders differently from the same project
without one, at the GPU; the field round-trips through serde by name; and `check` treats a
scene-level `lut` with a missing `.cube` the way it treats a clip-level one.

### 8. Three geometry helpers are written, tested, and called by nothing

`rust/crates/bay-ui/src/geometry.rs`:

- `fit_rect` (line 440) — letterbox a canvas into a viewport with zoom and pan.
- `track_y_offsets` (line 471) — cumulative lane tops.
- `track_at_y` (line 483) — which lane a y coordinate is in.

All three are `pub`, all three have thorough tests (`geometry.rs:1022`–`1090`, including a
zero-sized viewport and a NaN aspect), and none has a caller outside its own tests. The tests
make them look maintained, which is the reason to write this down rather than to assume someone
knows.

Two honest resolutions, and the choice is a product one:

- **Delete them.** Nothing is worse off, and the tests stop asserting things nobody depends on.
- **Use them.** `fit_rect` is what a preview pane with zoom and pan needs, and
  `track_y_offsets`/`track_at_y` are what timeline hit-testing needs — both are on the roadmap
  (M2, M4). If they are being kept for that, they should say so in a doc comment naming the
  milestone, so the next reader does not spend the same half hour.

Deferred deliberately rather than guessed at: deleting a helper the six-page editor is about to
need is not a cleanup.

### 9. `GPU_TEXTURE_FORMAT` is a public constant nothing reads

`rust/crates/bay-gpu/src/lib.rs:8`:

```rust
pub const GPU_TEXTURE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Bgra8Unorm;
```

Grep the workspace: the definition is the only hit. The format that actually governs every
render target is chosen at runtime in `GpuContext::new` (`bay-gpu/src/context.rs:172-176`,
`Rgba8Unorm` on GL, `Bgra8Unorm` everywhere else) and read back through
`GpuContext::texture_format()` (`:441`).

This is a trap rather than mere dead code, and it is aimed at one specific future reader: the
next person to widen the intermediate format. The constant is public, is named as though it were
authoritative, and sits in `lib.rs` where a newcomer looks first. Changing it compiles, changes
nothing, and looks done.

Would be fixed by deleting it. If a name for "the format bay renders into" is wanted, it has to
be the runtime accessor, because the GL fallback means there is no single compile-time answer.

Verified when: `rg GPU_TEXTURE_FORMAT` returns nothing, and `./test.sh` is clean.

### 10. The JFA mask shaders pack coordinates into colour, and take their format from the global accessor

`rust/crates/bay-masks/src/shaders/jfa_init.wgsl` encodes integer seed coordinates as colour
channels:

```wgsl
return vec4f(x_hi / 255.0, x_lo / 255.0, y_hi / 255.0, y_lo / 255.0);
```

and `jfa_distance.wgsl` decodes them by undoing exactly that:

```wgsl
let x = floor(encoded.r * 255.0 + 0.5) * 256.0 + floor(encoded.g * 255.0 + 0.5);
```

with `is_no_seed` sentinelling on `> 0.99` in all four channels. The scheme is correct and
tested. The problem is that it is a hard dependency on an **8-bit unorm** render target, and the
pipelines it runs on take their format from the same global accessor as everything else —
`bay-masks/src/sdf.rs:101` and `:109` both pass `context.texture_format()`.

Not a bug today. It is a landmine on the widening path: a future move to `Rgba16Float` (see
[`docs/native/intermediate-format.md`](docs/native/intermediate-format.md)) would carry these
shaders along silently. They would still compile, still run, and still produce a plausible
alpha ramp — with mask distances quietly wrong at the edges, which is the hardest class of
error to notice, because a feathered mask has no crisp reference to disagree with.

Would be fixed by pinning the JFA textures to an explicitly 8-bit format independent of
`texture_format()`, or by re-encoding seeds as real floats and dropping the packing. The first
is smaller; the second is what the data actually wants.

Verified when: the JFA pipelines name their own format rather than inheriting one, and a test
rasterizes a known mask, feathers it, and asserts the alpha ramp — so that a format change to
the *rest* of the compositor cannot move the result at all.
