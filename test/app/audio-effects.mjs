/**
 * Audio effects in the running app: does the preview's sound change by what the chain says, and
 * is the exported file the same?
 *
 * **UNRUN.** Written with the feature and never executed: the engineer who wrote it was not
 * allowed to launch the app. Treat its first run as a run of the probe as much as of the app —
 * read the control lines before believing a verdict, and fix the probe where it is wrong.
 *
 * What `pnpm test` already holds, and what only this can:
 * - `main/audio-fx/eq-render.test.ts` renders every band type through the real ffmpeg and compares
 *   it with the Web Audio *specification's* arithmetic. It cannot show that Chromium's
 *   `BiquadFilterNode`, wired the way `AudioEngine.#setBands` wires it, does that arithmetic.
 *   The high-pass check below is aimed at exactly the trap there: a node reads a high-pass Q in
 *   decibels, so a 1 kHz Butterworth must read −3 dB at 1 kHz. Handed the linear 0.707 it reads
 *   +0.7 dB, 3.7 dB away — outside this probe's tolerance.
 * - `main/audio-fx/preview-export-parity.test.ts` shows the engine's *routing* names the processed
 *   file export reads. It cannot show that the element playing that file is the one heard, at
 *   the right position, with the clip's unprocessed sound silent.
 *
 * Two paths, labelled on every line:
 * - **PREVIEW** reads the track's analyser while the app plays (`engine.levels()`), 8-bit, so its
 *   tolerance is ±1.5 dB.
 * - **EXPORT** runs `export_timeline` to a WAV in this app and measures the file with bay's
 *   ffmpeg and this probe's own Goertzel.
 *
 * Every effect has its positive control: the same clip metered with the effect switched off must
 * read the specimen's own level, or the meter cannot be trusted about the effect.
 *
 * Leaves the project as it found it (`setProject` of the original, no save). Usage:
 *   ./run.sh && node test/app/audio-effects.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { attach, PreconditionError, runProbe } from './cdp.mjs'
import { FFMPEG } from './ffmpeg.mjs'

const RATE = 48_000
const FPS = 30
const TONE_HZ = 1000
const TONE_PEAK = 0.6
const PREVIEW_TOLERANCE_DB = 1.5
const EXPORT_TOLERANCE_DB = 0.5

const dir = mkdtempSync(join(tmpdir(), `bay-audio-effects-${process.pid}-`))
const tone = join(dir, 'tone.wav')
execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=${TONE_PEAK}*sin(2*PI*${TONE_HZ}*t):s=${RATE}:d=12`, '-ac', '2', tone])

const moviesDir = join(homedir(), 'Movies', 'bay')
mkdirSync(moviesDir, { recursive: true })

const { send, evaluate, close } = await attach()

const checks = []
const check = (path, name, ok, detail = '') => {
  checks.push({ path, name, ok })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} [${path}] ${name}${detail ? `  — ${detail}` : ''}`)
}
const db = (ratio) => 20 * Math.log10(Math.max(ratio, 1e-9))
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : Number.NaN
}

/** The cases: a chain, and what a 1 kHz tone at 0.6 should do through it (dB, relative to dry). */
const CASES = [
  {
    name: 'a 12 dB cut at 1 kHz (parametric band)',
    effects: [{ id: 'e1', kind: 'bell', params: { frequency: 1000, gain: -12, q: 1 } }],
    expectDb: -12,
    baked: false
  },
  {
    name: 'a Butterworth high-pass at 1 kHz (−3 dB at its corner; the Q-in-decibels trap)',
    effects: [{ id: 'e1', kind: 'highpass', params: { frequency: 1000, q: Math.SQRT1_2 } }],
    expectDb: -3.01,
    baked: false
  },
  {
    name: 'a 6 dB high shelf from 300 Hz',
    effects: [{ id: 'e1', kind: 'highshelf', params: { frequency: 300, gain: 6 } }],
    // Analytic for the slope-1 shelf at 1 kHz with a 300 Hz midpoint: 5.6 dB (`biquadResponseDb`).
    expectDb: 5.6,
    baked: false
  },
  {
    name: 'a 4:1 compressor at −24 dB (tone at −4.4 dBFS: 19.6 dB over, 14.7 dB of reduction)',
    effects: [{ id: 'e1', kind: 'compressor', params: { threshold: -24, ratio: 4, attack: 1, release: 500, knee: 0, makeup: 0 } }],
    expectDb: -(db(TONE_PEAK) + 24) * (1 - 1 / 4),
    baked: true
  },
  {
    name: 'a limiter with a −18 dB ceiling',
    effects: [{ id: 'e1', kind: 'limiter', params: { ceiling: -18, gain: 0, release: 50 } }],
    expectDb: -18 - db(TONE_PEAK),
    baked: true
  }
]

