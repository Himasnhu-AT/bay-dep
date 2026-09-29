# Masking in bay: subject mattes, track mattes, shape masks

*Research and design, 28 Sep 2026. The goal from the owner: text behind the person (the title sits
between the background and the subject), shape and track mattes, and the compositing tricks that
follow from them. Each must be usable by bay's agent and from one-click buttons. Read-only on code;
nothing here is built.*

**Tags on every number:**

- **[V]**: verified by me today. Hashes and sizes come from the Hugging Face tree API or from
  hashing the downloaded file. Code facts come from reading the file named.
- **[P]**: the publisher's own figure (README, paper, Apple docs).
- **[E]**: my estimate. No one has measured it on a Mac.

## 0. The answer in one screen

- **Default model: MODNet**, ported to ONNX by Xenova. Apache-2.0 for code *and* weights, 25.9 MB
  fp32, 512 px input, portrait-trained, per-frame. Smooth it over time with MODNet's own
  One-Frame-Delay trick. It is small enough to **ship inside the app**, so the one-click button needs
  no download and no new network exception.
- **High-quality option: BiRefNet_lite**, from `onnx-community/BiRefNet_lite-ONNX`. MIT, 224 MB fp32
  or 115 MB fp16, 1024² input, any salient subject, much better hair and edges, per-frame, roughly
  10–30× slower. It would be downloaded on consent with a pinned commit and SHA-256, exactly as
  SigLIP is.
- **Spike before committing: Apple Vision.** `VNGeneratePersonSegmentationRequest` (macOS 12+) and
  `VNGenerateForegroundInstanceMaskRequest` (macOS 14+) cost no download, carry no licence, and run
  on the Neural Engine. The cost is a small Swift helper binary, which the release script already
  knows how to sign and check.
- **Excluded on licence:** RVM (GPL-3.0), MatAnyone 1 and 2 (NTU S-Lab, non-commercial),
  RMBG-1.4 (Bria, non-commercial), RMBG-2.0 (CC BY-NC 4.0) and VideoMaMa (CC BY-NC 4.0 code plus
  Stability Community weights). Check before using ISNet: the DIS repo is Apache-2.0, but
  `onnx-community/ISNet-ONNX` is tagged AGPL-3.0.
- **Pipeline:** a utility process runs ffmpeg decode → ONNX → temporal filter → alpha PNG frames.
  The frames go into one content-addressed "matte pack" in the cache, keyed by source time and read
  through `bay://` Range requests. The compositor applies it inside `#drawSource`, after the grade,
  so preview, `preview_frame` and export mask through one path.
- **Text behind subject** is not a new renderer. It is a *linked duplicate* of the clip on a track
  above the title, carrying `masks: [{ kind: 'subject' }]`. The compositor must draw the duplicate
  from **the same media element** as the base clip, so the two copies can never be a frame apart.
- **Build order for a demo:** (1) the MODNet worker and the matte pack, (2) the subject mask in
  `#drawSource` plus slot sharing, (3) `put_behind_subject` and its button, (4) a preview/export
  parity probe. Shape masks and track mattes come after that; BiRefNet last.

---

## 1. Models that run offline on a Mac

### 1.1 What bay already has to run a model

- `src/main/vision/host.ts` forks `out/main/vision/worker.js` with `utilityProcess.fork`. It sets
  `nice` to 10, ends the process after two idle minutes, cancels through an `AbortController`, and
  reports progress through a `frames` message. [V]
- `src/main/vision/encoder.ts` runs `onnxruntime-node` **1.30.0** on `executionProviders: ['cpu']`.
  [V]
- The shipped `libonnxruntime.1.30.0.dylib` *does* contain the CoreML execution provider:
  `strings` finds `onnxruntime::CoreMLExecutionProvider::CoreMLExecutionProvider(const CoreMLOptions &)`.
  [V] So `['coreml', 'cpu']` is a one-line experiment for any model below. Whether it is actually
  faster has to be measured per model, because unsupported ops fall back to the CPU with a copy
  across the boundary.
- `src/shared/visual-search.ts` (`VISION_MODEL`) is the pinning pattern: repo, revision, and for
  each file its bytes and SHA-256. The URL is
  `https://huggingface.co/<repo>/resolve/<revision>/<path>`. [V] Every matte model below is given in
  that shape.

### 1.2 Comparison

