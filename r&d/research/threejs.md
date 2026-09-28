# three.js in bay: 3D motion graphics

*Research and design, 2026-09-28. Only read the code; nothing in `src/` was changed. Two throwaway
Electron probes were run from the scratchpad. Their results are marked **measured**; every other
number is marked as an estimate.*

**The goal:** bay's agent, and later one-click presets, can make 3D motion graphics. Examples:
extruded 3D text the camera flies through ("SOC 2 in minutes"), 3D logos, particles and depth
parallax. They must sit over video and match exactly across preview, `preview_frame` and export.

**Recommendation in one line:** make it native (**route B**). Add a `<scene3d>` layer to the
existing `.brf` format. The locked-down worker produces it as data, bay's own bundled three.js
renders it on a second WebGL2 `OffscreenCanvas` in the renderer, and `#drawSource` draws it like
any other source. Route A (three.js inside HTML compositions) already works today with no engine
changes (measured below). Document it as a stopgap for exploration, not as the product.

---

## 1. What in bay's code decides this

| Fact in the code | Where | Why it matters for 3D |
|---|---|---|
| `.brf` modules run in a worker that is locked down before any user code runs. The worker returns only a JSON scene per frame, rendered in 0.5 s chunks and cached. The compositor asks synchronously and gets a scene, `pending`, or an error. | `engine/brfCode.ts` (`CHUNK_SECONDS`, `TIMEOUT_MS = 3000`), `shared/brf-lockdown.ts` | A 3D scene description fits this pipeline without changes. Code stays in the worker; only data comes out. |
| A `.brf` is painted into an `OffscreenCanvas` surface at its drawn size, then drawn through `#drawSource`. That is how crop, looks, grade, rotation, fades and blend apply to it. | `engine/brf.ts` `BrfSurfaces.draw`, `compositor.ts:606-649` | A 3D layer rendered into that surface gets all of this for free, and preview, `preview_frame` and export share one path. |
| A WebGL2 context already lives in the compositor path: `GradeContext`, a single `OffscreenCanvas` with `premultipliedAlpha: true` and `preserveDrawingBuffer: true`, shared by every compositor, with a `webglcontextlost` flag. Its comment notes that Chromium caps a page at about 16 live contexts. | `engine/grade.ts:257-300` | This proves that a WebGL2 `OffscreenCanvas` → `ctx.drawImage` step works in preview, `preview_frame` and export. It also sets the rule: one long-lived context per subsystem, never one per render. |
| Compositions render in hidden `BrowserWindow`s (`offscreen: false`, because offscreen rendering crashed at 1080p). Each window is `transparent`, `sandbox: true`, in its own partition, and confined to its folder by `sandbox.ts`. Frames are grabbed with `capturePage()` and always resized, because Retina backing stores come back at 2×. At most 8 windows. | `main/html/compositions.ts:309-345, 460-480` | Route A inherits all of this. It also inherits the 40–80 ms per frame and the live pool's stale-frame behaviour in preview. |
| The preview's composition pool answers with the *latest decoded* frame during playback. | CLAUDE.md, `CompositionPool({ live: true })` | For a camera fly-through, where every frame moves, a stale frame shows up as judder in preview. |
| Renderer CSP: `script-src 'self'`, `connect-src 'self' bay:`, with no `worker-src`, so workers fall back to `script-src`. Main cancels every remote request from the editor session (`offline.ts`). | `src/renderer/index.html:13` | Bundled three.js loads as a `'self'` chunk. Libraries that spin up `blob:` workers or fetch CDN fonts (troika-three-text does both by default) are blocked. |
| Fonts are assets. Main copies them content-addressed into `<userData>/fonts`, where the renderer can read them over `bay://`. They can be TTF, OTF, WOFF or WOFF2. | CLAUDE.md "Fonts are assets", `media/font-file.ts` | Extruded text needs glyph *outlines*, not a `FontFace`. The renderer can fetch the bytes over `bay://` and outline them. |
| **The worker still has `OffscreenCanvas`, and with it WebGL.** It is not in `REMOVED_GLOBALS`. | `shared/brf-lockdown.ts:35-66` (grep count 0) | Route B must *not* render in the worker. Add `OffscreenCanvas` to the removed list when 3D lands, so a module cannot reach the GPU and nobody is tempted to "just render it in the worker". |
| There is no three.js in `package.json` or `node_modules`, and no bundled font file in `resources/`. | — | Route B adds three (MIT) and probably opentype.js (MIT). It also needs a default face for extruded text, because system fonts have no reachable outlines. |

