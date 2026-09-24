/**
 * Detach audio in the running app: the tool, the preview's mixer, and one export — each check
 * labelled with the path it covers, because a probe of the preview is not a probe of the export.
 *
 * - **PREVIEW** reads the track analysers while the transport plays, and the media pool's elements.
 *   After `detach_audio` and a 30-frame picture fade-out, the audio track must stay at full level
 *   through the fade and the picture's own track must be silent. The control is the same fade on
 *   the attached clip, where the video track's meter must fall — proving the meter sees a fade.
 *   One decode: while the sound lines up with its picture there is exactly one element for the
 *   file; the positive control slips the sound off its picture (linked: false) and a second element
 *   must appear, so the counter can see one.
 * - **EXPORT** renders frames 0–90 and measures the file: the picture's luma falls through the fade
 *   while the 450 Hz tone stays full. Control: the same export after `reattach`, where the tone
 *   falls with the picture.
 *
 * The tone is 450 Hz on an exact analysis bin; the picture is testsrc2. Files go to a temp folder
 * and the exports to ~/Movies/bay; both are deleted. The project is replaced for the run and
 * restored by `attach()`'s snapshot; nothing is saved.
 *
 *   PORT=9275 node test/app/detach-audio.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe, PreconditionError } from './cdp.mjs'

const require_ = createRequire(import.meta.url)
import { FFMPEG } from './ffmpeg.mjs'
const RATE = 48_000
const FPS = 30

const dir = mkdtempSync(join(tmpdir(), 'bay-detach-'))
const clip = join(dir, 'shot.mp4')
execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=10', '-f', 'lavfi', '-i', `aevalsrc=0.6*sin(2*PI*450*t):s=${RATE}:d=10`, '-c:v', 'h264_videotoolbox', '-q:v', '90', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip])
const moviesDir = join(homedir(), 'Movies', 'bay')
mkdirSync(moviesDir, { recursive: true })
const exports = [join(moviesDir, `df-detach-${process.pid}-a.mp4`), join(moviesDir, `df-detach-${process.pid}-b.mp4`)]

const { send, evaluate, close, patch } = await attach()

const checks = []
const check = (path, name, ok, detail = '') => {
  checks.push({ path, name, ok })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} [${path}] ${name}${detail ? `  — ${detail}` : ''}`)
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : Number.NaN
}
let seq = 0
const call = async (tool, args) => {
  const r = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `da${++seq}`, tool, args })})`, 90_000)
  return r
}

const body = async () => {
  const [asset] = await evaluate(`(async () => (await window.bay.media.importPaths(${JSON.stringify([clip])})).map((e) => e.asset))()`, 90_000)
  if (!asset?.hasAudio || !asset.hasVideo || asset.error) throw new PreconditionError('the clip did not import with picture and sound', JSON.stringify(asset))

  await patch('AudioContext.prototype', 'createMediaElementSource', `(original) => function (element) {
    ;(window.__daClaimed = window.__daClaimed || new WeakSet()).add(element)
    return original.call(this, element)
  }`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: 400, y: 300, button: 'left', clickCount: 1 })
  }

  // V1: the clip 0–90 with a 30-frame fade-out; A1 empty, for the sound to land on.
  await evaluate(`(() => {
    const { store } = window.bayEngine
    const st = store.getState()
    const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    const layout = { left: 0, top: 0, width: base.width, height: base.height, opacity: 1, rotation: 0 }
    const timeline = { ...base, fps: ${FPS}, background: '#000000', transitions: [], tracks: [
      { id: 'dv1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [
        { id: 'pic', assetId: ${JSON.stringify(asset.id)}, trackId: 'dv1', from: 0, durationInFrames: 90, sourceStartUs: 0, layout, volume: 1, fadeInFrames: 0, fadeOutFrames: 30, speed: 1 } ] },
      { id: 'da1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [] }
    ] }
    store.getState().setProject({ ...st.project, assets: [${JSON.stringify(asset)}], timelines: [timeline], activeTimelineId: timeline.id })
    return true
  })()`)

  const play = (startFrame, ms, trackIds) => evaluate(`(async () => {
    const { store, engine } = window.bayEngine
    store.getState().setPlaying(false)
    store.getState().setPlayhead(${startFrame})
    await new Promise(r => setTimeout(r, 1200))
    store.getState().setPlaying(true)
    const samples = []
    let elements = 0
    let standIns = 0
    const t0 = performance.now()
    while (performance.now() - t0 < ${ms}) {
      const levels = engine.levels()
      const row = { frame: store.getState().playhead }
      for (const id of ${JSON.stringify(trackIds)}) row[id] = +(levels[id]?.rms ?? 0).toFixed(5)
      samples.push(row)
      let n = 0, s = 0
      engine.pool.forEach((entry) => { if (entry.assetId.startsWith(${JSON.stringify(asset.id)})) { n += 1; if (entry.assetId.includes('~detached~')) s += 1 } })
      elements = Math.max(elements, n)
      standIns = Math.max(standIns, s)
      await new Promise(r => setTimeout(r, 40))
    }
    store.getState().setPlaying(false)
    const claimed = window.__daClaimed ?? new WeakSet()
    const picture = engine.pool.peek(${JSON.stringify(asset.id)}, 0)?.element ?? null
    return { samples, elements, standIns, pictureOwned: claimed.has(picture), state: engine.audio.context().state }
  })()`, 90_000)
  const inRange = (rows, lo, hi) => rows.filter((r) => r.frame >= lo && r.frame <= hi)
  const measurable = (run, label) => {
    for (const [lo, hi] of [[10, 45], [70, 86]]) {
      if (inRange(run.samples, lo, hi).length < 3) {
        throw new PreconditionError(`playback did not reach frames ${lo}–${hi} in the ${label} sweep`, `${run.samples.length} samples, frames ${run.samples[0]?.frame}…${run.samples.at(-1)?.frame} — is the window occluded or throttled?`)
      }
    }
  }

  // -- PREVIEW control: attached, the picture's fade takes its sound down on V1's meter ----------
  const attached = await play(5, 3600, ['dv1', 'da1'])
  measurable(attached, 'attached')
  check('preview', 'the audio context is running', attached.state === 'running', attached.state)
  const attFull = median(inRange(attached.samples, 10, 45).map((r) => r.dv1))
  const attTail = median(inRange(attached.samples, 76, 86).map((r) => r.dv1))
  check('preview', 'control: attached, the clip sounds on V1 and the fade takes it down', attFull > 0.1 && attTail < attFull * 0.5, `V1 rms ${attFull.toFixed(4)} full, ${attTail.toFixed(4)} in the fade`)

  // -- detach_audio through the tool ---------------------------------------------------------------
  const detached = await call('detach_audio', { itemIds: ['pic'] })
  check('tool', 'detach_audio detaches the clip', detached.ok && detached.value.detached?.length === 1, detached.ok ? '' : detached.error)
  if (!detached.ok) return false
  const pair = detached.value.detached[0]
  check('tool', 'the sound lands on A1, linked', pair.audioTrackId === 'da1', JSON.stringify(pair))
  const picInfo = await call('inspect_item', { itemId: 'pic' })
  const audioInfo = await call('inspect_item', { itemId: pair.audioItemId })
  check('tool', 'inspect_item shows the link from the picture, and the picture as silent', picInfo.value?.link?.linkedItemIds?.[0] === pair.audioItemId && picInfo.value?.audio?.detached === true, JSON.stringify(picInfo.value?.audio))
  check('tool', "inspect_item shows the audio item's picture", audioInfo.value?.audio?.detachedFrom === 'pic' && audioInfo.value?.link?.linkedItemIds?.[0] === 'pic')
  check('tool', 'the sound took the clip\'s fade (detach is audibly a no-op)', audioInfo.value?.audio?.fadeOutFrames === 30)
  const unfade = await call('edit_item', { itemId: pair.audioItemId, fadeOutFrames: 0 })
  check('tool', 'the sound\'s fade comes off without touching the picture\'s', unfade.ok && (await call('inspect_item', { itemId: 'pic' })).value?.audio?.detached === true && (await evaluate(`window.bayEngine.store.getState().project.timelines[0].tracks[0].items[0].fadeOutFrames`)) === 30)

  // -- PREVIEW: the picture fades, the sound does not; one element for the file ------------------
  const run = await play(5, 3600, ['dv1', 'da1'])
  measurable(run, 'detached')
  const full = median(inRange(run.samples, 10, 45).map((r) => r.da1))
  const tail = median(inRange(run.samples, 76, 86).map((r) => r.da1))
  const pictureTrack = Math.max(0, ...run.samples.map((r) => r.dv1))
  check('preview', 'detached: the sound is on A1 at full level', full > 0.1, `A1 rms ${full.toFixed(4)}`)
  check('preview', 'detached: the picture fade leaves the sound at full level', tail > full * 0.85, `A1 rms ${tail.toFixed(4)} in the fade vs ${full.toFixed(4)}`)
  check('preview', "detached: the picture's own track is silent", pictureTrack < 0.01, `V1 max rms ${pictureTrack}`)
  check('preview', 'one decode: one element for the file, no stand-in', run.elements === 1 && run.standIns === 0, `elements ${run.elements}, stand-ins ${run.standIns}`)
  check('preview', "the picture element is owned by the mixer (it cannot reach the speakers unmixed)", run.pictureOwned === true)

  // Positive control for the element counter: slip the sound alone, and it needs its own element.
  const slipped = await call('edit_item', { itemId: pair.audioItemId, sourceStartSeconds: 0.1, linked: false })
  check('tool', 'edit_item linked: false slips the sound alone', slipped.ok && (await evaluate(`window.bayEngine.store.getState().project.timelines[0].tracks[0].items[0].sourceStartUs`)) === 0, slipped.ok ? '' : slipped.error)
  const slippedRun = await play(5, 1800, ['dv1', 'da1'])
  check('preview', 'control: slipped off its picture, the sound gets a stand-in element (the counter sees it)', slippedRun.standIns === 1 && slippedRun.elements === 2, `elements ${slippedRun.elements}, stand-ins ${slippedRun.standIns}`)
  check('preview', 'and still sounds, from the stand-in', median(inRange(slippedRun.samples, 10, 40).map((r) => r.da1)) > 0.1)
  await call('edit_item', { itemId: pair.audioItemId, sourceStartSeconds: 0, linked: false })

  // -- EXPORT ----------------------------------------------------------------------------------------
  const exportAndMeasure = async (path) => {
    const started = await call('export_timeline', { outputPath: path, format: 'mp4', fromFrame: 0, toFrame: 90 })
    if (!started.ok) throw new PreconditionError('export_timeline refused', started.error)
    let tracked = null
    for (let i = 0; i < 240; i += 1) {
      const r = await call('track_export', { jobId: started.value.jobId })
      if (r.ok && r.value.finished) { tracked = r.value; break }
      await new Promise((res) => setTimeout(res, 500))
    }
    if (tracked?.stage !== 'done' || !existsSync(path)) throw new PreconditionError('the export did not finish', JSON.stringify(tracked))
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 64 << 20 })
    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
    const per = RATE / FPS
    const tone = (frame) => {
      const w = (2 * Math.PI * Math.round((per * 450) / RATE)) / per
      const c = 2 * Math.cos(w)
      let s1 = 0, s2 = 0
      for (let i = 0; i < per; i += 1) {
        const s0 = (samples[frame * per + i] ?? 0) / 32768 + c * s1 - s2
        s2 = s1
        s1 = s0
      }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (per / 2)
    }
    // Picture: mean luma per frame, decoded with zimg (BT.709, limited → full).
    const size = [160, 90]
    const pix = execFileSync(FFMPEG, ['-v', 'error', '-i', path, '-vf', `scale=${size[0]}:${size[1]},zscale=min=709:rin=limited:m=709:r=full,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 })
    const luma = (frame) => {
      const n = size[0] * size[1]
      let sum = 0
      for (let i = 0; i < n; i += 1) sum += pix[frame * n + i]
      return sum / n
    }
    return { tone, luma, complete: tracked.complete }
  }
  const out = await exportAndMeasure(exports[0])
  console.log(`  export detached: tone 30 ${out.tone(30).toFixed(4)} / 85 ${out.tone(85).toFixed(4)}; luma 30 ${out.luma(30).toFixed(1)} / 85 ${out.luma(85).toFixed(1)}`)
  check('export', 'the picture fades out in the file', out.luma(85) < out.luma(30) * 0.35, `luma ${out.luma(30).toFixed(1)} → ${out.luma(85).toFixed(1)}`)
  check('export', 'and the detached sound stays at full level through it', out.tone(85) > out.tone(30) * 0.85 && out.tone(30) > 0.05, `450 Hz ${out.tone(30).toFixed(4)} → ${out.tone(85).toFixed(4)}`)

  const back = await call('detach_audio', { itemIds: ['pic'], action: 'reattach' })
  check('tool', 'reattach gives the picture its sound back and removes the audio item', back.ok && back.value.reattached?.[0]?.removedAudioItemIds?.[0] === pair.audioItemId, back.ok ? '' : back.error)
  const control = await exportAndMeasure(exports[1])
  console.log(`  export control:  tone 30 ${control.tone(30).toFixed(4)} / 85 ${control.tone(85).toFixed(4)}`)
  check('export', 'control: reattached, the fade takes the sound down in the file too', control.tone(85) < control.tone(30) * 0.4, `450 Hz ${control.tone(30).toFixed(4)} → ${control.tone(85).toFixed(4)}`)

  const bad = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - bad}/${checks.length} checks passed`)
  close()
  return bad === 0
}

await runProbe(async () => {
  try {
    return await body()
  } finally {
    rmSync(dir, { recursive: true, force: true })
    for (const path of exports) rmSync(path, { force: true })
  }
}, { timeoutMs: 400_000 })
