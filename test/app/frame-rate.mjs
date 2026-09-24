/**
 * The frame rate control, driven as a user drives it.
 *
 * The unit tests cover `retimeTimeline` and `formatTimecode` as arithmetic. They cannot cover
 * the thing that was actually broken for the whole life of the project: **there was no way to
 * reach it.** `Timeline.fps` was written only by `setCanvasPreset`, every preset was 30, and
 * the inspector drew the rate as a `Readout`. A correct function no control can call is this
 * repo's most repeated defect, so this probe clicks the control.
 *
 * Three things it asserts that no unit test can:
 *
 * 1. The control exists, is a real `<select>`, and its options read `29.97 · NTSC` rather than
 *    `29.97002997002997` — the display form is the only place a rate is allowed to be rounded.
 * 2. Changing it moves a real clip on a real timeline, and the clip keeps its wall-clock time.
 * 3. The status bar's timecode does not grow a fraction at 29.97. This is the user-visible half
 *    of the `total % 29.97002997` bug, and it is only observable once a rate other than 30 can
 *    exist — which is why it survived: the bug and the feature gated each other.
 */

import { attach, runProbe, PreconditionError, ProbeFailure } from './cdp.mjs'

const CLIP = `${process.cwd()}/assets/podcast-cut/output/goodall-transcript-cut.mp4`
const { evaluate, close } = await attach()

let checks = 0
const check = (label, actual, expected) => {
  checks++
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) throw new ProbeFailure(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  console.log(`  ok  ${label}`)
}

