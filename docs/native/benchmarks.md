# bay — benchmarks

Criterion benchmark suite for the pure-CPU parts of the editor, per
[`palmier-parity-plan.md` §6.6](palmier-parity-plan.md). Three crates carry benches today:

| Crate | Bench file | What it measures |
|---|---|---|
| `bay-audio` | `benches/mix_stereo.rs` | `mix_stereo` throughput — seconds of audio mixed per second of CPU |
| `bay-core` | `benches/commands.rs` | command dispatch + undo/redo on an N-element project |
| `bay-project` | `benches/project_serde.rs` | project JSON serialize / deserialize / round-trip at N elements |

A fourth measurement lives outside criterion: **[the scopes' frame budget](#scopes--the-color-pages-four-reductions)**,
reported by a test rather than a bench because it is a single pass whose cost had to be known
before the Color page could be designed around it, not a curve to be tracked over time.

Everything here is **pure CPU**: no GPU, no ffmpeg, no file IO, no clock, no RNG. Every fixture is
a deterministic synthetic project built in-process, so two runs on the same machine differ only by
machine noise. Wall-clock pipeline numbers (preview frame time, decode, export, cold start) are
*not* criterion's job — those belong to the **`bay-bench` binary, which now exists**; see
"The pipeline, on a clock" below.

---

## Running them

```sh
cargo bench -p bay-audio
cargo bench -p bay-core
cargo bench -p bay-project
```

A fast smoke run (useful when you only want to know the bench still executes):

```sh
cargo bench -p bay-audio -- --warm-up-time 1 --measurement-time 2
```

Filter to one case with a substring:

```sh
cargo bench -p bay-core -- move_element/1000
```

**Benchmarks never run in CI** (plan §6.1). They are a cadence tool: run them at a milestone
boundary, and run them when you touch mixing, the command/patch path, or the project schema.

### Comparing against a previous run

Criterion's own baseline machinery is the regression machinery — do not build another one:

```sh
# before your change
cargo bench -p bay-core -- --save-baseline before
# after your change
cargo bench -p bay-core -- --baseline before
```

Criterion then prints a signed percentage change and a p-value per case. Results live in
`target/criterion/`, which is not committed — a baseline is local to your machine and your
working tree, which is the point (see "what a regression means" below).

---

## What each benchmark measures

### `bay-audio` — `mix_stereo`

`mix_stereo` sums N clips into one interleaved stereo buffer and soft-clamps the result. It is the
whole of the audio mix path today: preview mixing and export mixing both go through it.

- **Parameters.** Clip count ∈ {1, 4, 16} × output length ∈ {1 s, 10 s}, at 48 kHz.
- **Shape.** Every clip spans the entire output. Full overlap is the worst case and the only one
  where the per-clip cost is actually visible; a sparse timeline is strictly cheaper.
- **Fixture.** Four distinct sources, generated from a 32-bit LCG folded into ±0.25. Integer
  maths only — no `sin`, whose last bits are libm-dependent — so the input buffer is bit-identical
  on every machine. Sources are 2 s longer than the output so no clip runs off its end mid-loop
  (an early `break` would silently shorten the work being timed).
- **Criterion reports** output frames per second (`Melem/s`). The table below converts that into
  the number the audio path cares about: **seconds of audio mixed per second of CPU**, i.e.
  `output_seconds / mean_time`.

### `bay-core` — `commands`

`Command::lower` resolves an `ElementRef` by scanning the track, and `ProjectPatch::apply` scans it
again, so every command is O(elements-in-track). Sweeping N is the whole point: a timeline drag
dispatches one `MoveElement` per mouse-move, so the slope of this curve is what decides whether a
1000-clip project still drags at 60 fps.

- **Parameters.** N ∈ {100, 1000} elements; operations `MoveElement`, `AddElement`, and `undo` /
  `redo` of each.
- **Shape.** One timed iteration = a batch of **64 operations** against a freshly built `Editor`,
  where the editor (and, for `undo`/`redo`, the pre-executed history) is constructed in criterion's
  *untimed* setup via `iter_batched`. Batching earns its keep twice: it amortises the project clone
  setup needs, and it pins the undo/redo stacks at a fixed depth instead of letting them grow
  without bound across a measurement run. **Divide criterion's reported time by 64 for the
  per-operation cost** — the tables below already do.
- `MoveElement` targets stride through the element list (`(k * 7) % len`) so the measurement is an
  average scan rather than a permanently cache-hot first element.
- The timed routine consumes pre-built owned `Command`s, so `Command`'s own clone cost stays out of
  the number. Every op asserts it was not a no-op — a fixture that silently stopped matching
  anything would otherwise benchmark the failure path.

### `bay-project` — `project_serde`

The cost of every open, every save, and every autosave. This is the number that decides whether
autosave can run on the UI thread.

- **Parameters.** N ∈ {100, 500, 1000} elements, `serialize` / `deserialize` / `roundtrip`.
- **Throughput** is keyed to the serialized document size (printed as a `fixture:` line at the
  start of each N), so `roundtrip` reads as *bytes of document per second*, not bytes moved.
- A `assert_roundtrip_is_lossless` check runs before any timing: the decoded project must compare
  equal to the original and must still carry its animation channels and audio elements. A
  benchmark that times a lossy shortcut is worse than no benchmark.

### The synthetic project (shared design, duplicated per crate)

`bay-core` and `bay-project` each build their fixture the same way, and deliberately
**never use an `Element` struct literal**. Elements are cloned from `Project::starter()`'s
text / image / audio elements and then mutated through the public setters (`set_id`, `set_name`,
`set_start`, `set_duration`, `animations_mut`). That keeps the fixture describing the *current*
element shape when a field is added to `Element` — as `blend_mode` recently was — instead of going
stale behind a literal somebody has to remember to update.

Elements round-robin across the main, overlay, and audio lanes with per-lane cursors, so every lane
is butt-joined and non-overlapping, which is the shape a real timeline has. Durations cycle through
four values so starts are not a single arithmetic run. In the `bay-project` fixture every third
visual element carries a three-key `opacity` channel, so the JSON is not a trivially compressible
run of identical records.

**Known gap:** the fixture contains no `Video` elements and no `Effect`s, because
`Project::starter()` has neither to clone from and constructing them needs a struct literal. Add
them when a literal-free constructor exists (`Element::video(..)` / an effect registry), and
recapture the baselines in that same commit.

---

## Baseline numbers

**Machine:** Apple M5 Pro (15 cores) · macOS 26.5.2 · rustc 1.97.0 · criterion 0.5.1 ·
release/`bench` profile. **Captured:** 2026-08-04, on the `phase-0/native-gpu-foundation` line at
`e43154a` (plus the parity work in flight in the tree at the time — nothing in these three code
paths had changed).

Every number below was measured on this machine by running the command in the header. Times are
criterion's point estimate (the middle of the `[lower estimate upper]` triple).

### `cargo bench -p bay-audio`

| Clips | Output | Time | Output frames/s | **s-audio / CPU-s** | Clip-seconds / CPU-s |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 s | 51.03 µs | 941 M | **19 600×** | 19 600 |
| 4 | 1 s | 175.2 µs | 274 M | **5 710×** | 22 800 |
| 16 | 1 s | 677.6 µs | 70.8 M | **1 480×** | 23 600 |
| 1 | 10 s | 505.4 µs | 950 M | **19 800×** | 19 800 |
| 4 | 10 s | 1.727 ms | 278 M | **5 790×** | 23 200 |
| 16 | 10 s | 6.702 ms | 71.6 M | **1 490×** | 23 900 |

Reading it: the marginal cost per clip is flat at ~**23 000 clip-seconds mixed per CPU-second**,
i.e. ~43 **µs** of CPU per clip-second mixed, independent of clip count and output
length. (An earlier revision said "43 ns" — that was off by 1000x; 1/23 000 s is 43 µs.) The single-clip cases
sit lower (19 600) because the final clamp pass over the output buffer is paid once regardless of
clip count, and with one clip that fixed pass is a large share of the work.

*Extrapolated, not measured:* a 512-frame block at 48 kHz is 10.67 ms of audio, so 16 clips of it
is ≈ 7 µs of mixing — roughly 1.4 % of the plan's 0.5 ms real-time block budget. Treat that as a
sanity check only; the streaming `graph.fill()` path that budget actually governs does not exist
yet, and it will pay costs `mix_stereo` does not (per-block envelope, resampling, no whole-buffer
allocation).

### `cargo bench -p bay-core`

Reported time is for a batch of 64 operations; the per-op column is that divided by 64.

| Operation | N | Batch time (64 ops) | **Per operation** |
|---|---:|---:|---:|
| `MoveElement` | 100 | 12.94 µs | **202 ns** |
| `MoveElement` | 1000 | 26.40 µs | **413 ns** |
| `AddElement` | 100 | 13.84 µs | **216 ns** |
| `AddElement` | 1000 | 16.19 µs | **253 ns** |
| `undo` (MoveElement) | 100 | 7.59 µs | **119 ns** |
| `undo` (MoveElement) | 1000 | 14.14 µs | **221 ns** |
| `undo` (AddElement) | 100 | 12.10 µs | **189 ns** |
| `undo` (AddElement) | 1000 | 20.98 µs | **328 ns** |
| `redo` (MoveElement) | 100 | 7.56 µs | **118 ns** |
| `redo` (MoveElement) | 1000 | 13.98 µs | **218 ns** |
| `redo` (AddElement) | 100 | 7.49 µs | **117 ns** |
| `redo` (AddElement) | 1000 | 7.59 µs | **119 ns** |

Reading it:

> **Corrected 2026-08-04.** The first version of these execute rows was inflated by up to 2.9×.
> The bench used criterion's `iter_batched`, which *moves* the input into the routine, so dropping
> the `Editor` (a cloned `Project` plus 64 patches of undo history) was timed as part of the
> operation — 24–68% of each reported figure. The undo/redo rows used `iter_batched_ref` and were
> never affected. The bench now uses `iter_batched_ref` throughout and the table above is the
> re-measured result. Any narrative built on the old numbers has been removed rather than restated.

- **Execute costs more than undo/redo, but modestly** — `MoveElement` execute is ~1.7× its own undo
  at N=100 and ~1.9× at N=1000. That is `Command::lower` resolving refs on top of the resolution
  `ProjectPatch::apply` already does; undo replays an already-lowered patch. `AddElement` execute
  is actually *cheaper* than its undo at N=1000 (253 ns vs 328 ns): appending is O(1) at the end of
  a track while undo scans for the element to remove.
- **`redo` of `AddElement` is flat in N** (117 ns at both sizes) while its `undo` grows: redo
  re-inserts at a known index at the end of the track, undo has to scan for the element to remove.
- Against the plan's absolute budget — *undo/redo of a 500-element transaction < 5 ms* — a 500-op
  undo at N=1000 extrapolates to ~111 µs, about 45× inside budget. There is no batched-transaction
  API yet (T-101), so this is per-command undo repeated, not one transaction.
- A drag at 60 fps has 16.6 ms per frame and dispatches one `MoveElement`; at 413 ns for a
  1000-element project, dispatch is ~0.005 % of the frame. Command dispatch is not, and is not
  close to being, the timeline's bottleneck.

### `cargo bench -p bay-project`

Fixture sizes: **100 elements = 25 683 B · 500 = 126 874 B · 1000 = 253 415 B** of JSON
(≈ 253 bytes/element).

| Direction | N | Time | Throughput |
|---|---:|---:|---:|
| serialize | 100 | 22.50 µs | 1.06 GiB/s |
| serialize | 500 | 110.5 µs | 1.07 GiB/s |
| serialize | 1000 | 216.7 µs | 1.09 GiB/s |
| deserialize | 100 | 65.68 µs | 373 MiB/s |
| deserialize | 500 | 323.7 µs | 374 MiB/s |
| deserialize | 1000 | 642.7 µs | 376 MiB/s |
| round-trip | 100 | 90.17 µs | 272 MiB/s |
| round-trip | 500 | 435.0 µs | 278 MiB/s |
| round-trip | 1000 | 859.4 µs | 281 MiB/s |

Reading it: both directions are **linear in element count** (1000 elements is 9.6× the 100-element
time for serialize, 9.8× for deserialize) — no accidental quadratic in the schema. Deserialize is
**~3× the cost of serialize**, which is normal for `serde_json` (parse + allocate every `String`
and `BTreeMap` vs. writing bytes out).

A 1000-element save is 217 µs. Autosave on the UI thread is affordable today at this size, and the
plan's `bay-bench` target of *project open / save (500 clips) ≈ 84 ms / 61 ms* is dominated by file
IO and whatever wrapping the save path adds, not by serde: serde's share of a 500-element save is
0.11 ms.

---

## Scopes — the Color page's four reductions

`bay-preview/src/scopes.rs` computes a luma waveform, an RGB parade, a vectorscope and a
histogram in one pass over the BGRA buffer the preview already reads back. M7 shipped it with a
budget that was an assumption — "a ≤480px buffer at interactive rates is fine" — and the Color
page's whole layout depends on whether that is true. This is the measurement.

**Not criterion.** This is one function called once per user action, not a curve to be tracked
across commits, and `bay-preview` carries no bench harness. It follows the pattern in
`bay-ui/src/draw.rs`: a test that prints under `--nocapture` and asserts only a ceiling an order
of magnitude above the figure. A tight timing assertion fails on a loaded machine for reasons that
have nothing to do with the code, and a test that fails for outside reasons teaches people to
re-run until it passes.

```sh
# the full matrix — release only; a debug build runs this reduction ~30x slower
cargo test --release -p bay-preview --test scopes -- --nocapture scope_cost_is_reported

# more repetitions when the machine cannot be made quiet
BAY_SCOPE_RUNS=25 cargo test --release -p bay-preview --test scopes -- --nocapture scope_cost
```

Each row is the **fastest of N runs**, not the mean: the fastest run is the least interrupted and
therefore the closest thing to the idle number, and the printed median next to it says how loaded
the box was. Fixture is a gradient, not a flat fill — a flat frame touches one histogram bin
repeatedly and measures a cache a real frame does not get.

### The numbers

**Machine:** Apple M5 Pro (15 cores) · macOS 26.5.2 · rustc 1.97.0 · release profile · single
thread. **Captured:** 2026-08-27 on `feat/six-page-editor`, best of 25.

**Conditions, stated because they matter here.** Four independent best-of-25 runs, taken between
1-minute load averages of 2.2 and 3.4 on 15 cores — including one with nothing compiling on the
machine at all. They agree within 2% on every total: 640×360 read 0.95 / 0.97 / 0.98 / 0.98,
854×480 read 1.71 / 1.72 / 1.72 / 1.74, 1080p 8.71 / 8.79 / 8.79 / 8.80. The 4K total ranged
34.9–37.6, the one figure with real spread, for the reason in the next paragraph. Within each run
best and median sit within 2–5% on nearly every row, which is the evidence that the fastest run
was not preempted.

Runs taken while a dozen `rustc` processes were compiling read **25–35% slower at 4K and barely
differently at 640×360** — the signature of memory-bandwidth contention on a 33 MB buffer, since
the small frame fits in cache and the large one does not. Worth knowing before someone
re-measures on a busy machine and concludes something regressed. It is also the reason
`BAY_SCOPE_RUNS` exists.

| | 640×360 *(bay's preview)* | 854×480 | 1920×1080 | 3840×2160 |
|---|---:|---:|---:|---:|
| pixels | 230 400 | 409 920 | 2 073 600 | 8 294 400 |
| frame walk + stats only | 0.28 | 0.49 | 2.48 | 10.01 |
| waveform alone | 0.39 | 0.67 | 3.40 | 13.68 |
| parade alone | 0.47 | 0.81 | 4.00 | 15.94 |
| vectorscope alone | 0.73 | 1.28 | 6.39 | 24.92 |
| histogram alone | 0.48 | 0.81 | 4.17 | 16.99 |
| all but waveform | 0.88 | 1.57 | 8.15 | 32.76 |
| all but parade | 0.80 | 1.43 | 7.48 | 30.02 |
| all but vectorscope | 0.76 | 1.30 | 6.55 | 26.72 |
| all but histogram | 0.84 | 1.46 | 7.40 | 30.06 |
| **all four** | **0.98** | **1.74** | **8.80** | **35.33** |
| all four, `stride: 2` | 0.26 | 0.48 | 2.17 | 8.71 |
| all four, `stride: 4` | 0.08 | 0.13 | 0.58 | 2.16 |

Milliseconds. "Alone" is that scope plus the frame walk every scope pays; "all but" is the other
three, which is what turning one off actually buys.

**Cost is 4.25 ns per sampled pixel**, within 1% across every size and every stride in the table.
Any case not listed reads off that: multiply sampled pixels by 4.25 ns. The frame walk itself —
the buffer read, the luma, and the exposure/clipping statistics that are always computed — is
1.21 ns of that, which is why the scopes are cheaper together than apart.

### Reading it

- **Four live scopes fit a frame.** At the size bay's preview actually composites — a fixed
  640×360 (`PREVIEW_RENDER_W/H`) — all four cost **0.98 ms**, six percent of a 16.6 ms frame, and
  roughly half of the 1.85 ms that the blocking composite-and-readback they measure costs. The
  Color page does not need to sample, alternate, or throttle them.
- **Turning scopes off is a weak lever.** Dropping the dearest of the four, the vectorscope, saves
  24%; dropping the three cheapest saves 30%. The pass is bound by the walk over the buffer that
  every scope shares, so `ScopeSet` is a refinement, not a rescue. It earns its place for a panel
  showing one scope full-height, not as a performance strategy.
- **Striding is the strong lever**, and it is linear: `stride: 2` reads a quarter of the pixels for
  a quarter of the cost, `stride: 4` a sixteenth for a sixteenth.
- **4K does not fit, and cannot be made to fit by choosing scopes.** 35.3 ms is two frames, and the
  frame walk *alone*, computing none of the four, is 10 ms. Any caller reading scopes off a
  source-resolution frame — `snapshot` at `scale: 1`, an export readback, the `scopes_read` MCP
  tool at full canvas — must pass a stride. **`stride: 4` is the recommendation**: 2.16 ms at 4K,
  518 400 samples, which is still five hundred times more samples than a 128×128 vectorscope has
  cells. `Scopes::sampled_pixels` is reported on every result so a clipping share can be read as a
  share of what was measured rather than of the frame it is assumed to describe.
- **The one number to watch** is 1920×1080 at 8.80 ms — over half a frame. It is not reachable
  today, because the preview composites at a fixed 640×360. It becomes reachable the moment the
  viewer composites at its own pixel size on a Retina display, and at that point scopes need a
  stride even in the preview.

### What moved while measuring it

Timing the four apart showed the vectorscope at ~2.6× the frame walk, and almost all of its excess
was one libm call: `cb.hypot(cr)`, once per pixel, guarding an overflow that cannot happen —
Rec.709 colour differences are bounded to ±0.5. Replacing it with the square root of the sum of
squares took **27% off every scope reading bay takes** (854×480 all four: 2.4–2.5 ms → 1.74 ms;
4K: 48.9–52.2 ms → 35.3 ms), verified A/B/A alternating across three rounds on the same machine so
drift could not account for it. The table above is the post-change measurement.

---

## What a regression means

Thresholds, from plan §6.6 ("Pure / criterion" class). Criterion noise on these benches is well
under 5 % on an idle machine, so 10 % is real signal:

| Change vs. baseline | Verdict |
|---|---|
| within ±10 % | noise — ignore |
| **> 1.10×** slower | **warn** — explain it in the PR description |
| **> 1.25×** slower | **fail** — do not merge without either a fix or an explicit, written trade-off |
| **> 1.25×** *faster*, unexplained | **investigate** — a sudden speedup on these usually means a case degenerated (a command started returning a no-op, a fixture stopped being built, a loop started breaking early) |

Absolute budgets, independent of any baseline — these are pass/fail regardless of what the previous
run said:

| Budget | Source | Where we are |
|---|---|---|
| undo/redo of a 500-element transaction < 5 ms | plan §6.6 | ~115 µs extrapolated ✅ |
| 512-frame audio block fill < 0.5 ms p99 | plan §6.6 | ~7 µs extrapolated for the mix step ✅ (the real `graph.fill()` does not exist yet) |
| serialize 1000 elements < 5 ms (autosave stays off the critical path) | this doc | 217 µs ✅ |

**Baselines are per machine and are never committed.** A laptop and a CI runner will never agree,
and a single global baseline pretending otherwise makes every number meaningless. Compare a run
against *your own* `--save-baseline` from before your change, on the same machine, on mains power,
with nothing else running. The table above is a record of one machine at one commit — it is the
"before picture" the plan asks for, not a threshold anyone else's machine has to meet.

**Recapture the table in its own commit.** If a change legitimately moves these numbers, update
this file in a commit separate from the change, so the reviewer sees the number diff isolated from
the diff that caused it — the same rule goldens follow.


---

## The pipeline, on a clock — `bay-bench`

```sh
cargo run --release -p bay-bench
BAY_BENCH_MEDIA=/path/to/clip.mp4 cargo run --release -p bay-bench
```

Refuses to run on a debug build (~30x slower here, so a debug number looks like data without
being any) and skips loudly without a GPU — `BAY_REQUIRE_GPU=1` turns that skip into exit 1.

It reports **p50/p95/p99/max, and takes its verdict from p99**. A loop that averages 8 ms and
stalls to 60 ms twice a second looks perfect in a mean and stutters visibly on screen; judder is
a tail problem, so the mean is the wrong statistic for it.

Measured 2026-08-27, release, `Project::starter()` at 640x360, 120 frames after a 10-frame warmup:

| Case | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|
| `render()` blocking | 1.42 ms | 1.46 ms | 1.55 ms | 2.15 ms |
| `submit_composite` + `collect_composite` | **0.38 ms** | 0.43 ms | 0.46 ms | 1.05 ms |
| real 1080p clip, decode + composite @30 fps | **0.46 ms** | 0.53 ms | 0.76 ms | 0.92 ms |

The pipelined path is **3.7x cheaper** than blocking, and `bay-ui`'s viewer already uses it.

**The engine is not the source of playback lag.** A real 1920x1080 H.264 clip composites, decode
included, in 0.46 ms — about 1,300 fps of headroom against a 30 fps timeline.

### The check that stops this lying

The real-clip case counts how many measured frames came back with **more than one colour in
them**, and prints it. Without that it measures how fast bay produces *nothing*: a decode that has
not landed composites to a flat frame, which costs almost no time and reads as a superb number.
`bay-preview/tests/render.rs` carries the same warning about a test that once asserted only buffer
length and passed with a missing file. Current run: **120 of 120 frames painted**.

### Playback, on a wall clock

The fixed-step case above answers *how expensive is one frame*. It cannot answer *how many frames
reach the screen*, because it never lets real time pass — it takes as long as it takes and calls
that a frame. A pipeline that produces a perfect frame in 0.46 ms but is only **asked** four times
a second scores identically there and is a slideshow in the window. That is not hypothetical: it
is exactly the bug that survived two rounds of investigation, because every number anyone measured
was healthy.

So `bay-bench` also plays a clip on a wall clock, advancing the playhead by elapsed time the way
the transport does, paced at 60 Hz. Measured 2026-08-28, release, six seconds of transport on a
1080p H.264 source:

| | |
|---|---:|
| pictures reaching the screen | **59.4 /s** |
| composite calls | 59.9 /s |
| window: served / repeat / starved / reseek | 289 / 144 / 8 / 1 |
| decoder head start | 96 frames (the bound) |

144 repeats of 289 is correct, not a fault: the source is 23.976 fps and the tick is 60 Hz, so
about three ticks in five *must* show the frame already up. The number that matters is
`served - repeat` — 145 distinct frames over six seconds, which is the source rate.

Pacing it at 60 Hz is deliberate. Unthrottled the same loop ran **5.8 million composite calls a
second** and reported 98% repeated frames — true, useless, and it drowns the two counters
(`starved`, `reseek`) that would name a real fault.

### The preview draws at the frame rate, not the refresh rate

Once playback was smooth, the probe reported the next thing wrong with it:

```text
ticks 120.0/s · pictures 120.0/s
playback: 30.0 new frames/s · served 120 repeat 90 starved 0 reseek 0
```

120 composites a second to show 30 new frames — three in four producing a picture identical to
the one before, each paying a full GPU readback, a fresh `RenderImage` and an atlas tile. The
cause was the composite signature hashing raw `MediaTime` ticks, of which there are 120,000 a
second, so every display refresh looked like a new scene.

`preview_playhead()` quantises to the project's frame rate and the composite is handed the same
value. Two playhead positions inside one frame *are* one picture. Counted, not asserted — the test
`a_second_of_playback_composites_once_per_frame_not_once_per_refresh` walks a second of timeline
at 120 Hz and reports **120 distinct composites before, 30 after** on a 30 fps project.

The waste was worse past the last clip. Nothing bounds a project's duration to its video: one
51-minute audio clip meant playing past the last picture composited an *empty* frame 120 times a
second for as long as the transport ran.

### What the numbers ruled out, and what actually caused the lag

Every layer measured well, and each measurement removed a suspect:

| Layer | Measured | Verdict |
|---|---|---|
| ffmpeg decode to preview size | 388 fps (300 frames in 0.774 s) | 13x real time — not it |
| composite + readback | 0.46 ms p50 | ~1,300 fps of headroom — not it |
| engine end to end, headless | 2,216 pictures/s | ~90x what playback needs — not it |
| GPU->CPU->GPU hop into GPUI | 2.05 ms p99 (`BAY_UI_FRAMETIME`) | against a 16.67 ms budget — not it |

An earlier version of this page named that last row as "where a lag that is not in the engine has
to be", and proposed `Window::paint_surface` with an IOSurface-backed `CVPixelBuffer` to remove it.
**That was wrong and the work was not worth doing.** The cause was that no frame was being
requested at all: `cx.notify()` called from inside `render` does not schedule one, because
GPUI sets the dirty flag only outside the draw phase. See `CLAUDE.md`.

The lesson is in the shape of the table, not any row of it. Four correct measurements of four
layers, all green, and the fault was in none of them — it was in how often the whole thing was
asked to run, which nothing measured. **A frame-rate probe must count pictures reaching the
screen, not ticks**; `BAY_UI_FRAMETIME` now reports `pictures/s` beside `ticks/s` for that reason,
and this wall-clock case exists for the same one.
