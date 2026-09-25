/**
 * The junction markers and the transition dialog, driven as a user drives them.
 *
 * The unit tests cannot answer the question this asks. `resolveTransition` has been correct
 * and tested since before anything could reach it — bay's recurring failure is a correct
 * function with no caller, and transitions were exactly that for as long as the engine drew
 * seven kinds no control could create. So this probe clicks.
 *
 * Two behaviours are the point, because they are the two that silently do the wrong thing:
 *
 * 1. A 30-frame dissolve that plays as 8 is **indistinguishable from a straight cut** on the
 *    canvas. If the interface repeats the number that was asked for, nobody ever finds out.
 * 2. A cut with no handles cannot take a transition at all, and a drop that simply fails
 *    teaches the user that the feature is broken rather than that this cut is full.
 */

import { attach, runProbe, PreconditionError, ProbeFailure } from './cdp.mjs'

const CLIP = `${process.cwd()}/assets/podcast-cut/output/goodall-transcript-cut.mp4`
// A video asset is refused by an audio track, so the audio half of this probe needs its own.
const BED = `${process.cwd()}/assets/round2/bed_pad_c3.wav`
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
const ready = await evaluate(`Boolean(window.bayMcp && window.bayEngine)`)
if (ready !== true) {
  throw new PreconditionError('window.bayMcp / window.bayEngine absent — the debug surfaces are gated on bay.debug and need a reload after setting it')
}

let n = 0
const mcp = async (tool, args = {}) => {
  const result = await evaluate(
    `window.bayMcp.execute(${JSON.stringify({ id: `t${++n}`, tool, args })})`
  )
  if (!result.ok) throw new Error(`${tool} failed: ${result.error}`)
  return result.value
}

// -- a junction WITH handles ------------------------------------------------
// Both clips trimmed well inside the source, so each has footage to spare across the cut.
// Derived from the asset, never asserted as a literal: a fixture whose duration changes must
// make this probe adapt, not fail.
const imported = await mcp('import_media', { paths: [CLIP] })
const assetId = imported.assets[0].id
const a = await mcp('place_asset', { assetId, atFrame: 0 })
await mcp('edit_item', { itemId: a.itemId, durationInFrames: 200 })
const b = await mcp('place_asset', { assetId, atFrame: 200, trackId: a.trackId })
await mcp('edit_item', { itemId: b.itemId, from: 200, durationInFrames: 200 })
// Move the incoming clip's read point a *little* way into the source, so it has a handle but
// a short one. A small capacity is what lets the clamp be provoked with one keystroke instead
// of typing a large number into a field whose commit is timing-sensitive — see below.
await evaluate(
  `(() => { window.bayEngine.store.getState().patchItem(${JSON.stringify(b.itemId)}, { sourceStartUs: 200_000 }); return true })()`
)

/**
 * Poll rather than read once.
 *
 * A store mutation lands before React has rendered it, so reading the DOM in the same tick
 * that a tool call resolves finds the *previous* frame's markup. The first version of this
 * probe did exactly that and reported "no marker on the cut at frame 200" against a build
 * where the marker was correct — an instrument racing the thing it measures, which is the
 * worst kind of failing test because it accuses working code.
 */
const waitFor = async (label, expression, attempts = 40) => {
  for (let i = 0; i < attempts; i++) {
    const value = await evaluate(expression)
    if (value !== null && value !== false) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

const markerAt = (frame) =>
  waitFor(
    `marker at ${frame}`,
    `(() => {
    const buttons = [...document.querySelectorAll('button[aria-label^="Transition at frame"]')]
    const one = buttons.find((el) => el.getAttribute('aria-label').startsWith('Transition at frame ${frame}.'))
    return one ? { label: one.getAttribute('aria-label'), text: one.textContent.trim() } : null
  })()`
  )

const withRoom = await markerAt(200)
check('a marker exists on the cut at frame 200', withRoom !== null, true)
check(
  'and it offers to add one, naming the room available',
  withRoom.label,
  (l) => /No transition on this cut/.test(l) && /Room for up to \d+ frames/.test(l)
)

// -- the dialog, and the clamp warning before the fact ----------------------
const openDialog = (frame) =>
  evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button[aria-label^="Transition at frame"]')]
    const one = buttons.find((el) => el.getAttribute('aria-label').startsWith('Transition at frame ${frame}.'))
    if (!one) return false
    // A plain click edits the cut in the Inspector's Transition tab; ⌥-click opens the dialog,
    // which is what this probe drives.
    one.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))
    return true
  })()`)

const dialogText = () =>
  waitFor(
    'dialog',
    `(() => {
    const dialog = document.querySelector('[role="dialog"]')
    return dialog ? dialog.textContent : null
  })()`
  )

/** Same, inverted: a close is also a render away. */
const dialogGone = async () => {
  for (let i = 0; i < 40; i++) {
    if ((await evaluate(`document.querySelector('[role="dialog"]') === null`)) === true) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

check('clicking the marker opens a dialog', await openDialog(200), true)
const roomText = await dialogText()
check('the dialog names the capacity of the cut', roomText, (t) => /can carry up to/.test(t))
check('and the Add button is enabled', await evaluate(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Add transition|Update/.test(x.textContent))
  return b ? !b.disabled : null
})()`), true)

