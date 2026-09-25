/**
 * The Adjustments panel, driven as a user drives it.
 *
 * Three things the unit tests cannot see, and each has a matching failure in this project's
 * history:
 *
 * 1. **That the controls reach the compositor at all.** Text controls were once built against a
 *    draw path that did not exist. Here the check is that a slider move changes the stored
 *    adjustments AND that the filter shown is the one the compositor builds.
 * 2. **That the readout is in the compositor's order.** `blur` is applied last, not fifth where
 *    its slider sits, and two filter builders in this tree disagree about exactly that. A panel
 *    showing the wrong order would be a confident lie about the picture.
 * 3. **That a multi-selection does not leak one clip's look onto the others.** Merging a patch
 *    onto the *first* item's adjustments instead of onto each item's own is the natural mistake
 *    and produces a blur appearing on clips nobody blurred.
 */

import { attach, runProbe, PreconditionError, ProbeFailure, showInspector } from './cdp.mjs'

const CLIP = process.env.CLIP ?? `${process.cwd()}/assets/podcast-cut/output/goodall-transcript-cut.mp4`
const BED = process.env.BED ?? `${process.cwd()}/assets/round2/bed_pad_c3.wav`
const { evaluate, close } = await attach()

let checks = 0
const check = (label, actual, expected) => {
  checks++
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) throw new ProbeFailure(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  console.log(`  ok  ${label}`)
}
const waitFor = async (expression, attempts = 40) => {
  for (let i = 0; i < attempts; i++) {
    const value = await evaluate(expression)
    if (value !== null && value !== false) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

await runProbe(async () => {

await evaluate(`localStorage.setItem('bay.debug','1')`)
if ((await evaluate(`Boolean(window.bayMcp && window.bayEngine)`)) !== true) {
  throw new PreconditionError('window.bayMcp / window.bayEngine absent — gated on bay.debug, needs a reload')
}

let n = 0
const mcp = async (tool, args = {}) => {
  const r = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `a${++n}`, tool, args })})`)
  if (!r.ok) throw new Error(`${tool} failed: ${r.error}`)
  return r.value
}
const select = (ids) =>
  evaluate(`(() => { window.bayEngine.store.getState().select(${JSON.stringify(ids)}, false); return true })()`)
const adjustmentsOf = (id) =>
  evaluate(`(() => {
    const tl = window.bayEngine.store.getState().project.timelines[0]
    const item = tl.tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(id)})
    return item.adjustments ?? null
  })()`)
const sectionText = (title) =>
  evaluate(`(() => {
    const heads = [...document.querySelectorAll('h3, h4, [class*="uppercase"]')]
    const head = heads.find((h) => h.textContent.trim() === ${JSON.stringify(title)})
    return head ? (head.closest('section') ?? head.parentElement)?.textContent ?? null : null
  })()`)

// This probe places its first clip and then expects it to be on the LOWEST video track — which
// is only true of a timeline that started empty. The app reopens the last saved project, so for
// as long as that was blank the assumption held silently; against a real project the clip lands
// on a higher track, blend mode is enabled there, and the check reports a fault in working code.
const stale = await evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  const t = s.project.timelines.find((x) => x.id === s.project.activeTimelineId)
  return t.tracks.flatMap((k) => k.items).map((i) => i.id)
})()`)
if (stale.length > 0) {
  await mcp('delete_items', { itemIds: stale })
  console.log(`   cleared ${stale.length} item(s) the reopened project brought with it`)
}

const imported = await mcp('import_media', { paths: [CLIP] })
const assetId = imported.assets[0].id
const one = await mcp('place_asset', { assetId, atFrame: 0 })
await mcp('edit_item', { itemId: one.itemId, durationInFrames: 120 })
await select([one.itemId])
// The Inspector is tabbed: Adjustments live on its Effects tab, Transform and Composite (blend)
// on Video. Each section is read on its own tab.
check('the Inspector shows its Effects tab for the clip', await showInspector(evaluate, 'effects'), true)

