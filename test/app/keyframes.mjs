/**
 * Keyframes in the running app: a push-in, an opacity fade and a volume ride, measured where they
 * land — never inferred from the stored keys.
 *
 * Which path each check covers, because "a probe of the preview is not a probe of the export":
 *
 * - **PREVIEW_FRAME** checks call the `preview_frame` tool and measure the returned image.
 * - **EXPORT** checks run `export_timeline`, decode the delivered mp4 with the bundled ffmpeg
 *   (zimg, not swscale — see preamble on the −2 level bias) and measure it here.
 * - **PREVIEW** (audio) checks read the track analyser while the transport plays: the Web Audio
 *   mix, not the export's `volume` envelope, which the EXPORT volume checks measure in the file.
 *
 * The subject is a white 320×180 box on black in a 640×360 clip, so its size on screen is a count
 * of bright pixels along the middle row and column. Every expected value is derived from
 * `animatedLayoutAt`/`animatedVolumeAt` in `@shared/keyframes` at the frame measured, and every
 * positive check has a control: the same clip with the keys removed must NOT grow, and the ride's
 * sweep is compared against the same sweep without keys.
 *
 * Media go to a temp folder and the export to ~/Movies/bay/kf-<pid>.mp4; both are deleted. The
 * project is replaced for the run and restored by `attach()`'s snapshot; nothing is saved.
 *
 *   PORT=9274 node --import ./src/test-hooks.mjs test/app/keyframes.mjs   (the hook resolves @shared imports)
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe, PreconditionError } from './cdp.mjs'
import { FFMPEG, H264 } from './ffmpeg.mjs'
import { animatedLayoutAt, animatedVolumeAt } from '../../src/shared/keyframes.ts'

// bay's own ffmpeg (vendor/ffmpeg), the binary the app spawns; the npm build this used is gone.
const RATE = 48_000
const FPS = 30
const W = 640
const H = 360

const dir = mkdtempSync(join(tmpdir(), 'bay-keyframes-'))
const make = (name, args) => {
  const path = join(dir, name)
  execFileSync(FFMPEG, ['-v', 'error', '-y', ...args, path])
  return path
}
const boxClip = make('box.mp4', ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=8,drawbox=x=160:y=90:w=320:h=180:color=white:t=fill`, ...H264, '-pix_fmt', 'yuv420p'])
const music = make('music.wav', ['-f', 'lavfi', '-i', `aevalsrc=0.6*sin(2*PI*600*t):s=${RATE}:d=10`, '-ac', '2'])

const moviesDir = join(homedir(), 'Movies', 'bay')
mkdirSync(moviesDir, { recursive: true })
const exportPath = join(moviesDir, `kf-${process.pid}.mp4`)

const { send, evaluate, close } = await attach()

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

const LAYOUT = { left: 0, top: 0, width: W, height: H, opacity: 1, rotation: 0 }
const base = { layout: LAYOUT, volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, sourceStartUs: 0 }
const PUSH = { scale: [{ frame: 0, value: 1 }, { frame: 90, value: 1.2 }] }
const FADE = { opacity: [{ frame: 0, value: 0 }, { frame: 60, value: 1 }] }
const RIDE = { volume: [{ frame: 30, value: 1 }, { frame: 90, value: 10 ** (-12 / 20) }] }

const body = async () => {
  const assets = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths(${JSON.stringify([boxClip, music])})
    return im.map((e) => e.asset)
  })()`, 90_000)
  if (assets.length !== 2 || assets.some((a) => a.error)) throw new PreconditionError('the probe media did not import', JSON.stringify(assets))
  const [BOX, MUSIC] = assets

  const items = {
    push: { ...base, id: 'k_push', assetId: BOX.id, trackId: 'k_v1', from: 0, durationInFrames: 90, keyframes: PUSH },
    fade: { ...base, id: 'k_fade', assetId: BOX.id, trackId: 'k_v1', from: 90, durationInFrames: 60, sourceStartUs: 3_000_000, keyframes: FADE },
    ride: { ...base, id: 'k_ride', assetId: MUSIC.id, trackId: 'k_a1', from: 0, durationInFrames: 150, keyframes: RIDE }
  }
  /** Loads a timeline of these items into the store — the project the tools act on. */
  const load = (tracks) => evaluate(`(() => {
    const { store } = window.bayEngine
    const st = store.getState()
    const baseTl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    const timeline = { ...baseTl, width: ${W}, height: ${H}, fps: ${FPS}, background: '#000000', transitions: [], markers: [],
      tracks: ${JSON.stringify(tracks)}.map((t) => ({ locked: false, muted: false, hidden: false, ...t })) }
    store.getState().setProject({ ...st.project, assets: ${JSON.stringify(assets)}, timelines: [timeline], activeTimelineId: timeline.id })
    store.getState().setPlaying(false)
    return true
  })()`)
  const mcp = (tool, args) => evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `kf-${Math.random()}`, tool, args })})`, 60_000)

  const picture = (items_) => [
    { id: 'k_v1', kind: 'video', name: 'V1', items: items_ },
    { id: 'k_a1', kind: 'audio', name: 'A1', items: [items.ride] }
  ]

  /** Box width/height (bright pixels on the middle row/column) and the box centre's mean level. */
  const MEASURE = `async (dataUrl) => {
    const img = new Image(); img.src = dataUrl; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height)
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, img.width, img.height).data
    const lum = (px, py) => { const o = (py * img.width + px) * 4; return (d[o] + d[o + 1] + d[o + 2]) / 3 }
    let w = 0, h = 0
    for (let px = 0; px < img.width; px++) if (lum(px, img.height >> 1) > 128) w++
    for (let py = 0; py < img.height; py++) if (lum(img.width >> 1, py) > 128) h++
    let sum = 0, n = 0
    for (let py = (img.height >> 1) - 30; py < (img.height >> 1) + 30; py++)
      for (let px = (img.width >> 1) - 60; px < (img.width >> 1) + 60; px++) { sum += lum(px, py); n++ }
    return { w, h, centre: sum / n, width: img.width }
  }`

  // -------------------------------------------------------------------------------------
  // PREVIEW_FRAME — the push-in and the fade, through the tool.
  // -------------------------------------------------------------------------------------
  await load(picture([items.push, items.fade]))
  const shoot = async (frame) => {
    const r = await mcp('preview_frame', { frame })
    if (!r.ok) throw new PreconditionError('preview_frame refused', r.error)
    if (r.value.incomplete) throw new PreconditionError('preview_frame was incomplete', JSON.stringify(r.value))
    return evaluate(`(${MEASURE})(${JSON.stringify(r.value.image)})`, 30_000)
  }
  const PUSH_FRAMES = [0, 45, 89]
  const FADE_FRAMES = [90, 120, 149]
  const preview = {}
  for (const f of [...PUSH_FRAMES, ...FADE_FRAMES]) preview[f] = await shoot(f)
  if (preview[0].width !== W) throw new PreconditionError(`preview_frame returned ${preview[0].width}px, not ${W}`, 'maxSize ignored?')
  check('preview_frame', 'the instrument sees the box at rest: 320×180 at frame 0', Math.abs(preview[0].w - 320) <= 2 && Math.abs(preview[0].h - 180) <= 2, JSON.stringify(preview[0]))

  const scaleAt = (item, f) => animatedLayoutAt(item, f).scale ?? 1
  const opacityAt = (item, f) => animatedLayoutAt(item, f).opacity
  const pushOk = (m, f) => {
    const want = scaleAt(items.push, f) / scaleAt(items.push, 0)
    const got = m.w / preview[0].w
    return { ok: Math.abs(got / want - 1) <= 0.01, detail: `frame ${f}: width ×${got.toFixed(4)} vs keyed ×${want.toFixed(4)}` }
  }
  for (const f of PUSH_FRAMES.slice(1)) {
    const r = pushOk(preview[f], f)
    check('preview_frame', `push-in: the subject grows by the keyed ratio ±1% (frame ${f})`, r.ok, r.detail)
  }
  // Control: the same clip with no keys does not grow — the growth above is the keys.
  await load(picture([{ ...items.push, keyframes: undefined }, items.fade]))
  const still = await shoot(89)
  check('preview_frame', 'control: without keys the subject stays 320 wide at frame 89', Math.abs(still.w - preview[0].w) <= 1, `${still.w}px`)
  await load(picture([items.push, items.fade]))

  const fadeOk = (m, f) => {
    const want = 255 * opacityAt(items.fade, f)
    return { ok: Math.abs(m.centre - want) <= 5, detail: `frame ${f}: centre ${m.centre.toFixed(1)} vs keyed ${want.toFixed(1)}` }
  }
  for (const f of FADE_FRAMES) {
    const r = fadeOk(preview[f], f)
    check('preview_frame', `fade: the box's level follows the opacity keys ±5 (frame ${f})`, r.ok, r.detail)
  }

  // -------------------------------------------------------------------------------------
  // EXPORT — the same timeline, delivered, decoded, measured.
  // -------------------------------------------------------------------------------------
  const started = await mcp('export_timeline', { outputPath: exportPath, format: 'mp4' })
  if (!started.ok) throw new PreconditionError('export_timeline refused', started.error)
  let tracked = null
  for (let i = 0; i < 240; i += 1) {
    const r = await mcp('track_export', { jobId: started.value.jobId })
    if (r.ok && r.value.finished) { tracked = r.value; break }
    await new Promise((res) => setTimeout(res, 500))
  }
  check('export', 'the export finished complete', tracked?.stage === 'done' && tracked?.complete !== false, JSON.stringify({ stage: tracked?.stage, complete: tracked?.complete, warning: tracked?.warning }))
  if (tracked?.stage === 'done' && existsSync(exportPath)) {
    const frameOf = (n) => {
      const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', exportPath, '-vf', `select=eq(n\\,${n}),zscale=min=709:rin=limited:m=709:r=full,format=rgb24`,
        '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 64 << 20 })
      const lum = (px, py) => { const o = (py * W + px) * 3; return (raw[o] + raw[o + 1] + raw[o + 2]) / 3 }
      let w = 0, h = 0
      for (let px = 0; px < W; px++) if (lum(px, H >> 1) > 128) w++
      for (let py = 0; py < H; py++) if (lum(W >> 1, py) > 128) h++
      let sum = 0, n2 = 0
      for (let py = (H >> 1) - 30; py < (H >> 1) + 30; py++) for (let px = (W >> 1) - 60; px < (W >> 1) + 60; px++) { sum += lum(px, py); n2++ }
      return { w, h, centre: sum / n2 }
    }
    const exported = {}
    for (const f of [...PUSH_FRAMES, ...FADE_FRAMES]) exported[f] = frameOf(f)
    check('export', 'the box at rest is 320 wide in the file', Math.abs(exported[0].w - 320) <= 2, JSON.stringify(exported[0]))
    for (const f of PUSH_FRAMES.slice(1)) {
      const want = scaleAt(items.push, f)
      const got = exported[f].w / exported[0].w
      check('export', `push-in in the file: the subject grows by the keyed ratio ±1% (frame ${f})`, Math.abs(got / want - 1) <= 0.01, `×${got.toFixed(4)} vs ×${want.toFixed(4)}`)
      check('export', `and matches preview_frame to 2px (frame ${f})`, Math.abs(exported[f].w - preview[f].w) <= 2, `${exported[f].w} vs ${preview[f].w}`)
    }
    for (const f of FADE_FRAMES) {
      const want = 255 * opacityAt(items.fade, f)
      check('export', `fade in the file follows the opacity keys ±5 (frame ${f})`, Math.abs(exported[f].centre - want) <= 5, `${exported[f].centre.toFixed(1)} vs ${want.toFixed(1)}`)
    }

    // The ride, in the exported file's own audio: 600 Hz level per frame against the level
    // before the ride starts, compared with the shared sampler at the frame's centre.
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
    const open = goertzel(600, 15)
    check('export', 'the music is audible before the ride', open > 0.05, open.toFixed(4))
    for (const f of [45, 60, 75, 120]) {
      const want = db(animatedVolumeAt(items.ride, f + 0.5))
      const got = db(goertzel(600, f) / open)
      check('export', `volume ride in the file within 0.5 dB of the keys (frame ${f})`, Math.abs(got - want) <= 0.5, `${got.toFixed(2)} dB vs ${want.toFixed(2)} dB`)
    }
  }

  // -------------------------------------------------------------------------------------
  // PREVIEW (audio) — the ride metered on the A1 analyser while the transport plays.
  // -------------------------------------------------------------------------------------
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: 400, y: 300, button: 'left', clickCount: 1 })
  }
  const sweep = async (keyframes) => {
    await load([{ id: 'k_a1', kind: 'audio', name: 'A1', items: [{ ...items.ride, durationInFrames: 240, keyframes }] }])
    return evaluate(`(async () => {
      const { store, engine } = window.bayEngine
      store.getState().setPlayhead(0)
      await new Promise(r => setTimeout(r, 1200))
      store.getState().setPlaying(true)
      const samples = []
      const t0 = performance.now()
      while (performance.now() - t0 < 5000) {
        samples.push({ frame: store.getState().playhead, rms: +(engine.levels()['k_a1']?.rms ?? 0).toFixed(5) })
        await new Promise(r => setTimeout(r, 40))
      }
      store.getState().setPlaying(false)
      return { samples, state: engine.audio.context().state }
    })()`, 60_000)
  }
  const ridden = await sweep(RIDE)
  const flat = await sweep(undefined)
  const inRange = (run, lo, hi) => run.samples.filter((r) => r.frame >= lo && r.frame <= hi).map((r) => r.rms)
  for (const run of [ridden, flat]) {
    for (const [lo, hi] of [[5, 25], [55, 65], [100, 140]]) {
      if (inRange(run, lo, hi).length < 3) {
        throw new PreconditionError('playback did not reach every measured window of the ride sweep', `frames ${lo}–${hi} unsampled — is the window occluded or throttled?`)
      }
    }
  }
  check('preview', 'the audio context is running', ridden.state === 'running', ridden.state)
  const flatDb = db(median(inRange(flat, 100, 140)) / median(inRange(flat, 5, 25)))
  const heldDb = db(median(inRange(ridden, 100, 140)) / median(inRange(ridden, 5, 25)))
  const midDb = db(median(inRange(ridden, 55, 65)) / median(inRange(ridden, 5, 25)))
  const midWant = db(animatedVolumeAt(items.ride, 60))
  check('preview', 'control: without keys the level does not move', Math.abs(flatDb) < 1, `${flatDb.toFixed(2)} dB`)
  check('preview', 'ride: held at −12 dB after the last key (±1.5 dB, 8-bit analyser)', Math.abs(heldDb + 12) <= 1.5, `${heldDb.toFixed(2)} dB`)
  check('preview', `ride: mid-ramp near the keyed ${midWant.toFixed(1)} dB (±1.5 dB)`, Math.abs(midDb - midWant) <= 1.5, `${midDb.toFixed(2)} dB`)

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
    rmSync(exportPath, { force: true })
  }
}, { timeoutMs: 400_000 })
