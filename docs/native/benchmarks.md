# vii — benchmarks

Criterion benchmark suite for the pure-CPU parts of the editor, per
[`palmier-parity-plan.md` §6.6](palmier-parity-plan.md). Three crates carry benches today:

| Crate | Bench file | What it measures |
|---|---|---|
| `opencut-audio` | `benches/mix_stereo.rs` | `mix_stereo` throughput — seconds of audio mixed per second of CPU |
| `opencut-core` | `benches/commands.rs` | command dispatch + undo/redo on an N-element project |
| `opencut-project` | `benches/project_serde.rs` | project JSON serialize / deserialize / round-trip at N elements |

Everything here is **pure CPU**: no GPU, no ffmpeg, no file IO, no clock, no RNG. Every fixture is
a deterministic synthetic project built in-process, so two runs on the same machine differ only by
machine noise. Wall-clock pipeline numbers (preview frame time, decode, export, cold start) are
*not* criterion's job — those belong to the `vii-bench` binary described in §6.6(B) of the plan,
which does not exist yet.

---

## Running them

```sh
cargo bench -p opencut-audio
cargo bench -p opencut-core
cargo bench -p opencut-project
```

A fast smoke run (useful when you only want to know the bench still executes):

```sh
cargo bench -p opencut-audio -- --warm-up-time 1 --measurement-time 2
```

Filter to one case with a substring:

```sh
cargo bench -p opencut-core -- move_element/1000
```

**Benchmarks never run in CI** (plan §6.1). They are a cadence tool: run them at a milestone
boundary, and run them when you touch mixing, the command/patch path, or the project schema.

### Comparing against a previous run

Criterion's own baseline machinery is the regression machinery — do not build another one:

```sh
# before your change
cargo bench -p opencut-core -- --save-baseline before
# after your change
cargo bench -p opencut-core -- --baseline before
```

Criterion then prints a signed percentage change and a p-value per case. Results live in
`target/criterion/`, which is not committed — a baseline is local to your machine and your
working tree, which is the point (see "what a regression means" below).

---

## What each benchmark measures

### `opencut-audio` — `mix_stereo`

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

### `opencut-core` — `commands`

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

### `opencut-project` — `project_serde`

The cost of every open, every save, and every autosave. This is the number that decides whether
autosave can run on the UI thread.

- **Parameters.** N ∈ {100, 500, 1000} elements, `serialize` / `deserialize` / `roundtrip`.
- **Throughput** is keyed to the serialized document size (printed as a `fixture:` line at the
  start of each N), so `roundtrip` reads as *bytes of document per second*, not bytes moved.
- A `assert_roundtrip_is_lossless` check runs before any timing: the decoded project must compare
  equal to the original and must still carry its animation channels and audio elements. A
  benchmark that times a lossy shortcut is worse than no benchmark.

### The synthetic project (shared design, duplicated per crate)

`opencut-core` and `opencut-project` each build their fixture the same way, and deliberately
**never use an `Element` struct literal**. Elements are cloned from `Project::starter()`'s
text / image / audio elements and then mutated through the public setters (`set_id`, `set_name`,
`set_start`, `set_duration`, `animations_mut`). That keeps the fixture describing the *current*
element shape when a field is added to `Element` — as `blend_mode` recently was — instead of going
stale behind a literal somebody has to remember to update.

Elements round-robin across the main, overlay, and audio lanes with per-lane cursors, so every lane
is butt-joined and non-overlapping, which is the shape a real timeline has. Durations cycle through
four values so starts are not a single arithmetic run. In the `opencut-project` fixture every third
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

### `cargo bench -p opencut-audio`

| Clips | Output | Time | Output frames/s | **s-audio / CPU-s** | Clip-seconds / CPU-s |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 s | 51.03 µs | 941 M | **19 600×** | 19 600 |
| 4 | 1 s | 175.2 µs | 274 M | **5 710×** | 22 800 |
| 16 | 1 s | 677.6 µs | 70.8 M | **1 480×** | 23 600 |
| 1 | 10 s | 505.4 µs | 950 M | **19 800×** | 19 800 |
| 4 | 10 s | 1.727 ms | 278 M | **5 790×** | 23 200 |
| 16 | 10 s | 6.702 ms | 71.6 M | **1 490×** | 23 900 |

Reading it: the marginal cost per clip is flat at ~**23 000 clip-seconds mixed per CPU-second**,
i.e. ~43 ns per clip-second, independent of clip count and output length. The single-clip cases
sit lower (19 600) because the final clamp pass over the output buffer is paid once regardless of
clip count, and with one clip that fixed pass is a large share of the work.

*Extrapolated, not measured:* a 512-frame block at 48 kHz is 10.67 ms of audio, so 16 clips of it
is ≈ 7 µs of mixing — roughly 1.4 % of the plan's 0.5 ms real-time block budget. Treat that as a
sanity check only; the streaming `graph.fill()` path that budget actually governs does not exist
yet, and it will pay costs `mix_stereo` does not (per-block envelope, resampling, no whole-buffer
allocation).

### `cargo bench -p opencut-core`

Reported time is for a batch of 64 operations; the per-op column is that divided by 64.

| Operation | N | Batch time (64 ops) | **Per operation** |
|---|---:|---:|---:|
| `MoveElement` | 100 | 17.36 µs | **271 ns** |
| `MoveElement` | 1000 | 53.38 µs | **834 ns** |
| `AddElement` | 100 | 20.38 µs | **318 ns** |
| `AddElement` | 1000 | 43.32 µs | **677 ns** |
| `undo` (MoveElement) | 100 | 7.58 µs | **118 ns** |
| `undo` (MoveElement) | 1000 | 14.68 µs | **229 ns** |
| `undo` (AddElement) | 100 | 11.90 µs | **186 ns** |
| `undo` (AddElement) | 1000 | 20.48 µs | **320 ns** |
| `redo` (MoveElement) | 100 | 7.49 µs | **117 ns** |
| `redo` (MoveElement) | 1000 | 14.38 µs | **225 ns** |
| `redo` (AddElement) | 100 | 8.40 µs | **131 ns** |
| `redo` (AddElement) | 1000 | 7.51 µs | **117 ns** |

Reading it:

- **Execute costs more than undo/redo, and the gap widens with N** — `MoveElement` is 2.3× its own
  undo at N=100 and 3.6× at N=1000, because execute scales 3.1× from N=100 to N=1000 while its undo
  scales only 1.9×. That is `Command::lower` doing its own ref resolution on top of the one
  `ProjectPatch::apply` does; undo replays an already-lowered patch and pays the scan once.
- **`redo` of `AddElement` is flat in N** (117 ns at both sizes) while its `undo` grows: redo
  re-inserts at a known index at the end of the track, undo has to scan for the element to remove.
- Against the plan's absolute budget — *undo/redo of a 500-element transaction < 5 ms* — a 500-op
  undo at N=1000 extrapolates to ~115 µs, about 43× inside budget. There is no batched-transaction
  API yet (T-101), so this is per-command undo repeated, not one transaction.
- A drag at 60 fps has 16.6 ms per frame and dispatches one `MoveElement`; at 834 ns for a
  1000-element project, dispatch is ~0.005 % of the frame. Command dispatch is not, and is not
  close to being, the timeline's bottleneck.

### `cargo bench -p opencut-project`

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
plan's `vii-bench` target of *project open / save (500 clips) ≈ 84 ms / 61 ms* is dominated by file
IO and whatever wrapping the save path adds, not by serde: serde's share of a 500-element save is
0.11 ms.

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