## 2. Two probes (measured, Electron 44.4.3, this Mac)

Both scripts are in the scratchpad (`webgl-capture-probe/`). Each launches a bare Electron process,
never bay.

**Probe 1: does `capturePage` capture WebGL in a window configured like bay's composition
windows?** The window used `show: false, transparent: true, backgroundColor: '#00000000',
offscreen: false, sandbox: true`. The page had a 1920×1080 WebGL2 canvas (`alpha: true`,
`preserveDrawingBuffer: false`) drawing a red triangle whose x position depends on `t`, with a
100×100 green DOM box on top.
- It captures WebGL. There were 258,718 red pixels, against 259,200 expected from the triangle's
  area; the difference is the anti-aliased edge. The 10,000 green DOM pixels were also present.
- **Alpha is preserved.** 1,800,718 pixels came back with alpha 0, so the layer can sit over video.
- **It follows `t`.** At `draw(-0.4)` the left probe pixel read `[255,0,0,255]` and the right
  `[0,0,0,0]`; at `draw(+0.4)` they swapped. That is the positive control.
- **No rAF wait was needed.** Drawing and then capturing straight away already showed the new
  position. bay's `seekScript` waits for a paint anyway.
- Seek plus capture took **10–23 ms** per frame for a trivial scene. That covers the main-process
  side only; the IPC transfer, BGRA→RGBA conversion and `ImageBitmap` creation that bay's 40–80 ms
  figure includes are not in it.

**Probe 2: do ES modules and import maps load over `file://` in a sandboxed window?**
`<script type="importmap">{"imports":{"three":"./m.js"}}</script>` followed by
`import { v } from 'three'` gave `window.modOk === 42`. This matters because three.js no longer
ships a UMD `build/three.js` (removed in r160), so modules are the only way to load it in a
composition.

Not measured: a real three.js scene. `npm pack three` was denied in this session, so every figure
for three.js's own cost below is an estimate.

## 3. The routes

### A. three.js inside HTML compositions

**How it works:** the agent writes a composition whose `time(t)` calls
`renderer.render(scene, camera)` after setting the camera and meshes from `t`. It registers
`window.__timelines[id] = { time(s){…}, duration(){…} }`; the contract asks for that shape, not for
GSAP. `three.module.min.js` sits beside the file and is loaded through an import map.

- **Feasibility:** this works today, as shown by probes 1 and 2. The one product change worth
  making is to ship `three.module.min.js` (plus `FontLoader`, `TextGeometry` and a typeface JSON)
  as a bay-provided vendor folder that `write_composition` copies beside the file, the same way the
  guide tells agents to vendor GSAP. Without it, agents will reach for a CDN tag, and the contract
  warns that this "renders as a still frame".
- **Determinism:** good if the author derives everything from `t`, with no `Clock`, no
  `Math.random` without a seed, and no `requestAnimationFrame` loop. bay cannot enforce any of
  that; the compositions contract already relies on the author for the same things.
- **Performance (estimate):** 40–80 ms per frame end to end, plus render time. A 5 s clip at 30 fps
  costs roughly 6–12 s extra in export, which is acceptable. **Preview is the problem.** The live
  pool shows the latest decoded frame, so a camera that moves every frame will visibly judder at
  about 12–25 captured fps. At 4K on a Retina display, `capturePage` returns a 7680×4320 backing
  store (132 MB) before the resize.
- **Security:** no new attack surface. Any composition can already use WebGL; the partition blocks
  the network and every file outside the folder.
- **Effort:** 1–2 days: vendor folder, guide page, one example, and a probe.
- **Agent API:** raw HTML and JavaScript, which models write well. It is also where three.js
  tutorials and forum snippets apply directly, and the least constrained option.
