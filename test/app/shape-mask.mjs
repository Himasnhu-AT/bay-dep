/**
 * UNRUN. Written with the feature and never executed: the wave that built shape masks and the
 * adjustment layer was not allowed to launch the app. Run it once against an isolated instance
 * (`PORT=9223 node test/app/shape-mask.mjs`) before trusting any line of it — a probe is subject
 * to the same discipline as a test (CLAUDE.md), and this one has not yet been seen to pass *or*
 * to fail. Expect to adjust tolerances on first contact with a real canvas and a real encoder.
 *
 * Do shape masks reach pixels — the same pixels in `preview_frame` and in the exported file — and
 * does an adjustment layer do to the frame what the same look does on a clip?
 *
 *   1. per shape (rect, rounded rect, ellipse, path): a pixel inside is the clip, a pixel outside
 *      is what is under it; inverted, the reverse;
 *   2. the feather: measured along a row as the distance from "fully the clip" to "none of it",
 *      against the stated width — and every sampled pixel against `masksCoverage`, the function the
 *      compositor rasterises from (imported here from `src/shared/shape-mask.ts`, as grade.mjs
 *      imports the grain hash), with a control that the wrong feather is told apart;
 *   3. the mask follows the clip: a crop leaves it on the picture, a zoom scales it;
 *   4. export: the same frame decoded from the encoded file matches `preview_frame`, inside,
 *      outside and across the ramp;
 *   5. adjustment layer: a grade (and an effect) on a layer equals the same on the single
 *      full-frame clip under it; through a mask it changes only inside; the export matches;
 *   6. the agent's surface: `edit_item.masks` and `add_adjustment_layer`, with a refusal read for
 *      its content beside a legal call.
 *
 * Makes its own specimens (red.mp4, bars.mp4) under ~/.bay-probe-media/shape-mask, or uses MEDIA.
 * Renders through `renderFrame` with a project built in the page; the MCP checks edit the open
 * project and the harness puts it back. Nothing saves.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe } from './cdp.mjs'
import { FFMPEG, H264 } from './ffmpeg.mjs'
import { masksCoverage } from '../../src/shared/shape-mask.ts'

const run = promisify(execFile)
const W = 1280
const H = 720
const BG = '#00c800'
const MEDIA = process.env.MEDIA ?? join(homedir(), '.bay-probe-media', 'shape-mask')
await mkdir(MEDIA, { recursive: true })
const specimens = [
  // Flat red: any pixel that is not red or the green background is a mix, and the mix is the coverage.
  ['red.mp4', ['-f', 'lavfi', '-i', `color=c=0xC82828:s=${W}x${H}:r=30:d=4`, ...H264, '-pix_fmt', 'yuv420p']],
  ['bars.mp4', ['-f', 'lavfi', '-i', `smptehdbars=s=${W}x${H}:r=30:d=4`, ...H264, '-pix_fmt', 'yuv420p']]
]
for (const [name, args] of specimens) {
  const out = join(MEDIA, name)
  if (!(await readFile(out).then(() => true, () => false))) await run(FFMPEG, ['-v', 'error', '-y', ...args, out])
}

const { evaluate, close } = await attach()

let failures = 0
function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures += 1
}
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v))

const HELPERS = `
  window.__sm = window.__sm || {}
  __sm.pixels = async (dataUrl) => {
    const img = new Image(); img.src = dataUrl; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height)
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    return { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data }
  }
  /** tracks: a list of item lists, bottom first; each item is { asset, ...fields }. */
  __sm.project = (tracks, extraAssets) => {
    const st = window.bayEngine.store.getState()
    const base = st.project.timelines.find((t) => t.id === st.project.activeTimelineId)
    const assets = new Map()
    const made = tracks.map((items, t) => ({ id: 'sm_v' + t, kind: 'video', name: 'V' + (t + 1), locked: false, muted: false, hidden: false,
      items: items.map((spec, i) => {
        const { asset, ...fields } = spec
        assets.set(asset.id, asset)
        return { id: 'sm_i' + t + '_' + i, assetId: asset.id, trackId: 'sm_v' + t, from: 0, durationInFrames: 90, sourceStartUs: 0,
          layout: { left: 0, top: 0, width: ${W}, height: ${H}, opacity: 1, rotation: 0 },
          volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...fields }
      }) }))
    for (const a of extraAssets ?? []) assets.set(a.id, a)
    const timeline = { ...base, width: ${W}, height: ${H}, fps: 30, background: '${BG}', transitions: [], tracks: made }
    return { ...st.project, assets: [...assets.values()], timelines: [timeline], activeTimelineId: timeline.id }
  }
  __sm.render = async (tracks, frame, extraAssets) => {
    const project = __sm.project(tracks, extraAssets)
    const r = await window.bayEngine.renderFrame({ project, timelineId: project.activeTimelineId, frame: frame ?? 30, maxSize: ${W} })
    const p = await __sm.pixels(r.dataUrl)
    return { p, pending: r.pending, placeholders: r.placeholders ?? 0, issues: r.gradeIssues ?? null }
  }
  /** RGB at each [x, y]. */
  __sm.sample = (p, points) => points.map(([x, y]) => { const o = (y * p.w + x) * 4; return [p.d[o], p.d[o + 1], p.d[o + 2]] })
  /** One row's RGB, every pixel. */
  __sm.row = (p, y) => { const out = []; for (let x = 0; x < p.w; x++) { const o = (y * p.w + x) * 4; out.push([p.d[o], p.d[o + 1], p.d[o + 2]]) } return out }
  true
