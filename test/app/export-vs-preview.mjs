/**
 * Does the delivered MP4 match what `preview_frame` says each frame should be?
 *
 * `preview_frame` is an oracle for this: it produces the correct picture for any frame
 * independently of the export path — different pool, different loop, its own awaited seeks.
 * So the strongest available check on an export is to compare the **encoded file** against
 * it, frame by frame, across every clip boundary.
 *
 * That is stronger than "no exported frame is uniformly background", which was the first
 * check considered. Uniform-background catches a *missing* frame and misses a *wrong* one —
 * an incoming clip decoded at the outgoing clip's source time looks perfectly healthy by
 * that measure and is still a visible error at the cut.
 *
 * The comparison is on luma statistics with a tolerance, not on pixels: the export is h264
 * and the oracle is PNG, so exact equality is not available and demanding it would produce a
 * check nobody can keep green. A black frame is unmistakable at any tolerance — 0.0 against
 * 9.4 — which is the failure this exists to catch.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe } from './cdp.mjs'

const run = promisify(execFile)
const FFMPEG = process.env.FFMPEG ??
  'node_modules/.pnpm/ffmpeg-ffprobe-static@6.1.2-rc.1_supports-color@7.2.0/node_modules/ffmpeg-ffprobe-static/ffmpeg'
const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const W = 320
const H = 180
/** Frames either side of the cut at 150, plus one well inside each clip. */
const SAMPLES = [10, 148, 149, 150, 151, 160]

const { evaluate, close } = await attach()

/** Mean luma and percent non-zero over a raw gray frame — the same measure on both sides. */
function profile(bytes) {
  let sum = 0
  let nz = 0
  for (const v of bytes) {
    sum += v
    if (v > 0) nz += 1
  }
  return { mean: +(sum / bytes.length).toFixed(1), nonZero: +((nz / bytes.length) * 100).toFixed(1) }
}