- **Other downsides:** each 3D composition is a renderer process with its own GPU context, and the
  pool holds at most 8. Fonts reach the page as CSS `@font-face`, which is useless to
  `TextGeometry`, so the typeface JSON has to be converted separately. It cannot composite with a
  `.brf`'s 2D layers except as another clip.

### B. Native: a `<scene3d>` layer in `.brf`, drawn by three.js in the engine *(recommended)*

**How it works:**
1. **Authoring:** a `.brf` module returns `<scene3d …>` with `<camera>`, `<light>`, `<text3d>`,
   `<mesh>`, `<extrude path=…>` (for SVG logos), `<particles>` and `<fog>` children, among its
   usual 2D layers.
2. **The worker, unchanged in trust:** `brf-code.ts` resolves the JSX to a `Scene3DLayer` in the
   JSON document, the same way it resolves `<text>`. The worker never touches WebGL, and the
   lockdown stays as it is (plus removing `OffscreenCanvas`, from §1).
3. **Format:** `@shared/scene3d` adds the types, `parseScene3d` (errors that say how to fix the
   document, with caps; see Security) and `evaluateScene3d(layer, t)`. The evaluator is pure and
   testable in Node. It resolves `[time, value, easing]` keys with the *existing* `ease()` from
   `@shared/brf`, so a plain `.brf` JSON document with keys works as well as code does.
4. **Engine:** `evaluateBrf` emits a new `DrawOp` of kind `scene3d`. The new file `engine/three.ts`
   owns **one** `THREE.WebGLRenderer` on its own `OffscreenCanvas`, with
   `{ alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: true }`,
   matching grade's proven settings. It renders the op at the surface's device size, and
   `BrfSurfaces` does `surfaceCtx.drawImage(threeCanvas, …)` in layer order. The surface then goes
   through `#drawSource`, so grade, crop, fades and blend apply.
5. **Pending and incomplete-frame reporting:** geometry that is still loading (font bytes over
   `bay://`, a large extrusion) makes the item `pending` through `notePending`, exactly like a
   variable-font face. Export and `preview_frame` wait on `settle`, and if an export gives up
   waiting, `IncompleteFrames` names the item.

- **Why a separate context and not grade's:** `GradeContext` assumes sampler units fixed "for the
  life of the context" (`grade.ts:293`), and three.js mutates GL state freely. Sharing would need
  `renderer.resetState()` around every draw, and would still break grade's invariant. That makes
  two long-lived contexts in the renderer, well under the ~16 cap.
- **Feasibility:** high. The three.js docs list `canvas` as `HTMLCanvasElement | OffscreenCanvas`.
  The WebGL2 `OffscreenCanvas` → 2D `drawImage` path is the one grade already uses in all three
  consumers.
- **Determinism:** geometry and camera come from a pure function of `t` over validated data. The
  rules are no `Clock` and no `AnimationMixer` time; particles come from a seeded PRNG in the
  evaluator (a `seed` field); `NoToneMapping` is the default, with sRGB output. MSAA sample
  positions differ between GPUs, so pixels are identical on one machine and within about 1 LSB at
  edges across machines. That is the same class of difference as grade's.
- **Performance (estimate, to measure in the slice):**
  - Rendering about 20–50k triangles of bevelled text with one light at 1080p should take about
    1–3 ms of GPU time, with no process hop and no readback in preview. Playback therefore gets a
    true frame every frame, which removes the judder from route A.
  - Building an `ExtrudeGeometry` for about 18 glyphs with a bevel is the expensive step (an
    estimated 30–300 ms of CPU). Cache the geometry by
    `(fontHash, text, size, depth, bevel, curveSegments)`. Per-frame changes are transforms and
    uniforms only, so geometry is rebuilt only when those parameters change.
  - Memory at 4K: a 3840×2160 colour buffer is 33 MB, and depth is about 33 MB. 4× MSAA
    renderbuffers add roughly 4× on top, for about 260 MB in total. Cap the edge at 4096 like
    grade's `MAX_EDGE`, and drop to 2× MSAA above 1440p.
