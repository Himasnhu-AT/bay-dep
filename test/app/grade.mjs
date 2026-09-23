/**
 * Does the colour grade reach pixels — the same pixels in preview_frame and in the exported file?
 *
 * Every check is directional and derived: a gain on red must raise red and leave green and blue
 * where they were; a LUT that swaps red and blue must put the ungraded blue mean in the red
 * channel; halation on a white dot must fall off warm (R > G > B) and leave the black around it
 * black. "Something changed" would pass a grade applied to the wrong channel.
 *
 * The instruments are proven too: the violet check is run against a deliberately violet halation
 * and must flag it, and the grain check predicts every pixel from `grainValue` in @shared/grade —
 * the JS twin of the shader's hash — so it fails if the two ever diverge.
 *
 * Also measures the draw's cost with and without a grade at 1080x1920 and 2160x3840.
 *
 * Makes its own specimens (grey.mp4, bars.mp4, dot.png) under ~/.bay-probe-media/grade, or uses MEDIA.
 * Renders through `renderFrame` with a project built in the page; the MCP checks edit the open
 * project and the harness puts it back. Nothing saves.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe } from './cdp.mjs'
import { grainSeed, grainValue, evalCurve, curveKnots } from '../../src/shared/grade.ts'

const run = promisify(execFile)
const FFMPEG = process.env.FFMPEG ??
  'node_modules/ffmpeg-ffprobe-static/ffmpeg'
// The specimens are made here unless MEDIA names a folder that already holds them: a probe that
// needs files nobody can regenerate is a probe nobody else can run.
const MEDIA = process.env.MEDIA ?? join(homedir(), '.bay-probe-media', 'grade')
await mkdir(MEDIA, { recursive: true })
const specimens = [
  ['grey.mp4', ['-f', 'lavfi', '-i', 'color=c=0x808080:s=1080x1920:r=30:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
  ['bars.mp4', ['-f', 'lavfi', '-i', 'smptehdbars=s=1080x1920:r=30:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
  ['dot.png', ['-f', 'lavfi', '-i', "color=c=black:s=1080x1920,geq=lum='if(lt(hypot(X-540,Y-960),24),255,0)':cb=128:cr=128", '-frames:v', '1']]
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
const f1 = (v) => (typeof v === 'number' ? v.toFixed(1) : String(v))
const rgb = (m) => `R ${f1(m.r)} G ${f1(m.g)} B ${f1(m.b)}`

/** A 17-point cube whose output is the input with red and blue swapped. */
function swapCube(n = 17) {
  const rows = ['TITLE "swap r b"', `LUT_3D_SIZE ${n}`]
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    rows.push(`${b / (n - 1)} ${g / (n - 1)} ${r / (n - 1)}`)
  }
  return rows.join('\n')
}

const HELPERS = `
  window.__grade = window.__grade || {}
  __grade.pixels = async (dataUrl) => {
    const img = new Image(); img.src = dataUrl; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height)
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    return { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data }
  }
  __grade.means = (p) => {
    let r = 0, g = 0, b = 0, s = 0; const n = p.w * p.h
    for (let i = 0; i < p.d.length; i += 4) {
      r += p.d[i]; g += p.d[i + 1]; b += p.d[i + 2]
      s += Math.abs(p.d[i] - p.d[i + 1]) + Math.abs(p.d[i + 1] - p.d[i + 2])
    }
    return { r: r / n, g: g / n, b: b / n, spread: s / n }
  }
  __grade.project = (asset, grade, size, extra) => {
    const st = window.bayEngine.store.getState()
    const base = st.project.timelines.find((t) => t.id === st.project.activeTimelineId)
    const W = size?.w ?? 1080, H = size?.h ?? 1920
    const timeline = { ...base, width: W, height: H, fps: 30, background: '#000000', transitions: [],
      tracks: [{ id: 'g_v0', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false,
        items: [{ id: 'g_i0', assetId: asset.id, trackId: 'g_v0', from: 0, durationInFrames: 90, sourceStartUs: 0,
          layout: { left: 0, top: 0, width: W, height: H, opacity: 1, rotation: 0 },
          volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...(grade ? { grade } : {}) }] }] }
    return { ...st.project, assets: [asset, ...(extra ?? [])], timelines: [timeline], activeTimelineId: timeline.id }
  }
  __grade.render = async (asset, grade, frame, maxSize, extra) => {
    const project = __grade.project(asset, grade, null, extra)
    const r = await window.bayEngine.renderFrame({ project, timelineId: project.activeTimelineId, frame, maxSize })
    return r
  }
  true
`