await runProbe(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bay-export-'))
  const outputPath = join(dir, 'probe.mp4')

  const asset = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
    if (!im.length) throw new Error('import returned nothing')
    return im[0].asset
  })()`, 60_000)

  // One project, used by both consumers, so any difference is the consumer and not the edit.
  const build = `(() => {
    const st = window.bayEngine.store.getState()
    const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    const mk = (i, from, dur, src) => ({
      id: 'x_v' + i, kind: 'video', name: 'V' + (i + 1), locked: false, muted: false, hidden: false,
      items: [{ id: 'x_i' + i, assetId: ${JSON.stringify(asset.id)}, trackId: 'x_v' + i,
        from, durationInFrames: dur, sourceStartUs: src,
        layout: { left: 0, top: -1166, width: base.width, height: 3413, opacity: 1, rotation: 0 },
        volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1 }]
    })
    const timeline = { ...base, background: '#000000', tracks: [mk(0, 0, 150, 20000000), mk(1, 150, 60, 0)] }
    return { ...st.project, assets: [${JSON.stringify(asset)}],
             timelines: [timeline], activeTimelineId: timeline.id }
  })()`

  // -- the oracle -----------------------------------------------------------
  const oracle = await evaluate(`(async () => {
    const project = ${build}
    const out = []
    for (const frame of ${JSON.stringify(SAMPLES)}) {
      const r = await window.bayEngine.renderFrame({
        project, timelineId: project.activeTimelineId, frame, maxSize: ${Math.max(W, H)}
      })
      const img = new Image()
      img.src = r.dataUrl
      await img.decode().catch(() => {})
      const c = document.createElement('canvas')
      c.width = ${W}; c.height = ${H}
      const x = c.getContext('2d', { willReadFrequently: true })
      x.drawImage(img, 0, 0, ${W}, ${H})
      const d = x.getImageData(0, 0, ${W}, ${H}).data
      let sum = 0, nz = 0, n = 0
      for (let i = 0; i < d.length; i += 4) {
        const y = (d[i] * 299 + d[i+1] * 587 + d[i+2] * 114) / 1000
        sum += y; n++; if (y > 0) nz++
      }
      out.push({ frame, mean: +(sum / n).toFixed(1), nonZero: +((nz / n) * 100).toFixed(1),
                 pending: r.pending, placeholders: r.placeholders })
    }
    return out
  })()`, 120_000)

  // -- the real export, all the way to an encoded file -----------------------
  //
  // Self-check: under VERIFY_PROBE the export is handed a timeline whose cut is 10 frames
  // early. The oracle still describes the real edit, so frames 140-149 must disagree. The
  // break is on the **export** side deliberately: sabotaging the oracle would move the
  // probe's own expectation, which proves only that two identical things are identical.
  const sabotage = process.env.VERIFY_PROBE === '1'
  const exported = await evaluate(`(async () => {
    const { FrameExporter } = window.bayEngine
    const project = ${build}
    if (${sabotage}) {
      const tl = project.timelines[0]
      tl.tracks[0].items[0].durationInFrames = 140
      tl.tracks[1].items[0].from = 140
    }
    const job = await window.bay.export.start({
      project, timelineId: project.activeTimelineId, format: 'mp4',
      outputPath: ${JSON.stringify(outputPath)}, width: ${W}, height: ${H},
      fromFrame: 0, toFrame: 209
    })
    const outcome = await new FrameExporter({
      project, timelineId: project.activeTimelineId, jobId: job.jobId,
      width: ${W}, height: ${H}, fromFrame: 0, toFrame: 209
    }).run()
    return { jobId: job.jobId, ...outcome }
  })()`, 180_000)
  console.log('export         ', JSON.stringify(exported))

  // Give the encoder a moment to finish muxing after the last frame is taken.
  await new Promise((r) => setTimeout(r, 2500))

  const rows = []
  for (const frame of SAMPLES) {
    const raw = join(dir, `f${frame}.gray`)
    await run(FFMPEG, ['-v', 'error', '-i', outputPath, '-vf', `select=eq(n\\,${frame})`,
      '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-y', raw])
    rows.push({ frame, ...profile(await readFile(raw)) })
  }

  console.log('')
  console.log('frame    preview mean/nonZero      export mean/nonZero      verdict')
  let mismatches = 0
  for (const frame of SAMPLES) {
    const p = oracle.find((r) => r.frame === frame)
    const e = rows.find((r) => r.frame === frame)
    // h264 against PNG: compare the shape of the frame, not its bytes.
    const close = Math.abs(p.mean - e.mean) <= 2 && Math.abs(p.nonZero - e.nonZero) <= 4
    if (!close) mismatches += 1
    console.log(
      `${String(frame).padStart(5)}    ${String(p.mean).padStart(6)} / ${String(p.nonZero).padStart(5)}%` +
      `          ${String(e.mean).padStart(6)} / ${String(e.nonZero).padStart(5)}%` +
      `         ${close ? 'match' : 'MISMATCH'}`
    )
  }

  await rm(dir, { recursive: true, force: true })

  // The oracle has to be trustworthy for any of this to mean anything.
  const oracleIncomplete = oracle.filter((r) => r.pending > 0 || r.placeholders > 0)
  console.log('')
  if (oracleIncomplete.length > 0) {
    console.log(`CANNOT TRUST  preview_frame itself reported pending items at frames ` +
      `${oracleIncomplete.map((r) => r.frame).join(', ')} — it is not an oracle for this run.`)
    close()
    return false
  }

  const ok = mismatches === 0
  if (sabotage) {
    console.log(ok
      ? 'SELF-CHECK FAILED: the probe passed against an export whose cut was 10 frames early'
      : `SELF-CHECK PASSED: the probe detected ${mismatches} frame(s) the export got wrong`)
    close()
    return !ok
  }
  console.log(ok
    ? 'PASS  every sampled frame of the encoded file matches preview_frame'
    : `FAIL  ${mismatches} frame(s) of the encoded file disagree with preview_frame`)
  close()
  return ok
})