`

/** How much of the red clip a pixel shows over the green background, 0..1, from its red and green channels. */
function keptOf([r, g], clip, bg) {
  const fromRed = (r - bg[0]) / (clip[0] - bg[0])
  const fromGreen = (g - bg[1]) / (clip[1] - bg[1])
  return (fromRed + fromGreen) / 2
}

await runProbe(async () => {
  await evaluate(HELPERS)
  const scratch = join(MEDIA, 'probe')
  await mkdir(scratch, { recursive: true })

  const [red, bars] = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths(${JSON.stringify([join(MEDIA, 'red.mp4'), join(MEDIA, 'bars.mp4')])})
    return im.map((e) => e.asset)
  })()`, 60_000)
  check(red?.kind === 'video' && bars?.kind === 'video' && !red.error && !bars.error, 'the specimens import as video', `${red?.error ?? ''} ${bars?.error ?? ''}`)

  const samples = (tracks, points, frame = 30) => evaluate(`(async () => {
    const r = await __sm.render(${JSON.stringify(tracks)}, ${frame})
    return { rgb: __sm.sample(r.p, ${JSON.stringify(points)}), w: r.p.w, h: r.p.h, pending: r.pending, placeholders: r.placeholders, issues: r.issues }
  })()`, 60_000)
  const rowOf = (tracks, y, frame = 30) => evaluate(`(async () => {
    const r = await __sm.render(${JSON.stringify(tracks)}, ${frame})
    return { row: __sm.row(r.p, ${y}), w: r.p.w, pending: r.pending }
  })()`, 60_000)

  // -- the colours as this machine decodes them (a derived reference, not a literal) -----------------
  const plain = await samples([[{ asset: red }]], [[640, 360]])
  // A small legal mask in a corner, sampled at the centre. The first run put the mask at x 5, y 5
  // to keep "nothing": that is outside a mask's legal range, so the clip was — correctly — a named
  // placeholder card, and every "outside" below was measured against the card's grey.
  const empty = await samples([[{ asset: red, masks: [{ kind: 'rect', x: 0.1, y: 0.1, width: 0.1, height: 0.1 }] }]], [[640, 360]])
  const CLIP = plain.rgb[0]
  const GREEN = empty.rgb[0]
  check(plain.pending === 0 && plain.w === W && CLIP[0] > 150 && CLIP[1] < 90, 'baseline: the unmasked clip is red, complete, at full size', `${CLIP} at ${plain.w}x${plain.h}`)
  check(empty.placeholders === 0 && GREEN[1] > 150 && GREEN[0] < 60, 'outside a small mask is the background, not the clip and not a placeholder', `${GREEN}, placeholders ${empty.placeholders}`)
  const kept = (rgb) => keptOf(rgb, CLIP, GREEN)

  // -- 1. inside and outside, per shape ---------------------------------------------------------
  const shapes = [
    { label: 'rect', mask: { kind: 'rect', x: 0.25, y: 0.5, width: 0.25, height: 0.5 }, inside: [320, 360], outside: [800, 360] },
    // Just inside the sharp corner of the same box: outside once the corner is rounded.
    { label: 'rounded rect', mask: { kind: 'rect', x: 0.25, y: 0.5, width: 0.25, height: 0.5, radius: 1 }, inside: [320, 360], outside: [166, 186] },
    { label: 'ellipse', mask: { kind: 'ellipse', x: 0.75, y: 0.5, width: 0.25, height: 0.6 }, inside: [960, 360], outside: [810, 160] },
    { label: 'path', mask: { kind: 'path', x: 0.5, y: 0.5, width: 0.5, height: 0.8, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, inside: [400, 560], outside: [880, 160] }
  ]
  for (const { label, mask, inside, outside } of shapes) {
    const a = await samples([[{ asset: red, masks: [mask] }]], [inside, outside])
    check(a.pending === 0 && a.placeholders === 0 && kept(a.rgb[0]) > 0.97 && kept(a.rgb[1]) < 0.03, `${label}: inside is the clip, outside the background`,
      `inside ${f2(kept(a.rgb[0]))}, outside ${f2(kept(a.rgb[1]))}`)
    const b = await samples([[{ asset: red, masks: [{ ...mask, invert: true }] }]], [inside, outside])
    check(kept(b.rgb[0]) < 0.03 && kept(b.rgb[1]) > 0.97, `${label} inverted: the reverse`, `inside ${f2(kept(b.rgb[0]))}, outside ${f2(kept(b.rgb[1]))}`)
  }
  // The rounded corner is a real difference from the square one: the control for the pair above.
  const sharp = await samples([[{ asset: red, masks: [{ kind: 'rect', x: 0.25, y: 0.5, width: 0.25, height: 0.5 }] }]], [[166, 186]])
  check(kept(sharp.rgb[0]) > 0.97, 'control: with square corners that corner pixel is inside', f2(kept(sharp.rgb[0])))

  // An effected clip must still be masked: the effect stack draws in the slot before the mask, and
  // a version of that slot that drew its result straight to the canvas would skip the mask.
  const FLIP = [{ id: 'fx_probe', kind: 'flip', params: { horizontal: true, vertical: false } }]
  const fx = await samples([[{ asset: red, effects: FLIP, masks: [shapes[0].mask] }]], [shapes[0].inside, shapes[0].outside])
  check(fx.pending === 0 && !fx.issues && kept(fx.rgb[0]) > 0.97 && kept(fx.rgb[1]) < 0.03, 'a clip with an effect and a mask is masked',
    `inside ${f2(kept(fx.rgb[0]))}, outside ${f2(kept(fx.rgb[1]))}, issues ${JSON.stringify(fx.issues)}`)
  const gr = await samples([[{ asset: red, grade: { gain: { r: 0, g: 0.2, b: 0 } }, masks: [shapes[0].mask] }]], [shapes[0].outside])
  check(kept(gr.rgb[0]) < 0.03, 'a graded clip with a mask is masked', f2(kept(gr.rgb[0])))

  // -- combine modes on two overlapping rectangles ------------------------------------------------
  const A = { kind: 'rect', x: 0.3, y: 0.5, width: 0.3, height: 0.5 }      // x 192..576
  const B = { kind: 'rect', x: 0.45, y: 0.5, width: 0.3, height: 0.5 }     // x 384..768
  const pts = [[288, 360], [480, 360], [672, 360], [1000, 360]]            // only A, both, only B, neither
  for (const [mode, want] of [['add', [1, 1, 1, 0]], ['subtract', [1, 0, 0, 0]], ['intersect', [0, 1, 0, 0]]]) {
    const r = await samples([[{ asset: red, masks: [A, { ...B, combine: mode }] }]], pts)
    const got = r.rgb.map((c) => Math.round(kept(c)))
    check(JSON.stringify(got) === JSON.stringify(want), `combine ${mode}: only-A, both, only-B, neither`, `${got} (want ${want})`)
  }

  // -- 2. the feather, measured ------------------------------------------------------------------
  // A rectangle running off the left, top and bottom: the only edge in the frame is its right one, at x = 640.
  for (const feather of [40, 120]) {
    const mask = { kind: 'rect', x: 0, y: 0.5, width: 1, height: 4, feather }
    const { row } = await rowOf([[{ asset: red, masks: [mask] }]], 360)
    const k = row.map(kept)
    const firstSoft = k.findIndex((v) => v < 0.985)
    const firstGone = k.findIndex((v) => v < 0.015)
    const width = firstGone - firstSoft
    let rises = 0
    for (let x = 1; x < k.length; x++) if (k[x] > k[x - 1] + 0.02) rises += 1
    // The smoothstep's last 1.5% at each end is a few pixels of a wide ramp: the measured width is
    // a little under the stated one, by an amount that grows with it.
    check(Math.abs(width - feather) <= Math.max(4, feather * 0.2), `feather ${feather}px: the ramp measures about that wide`, `${width}px, from x=${firstSoft} to x=${firstGone}`)
    check(Math.abs((firstSoft + firstGone) / 2 - 640) <= 3, `feather ${feather}px: centred on the edge`, `centre ${(firstSoft + firstGone) / 2}`)
    check(rises === 0, `feather ${feather}px: never rises on the way out`, `${rises} rises`)
    // Every pixel of the ramp against the function the compositor rasterises from.
    let within = 0
    let total = 0
    let wrongModel = 0
    for (let x = 640 - feather; x <= 640 + feather; x += 2) {
      total += 1
      if (Math.abs(k[x] - masksCoverage([mask], x + 0.5, 360.5, { width: W, height: H }, 1)) <= 0.03) within += 1
      if (Math.abs(k[x] - masksCoverage([{ ...mask, feather: feather * 2 }], x + 0.5, 360.5, { width: W, height: H }, 1)) <= 0.03) wrongModel += 1
    }
    check(within / total > 0.97, `feather ${feather}px: the ramp is masksCoverage, pixel for pixel (±0.03)`, `${within}/${total}`)
    check(wrongModel / total < 0.7, `instrument control: twice the feather is told apart`, `${wrongModel}/${total} would have matched`)
  }
  const hard = await rowOf([[{ asset: red, masks: [{ kind: 'rect', x: 0, y: 0.5, width: 1, height: 4 }] }]], 360)
  const hk = hard.row.map(kept)
  check(hk[637] > 0.97 && hk[642] < 0.03, 'no feather: the edge is hard (a pixel or two of antialiasing)', `${f2(hk[637])} … ${f2(hk[642])}`)

  // -- 3. the mask follows the clip ---------------------------------------------------------------
  const centre = { kind: 'ellipse', x: 0.5, y: 0.5, width: 0.4, height: 0.4 }   // 512 × 288 about (640, 360)
  const cropped = await samples([[{ asset: red, masks: [centre], crop: { left: 0.5, top: 0, right: 0, bottom: 0 } }]], [[600, 360], [700, 360], [1000, 360]])
  check(kept(cropped.rgb[0]) < 0.03 && kept(cropped.rgb[1]) > 0.97 && kept(cropped.rgb[2]) < 0.03,
    'a 50% left crop removes the left of the mask and leaves the right where it was', cropped.rgb.map((c) => f2(kept(c))).join(' '))
  const zoomed = await samples([[{ asset: red, masks: [centre], layout: { left: 0, top: 0, width: W, height: H, opacity: 1, rotation: 0, scale: 2 } }]], [[200, 360], [100, 360]])
  const unzoomed = await samples([[{ asset: red, masks: [centre] }]], [[200, 360]])
  // Zoomed ×2 the ellipse is 1024 px wide: x 128..1152.
  check(kept(unzoomed.rgb[0]) < 0.03 && kept(zoomed.rgb[0]) > 0.97 && kept(zoomed.rgb[1]) < 0.03, 'layout.scale 2 scales the mask with the picture',
    `x=200 unzoomed ${f2(kept(unzoomed.rgb[0]))}, zoomed ${f2(kept(zoomed.rgb[0]))}; x=100 zoomed ${f2(kept(zoomed.rgb[1]))}`)
  const moved = await samples([[{ asset: red, masks: [centre], layout: { left: 640, top: 360, width: 640, height: 360, opacity: 1, rotation: 0 } }]], [[960, 540], [640, 360], [1200, 540]])
  check(kept(moved.rgb[0]) > 0.97 && kept(moved.rgb[1]) < 0.03 && kept(moved.rgb[2]) < 0.03, 'a clip moved and halved carries its mask: same part of the clip',
    moved.rgb.map((c) => f2(kept(c))).join(' '))

  // -- 4. export vs preview_frame ------------------------------------------------------------------
  const outDir = join(homedir(), 'Movies', 'bay')
  await mkdir(outDir, { recursive: true })
  const exportFrame = async (tracks, name) => {
    const outputPath = join(outDir, `${name}-${Date.now()}.mp4`)
    const outcome = await evaluate(`(async () => {
      const project = __sm.project(${JSON.stringify(tracks)})
      const job = await window.bay.export.start({ project, timelineId: project.activeTimelineId, format: 'mp4',
        outputPath: ${JSON.stringify(outputPath)}, width: ${W}, height: ${H}, fromFrame: 0, toFrame: 59 })
      return await new window.bayEngine.FrameExporter({ project, timelineId: project.activeTimelineId,
        jobId: job.jobId, width: ${W}, height: ${H}, fromFrame: 0, toFrame: 59 }).run()
    })()`, 180_000)
    await new Promise((r) => setTimeout(r, 2500))
    const raw = join(scratch, `${name}.rgb`)
    // zscale, not swscale: this build's swscale reads limited-range Y as full range (a −2 bias).
    await run(FFMPEG, ['-v', 'error', '-i', outputPath, '-vf', 'select=eq(n\\,30),zscale=min=709:rin=limited:m=709:r=full,format=rgb24', '-vsync', '0', '-frames:v', '1',
      '-f', 'rawvideo', '-s', `${W}x${H}`, '-y', raw])
    const bytes = await readFile(raw)
    await rm(outputPath, { force: true })
    return { outcome, at: (x, y) => { const o = (y * W + x) * 3; return [bytes[o], bytes[o + 1], bytes[o + 2]] } }
  }
  const soft = { kind: 'ellipse', x: 0.5, y: 0.5, width: 0.5, height: 0.6, feather: 80 }
  const maskedTracks = [[{ asset: red, masks: [soft] }]]
  // Along the middle row, from the centre out through the ramp to the background, every 16 px.
  const walk = Array.from({ length: 38 }, (_, i) => [640 + i * 16, 360])
  const previewWalk = await samples(maskedTracks, walk)
  const exported = await exportFrame(maskedTracks, 'shape-mask-probe')
  console.log('export         ', JSON.stringify(exported.outcome))
  let worst = 0
  let ramp = 0
  walk.forEach(([x, y], i) => {
    const p = kept(previewWalk.rgb[i])
    const e = kept(exported.at(x, y))
    worst = Math.max(worst, Math.abs(p - e))
    if (p > 0.05 && p < 0.95) ramp += 1
  })
  check(ramp >= 3, 'the walk crosses the soft edge (or the comparison only saw 0 and 1)', `${ramp} ramp samples`)
  check(worst <= 0.04, 'the exported frame shows the same amount of the clip as preview_frame, inside, outside and across the ramp', `worst difference ${f2(worst)}`)
  const unmaskedExport = kept(exported.at(1200, 360))
  check(unmaskedExport < 0.03, 'comparison control: outside the mask the export is the background, not the clip', f2(unmaskedExport))

  // -- 5. the adjustment layer --------------------------------------------------------------------
  const layerAsset = { id: 'sm_adj', kind: 'adjustment', name: 'Adjustment layer', path: null, durationUs: 0, width: null, height: null, fps: null,
    hasAudio: false, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0 }
  const GRADE = { saturation: 0, gain: { r: 0.15, g: 0, b: 0 } }
  const grid = []
  for (let y = 40; y < H; y += 80) for (let x = 40; x < W; x += 80) grid.push([x, y])
  const direct = await samples([[{ asset: bars, grade: GRADE }]], grid)
  const through = await samples([[{ asset: bars }], [{ asset: layerAsset, grade: GRADE }]], grid)
  const ungraded = await samples([[{ asset: bars }]], grid)
  const maxDiff = (a, b) => Math.max(...a.rgb.map((c, i) => Math.max(...c.map((v, ch) => Math.abs(v - b.rgb[i][ch])))))
  check(through.pending === 0 && !through.issues && !direct.issues, 'the layered frame is complete, with no grade issue', JSON.stringify(through.issues))
  check(maxDiff(direct, through) <= 2, 'a grade on an adjustment layer equals the same grade on the full-frame clip under it (±2 per channel)', `worst ${maxDiff(direct, through)}`)
  check(maxDiff(ungraded, through) > 20, 'comparison control: the ungraded frame is a different picture', `worst ${maxDiff(ungraded, through)}`)

  const adjustments = { brightness: 0.5 }
  const dimDirect = await samples([[{ asset: bars, adjustments }]], grid)
  const dimThrough = await samples([[{ asset: bars }], [{ asset: layerAsset, adjustments }]], grid)
  check(maxDiff(dimDirect, dimThrough) <= 2, 'adjustments on a layer equal adjustments on the clip (±2)', `worst ${maxDiff(dimDirect, dimThrough)}`)

  // An effect on a layer reaches what is under it: a horizontal flip of the bars is the bars flipped.
  const FLIPPED = [{ id: 'fx_probe', kind: 'flip', params: { horizontal: true, vertical: false } }]
  const flipDirect = await samples([[{ asset: bars, effects: FLIPPED }]], grid)
  const flipThrough = await samples([[{ asset: bars }], [{ asset: layerAsset, effects: FLIPPED }]], grid)
  check(!flipThrough.issues && maxDiff(flipDirect, flipThrough) <= 2 && maxDiff(ungraded, flipThrough) > 20,
    'an effect on an adjustment layer equals the effect on the clip under it (±2), and is not the unflipped frame',
    `direct-vs-layer worst ${maxDiff(flipDirect, flipThrough)}, plain-vs-layer worst ${maxDiff(ungraded, flipThrough)}, issues ${JSON.stringify(flipThrough.issues)}`)

  // Through a mask: graded inside, untouched outside.
  const window_ = { kind: 'rect', x: 0.25, y: 0.5, width: 0.5, height: 1 }   // the left half
  const leftPts = grid.filter(([x]) => x < 600)
  const rightPts = grid.filter(([x]) => x > 680)
  const halfL = await samples([[{ asset: bars }], [{ asset: layerAsset, grade: GRADE, masks: [window_] }]], leftPts)
  const halfR = await samples([[{ asset: bars }], [{ asset: layerAsset, grade: GRADE, masks: [window_] }]], rightPts)
  const directL = await samples([[{ asset: bars, grade: GRADE }]], leftPts)
  const plainR = await samples([[{ asset: bars }]], rightPts)
  check(maxDiff(halfL, directL) <= 2 && maxDiff(halfR, plainR) <= 2, 'through a mask the layer grades inside it and leaves the rest exactly as it was',
    `inside worst ${maxDiff(halfL, directL)}, outside worst ${maxDiff(halfR, plainR)}`)

  // Above the layer nothing changes; and a layer with no look is byte-identical to none.
  const above = await samples([[{ asset: bars }], [{ asset: layerAsset, grade: GRADE }], [{ asset: red, layout: { left: 0, top: 0, width: 320, height: 180, opacity: 1, rotation: 0 } }]], [[160, 90]])
  check(Math.abs(above.rgb[0][0] - CLIP[0]) <= 2 && Math.abs(above.rgb[0][1] - CLIP[1]) <= 2, 'a clip above the layer is not changed by it', `${above.rgb[0]} against ${CLIP}`)
  const identical = await evaluate(`(async () => {
    const a = await window.bayEngine.renderFrame({ ...(() => { const project = __sm.project(${JSON.stringify([[{ asset: bars }]])}); return { project, timelineId: project.activeTimelineId } })(), frame: 30, maxSize: 640 })
    const b = await window.bayEngine.renderFrame({ ...(() => { const project = __sm.project(${JSON.stringify([[{ asset: bars }], [{ asset: layerAsset }]])}); return { project, timelineId: project.activeTimelineId } })(), frame: 30, maxSize: 640 })
    const c = await window.bayEngine.renderFrame({ ...(() => { const project = __sm.project(${JSON.stringify([[{ asset: bars }], [{ asset: layerAsset, adjustments: { brightness: 0.99 } }]])}); return { project, timelineId: project.activeTimelineId } })(), frame: 30, maxSize: 640 })
    return { same: a.dataUrl === b.dataUrl, controlDiffers: a.dataUrl !== c.dataUrl }
  })()`, 60_000)
  check(identical.same && identical.controlDiffers, 'a layer with no look is byte-identical to no layer (and a 1% look is not)', JSON.stringify(identical))

  // Export of the layered timeline against its preview_frame.
  const layerTracks = [[{ asset: bars }], [{ asset: layerAsset, grade: GRADE, masks: [window_] }]]
  const layerPreview = await samples(layerTracks, grid)
  const layerExport = await exportFrame(layerTracks, 'adjustment-layer-probe')
  let layerWorst = 0
  grid.forEach(([x, y], i) => {
    // Bars are flat patches, but a sample 40 px from a patch edge can still catch 4:2:0 chroma bleed.
    for (let ch = 0; ch < 3; ch++) layerWorst = Math.max(layerWorst, Math.abs(layerPreview.rgb[i][ch] - layerExport.at(x, y)[ch]))
  })
  check(layerWorst <= 6, 'the exported frame of a masked, graded layer matches preview_frame (±6 per channel, through the encoder)', `worst ${layerWorst}`)

  // -- 6. the agent's surface -----------------------------------------------------------------------
  const mcp = (tool, args) => evaluate(`window.bayMcp.execute({ id: 'sm-' + Math.random(), tool: ${JSON.stringify(tool)}, args: ${JSON.stringify(args)} })`, 60_000)
  const imp = await mcp('import_media', { paths: [join(MEDIA, 'red.mp4')] })
  const placed = await mcp('place_asset', { assetId: imp.value?.assets?.[0]?.id, atFrame: 0 })
  check(placed.ok, 'positive control: place_asset of the red clip succeeds', placed.error)
  const itemId = placed.value?.itemId
  const edited = await mcp('edit_item', { itemId, masks: [{ kind: 'ellipse', x: 0.5, y: 0.5, width: 0.6, height: 0.8, feather: 60 }] })
  check(edited.ok && edited.value.masks?.[0]?.kind === 'ellipse' && edited.value.masks[0].feather === 60, 'edit_item sets masks and returns them', edited.error ?? JSON.stringify(edited.value?.masks))
  const inspected = await mcp('inspect_item', { itemId })
  check(inspected.ok && inspected.value.masks?.length === 1, 'inspect_item reads the masks back', JSON.stringify(inspected.value?.masks))
  const bad = await mcp('edit_item', { itemId, masks: [{ kind: 'ellipse', x: 0.5, y: 0.5, width: 0.6, height: 0.8, feather: 5000 }] })
  check(!bad.ok && /masks\[0\]\.feather must be a number of timeline pixels from 0 to 1000.*got 5000/.test(bad.error ?? ''), 'a bad mask is refused naming the field and its range', bad.error)
  const shot = await mcp('preview_frame', { frame: 5 })
  check(shot.ok && !shot.value.incomplete, 'preview_frame of the masked clip is complete', JSON.stringify(shot.value?.incomplete ?? null))
  const layer = await mcp('add_adjustment_layer', { from: 0, durationInFrames: 60 })
  check(layer.ok && layer.value.clipsBelow >= 1 && /edit_item/.test(layer.value.next ?? ''), 'add_adjustment_layer adds a layer over the clip and says what to do next', layer.error ?? JSON.stringify(layer.value))
  const look = await mcp('edit_item', { itemId: layer.value?.itemId, grade: { saturation: 0 } })
  check(look.ok && look.value.grade?.saturation === 0, 'the layer takes a grade from edit_item', look.error)
  const moveIt = await mcp('edit_item', { itemId: layer.value?.itemId, left: 100 })
  check(!moveIt.ok && /is an adjustment layer.*left does nothing on it/.test(moveIt.error ?? ''), 'a field a layer does not read is refused, with what to use instead', moveIt.error)
  // The grey of a desaturated red, through the layer, in the real preview path.
  const grey = await mcp('preview_frame', { frame: 5 })
  check(grey.ok && !grey.value.gradeWarnings, 'preview_frame of the layered timeline reports no grade warnings', JSON.stringify(grey.value?.gradeWarnings ?? null))

  await rm(scratch, { recursive: true, force: true })
  console.log(`\n${failures === 0 ? 'PASS' : `FAIL  ${failures} check(s)`}`)
  close()
  return failures === 0
})
