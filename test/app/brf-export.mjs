/**
 * Does an exported file show a `.brf` code module on every frame — the same picture
 * `preview_frame` shows?
 *
 * test.md §2.1. CLAUDE.md: *a probe of the preview is not a probe of the export*. A code module's
 * scenes come from a worker, asynchronously; an export that drew once and moved on would write
 * the frames whose scenes had not arrived yet as the background alone — a black frame where the
 * card should be, and a preview that was right the whole time.
 *
 * What would fool it, and what stops that:
 * - **The preview's cache.** Preview, `renderFrame` and export share one scene cache, so the
 *   oracle renders below fill it and an export straight after would never wait for anything. The
 *   cache is cleared (`brfRuntime.dispose()`) immediately before each export, so the export
 *   starts cold, as it does on a project just opened.
 * - **Three sampled frames.** A worker answers in half-second chunks, so a missing frame is the
 *   first of a chunk, not a random one. Every frame of the file is compared with the oracle.
 * - **A card too dark to see.** The guide's card is `#111118ee`; what the measure sees is the
 *   amber count and bar. The oracle must light a floor on every frame after the first few, which
 *   the empty frame is shown not to reach, and a file frame lighting under half of what the
 *   oracle lights on that frame is counted as missing the graphic.
 * - **"The override reached the file"** as "the file changed" passes for noise. The override
 *   oracle must differ from the default oracle at 3.0 s by far more than the tolerance, and the
 *   file must match the override one.
 *
 * `VERIFY_PROBE=1` makes the runtime's `settle` return at once — the export that does not wait
 * for the worker. The probe must fail against it, and `track_export` must say so too: not
 * `complete`, with every frame the file is missing the graphic on among its `incompleteFrames`,
 * naming the module. A normal run is the positive control: `complete: true`, no warning.
 *
 * Writes `~/Movies/bay/brf-export-probe-*.mp4` and deletes it; undoes its edits; never saves.
 * `FRAME_PNG=/path.png` also keeps the file's frame at 3.0 s, to read the count ("3,200") by eye.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { attach, check, PreconditionError, runProbe } from './cdp.mjs'

const run = promisify(execFile)
import { FFMPEG, FFPROBE } from './ffmpeg.mjs'
const sabotage = process.env.VERIFY_PROBE === '1'

/** The guide's "Counter with a growing bar" (src/main/mcp/docs/brf.md), verbatim. */
const COUNTER = `import { interpolate, spring, Easing } from 'bay'

export const vars = { value: 3200, label: 'new users this week', accent: '#FFB020' }

export default ({ t, vars }) => {
  const count = Math.round(interpolate(t, [0.2, 1.8], [0, vars.value], { easing: Easing.out(Easing.cubic) }))
  return (
    <scene duration={4}>
      <rect x="50%" y="50%" w="60%" h="30%" radius="3%" fill="#111118ee" in={['pop', 0.5]} out="fade" />
      <text x="50%" y="46%" size="11%" weight={900} fill={vars.accent}>{count.toLocaleString('en-US')}</text>
      <text x="50%" y="56%" size="3.4%" weight={600} fill="#ffffffcc" in={['fade', 0.4, 0.3]}>{vars.label}</text>
      <rect x="20%" y="61%" anchor={[0, 0.5]} w="60%" h={6} radius={3} fill={vars.accent}
        sx={spring(t, { delay: 0.2, damping: 200 })} />
    </scene>
  )
}`

/** Luma above this counts as lit: well clear of h264's noise around black. */
const LIT = 24
/**
 * Agreement between the PNG oracle and the h264 file: the shape of the frame, not its bytes.
 *
 * Whole-frame numbers cannot hold this graphic: the count and bar light ~2% of the frame, so a
 * tolerance loose enough for h264 against PNG was as large as the whole graphic, and "3,200"
 * against "7" moved the lit share by 0.75 points. So the frame is also measured as a grid of lit
 * shares, cell by cell, where the count fills a cell and a changed number moves it by tens of
 * points. Measured on a working export: whole-frame lit within 0.03 points, mean within 0.35.
 */
const GX = 8
const GY = 6
const MEAN_TOLERANCE = 1
const LIT_TOLERANCE = 0.25
const CELL_TOLERANCE = 4