- **Security:** the three.js code is bay's own, bundled and signed. It is fed only validated JSON,
  so the risk moves from code execution to **resource exhaustion**. The caps are load-bearing, not
  defensive: text ≤ 200 characters, `curveSegments` ≤ 24, `bevelSegments` ≤ 8, meshes ≤ 64,
  particles ≤ 100k, and a total vertex budget checked *before* building any geometry. A GPU hang
  loses the context for the whole GPU process, so it hits grade as well.
- **Context loss:** listen for `webglcontextlost`. Mark 3D items `pending`, recreate the renderer,
  drop the geometry cache, and say so in `DrawStats` rather than drawing nothing. Test it with
  `renderer.forceContextLoss()`.
- **Bundle size:** a `WebGLRenderer` build is on the order of 600–700 KB minified (an estimate; not
  measured here). Load `engine/three.ts` with a dynamic `import()` only when a `scene3d` op first
  appears, so editor start-up is unaffected. The chunk is `'self'`, so the CSP needs no change.
- **Licence:** three.js is MIT; opentype.js is MIT.
- **Effort (estimate):** the first slice is about 1.5–2.5 weeks, including the parity probe.
  Presets come later and are just saved `.brf` modules.

**Fonts to extruded text (B's hardest part):**
- The renderer fetches the imported font's bytes over `bay://` (already admitted, and allowed by
  `connect-src`). opentype.js turns glyph outlines into `THREE.ShapePath`, which feeds
  `ExtrudeGeometry`. This is what `TTFLoader` + `FontLoader` do internally, minus the typeface-JSON
  step in between.
- opentype.js reads TTF, OTF (both glyf and CFF outlines) and WOFF, **not WOFF2** (Brotli). Either
  decompress WOFF2 in main with a small WASM or JS decoder, or refuse with "import the .ttf/.otf".
- Recent opentype.js documents a `VariationManager` for variable-font instances. Verify that the
  pinned version applies `gvar` to outlines; until then, `<text3d>` uses the font's default
  instance, and the tool should say so.
- A system family has no outlines bay can reach. Ship one OFL face (e.g. Inter or Archivo) as the
  default for `<text3d>`, and have `write_brf` refuse a family that is not imported and not the
  default, naming the fonts it could use.
- troika-three-text (flat SDF text in 3D) does not fit as it stands. It spawns `blob:` workers,
  which the CSP blocks, and it fetches a default font from a CDN, which `offline.ts` blocks. Flat
  signage in 3D can be a `<plane>` textured from a 2D `.brf` text surface instead.

**Fog over video, a trap to design for:** three.js's `Fog` blends a fragment's *colour* toward the
fog colour; it does not fade alpha. Over transparent video, "text fading into the distance" would
instead show as text turning navy. Provide `fog: { mode: 'fade' }`, which patches `fog_fragment`
through `onBeforeCompile` to also scale `gl_FragColor.a` by `1 - fogFactor`, and keep
`mode: 'tint'` for opaque scenes. Test both.

### C. Hybrid and other options

- **Pre-render to a video asset (bake):** render frames by any route and encode them with alpha.
  bay's LGPL ffmpeg would need an alpha-capable encoder confirmed by `capabilities.test.ts`
  (ProRes 4444 via `prores_ks`, or VP9 alpha if libvpx is built). A baked clip is fast to play, but
  it loses live edits and variables. Worth adding later as a "bake" action on either route, not as
  the integration itself.
- **three.js in a *trusted* bay worker** (no user code) rendering on an `OffscreenCanvas` and
  transferring `ImageBitmap`s: this frees the main thread, but makes the 3D layer asynchronous,
  with the same pending/stale machinery as compositions. Keep it in reserve if B's main-thread cost
  shows up in the frame-timing probe.
- **three.js in the `.brf` worker itself:** rejected. It hands user code the GPU, and the 3 s kill
  and cached-JSON design stop making sense.
- **Depth parallax from footage:** a monocular depth map (e.g. Depth Anything, run like the SigLIP
  worker) displaces a plane textured with the frame. This is a `<plane displacement=…>` in B, and
  a later slice.

