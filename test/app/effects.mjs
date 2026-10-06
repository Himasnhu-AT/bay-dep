/**
 * UNRUN. Written with the effect stack and not yet executed against a running bay — the stream
 * that built it was not allowed to launch one. Until someone runs it and reads its output, every
 * claim below is what the probe is *meant* to establish, not something it has established. Expect
 * the first run to need a fix to the probe itself (a selector, a timeout, a tolerance) before it
 * says anything about the code.
 *
 *   ./run.sh            # build, one instance with CDP on 9222
 *   node --import ./src/test-hooks.mjs test/app/effects.mjs
 *   (the hook resolves the catalog's extensionless imports, as for test/app/keyframes.mjs; PORT= for another instance)
 *
 * Does each video effect reach pixels — the same pixels in the preview's compositor, in
 * preview_frame and in the exported file?
 *
 * Three paths, named, because a probe of one is not a probe of another:
 *   preview        a Compositor drawing the timeline onto a half-size canvas, as the viewer's does
 *   preview_frame  `renderFrame`, which is what the tool returns
 *   export         `FrameExporter` → the file → one decoded frame per effect
 * Each picture is reduced to a 6 x 6 grid of mean colours rather than one mean: a flip, a mirror
 * and a glitch all leave the whole-frame mean where it was.
 *
 * For every effect in the catalog:
 *   positive control   at its defaults the grid differs from the clip with no effects — the
 *                      comparison can see an effect, so "the three paths match" is not three
 *                      copies of an effect that never ran
 *   identity control   at its off value (where it has one) the grid is the untouched clip's and
 *                      nothing is reported
 *   agreement          preview, preview_frame and export match cell for cell
 * Then: order changes the picture; a grade under a stack is still applied; a grade drawn right
 * after an effects draw is unchanged (the two share a WebGL context); glitch is the same picture
 * each time frame N is drawn and a different one a hold later; chroma key shows the track beneath
 * through the screen, keeps the subject, and exports the same; an effect this build lacks is
 * reported by preview_frame; and the agent's `edit_effects` / `inspect_item` round trip.
 *
 * Makes its own specimens under ~/.bay-probe-media/effects (or uses MEDIA). Renders projects built
 * in the page; the MCP checks edit the open project and are undone. Nothing saves.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe } from './cdp.mjs'
import { FFMPEG, H264 } from './ffmpeg.mjs'
import { EFFECTS } from '../../src/shared/effects/index.ts'
import { defaultParams } from '../../src/shared/effects/edit.ts'

const run = promisify(execFile)
const MEDIA = process.env.MEDIA ?? join(homedir(), '.bay-probe-media', 'effects')
await mkdir(MEDIA, { recursive: true })

const W = 1080
const H = 1920
// The subject: a red square in the middle of a chroma-green frame.
const inSquare = 'between(X,340,740)*between(Y,760,1160)'
const specimens = [
  // Bars: structure in both axes and a bright band, so blurs, flips and glow all have something to move.
  ['bars.mp4', ['-f', 'lavfi', '-i', `smptehdbars=s=${W}x${H}:r=30:d=5`, ...H264, '-pix_fmt', 'yuv420p']],
  ['screen.png', ['-f', 'lavfi', '-i',
    `color=c=black:s=${W}x${H},format=rgb24,geq=r='if(${inSquare},220,0)':g='if(${inSquare},30,177)':b='if(${inSquare},30,64)'`,
    '-frames:v', '1']],
  ['blue.png', ['-f', 'lavfi', '-i', `color=c=0x1020E0:s=${W}x${H}`, '-frames:v', '1']]
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

const GRID = 6
/** Largest per-channel difference between two grids, and where. */
function gridDiff(a, b) {
  let worst = 0
  let at = -1
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i] - b[i])
    if (d > worst) { worst = d; at = Math.floor(i / 3) }
  }
  return { worst, cell: at < 0 ? '' : `cell ${at % GRID},${Math.floor(at / GRID)}` }
}
const cellOf = (grid, cx, cy) => grid.slice((cy * GRID + cx) * 3, (cy * GRID + cx) * 3 + 3)
const rgbText = (c) => `R ${c[0].toFixed(0)} G ${c[1].toFixed(0)} B ${c[2].toFixed(0)}`