const { evaluate, patch } = await attach()

/**
 * Mean luma, lit share and the per-cell lit shares (all percent) of a `w`x`h` gray frame. Runs in
 * node on the file's frames and, as source, in the page on the oracle's — one measure, both sides.
 */
function measure(gray, w, h, litAbove, gx, gy) {
  let sum = 0
  let lit = 0
  const cellLit = new Array(gx * gy).fill(0)
  const cellN = new Array(gx * gy).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x]
      const cell = Math.min(gy - 1, Math.floor((y * gy) / h)) * gx + Math.min(gx - 1, Math.floor((x * gx) / w))
      sum += v
      cellN[cell] += 1
      if (v > litAbove) {
        lit += 1
        cellLit[cell] += 1
      }
    }
  }
  const n = w * h
  return {
    mean: +(sum / n).toFixed(2),
    lit: +((lit / n) * 100).toFixed(2),
    cells: cellLit.map((c, i) => +((c / cellN[i]) * 100).toFixed(1))
  }
}
const cellDistance = (a, b) => Math.max(...a.cells.map((c, i) => Math.abs(c - b.cells[i])))

await runProbe(async () => {
  await evaluate(`localStorage.setItem('bay.debug', '1')`)
  const present = await evaluate(`typeof window.bayMcp?.execute === 'function' && typeof window.bayEngine?.brfRuntime?.dispose === 'function'`)
  if (!present) throw new PreconditionError('window.bayMcp / bayEngine.brfRuntime missing', 'is bay.debug set and the build current?')

  let seq = 0
  const call = (tool, args = {}) =>
    evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `e${++seq}`, tool, args })})`, 90_000)

  const stale = await evaluate(`(() => {
    const s = window.bayEngine.store.getState()
    const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
    return tl.tracks.flatMap((t) => t.items.map((i) => i.id))
  })()`)
  if (stale.length > 0) {
    const cleared = await call('delete_items', { itemIds: stale })
    if (!cleared.ok) throw new PreconditionError('could not clear the timeline', cleared.error)
  }

  const written = await call('write_brf', { code: COUNTER, atFrame: 0, name: 'Counter probe' })
  if (!written.ok) throw new PreconditionError('write_brf refused the guide example', written.error)
  const itemId = written.value.itemId

  const tl = await evaluate(`(() => {
    const s = window.bayEngine.store.getState()
    const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
    return { fps: tl.fps, width: tl.width, height: tl.height, background: tl.background ?? null }
  })()`)
  const total = Math.round(4 * tl.fps)
  // Measured at a small size derived from the canvas, so a vertical project measures correctly.
  const W = tl.width >= tl.height ? 320 : 2 * Math.round((320 * tl.width) / tl.height / 2)
  const H = tl.width >= tl.height ? 2 * Math.round((320 * tl.height) / tl.width / 2) : 320
  console.log(`canvas ${tl.width}x${tl.height} @ ${tl.fps} fps, background ${tl.background}; ${total} frames; measured at ${W}x${H}`)

  /** The oracle: every frame through renderFrame (what preview_frame returns), measured like the file. */
  const oracle = () =>
    evaluate(`(async () => {
      const st = window.bayEngine.store.getState()
      const out = []
      for (let frame = 0; frame < ${total}; frame++) {
        const r = await window.bayEngine.renderFrame({ project: st.project, timelineId: st.project.activeTimelineId, frame, maxSize: ${Math.max(W, H)} })
        const img = new Image(); img.src = r.dataUrl; await img.decode()
        const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H}
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, ${W}, ${H})
        const d = x.getImageData(0, 0, ${W}, ${H}).data
        const gray = new Float64Array(${W * H})
        for (let i = 0; i < gray.length; i++) gray[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000
        out.push({ frame, ...(${measure.toString()})(gray, ${W}, ${H}, ${LIT}, ${GX}, ${GY}), pending: r.pending, placeholders: r.placeholders })
      }
      return out
    })()`, 120_000)

  const dir = await mkdtemp(join(tmpdir(), 'bay-brf-export-'))
  const exported = []
  /** The last `track_export` answer: what the agent is told about the file. */
  let lastJob = null

  /** Exports cold (cache cleared), waits for the job, and returns every frame's profile. */
  const exportAll = async (label) => {
    const outputPath = join(homedir(), 'Movies', 'bay', `brf-export-probe-${process.pid}-${label}.mp4`)
    exported.push(outputPath)
    await evaluate(`window.bayEngine.brfRuntime.dispose()`)
    const started = await call('export_timeline', { outputPath, format: 'mp4' })
    if (!started.ok) throw new PreconditionError('export_timeline refused', started.error)
    let job
    for (let i = 0; i < 240; i++) {
      job = await call('track_export', { jobId: started.value.jobId })
      if (!job.ok) throw new PreconditionError('track_export failed', job.error)
      if (job.value.finished) break
      await new Promise((r) => setTimeout(r, 500))
    }
    check(`${label}: the export finished`, job.value.stage, 'done')
    lastJob = job.value
    // The job reports done when main has closed the file; give the filesystem a moment anyway.
    for (let i = 0; i < 20; i++) {
      if (await stat(outputPath).then((s) => s.size > 0, () => false)) break
      await new Promise((r) => setTimeout(r, 250))
    }
    const probe = await run(FFPROBE, ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'json', outputPath])
    const stream = JSON.parse(probe.stdout).streams[0]
    check(`${label}: ffprobe -count_frames reads duration x fps frames (${total})`, Number(stream.nb_read_frames), total)
    const raw = join(dir, `${label}.gray`)
    await run(FFMPEG, ['-v', 'error', '-i', outputPath, '-vf', `scale=${W}:${H}`, '-vsync', '0',
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-y', raw])
    const bytes = await readFile(raw)
    const size = W * H
    if (bytes.length !== size * total) throw new PreconditionError(`decoded ${bytes.length} bytes, expected ${size * total}`)
    return Array.from({ length: total }, (_, f) => ({ frame: f, ...measure(bytes.subarray(f * size, (f + 1) * size), W, H, LIT, GX, GY) }))
  }

  /** Every frame of the file against the oracle; returns the frames that disagree. */
  const compare = (label, want, got) => {
    const bad = []
    for (let f = 0; f < total; f++) {
      const p = want[f]
      const e = got[f]
      const cells = cellDistance(p, e)
      if (Math.abs(p.mean - e.mean) > MEAN_TOLERANCE || Math.abs(p.lit - e.lit) > LIT_TOLERANCE || cells > CELL_TOLERANCE) {
        bad.push({ frame: f, preview: { mean: p.mean, lit: p.lit }, file: { mean: e.mean, lit: e.lit }, cells })
      }
    }
    for (const seconds of [0.1, 1.0, 3.0]) {
      const f = Math.round(seconds * tl.fps)
      console.log(`${label} ${String(seconds).padEnd(4)}s  frame ${String(f).padStart(3)}  preview ${want[f].mean} / ${want[f].lit}%   file ${got[f].mean} / ${got[f].lit}%   worst cell ${cellDistance(want[f], got[f]).toFixed(1)} pts`)
    }
    for (const b of bad.slice(0, 8)) console.log(`${label} MISMATCH frame ${b.frame}: preview ${JSON.stringify(b.preview)} file ${JSON.stringify(b.file)} worst cell ${b.cells} pts`)
    const worst = Math.max(...want.map((p, f) => cellDistance(p, got[f])))
    console.log(`${label} worst cell over all ${total} frames: ${worst.toFixed(1)} pts (tolerance ${CELL_TOLERANCE})`)
    return bad
  }

  try {
    // -- the oracle, and that it can see the graphic ------------------------------------------
    const want = await oracle()
    check('the oracle drew every frame: nothing pending, no placeholder', want.filter((r) => r.pending > 0 || r.placeholders > 0).length, 0)
    const pastEnd = await evaluate(`(async () => {
      const st = window.bayEngine.store.getState()
      const r = await window.bayEngine.renderFrame({ project: st.project, timelineId: st.project.activeTimelineId, frame: ${total + 5}, maxSize: 320 })
      return r.drawn
    })()`)
    check('the control: past the module there is nothing to draw', pastEnd, 0)
    // The count is on screen from frame 0 (it has no entrance), so every frame is lit — frame 0
    // least, a lone "0" (~0.2% of the frame). A black frame lights 0.
    const floor = 0.1
    check(`the oracle lights more than ${floor}% on every frame (the graphic is there to go missing)`, Math.min(...want.map((r) => r.lit)), (n) => n > floor)

    if (sabotage) {
      // The export that does not wait: settle answers at once, so a frame whose scene is still
      // in the worker is drawn without it.
      await patch('window.bayEngine.brfRuntime', 'settle', `() => () => Promise.resolve()`)
    }

    // -- the default export --------------------------------------------------------------------
    const got = await exportAll('default')
    if (process.env.FRAME_PNG) {
      // For reading the number with your own eyes: the file's frame at 3.0 s, full size.
      await run(FFMPEG, ['-v', 'error', '-ss', '3.0', '-i', exported[0], '-frames:v', '1', '-y', process.env.FRAME_PNG])
      console.log(`wrote the file's frame at 3.0 s to ${process.env.FRAME_PNG}`)
    }
    const bad = compare('default ', want, got)
    // Missing = lighting less than half of what the oracle lights on that frame.
    const missing = got.filter((r) => r.lit < want[r.frame].lit / 2).map((r) => r.frame)
    console.log(`frames of the file without the graphic: ${missing.length ? missing.join(', ') : 'none'}`)
    console.log(`track_export: complete ${lastJob.complete}; incompleteFrames ${JSON.stringify(lastJob.incompleteFrames ?? null)}`)
    if (lastJob.warning) console.log(`track_export warning: ${lastJob.warning}`)
    if (sabotage) {
      const caught = bad.length > 0 || missing.length > 0
      console.log(caught
        ? `\nSELF-CHECK PASSED: the probe caught ${bad.length} mismatched / ${missing.length} empty frame(s) from an export that did not wait`
        : '\nSELF-CHECK FAILED: the probe passed against an export that did not wait for the worker')
      // What the agent is told about that file. Every frame the file is missing the graphic on
      // must be among the frames track_export reports — an export that wrote them and answered a
      // plain `done` is the silent wrong picture.
      const reported = new Set((lastJob.incompleteFrames?.ranges ?? []).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)))
      const unreported = missing.filter((f) => !reported.has(f))
      check('track_export does not call the export complete', lastJob.complete, false)
      check(`track_export names every frame of the file that is missing the graphic (${missing.length})`, unreported.join(','), '')
      check('track_export names the module', (lastJob.incompleteFrames?.items ?? []).map((i) => i.name).join(','), 'Counter probe')
      return caught
    }
    check('no frame of the file is missing the graphic', missing.length, 0)
    check('every frame of the file matches preview_frame', bad.length, 0)
    // The positive control for the report: a correct file is called complete, with no warning.
    check('track_export calls the correct export complete', lastJob.complete, true)
    check('and gives it no warning', lastJob.warning ?? null, null)

    // -- a placement override ------------------------------------------------------------------
    const current = (await call('inspect_item', { itemId })).value?.variables?.value ?? 3200
    const next = Number(current) === 7 ? 3200 : 7
    const edited = await call('edit_item', { itemId, variables: { value: next } })
    if (!edited.ok) throw new PreconditionError('edit_item variables refused', edited.error)
    const wantOverride = await oracle()
    const at3 = Math.round(3 * tl.fps)
    const moved = cellDistance(want[at3], wantOverride[at3])
    console.log(`override value ${current} -> ${next}: oracle at 3.0 s lit ${want[at3].lit}% -> ${wantOverride[at3].lit}%, worst cell moved ${moved} pts`)
    check('the control: the override changes the picture at 3.0 s by far more than the tolerance', moved, (d) => d > 3 * CELL_TOLERANCE)
    const gotOverride = await exportAll('override')
    const badOverride = compare('override', wantOverride, gotOverride)
    check('with the override, every frame of the file matches preview_frame', badOverride.length, 0)
    check('the file shows the override, not the default, at 3.0 s', cellDistance(gotOverride[at3], wantOverride[at3]) < cellDistance(gotOverride[at3], want[at3]), true)
    return true
  } finally {
    await rm(dir, { recursive: true, force: true })
    for (const file of exported) await rm(file, { force: true })
  }
}, { timeoutMs: 600_000 })