// Ask for far more than the cut can give; the dialog must contradict its own field.
const capacity = await evaluate(`(() => {
  const m = document.querySelector('[role="dialog"]').textContent.match(/can carry up to\\s*(\\d+)\\s*frames/)
  return m ? Number(m[1]) : null
})()`)
check('capacity is a positive number', capacity, (c) => Number.isFinite(c) && c > 0)

// Shift+ArrowUp rather than typing.
//
// `NumberField` commits on **blur**, from a `draft` that `onChange` set — two React state
// updates in two events. Driven over CDP that raced one run in three: the blur handler closed
// over a `draft` that was still null and committed nothing, so the probe reported a missing
// clamp warning against a dialog that was working. The arrow-key path calls `commit` directly
// inside its own keydown handler and depends on no flushed state, which is why it is used
// here. A probe that fails one run in three teaches people to re-run until green.
await evaluate(`(() => {
  const input = document.querySelector('[role="dialog"] input')
  input.focus()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }))
  return true
})()`)

const overAsk = await waitFor(
  'clamp warning',
  `(() => {
    const d = document.querySelector('[role="dialog"]')
    return d && /will play as/.test(d.textContent) ? d.textContent : null
  })()`
)
check(
  'asking for more than the cut holds is contradicted before applying',
  overAsk !== null,
  true
)
const clampNumbers = (overAsk ?? '').match(/will play as\s*(\d+)\s*frames, not\s*(\d+)/)
check('the contradiction names both numbers, not just a complaint', clampNumbers !== null, true)
check(
  'the effective number is the capacity and the request is larger',
  clampNumbers && [Number(clampNumbers[1]), Number(clampNumbers[2])],
  (pair) => pair !== null && pair[0] === capacity && pair[1] > capacity
)

// Apply it and confirm the marker reports the EFFECTIVE length, not the request.
await evaluate(`(() => {
  [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Add transition|Update/.test(x.textContent)).click()
  return true
})()`)
const applied = await waitFor(
  'marker showing a transition',
  `(() => {
    const buttons = [...document.querySelectorAll('button[aria-label^="Transition at frame"]')]
    const one = buttons.find((el) => el.getAttribute('aria-label').startsWith('Transition at frame 200.'))
    return one && /Cross dissolve/.test(one.getAttribute('aria-label'))
      ? { label: one.getAttribute('aria-label') }
      : null
  })()`
)
check('after applying, a marker names the transition', applied !== null, true)
check(
  'and it reports the effective length with the reason it is short',
  applied.label,
  (l) => /playing \d+/.test(l) && /frames of footage/.test(l)
)
const reported = Number(applied.label.match(/playing (\d+)/)[1])
check('the effective length never exceeds the capacity', reported <= capacity, true)

// -- the engine's own clamp reason, read back on a stored transition --------
// The case team-lead named: a dissolve asked for long and played short. Added through MCP so
// no field has to be driven, then read out of the dialog — the number the user sees has to be
// the one the engine will draw, not the one that was requested.
const stored = await mcp('add_transition', {
  fromItemId: a.itemId,
  toItemId: b.itemId,
  kind: 'dip-to-black',
  durationInFrames: 300
})
check('the engine reports its own clamp on the tool result', stored.clampedBecause, (r) => typeof r === 'string' && r.length > 0)
check('and the effective window is shorter than the request', stored.effectiveDurationInFrames < 300, true)

check('the dialog opens on the stored transition', await openDialog(200), true)
const storedText = await dialogText()
check(
  'and repeats the engine reason rather than the requested number',
  storedText,
  (t) => /Currently playing as/.test(t) && /rather than the 300/.test(t)
)
await evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
await dialogGone()

