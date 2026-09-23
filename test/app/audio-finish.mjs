/**
 * J/L cuts, ducking and loudness mastering in the running app — the preview's mixer metered, and
 * one export through the real `encode.ts` measured.
 *
 * Which path each check covers, stated because "a probe of the preview is not a probe of the
 * export":
 *
 * - **PREVIEW** checks read the track analysers while the transport plays. They see what Web
 *   Audio actually mixed: the J-cut's stand-in element, the silenced picture element, the duck.
 * - **EXPORT** checks run `export_timeline` with `loudness: "streaming"` in this app, then decode
 *   the delivered mp4 with the bundled ffmpeg and measure it here, with this probe's own meter.
 *   `encode.ts` imports Electron, so this is the only thing that exercises it end to end.
 * - Mastering has no preview side by design (it is off in the preview; see `@shared/loudness`).
 *
 * Every positive check has a control run with the feature switched off, so a meter that could
 * not see the effect would fail rather than pass: the J-cut's lead region is silent without the
 * lead, and the bed is not down without the duck.
 *
 * Signals are generated tones (450 Hz picture A, 900 Hz picture B and voice, 600 Hz music), each
 * on an exact analysis bin, so a level is a level and not speech's envelope. Files go to a temp
 * folder and the export to ~/Movies/bay; both are deleted at the end. The project is replaced
 * for the run and restored by `attach()`'s snapshot; nothing is saved.
 *
 * **Playback must be able to advance.** A window macOS considers occluded gets no rAF and 1 Hz
 * timers, so the transport sits still and every meter reads a single moment — measured: 4
 * samples, all at frame 40, in a 3.6 s sweep. That is reported as CANNOT MEASURE, not as a
 * failure. An instance launched for probing should pass `--disable-renderer-backgrounding
 * --disable-background-timer-throttling --disable-backgrounding-occluded-windows`.
 *
 *   PORT=9234 node test/app/audio-finish.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe, PreconditionError } from './cdp.mjs'

const require_ = createRequire(import.meta.url)
const FFMPEG = require_('ffmpeg-ffprobe-static').ffmpegPath
const RATE = 48_000
const FPS = 30

const dir = mkdtempSync(join(tmpdir(), 'bay-audio-finish-'))
const make = (name, args) => {
  const path = join(dir, name)
  execFileSync(FFMPEG, ['-v', 'error', '-y', ...args, path])
  return path
}
const tone = (hz) => `aevalsrc=0.6*sin(2*PI*${hz}*t):s=${RATE}:d=10`
const clipA = make('a.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=10', '-f', 'lavfi', '-i', tone(450), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'])
const clipB = make('b.mp4', ['-f', 'lavfi', '-i', 'smptebars=s=640x360:r=30:d=10', '-f', 'lavfi', '-i', tone(900), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'])
const music = make('music.wav', ['-f', 'lavfi', '-i', tone(600), '-ac', '2'])
const voice = make('voice.wav', ['-f', 'lavfi', '-i', tone(900), '-ac', '2'])

const moviesDir = join(homedir(), 'Movies', 'bay')
mkdirSync(moviesDir, { recursive: true })
const exportPath = join(moviesDir, `audio-finish-${process.pid}.mp4`)

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
const db = (ratio) => 20 * Math.log10(ratio)

const body = async () => {
  const assets = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths(${JSON.stringify([clipA, clipB, music, voice])})
    if (im.length !== 4) throw new Error('import returned ' + im.length)
    return im.map((e) => e.asset)
  })()`, 90_000)
  if (!assets.every((a) => a.hasAudio && !a.error)) {
    throw new PreconditionError('the probe media did not import with audio', JSON.stringify(assets))
  }
  const [A, B, M, V] = assets

  // Which media elements the mixer owns. An element no `MediaElementAudioSourceNode` has claimed
  // plays straight to the speakers — past every analyser — so "the J-cut's picture element is
  // silenced" cannot be seen on a meter at all; ownership is its observable. Measured: with the
  // claim deleted, every meter check here still passed.
  await patch('AudioContext.prototype', 'createMediaElementSource', `(original) => function (element) {
    ;(window.__afClaimed = window.__afClaimed || new WeakSet()).add(element)
    return original.call(this, element)
  }`)

  // A suspended AudioContext is silence that looks exactly like a broken mixer.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: 400, y: 300, button: 'left', clickCount: 1 })
  }

  /** Loads a timeline built from `spec`, plays from `startFrame` for `ms`, samples meters. */
  const sweep = (spec, startFrame, ms, trackIds) => evaluate(`(async () => {
    const { store, engine } = window.bayEngine
    const st = store.getState()
    const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    const spec = ${JSON.stringify(spec)}
    const layout = { left: 0, top: 0, width: base.width, height: base.height, opacity: 1, rotation: 0 }
    const item = (i) => ({ layout, volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...i })
    const timeline = { ...base, fps: ${FPS}, background: '#000000', transitions: [],
      tracks: spec.map((t) => ({ locked: false, muted: false, hidden: false, ...t, items: t.items.map(item) })) }
    store.getState().setProject({ ...st.project, assets: ${JSON.stringify(assets)}, timelines: [timeline], activeTimelineId: timeline.id })
    store.getState().setPlaying(false)
    store.getState().setPlayhead(${startFrame})
    await new Promise(r => setTimeout(r, 1200))
    store.getState().setPlaying(true)
    const samples = []
    const t0 = performance.now()
    while (performance.now() - t0 < ${ms}) {
      const levels = engine.levels()
      const row = { frame: store.getState().playhead }
      for (const id of ${JSON.stringify(trackIds)}) row[id] = +(levels[id]?.rms ?? 0).toFixed(5)
      samples.push(row)
      await new Promise(r => setTimeout(r, 40))
    }
    store.getState().setPlaying(false)
    return { samples, state: engine.audio.context().state }
  })()`, 90_000)

  // ---------------------------------------------------------------------------------------
  // PREVIEW — J-cut: B (900 Hz) on V2 at frame 90, sound leading its picture by 30 frames.
  // ---------------------------------------------------------------------------------------
  const jcut = (lead) => [
    { id: 'pv1', kind: 'video', name: 'V1', items: [{ id: 'pa', assetId: A.id, trackId: 'pv1', from: 0, durationInFrames: 90, sourceStartUs: 0 }] },
    { id: 'pv2', kind: 'video', name: 'V2', items: [{ id: 'pb', assetId: B.id, trackId: 'pv2', from: 90, durationInFrames: 60, sourceStartUs: 4_000_000, ...(lead ? { audioLeadFrames: lead } : {}) }] }
  ]
  const withLead = await sweep(jcut(30), 40, 3600, ['pv1', 'pv2'])
  const owned = await evaluate(`(() => {
    const pool = window.bayEngine.engine.pool
    const claimed = window.__afClaimed ?? new WeakSet()
    const el = (id) => pool.peek(id, 0)?.element ?? null
    return { a: claimed.has(el(${JSON.stringify(A.id)})), b: claimed.has(el(${JSON.stringify(B.id)})), bIsVideo: el(${JSON.stringify(B.id)}) instanceof HTMLVideoElement }
  })()`)
  const without = await sweep(jcut(0), 40, 3600, ['pv1', 'pv2'])
  const span = (run) => `${run.samples.length} samples, frames ${run.samples[0]?.frame}…${run.samples.at(-1)?.frame}`
  console.log(`J-cut sweeps: with lead ${span(withLead)}; without ${span(without)}`)
  for (const run of [withLead, without]) {
    const frames = run.samples.map((r) => r.frame)
    if (run.samples.length < 20 || Math.max(...frames) - Math.min(...frames) < 60) {
      throw new PreconditionError('playback did not advance during the sweep', `${span(run)} — is the window occluded or throttled?`)
    }
  }
  check('preview', 'the audio context is running', withLead.state === 'running', withLead.state)
  const inRange = (rows, lo, hi) => rows.filter((r) => r.frame >= lo && r.frame <= hi)
  const leadWith = inRange(withLead.samples, 64, 86)
  const leadWithout = inRange(without.samples, 64, 86)
  const early = inRange(withLead.samples, 40, 55)
  const afterCut = inRange(withLead.samples, 64, 140)
  const ownWith = inRange(withLead.samples, 96, 140).map((r) => r.pv2)
  const ownWithout = inRange(without.samples, 96, 140).map((r) => r.pv2)
  check('preview', 'the lead region was sampled', leadWith.length >= 5 && leadWithout.length >= 5, `${leadWith.length}/${leadWithout.length} samples`)
  check('preview', "control: without a lead, B is silent under A's picture", Math.max(0, ...leadWithout.map((r) => r.pv2)) < 0.01, `max ${Math.max(0, ...leadWithout.map((r) => r.pv2))}`)
  check('preview', "J-cut: B is heard under A's picture, before its own", median(leadWith.map((r) => r.pv2)) > 0.1, `median rms ${median(leadWith.map((r) => r.pv2))}`)
  check('preview', 'J-cut: not before the lead starts (frame 60)', Math.max(0, ...early.map((r) => r.pv2)) < 0.01, `max ${Math.max(0, ...early.map((r) => r.pv2))} over frames 40–55`)
  const floor = Math.min(...afterCut.map((r) => r.pv2))
  check('preview', 'no seam at the picture cut: B never drops out from lead to its own span', floor > 0.05, `min rms ${floor} over frames 64–140`)
  const doubled = median(ownWith) / median(ownWithout)
  check('preview', 'the stand-in carries B at the level its own element would', doubled > 0.8 && doubled < 1.25, `own-span level with/without lead ×${doubled.toFixed(3)}`)
  check('preview', "control: an ordinary clip's picture element is owned by the mixer", owned.a === true)
  check('preview', "J-cut: B's picture element is owned by the mixer too, so it cannot reach the speakers unmixed", owned.b === true && owned.bIsVideo, JSON.stringify(owned))

  // ---------------------------------------------------------------------------------------
  // PREVIEW — duck: music (450) on A1 ducked 12 dB under A2, where the voice (900) sits 60–120.
  // ---------------------------------------------------------------------------------------
  const duck = (on) => [
    { id: 'pm', kind: 'audio', name: 'A1', items: [{ id: 'bed', assetId: M.id, trackId: 'pm', from: 0, durationInFrames: 240, sourceStartUs: 0, ...(on ? { duck: { keyTrackId: 'pd', amountDb: 12, attackFrames: 6, releaseFrames: 6 } } : {}) }] },
    { id: 'pd', kind: 'audio', name: 'A2', items: [{ id: 'line', assetId: V.id, trackId: 'pd', from: 60, durationInFrames: 60, sourceStartUs: 0 }] }
  ]
  const ducked = await sweep(duck(true), 10, 5200, ['pm', 'pd'])
  const flat = await sweep(duck(false), 10, 5200, ['pm', 'pd'])
  const level = (run, lo, hi) => median(inRange(run.samples, lo, hi).map((r) => r.pm))
  const duckDb = db(level(ducked, 72, 110) / level(ducked, 20, 48))
  const flatDb = db(level(flat, 72, 110) / level(flat, 20, 48))
  const recovered = db(level(ducked, 135, 160) / level(ducked, 20, 48))
  check('preview', 'control: without a duck the bed does not move under the voice', Math.abs(flatDb) < 1, `${flatDb.toFixed(2)} dB`)
  check('preview', 'duck: the bed sits 12 dB down under the voice (±1.5 dB, 8-bit analyser)', Math.abs(duckDb + 12) <= 1.5, `${duckDb.toFixed(2)} dB`)
  check('preview', 'duck: back to unity after the release', Math.abs(recovered) < 1, `${recovered.toFixed(2)} dB`)

  // ---------------------------------------------------------------------------------------
  // EXPORT — the J-cut and the duck together, mastered to streaming, through encode.ts.
  // ---------------------------------------------------------------------------------------
  const combined = [
    ...jcut(30),
    { id: 'pm', kind: 'audio', name: 'A1', items: [{ id: 'bed', assetId: M.id, trackId: 'pm', from: 0, durationInFrames: 150, sourceStartUs: 0, volume: 0.5, duck: { keyTrackId: 'pv2', amountDb: 12, attackFrames: 6, releaseFrames: 6 } }] }
  ]
  await sweep(combined, 0, 50, [])
  const started = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: 'af-export', tool: 'export_timeline', args: { outputPath: exportPath, format: 'mp4', loudness: 'streaming' } })})`, 60_000)
  if (!started.ok) throw new PreconditionError('export_timeline refused', started.error)
  let tracked = null
  for (let i = 0; i < 240; i += 1) {
    const r = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `af-track-${i}`, tool: 'track_export', args: { jobId: started.value.jobId } })})`)
    if (r.ok && r.value.finished) { tracked = r.value; break }
    await new Promise((res) => setTimeout(res, 500))
  }
  console.log('\ntrack_export:', JSON.stringify(tracked, null, 1))
  check('export', 'the export finished', tracked?.stage === 'done', tracked?.stage ?? 'never finished')
  check('export', 'track_export reports the loudness it measured, status met', tracked?.loudness?.status === 'met', tracked?.loudness?.summary)
  if (tracked?.stage === 'done' && existsSync(exportPath)) {
    // This probe's own meter, not bay's.
    const run = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', exportPath, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 })
    const summary = run.stderr.slice(run.stderr.lastIndexOf('Summary:'))
    const I = Number(/I:\s+(\S+)\s+LUFS/.exec(summary)?.[1])
    const TP = Number(/Peak:\s+(\S+)\s+dBFS/.exec(summary)?.[1])
    check('export', 'the delivered file reads −14 LUFS ±0.5', Math.abs(I + 14) <= 0.5, `I ${I}`)
    check('export', 'and its true peak is at or under −1 dBTP', TP <= -1, `TP ${TP}`)
    check('export', "track_export's numbers are the file's", Math.abs((tracked.loudness?.measuredLufs ?? 99) - I) <= 0.05 && Math.abs((tracked.loudness?.measuredTruePeakDbtp ?? 99) - TP) <= 0.05)

    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', exportPath, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 64 << 20 })
    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
    const per = RATE / FPS
    const goertzel = (hz, frame) => {
      const w = (2 * Math.PI * Math.round((per * hz) / RATE)) / per
      const c = 2 * Math.cos(w)
      let s1 = 0, s2 = 0
      for (let i = 0; i < per; i += 1) {
        const s0 = (samples[frame * per + i] ?? 0) / 32768 + c * s1 - s2
        s2 = s1
        s1 = s0
      }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (per / 2)
    }
    const bOwn = goertzel(900, 120)
    check('export', 'J-cut in the file: B is heard 30 frames before its picture', goertzel(900, 64) > bOwn * 0.8, `900 Hz at frame 64 ${goertzel(900, 64).toFixed(4)} vs own span ${bOwn.toFixed(4)}`)
    check('export', 'and not before the lead', goertzel(900, 56) < bOwn * 0.05, `900 Hz at frame 56 ${goertzel(900, 56).toFixed(4)}`)
    // The key is B, audible from 60 (its lead): the bed (600 Hz) is open at 30 and down at 100.
    const bedDb = db(goertzel(600, 100) / goertzel(600, 30))
    check('export', 'duck in the file: the bed is 12 dB down under the key (±1 dB)', Math.abs(bedDb + 12) <= 1, `${bedDb.toFixed(2)} dB`)
  }

  const bad = checks.filter((c) => !c.ok).length
  console.log(`\n${checks.length - bad}/${checks.length} checks passed`)
  close()
  return bad === 0
}

// Cleanup inside the probe body: `runProbe` exits the process when it settles, so anything after
// it never runs — the first version left its exports in ~/Movies/bay that way.
await runProbe(async () => {
  try {
    return await body()
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(exportPath, { force: true })
  }
}, { timeoutMs: 400_000 })
