/**
 * UNRUN. Written with the feature and never executed against a running bay — the wave that built
 * reverse and speed ramps was not allowed to launch the app. Treat every line as a draft of a
 * measurement until it has been run once and its positive controls seen to fire; the first run
 * should expect to fix the probe before it finds anything about the app.
 *
 * Does a reversed or ramped clip show the right source frame — in `preview_frame`'s path
 * (`renderFrame`), in live playback, and in the exported file?
 *
 * The specimen is a clip whose frames can be told apart by measurement, because bay's ffmpeg has
 * no `drawtext` to burn a counter in: `counter.mp4`, 100 frames at 30 fps, each a flat grey whose
 * luma rises two levels a frame. Nothing here trusts those levels as written — the forward clip is
 * rendered first, frame by frame, to make the table "this luma is source frame k", and the table
 * must be strictly rising or the probe stops: a specimen that cannot tell frame 40 from frame 41
 * would pass every check below.
 *
 * What is checked, and which path each check is about (a probe of the preview is not a probe of
 * the export):
 *
 * 1. renderFrame (the path `preview_frame` and export both draw through), reversed: the first
 *    timeline frame is the footage's last source frame, the last is its first, each one between
 *    is one earlier than the one before. Exact, no tolerance: an off-by-one at either end is the
 *    fault this exists for.
 * 2. renderFrame, ramped: frame `k` shows source frame `floor(consumedFrames(k))`, computed here
 *    from `@shared/speed-curve` — and a hold shows one source frame for its whole length.
 * 3. The agent's surface on the open project: `edit_item({ reverse })`, `{ speedRamp }`, the
 *    refusals, `inspect_item`, one undo each.
 * 4. LIVE PLAYBACK, reversed: how many distinct pictures a second the preview shows (the stepped
 *    transport is a seek per frame), whether they run backwards, and whether any is black. This
 *    is the number the feature's report could not give. Reported, and compared with the forward
 *    clip's rate in the same run; the only hard assertions are "it runs backwards" and "never
 *    black", because the rate depends on the footage's GOP — the specimen is all-intra, which is
 *    the *best* case, so run it on real long-GOP footage too (`SPEED_CLIP=/path/to/take.mp4`).
 * 5. EXPORT, reversed: the file's frames, decoded by ffmpeg, are the forward clip's in reverse
 *    order, and its sound is present (the specimen carries a sweep). Reversed sound is measured
 *    properly in `src/main/export/reverse-audio-render.test.ts`; here it is only "not silent".
 *
 * Makes its own specimen under ~/.bay-probe-media/speed, or uses MEDIA. The MCP checks edit the
 * open project and unwind `past` afterwards. Nothing saves.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attach, runProbe } from './cdp.mjs'
import { FFMPEG, H264 } from './ffmpeg.mjs'
import { consumedFrames } from '../../src/shared/speed-curve.ts'

const run = promisify(execFile)
const MEDIA = process.env.MEDIA ?? join(homedir(), '.bay-probe-media', 'speed')
const FRAMES = 100
const FPS = 30
await mkdir(MEDIA, { recursive: true })
const COUNTER = join(MEDIA, 'counter.mp4')
if (!(await readFile(COUNTER).then(() => true, () => false))) {
  // Flat grey per frame, luma 20 + 2N; chroma neutral. `-g 1`: every frame a keyframe, so a seek
  // to any frame is exact and cheap — the specimen must not be what a frame check measures.
  await run(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=${FPS}:d=${FRAMES / FPS},geq=lum='20+2*N':cb=128:cr=128`,
    '-f', 'lavfi', '-i', `aevalsrc='0.3*sin(2*PI*(200*t+150*t*t))':s=48000:d=${FRAMES / FPS}`,
    ...H264, '-g', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', COUNTER
  ])
}

const { evaluate, close } = await attach()

let failures = 0
function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const HELPERS = `
  window.__speed = window.__speed || {}
  __speed.luma = async (dataUrl) => {
    const img = new Image(); img.src = dataUrl; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height)
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, img.width, img.height).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    return sum / (d.length / 4)
  }
  __speed.project = (asset, over) => {
    const st = window.bayEngine.store.getState()
    const base = st.project.timelines.find((t) => t.id === st.project.activeTimelineId)
    const timeline = { ...base, width: 320, height: 180, fps: ${FPS}, background: '#000000', transitions: [],
      tracks: [{ id: 's_v0', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false,
        items: [{ id: 's_i0', assetId: asset.id, trackId: 's_v0', from: 0, durationInFrames: 90, sourceStartUs: 0,
          layout: { left: 0, top: 0, width: 320, height: 180, opacity: 1, rotation: 0 },
          volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...over }] }] }
    return { ...st.project, assets: [asset], timelines: [timeline], activeTimelineId: timeline.id }
  }
  __speed.render = async (asset, over, frames) => {
    const project = __speed.project(asset, over)
    const out = []
    for (const frame of frames) {
      const r = await window.bayEngine.renderFrame({ project, timelineId: project.activeTimelineId, frame, maxSize: 320 })
      out.push({ frame, luma: await __speed.luma(r.dataUrl), pending: r.pending })
    }
    return out
  }
  true
`

await runProbe(async () => {
  await evaluate(HELPERS)
  const [asset] = await evaluate(`(async () => (await window.bay.media.importPaths(${JSON.stringify([process.env.SPEED_CLIP ?? COUNTER])})).map((e) => e.asset))()`, 60_000)
  const render = (over, frames) => evaluate(`__speed.render(${JSON.stringify(asset)}, ${JSON.stringify(over)}, ${JSON.stringify(frames)})`, 120_000)
  const all = Array.from({ length: 90 }, (_, k) => k)

  // -- the table: which luma is which source frame ---------------------------------------------
  const forward = await render({}, all)
  const table = forward.map((f) => f.luma)
  const rising = table.every((v, k) => k === 0 || v > table[k - 1] + 0.5)
  check(forward.every((f) => f.pending === 0), 'the forward clip renders complete on all 90 frames')
  check(rising, 'SPECIMEN: every source frame has its own luma, rising — the probe can tell neighbours apart',
    `frame 0 ${table[0]?.toFixed(1)}, 1 ${table[1]?.toFixed(1)}, 89 ${table[89]?.toFixed(1)}`)
  if (!rising) {
    console.log('CANNOT MEASURE: the specimen does not distinguish its frames in this app, so no frame check below means anything.')
    return false
  }
  /** The source frame a luma belongs to: the nearest table entry. */
  const sourceFrame = (luma) => table.reduce((best, v, k) => (Math.abs(v - luma) < Math.abs(table[best] - luma) ? k : best), 0)

  // -- 1. reversed, through renderFrame ---------------------------------------------------------
  // The same 90 frames of footage, read down from 3 s.
  const reversed = await render({ reverse: true, sourceStartUs: 3_000_000 }, all)
  const shown = reversed.map((f) => sourceFrame(f.luma))
  check(shown[0] === 89, 'reversed, HEAD: timeline frame 0 shows the footage’s last frame (source 89)', `shows ${shown[0]}`)
  check(shown[89] === 0, 'reversed, TAIL: timeline frame 89 shows the footage’s first frame (source 0)', `shows ${shown[89]}`)
  const wrong = shown.map((s, k) => (s === 89 - k ? null : `${k}→${s}`)).filter(Boolean)
  check(wrong.length === 0, 'reversed: every frame between is one source frame earlier than the one before', wrong.slice(0, 8).join(' '))
  check(reversed.every((f) => f.pending === 0), 'reversed: no frame is drawn before its seek has landed')

  // -- 2. ramped, through renderFrame -----------------------------------------------------------
  const ramp = [{ frame: 0, value: 1, ease: 'hold' }, { frame: 20, value: 0, ease: 'hold' }, { frame: 44, value: 0.5 }]
  const item = { speed: 1, keyframes: { speed: ramp } }
  const ramped = await render({ keyframes: { speed: ramp } }, all)
  const rampWrong = ramped
    .map((f) => ({ k: f.frame, got: sourceFrame(f.luma), want: Math.floor(consumedFrames(item, f.frame) + 1e-6) }))
    .filter((r) => r.got !== r.want)
  check(rampWrong.length === 0, 'ramped: timeline frame k shows the source frame the curve’s sum says', rampWrong.slice(0, 8).map((r) => `${r.k}: ${r.got}≠${r.want}`).join(' '))
  const held = new Set(ramped.filter((f) => f.frame >= 20 && f.frame <= 44).map((f) => sourceFrame(f.luma)))
  check(held.size === 1 && held.has(20), 'a hold (speed 0 over frames 20…44) shows one source frame throughout', [...held].join(','))
  check(sourceFrame(ramped[19].luma) !== sourceFrame(ramped[46].luma), 'control: the frames either side of the hold are not the held one… and differ from each other')

  // -- 3. the agent's surface, on the open project ----------------------------------------------
  const pastBefore = await evaluate('window.bayEngine.store.getState().past.length')
  const mcp = (tool, args) => evaluate(`window.bayMcp.execute({ id: 'speed-' + Math.random(), tool: ${JSON.stringify(tool)}, args: ${JSON.stringify(args)} })`, 120_000)
  try {
    const imp = await mcp('import_media', { paths: [process.env.SPEED_CLIP ?? COUNTER] })
    const placed = await mcp('place_asset', { assetId: imp.value?.assets?.[0]?.id })
    check(placed.ok, 'positive control: place_asset of the specimen succeeds', placed.error)
    const itemId = placed.value?.itemId
    const before = await mcp('inspect_item', { itemId })
    const length = before.value?.timing?.durationInFrames
    const from = before.value?.timing?.from

    const rev = await mcp('edit_item', { itemId, reverse: true })
    check(rev.ok && rev.value.reverse === true && rev.value.durationInFrames === length && rev.value.from === from,
      'edit_item reverse: in place, same length', rev.error ?? JSON.stringify({ d: rev.value?.durationInFrames, from: rev.value?.from }))
    check(rev.value?.sound?.preview === 'silent' && rev.value?.sound?.export === 'reversed', 'and the result says what its sound does', JSON.stringify(rev.value?.sound))
    const linked = (await mcp('inspect_item', { itemId })).value
    console.log('    inspect_item.timing:', JSON.stringify(linked?.timing))

    const both = await mcp('edit_item', { itemId, reverse: true, from: from + 10 })
    check(!both.ok && /cannot share a call with from/.test(both.error ?? ''), 'reverse with a move is refused, naming the two calls', both.error)
    const badRamp = await mcp('edit_item', { itemId, speedRamp: [{ frame: 0, speed: 1 }, { frame: 20, speed: 0 }] })
    check(!badRamp.ok && /ends at speed 0/.test(badRamp.error ?? ''), 'a ramp that ends on a hold is refused with how to end it', badRamp.error)

    // -- 4. live playback of the reversed clip ---------------------------------------------------
    // Counts PICTURES, not ticks: the centre pixel of the viewer (the first canvas) each rAF, a new
    // picture whenever it changes. The forward clip is measured first, by the same sampler, as the
    // control that the sampler can see pictures change at all.
    const playback = (label) => evaluate(`(async () => {
      const store = window.bayEngine.store
      const canvas = document.querySelector('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      store.getState().setPlaying(false)
      store.getState().setPlayhead(${JSON.stringify(from)})
      await new Promise((r) => setTimeout(r, 800))
      const seen = []
      let black = 0
      store.getState().setPlaying(true)
      const started = performance.now()
      await new Promise((done) => {
        const tick = () => {
          const d = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data
          const luma = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]
          if (luma < 4) black += 1
          if (seen.length === 0 || Math.abs(seen[seen.length - 1] - luma) > 0.5) seen.push(luma)
          if (performance.now() - started < 2000 && store.getState().playing) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
      store.getState().setPlaying(false)
      const seconds = (performance.now() - started) / 1000
      let down = 0, up = 0
      for (let i = 1; i < seen.length; i++) (seen[i] < seen[i - 1] ? down++ : up++)
      return { pictures: seen.length, perSecond: seen.length / seconds, down, up, black, seconds }
    })()`, 30_000)

    const revPlay = await playback('reversed')
    await mcp('edit_item', { itemId, reverse: false })
    const fwdPlay = await playback('forward')
    console.log(`    live playback, forward : ${fwdPlay.perSecond.toFixed(1)} pictures/s (${fwdPlay.pictures} in ${fwdPlay.seconds.toFixed(2)} s)`)
    console.log(`    live playback, reversed: ${revPlay.perSecond.toFixed(1)} pictures/s (${revPlay.pictures} in ${revPlay.seconds.toFixed(2)} s)  — REPORT THIS NUMBER`)
    check(fwdPlay.pictures > 20 && fwdPlay.up > fwdPlay.down * 5, 'control: the sampler sees the forward clip’s pictures change, brighter each time', JSON.stringify(fwdPlay))
    check(revPlay.pictures > 2 && revPlay.down > revPlay.up * 5, 'reversed playback runs BACKWARDS: each new picture is an earlier source frame', JSON.stringify(revPlay))
    check(revPlay.black === 0, 'reversed playback never shows black between steps (the last complete picture is held)', `${revPlay.black} black samples`)

    // -- 5. export of the reversed clip ---------------------------------------------------------
    await mcp('edit_item', { itemId, reverse: true })
    const outputPath = join(MEDIA, `reversed-${Date.now()}.mp4`)
    const exported = await mcp('export_timeline', { outputPath, format: 'mp4', wait: true })
    check(exported.ok && exported.value?.complete !== false, 'export of the reversed clip finishes complete', exported.error ?? JSON.stringify(exported.value?.warning))
    if (exported.ok) {
      // Mean luma of each decoded frame of the file, at the clip's first and last frames.
      const raw = (await run(FFMPEG, ['-v', 'error', '-i', outputPath, '-vf', 'scale=16:16,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 64 << 20 })).stdout
      const perFrame = []
      for (let i = 0; i + 256 <= raw.length; i += 256) perFrame.push(raw.subarray(i, i + 256).reduce((a, b) => a + b, 0) / 256)
      const clip = perFrame.slice(from, from + length)
      const falling = clip.every((v, k) => k === 0 || v < clip[k - 1] + 0.25)
      check(clip.length === length && falling, 'EXPORT: the file’s frames over the clip get darker every frame — the footage backwards', `${clip.length} frames, first ${clip[0]?.toFixed(1)}, last ${clip[clip.length - 1]?.toFixed(1)}`)
      const volume = (await run(FFMPEG, ['-v', 'info', '-i', outputPath, '-af', 'volumedetect', '-f', 'null', '-']).catch((e) => e)).stderr ?? ''
      const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(volume)?.[1])
      check(Number.isFinite(mean) && mean > -60, 'EXPORT: the reversed clip’s sound is in the file (not silent)', `mean ${mean} dB`)
      await rm(outputPath, { force: true })
    }
  } finally {
    // Put the open project back: every edit above, unwound. Nothing was saved.
    await evaluate(`(() => { const s = window.bayEngine.store; while (s.getState().past.length > ${pastBefore}) s.getState().undo(); return s.getState().past.length })()`)
  }
  const pastAfter = await evaluate('window.bayEngine.store.getState().past.length')
  check(pastAfter === pastBefore, 'the open project is back where it started', `${pastBefore} → ${pastAfter}`)

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
  return failures === 0
})
await close()
