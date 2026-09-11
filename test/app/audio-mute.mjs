/**
 * Does muting a track actually stop it reaching the output?
 *
 * The obvious probe is wrong, and this one exists because of it. Track meters are the
 * natural instrument — and `AudioEngine` deliberately keeps the analyser fed while a track
 * is muted, so the user can see what they silenced. A muted track therefore goes on
 * metering at full level. A probe that reads `levels()` and waits for zero can never
 * observe mute, and a probe that reads non-zero and concludes "still audible" is wrong.
 *
 * What mute actually does is `analyser.disconnect(master)`. Web Audio exposes no way to
 * query connections, so the only honest observable is the call itself: wrap
 * `AnalyserNode.prototype.connect`/`disconnect` and count. That is instrumentation of the
 * probe, not of the product — nothing in `src/` changes shape to be measured.
 *
 * The negative control is `hidden`, which is a different mechanism entirely (the draw loop
 * stops touching the element). Asserting that Hide moves the picture and *not* the audio
 * connection is what proves the two properties are independent, which is the model rule:
 * `hidden` governs picture, `muted` governs sound, on tracks of either kind.
 */

import { attach, CANVAS_PROFILE, CANVAS_READY, requirePrecondition, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { evaluate, close } = await attach()

await runProbe(async () => {

await evaluate(`(async () => {
  const { store } = window.bayEngine
  const imported = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
  store.getState().addAssets(imported.map((e) => e.asset))
  store.getState().placeAsset(imported[0].asset.id, 0)
  return true
})()`)

await requirePrecondition(evaluate, ...CANVAS_READY.onTimeline)
await requirePrecondition(evaluate, ...CANVAS_READY.sized)

// Playing is required: a paused graph has nothing to disconnect from.
await evaluate(`window.bayEngine.store.getState().setPlaying(true); true`)
await new Promise((r) => setTimeout(r, 1500))

await evaluate(`(() => {
  window.__an = { connects: 0, disconnects: 0 }
  const C = AnalyserNode.prototype.connect, D = AnalyserNode.prototype.disconnect
  AnalyserNode.prototype.connect = function (...a) { window.__an.connects++; return C.apply(this, a) }
  AnalyserNode.prototype.disconnect = function (...a) { window.__an.disconnects++; return D.apply(this, a) }
  return true
})()`)

const calls = () => evaluate('JSON.stringify(window.__an)').then(JSON.parse)
const peak = () => evaluate(`(() => {
  const lv = window.bayEngine.engine.levels()
  return +Math.max(0, ...Object.values(lv).map((v) => v.peak)).toFixed(3)
})()`)
const settle = () => evaluate(`new Promise((r) =>
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 500)))).then(() => true)`)
const videoTrack = `(() => {
  const st = window.bayEngine.store.getState()
  const tl = st.project.timelines.find((t) => t.id === st.project.activeTimelineId)
  return tl.tracks.find((t) => t.kind === 'video')
})()`
const patch = (field, value) => evaluate(`(() => {
  const t = ${videoTrack}
  window.bayEngine.store.getState().patchTrack(t.id, { ${field}: ${value} })
  return true
})()`)
const flags = () => evaluate(`(() => { const t = ${videoTrack}
  return JSON.stringify({ muted: t.muted, hidden: t.hidden }) })()`).then(JSON.parse)

const before = await calls()
const peakBefore = await peak()

await patch('muted', 'true')
await new Promise((r) => setTimeout(r, 1200))
const afterMute = await calls()
const peakMuted = await peak()
const flagsMuted = await flags()

await patch('muted', 'false')
await new Promise((r) => setTimeout(r, 1200))
const afterUnmute = await calls()

// The control: `hidden` must move the picture and leave the audio connection alone.
await settle()
const rowsVisible = (await evaluate(CANVAS_PROFILE)).rowExtent
await patch('hidden', 'true')
await new Promise((r) => setTimeout(r, 1200))
await settle()
const rowsHidden = (await evaluate(CANVAS_PROFILE)).rowExtent
const afterHide = await calls()
const peakHidden = await peak()

const mutedDisconnected = afterMute.disconnects === before.disconnects + 1
const unmutedReconnected = afterUnmute.connects === afterMute.connects + 1
const hideDidNotTouchAudio = afterHide.disconnects === afterUnmute.disconnects
const hideRemovedPicture = rowsVisible[0] >= 0 && rowsHidden[0] === -1

console.log('peak while audible ', peakBefore)
console.log('peak while MUTED   ', peakMuted, '<- stays fed on purpose; not a mute indicator')
console.log('track flags muted  ', JSON.stringify(flagsMuted))
console.log('analyser calls     ', JSON.stringify({ before, afterMute, afterUnmute, afterHide }))
console.log('picture rows       ', JSON.stringify(rowsVisible), '->', JSON.stringify(rowsHidden), 'after hide')
console.log('peak while HIDDEN  ', peakHidden, '<- audio continues; hide is picture-only')
console.log('')
console.log(mutedDisconnected ? 'PASS mute disconnects the analyser' : 'FAIL mute did not disconnect')
console.log(unmutedReconnected ? 'PASS unmute reconnects it' : 'FAIL unmute did not reconnect')
console.log(hideRemovedPicture ? 'PASS hide removes the picture' : 'FAIL hide left the picture drawn')
console.log(hideDidNotTouchAudio ? 'PASS hide leaves the audio connection alone' : 'FAIL hide changed the audio connection')

const ok = mutedDisconnected && unmutedReconnected && hideRemovedPicture && hideDidNotTouchAudio
close()

if (process.env.VERIFY_PROBE === '1') {
  // Self-check: the instrument must be able to report a *missing* disconnect. Run with the
  // engine's mute path disabled and this inverts — a pass then is the failure.
  console.log(ok ? 'SELF-CHECK FAILED: the probe cannot see a missing disconnect'
                 : 'SELF-CHECK PASSED: the probe notices when mute does nothing')
  return !ok
}
return ok

})