### Scorecard

| | A: composition | **B: native `<scene3d>`** | C: bake |
|---|---|---|---|
| Works today | yes (measured) | no, about 2 weeks | no |
| Preview during playback | stale frames (judders on fly-through) | every frame | every frame |
| Export cost per frame | 40–80 ms + render | ~1–3 ms + first geometry build | decode only |
| Parity preview ↔ export | one page, but live vs exact pools differ | one engine path | exact, but frozen |
| Security change | none | JSON caps; remove `OffscreenCanvas` from the worker | none |
| Composes with 2D `.brf` layers and grade | only as another clip | inside the same surface | as a clip |
| Agent ergonomics | free-form three.js | small declarative vocabulary, JSX | n/a |

## 4. What the agent writes: "fly through 3D text 'SOC 2 in minutes'"

These are route B's `.brf` JSX. Times are in seconds, and keys use `.brf`'s existing
`[t, value, easing]` form and easing names.

```jsx
import { interpolate } from 'bay'

export const vars = { line1: 'SOC 2', line2: 'in minutes', accent: '#7CF2C4' }

export default ({ t, vars }) => (
  <scene duration={5}>
    <scene3d
      background="transparent"
      fog={{ mode: 'fade', near: 8, far: 30 }}
      camera={{
        fov: 38,
        position: [[0, [0, 0.6, 22]], [2.6, [0.8, 0.2, 5.5], 'inOutCubic'], [4.2, [0, 0, -3], 'inExpo']],
        target:   [[0, [0, 0, 0]],    [2.6, [0, 0, 0], 'inOutCubic'],     [4.2, [0, 0, -12], 'inExpo']],
        roll:     [[0, 0], [4.2, -6, 'inOutQuad']]
      }}
    >
      <light type="ambient" intensity={0.35} />
      <light type="directional" position={[4, 6, 8]} intensity={2.2} color="#ffffff" />

      <text3d font="Archivo" weight={800} size={1.8} depth={0.55}
        bevel={{ size: 0.035, thickness: 0.05, segments: 4 }} curveSegments={10}
        align="center" position={[0, 0.9, 0]}
        material={{ type: 'physical', color: '#E9EDF6', metalness: 0.55, roughness: 0.28 }}
        opacity={interpolate(t, [0, 0.5], [0, 1])}>
        {vars.line1}
      </text3d>

      <text3d font="Archivo" weight={600} size={0.9} depth={0.3}
        bevel={{ size: 0.02, thickness: 0.03, segments: 3 }}
        align="center" position={[0, -0.9, -2.5]}
        material={{ type: 'standard', color: vars.accent, emissive: vars.accent, emissiveIntensity: 0.25 }}
        in={['up', 0.6, 0.4]}>
        {vars.line2}
      </text3d>

      <particles count={1500} seed={7} spread={[14, 8, 40]} size={0.03} color="#ffffff" opacity={0.5} />
    </scene3d>
  </scene>
)
```

For frame 60 at 30 fps, the worker resolves this to plain data (abridged):

```json
{ "type": "scene3d", "background": "transparent",
  "fog": { "mode": "fade", "near": 8, "far": 30 },
  "camera": { "fov": 38, "position": [0.8, 0.2, 5.5], "target": [0, 0, 0], "roll": -4.9 },
  "lights": [{ "type": "ambient", "intensity": 0.35 },
             { "type": "directional", "position": [4, 6, 8], "intensity": 2.2, "color": "#ffffff" }],
  "nodes": [{ "type": "text3d", "text": "SOC 2", "font": "Archivo", "weight": 800, "size": 1.8,
              "depth": 0.55, "bevel": { "size": 0.035, "thickness": 0.05, "segments": 4 },
              "curveSegments": 10, "align": "center", "position": [0, 0.9, 0], "opacity": 1,
              "material": { "type": "physical", "color": "#E9EDF6", "metalness": 0.55, "roughness": 0.28 } },
            { "type": "particles", "count": 1500, "seed": 7, "spread": [14, 8, 40], "size": 0.03,
              "color": "#ffffff", "opacity": 0.5 }] }
```