/** A grid from packed RGB (export's decoded frame). */
function gridOfRgb(bytes, w, h) {
  const sums = new Float64Array(GRID * GRID * 3)
  const counts = new Float64Array(GRID * GRID)
  for (let y = 0; y < h; y += 1) {
    const gy = Math.min(GRID - 1, Math.floor((y * GRID) / h))
    for (let x = 0; x < w; x += 1) {
      const gx = Math.min(GRID - 1, Math.floor((x * GRID) / w))
      const cell = gy * GRID + gx
      const i = (y * w + x) * 3
      sums[cell * 3] += bytes[i]; sums[cell * 3 + 1] += bytes[i + 1]; sums[cell * 3 + 2] += bytes[i + 2]
      counts[cell] += 1
    }
  }
  return Array.from(sums, (v, i) => v / counts[Math.floor(i / 3)])
}

const HELPERS = `
  window.__fx = window.__fx || {}
  __fx.GRID = ${GRID}
  __fx.grid = (data, w, h) => {
    const G = __fx.GRID, sums = new Float64Array(G * G * 3), counts = new Float64Array(G * G)
    for (let y = 0; y < h; y++) {
      const gy = Math.min(G - 1, Math.floor(y * G / h))
      for (let x = 0; x < w; x++) {
        const gx = Math.min(G - 1, Math.floor(x * G / w)), cell = gy * G + gx, i = (y * w + x) * 4
        sums[cell * 3] += data[i]; sums[cell * 3 + 1] += data[i + 1]; sums[cell * 3 + 2] += data[i + 2]
        counts[cell] += 1
      }
    }
    return Array.from(sums, (v, i) => v / counts[Math.floor(i / 3)])
  }
  __fx.clip = (id, asset, from, frames, extra) => ({ id, assetId: asset.id, trackId: 'fx_v1', from, durationInFrames: frames,
    sourceStartUs: 0, layout: { left: 0, top: 0, width: ${W}, height: ${H}, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...(extra || {}) })
  // tracks: [[items…] bottom, [items…] above]
  __fx.project = (assets, tracks) => {
    const st = window.bayEngine.store.getState()
    const base = st.project.timelines.find((t) => t.id === st.project.activeTimelineId)
    const timeline = { ...base, width: ${W}, height: ${H}, fps: 30, background: '#000000', transitions: [],
      tracks: tracks.map((items, i) => ({ id: 'fx_v' + i, kind: 'video', name: 'V' + (i + 1), locked: false, muted: false, hidden: false,
        items: items.map((item) => ({ ...item, trackId: 'fx_v' + i })) })) }
    return { ...st.project, assets, timelines: [timeline], activeTimelineId: timeline.id }
  }
  // preview_frame's path.
  __fx.still = async (project, frame) => {
    const r = await window.bayEngine.renderFrame({ project, timelineId: project.activeTimelineId, frame, maxSize: 480 })
    const img = new Image(); img.src = r.dataUrl; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height)
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    return { grid: __fx.grid(x.getImageData(0, 0, img.width, img.height).data, img.width, img.height),
      pending: r.pending, issues: r.gradeIssues ?? null }
  }
  // The viewer's path: a Compositor drawing the timeline, scaled, in scrub mode.
  __fx.preview = async (project, frame) => {
    const { Compositor, MediaPool, awaitSources } = window.bayEngine
    const pool = new MediaPool({ maxVideoElements: 4 })
    try {
      const compositor = new Compositor(pool)
      const timeline = project.timelines[0]
      const w = ${W / 2}, h = ${H / 2}
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      await awaitSources(pool, project, timeline, frame, 8000)
      let stats = null
      // Drawn until nothing is pending: a seek lands a frame or two after it is asked for.
      for (let i = 0; i < 40; i++) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, w, h)
        ctx.setTransform(w / ${W}, 0, 0, h / ${H}, 0, 0)
        stats = compositor.drawFrame(ctx, project, timeline, frame, { mode: 'scrub' })
        if (stats.pending === 0) break
        await new Promise((r) => setTimeout(r, 50))
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      return { grid: __fx.grid(ctx.getImageData(0, 0, w, h).data, w, h), pending: stats.pending, issues: stats.gradeIssues ?? null }
    } finally { pool.dispose() }
  }
  true
`

