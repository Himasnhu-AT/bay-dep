/**
 * What does a transition cost during playback?
 *
 * Every transition measurement so far has been a single scrubbed frame. Playback is the case
 * that was never tested, and it is the one where the change I made has teeth: inside a
 * transition window the compositor draws **two** clips per frame instead of one, each seeking
 * its own element. That is double the decode at exactly the moment the picture is busiest.
 *
 * If it cannot keep up, the clock behaves correctly and the result is still bad: real time is
 * preserved by *skipping* frames, so a dissolve would stutter while every counter looked
 * healthy. So the measurement is pictures per second and skipped frames through the window,
 * against the same timeline with the transition removed — the only comparison that separates
 * "transitions are expensive" from "this timeline is expensive".
 */

import { attach, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { send, evaluate, close } = await attach()

await runProbe(async () => {
  const asset = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths([${JSON.stringify((CLIP.startsWith('/') ? CLIP : process.cwd() + '/' + CLIP))}])
    if (!im.length) throw new Error('import returned nothing')
    return im[0].asset
  })()`, 60_000)

  // A click, so the AudioContext can leave `suspended` — a suspended context is silence that
  // looks like a broken mixer, and playback drives audio as well as picture.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: 400, y: 300, button: 'left', clickCount: 1 })
  }

  const play = async (label, withTransition) => {
    const out = await evaluate(`(async () => {
      const { store, engine } = window.bayEngine
      const st = store.getState()
      const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
      const mk = (id, from, dur, src) => ({
        id, assetId: ${JSON.stringify(asset.id)}, trackId: 'pv', from,
        durationInFrames: dur, sourceStartUs: src,
        layout: { left: 0, top: -1166, width: base.width, height: 3413, opacity: 1, rotation: 0 },
        volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
      })
      const timeline = {
        ...base, background: '#000000',
        tracks: [{ id: 'pv', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false,
                   items: [mk('pa', 0, 60, 20000000), mk('pb', 60, 60, 30000000)] }],
        transitions: ${withTransition}
          ? [{ id: 'ptx', kind: 'cross-dissolve', fromItemId: 'pa', toItemId: 'pb',
               durationInFrames: 30, direction: 'left' }]
          : []
      }
      store.getState().setProject({ ...st.project, assets: [${JSON.stringify(asset)}],
        timelines: [timeline], activeTimelineId: timeline.id })
      store.getState().setPlayhead(40)

      // Let the first frame settle so the measurement is playback, not loading.
      await new Promise(r => setTimeout(r, 1200))
      engine.clock.resetStats()
      const canvas = document.querySelector('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const blankAt = []
      const samples = []
      store.getState().setPlaying(true)
      const t0 = performance.now()
      while (performance.now() - t0 < 2600) {
        const s = engine.stats()
        const ph = store.getState().playhead
        // A hitch inside a transition shows as a frame with nothing on it. Sampling the canvas
        // is the only way to see that; the counters cannot, by design.
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let lit = 0
        for (let i = 0; i < d.length; i += 4 * 211) if (d[i] > 8 || d[i+1] > 8 || d[i+2] > 8) lit++
        if (lit === 0) blankAt.push(ph)
        samples.push({ ph, pictures: s.pictures, ticks: s.ticks, skipped: s.skippedFrames })
        await new Promise(r => setTimeout(r, 60))
      }
      const elapsed = (performance.now() - t0) / 1000
      const end = engine.stats()
      store.getState().setPlaying(false)
      const first = samples[0], last = samples[samples.length - 1]
      return {
        seconds: +elapsed.toFixed(2),
        picturesPerSecond: +((last.pictures - first.pictures) / elapsed).toFixed(1),
        ticksPerSecond: +((last.ticks - first.ticks) / elapsed).toFixed(1),
        framesAdvanced: last.ph - first.ph,
        framesPerSecond: +((last.ph - first.ph) / elapsed).toFixed(1),
        skipped: end.skippedFrames,
        p50: +end.compositeP50Ms.toFixed(2),
        p99: +end.compositeP99Ms.toFixed(2),
        blankFrames: blankAt.length,
        blankAt: blankAt.slice(0, 6),
        playhead: [first.ph, last.ph]
      }
    })()`, 120_000)
    console.log(`${label.padEnd(28)} ${JSON.stringify(out)}`)
    return out
  }

  console.log('')
  const plain = await play('plain cut at frame 60', false)
  const dissolve = await play('30-frame dissolve at 60', true)

  // Blanks are counted *inside the transition window* only. The first version counted them
  // anywhere in the run and failed on a blank at frame 76 — outside a window ending at 74 —
  // which would have blamed the dissolve for something the plain cut does too. The boundary
  // blank is a real and separate finding, reported below rather than folded in here.
  const windowFirst = 60 - 15
  const windowLast = 60 + 15 - 1
  const inWindow = (f) => f >= windowFirst && f <= windowLast
  const dissolveBlanksInside = dissolve.blankAt.filter(inWindow).length
  const plainBlanksAnywhere = plain.blankAt.length

  const checks = [
    ['playback runs in real time through the dissolve', Math.abs(dissolve.framesPerSecond - 30) <= 3],
    ['no blank frames inside the dissolve window', dissolveBlanksInside === 0],
    ['the dissolve crosses the window', dissolve.playhead[0] < 60 && dissolve.playhead[1] > 60],
    ['pictures keep up (within 15% of the plain cut)',
      dissolve.picturesPerSecond >= plain.picturesPerSecond * 0.85],
    ['no runaway frame skipping', dissolve.skipped <= plain.skipped + 3]
  ]
  console.log('')
  let bad = 0
  for (const [name, ok] of checks) {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  }
  console.log('')
  console.log(`composite cost   plain p50 ${plain.p50}ms p99 ${plain.p99}ms` +
              `   dissolve p50 ${dissolve.p50}ms p99 ${dissolve.p99}ms`)
  console.log('')
  console.log(`blank frames     plain ${JSON.stringify(plain.blankAt)}   ` +
              `dissolve ${JSON.stringify(dissolve.blankAt)}   window [${windowFirst}, ${windowLast}]`)
  if (plainBlanksAnywhere > 0) {
    console.log('')
    console.log('NOTE  the plain cut blanks too, so this is not a transition fault: a clip')
    console.log('      boundary during *playback* can show one background frame. The preview')
    console.log('      path draws whatever an element holds and relies on onReady to redraw,')
    console.log('      and by the time that lands the clock has moved on. Separate defect.')
  }
  console.log('')
  console.log(bad === 0
    ? 'PASS  a transition plays in real time with nothing dropped'
    : `FAIL  ${bad} check(s) failed — a dissolve does not survive playback`)
  close()
  return bad === 0
})