Scene units are world units: 1 unit is roughly the cap height of `size={1}` text. The layer's box
in the frame is the usual `.brf` layout, so the item still moves, crops and fades on the timeline.
The geometry cache key covers the text node minus `position` and `opacity`, so the fly-through
builds geometry once.

## 5. The first slice (route B)

**Scope:**
- One `<scene3d>` layer type, with `<text3d>` (imported TTF/OTF/WOFF or the bundled default),
  one `ambient` and one `directional` light, a perspective camera with keyed `position`, `target`,
  `fov` and `roll`, `fog: fade | tint`, a transparent background, and `standard` and `physical`
  materials with colour, metalness and roughness.
- Left out of the first slice: particles, SVG extrude, shadows, textures and presets.
- Pieces:
  1. `@shared/scene3d`: types, `parseScene3d` with caps and error messages that say how to fix the
     document, and `evaluateScene3d`.
  2. `brf-code.ts`: the new primitives are resolved into the layer. The guide
     (`bay://guide/brf`) gets a 3D section, and its examples are compiled and run on every frame by
     `brf-code.test.ts`, as the existing examples are.
  3. `engine/three.ts`: one renderer, a geometry cache, font outlining, context-loss recovery, and
     a dynamic import.
  4. `BrfSurfaces` draws the op in layer order.
  5. `brf-lockdown.ts` removes `OffscreenCanvas`.

**Tests:**
1. **Pure, in `pnpm test`:**
   - Parse errors name the field and the fix.
   - Every cap is refused, *paired with the largest legal value succeeding*.
   - `evaluateScene3d` returns the keyed values exactly at key times and eased values between.
   - A fixed seed gives identical particles, and a different seed gives different ones.
   - A version-1 JSON document is spelled out as a literal, so a field rename fails the test.
2. **Lockdown:** `brf-lockdown.test.ts` asserts `OffscreenCanvas` is gone from the global and its
   prototype chain. Pair it with a check that `postMessage` of a scene still works.
3. **Render-parity probe (`test/app/scene3d-parity.mjs`):**
   - Place the sample over a solid colour clip, *deriving* the colour so that it differs from the
     text colour. Take `preview_frame` at frames 0, 45, 78 and 120, export the same range, and
     extract those frames with bay's ffmpeg.
   - Compare with per-pixel max-diff or PSNR, with a threshold set from grade's parity probe.
   - Positive control: move the camera by 0.05 units, and the diff must exceed the threshold.
     Without it, a probe that sees a blank frame "passes".
   - Also assert that pixels outside the glyphs equal the clip colour (transparency), and that
     pixels inside differ from it (something was drawn).
4. **Order independence:** render frames 0–90 forward, backward and shuffled; each frame's bytes
   must be identical. This is the same check compositions passed with 90 captures.
5. **Pending:** an export started while the font is still loading ends `complete: true`, and with
   the font forced to fail it ends `complete: false`, with the item named in `incompleteFrames`.
6. **Context loss:** call `forceContextLoss()` during playback. The next frames are pending and then
   correct again, and the grade on another clip is unaffected.
7. **Frame timing:** reuse the wall-clock picture-counting harness (count pictures, not ticks). The
   3D item must hold the project fps at 1080p in preview.
8. **4K export memory:** sample the renderer's memory at 1080p and at 2160p, and check that the
   reused surface does not grow per frame.

## 6. "Text behind subject" with 3D

This depends on the separate masking research, which produces a per-frame subject matte for a
clip. There are two levels.

1. **2D sandwich (works on day one):** the tracks run video → 3D `.brf` item → the same video, cut
   out by the matte. The whole 3D layer is either in front of the subject or behind it. That is
   enough for text that sits behind a talking head. It does *not* allow letters to pass in front of
   the subject partway through a fly-through.
