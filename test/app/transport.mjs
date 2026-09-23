/**
 * Does clicking Play actually play — through the real button, not the store?
 *
 * `interface` reported the transport flipping to Pause while the timecode sat at 0:00:00
 * indefinitely. Every measurement I had made drove `setPlaying(true)` on the store directly,
 * which skips the button, the click handler and the component that renders the timecode. A
 * store that advances while the timecode does not is a different fault from a clock that
 * never ticks, and the two are indistinguishable from the outside.
 *
 * So this probe clicks the actual DOM button at its actual coordinates and then watches
 * three things that can disagree: the clock's own counters, the playhead in the store, and
 * the characters on screen.
 *
 * Self-check: `VERIFY_PROBE=1` clicks a button that is not Play. Nothing should advance. If
 * the probe reports success for that, it is not observing the click.
 */

import { attach } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { send, evaluate, close } = await attach()

await evaluate(`(async () => {
  const { store } = window.bayEngine
  const imported = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
  const asset = imported[0].asset
  store.getState().addAssets([asset])
  store.getState().placeAsset(asset.id, 0)
  return true
})()`)
await new Promise((r) => setTimeout(r, 2500))

const wanted = process.env.VERIFY_PROBE === '1' ? 'Zoom out' : 'Play'
const button = await evaluate(`(() => {
  const el = [...document.querySelectorAll('button')]
    .find(b => (b.getAttribute('aria-label') || b.title || '').trim() === ${JSON.stringify(wanted)})
  if (!el) throw new Error('no ' + ${JSON.stringify(wanted)} + ' button in the DOM')
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: el.getAttribute('aria-label') }
})()`)

const READ = `(() => {
  const { engine, store } = window.bayEngine
  const s = engine.stats()
  const nodes = [...document.querySelectorAll('span')].map(n => n.textContent.trim())
  return {
    playhead: store.getState().playhead,
    playing: store.getState().playing,
    ticks: s.ticks, pictures: s.pictures, skipped: s.skippedFrames,
    timecodes: nodes.filter(t => /^\\d+:\\d{2}:\\d{2}$/.test(t)),
    playLabel: (() => { const b = [...document.querySelectorAll('button')]
      .find(x => ['Play','Pause'].includes((x.getAttribute('aria-label')||'').trim()))
      return b ? b.getAttribute('aria-label') : null })()
  }
})()`

await evaluate(`(() => { window.bayEngine.engine.clock.resetStats(); return true })()`)
const before = await evaluate(READ)

for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: button.x, y: button.y, button: 'left', clickCount: 1 })
}
await new Promise((r) => setTimeout(r, 2500))
const after = await evaluate(READ)
await evaluate(`(() => { window.bayEngine.store.getState().setPlaying(false); return true })()`)

console.log('clicked        ', JSON.stringify(button))
console.log('before         ', JSON.stringify(before))
console.log('after 2.5s     ', JSON.stringify(after))

const advancedStore = after.playhead > before.playhead
const ticked = after.ticks > 0 && after.pictures > 0
const timecodeMoved = JSON.stringify(after.timecodes) !== JSON.stringify(before.timecodes)

console.log()
if (process.env.VERIFY_PROBE === '1') {
  const quiet = !advancedStore && !timecodeMoved
  console.log(quiet ? 'SELF-CHECK PASSED: clicking a non-Play button advances nothing'
                    : 'SELF-CHECK FAILED: something advanced without Play being clicked')
  await close(); process.exit(quiet ? 0 : 1)
}
console.log(ticked ? `PASS  the clock ran (${after.ticks} ticks, ${after.pictures} pictures)` : 'FAIL  the clock never ticked')
console.log(advancedStore ? `PASS  the playhead advanced in the store (${before.playhead} -> ${after.playhead})` : 'FAIL  the playhead never moved in the store')
console.log(timecodeMoved ? `PASS  the on-screen timecode changed (${before.timecodes[0]} -> ${after.timecodes[0]})` : `FAIL  the timecode is still ${before.timecodes[0]} - the store moved but the UI did not`)
await close()
process.exit(ticked && advancedStore && timecodeMoved ? 0 : 1)