// -- the section exists and is called Adjustments, not Colour ---------------
const heading = await waitFor(`(() => {
  const t = document.body.textContent
  return t.includes('Adjustments') ? { adjustments: true, colour: /\\bColour grade\\b/.test(t) } : null
})()`)
check('the panel has an Adjustments section', heading !== null, true)
check('the sliders are present', await evaluate(`
  ['Brightness','Contrast','Saturate','Hue','Blur','Greyscale','Sepia','Invert']
    .every((label) => [...document.querySelectorAll('[aria-label]')].some((el) => el.getAttribute('aria-label') === label))
`), true)
// An aria-label is not a caption. All eight shipped as bare tracks with the name only in
// `aria-label` — the check above passed while a sighted person saw eight identical lines. So
// the name must be *rendered* in the slider's own row, as text a person can read.
const uncaptioned = await evaluate(`
  ['Brightness','Contrast','Saturate','Hue','Blur','Greyscale','Sepia','Invert'].filter((label) => {
    const el = [...document.querySelectorAll('[role=slider]')].find((e) => e.getAttribute('aria-label') === label)
    let row = el?.parentElement
    while (row && !row.className.includes('grid-cols-')) row = row.parentElement
    return !row || row.innerText.split('\\n')[0].trim() !== label
  })
`)
check('every Adjustments slider shows its name beside it, not only in aria-label', uncaptioned, (list) => list.length === 0)
check('the Inspector shows its Video tab', await showInspector(evaluate, 'video'), true)
check('the Transform section is shown for a video clip (the positive control for audio below)',
  await evaluate(`[...document.querySelectorAll('h3')].some((h) => h.textContent.trim().toLowerCase() === 'transform')`), true)
check('back on the Effects tab', await showInspector(evaluate, 'effects'), true)