const body = async () => {
  const original = await evaluate(`JSON.stringify(window.bayEngine.store.getState().project)`)
  const asset = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths(${JSON.stringify([tone])})
    if (im.length !== 1) throw new Error('import returned ' + im.length)
    return im[0].asset
  })()`, 60_000)
  if (!asset.hasAudio || asset.error) throw new PreconditionError('the probe tone did not import with audio', JSON.stringify(asset))

  // An AudioContext stays suspended until a gesture, and a suspended context is silence.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: 400, y: 300, button: 'left', clickCount: 1 })
  }

  /** Loads one clip on one track with `effects` on the clip or the track, plays, and meters the track. */
  const meter = async (effects, where) => evaluate(`(async () => {
    const { store, engine } = window.bayEngine
    const st = store.getState()
    const base = st.project.timelines.find((t) => t.id === st.project.activeTimelineId)
    const item = { id: 'fxclip', assetId: ${JSON.stringify(asset.id)}, trackId: 'fxa', from: 0, durationInFrames: 300, sourceStartUs: 0,
      layout: { left: 0, top: 0, width: base.width, height: base.height, opacity: 1, rotation: 0 },
      volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1,
      ...(${JSON.stringify(where)} === 'clip' && ${JSON.stringify(effects)} ? { audioEffects: ${JSON.stringify(effects)} } : {}) }
    const track = { id: 'fxa', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [item],
      ...(${JSON.stringify(where)} === 'track' && ${JSON.stringify(effects)} ? { audioEffects: ${JSON.stringify(effects)} } : {}) }
    const timeline = { ...base, tracks: [track], transitions: [], markers: [] }
    store.getState().setProject({ ...st.project, assets: [${JSON.stringify(asset)}], timelines: [timeline], activeTimelineId: timeline.id })
    store.getState().setPlayhead(30)
    await new Promise((r) => setTimeout(r, 600))
    store.getState().setPlaying(true)
    const peaks = []
    const frames = []
    const t0 = performance.now()
    while (performance.now() - t0 < 2500) {
      await new Promise((r) => setTimeout(r, 60))
      // Skip the first half second: an element just started, and a chain just rebuilt.
      if (performance.now() - t0 < 500) continue
      peaks.push(engine.levels()['fxa']?.peak ?? 0)
      frames.push(store.getState().playhead)
    }
    store.getState().setPlaying(false)
    return { peaks, frames, contextState: engine.audio.context().state }
  })()`, 60_000)

  /** Asks main for the bake and waits for it, the way the engine's registry does. */
  const bakeReady = async (effects) => evaluate(`window.bay.media.audioEffectBake(${JSON.stringify({ path: asset.path, effects })})`, 120_000)

  const exportLevel = async (label) => {
    const out = join(moviesDir, `audio-effects-${process.pid}-${label}.wav`)
    const started = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `afx-export-${label}`, tool: 'export_timeline', args: { outputPath: out, format: 'wav' } })})`, 60_000)
    if (!started.ok) throw new PreconditionError('export_timeline refused', started.error)
    let tracked = null
    for (let i = 0; i < 240; i += 1) {
      const r = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `afx-track-${label}-${i}`, tool: 'track_export', args: { jobId: started.value.jobId } })})`)
      if (r.ok && r.value.finished) { tracked = r.value; break }
      await new Promise((res) => setTimeout(res, 500))
    }
    if (tracked?.stage !== 'done' || !existsSync(out)) return { level: Number.NaN, stage: tracked?.stage ?? 'never finished', error: tracked?.error }
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', out, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 256 << 20 })
    rmSync(out, { force: true })
    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2))
    // Goertzel over seconds 3..4 of the file: well clear of the start, and of any attack.
    const n = RATE
    const start = 3 * RATE
    const c = 2 * Math.cos((2 * Math.PI * TONE_HZ) / RATE)
    let s1 = 0
    let s2 = 0
    for (let i = 0; i < n; i += 1) {
      const s0 = (samples[start + i] ?? 0) / 32768 + c * s1 - s2
      s2 = s1
      s1 = s0
    }
    return { level: Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (n / 2), stage: 'done' }
  }

  // -------------------------------------------------------------------------------------------
  // The instrument, before anything it is used to judge.
  // -------------------------------------------------------------------------------------------
  const dry = await meter(null, 'clip')
  const dryPeak = median(dry.peaks)
  console.log(`\ndry: context ${dry.contextState}, ${dry.peaks.length} readings, median peak ${dryPeak.toFixed(4)} (specimen ${TONE_PEAK})`)
  check('preview', 'the audio context is running', dry.contextState === 'running')
  check('preview', 'CONTROL the meter reads the dry tone at its own level (±1.5 dB)', Math.abs(db(dryPeak / TONE_PEAK)) <= PREVIEW_TOLERANCE_DB, `${db(dryPeak / TONE_PEAK).toFixed(2)} dB`)
  check('preview', 'CONTROL the playhead moved while metering', new Set(dry.frames).size > 5, `${new Set(dry.frames).size} distinct frames`)
  const dryExport = await exportLevel('dry')
  check('export', 'CONTROL the dry export carries the tone at its own level', Math.abs(db(dryExport.level / TONE_PEAK)) <= EXPORT_TOLERANCE_DB, `${db(dryExport.level / TONE_PEAK).toFixed(2)} dB, stage ${dryExport.stage}`)
  if (!(dryPeak > 0.05) || !(dryExport.level > 0.05)) {
    throw new PreconditionError('the dry tone is not being metered', `preview ${dryPeak}, export ${dryExport.level}`)
  }

  // -------------------------------------------------------------------------------------------
  // Each case: on the clip, in the preview and in the file.
  // -------------------------------------------------------------------------------------------
  for (const [index, c] of CASES.entries()) {
    console.log(`\n${c.name}`)
    if (c.baked) {
      const bake = await bakeReady(c.effects)
      check('preview', 'the processed file is rendered', bake.ok === true, bake.ok ? bake.path : bake.error)
      if (!bake.ok) continue
      // Once to make the registry ask and learn it is ready (it settles for 300 ms first), then for real.
      await meter(c.effects, 'clip')
      await new Promise((r) => setTimeout(r, 800))
    }
    const wet = await meter(c.effects, 'clip')
    const previewDb = db(median(wet.peaks) / dryPeak)
    check('preview', `the tone moves by ${c.expectDb.toFixed(1)} dB (±${PREVIEW_TOLERANCE_DB})`, Math.abs(previewDb - c.expectDb) <= PREVIEW_TOLERANCE_DB, `${previewDb.toFixed(2)} dB`)
    const exported = await exportLevel(`case${index}`)
    const exportDb = db(exported.level / dryExport.level)
    check('export', `the file's tone moves by ${c.expectDb.toFixed(1)} dB (±${EXPORT_TOLERANCE_DB})`, Math.abs(exportDb - c.expectDb) <= EXPORT_TOLERANCE_DB, `${exportDb.toFixed(2)} dB, stage ${exported.stage}${exported.error ? ` (${exported.error})` : ''}`)
    check('both', `preview and export agree (±${PREVIEW_TOLERANCE_DB} dB)`, Math.abs(previewDb - exportDb) <= PREVIEW_TOLERANCE_DB, `preview ${previewDb.toFixed(2)}, export ${exportDb.toFixed(2)}`)

    // Switched off, the same chain must leave the tone where it was.
    const off = await meter(c.effects.map((e) => ({ ...e, enabled: false })), 'clip')
    check('preview', 'CONTROL switched off, the tone is back at its dry level', Math.abs(db(median(off.peaks) / dryPeak)) <= PREVIEW_TOLERANCE_DB, `${db(median(off.peaks) / dryPeak).toFixed(2)} dB`)
  }

  // -------------------------------------------------------------------------------------------
  // The same band on the track's bus instead of the clip.
  // -------------------------------------------------------------------------------------------
  console.log('\nthe 12 dB cut on the track instead of the clip')
  const onTrack = await meter(CASES[0].effects, 'track')
  const trackDb = db(median(onTrack.peaks) / dryPeak)
  check('preview', 'the track meter shows the track’s band (it sits before the analyser)', Math.abs(trackDb - CASES[0].expectDb) <= PREVIEW_TOLERANCE_DB, `${trackDb.toFixed(2)} dB`)
  const trackExport = await exportLevel('track')
  check('export', 'and the file carries it', Math.abs(db(trackExport.level / dryExport.level) - CASES[0].expectDb) <= EXPORT_TOLERANCE_DB, `${db(trackExport.level / dryExport.level).toFixed(2)} dB`)

  // -------------------------------------------------------------------------------------------
  // The tool, as an agent calls it — then undone.
  // -------------------------------------------------------------------------------------------
  console.log('\naudio_effects through the catalogue')
  await meter(null, 'clip')
  const pastBefore = await evaluate(`window.bayEngine.store.getState().past.length`)
  const applied = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: 'afx-tool', tool: 'audio_effects', args: { itemId: 'fxclip', action: 'preset', preset: 'telephone' } })})`)
  check('tool', 'audio_effects applies a preset', applied.ok === true && applied.value?.effects?.length === 4, applied.ok ? `${applied.value.effects.map((e) => e.kind).join(', ')}` : applied.error)
  const refused = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: 'afx-tool-bad', tool: 'audio_effects', args: { itemId: 'fxclip', action: 'add', kind: 'compressor', params: { ratio: 99 } } })})`)
  check('tool', 'and refuses a ratio of 99 naming the range', refused.ok === false && /1 to 20/.test(refused.error ?? ''), refused.error)
  await evaluate(`(() => { const s = window.bayEngine.store; while (s.getState().past.length > ${pastBefore}) s.getState().undo() })()`)

  // Put the project back; nothing was saved.
  await evaluate(`window.bayEngine.store.getState().setProject(${original})`)

  const bad = checks.filter((c) => !c.ok)
  console.log('')
  console.log(bad.length === 0
    ? `PASS  ${checks.length} checks: effects sound as set in the preview, and the export matches`
    : `FAIL  ${bad.length} of ${checks.length} checks failed: ${bad.map((c) => `[${c.path}] ${c.name}`).join('; ')}`)
  close()
  return bad.length === 0
}

await runProbe(body, { timeoutMs: 15 * 60_000 })
rmSync(dir, { recursive: true, force: true })