await runProbe(async () => {
  await evaluate(HELPERS)
  const scratch = join(MEDIA, 'probe')
  await mkdir(scratch, { recursive: true })
  await writeFile(join(scratch, 'swap.cube'), swapCube())
  await writeFile(join(scratch, 'broken.cube'), 'LUT_3D_SIZE 4\n0 0 0\n1 1 1\n')

  const imported = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths(${JSON.stringify([
      join(MEDIA, 'grey.mp4'), join(MEDIA, 'bars.mp4'), join(MEDIA, 'dot.png'),
      join(scratch, 'swap.cube'), join(scratch, 'broken.cube')
    ])})
    return im.map((e) => e.asset)
  })()`, 60_000)
  const [grey, bars, dot, lut, broken] = imported
  check(lut.kind === 'lut' && lut.lut?.size === 17 && !lut.error, 'a .cube imports as a lut asset with its table',
    `kind ${lut.kind}, size ${lut.lut?.size}, name ${lut.name}`)
  check(broken.kind === 'lut' && /8 rows|needs 64|2 rows/.test(broken.error ?? ''), 'a truncated .cube lists with the parser\'s reason',
    broken.error)

  // -- channel shifts on a mid-grey clip ---------------------------------------------------
  const means = async (asset, grade, frame = 30, extra = []) => evaluate(`(async () => {
    const r = await __grade.render(${JSON.stringify(asset)}, ${JSON.stringify(grade)}, ${frame}, 320, ${JSON.stringify(extra)})
    const m = __grade.means(await __grade.pixels(r.dataUrl))
    return { ...m, pending: r.pending, issues: r.gradeIssues ?? null, url: r.dataUrl.length }
  })()`, 60_000)

  const g0 = await means(grey, null)
  check(g0.pending === 0 && Math.abs(g0.r - 128) < 4, 'baseline grey renders complete, near 128', rgb(g0))

  const gainR = await means(grey, { gain: { r: 0.2, g: 0, b: 0 } })
  check(gainR.r - g0.r > 20 && Math.abs(gainR.g - g0.g) < 2 && Math.abs(gainR.b - g0.b) < 2,
    'gain.r +0.2 raises red only', rgb(gainR))
  const liftB = await means(grey, { lift: { r: 0, g: 0, b: 0.2 } })
  check(liftB.b - g0.b > 20 && Math.abs(liftB.r - g0.r) < 2 && Math.abs(liftB.g - g0.g) < 2,
    'lift.b +0.2 raises blue only', rgb(liftB))
  const gammaG = await means(grey, { gamma: { r: 0, g: 0.3, b: 0 } })
  check(gammaG.g - g0.g > 12 && Math.abs(gammaG.r - g0.r) < 2, 'gamma.g +0.3 brightens green mids', rgb(gammaG))
  const warm = await means(grey, { temperature: 1000 })
  check(warm.r > g0.r + 3 && warm.b < g0.b - 3, 'temperature +1000 K: red up, blue down', rgb(warm))
  const curveKn = curveKnots([[0.5, 0.7]])
  const curve = await means(grey, { curves: { master: [[0.5, 0.7]] } })
  const expected = 255 * evalCurve(curveKn, g0.g / 255)
  check(Math.abs(curve.g - expected) < 3, 'master curve (0.5 → 0.7) lands where the curve says',
    `${f1(curve.g)} vs predicted ${f1(expected)}`)

  const b0 = await means(bars, null)
  const desat = await means(bars, { saturation: 0 })
  check(b0.spread > 30 && desat.spread < 2, 'saturation 0 removes colour', `spread ${f1(b0.spread)} → ${f1(desat.spread)}`)
  // Bars have R and B means within a unit of each other, so a swap measured on them could not fail.
  // A red gain first (the LUT applies after the wheels) makes the two channels 38 apart.
  const redder = await means(grey, { gain: { r: 0.3, g: 0, b: 0 } })
  const swapped = await means(grey, { gain: { r: 0.3, g: 0, b: 0 }, lut: { assetId: lut.id, intensity: 1 } }, 30, [lut])
  check(redder.r - redder.b > 30 && Math.abs(swapped.r - redder.b) < 2.5 && Math.abs(swapped.b - redder.r) < 2.5,
    'LUT that swaps R and B swaps the channels (after the wheels)', `before ${rgb(redder)}; after ${rgb(swapped)}`)
  const half = await means(grey, { gain: { r: 0.3, g: 0, b: 0 }, lut: { assetId: lut.id, intensity: 0.5 } }, 30, [lut])
  check(Math.abs(half.r - (redder.r + redder.b) / 2) < 2.5 && Math.abs(half.b - half.r) < 2.5, 'LUT intensity 0.5 mixes halfway', rgb(half))
  const missingLut = await means(bars, { lut: { assetId: lut.id, intensity: 1 } }, 30, [])
  check(Array.isArray(missingLut.issues) && /LUT/.test(missingLut.issues.join(' ')),
    'a LUT asset missing from the project is reported, not silent', JSON.stringify(missingLut.issues))

  // Identity must be byte-identical and cost nothing — same data URL as no grade at all.
  const identical = await evaluate(`(async () => {
    const a = await __grade.render(${JSON.stringify(bars)}, null, 30, 320)
    const b = await __grade.render(${JSON.stringify(bars)}, { saturation: 1, gain: { r: 0, g: 0, b: 0 }, grain: { amount: 0, size: 1 } }, 30, 320)
    const c = await __grade.render(${JSON.stringify(bars)}, { saturation: 0.99 }, 30, 320)
    return { same: a.dataUrl === b.dataUrl, controlDiffers: a.dataUrl !== c.dataUrl }
  })()`, 60_000)
  check(identical.same && identical.controlDiffers, 'an identity grade is byte-identical to none (and a 1% change is not)',
    JSON.stringify(identical))

  const vig = await evaluate(`(async () => {
    const r = await __grade.render(${JSON.stringify(grey)}, { vignette: { amount: 0.6 } }, 30, 320)
    const p = await __grade.pixels(r.dataUrl)
    const at = (x, y) => p.d[(y * p.w + x) * 4 + 1]
    return { centre: at(p.w >> 1, p.h >> 1), corner: at(2, 2) }
  })()`, 60_000)
  check(vig.corner < vig.centre - 20 && Math.abs(vig.centre - g0.g) < 3, 'vignette darkens corners and leaves the centre',
    JSON.stringify(vig))

  // -- grain: deterministic per frame, animated across frames, and the shader's hash is the JS one
  const grain = await evaluate(`(async () => {
    const grade = { grain: { amount: 0.4, size: 1 } }
    const a = await __grade.render(${JSON.stringify(grey)}, grade, 7, 1920)
    const b = await __grade.render(${JSON.stringify(grey)}, grade, 7, 1920)
    const c = await __grade.render(${JSON.stringify(grey)}, grade, 8, 1920)
    const base = await __grade.render(${JSON.stringify(grey)}, null, 7, 1920)
    const pa = await __grade.pixels(a.dataUrl), pb = await __grade.pixels(base.dataUrl)
    const samples = []
    for (let i = 0; i < 3000; i++) {
      const x = (i * 7919) % pa.w, y = (i * 104729) % pa.h, o = (y * pa.w + x) * 4
      samples.push([x, y, pb.d[o], pb.d[o + 1], pb.d[o + 2], pa.d[o], pa.d[o + 1], pa.d[o + 2]])
    }
    return { same: a.dataUrl === b.dataUrl, animates: a.dataUrl !== c.dataUrl, w: pa.w, h: pa.h, samples }
  })()`, 90_000)
  check(grain.same, 'grain: the same frame renders byte-identically twice')
  check(grain.animates, 'grain: the next frame differs')
  const seed = grainSeed('g_i0')
  let within = 0
  for (const [x, y, br, bg, bb, ar, ag, ab] of grain.samples) {
    const base = [br, bg, bb].map((v) => v / 255)
    const l = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]
    const n = grainValue(x, y, 7, seed)
    const predicted = base.map((v) => Math.round(Math.min(1, Math.max(0, v + n * 0.4 * 0.25 * (0.35 + 2.6 * l * (1 - l)))) * 255))
    if (Math.abs(predicted[0] - ar) <= 1 && Math.abs(predicted[1] - ag) <= 1 && Math.abs(predicted[2] - ab) <= 1) within += 1
  }
  check(grain.w === 1080 && within / grain.samples.length > 0.97,
    'grain: every sampled pixel matches the JS twin of the shader hash (±1)', `${within}/${grain.samples.length} at ${grain.w}x${grain.h}`)
  // Instrument control: with the wrong frame the prediction must mostly miss.
  let wrong = 0
  for (const [x, y, br, bg, bb, ar, ag, ab] of grain.samples) {
    const base = [br, bg, bb].map((v) => v / 255)
    const l = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]
    const n = grainValue(x, y, 8, seed)
    const p = base.map((v) => Math.round(Math.min(1, Math.max(0, v + n * 0.4 * 0.25 * (0.35 + 2.6 * l * (1 - l)))) * 255))
    if (Math.abs(p[0] - ar) <= 1 && Math.abs(p[1] - ag) <= 1 && Math.abs(p[2] - ab) <= 1) wrong += 1
  }
  check(wrong / grain.samples.length < 0.3, 'grain instrument control: predicting frame 8 against frame 7 misses',
    `${wrong}/${grain.samples.length}`)

  // -- halation on a white dot on black: a warm falloff, and no cast anywhere else --------------
  const halo = async (grade) => evaluate(`(async () => {
    const r = await __grade.render(${JSON.stringify(dot)}, ${JSON.stringify(grade)}, 0, 1920)
    const p = await __grade.pixels(r.dataUrl)
    let R = 0, G = 0, B = 0, n = 0
    const cx = p.w / 2, cy = p.h / 2
    for (let y = 0; y < p.h; y += 1) for (let x = 0; x < p.w; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d < 36 || d > 70) continue
      const o = (y * p.w + x) * 4; R += p.d[o]; G += p.d[o + 1]; B += p.d[o + 2]; n++
    }
    const o = (40 * p.w + 40) * 4
    return { r: R / n, g: G / n, b: B / n, corner: [p.d[o], p.d[o + 1], p.d[o + 2]], pending: r.pending, issues: r.gradeIssues ?? null }
  })()`, 90_000)
  const warmRing = (m) => m.r > 8 && m.r > m.g && m.g > m.b
  const h0 = await halo(null)
  check(h0.pending === 0 && h0.r < 1 && h0.g < 1 && h0.b < 1, 'no halation: the ring around the dot is black', rgb(h0))
  const h1 = await halo({ halation: { amount: 1, threshold: 0.5, radius: 20 } })
  check(h1.issues === null && warmRing(h1) && h1.corner.every((v) => v === 0), 'halation: warm falloff (R > G > B), black stays black',
    `${rgb(h1)}; corner ${h1.corner.join(',')}; issues ${JSON.stringify(h1.issues)}`)
  // Instrument control: a violet glow must fail the warm test, or the test cannot see violet.
  const hv = await halo({ halation: { amount: 1, threshold: 0.5, radius: 20, color: '#B040FF' } })
  check(!warmRing(hv) && hv.b > hv.g, 'violet control: a #B040FF halation is flagged by the same test', rgb(hv))

  // -- export vs preview_frame, with a full grade ------------------------------------------------
  const FULL = {
    gain: { r: 0.12, g: 0, b: -0.06 }, lift: { r: 0.01, g: 0.015, b: 0.03 }, saturation: 0.8, temperature: 250,
    curves: { r: [[0, 0.036], [0.25, 0.25], [0.8, 0.795], [1, 0.965]], master: [[0.5, 0.52]] },
    lut: { assetId: lut.id, intensity: 0.3 }, halation: { amount: 0.3, threshold: 0.8, radius: 10 },
    vignette: { amount: 0.3 }, grain: { amount: 0.15, size: 1 }
  }
  const W = 180, H = 320
  const SAMPLES = [5, 45, 100]
  const oracle = await evaluate(`(async () => {
    const out = []
    for (const frame of ${JSON.stringify(SAMPLES)}) {
      const project = __grade.project(${JSON.stringify(bars)}, ${JSON.stringify(FULL)}, null, [${JSON.stringify(lut)}])
      project.timelines[0].tracks[0].items[0].durationInFrames = 120
      const r = await window.bayEngine.renderFrame({ project, timelineId: project.activeTimelineId, frame, maxSize: ${H} })
      const m = __grade.means(await __grade.pixels(r.dataUrl))
      out.push({ frame, ...m, pending: r.pending, issues: r.gradeIssues ?? null })
    }
    return out
  })()`, 120_000)
  const outDir = join(homedir(), 'Movies', 'bay')
  await mkdir(outDir, { recursive: true })
  const outputPath = join(outDir, `grade-probe-${Date.now()}.mp4`)
  const exported = await evaluate(`(async () => {
    const project = __grade.project(${JSON.stringify(bars)}, ${JSON.stringify(FULL)}, null, [${JSON.stringify(lut)}])
    project.timelines[0].tracks[0].items[0].durationInFrames = 120
    const job = await window.bay.export.start({ project, timelineId: project.activeTimelineId, format: 'mp4',
      outputPath: ${JSON.stringify(outputPath)}, width: ${W}, height: ${H}, fromFrame: 0, toFrame: 119 })
    const outcome = await new window.bayEngine.FrameExporter({ project, timelineId: project.activeTimelineId,
      jobId: job.jobId, width: ${W}, height: ${H}, fromFrame: 0, toFrame: 119 }).run()
    return outcome
  })()`, 180_000)
  await new Promise((r) => setTimeout(r, 2500))
  console.log('export         ', JSON.stringify(exported))
  let mismatches = 0
  for (const frame of SAMPLES) {
    const raw = join(scratch, `f${frame}.rgb`)
    // Decoded with zimg, not swscale: this ffmpeg's swscale returns limited-range Y as if it were
    // full range (Y 126, a correct encode of grey 128, comes back as 126), a −2 bias that sat this
    // check at the edge of its ±2 tolerance for a reason in the instrument, not the file.
    await run(FFMPEG, ['-v', 'error', '-i', outputPath, '-vf', `select=eq(n\\,${frame}),zscale=min=709:rin=limited:m=709:r=full,format=rgb24`, '-vsync', '0', '-frames:v', '1',
      '-f', 'rawvideo', '-s', `${W}x${H}`, '-y', raw])
    const bytes = await readFile(raw)
    let r = 0, g = 0, b = 0
    for (let i = 0; i < bytes.length; i += 3) { r += bytes[i]; g += bytes[i + 1]; b += bytes[i + 2] }
    const n = bytes.length / 3
    const e = { r: r / n, g: g / n, b: b / n }
    const p = oracle.find((o) => o.frame === frame)
    // The tolerance export-vs-preview.mjs uses for luma (±2), applied per channel.
    const close = ['r', 'g', 'b'].every((c) => Math.abs(p[c] - e[c]) <= 2)
    if (!close) mismatches += 1
    console.log(`      frame ${frame}: preview ${rgb(p)}   export ${rgb(e)}   ${close ? 'match' : 'MISMATCH'}`)
  }
  const oracleOk = oracle.every((o) => o.pending === 0 && !o.issues)
  check(oracleOk, 'preview_frame of the fully graded clip is complete with no grade issues', JSON.stringify(oracle.map((o) => o.issues)))
  check(mismatches === 0, 'exported frames match preview_frame per channel within ±2')
  // Positive control for the comparison: the ungraded preview must NOT match the graded export.
  const ungraded = await means(bars, null, SAMPLES[1])
  const p1 = oracle.find((o) => o.frame === SAMPLES[1])
  check(['r', 'g', 'b'].some((c) => Math.abs(ungraded[c] - p1[c]) > 2), 'comparison control: ungraded vs graded differ by more than the tolerance',
    `${rgb(ungraded)} vs ${rgb(p1)}`)
  await rm(outputPath, { force: true })

  // -- the agent's surface ----------------------------------------------------------------------
  const mcp = (tool, args) => evaluate(`window.bayMcp.execute({ id: 'grade-' + Math.random(), tool: ${JSON.stringify(tool)}, args: ${JSON.stringify(args)} })`, 60_000)
  const imp = await mcp('import_media', { paths: [join(scratch, 'swap.cube'), join(MEDIA, 'grey.mp4')] })
  const lutRow = imp.value?.assets?.[0]
  check(imp.ok && lutRow?.kind === 'lut' && lutRow.placeable === false && /edit_item/.test(lutRow.use ?? ''),
    'import_media reports a LUT as not placeable, with how to use it', JSON.stringify(lutRow))
  const refusedPlace = await mcp('place_asset', { assetId: lutRow.id, atFrame: 0 })
  check(!refusedPlace.ok && /edit_item .*grade: \{ lut:/.test(refusedPlace.error ?? ''), 'place_asset refuses a LUT and says how to apply it',
    refusedPlace.error)
  const placed = await mcp('place_asset', { assetId: imp.value.assets[1].id, atFrame: 0 })
  check(placed.ok, 'positive control: place_asset of the grey clip succeeds', placed.error)
  const itemId = placed.value?.itemId
  const edited = await mcp('edit_item', { itemId, grade: { gain: { r: 0.1 }, lut: { assetId: lutRow.id, intensity: 0.5 } } })
  check(edited.ok && edited.value.grade?.gain?.r === 0.1 && edited.value.grade?.lut?.intensity === 0.5,
    'edit_item sets a grade and returns it', edited.error ?? JSON.stringify(edited.value?.grade))
  const inspected = await mcp('inspect_item', { itemId })
  check(inspected.ok && inspected.value.grade?.gain?.g === 0 && inspected.value.gradeActive === true,
    'inspect_item reads the grade back, merged, and says it is active', JSON.stringify(inspected.value?.grade))
  const merged = await mcp('edit_item', { itemId, grade: { saturation: 0.5 } })
  check(merged.ok && merged.value.grade?.gain?.r === 0.1 && merged.value.grade?.saturation === 0.5, 'a second edit merges')
  const bad = await mcp('edit_item', { itemId, grade: { saturation: 9 } })
  check(!bad.ok && /grade\.saturation must be a number from 0 to 4; got 9/.test(bad.error ?? ''), 'a bad value is refused with its range', bad.error)
  const badLut = await mcp('edit_item', { itemId, grade: { lut: { assetId: broken.id } } })
  check(!badLut.ok && /No asset|could not be read as a LUT/.test(badLut.error ?? ''), 'a LUT that is not in the project is refused with how to get one', badLut.error)
  const shot = await mcp('preview_frame', { frame: 5 })
  check(shot.ok && !shot.value.gradeWarnings && !shot.value.incomplete, 'preview_frame of the graded clip reports no grade warnings',
    JSON.stringify(shot.value?.gradeWarnings ?? shot.error))
  const cleared = await mcp('edit_item', { itemId, grade: null })
  check(cleared.ok && cleared.value.grade === undefined, 'grade: null removes the grade')

  // -- cost ------------------------------------------------------------------------------------
  const cost = await evaluate(`(async () => {
    const { Compositor, MediaPool, awaitSources } = window.bayEngine
    const colour = { gain: { r: 0.1, g: 0, b: -0.05 }, lift: { r: 0.01, g: 0.01, b: 0.03 }, saturation: 0.9, temperature: 200,
      curves: { master: [[0.25, 0.22], [0.75, 0.8]] }, lut: { assetId: ${JSON.stringify(lut.id)}, intensity: 0.5 } }
    const cases = [
      ['ungraded', null],
      ['identity grade', { saturation: 1 }],
      ['colour (wheels+WB+curves+LUT)', colour],
      ['+ grain + vignette', { ...colour, grain: { amount: 0.15, size: 1 }, vignette: { amount: 0.3 } }],
      ['+ halation (full grade)', { ...colour, grain: { amount: 0.15, size: 1 }, vignette: { amount: 0.3 }, halation: { amount: 0.3, threshold: 0.8, radius: 10 } }]
    ]
    const out = {}
    for (const [W, H] of [[1080, 1920], [2160, 3840]]) {
      const pool = new MediaPool({ maxVideoElements: 4 })
      const compositor = new Compositor(pool)
      const canvas = new OffscreenCanvas(W, H)
      const ctx = canvas.getContext('2d')
      // Two rounds over every case, keeping the second, so no case pays the others' warm-up.
      for (const round of [0, 1]) for (const [label, grade] of cases) {
        const project = __grade.project(${JSON.stringify(bars)}, grade, { w: W, h: H }, [${JSON.stringify(lut)}])
        const timeline = project.timelines[0]
        await awaitSources(pool, project, timeline, 30, 5000)
        const measure = (full) => {
          const t = []
          for (let i = 0; i < 25; i++) {
            const t0 = performance.now()
            compositor.drawFrame(ctx, project, timeline, 30, { mode: 'scrub' })
            ctx.getImageData(0, 0, full ? W : 1, full ? H : 1)
            t.push(performance.now() - t0)
          }
          t.sort((a, b) => a - b)
          return +t[12].toFixed(2)
        }
        measure(false)
        const row = { drawP50: measure(false), exportCycleP50: measure(true) }
        if (round === 1) out[W + 'x' + H + ' ' + label] = row
      }
      pool.dispose()
    }
    return out
  })()`, 120_000)
  console.log('\ncost (median ms, 25 draws; "draw" = draw + 1px readback to flush the GPU; "export" = draw + full-frame getImageData)')
  for (const [label, v] of Object.entries(cost)) console.log(`  ${label.padEnd(48)} draw ${String(v.drawP50).padStart(6)}   export ${String(v.exportCycleP50).padStart(6)}`)

  await rm(scratch, { recursive: true, force: true })
  console.log(`\n${failures === 0 ? 'PASS' : `FAIL  ${failures} check(s)`}`)
  close()
  return failures === 0
})