| Model | Licence (weights) | Size | Input | Temporal | Edges | Speed | Verdict |
|---|---|---|---|---|---|---|---|
| **MediaPipe Selfie Segmentation** | Apache-2.0 [V: HF card] | 0.46 MB fp32 [V] | 256×256 (general) | per-frame | coarse, binary-ish; no hair | real-time on phones [P] | too coarse for text-behind; possible instant *preview* matte |
| **MODNet** | Apache-2.0, "the code, models, and demos in this repository … are released under the Apache License 2.0" [V: [README](https://github.com/ZHKKKe/MODNet#license)] | 25.9 MB fp32 / 13.0 MB fp16 / 6.6 MB uint8 [V] | 512 (short side, /32) | per-frame + OFD trick | soft alpha; decent hair on portraits | 67 fps @512 on a GTX 1080 Ti [P: [paper](https://arxiv.org/abs/2011.11961)]; ~15–40 ms/frame on an M-series CPU [E] | **default** |
| **Robust Video Matting** (MobileNetV3) | **GPL-3.0**: "[Sep 16 2021] Code is re-released under GPL-3.0 license" [V: [README](https://github.com/PeterL1n/RobustVideoMatting)]; the weights ship in the same repo's releases | 7.5 MB fp16 / 15.0 MB fp32 [V] | any; `downsample_ratio` 0.25 at HD | **recurrent: video-native, the most stable** | good alpha | 1080p at 172 fps on an RTX 3090 fp16 [P] | best fit technically, **excluded**: GPL conflicts with bay's deliberately LGPL build (`vendor/ffmpeg/README.md`) |
| **BiRefNet** (general / portrait / matting) | MIT [V: GitHub + HF cardData] | 973 MB fp32 / 490 MB fp16 [V] | 1024² | per-frame | excellent (dichotomous segmentation; the matting variant gives soft alpha) | 17 fps @1024 on an RTX 4090 fp16 [P: [README](https://github.com/ZhengPeng7/BiRefNet)] | too heavy for video on a laptop |
| **BiRefNet_lite** (Swin-T) | MIT [V] | 224 MB fp32 / 115 MB fp16 [V] | 1024² | per-frame | very good; any subject | ~94 ms @1024 on an A100 via ONNX [P: README]; 0.3–1 s/frame on an M-series with CoreML EP [E] | **high-quality option** |
| **BEN2** (base) | MIT [V: HF cardData] | 219 MB fp16 [V] | 1024² | per-frame (the vendor claims a video mode) | very good on hair [P] | similar to BiRefNet_lite [E] | alternative HQ; newer and less proven |
| **RMBG-1.4 / 2.0** (Bria) | 1.4: Bria's own licence, non-commercial (HF lists `other`) [V]; 2.0: **CC BY-NC 4.0** [P] | 176 MB / ~885 MB | 1024² | per-frame | very good | — | **excluded** (non-commercial) |
| **U²-Net / `u2net_human_seg`** (rembg) | Apache-2.0 [P] | 176 MB (4.7 MB `u2netp`) | 320² | per-frame | blobby at video resolution | slow for its quality [E] | superseded by BiRefNet |
| **PP-HumanSeg v2** (PaddleSeg) | Apache-2.0 [P] | ~5–25 MB | 192×192 / 398×224 | per-frame | binary; built for video calls | real-time [P] | Paddle → ONNX conversion is ours to do; quality below MODNet [E] |
| **SAM 2 / 2.1** (tiny) | Apache-2.0 [P: [repo](https://github.com/facebookresearch/sam2)] | ~39 M params; the onnx-community export is encoder 134 MB + decoder 21 MB, image-only (no memory attention, so no video propagation) | 1024² | **video-native memory tracking from a click** | binary masks, not alpha | encoder heavy; the memory attention is awkward in ONNX [E] | later: "click to select *this* object". Not for people, where matting models beat it on hair |
| **SAM 3** (Nov 2025) | custom "SAM License": commercial use allowed with listed restrictions [P: [LICENSE](https://github.com/facebookresearch/sam3/blob/main/LICENSE)] | ~850 M params | 1008² | video-native, text prompt ("the dog") | binary masks | far too heavy locally [E] | watch; needs legal review |
| **EdgeTAM** | Apache-2.0 [P, not re-verified] | small SAM-2 variant built for on-device use | 1024² | video tracking | binary | fast on phones [P] | watch, for the SAM-style click selection |
| **MatAnyone / MatAnyone 2** (CVPR 2025/2026) | **NTU S-Lab License 1.0, non-commercial** [P: [LICENSE](https://github.com/pq-yang/MatAnyone/blob/main/LICENSE)]; MatAnyone 2 appears to use the same terms (not verified) | ~140 MB | any | video-native with memory propagation; best-in-class stability | excellent | GPU-class [E] | **excluded** (non-commercial) |
| **Apple Vision** person segmentation | an OS API: no download, no licence | 0 | fast / balanced / accurate; "accurate" produces a mask with 64× the pixels of "fast" [P] | **stateful**: reused through a `VNSequenceRequestHandler` it smooths the matte over time [P: WWDC21 10040]; one mask for all people; Apple recommends `.balanced` for video [P] | good at `.accurate`; soft edges | ANE-accelerated; real-time at `.balanced` [P: [WWDC21](https://developer.apple.com/videos/play/wwdc2021/10040/)] | **spike this**: see 1.4 |
| **Apple Vision** foreground instance mask | an OS API, macOS 14+ [P: [docs](https://developer.apple.com/documentation/vision/vngenerateforegroundinstancemaskrequest)] | 0 | — | per-frame | good; any salient subject, separate instances | — [E] | the "any subject" counterpart of the above |

### 1.3 Pinned files (the shape `VISION_MODEL` already uses)

Every value below was read from `https://huggingface.co/api/models/<repo>/tree/main/onnx`. The
`lfs.oid` is the SHA-256 of the file, the same property `downloadVerified` relies on for whisper. [V]

**MODNet** (default). Repo `Xenova/modnet`, revision `fa2fa546052fba4c08921230a26cc69a333fca12`,
licence `apache-2.0`.

| file | bytes | sha256 |
|---|---|---|
| `onnx/model.onnx` | 25,888,640 | `07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9` |
| `onnx/model_fp16.onnx` | 12,984,781 | `25f165da9bfd30830a575f1f0490f1acd995975cb349bc02f3d79332e1fe5cf6` |
| `onnx/model_uint8.onnx` | 6,627,048 | `7bad6522b3cde60246e69e234b7786337ef9c88abc790ee5c1aaa6e535b0c61d` |

Use fp32. `encoder.ts` already refuses half-float outputs, and uint8 quantisation costs edge
quality exactly where a matte is judged [E].

**BiRefNet_lite** (high quality). Repo `onnx-community/BiRefNet_lite-ONNX`, revision
`de15b22ba131738a16dff04aab8bdf8dc32e3ac1`, licence `mit`.

| file | bytes | sha256 |
|---|---|---|
| `onnx/model.onnx` | 224,005,088 | `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333` |
| `onnx/model_fp16.onnx` | 114,538,221 | `d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402` |

**Others, for completeness:**

- MediaPipe's official files are **tflite**, not ONNX (`storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/…`,
  249,537 B, `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`, hashed by a
  helper agent; `latest` is a mutable path, so pin the hash). The multiclass 256 model (6 classes
  including hair) is 16.4 MB. The ONNX below is a community port.
- `onnx-community/mediapipe_selfie_segmentation` @ `be49485c8e027524be38591817fc5cd31bd9d00e`:
  `onnx/model.onnx` 462,352 B, `3241ac4ad8aa35bdaf33946776db29f7c283a413aa0b0dacb9483594b4531aad`.
- `onnx-community/BEN2-ONNX` @ `c552aa82688edce09f0ac9d2e31ad53d9d629010`: `onnx/model_fp16.onnx`
  219,121,675 B, `dfdc25f421f32a0d1268e0f2ff2153d340e8f1d52d3dd16f5dc33c1ce85cedf1`.
- `onnx-community/BiRefNet-portrait-ONNX` @ `dd7167f6a8b54ff7efc29a4c988938d79866464f`:
  `onnx/model.onnx` 972,666,916 B, `1ba1c8ff5a7bbfadc8d8d13fb11d7be793f91f23d9d466549e37a854f6668f99`.
- RVM, for the record only (GPL): `rvm_mobilenetv3_fp16.onnx` from the GitHub release `v1.0.0` is
  7,503,483 B, `6a0d5ce6cc17702613be548559879b4521ed424cfe14ddc48d1acaa44d616f64` (hashed by me
  after downloading). The fp32 file is 14,975,696 B, `88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828`
  (hashed by a helper agent). GitHub gives no digest for these old release assets.

How to verify a pin: fetch `…/resolve/<revision>/<path>`. The redirect carries `x-linked-size` and
`x-linked-etag`, and the etag equals `shasum -a 256` of the file, as `downloadVerified` already
measured for whisper. Write to `.part` until both match. Nothing new is needed.

### 1.4 Why ship MODNet, and why spike Apple Vision

- **Ship MODNet in the bundle** (`Resources/models/modnet/model.onnx`, 25.9 MB, with Apache-2.0
  added to `LICENSES/`). The one-click button then works on first use and offline, with no consent
  dialog and no new host. Model downloads are already a listed network exception (SigLIP from
  `huggingface.co` at a pinned commit), so BiRefNet can ride that exception unchanged. It needs one
  more line in the CLAUDE.md network paragraph, "the same exception covers the high-quality matte
  model", and a switch in Preferences next to Visual search.
- **Apple Vision might beat MODNet on both quality and speed, at zero bytes.** It is per-frame, but
  Apple built `.balanced` for live video. What it costs:
  - a Swift CLI (`bay-matte-helper`) that reads frames on stdin and writes masks on stdout;
  - `swiftc` in the build;
  - one more Mach-O for `script/release-signed`. That script checks every Mach-O by content, so no
    signing change is needed, but the binary needs the hardened runtime and a timestamp like the
    others.
  - A reference implementation exists that does exactly this for TouchDesigner
    ([AppleVisionMask-TouchDesigner](https://github.com/aaronmylespereira/AppleVisionMask-TouchDesigner)).

  **Spike, 1 day:** run MODNet and Vision `.accurate` on the same three clips (a talking head, curly
  hair on a busy background, a side profile walking). Measure ms/frame, and measure flicker as the
  mean |αₜ − αₜ₋₁| over static background pixels. If Vision wins, it becomes the default and MODNet
  stays as the cross-platform fallback. One risk is specific to it: the OS supplies the model,
  so a macOS update can change the matte, and a project exported before and after the update can
  differ. The pack caches what was computed, so export stays reproducible *until* someone
  recomputes. The pack header should record the macOS build. Do not build it first: it adds a native binary to a pipeline
  that currently has none of bay's own.

### 1.5 Temporal stability: what bay has to add itself

Every licence-clean model above is **per-frame**. Per-frame mattes flicker at the edges, and in text
behind a subject that shows as the title's edge shimmering against the hair. The fix belongs in the
worker, not the compositor:

1. **OFD (One-Frame Delay)**, from the MODNet paper. For each pixel, if αₜ₋₁ ≈ αₜ₊₁ and αₜ differs
   from both by more than a threshold, replace αₜ with their mean. This costs one frame of latency,
   which does not matter offline. [P: [arXiv 2011.11961](https://arxiv.org/abs/2011.11961)]
2. **Edge-aware upsampling.** A fast guided filter (He et al.) uses the full-resolution source luma
   as the guide to lift the 512 px alpha to output resolution. It snaps the edges to real image
   edges instead of a bilinear blur. This is ~2–5 ms/frame at 1080p on the CPU [E], and it matters
   more than the model choice for hair at 4K [E].
3. A light EMA on the alpha, gated by a motion mask (|Iₜ − Iₜ₋₁|), stays **off by default**. It
   trades flicker for ghosting on fast movement.

---

## 2. Pipeline: computing and storing the matte

### 2.1 Where

- **Its own utility process, `bay matte`**, built as `out/main/matte/worker.js`. It copies the
  vision host's pattern exactly: fork on demand, `nice` 10, idle-exit after 2 minutes, a `frames`
  progress message, and cancel by id.
- It should not share SigLIP's process. The model lifecycles differ: SigLIP is ~1 GB and loaded for
  search, MODNet is 26 MB and loaded for a job. A crash in one should not fail the other.
- Code layout: `src/main/matte/{host,worker,local-worker,pack,protocol}.ts`, contracts in
  `@shared/matte`, and the IPC channels in `src/shared/ipc.ts` first. That is the convention.

### 2.2 The work, per asset

```
ffmpeg -i src -an -vsync passthrough -f rawvideo -pix_fmt rgb24 -s WxH pipe:1   (model size)
   + a second output, or a second pass, at guide size, gray, for the guided filter
→ ONNX (MODNet: 1×3×H×W, normalised (x−127.5)/127.5)   [check the preprocessor config, as SigLIP does]
→ OFD over a 3-frame window → guided-filter upsample → quantise to 8-bit alpha
→ PNG (grey+alpha, Y=255, A=matte) → append to <key>.bmat.part, record {pts, offset, length}
→ on the last frame: write the index, fsync, rename to <key>.bmat
```

- **Keyed by source time, never timeline time.** This is the same rule as beats
  (`@shared/beats`, "kept on the asset in source time, and mapped once"). Trims, slips, speed,
  reverse and splits all work without recomputing. The index holds each frame's **pts** from
  `-vsync passthrough`, so variable-frame-rate phone footage maps exactly. A fixed-fps assumption
  would drift on VFR footage.
- **Orientation:** ffmpeg auto-rotates by default and so does `<video>`. Pin that with one rotated
  iPhone clip in the tests, because a matte transposed against its picture is the likely first bug.
- **Resolution:** store at the source size, capped at 2048 px on the long side. The compositor
  scales the matte like any source. Soft alpha upscales well past that cap once the guided filter
  has already put the edges in the right place [E].
- **Content-addressed:** the key is SHA-256 of (`contentKey` from `vision/cache.ts`: size plus three
  1 MiB windows) + model id + model revision + parameters (OFD on, guide size). The directory is
  `<cacheDir>/mattes-<CACHE_SCHEME>/`, so `sweepStaleCaches` reclaims old schemes the way it does
  `thumbs-v1`.

### 2.3 Why not a video file

The two obvious formats both fail on *alignment*, not size:

- **A grey or alpha video** (VP9-alpha WebM through `libvpx-vp9`, which the vendored build has; or
  ProRes 4444 through `prores_ks`, also present). The renderer would decode it in a second
  `<video>`. That puts a second element on the same timeline under
  `DRIFT_TOLERANCE_SECONDS = 0.08` (`engine/sync.ts`, [V]). During playback the picture and its matte
  can be 2 frames apart, which shows as a halo that slides behind a moving head. Export seeks
  exactly, so the fault would show in the preview only, which is the worst kind of mismatch.
  (The vendored ffmpeg has **no FFV1**. `REQUIRED_ENCODERS` in `script/build-ffmpeg.sh` lists `png`,
  `prores_ks`, `libvpx-vp9` and `rawvideo`, but not `ffv1` [V]. FFV1 would also need a decoder in
  Chromium, which does not have one.)
- **A PNG sequence of loose files:** thousands of files per clip, and slow directory operations.

**The matte pack** (`.bmat`) is one file: a header, then concatenated PNG frames, then an index
`[{ptsUs, offset, length}]`, then a footer pointing at the index.

- `bay://` already serves Range requests (CLAUDE.md: "must honour HTTP Range requests"), so the
  renderer fetches one frame's bytes and calls `createImageBitmap(blob)`. No new protocol is needed.
- A frame is chosen by source time, exactly. PNG is lossless, so the matte bay drew is the matte
  the model made.
- Size: a 1920×1080 grey+alpha PNG of a person matte, whose Y plane is constant, compresses to about
  15–40 KB [E]. 60 s at 30 fps is 1,800 frames, about 30–70 MB [E]. That is acceptable in a cache
  that already budgets thumbnails and peaks. **Give mattes their own budget line and never evict a
  matte that the open project references**, because recomputing costs minutes, not milliseconds.
- `png` is already a required encoder *and* decoder in the vendored build [V:
  `capabilities.test.ts` line 176 and the `read` list]. So the worker can pipe
  `-f image2pipe -c:v png -pix_fmt ya8` out of the same ffmpeg instead of shipping a PNG encoder. Add
  `ya8` to what `capabilities.test.ts` asks the binary for, which is the rule for any new
  filter or format.

### 2.4 Progress, cancel, persistence

- **Job model:** reuse generation's discipline ("the job row is persisted before the request"). A
  matte job row `{assetId, key, model, framesDone, framesTotal}` goes in main's database, so a quit
  mid-job resumes on the next launch. The `.part` file is simply restarted in v1; resuming from the
  last indexed frame is a later optimisation.
- **Project reference:** `asset.matte?: { model: 'modnet@fa2fa54', key: string, frames: number }`.
  It is an optional additive field, so no format bump is needed (see "The `.bay` format changes
  additively"). The project records *that* a matte exists and which one. The pixels live in the
  cache.
- **A `.bay` opened on another Mac** has the field but no pack. The compositor reports it and the
  UI offers "Compute subject matte (≈40 s)". It never silently draws unmasked (see 3.5).
- **Progress:** frames done over total, pushed to the renderer the way vision indexing is, and
  shown on the clip in the timeline as a thin bar plus in the job list.
- **Cancel:** an `AbortController` in the worker kills the ffmpeg child and deletes the `.part`.

### 2.5 Throughput to expect [E]

| clip | MODNet (CPU) | MODNet (CoreML EP, if it helps) | BiRefNet_lite (CoreML EP) |
|---|---|---|---|
| 15 s vertical @30 | ~10–20 s | ~5–10 s | ~2–7 min |
| 60 s @30 | ~40–80 s | ~20–40 s | ~10–30 min |

Measure these before promising any of them in the UI. The UI should show a time *estimate* before a
BiRefNet job starts and use `validateOnly` to price it, the way the generate tools do.

---

## 3. Compositor design

### 3.1 The model

The field is an **array from day one**. A single `mask` later retyped to an array is a format change
under bay's own rules, and an array lets masks combine the way Resolve's Power Windows do.

```ts
// @shared/project — Item
masks?: Mask[]            // absent = unmasked; drawn in order, each combined into the running matte

type Mask = {
  mode?: 'add' | 'subtract' | 'intersect'   // default 'add' (the first mask starts from empty)
  invert?: boolean
  feather?: number        // timeline px, a Gaussian on the matte
  expand?: number         // timeline px; + grows, − chokes (morphology)
  opacity?: number        // 0..1, how strongly this mask applies
} & (
  | { kind: 'subject' }                                    // this item's own asset.matte
  | { kind: 'rect'; x: number; y: number; w: number; h: number; radius?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'path'; d: string }                            // SVG path data, item-box coordinates
  | { kind: 'item'; itemId: string; channel: 'alpha' | 'luma' }  // track matte
)
```

- **Shape coordinates are in the item's box** (0..1, or px of `layout`). The mask then moves, scales
  and rotates with the clip, and `crop` does not shift it.
- **Keyframes:** extend `KEYFRAME_PROPERTIES` (`@shared/keyframes.ts`) with indexed mask paths
  (`masks.0.x`, `masks.0.feather` …) so `animatedItemAt` resolves them with everything else. That
  is the one sampler, so preview and export animate alike.
- **Track matte (`kind: 'item'`):** the referenced item is rendered into the mask buffer through
  `#paintItem`, with the same transform, keys and grade. **An item used as a matte does not draw
  itself**, which is After Effects' default. That fact is *derived* from the references after every
  `edit()`, as `normaliseLinks` derives links, and is not a flag someone has to remember. A matte
  item on a hidden track still works as a matte.

### 3.2 Where it happens: inside `#drawSource`, after the grade

`#drawSource` (`compositor.ts:370`, [V]) already works out `src` (the crop in source pixels), `dest`
(timeline px), the device scale, and the graded canvas "at the size it will be drawn". Masking
slots in at the same point as a second source transform:

```
source ─(grade, if any)→ picture @ device size
       ─(mask, if any)→ picture with alpha  @ device size
       → ctx.drawImage(…, dest)   // alpha, fade, blend, CSS adjustments, rotation: all unchanged
```

- This is the only draw site for video, image, composition and `.brf` pictures, and text could be
  routed through it too. So preview, `preview_frame` and export all mask through **one** path, which
  is the property the grade was designed around.
- Glass backdrops (`#glassBackdrop`) are drawn before the surface and stay as they are.

### 3.3 The operations

For each masked item, in a per-size scratch pool (`OffscreenCanvas`, reused, never one per frame):

1. `pic`: draw the picture (the graded canvas or the element's `src` rect) at device size.
2. `matte`: an alpha-only canvas at device size, built mask by mask:
   - **subject:** draw the matte bitmap. The matte is in *source* pixel space, so draw it with the
     same `src` rect scaled by `matteW/sourceW`. That way crop and matte cannot disagree.
   - **rect / ellipse / path:** `Path2D` fill in white on transparent.
   - **item:** `#paintItem` into a third scratch. For `luma`, convert luminance to alpha (step 3).
   - **combine:** `add` uses `source-over`, `subtract` uses `destination-out`, `intersect` uses
     `destination-in`. `invert` is a `xor` against an opaque fill.
   - **feather:** `ctx.filter = 'blur(<feather × deviceScale>px)'` on *this* draw only. CLAUDE.md
     measured the filtered path at roughly 2× the cost at 4K, which is acceptable on one alpha
     buffer and never paid by an unmasked clip.
3. **In the shared WebGL2 context** (the grade's, `engine/grade.ts`: "one WebGL context, shared by
   every compositor"), only when needed:
   - **luma → alpha**: `a = dot(rgb, vec3(.2126,.7152,.0722)) · a`. Canvas 2D cannot do this without
     an SVG filter, and SVG filters are not available on `OffscreenCanvas`.
   - **expand / choke**: a separable min/max (morphology) pass, radius in device px.
   - A small `engine/mask.ts` exporting `maskPass(request)`, built on the grade module's context
     getter. It is a second consumer of one context, never a second context: Chromium caps a page at
     about 16 live contexts, as grade.ts notes.
4. `pic.globalCompositeOperation = 'destination-in'; pic.drawImage(matte)`, then hand `pic` to the
   existing `ctx.drawImage(…, dest)`.

**4K cost [E]:** two full-frame GPU blits plus one `destination-in`. On Apple-silicon GPUs that is
about 1–3 ms, small next to export's readback. The real cost is **PNG decode** of the matte, about
5–15 ms at 2048 px [E]. It has to come from a prefetching pool shaped like `CompositionPool`:

- **live:** the latest decoded matte frame within one frame of the target, with 3 frames ahead
  fetched while playing;
- **exact** in export and `preview_frame`: wait, exactly as they already do for compositions.

Masks are skipped entirely when `masks` is absent or empty (the `'none'` rule: a feature nobody uses
costs nothing).

### 3.4 Text behind the subject: the recipe, and the one compositor change it needs

```
V3  clip (duplicate)  masks:[{kind:'subject'}]   ← the person again, cut out
V2  title (text / .brf / composition)
V1  clip (original)                               ← background and person
```

The duplicate shares the original's `linkId`. Links already make items "move, trim, slip, split and
delete together" (`@shared/links`), so the two copies cannot come apart in time through any edit.

**The trap is two elements.** `elementSlots` (`compositor.ts:1091`, [V]) gives each drawing of the
same asset in one frame **its own** `<video>` element. That is right for two different source
times, but for the base and its cutout it means two decoders, each allowed to drift up to 80 ms
during playback. The cutout would then be a different frame from the picture under it, and the
person would appear doubled at the edges on every movement.

**Change:** key slots by `(assetId, source frame at this timeline frame)` rather than by count
alone. Two items showing the same asset at the same source time share one element, and so are drawn
from the same decoded frame, which is exact by construction. It is a small, general change: any
duplicate-and-stack effect (glow copies, echo, blurred background fill) gets the same guarantee for
free.

**Matte ↔ picture alignment during playback:** in export and scrub the element is seeked to within
half a frame, so the computed source time *is* the displayed frame. During playback it is not.
Choose the matte frame from **the element's own `currentTime`** (or, better,
`requestVideoFrameCallback` `mediaTime`, which the engine does not use today [V: no occurrences])
rather than from the timeline's target time. Then the matte follows the picture actually on screen.

**Grade drift:** if the user regrades V1 after the recipe, V3 keeps the old grade and the person's
skin changes colour at the cut-out edge. `put_behind_subject` copies grade, crop, adjustments and
layout. `inspect_item`, and the Changes card, should warn when a subject cutout's look differs from
its base's. A later, cleaner step would be a cutout that *references* its base's look; do not build
that first.

### 3.5 When the matte is not there: a named incomplete frame, not a wrong picture

This follows the export rule "an export that wrote a wrong frame says so".

- **Matte frame still decoding:** `notePending(stats, '<asset> subject matte')`. Export waits, then
  records the frame in `IncompleteFrames` like any other pending item.
- **Matte never computed, or evicted:** the masked item **draws nothing**. For text-behind-subject
  that degrades to the title sitting in front of the person, which is readable and obviously
  unfinished. The frame is recorded in a new `DrawStats.matteIssues`, which `describeIncomplete`
  names with the recovery ("compute the subject matte for X"). Export returns `complete: false`.
  Drawing the *unmasked* duplicate instead would silently hide the title behind a full copy of the
  frame: a wrong picture that looks deliberate.
- The pack's model id or revision disagrees with `asset.matte.model` → treated as missing, with the
  model named in the message.

### 3.6 Tricks the same machinery gives

| effect | recipe |
|---|---|
| Text / graphic behind the subject | above |
| Background removal | the clip with `subject` alone on a track over a new background |
| Background replace / blur | V1: the clip with blur (or a generated plate); V2: the linked cutout |
| Colour pop | V1: the clip, saturation 0; V2: the linked cutout in full colour |
| Spotlight / vignette on the subject | a black solid with `masks:[{kind:'subject', invert:true, feather:40}]`, opacity 0.6 |
| Subject outline or glow | the cutout with `expand: 8`, filled with one colour (needs a "fill" look, v2), under the cutout |
| Iris / shape reveal | an ellipse mask with keyed `rx/ry`; the existing iris transition, but on any item |
| Split screen with a soft seam | a rect mask with feather |
| Text as a window onto video (track matte) | video with `masks:[{kind:'item', itemId: title, channel:'alpha'}]` |
| Freeze-frame cutout ("character intro") | `freeze-frame.ts` still + the matte frame at that pts, placed as a cutout over a stylised background |

---

## 4. Agent and UI surface

### 4.1 Tools (one file each in `src/shared/tools/`, then `pnpm gen:tools`)

- **`compute_matte`** `{ assetId | itemId, quality?: 'standard' | 'best', validateOnly? }`
  - Starts a job and returns `{ jobId, framesTotal, estimateSeconds }`.
  - `best` needs the BiRefNet download. When it is missing, the error says where to click, in the
    same words the visual-search error uses.
  - `selfValidating`, so `validateOnly` prices the call without starting anything.
- **`track_matte`** `{ jobId }` — `{ state, framesDone, framesTotal, etaSeconds }`, the
  `track_generation` shape.
- **`edit_item.masks`** — the array from 3.1, validated per kind.
  - A `subject` mask on an asset without a matte is **accepted** (the matte can come later), and the
    result carries `warning: "No subject matte yet — this item draws nothing until compute_matte
    finishes (~40 s)"`. An agent must not believe it made a visible change when it did not.
- **`put_behind_subject`** `{ overlayItemId, clipItemId?, quality? }`, the whole recipe in one
  undoable `edit()`:
  - finds the clip under the overlay at its span if `clipItemId` is omitted, and names the candidate
    ids when there are several;
  - makes the linked duplicate on a track above the overlay, creating the track if needed;
  - copies the look, and starts `compute_matte` if needed;
  - returns `{ cutoutItemId, trackId, matteJobId? }`, naming what it made, as `place_asset` names
    `soundItemId`.
  - Refusals carry what a retry needs: "no video clip under frames 120–210 on any track below V2;
    clips nearby: …".
- **`preview_frame` / `frame_grid`** are unchanged. The skill tells the agent to check one frame
  where the title overlaps the head.

### 4.2 Skill and guide

- **Skill `text-behind-subject`** in `src/shared/skills.ts`. Description: "Use when the user wants
  a title, word or graphic to appear behind a person or object in the shot." The body:
  1. Put the title on the track directly above the clip. It must be *large*: the effect reads only
     when the subject covers part of the letters, so aim for 30–60% of letter height overlapped.
  2. Call `put_behind_subject`, then `track_matte` until done.
  3. `preview_frame` at a frame where the head crosses the title. If the edge looks hard, re-run
     with `quality: 'best'`.
  4. Check a frame where the subject moves fast, because that is where per-frame mattes fail.
- **Guide `bay://guide/masks`**, with every example validated by a test, as the `.brf` guide
  examples are.
- **Styles:** a style (`write_style`) can name the recipe, for example "Title card: huge condensed
  type behind the speaker, first 2 s". That is how short-form "hook" intros are built [C].

### 4.3 One-click buttons

- **Context menu on a text, `.brf` or composition item that sits over a video:** *Put behind
  subject*. It calls the same store action as the tool. If the matte is missing it computes it,
  showing progress on the clip.
- **Context menu on a video clip:** *Cut out subject*, *Remove background*, *Blur background*,
  *Colour pop*, *Spotlight subject*. Each is a preset over the 3.6 recipes, in one edit and one undo
  step.
- **Inspector › Mask** (a new `inspectorTab`):
  - the mask list, with add Subject / Rectangle / Ellipse / Pen / Track matte;
  - per mask: mode, invert, feather, expand, opacity, and keyframe diamonds;
  - a *Compute subject matte* button with its state ("Computed · MODNet", "Missing on this Mac",
    "Computing 43%").
- **Viewer overlay:** drag handles for rect and ellipse and a feather ring. The pen comes later. The
  Color page is the natural home for shape masks (Resolve's Power Windows). Subject cut-outs belong
  on the Edit page.
- **Preferences › Masking:** the model choice (Standard, bundled / Best, download 115 MB), the
  Download button, and "Download models when needed", mirroring Visual search.

---

## 5. Risks, effort, and what to build first

### 5.1 Risks, ordered by how well each one hides

1. **Picture/matte misalignment during playback only.** Export is exact and the preview is off by
   1–2 frames, so a probe of export passes while the preview shows a halo. Probe the preview
   separately: a moving subject, sample edge pixels on consecutive preview frames. The fixes are
   slot sharing plus choosing the matte by the element's `currentTime` (3.4).
2. **Temporal flicker** in per-frame models. It looks fine on a still `preview_frame` and bad in
   motion. Measure it (mean |Δα| on static pixels) and do not judge from single frames.
3. **Grade drift between the base and its cutout** (3.4). It is invisible until someone regrades.
4. **Rotation or VFR mismatch** between ffmpeg's decode and `<video>` (2.2). Pin one rotated and one
   VFR phone clip in the tests.
5. **Wrong subject.** MODNet only knows people. With a dog, product or car it returns noise or
   nothing. `compute_matte` should report matte coverage (the fraction of frames with any subject)
   and warn when it is below ~20%, suggesting `best`.
6. **Several people:** MODNet mattes all of them. That is usually what text-behind-subject wants,
   but choosing *one* person needs SAM-style tracking later.
7. **Cache eviction** turns a finished edit into "matte missing" on the next open. Hence the separate
   budget and the rule that referenced mattes are never evicted (2.3).
8. **Licence creep.** RVM and MatAnyone are the best video matting models in public and both are
   excluded. Anyone swapping them in "for quality" breaks the licence story. The pinned-model spec
   should carry a `licence` field that a test asserts against an allow-list (Apache-2.0, MIT, BSD).

### 5.2 Effort

| part | size | note |
|---|---|---|
| Matte worker (MODNet, ffmpeg decode, OFD, guided filter) | M | the vision host is the template; the guided filter is ~100 lines |
| Matte pack writer/reader + `bay://` range reads + cache budget | S | |
| Job persistence, progress, cancel, `asset.matte` field | S | |
| `masks` model + keyframe paths + shared contract | S | |
| Compositor: subject mask in `#drawSource` + matte pool | M | pool shaped like `CompositionPool` (live and exact) |
| Slot sharing by (asset, source frame) | S | small, but touches preroll and the pool; test thoroughly |
| Shape masks + feather | S | |
| WebGL mask pass (luma, expand/choke) + track mattes | M | the "item used as matte is not drawn" derivation |
| Incomplete-frame reporting (`matteIssues`) | S | |
| Tools (`compute_matte`, `track_matte`, `edit_item.masks`, `put_behind_subject`) + skill + guide | S–M | |
| UI: Inspector › Mask, context-menu presets | M | |
| Viewer shape handles | M | |
| BiRefNet_lite download option + CoreML EP evaluation | S–M | |
| Apple Vision spike | S (1 day) | build only if it wins |
| Parity and alignment probes (`test/app/mask.mjs`) | M | see 5.3 |

### 5.3 What to build first, for a demo

1. **MODNet worker and matte pack** for one asset, with the model shipped in `Resources/`. Test it
   in Node against a fixture clip: the pack reads back per-frame, pts are monotonic, and a
   known-background pixel is α≈0 while a known-face pixel is α≈1. That pair is the positive and
   negative control.
2. **`masks: [{kind:'subject'}]` in `#drawSource`**, the exact matte pool for export and
   `preview_frame`, and **slot sharing**.
3. **`put_behind_subject`** and the *Put behind subject* context-menu item.
4. **`test/app/mask.mjs`**, modelled on `grade.mjs`:
   - preview and export of the same frame match on the mask edge;
   - a pixel inside the head shows the person (the title is hidden) and a pixel beside the head
     shows the title. Derive the title's colour from the item rather than using a literal;
   - the cutout's pixels equal the base's pixels inside the matte, which proves one element;
   - deleting the pack yields `complete: false` naming the matte.

That is a convincing demo: a talking head with a huge title behind it, made in one click and
exported correctly. Next: shape masks with feather (the Color page), then track mattes and the WebGL
pass, then BiRefNet `best`, then the Apple Vision decision.

---

## Sources

- MODNet README and licence: https://github.com/ZHKKKe/MODNet#license · paper (67 fps, OFD): https://arxiv.org/abs/2011.11961
- MODNet ONNX: https://huggingface.co/Xenova/modnet/tree/fa2fa546052fba4c08921230a26cc69a333fca12/onnx
- Robust Video Matting (GPL-3.0 notice, speed table): https://github.com/PeterL1n/RobustVideoMatting · release assets: https://github.com/PeterL1n/RobustVideoMatting/releases/tag/v1.0.0 · paper: https://arxiv.org/abs/2108.11515
- BiRefNet (MIT, speed notes, ONNX releases): https://github.com/ZhengPeng7/BiRefNet · https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1 · lite: https://huggingface.co/ZhengPeng7/BiRefNet_lite
- BiRefNet_lite ONNX: https://huggingface.co/onnx-community/BiRefNet_lite-ONNX · portrait: https://huggingface.co/onnx-community/BiRefNet-portrait-ONNX
- BEN2 ONNX: https://huggingface.co/onnx-community/BEN2-ONNX
- RMBG-1.4: https://huggingface.co/briaai/RMBG-1.4 · RMBG-2.0: https://huggingface.co/briaai/RMBG-2.0
- MediaPipe selfie segmentation ONNX: https://huggingface.co/onnx-community/mediapipe_selfie_segmentation · MediaPipe image segmenter: https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter
- SAM 2: https://github.com/facebookresearch/sam2 · SAM 3 and its licence: https://github.com/facebookresearch/sam3/blob/main/LICENSE · https://arxiv.org/abs/2511.16719
- EdgeTAM: https://github.com/facebookresearch/EdgeTAM
- MatAnyone (S-Lab licence): https://github.com/pq-yang/MatAnyone/blob/main/LICENSE · MatAnyone 2: https://github.com/pq-yang/MatAnyone2
- PP-HumanSeg (PaddleSeg): https://github.com/PaddlePaddle/PaddleSeg/tree/release/2.9/contrib/PP-HumanSeg
- rembg / U²-Net: https://github.com/danielgatis/rembg · https://github.com/xuebinqin/U-2-Net
- Apple Vision person segmentation: https://developer.apple.com/documentation/vision/vngeneratepersonsegmentationrequest · quality levels: https://developer.apple.com/documentation/vision/vngeneratepersonsegmentationrequest/qualitylevel · WWDC21 session: https://developer.apple.com/videos/play/wwdc2021/10040/ · foreground instance mask: https://developer.apple.com/documentation/vision/vngenerateforegroundinstancemaskrequest · a native helper example: https://github.com/aaronmylespereira/AppleVisionMask-TouchDesigner
- Fast guided filter: https://arxiv.org/abs/1505.00996
- bay code read for this document: `src/main/vision/{host,worker,encoder}.ts`, `src/shared/visual-search.ts`, `src/renderer/src/engine/{compositor,grade,sync}.ts`, `src/main/media/cache-dirs.ts`, `src/main/ffmpeg/capabilities.test.ts`, `script/build-ffmpeg.sh`, `vendor/ffmpeg/README.md`, `node_modules/onnxruntime-node` (CoreML EP present in the dylib).
