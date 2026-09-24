/**
 * Drives the built app over CDP and measures real playback.
 *
 * **Report, no verdict.** It prints what it measured and exits 0 whenever it could measure;
 * nothing here is compared with an expectation, so a green exit says the numbers exist, not that
 * they are good. Read them. Exit 2 means it could not measure.
 *
 * Everything this engine has reported so far came from a fake clock. This asks the only
 * question that harness cannot: with a real decoder feeding a real display, how many
 * pictures a second actually reach the canvas, and do they differ from one another.
 */
import { attach, runProbe } from './cdp.mjs'
const CLIP = new URL('../../assets/podcast-cut/output/goodall-transcript-cut.mp4', import.meta.url).pathname
const SECONDS = 6
const MINIMISE_AT = Number(process.env.MINIMISE_AT ?? 0)

const { evaluate, close } = await attach()
const ev = evaluate

await runProbe(async () => {
  // The awaited import and the placement are two evaluates on purpose. CDP intermittently
  // answered this one with "Promise was collected", and `evaluate` retries that once — which
  // re-runs the expression, so it must be safe to repeat. `importPaths` dedupes by path, so it
  // is; placing a clip is not, so it happens synchronously in the next call.
  const asset = await ev(`(async () => {
    const imported = await window.bay.media.importPaths([${JSON.stringify(CLIP)}])
    if (!imported.length) throw new Error('import returned nothing')
    return imported[0].asset
  })()`, 60_000)
  const setup = await ev(`(() => {
    const { store } = window.bayEngine
    const asset = ${JSON.stringify(asset)}
    store.getState().addAssets([asset])
    const itemId = store.getState().placeAsset(asset.id, 0)
    const state = store.getState()
    const tl = state.project.timelines.find((t) => t.id === state.project.activeTimelineId)
    return {
      assetId: asset.id,
      itemId,
      fps: tl.fps,
      canvas: [tl.width, tl.height],
      durationFrames: tl.tracks.flatMap((t) => t.items).reduce((m, i) => Math.max(m, i.from + i.durationInFrames), 0),
      assetDurationUs: asset.durationUs,
      hasVideo: asset.hasVideo,
      hasAudio: asset.hasAudio
    }
  })()`)
  console.log('SETUP', JSON.stringify(setup))

  // Wait for the decoder to produce a first picture, so we measure playback and not loading.
  const ready = await ev(`(async () => {
    const { engine } = window.bayEngine
    for (let i = 0; i < 200; i++) {
      const r = engine.pool.readiness(${JSON.stringify(setup.assetId)})
      if (r.hasPicture) return { waitedMs: i * 50, status: r.status }
      await new Promise((res) => setTimeout(res, 50))
    }
    throw new Error('no picture after 10s: ' + JSON.stringify(engine.pool.readiness(${JSON.stringify(setup.assetId)})))
  })()`)
  console.log('READY', JSON.stringify(ready))

  const run = await ev(`(async () => {
    const { engine, store } = window.bayEngine
    const canvas = document.querySelector('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    // A cheap fingerprint of what is on screen. Counting distinct values over the run is
    // what separates "the picture is advancing" from "the same frame redrawn fast".
    const fingerprint = () => {
      const w = canvas.width, h = canvas.height
      const d = ctx.getImageData(0, 0, w, h).data
      let a = 0, b = 0
      const step = Math.max(4, Math.floor(d.length / (256 * 4)) * 4)
      for (let i = 0; i < d.length; i += step) { a = (a + d[i] * 31 + d[i+1] * 7 + d[i+2]) >>> 0; b = (b ^ (a + i)) >>> 0 }
      return a + ':' + b
    }

    engine.clock.resetStats()
    const before = engine.stats()
    store.getState().setPlaying(true)

    const samples = []
    const t0 = performance.now()
    let minimised = false
    while (performance.now() - t0 < ${SECONDS * 1000}) {
      // Minimising is the real path that fires visibilitychange — an already-hidden window
      // never fires one, so a test that starts hidden proves nothing about the handler.
      if (${MINIMISE_AT} > 0 && !minimised && performance.now() - t0 > ${MINIMISE_AT}) {
        minimised = true
        await window.bay.window.minimise()
      }
      const s = engine.stats()
      const st = store.getState()
      const entry = engine.pool.peek(${JSON.stringify(setup.assetId)})
      const el = entry && entry.element
      samples.push({
        t: performance.now() - t0,
        playhead: st.playhead,
        playing: st.playing,
        pictures: s.pictures,
        ticks: s.ticks,
        picturesPerSecond: s.picturesPerSecond,
        ticksPerSecond: s.ticksPerSecond,
        p50: s.compositeP50Ms,
        p99: s.compositeP99Ms,
        skipped: s.skippedFrames,
        currentTime: el ? el.currentTime : null,
        paused: el ? el.paused : null,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        clockRunning: engine.clock.running,
        print: fingerprint(),
        minimised
      })
      await new Promise((r) => setTimeout(r, 100))
    }
    const elapsed = performance.now() - t0
    const after = engine.stats()
    store.getState().setPlaying(false)

    return { before, after, elapsed, samples, refresh: window.screen && screen.refreshRate || null }
  })()`)

  console.log('RESULT', JSON.stringify(run))
  console.log('\nREPORT ONLY: no verdict — read the numbers above.')
  close()
  return true
}, { timeoutMs: 90_000 })
