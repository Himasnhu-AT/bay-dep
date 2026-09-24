/**
 * `sourceStartSeconds`, `adjustments` and `blendMode` as an agent reaches them.
 *
 * All three were schema before they were executor, which is the gap this project keeps finding:
 * a catalog entry describes a capability and nothing behind it answers. So these checks are
 * against the *documented* behaviour rather than against what the code happens to do —
 * including the promises in the descriptions, which are as binding as the types.
 *
 * Every refusal is paired with the nearest legal call, because "the bad call was refused"
 * passes trivially against a tool that refuses everything.
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

await evaluate(`localStorage.setItem('bay.debug','1')`)
if ((await evaluate(`Boolean(window.bayMcp)`)) !== true) {
  throw new PreconditionError('window.bayMcp absent — gated on bay.debug, needs a reload after setting it')
}

let n = 0
const raw = (tool, args = {}) =>
  evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `s${++n}`, tool, args })})`)
const mcp = async (tool, args = {}) => {
  const result = await raw(tool, args)
  if (!result.ok) throw new Error(`${tool} failed: ${result.error}`)
  return result.value
}

const imported = await mcp('import_media', { paths: [CLIP] })
const asset = imported.assets[0]
const assetId = asset.id

// Where the clip goes is derived, never assumed. This placed at frame 0 with no track and
// relied on that landing on the lowest video track — true only on an empty timeline; on one
// where frame 0 of V1 is taken, `place_asset` opens a higher track, and the blend-mode check
// below then accuses a correct warning of being missing. So: the lowest video track (the
// first in the list — later tracks paint on top), at the first frame past everything on it.
const activeTimeline = `(() => { const s = window.bayEngine.store.getState()
  return s.project.timelines.find((t) => t.id === s.project.activeTimelineId) })()`
const lowest = await evaluate(`(() => {
  const v = ${activeTimeline}.tracks.find((t) => t.kind === 'video')
  return v ? { id: v.id, locked: v.locked, end: v.items.reduce((e, i) => Math.max(e, i.from + i.durationInFrames), 0) } : null
})()`)
if (!lowest) throw new PreconditionError('the active timeline has no video track to place on')
if (lowest.locked) throw new PreconditionError('the lowest video track is locked', 'a probe must not unlock the user\'s track')
const start = lowest.end
const placed = await mcp('place_asset', { assetId, atFrame: start, trackId: lowest.id })
const itemId = placed.itemId
await mcp('edit_item', { itemId, durationInFrames: 120 })
const where = await evaluate(`(() => {
  const i = ${activeTimeline}.tracks.flatMap((t) => t.items).find((x) => x.id === ${JSON.stringify(itemId)})
  return { from: i.from, trackId: i.trackId }
})()`)
check('the clip landed where it was asked, on the lowest video track', where, (w) => w.from === start && w.trackId === lowest.id)

// -- seconds in, seconds out -----------------------------------------------
const moved = await mcp('edit_item', { itemId, sourceStartSeconds: 10 })
check('edit_item reports sourceStartSeconds, not microseconds', moved.sourceStartSeconds, 10)
const inspected = await mcp('inspect_item', { itemId })
check('inspect_item reports the same unit it accepts', inspected.timing.sourceStartSeconds, 10)
check(
  'and says how much source is left from there',
  inspected.timing.sourceRemainingSeconds,
  (v) => typeof v === 'number' && v > 0 && v < asset.durationInFrames
)

// -- it must not move the clip --------------------------------------------
// The whole point of the field is that only *what plays* changes. A clip that jumps when it is
// retimed reads as a timeline bug rather than a unit one, which is the expensive confusion.
check('the clip did not move on the timeline', moved.from, start)
check('and kept its length', moved.durationInFrames, 120)

// -- refusing past the end, beside a legal call that must still work ------
const lengthSeconds = inspected.timing.sourceStartSeconds + inspected.timing.sourceRemainingSeconds
const tooFar = await raw('edit_item', { itemId, sourceStartSeconds: lengthSeconds + 60 })
check('a start point past the end of the source is refused', tooFar.ok, false)
check(
  'and the refusal names the length so the next call can succeed',
  tooFar.error,
  (e) => new RegExp(lengthSeconds.toFixed(2).replace('.', '\\.')).test(e)
)
const justInside = await raw('edit_item', { itemId, sourceStartSeconds: lengthSeconds - 1 })
check('POSITIVE CONTROL: just inside the source is accepted', justInside.ok, true)
await mcp('edit_item', { itemId, sourceStartSeconds: 10 })

// A start point inside the source whose tail runs out is warned, not refused — pushing the
// read point forward to make room for a transition does exactly this.
const overrun = await mcp('edit_item', { itemId, sourceStartSeconds: lengthSeconds - 1, durationInFrames: 120 })
check('a tail that runs out of footage warns rather than refusing', overrun.warnings, (w) =>
  Array.isArray(w) && w.some((line) => /no footage/.test(line))
)
check('and the warning says how many frames actually remain', overrun.warnings, (w) =>
  w.some((line) => /Shorten it to \d+ frames/.test(line))
)
await mcp('edit_item', { itemId, sourceStartSeconds: 10, durationInFrames: 120 })

// -- adjustments merge ----------------------------------------------------
await mcp('edit_item', { itemId, adjustments: { saturate: 0.3 } })
const merged = await mcp('edit_item', { itemId, adjustments: { blur: 4 } })
check('a second adjustment does not reset the first', merged.adjustments.saturate, 0.3)
check('and the new one is applied', merged.adjustments.blur, 4)
check('untouched fields hold their identity values', merged.adjustments.brightness, 1)
check(
  'the result reports the filter the compositor will use',
  merged.filter,
  (f) => typeof f === 'string' && /saturate\(0\.3\)/.test(f) && /blur\(4px\)/.test(f)
)

const bogus = await raw('edit_item', { itemId, adjustments: { sharpen: 2 } })
check('an adjustment field that does not exist is refused', bogus.ok, false)
check('and the refusal lists the ones that do', bogus.error, (e) => /brightness/.test(e) && /saturate/.test(e))
const outOfRange = await raw('edit_item', { itemId, adjustments: { grayscale: 4 } })
check('a proportion above 1 is refused rather than clamped', outOfRange.ok, false)
const inRange = await raw('edit_item', { itemId, adjustments: { grayscale: 0.5 } })
check('POSITIVE CONTROL: the same field in range is accepted', inRange.ok, true)

// Identity adjustments are stored and change nothing — invisible unless something says so.
const fresh = await mcp('place_asset', { assetId, atFrame: start + 200, trackId: lowest.id })
const identity = await mcp('edit_item', { itemId: fresh.itemId, adjustments: { brightness: 1 } })
check('adjustments that amount to the identity are called out', identity.warnings, (w) =>
  Array.isArray(w) && w.some((line) => /nothing will look different/.test(line))
)
check('and no filter string is reported for them', identity.filter, undefined)

// -- blend mode on the lowest video track --------------------------------
const bottom = await mcp('edit_item', { itemId, blendMode: 'multiply' })
check('blendMode is stored', bottom.blendMode, 'multiply')
check('and a mode on the lowest video track is called out as inapplicable', bottom.warnings, (w) =>
  Array.isArray(w) && w.some((line) => /lowest video track/.test(line))
)
await mcp('add_track', { kind: 'video' })
const upperTrack = await evaluate(
  `(() => { const v = ${activeTimeline}.tracks.filter((t) => t.kind === 'video'); return v[v.length - 1].id })()`
)
const above = await mcp('place_asset', { assetId, atFrame: start, trackId: upperTrack })
const upper = await mcp('edit_item', { itemId: above.itemId, blendMode: 'multiply' })
check('POSITIVE CONTROL: the same mode higher up draws no such warning', upper.warnings, (w) =>
  w === undefined || !w.some((line) => /lowest video track/.test(line))
)
const badMode = await raw('edit_item', { itemId: above.itemId, blendMode: 'destination-atop' })
check('a compositing operator that is not a blend mode is refused', badMode.ok, false)
check('and the refusal lists the modes', badMode.error, (e) => /multiply/.test(e) && /luminosity/.test(e))

// -- add_transition with the duration omitted ----------------------------
// Documented: "Omit it and bay picks about a second, or the most this junction can take."
// Derived, never a literal. `1000` was a free frame until the clip placed above it turned out
// to span its whole source — the eighth time a hardcoded fixture position in this project has
// accused working code. Ask where the track actually ends.
const trackEnd = await evaluate(`(() => {
  const track = ${activeTimeline}.tracks.find((t) => t.id === ${JSON.stringify(upperTrack)})
  return track.items.reduce((end, i) => Math.max(end, i.from + i.durationInFrames), 0)
})()`)
const cut = trackEnd + 60
const t1 = await mcp('place_asset', { assetId, atFrame: cut, trackId: upperTrack })
await mcp('edit_item', { itemId: t1.itemId, from: cut, durationInFrames: 200 })
const t2 = await mcp('place_asset', { assetId, atFrame: cut + 200, trackId: upperTrack })
await mcp('edit_item', {
  itemId: t2.itemId,
  from: cut + 200,
  durationInFrames: 200,
  sourceStartSeconds: 5
})

const defaulted = await mcp('add_transition', {
  fromItemId: t1.itemId,
  toItemId: t2.itemId,
  kind: 'cross-dissolve'
})
check('omitting durationInFrames is accepted, as documented', defaulted.active, true)
check('and the length chosen is sensible rather than minimal', defaulted.effectiveDurationInFrames, (d) => d >= 2)
check('every result reports the junction ceiling', defaulted.maxDurationInFrames, (m) => typeof m === 'number' && m >= 2)
check(
  'and the chosen length never exceeds it',
  defaulted.effectiveDurationInFrames <= defaulted.maxDurationInFrames,
  true
)

console.log(`\n${checks}/${checks} checks passed`)
close()
return true

})