await runProbe(async () => {

const ready = await evaluate(`Boolean(window.bayMcp && window.bayEngine)`)
if (ready !== true) {
  throw new PreconditionError(
    'window.bayMcp / window.bayEngine absent',
    'the debug surfaces are gated on bay.debug and need a reload after it is set'
  )
}

let n = 0
const mcp = async (tool, args = {}) => {
  const result = await evaluate(
    `window.bayMcp.execute(${JSON.stringify({ id: `t${++n}`, tool, args })})`
  )
  if (!result.ok) throw new Error(`${tool} failed: ${result.error}`)
  return result.value
}

const state = (expr) => evaluate(`(() => { const s = window.bayEngine.store.getState(); return ${expr} })()`)
const tl = (expr) => state(`(() => { const t = s.project.timelines.find(x => x.id === s.project.activeTimelineId); return ${expr} })()`)

// -- a clip to retime -------------------------------------------------------
// Placed well inside the timeline rather than at 0, because a clip at frame 0 scales to frame 0
// at every rate and would pass against an implementation that does nothing at all.
const imported = await mcp('import_media', { paths: [CLIP] })
const assetId = imported.assets?.[0]?.id ?? imported.assets?.[0]?.assetId
if (!assetId) throw new PreconditionError('import_media returned no asset', JSON.stringify(imported))
const placed = await mcp('place_asset', { assetId, atFrame: 300 })
const itemId = placed.itemId ?? placed.item?.id
if (!itemId) throw new PreconditionError('place_asset returned no item', JSON.stringify(placed))

const startFps = await tl('t.fps')
check('the timeline starts at 30fps', startFps, 30)
const startFrom = await tl(`t.tracks.flatMap(k => k.items).find(i => i.id === ${JSON.stringify(itemId)}).from`)
check('the clip is at frame 300, not 0', startFrom, 300)

// The selection has to be empty for the timeline inspector to be the visible one — with a clip
// selected the panel shows the clip instead, and the control under test is not in the DOM.
await evaluate(`window.bayEngine.store.setState({ selection: [] })`)
await new Promise((r) => setTimeout(r, 300))

// -- 1. the control is reachable and reads in the display form --------------
const select = `document.querySelector('select[aria-label="Frame rate"]')`
const found = await evaluate(`Boolean(${select})`)
check('a Frame rate <select> is in the inspector', found, true)

const options = await evaluate(`Array.from(${select}.options).map(o => o.textContent)`)
check('NTSC is offered by its display name', options, (o) => o.includes('29.97 · NTSC'))
check('no option leaks the raw quotient', options, (o) => !o.some((t) => /\d\.\d{4,}/.test(t)))
check('the rate list is the full eight', options, (o) => o.length === 8)

// -- 2. a rate with a real ratio moves the clip ---------------------------
// 30 -> 60 first, deliberately, because the ratio is exactly 2 and the expected frame is
// arithmetic rather than a tolerance. Doing NTSC first would have proved nothing about
// movement: 29.97 is 0.1% away from 30, so a clip at frame 300 correctly rounds back to
// frame 300 and an implementation that did nothing at all would pass.
const setRate = async (id) => {
  await evaluate(`(() => {
    const el = ${select}
    el.value = ${JSON.stringify(id)}
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 400))
}
const clip = () =>
  tl(`t.tracks.flatMap(k => k.items).find(i => i.id === ${JSON.stringify(itemId)})`)

const sourceBefore = (await clip()).sourceStartUs
const durationBefore = (await clip()).durationInFrames

await setRate('sixty')
check('the timeline is 60fps', await tl('t.fps'), 60)
const doubled = await clip()
check('the clip doubled its frame position, because the rate doubled', doubled.from, 600)
check('and its length doubled with it', doubled.durationInFrames, durationBefore * 2)
check(
  'so it sits at the same wall-clock second',
  Math.abs(doubled.from / 60 - 300 / 30),
  (d) => d < 1 / 60
)
check(
  'the source offset was not re-cut — microseconds into the source are not ours to scale',
  doubled.sourceStartUs,
  sourceBefore
)

await evaluate(`window.bayEngine.store.getState().undo()`)
await new Promise((r) => setTimeout(r, 300))
check('undo returns the timeline to 30fps', await tl('t.fps'), 30)
check('and the clip to frame 300', (await clip()).from, 300)

// -- 3. NTSC is stored exactly, and the timecode survives it ---------------
await setRate('ntsc')
const ntscFps = await tl('t.fps')
check('the timeline is the exact NTSC quotient', ntscFps, (f) => Math.abs(f - 30000 / 1001) < 1e-9)
check('and not the rounded decimal, which would export as 2997/100', ntscFps, (f) => f !== 29.97)
check(
  'a 0.1% rate change correctly leaves the clip on frame 300',
  (await clip()).from,
  300
)

// The rate shows in the status bar only in debug mode (the bar keeps developer data behind it),
// so turn it on for the read and put it back as found.
const debugWas = await state('s.debugMode')
if (!debugWas) await evaluate(`window.bayEngine.store.getState().toggleDebugMode()`)
await new Promise((r) => setTimeout(r, 100))
const bar = await evaluate(`(() => {
  const footer = document.querySelector('footer')
  return footer ? footer.textContent : null
})()`)
if (!debugWas) await evaluate(`window.bayEngine.store.getState().toggleDebugMode()`)
check('the status bar rendered', bar, (t) => typeof t === 'string' && t.length > 0)
check(
  'the duration timecode has no fractional frames field',
  bar,
  (t) => !/\d:\d{2}:\d+\.\d/.test(t)
)
// `includes('29.97')` was the first version of this check and it was a FALSE PASS: the raw
// quotient 29.97002997002997 contains '29.97' as a substring, so the assertion held while the
// bar was printing sixteen decimals at the user. The proof was accidental — the mutation run
// above printed the footer text on failure and the raw value was sitting in it. So the check is
// now the absence of a long decimal run anywhere in the bar, which no substring can satisfy.
check('the bar reports the rate in display form', bar, (t) => /fps\s*29\.97[^0-9]/.test(t))
check('and nothing in the bar prints a raw quotient', bar, (t) => !/\d\.\d{4,}/.test(t))

// -- one rate change is one undo step -------------------------------------
// A retime that cannot be taken back is worse than one that is wrong, because the clip
// positions are gone.
const pastBefore = await state('s.past.length')
await evaluate(`window.bayEngine.store.getState().undo()`)
await new Promise((r) => setTimeout(r, 300))
check('undo restores 30fps', await tl('t.fps'), 30)
check('exactly one history entry was consumed', await state('s.past.length'), pastBefore - 1)

// -- leave the project as it was found ------------------------------------
await mcp('delete_items', { itemIds: [itemId] })

console.log(`\n${checks}/${checks} checks passed`)
close()
// `runProbe` exits `ok ? 0 : 1` on this value, and several probes here return `false`
// deliberately, so it cannot be inferred. Omitting it printed "22/22 checks passed" and exited
// 1 — the report and the exit code disagreeing, which is the one failure a harness must not
// have. `await close()` after the body was dead code for the same reason: `runProbe` always
// calls `process.exit`.
return true

})