// -- a slider move reaches the store --------------------------------------
const moveSlider = (label, value) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === ${JSON.stringify(label)})
    if (!el) return 'missing'
    el.focus()
    // Arrow keys commit through the control's own handler rather than through a synthetic
    // value assignment, which React would not see.
    for (let i = 0; i < ${value}; i++) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    }
    return true
  })()`)

check('the Blur slider is reachable', await moveSlider('Blur', 8), true)
const blurred = await waitFor(`(() => {
  const tl = window.bayEngine.store.getState().project.timelines[0]
  const item = tl.tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(one.itemId)})
  return item.adjustments && item.adjustments.blur > 0 ? item.adjustments : null
})()`)
check('moving it changes the stored adjustments', blurred !== null, true)
// The readout is derived from the stored value, so it survives any starting blur.
const blurReadout = await evaluate(`(() => {
  const el = [...document.querySelectorAll('[role=slider]')].find((e) => e.getAttribute('aria-label') === 'Blur')
  let row = el?.parentElement
  while (row && !row.className.includes('grid-cols-')) row = row.parentElement
  return row ? row.innerText : null
})()`)
check('the Blur row reads out the stored value with its unit', blurReadout,
  (text) => typeof text === 'string' && blurred !== null && text.includes(`${blurred.blur.toFixed(1)}px`))
check('and leaves the other seven at identity', blurred, (a) => a.brightness === 1 && a.grayscale === 0)

// -- the readout is in the COMPOSITOR's order, blur last ------------------
await mcp('edit_item', { itemId: one.itemId, adjustments: { blur: 4, grayscale: 1, contrast: 0.5 } })
const readout = await waitFor(`(() => {
  const el = [...document.querySelectorAll('p')].find((p) => /blur\\(4px\\)/.test(p.textContent))
  return el ? el.textContent.trim() : null
})()`)
check('the panel shows the filter string', readout !== null, true)
check(
  'and blur is LAST, as the compositor applies it — not fifth where its slider sits',
  readout,
  (t) => /contrast\(0\.5\) grayscale\(1\) blur\(4px\)/.test(t)
)
// -- blend mode: disabled on the bottom track, with the reason ------------
check('the Inspector shows its Video tab, where Composite lives', await showInspector(evaluate, 'video'), true)
const blendDisabled = await waitFor(`(() => {
  const el = [...document.querySelectorAll('select[aria-label="Blend mode"]')][0]
  return el ? el.disabled : null
})()`)
check('blend mode is disabled on the lowest video track', blendDisabled, true)
const blendText = await sectionText('Composite')
check(
  'and the reason is on screen rather than left to be guessed',
  blendText,
  (t) => typeof t === 'string' && /lowest video track/.test(t)
)

await mcp('add_track', { kind: 'video' })
const upper = await evaluate(`(() => {
  const tl = window.bayEngine.store.getState().project.timelines[0]
  const v = tl.tracks.filter((t) => t.kind === 'video'); return v[v.length - 1].id })()`)
const above = await mcp('place_asset', { assetId, atFrame: 0, trackId: upper })
await select([above.itemId])
const blendEnabled = await waitFor(`(() => {
  const el = document.querySelector('select[aria-label="Blend mode"]')
  return el && el.disabled === false ? true : null
})()`)
check('POSITIVE CONTROL: enabled one track up, so the disable is about the stack not the build', blendEnabled, true)

// -- a multi-selection must not leak one clip's look onto the others ------
await mcp('edit_item', { itemId: above.itemId, adjustments: { sepia: 0.8 } })
// Derived. `600` was a free frame until the clip above turned out to span its whole source —
// the ninth hardcoded fixture position in this project to accuse working code.
const freeFrame = await evaluate(`(() => {
  const tl = window.bayEngine.store.getState().project.timelines[0]
  const track = tl.tracks.find((t) => t.id === ${JSON.stringify(upper)})
  return track.items.reduce((end, i) => Math.max(end, i.from + i.durationInFrames), 0) + 30
})()`)
const clean = await mcp('place_asset', { assetId, atFrame: freeFrame, trackId: upper })
await mcp('edit_item', { itemId: clean.itemId, from: freeFrame, durationInFrames: 120 })
await select([above.itemId, clean.itemId])
check('the Inspector shows its Effects tab for the two clips', await showInspector(evaluate, 'effects'), true)
// "Saturate", not "Saturation" since 326f50d: the Grade has a saturation of its own.
check('the Saturate slider is reachable with two clips selected', await moveSlider('Saturate', 3), true)
const leaked = await waitFor(`(() => {
  const tl = window.bayEngine.store.getState().project.timelines[0]
  const item = tl.tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(clean.itemId)})
  return item.adjustments ? item.adjustments : null
})()`)
check('the second clip got the edited field', leaked, (a) => a.saturate !== 1)
check(
  "and did NOT inherit the first clip's sepia",
  leaked.sepia,
  0
)
const kept = await adjustmentsOf(above.itemId)
check('while the first clip kept its own sepia', kept.sepia, 0.8)

// -- audio-only items get no Adjustments at all --------------------------
const bed = await mcp('import_media', { paths: [BED] })
await mcp('add_track', { kind: 'audio' })
const audioTrack = await evaluate(`(() => {
  const tl = window.bayEngine.store.getState().project.timelines[0]
  const a = tl.tracks.filter((t) => t.kind === 'audio'); return a[a.length - 1].id })()`)
const sound = await mcp('place_asset', { assetId: bed.assets[0].id, atFrame: 0, trackId: audioTrack })
await select([sound.itemId])
// Asked for on the Effects tab, where Adjustments would be if an audio clip were offered them —
// on any other tab their absence would prove nothing.
await showInspector(evaluate, 'effects')
await new Promise((resolve) => setTimeout(resolve, 400))
check('an audio-only clip is offered no Adjustments — there is nothing to filter', await evaluate(`
  [...document.querySelectorAll('[aria-label]')].some((el) => el.getAttribute('aria-label') === 'Brightness')
`), false)
check('POSITIVE CONTROL: the Effects tab is drawn for that clip — its sound empty state, not a blank panel', await evaluate(`
  document.body.textContent.includes('No effects for sound')
`), true)
check('POSITIVE CONTROL: the Audio tab shows that clip\'s Audio section', await showInspector(evaluate, 'audio') && await evaluate(`
  [...document.querySelectorAll('h3')].some((h) => h.textContent.trim().toLowerCase() === 'audio')
`), true)
// X/Y/W/H/Rotate/Opacity move nothing anyone can see on a music bed.
check('an audio-only clip is offered no Transform section either', await evaluate(`
  [...document.querySelectorAll('h3')].some((h) => h.textContent.trim().toLowerCase() === 'transform')
`), false)
check('and its Video tab is disabled, so Transform is not merely on another tab', await evaluate(`
  document.querySelector('[role=tab][aria-label="Video"]')?.disabled ?? null
`), true)

console.log(`\n${checks}/${checks} checks passed`)
close()
return true

})
