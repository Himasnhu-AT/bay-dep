/**
 * Does any sound actually come out, and does the meter tell the truth about it?
 *
 * The audio engine is the last subsystem here with no measurement behind it at all — every
 * claim about it comes from reading the code. That is exactly the position the preview was
 * in before it turned out to be drawing nothing.
 *
 * Three questions, in the order that makes the later ones meaningful:
 *
 *  1. Does the graph run? An `AudioContext` that never left `suspended` produces silence
 *     and a meter of zeros, which is indistinguishable from a broken mixer.
 *  2. Do the meters read during playback?
 *  3. **Does muting a track leave its meter reading?** That is a deliberate design claim —
 *     mute disconnects the analyser from the master rather than zeroing a gain, so the
 *     meter goes on showing what is on the track. A meter that reads silence because the
 *     track is muted is the meter lying about the material.
 *
 * The self-check is question 4, and it is what makes 2 and 3 worth anything: setting the
 * item's own volume to 0 must drive the meters to zero. The item gain sits *before* the
 * analyser, so silence there is real silence. If the meters keep reading through that, they
 * are not measuring audio and every number above is furniture.
 */

import { attach } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { send, evaluate, close } = await attach()

const setup = await evaluate(`(async () => {
  const { store } = window.bayEngine
  const imported = await window.bay.media.importPaths([${JSON.stringify((CLIP.startsWith('/') ? CLIP : process.cwd() + '/' + CLIP))}])
  const asset = imported[0].asset
  if (!asset.hasAudio) throw new Error('the probe clip has no audio track')
  store.getState().addAssets([asset])
  const itemId = store.getState().placeAsset(asset.id, 0)
  const st = store.getState()
  const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
  const item = tl.tracks.flatMap(t => t.items).find(i => i.id === itemId)
  return { assetId: asset.id, itemId, trackId: item.trackId }
})()`)
await new Promise((r) => setTimeout(r, 2000))

// A real click: an AudioContext may not leave `suspended` without a user gesture, and a
// suspended context is silence that looks exactly like a broken mixer.
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: 400, y: 300, button: 'left', clickCount: 1 })
}

const measure = `(async (ms) => {
  const { engine } = window.bayEngine
  const samples = []
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    const levels = engine.levels()
    let peak = 0, rms = 0
    for (const k of Object.keys(levels)) { peak = Math.max(peak, levels[k].peak); rms = Math.max(rms, levels[k].rms) }
    samples.push({ peak, rms, tracks: Object.keys(levels).length })
    await new Promise(r => setTimeout(r, 50))
  }
  const peaks = samples.map(s => s.peak)
  return {
    n: samples.length,
    tracks: samples[0] ? samples[0].tracks : 0,
    maxPeak: +Math.max(...peaks).toFixed(4),
    meanPeak: +(peaks.reduce((a, b) => a + b, 0) / peaks.length).toFixed(4),
    framesWithSignal: peaks.filter(p => p > 0.001).length
  }
})`

const play = await evaluate(`(async () => {
  const { engine, store } = window.bayEngine
  store.getState().setPlaying(true)
  await new Promise(r => setTimeout(r, 600))
  const ctx = engine.audio.context()
  const heard = await ${measure}(2500)
  return { contextState: ctx.state, sampleRate: ctx.sampleRate, playhead: store.getState().playhead, heard }
})()`)
console.log('PLAYING        ', JSON.stringify(play))

const muted = await evaluate(`(async () => {
  const { store } = window.bayEngine
  store.getState().patchTrack(${JSON.stringify(setup.trackId)}, { muted: true })
  await new Promise(r => setTimeout(r, 500))
  return await ${measure}(1500)
})()`)
console.log('TRACK MUTED    ', JSON.stringify(muted))

const silenced = await evaluate(`(async () => {
  const { store } = window.bayEngine
  store.getState().patchTrack(${JSON.stringify(setup.trackId)}, { muted: false })
  store.getState().patchItem(${JSON.stringify(setup.itemId)}, { volume: 0 })
  await new Promise(r => setTimeout(r, 700))
  const out = await ${measure}(1500)
  store.getState().setPlaying(false)
  return out
})()`)
console.log('ITEM VOLUME 0  ', JSON.stringify(silenced))

const running = play.contextState === 'running'
const heardSomething = play.heard.framesWithSignal > play.heard.n * 0.5
const meterHonestWhenMuted = muted.framesWithSignal > muted.n * 0.5
const selfCheck = silenced.maxPeak < 0.01

console.log()
console.log(running ? 'PASS  the audio context is running' : `FAIL  context is ${play.contextState} - no sound is being produced`)
console.log(heardSomething ? `PASS  meters read during playback (max peak ${play.heard.maxPeak})` : 'FAIL  meters read silence during playback')
console.log(meterHonestWhenMuted ? `PASS  a muted track still meters (max peak ${muted.maxPeak})` : 'FAIL  muting a track blinded its meter')
console.log(selfCheck ? `PASS  self-check: item volume 0 drives the meters to ${silenced.maxPeak}`
                      : `FAIL  self-check: meters still read ${silenced.maxPeak} at volume 0 - they are not measuring audio`)

await close()
const ok = running && heardSomething && meterHonestWhenMuted && selfCheck
process.exit(ok ? 0 : 1)