2. **Subject in the scene (true depth ordering):** add `<subject clip=… depth={z}/>`, a plane at
   world depth `z`. It is textured from the compositor's decoded frame of that clip, with the matte
   as alpha, drawn with `alphaTest` (a cutout that writes depth) rather than blended transparency,
   so three.js's depth test does the ordering without transparent sorting. Letters nearer than `z`
   occlude the person; letters beyond are hidden by them.
   - Cost: the scene needs the clip's frame as a texture, which the compositor already holds as the
     element that `#drawSource` would draw. Upload it with `texImage2D`, as grade does.
   - The matte must be *pending* until ready, or export writes the subject un-cut.
   - A depth map (§3C) later turns the plane into a relief, for a more convincing parallax.

The route choice matters here too: only route B can do level 2. A composition window cannot see the
clip's frames.

## 7. Risks, ordered by how well each one hides

1. **Fog tint mistaken for fade** over video (§3B). The picture looks plausible, and wrong, only
   over footage. The parity probe must put the 3D layer over a non-black clip.
2. **Colour-management drift:** three.js's sRGB conversion versus the 2D canvas. If it drifts, the
   same `#E9EDF6` renders as slightly different colours in 3D and in 2D layers, and nobody notices
   until a brand colour is off. Add a test that compares a flat unlit plane against a 2D rect of the
   same colour.
3. **Resource exhaustion from agent-written data:** a large `curveSegments` or particle count can
   stall the editor's main thread or hang the GPU (context loss that takes grade down too). The
   caps and the vertex budget must be checked before any geometry is built.
4. **Font gaps:** WOFF2, variable instances and system families. Text silently falling back to the
   default face is the invisible failure, so report substitution first, as CLAUDE.md's
   ordering rule requires.
5. **The main-thread cost of the first geometry build** stutters playback at the clip's first
   frame. Build it ahead of time in `preroll` (the next second's clips), or fall back to the trusted
   worker (§3C).
6. **Bundle and memory:** three.js adds roughly 0.6–0.7 MB to the lazy chunk (an estimate), and 4K
   MSAA takes about 260 MB. Mitigate with the edge cap and a lower MSAA sample count.
7. **Route A misuse:** if route A is documented, agents will write `Clock`/rAF-driven scenes, which
   are not deterministic. The guide must say that `time(t)` is the only clock, and `read_composition`
   could warn on `new THREE.Clock` or `requestAnimationFrame`.

## Sources

- bay code: `src/main/html/compositions.ts`, `src/main/html/sandbox.ts`,
  `src/renderer/src/engine/{compositor,brf,brfCode,grade}.ts`, `src/shared/{brf,brf-code,brf-lockdown}.ts`,
  `src/renderer/index.html` (CSP), `src/shared/tools/write-composition.ts`, root `CLAUDE.md`.
- Probes: `scratchpad/webgl-capture-probe/{main.js,page.html,main2.js,mod.html}`, run on
  Electron 44.4.3.
- three.js `WebGLRenderer` docs (`canvas: HTMLCanvasElement | OffscreenCanvas`, `resetState`,
  `forceContextLoss`): https://threejs.org/docs/pages/WebGLRenderer.html
- three.js `TextGeometry` / `ExtrudeGeometry` / `TTFLoader` (examples/jsm):
  https://threejs.org/docs/#examples/en/geometries/TextGeometry
- three.js releases (r160 removed `build/three.js` and `three.min.js`):
  https://github.com/mrdoob/three.js/releases
- three.js licence (MIT): https://github.com/mrdoob/three.js/blob/dev/LICENSE
- opentype.js (TTF/OTF/WOFF, not WOFF2; `VariationManager`; MIT):
  https://github.com/opentypejs/opentype.js
- troika-three-text (SDF text, worker and CDN default font): https://protectwise.github.io/troika/troika-three-text/
- Electron `webContents.capturePage`: https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opt
- MDN `OffscreenCanvas` and `WEBGL_lose_context`:
  https://developer.mozilla.org/docs/Web/API/OffscreenCanvas,
  https://developer.mozilla.org/docs/Web/API/WEBGL_lose_context
- three.js bundle-size discussion (no authoritative number found, hence the estimate):
  https://discourse.threejs.org/t/bundle-size-reduction/38602
