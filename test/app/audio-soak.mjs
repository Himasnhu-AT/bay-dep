/**
 * Soak: does the preview ever play a whole sweep of silence where the source has sound?
 *
 * Twice in ~20 audio probe runs a whole probe heard silence with the AudioContext running and
 * the playhead moving. The mechanism found for it (8afacd6, `mediaRetry.ts`): a media element
 * whose first load failed was retried *without* `crossOrigin`, and a non-CORS element plays
 * silence through a `MediaElementAudioSourceNode`. That was a hypothesis for those two runs;
 * this probe is the attempt to reproduce them, many times over, on the current build.
 *
 * Each iteration:
 *  - a **fresh project** (a new id, no assets, no items; set in the store, never saved),
 *  - **alternating media**: a video with a tone, an audio-only tone, real speech, and a
 *    two-track mix of speech and tone — every source measured by ffmpeg `volumedetect` first,
 *    so "the source has signal" is a measured precondition, not an assumption,
 *  - **every 3rd iteration a forced first-load failure**, reproducing the real race rather than
 *    faking an error: the asset points at a fresh copy of the file that main has *not*
 *    allowlisted yet, so `bay://` refuses the first load (media error 4); once that refusal is on
 *    the console the copy is imported, which allowlists it, and the pool's retry must then load
 *    it — with CORS. (Before the retry used a fresh URL, it never could: Chromium answers a URL
 *    that failed from memory, so every retry failed and the clip played silence.)
 *  - play for SWEEP_MS and meter **every track that carries audio**; a track whose peak never
 *    leaves the noise floor for the whole sweep is a silent sweep, and a silent sweep FAILS.
 *
 * The console is recorded over its own CDP connection (independent of the page), and every
 * `[bay] … did not load` warning is counted per iteration: a forced iteration with no warning
 * means the fault was not injected and that iteration tested nothing, which also fails.
 *
 * Positive control: `SABOTAGE=nocors` makes the `crossOrigin` setter on media elements a no-op
 * for the run (a page patch, undone at the end) — the pre-8afacd6 silent state, for every load.
 * The probe must then FAIL with silent sweeps; `VERIFY_PROBE=1` inverts the verdict.
 *
 *   PORT=9273 ITERATIONS=36 node test/app/audio-soak.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { attach, findRenderer, PreconditionError, runProbe } from './cdp.mjs'

const PORT = Number(process.env.PORT ?? 9222)
const ITERATIONS = Number(process.env.ITERATIONS ?? 36)
const SWEEP_MS = Number(process.env.SWEEP_MS ?? 2500)
const FORCE_EVERY = Number(process.env.FORCE_EVERY ?? 3)
const SABOTAGE = process.env.SABOTAGE ?? ''
const FLOOR = 0.002 // peak (0..1) above which a sweep counts as having sound
import { FFMPEG } from './ffmpeg.mjs'
const SPEECH = resolve(process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4')
const DIR = join(tmpdir(), `bay-audio-soak-${process.pid}`)

// -- media, generated, and each source's signal measured before anything is played ----------
if (!existsSync(FFMPEG)) throw new PreconditionError(`no ffmpeg at ${FFMPEG}`, 'run from the repo root after pnpm install')
if (!existsSync(SPEECH)) throw new PreconditionError(`no speech clip at ${SPEECH}`, 'set CLIP to a video with sound')
mkdirSync(DIR, { recursive: true })
const TONE_MP4 = join(DIR, 'tone.mp4')
const TONE_M4A = join(DIR, 'tone.m4a')
execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=8', '-f', 'lavfi', '-i', 'sine=f=440:d=8',
  '-filter:a', 'volume=0.5', '-c:v', 'h264_videotoolbox', '-q:v', '90', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', TONE_MP4])
execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=660:d=8', '-filter:a', 'volume=0.5', '-c:a', 'aac', TONE_M4A])

// ffmpeg prints volumedetect on stderr; spawnSync hands it back whatever the exit status.
const maxVolumeDb = (file) => {
  const { stderr } = spawnSync(FFMPEG, ['-hide_banner', '-t', String(SWEEP_MS / 1000 + 1), '-i', file, '-map', '0:a:0',
    '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /max_volume: (-?[\d.]+) dB/.exec(stderr ?? '')
  return m ? Number(m[1]) : null
}
const sourceDb = {}
for (const file of [TONE_MP4, TONE_M4A, SPEECH]) {
  sourceDb[file] = maxVolumeDb(file)
  if (sourceDb[file] === null || sourceDb[file] < -30) {
    throw new PreconditionError(`the source ${file} has no measurable signal in the first ${SWEEP_MS} ms (max_volume ${sourceDb[file]} dB)`,
      'the soak can only call a silent sweep a fault if the source has sound')
  }
}
console.log('sources (max_volume over the sweep):', Object.entries(sourceDb).map(([f, db]) => `${f.split('/').pop()} ${db} dB`).join(', '))

// Each plan: which files, one per track. Rotates so consecutive iterations differ.
const PLANS = [
  { name: 'video+tone', files: [TONE_MP4] },
  { name: 'audio-only tone', files: [TONE_M4A] },
  { name: 'speech video', files: [SPEECH] },
  { name: 'speech + tone (2 tracks)', files: [SPEECH, TONE_M4A] }
]

// -- console recorder: its own CDP connection, so it hears the page whatever the probe does ---
const consoleLines = []
const recorder = new WebSocket(await findRenderer(PORT))
await new Promise((r, j) => { recorder.onopen = r; recorder.onerror = j })
recorder.onmessage = (event) => {
  const m = JSON.parse(event.data)
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
    consoleLines.push({ at: Date.now(), type: m.params.type, text })
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleLines.push({ at: Date.now(), type: 'exception', text: m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text })
  }
}
recorder.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))

const { send, evaluate } = await attach(PORT)

await runProbe(async () => {
  // The same gesture audio.mjs uses: a context that never left `suspended` is silence that
  // looks exactly like a broken mixer, so it is a precondition, checked below.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 })
  }

  if (SABOTAGE === 'nocors') {
    // The pre-8afacd6 state for every load: the element never asks for CORS. Undone below.
    await evaluate(`(() => {
      const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'crossOrigin')
      window.__baySoakCorsDescriptor = d
      Object.defineProperty(HTMLMediaElement.prototype, 'crossOrigin', { configurable: true, enumerable: d.enumerable,
        get: d.get, set(v) { d.set.call(this, null) } })
      return true
    })()`)
    console.log('SABOTAGE nocors: media elements load without crossOrigin for this run')
    console.log('                 (the pool keeps those elements: restart or reload the app before a real soak)')
  }

  const rows = []
  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const plan = PLANS[i % PLANS.length]
      const forced = FORCE_EVERY > 0 && i % FORCE_EVERY === FORCE_EVERY - 1
      const since = Date.now()

      // A fresh copy for the forced iteration: a path main has never been told about.
      const files = plan.files.map((file, k) => {
        if (!(forced && k === 0)) return file
        const dir = join(DIR, `race-${i}`)
        mkdirSync(dir, { recursive: true })
        const copy = join(dir, file.split('/').pop())
        copyFileSync(file, copy)
        return copy
      })

      const setup = await evaluate(`(async () => {
        const { store } = window.bayEngine
        const st = store.getState()
        st.setPlaying(false)
        const p = st.project
        const fresh = { ...p, id: crypto.randomUUID(), name: 'audio soak ${i}', assets: [], markers: [],
          timelines: p.timelines.map((tl) => ({ ...tl, markers: [], transitions: [],
            tracks: tl.tracks.map((t) => ({ ...t, items: [], muted: false, locked: false })) })) }
        delete fresh.filePath
        store.getState().setProject(fresh)
        const files = ${JSON.stringify(files)}
        const originals = ${JSON.stringify(plan.files)}
        const forced = ${forced}
        const placed = []
        for (let k = 0; k < files.length; k++) {
          // A forced file is described by its original's probe, then pointed at the copy that
          // main has not allowlisted: the first load is refused, as in the real race.
          const [probe] = await window.bay.media.importPaths([originals[k]])
          const asset = (forced && k === 0) ? { ...probe.asset, id: crypto.randomUUID(), path: files[k], name: 'race-' + ${i} } : probe.asset
          if (!asset.hasAudio) throw new Error(asset.name + ' has no audio')
          store.getState().addAssets([asset])
          // One track per file: the second goes on a free audio track.
          const s = store.getState()
          const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
          const free = k === 0 ? undefined : tl.tracks.find((t) => t.kind === 'audio' && !t.items.length)?.id
          const itemId = store.getState().placeAsset(asset.id, 0, free)
          if (!itemId) throw new Error('could not place ' + asset.name)
          placed.push({ itemId, assetId: asset.id })
        }
        store.getState().setPlayhead(0)
        const s = store.getState()
        const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
        const tracks = tl.tracks.filter((t) => t.items.length).map((t) => ({ id: t.id, kind: t.kind, items: t.items.length }))
        return { tracks }
      })()`, 60_000)

      if (forced) {
        // Allowlist the copy only once the refusal has been SEEN: a fixed delay raced the pool's
        // first load and once allowlisted before it, which tested nothing.
        const refused = () => consoleLines.some((l) => l.at >= since && /did not load/.test(l.text))
        for (let t = 0; t < 60 && !refused(); t++) await new Promise((r) => setTimeout(r, 50))
        await evaluate(`window.bay.media.importPaths([${JSON.stringify(files[0])}]).then(() => true)`)
      }

      // Loads settle (a forced one needs its retry, 200 ms after the refusal).
      await new Promise((r) => setTimeout(r, 1500))

      const sweep = await evaluate(`(async () => {
        const { engine, store } = window.bayEngine
        const ctx = engine.audio.context()
        if (ctx.state !== 'running') await ctx.resume().catch(() => {})
        store.getState().setPlaying(true)
        await new Promise((r) => setTimeout(r, 300))
        const t0 = performance.now(), start = store.getState().playhead
        const peak = {}
        let n = 0
        while (performance.now() - t0 < ${SWEEP_MS}) {
          const levels = engine.levels()
          for (const [id, l] of Object.entries(levels)) peak[id] = Math.max(peak[id] ?? 0, l.peak)
          n++
          await new Promise((r) => setTimeout(r, 40))
        }
        const end = store.getState().playhead
        store.getState().setPlaying(false)
        return { ctx: ctx.state, n, peak, moved: end - start }
      })()`, 60_000)

      const warnings = consoleLines.filter((l) => l.at >= since && /did not load/.test(l.text)).map((l) => l.text)
      const errors = consoleLines.filter((l) => l.at >= since && (l.type === 'error' || l.type === 'exception')).map((l) => l.text)
      // Every track that carries an audible item: a video track with a sound-bearing clip counts.
      const perTrack = setup.tracks.map((t) => ({ ...t, peak: +(sweep.peak[t.id] ?? -1).toFixed(4) }))
      const silent = perTrack.filter((t) => !(t.peak > FLOOR))
      const problems = []
      if (sweep.ctx !== 'running') problems.push(`context ${sweep.ctx}`)
      if (!(sweep.moved > 0)) problems.push('playhead did not move')
      if (silent.length) problems.push(`SILENT sweep on ${silent.map((t) => `${t.kind} track (peak ${t.peak < 0 ? 'no meter' : t.peak})`).join(', ')}`)
      if (forced && warnings.length === 0) problems.push('forced load error was NOT injected (no "did not load" warning): this iteration tested nothing')
      const row = { i, plan: plan.name, forced, warnings: warnings.length, errors: errors.length, moved: sweep.moved,
        peaks: perTrack.map((t) => `${t.kind}:${t.peak}`).join(' '), problems }
      rows.push(row)
      console.log(`${problems.length ? 'FAIL' : 'ok  '} #${String(i).padStart(2)} ${plan.name.padEnd(26)} ${forced ? 'forced-error' : '            '} ` +
        `warn ${warnings.length} peaks ${row.peaks} moved ${sweep.moved}f${problems.length ? '  — ' + problems.join('; ') : ''}`)
      for (const w of warnings) console.log('      console:', w)
      for (const e of errors) console.log('      console error:', String(e).slice(0, 200))
    }
  } finally {
    if (SABOTAGE === 'nocors') {
      await evaluate(`(() => { Object.defineProperty(HTMLMediaElement.prototype, 'crossOrigin', window.__baySoakCorsDescriptor); delete window.__baySoakCorsDescriptor; return true })()`)
    }
    recorder.close()
    rmSync(DIR, { recursive: true, force: true })
  }

  const failed = rows.filter((r) => r.problems.length)
  const silentSweeps = rows.filter((r) => r.problems.some((p) => p.startsWith('SILENT')))
  const forcedRows = rows.filter((r) => r.forced)
  console.log(`\n${rows.length} iterations · ${forcedRows.length} with a forced first-load error (${forcedRows.filter((r) => r.warnings > 0).length} of them injected) · ` +
    `${silentSweeps.length} silent sweeps · ${failed.length} failing iterations · "did not load" warnings total ${rows.reduce((a, r) => a + r.warnings, 0)}`)
  const ok = failed.length === 0
  console.log(ok ? 'PASS: no silent sweep' : 'FAIL: see the iterations above')
  if (process.env.VERIFY_PROBE === '1') {
    console.log(silentSweeps.length ? 'SELF-CHECK PASSED: the probe hears the silence' : 'SELF-CHECK FAILED: the sabotage produced no silent sweep')
    return silentSweeps.length > 0
  }
  return ok
}, { timeoutMs: Math.max(300_000, ITERATIONS * 20_000) })