/** The value of each effect's "off" parameter, where it has one (mirror and chroma-key do not). */
const OFF = {
  'directional-blur': { length: 0 }, 'zoom-blur': { amount: 0 }, sharpen: { amount: 0 }, glow: { amount: 0 },
  'chromatic-aberration': { amount: 0 }, pixelate: { size: 1 }, glitch: { amount: 0 }, duotone: { amount: 0 },
  tint: { amount: 0 }, flip: { horizontal: false, vertical: false }
}
/** Stronger than the defaults where a default is too gentle to move a 6 x 6 grid by more than noise. */
const STRONG = {
  'directional-blur': { length: 160 }, 'zoom-blur': { amount: 0.6 }, sharpen: { amount: 2.5, radius: 6 },
  glow: { amount: 1.2, radius: 40, threshold: 0.3 }, 'chromatic-aberration': { amount: 60, radial: false },
  pixelate: { size: 240 }, glitch: { amount: 1, blockSize: 120, rgbSplit: 40 }
}
// Preview and preview_frame are the same compositor at two sizes; the file adds a codec.
const TOL_STILL = 3
const TOL_EXPORT = 5
// What "the effect changed the picture" must exceed: well clear of both tolerances.
const MOVED = 12

await runProbe(async () => {
  await evaluate(HELPERS)
  const imported = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths(${JSON.stringify([join(MEDIA, 'bars.mp4'), join(MEDIA, 'screen.png'), join(MEDIA, 'blue.png')])})
    return im.map((e) => e.asset)
  })()`, 60_000)
  const [bars, screen, blue] = imported
  check(bars?.kind === 'video' && screen?.kind === 'image' && blue?.kind === 'image', 'the specimens import', JSON.stringify(imported.map((a) => a?.kind)))

  const FRAME = 12
  const stack = (kind, params) => [{ id: `fx_${kind}`, kind, params: { ...defaultParams(EFFECTS.find((e) => e.kind === kind)), ...(STRONG[kind] ?? {}), ...(params ?? {}) } }]
  const one = (path, asset, extra, frame = FRAME) => evaluate(`(async () => {
    const asset = ${JSON.stringify(asset)}
    const project = __fx.project([asset], [[__fx.clip('fx_i0', asset, 0, 60, ${JSON.stringify(extra ?? {})})]])
    return __fx.${path}(project, ${frame})
  })()`, 60_000)

  // -- baseline, and the instrument's own control ----------------------------------------------
  const plainStill = await one('still', bars)
  const plainPreview = await one('preview', bars)
  check(plainStill.pending === 0 && !plainStill.issues, 'baseline: the bars render complete with nothing reported', JSON.stringify(plainStill.issues))
  const baseDiff = gridDiff(plainStill.grid, plainPreview.grid)
  check(baseDiff.worst <= TOL_STILL, `baseline: preview and preview_frame agree with no effects (±${TOL_STILL})`, `worst ${baseDiff.worst.toFixed(1)} ${baseDiff.cell}`)
  // The grid must be able to tell two pictures apart at all: the bars against the blue card.
  const blueStill = await one('still', blue)
  check(gridDiff(plainStill.grid, blueStill.grid).worst > 60, 'instrument control: the grid tells the bars from a blue card')

  // -- every effect: positive control, identity control, preview vs preview_frame ----------------
  const stills = {}
  for (const spec of EFFECTS) {
    if (spec.kind === 'chroma-key') continue // its own section: it needs a screen and a track beneath
    const on = stack(spec.kind)
    const still = await one('still', bars, { effects: on })
    const preview = await one('preview', bars, { effects: on })
    stills[spec.kind] = still.grid
    const moved = gridDiff(still.grid, plainStill.grid)
    check(still.pending === 0 && !still.issues, `${spec.kind}: draws with nothing reported`, JSON.stringify(still.issues))
    check(moved.worst > MOVED, `${spec.kind}: positive control — it changes the picture`, `worst change ${moved.worst.toFixed(1)} ${moved.cell}`)
    const agree = gridDiff(still.grid, preview.grid)
    check(agree.worst <= TOL_STILL, `${spec.kind}: preview and preview_frame agree (±${TOL_STILL})`, `worst ${agree.worst.toFixed(1)} ${agree.cell}`)
    if (OFF[spec.kind]) {
      const off = await one('still', bars, { effects: stack(spec.kind, OFF[spec.kind]) })
      const same = gridDiff(off.grid, plainStill.grid)
      check(same.worst <= 1 && !off.issues, `${spec.kind}: identity control — at its off value the picture is the untouched clip's`, `worst ${same.worst.toFixed(2)}`)
    }
    const bypassed = await one('still', bars, { effects: on.map((e) => ({ ...e, enabled: false })) })
    check(gridDiff(bypassed.grid, plainStill.grid).worst <= 1, `${spec.kind}: switched off, the picture is the untouched clip's`)
  }

  // -- direction, not just change ---------------------------------------------------------------
  // A horizontal flip puts the left column's colours in the right column.
  const flipped = stills.flip
  const mirrored = [0, 1, 2, 3, 4, 5].every((y) => {
    const a = cellOf(plainStill.grid, 0, y)
    const b = cellOf(flipped, GRID - 1, y)
    return a.every((v, i) => Math.abs(v - b[i]) <= 6)
  })
  check(mirrored, 'flip: the left column of the source is the right column of the result')
  // A mirror makes the result left-right symmetric, and keeps the left half.
  const symmetric = [0, 1, 2].every((x) => [0, 3, 5].every((y) => {
    const a = cellOf(stills.mirror, x, y)
    const b = cellOf(stills.mirror, GRID - 1 - x, y)
    const kept = cellOf(plainStill.grid, x, y)
    return a.every((v, i) => Math.abs(v - b[i]) <= 6 && Math.abs(v - kept[i]) <= 6)
  }))
  check(symmetric, 'mirror: the result is symmetric about the line and its left half is the source\'s')

  // -- order -------------------------------------------------------------------------------------
  const mirrorDefaults = defaultParams(EFFECTS.find((e) => e.kind === 'mirror'))
  const flipDefaults = defaultParams(EFFECTS.find((e) => e.kind === 'flip'))
  const ab = [{ id: 'fx_a', kind: 'mirror', params: mirrorDefaults }, { id: 'fx_b', kind: 'flip', params: flipDefaults }]
  const first = await one('still', bars, { effects: ab })
  const second = await one('still', bars, { effects: [...ab].reverse() })
  check(!first.issues && !second.issues && gridDiff(first.grid, second.grid).worst > MOVED,
    'order: mirror then flip is a different picture from flip then mirror', `differs by ${gridDiff(first.grid, second.grid).worst.toFixed(1)}`)

  // -- with a grade, and after one ---------------------------------------------------------------
  const GRADE = { gain: { r: 0.25, g: 0, b: 0 } }
  const gradedBefore = await one('still', bars, { grade: GRADE })
  const gradedFlipped = await one('still', bars, { grade: GRADE, effects: stack('flip') })
  const gradedAfter = await one('still', bars, { grade: GRADE })
  check(!gradedFlipped.issues, 'a grade under a stack reports nothing', JSON.stringify(gradedFlipped.issues))
  // Graded then flipped: the graded picture's left column, in the right column.
  const gradeKept = [0, 2, 5].every((y) => {
    const a = cellOf(gradedBefore.grid, 0, y)
    const b = cellOf(gradedFlipped.grid, GRID - 1, y)
    return a.every((v, i) => Math.abs(v - b[i]) <= 6)
  })
  check(gradeKept, 'a grade under a stack is applied: the flipped picture is the graded one, flipped')
  check(gridDiff(gradedBefore.grid, plainStill.grid).worst > 6, 'control: the grade alone changes the picture')
  check(gridDiff(gradedBefore.grid, gradedAfter.grid).worst <= 1 && !gradedAfter.issues,
    'a grade drawn after an effects draw is the grade it was before one — the shared context was left as found',
    `worst ${gridDiff(gradedBefore.grid, gradedAfter.grid).worst.toFixed(2)}, issues ${JSON.stringify(gradedAfter.issues)}`)

  // -- glitch is a function of the frame ---------------------------------------------------------
  const glitchAt = (frame) => one('still', bars, { effects: stack('glitch', { hold: 3 }) }, frame)
  const g12 = await glitchAt(12)
  const g12again = await glitchAt(12)
  const g13 = await glitchAt(13)
  const g15 = await glitchAt(15)
  check(gridDiff(g12.grid, g12again.grid).worst <= 1, 'glitch: frame 12 drawn twice is one picture')
  check(gridDiff(g12.grid, g13.grid).worst <= 2, 'glitch: frames 12 and 13 share a pattern at hold 3')
  check(gridDiff(g12.grid, g15.grid).worst > MOVED, 'glitch: a hold later the pattern has changed', `differs by ${gridDiff(g12.grid, g15.grid).worst.toFixed(1)}`)

  // -- chroma key --------------------------------------------------------------------------------
  const KEY = { color: '#00B140', similarity: 0.25, smoothness: 0.05, spill: 0.5 }
  const keyProject = (effects) => `__fx.project([${JSON.stringify(blue)}, ${JSON.stringify(screen)}], [
    [__fx.clip('fx_bg', ${JSON.stringify(blue)}, 0, 60)],
    [__fx.clip('fx_fg', ${JSON.stringify(screen)}, 0, 60, ${JSON.stringify(effects ? { effects } : {})})]
  ])`
  const keyed = await evaluate(`__fx.still(${keyProject([{ id: 'fx_key', kind: 'chroma-key', params: KEY }])}, ${FRAME})`, 60_000)
  const keyedPreview = await evaluate(`__fx.preview(${keyProject([{ id: 'fx_key', kind: 'chroma-key', params: KEY }])}, ${FRAME})`, 60_000)
  const unkeyed = await evaluate(`__fx.still(${keyProject(null)}, ${FRAME})`, 60_000)
  const corner = cellOf(keyed.grid, 0, 0)
  const centre = cellOf(keyed.grid, 2, 2) // inside the red square (x 340..740 of 1080 covers cells 2 and 3)
  const cornerBefore = cellOf(unkeyed.grid, 0, 0)
  check(cornerBefore[1] > 150 && cornerBefore[2] < 90, 'chroma key control: unkeyed, the screen covers the track beneath', rgbText(cornerBefore))
  check(!keyed.issues && corner[2] > 190 && corner[1] < 60 && corner[0] < 50, 'chroma key: the track beneath shows through the screen', rgbText(corner))
  check(centre[0] > 180 && centre[1] < 70 && centre[2] < 70, 'chroma key: the subject is kept, its own colour', rgbText(centre))
  check(gridDiff(keyed.grid, keyedPreview.grid).worst <= TOL_STILL, `chroma key: preview and preview_frame agree (±${TOL_STILL})`,
    `worst ${gridDiff(keyed.grid, keyedPreview.grid).worst.toFixed(1)}`)
  // An effect after the key sees the keyed picture: flipped, the (centred) square stays, and the screen is still gone.
  const keyedFlipped = await evaluate(`__fx.still(${keyProject([{ id: 'fx_key', kind: 'chroma-key', params: KEY }, { id: 'fx_f', kind: 'flip', params: flipDefaults }])}, ${FRAME})`, 60_000)
  check(!keyedFlipped.issues && cellOf(keyedFlipped.grid, 5, 0)[2] > 190, 'chroma key then flip: still keyed', rgbText(cellOf(keyedFlipped.grid, 5, 0)))

  // -- an effect this build does not have --------------------------------------------------------
  const unknown = await one('still', bars, { effects: [{ id: 'fx_new', kind: 'lens-flare', params: {} }] })
  check(Array.isArray(unknown.issues) && unknown.issues.some((i) => /lens-flare/.test(i) && /fx_i0/.test(i)),
    'an effect this build lacks is reported by the draw, naming the clip and the effect', JSON.stringify(unknown.issues))

  // -- export: one file, one segment per effect --------------------------------------------------
  const SEG = 10
  const segments = [
    ['none', bars, {}],
    ...EFFECTS.filter((e) => e.kind !== 'chroma-key').map((e) => [e.kind, bars, { effects: stack(e.kind, e.kind === 'glitch' ? { hold: 60 } : null) }]),
    ['grade+flip', bars, { grade: GRADE, effects: stack('flip') }]
  ]
  const exportProject = `(() => {
    const segs = ${JSON.stringify(segments)}
    const bg = [], fg = []
    segs.forEach(([name, asset, extra], i) => fg.push(__fx.clip('fx_s' + i, asset, i * ${SEG}, ${SEG}, extra)))
    // The key, last, over the blue card.
    const at = segs.length * ${SEG}
    bg.push(__fx.clip('fx_kbg', ${JSON.stringify(blue)}, at, ${SEG}))
    fg.push(__fx.clip('fx_kfg', ${JSON.stringify(screen)}, at, ${SEG}, { effects: [{ id: 'fx_key', kind: 'chroma-key', params: ${JSON.stringify(KEY)} }] }))
    return __fx.project([${JSON.stringify(bars)}, ${JSON.stringify(blue)}, ${JSON.stringify(screen)}], [bg, fg])
  })()`
  const total = (segments.length + 1) * SEG
  const EW = W / 2
  const EH = H / 2
  const outDir = join(homedir(), 'Movies', 'bay')
  await mkdir(outDir, { recursive: true })
  const outputPath = join(outDir, `effects-probe-${Date.now()}.mp4`)
  const outcome = await evaluate(`(async () => {
    const project = ${exportProject}
    const job = await window.bay.export.start({ project, timelineId: project.activeTimelineId, format: 'mp4',
      outputPath: ${JSON.stringify(outputPath)}, width: ${EW}, height: ${EH}, fromFrame: 0, toFrame: ${total - 1} })
    return new window.bayEngine.FrameExporter({ project, timelineId: project.activeTimelineId,
      jobId: job.jobId, width: ${EW}, height: ${EH}, fromFrame: 0, toFrame: ${total - 1} }).run()
  })()`, 240_000)
  await new Promise((r) => setTimeout(r, 2500))
  check(outcome && !outcome.incomplete && outcome.framesWritten === total, 'the export finishes complete: no frame written without its effects',
    JSON.stringify(outcome?.incomplete?.message ?? outcome))

  const scratch = join(MEDIA, 'probe')
  await mkdir(scratch, { recursive: true })
  const exportedGrid = async (frame) => {
    const raw = join(scratch, `f${frame}.rgb`)
    // zscale, not swscale: see test/app/grade.mjs for the −2 bias swscale puts on this decode.
    await run(FFMPEG, ['-v', 'error', '-i', outputPath, '-vf', `select=eq(n\\,${frame}),zscale=min=709:rin=limited:m=709:r=full,format=rgb24`,
      '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-s', `${EW}x${EH}`, '-y', raw])
    return gridOfRgb(await readFile(raw), EW, EH)
  }
  const exportGrids = {}
  for (let i = 0; i < segments.length; i += 1) {
    const [name, asset, extra] = segments[i]
    const frame = i * SEG + 5
    const file = await exportedGrid(frame)
    exportGrids[name] = file
    // The oracle is preview_frame of the same project at the same timeline frame.
    const oracle = await evaluate(`__fx.still(${exportProject}, ${frame})`, 60_000)
    const diff = gridDiff(file, oracle.grid)
    check(diff.worst <= TOL_EXPORT && !oracle.issues, `${name}: the exported frame matches preview_frame (±${TOL_EXPORT})`, `worst ${diff.worst.toFixed(1)} ${diff.cell}`)
  }
  // Positive control for the export comparison: the effects are in the file, not just absent from both sides.
  for (const kind of ['flip', 'pixelate', 'duotone']) {
    check(gridDiff(exportGrids[kind], exportGrids.none).worst > MOVED, `export control: the ${kind} segment of the file differs from the plain one`)
  }
  const keyFrame = segments.length * SEG + 5
  const keyFile = await exportedGrid(keyFrame)
  const fileCorner = cellOf(keyFile, 0, 0)
  const fileCentre = cellOf(keyFile, 2, 2)
  check(fileCorner[2] > 180 && fileCorner[1] < 70, 'chroma key in the file: the track beneath shows through the screen', rgbText(fileCorner))
  check(fileCentre[0] > 170 && fileCentre[1] < 80, 'chroma key in the file: the subject is kept', rgbText(fileCentre))
  check(gridDiff(keyFile, keyed.grid).worst <= TOL_EXPORT + 2, 'chroma key: the exported frame matches preview_frame', `worst ${gridDiff(keyFile, keyed.grid).worst.toFixed(1)}`)
  await rm(outputPath, { force: true })
  await rm(scratch, { recursive: true, force: true })

  // -- the agent's surface (edits the open project; undone below) --------------------------------
  const pastBefore = await evaluate('window.bayEngine.store.getState().past.length')
  const mcp = (tool, args) => evaluate(`window.bayMcp.execute({ id: 'fx-' + Math.random(), tool: ${JSON.stringify(tool)}, args: ${JSON.stringify(args)} })`, 60_000)
  const imp = await mcp('import_media', { paths: [join(MEDIA, 'bars.mp4')] })
  const placed = await mcp('place_asset', { assetId: imp.value?.assets?.[0]?.id, atFrame: 0 })
  check(placed.ok, 'positive control: place_asset of the bars succeeds', placed.error)
  const itemId = placed.value?.itemId
  const added = await mcp('edit_effects', { itemId, operations: [{ op: 'add', kind: 'pixelate', params: { size: 120 } }, { op: 'add', kind: 'flip' }] })
  check(added.ok && added.value.effects?.length === 2 && added.value.effects.every((e) => e.draws), 'edit_effects adds two effects and says both draw',
    added.error ?? JSON.stringify(added.value?.effects))
  const flipId = added.value?.effects?.[1]?.id
  const inspected = await mcp('inspect_item', { itemId })
  check(inspected.ok && inspected.value.effects?.map((e) => e.kind).join() === 'pixelate,flip', 'inspect_item reads the stack back in order', JSON.stringify(inspected.value?.effects))
  const bad = await mcp('edit_effects', { itemId, operations: [{ op: 'update', effectId: flipId, params: { horizontal: 'yes' } }] })
  check(!bad.ok && /flip\.horizontal must be true or false/.test(bad.error ?? ''), 'a bad value is refused in the parameter\'s own terms', bad.error)
  const range = await mcp('edit_effects', { itemId, operations: [{ op: 'add', kind: 'glow', params: { amount: 9 } }] })
  check(!range.ok && /glow\.amount must be a number from 0 to 2/.test(range.error ?? ''), 'a value out of range is refused with the range', range.error)
  const shot = await mcp('preview_frame', { frame: 5 })
  check(shot.ok && !shot.value.gradeWarnings && !shot.value.incomplete, 'preview_frame of the clip with effects reports no warnings',
    JSON.stringify(shot.value?.gradeWarnings ?? shot.error))
  const cleared = await mcp('edit_effects', { itemId, operations: [{ op: 'clear' }] })
  const after = await mcp('inspect_item', { itemId })
  check(cleared.ok && after.ok && after.value.effects === undefined, 'clear removes the stack; inspect_item reports none')
  // Put the open project back: undo everything this section did.
  const restored = await evaluate(`(() => {
    const store = window.bayEngine.store
    let guard = 200
    while (store.getState().past.length > ${pastBefore} && guard-- > 0) store.getState().undo()
    return store.getState().past.length
  })()`)
  check(restored === pastBefore, 'the open project is put back as it was found', `${restored} undo entries, started at ${pastBefore}`)

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL  ${failures} check(s)`}`)
  close()
  return failures === 0
})
