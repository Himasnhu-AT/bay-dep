/**
 * More compositions on one frame than the pool will fetch at once.
 *
 * Every other composition check uses one or two, and that is exactly the range where this was
 * invisible. The renderer's pool fetches `MAX_CONCURRENT_REQUESTS` (2) captures at a time and
 * **dropped** anything asked for beyond that; `renderFrame` draws, requests what is missing,
 * and retries a bounded number of times. Three attempts, two requests each, one spent drawing:
 * four compositions, whatever the timeline held. Measured before the fix — eight identical
 * compositions on one frame drew four, reported four missing, and asking again for ninety
 * seconds never moved the number, because each attempt discarded the same six requests it had
 * just made. Twelve behaved the same way. It was not slow, it was a ceiling.
 *
 * The frames here are deliberately more than the cap and more than one retry can cover, so a
 * pool that drops instead of queueing cannot pass by trying harder.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { attach, runProbe, PreconditionError, ProbeFailure } from './cdp.mjs'

const DIR = '/tmp/bay-probe-scale'
const { evaluate, close } = await attach()

let checks = 0
const check = (label, actual, expected) => {
  checks++
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) throw new ProbeFailure(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  console.log(`  ok  ${label}`)
}

await runProbe(async () => {

if ((await evaluate(`Boolean(window.bayMcp && window.bayEngine)`)) !== true) {
  throw new PreconditionError('window.bayMcp / window.bayEngine absent', 'bay.debug needs a reload')
}
mkdirSync(DIR, { recursive: true })

let n = 0
const mcp = async (tool, args = {}) => {
  const r = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `s${++n}`, tool, args })})`, 180_000)
  if (!r.ok) throw new Error(`${tool} refused: ${r.error}`)
  return r.value
}
const items = () => evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  const t = s.project.timelines.find((x) => x.id === s.project.activeTimelineId)
  return t.tracks.flatMap((k) => k.items).map((i) => i.id)
})()`)

// Each composition puts one opaque bar at a column of its own, so a frame that is missing one
// is missing a countable thing rather than "looking a bit different".
const source = (i) =>
  '<!doctype html><html><head><style>body{margin:0}</style></head><body>' +
  `<div data-composition-id="s${i}" data-duration="6" ` +
  'style="width:1080px;height:1920px;position:relative">' +
  `<div style="position:absolute;left:${20 + i * 80}px;top:300px;width:56px;height:400px;` +
  'background:#ffb020"></div></div>' +
  `<script>window.__timelines["s${i}"]={time:function(){return 0},duration:function(){return 6}};<\/script>` +
  '</body></html>'

const COUNT = 12

// Snapshot the whole project and put it back at the end. Twelve compositions need twelve
// tracks to be live on one frame — items cannot overlap on a track — and there is no
// `remove_track`, so deleting the items still leaves the tracks and the assets behind. Run
// this a few times and the project carries dozens of empty tracks into whatever runs next,
// which is how `compositions.mjs` started timing out on `read_project` right after this probe
// and passing alone. Restoring is the only cleanup that is actually complete.
const before = await evaluate(`JSON.stringify(window.bayEngine.store.getState().project)`)

const stale = await items()
if (stale.length) await mcp('delete_items', { itemIds: stale })

const opened = []
for (let i = 0; i < COUNT; i++) {
  const path = `${DIR}/s${i}.html`
  writeFileSync(path, source(i))
  const w = await mcp('write_composition', { path, html: source(i), import: true })
  if (!w.usable) throw new PreconditionError(`s${i} is not usable`, JSON.stringify(w))
  opened.push(w.assetId)
  const track = (await mcp('add_track', { kind: 'video' })).trackId
  await mcp('place_asset', { assetId: w.assetId, atFrame: 0, trackId: track })
}
check(`${COUNT} compositions are live on the same frame`, (await items()).length, COUNT)

// Bounded in wall clock rather than in attempts: one `preview_frame` can itself take a while,
// so "N tries" is not a budget anyone can predict.
const started = Date.now()
let shot = null
while (Date.now() - started < 60_000) {
  shot = await mcp('preview_frame', { frame: 60 })
  if (!shot.incomplete) break
  await new Promise((r) => setTimeout(r, 250))
}
const took = Date.now() - started
console.log(`      settled in ${took}ms, ${shot.itemsDrawn} items drawn`)

check(
  'the frame completes — a pool that drops requests never gets past four',
  shot.incomplete,
  undefined
)
check(`all ${COUNT} drew, not just the ones that fitted the cap`, shot.itemsDrawn, COUNT)

// And the export path, which cannot redraw later: it writes each frame once, so a queued
// capture that `settle` did not wait for is a frame published without its overlays.
const out = `${DIR}/scale.mp4`
const job = await mcp('export_timeline', { outputPath: out, format: 'mp4', fromFrame: 0, toFrame: 29 })
let last = null
for (let i = 0; i < 600; i++) {
  last = await mcp('track_export', { jobId: job.jobId })
  if (last.stage === 'done' || last.stage === 'failed') break
  await new Promise((r) => setTimeout(r, 500))
}
check('an export of the same frames finishes', last.stage, 'done')
check('and writes every frame it was asked for', last.framesDone, 30)

await evaluate(
  `(() => {
    window.bayEngine.store.getState().setProject(${before}, { resetHistory: true })
    return true
  })()`
)
check('the project is back as it was found', await evaluate(
  `window.bayEngine.store.getState().project.timelines[0].tracks.length`
), JSON.parse(before).timelines[0].tracks.length)
// Deleting the items does not close the windows — the assets stay in the pool, and each window
// is a renderer process. This probe deliberately opens more of them than any other, so leaving
// them behind fills main's pool for whatever runs next: `compositions.mjs` failed its
// "a tool call is still answered with composition windows open" check straight after this one,
// and passed alone. A probe that changes the result of the next probe is not a measurement.
for (const assetId of opened) {
  await evaluate(`window.bay.composition.release(${JSON.stringify(assetId)}).then(() => true)`, 30_000)
}
console.log(`\n${checks}/${checks} checks passed`)
close()
return true

}, { timeoutMs: 15 * 60 * 1000 })