// -- editing keeps the transition's identity -------------------------------
// Remove-then-add would renumber what the user experiences as editing one transition, so an
// agent holding the id from `add_transition` would find it gone after someone nudged the
// duration. The id is the observable, so the id is what this asserts.
const idsBefore = await evaluate(
  `window.bayEngine.store.getState().project.timelines[0].transitions.map((t) => t.id)`
)
check('exactly one transition is stored before the edit', idsBefore.length, 1)
check('editing it opens the dialog', await openDialog(200), true)
await evaluate(`(() => {
  const input = document.querySelector('[role="dialog"] input')
  input.focus()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }))
  return true
})()`)
await evaluate(`(() => {
  [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Update/.test(x.textContent)).click()
  return true
})()`)
await dialogGone()
const idsAfter = await evaluate(
  `window.bayEngine.store.getState().project.timelines[0].transitions.map((t) => t.id)`
)
check('still exactly one transition after the edit', idsAfter.length, 1)
check('and it kept its id rather than being replaced', idsAfter[0], idsBefore[0])

// -- a junction with NO handles --------------------------------------------
// Two clips that each use their whole source: they abut, and there is nothing to dissolve.
await mcp('add_track', { kind: 'video' })
const tracks = await evaluate(`window.bayEngine.store.getState().project.timelines[0].tracks.filter((t) => t.kind === 'video').map((t) => t.id)`)
const bare = tracks[tracks.length - 1]
const c = await mcp('place_asset', { assetId, atFrame: 0, trackId: bare })
const full = await evaluate(`(() => {
  const tl = window.bayEngine.store.getState().project.timelines[0]
  const item = tl.tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(c.itemId)})
  return item.durationInFrames
})()`)
const d = await mcp('place_asset', { assetId, atFrame: full, trackId: bare })
await mcp('edit_item', { itemId: d.itemId, from: full })

const noRoom = await markerAt(full)
check(`a marker exists on the handle-less cut at frame ${full}`, noRoom !== null, true)
check(
  'and it says the cut cannot take one rather than staying silent',
  noRoom.label,
  (l) => /cannot take one/.test(l)
)

check('clicking it opens the dialog anyway', await openDialog(full), true)
const refusal = await dialogText()
check(
  'which explains why, naming the side that is short',
  refusal,
  (t) => /no footage|Neither clip has footage/.test(t)
)
check(
  'and explains what a handle is rather than assuming the vocabulary',
  refusal,
  (t) => /does not shorten the timeline/.test(t)
)
check('the Add button is disabled, not merely unresponsive', await evaluate(`(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Add transition/.test(x.textContent))
  return b ? b.disabled : null
})()`), true)

// Escape must dismiss it — a dialog that traps Tab and cannot be closed is a trap.
await evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
check('Escape closes the dialog', await dialogGone(), true)

// -- the audio lane has no markers ----------------------------------------
// Built as a real adjacent pair, because the first version of this check only asserted that
// an audio track existed — which passes on a build that covers every audio cut in markers.
// A check that cannot fail for the reason it names is not a check.
const bed = await mcp('import_media', { paths: [BED] })
const bedId = bed.assets[0].id
await mcp('add_track', { kind: 'audio' })
const audioTrack = await evaluate(
  `(() => { const tl = window.bayEngine.store.getState().project.timelines[0]
            const a = tl.tracks.filter((t) => t.kind === 'audio'); return a[a.length - 1].id })()`
)
const e = await mcp('place_asset', { assetId: bedId, atFrame: 0, trackId: audioTrack })
await mcp('edit_item', { itemId: e.itemId, from: 0, durationInFrames: 120 })
const f = await mcp('place_asset', { assetId: bedId, atFrame: 120, trackId: audioTrack })
await mcp('edit_item', { itemId: f.itemId, from: 120, durationInFrames: 120 })

const audioCutIsAdjacent = await evaluate(`(() => {
  const tl = window.bayEngine.store.getState().project.timelines[0]
  const track = tl.tracks.find((t) => t.id === ${JSON.stringify(audioTrack)})
  const items = [...track.items].sort((a, b) => a.from - b.from)
  return items.length >= 2 && items[0].from + items[0].durationInFrames === items[1].from
})()`)
check('the two audio clips really do abut, so the absence below means something', audioCutIsAdjacent, true)
// Give the render a chance to produce a marker before concluding there is none.
await new Promise((resolve) => setTimeout(resolve, 400))
check('and no junction marker is drawn on an audio cut', await evaluate(`(() => {
  return [...document.querySelectorAll('button[aria-label^="Transition at frame"]')]
    .some((el) => el.getAttribute('aria-label').startsWith('Transition at frame 120.'))
})()`), false)

console.log(`\n${checks}/${checks} checks passed`)
close()
return true

})
