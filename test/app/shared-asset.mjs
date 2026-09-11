/**
 * Two items, one asset, two source times — the seek thrash.
 *
 * When two items under the playhead share an asset, they share the *one* pooled media
 * element, and each wants it at a different `currentTime`. Before `seekOwners()`, both
 * issued their target every frame: the element never finished a seek, `readyState` sat at 1
 * with `seeking` true, every item reported `pending`, and the canvas stayed blank
 * permanently — a forced `redraw()` did not mend it, because the next draw restarted the
 * fight.
 *
 * Three things about how this is asserted, each of which was a wrong turn first:
 *
 * 1. **It builds its own scenario.** The bug needs two items sharing one asset, which no
 *    fixture is guaranteed to hold — and against a one-item profile the condition cannot
 *    occur at all, which is exactly why the same probe passed for one person and failed for
 *    another on identical code.
 * 2. **It asserts the positive**, not the blank state. Unfixed this failed 9 runs in 10, not
 *    10 in 10 — decode timing moves it. Asserting "the picture is there and the element
 *    settled" is deterministic with the fix and fails often without it; asserting blankness
 *    would be pinning a race.
 * 3. **It never reloads between building and measuring.** `attach()` reloads, and
 *    `project.initial()` then restores the profile's own project — so the second item
 *    vanishes before it can be seen. That is why the failing state looked like a one-item
 *    timeline to three people. The timeline state is read in the *same* evaluate as the
 *    pixels.
 *
 * Run `TRIALS=10`; one trial would call the fix unnecessary about one time in ten.
 */

import { attach, CANVAS_PROFILE, requirePrecondition, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const TRIALS = Number(process.env.TRIALS ?? 10)
const { evaluate, close } = await attach()

await runProbe(async () => {
  // Import once. `importPaths` dedupes by path, so both items get the same asset id —
  // which is the entire condition under test.
  const asset = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
    if (!im.length) throw new Error('import returned nothing')
    return im[0].asset
  })()`, 60_000)

  /** Rebuilds the scenario from scratch: two items, one asset, two source times. */
  const build = `(() => {
    const { store } = window.bayEngine
    // addAssets skips duplicates, so this is safe to repeat every trial — and without it
    // placeAsset finds no asset in the store and returns null. (No backticks in here: this
    // whole block is a template literal and a backtick would close it.)
    store.getState().addAssets([${JSON.stringify(asset)}])
    const st = store.getState()
    // Start from a known empty timeline so a seeded profile cannot change the shape.
    const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    store.getState().setProject({
      ...st.project,
      timelines: st.project.timelines.map(t =>
        t.id === tl.id ? { ...t, background: '#000000', tracks: t.tracks.map(k => ({ ...k, items: [] })) } : t)
    })
    // placeAsset twice: the second finds no room at frame 0 and opens a new video track,
    // so the upper one is topmost and owns the element's time.
    const a = store.getState().placeAsset(${JSON.stringify(asset.id)}, 0)
    const b = store.getState().placeAsset(${JSON.stringify(asset.id)}, 0)
    if (!a || !b) throw new Error('placeAsset refused: ' + JSON.stringify({ a, b }))
    // Lower item reads 20s in; upper reads from the start. Two targets, one element.
    store.getState().patchItem(a, { durationInFrames: 150, sourceStartUs: 20000000 })
    store.getState().patchItem(b, { durationInFrames: 2035, sourceStartUs: 0 })
    store.getState().setPlayhead(0)
    return { a, b }
  })()`

  /** Pixels and element state in ONE evaluate — no reload, nothing in between. */
  const observe = `(() => {
    const { engine, store } = window.bayEngine
    const st = store.getState()
    const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    const items = tl.tracks.flatMap(t => t.items)
    const el = (engine.pool.peek(${JSON.stringify(asset.id)}) || {}).element
    return {
      items: items.length,
      distinctAssets: new Set(items.map(i => i.assetId)).size,
      sourceTimes: items.map(i => i.sourceStartUs),
      element: el ? { readyState: el.readyState, seeking: el.seeking, currentTime: +el.currentTime.toFixed(3) } : null,
      profile: ${CANVAS_PROFILE}
    }
  })()`

  if (process.env.VERIFY_PROBE === '1') {
    // Break the DRAW, not the setup. Making the two source times agree would remove the
    // condition and pass — the tautology this self-check exists to avoid.
    await evaluate(`(() => {
      const proto = CanvasRenderingContext2D.prototype
      if (!proto.__bayRealDrawImage) proto.__bayRealDrawImage = proto.drawImage
      proto.drawImage = function () { /* no-op: a compositor that draws nothing */ }
      return true
    })()`)
  }

  const results = []
  for (let trial = 1; trial <= TRIALS; trial += 1) {
    await evaluate(build)
    await new Promise((r) => setTimeout(r, 1200))
    if (process.env.VERIFY_PROBE === '1') {
      await evaluate(`(() => { window.bayEngine.engine.redraw(); return true })()`)
      await new Promise((r) => setTimeout(r, 600))
    }
    const seen = await evaluate(observe)

    // The element must settle on the TOPMOST item's target — the one on screen. That is
    // the fix's actual contract; `lit > 0` is the symptom, this is the mechanism.
    const settled =
      seen.element !== null && !seen.element.seeking && seen.element.readyState >= 2 &&
      Math.abs(seen.element.currentTime - 0) < 0.5
    const drew = seen.profile.lit > 0
    results.push({ trial, drew, settled, lit: seen.profile.lit, el: seen.element,
                   cols: seen.profile.colExtent, items: seen.items, shared: seen.distinctAssets === 1 })
  }

  const first = results[0]
  console.log('scenario  ', JSON.stringify({ items: first.items, oneSharedAsset: first.shared }))
  for (const r of results) {
    console.log(`  trial ${String(r.trial).padStart(2)}  lit ${String(r.lit).padStart(6)}  cols ${JSON.stringify(r.cols).padEnd(12)}  el ${JSON.stringify(r.el)}`)
  }

  const drewAll = results.every((r) => r.drew)
  const settledAll = results.every((r) => r.settled)
  const shared = results.every((r) => r.shared && r.items === 2)
  const drewCount = results.filter((r) => r.drew).length
  const settledCount = results.filter((r) => r.settled).length
  console.log()
  console.log(`drew        ${drewCount}/${TRIALS}   pixels that reached the canvas`)
  console.log(`settled     ${settledCount}/${TRIALS}   element state when sampled, AFTER the draw`)

  /**
   * The two numbers measure different things at different moments, and in the broken state
   * they disagree — measured pre-fix at drew 0/10 with settled 4/10, which reads as a
   * contradiction and is not one. Saying so here costs one line and saves the next reader
   * deciding which number to trust.
   */
  if (drewCount < TRIALS && settledCount > drewCount) {
    console.log()
    console.log(`      Note: the element settles *between* draws. "settled" is sampled after the`)
    console.log(`      draw has already happened, so a trial can show a settled element and a blank`)
    console.log(`      canvas: the draw that mattered caught it mid-seek, reported pending, drew`)
    console.log(`      nothing, and nothing scheduled another. Not a contradiction.`)
  }

  if (process.env.VERIFY_PROBE === '1') {
    const caught = !drewAll
    console.log(caught
      ? '\nSELF-CHECK PASSED: the probe detects a compositor that draws nothing'
      : '\nSELF-CHECK FAILED: the probe passed against a no-op drawImage')
    close()
    return caught
  }

  if (!shared) {
    console.log('\nFAIL  the scenario did not build: expected 2 items sharing 1 asset')
    close()
    return false
  }
  console.log(drewAll && settledAll
    ? '\nPASS  two items sharing one asset both draw, and the element settles on the topmost target'
    : '\nFAIL  seek thrash: the two items fight over the shared element, so the draw that'
      + '\n      mattered found it mid-seek and every item reported pending')
  close()
  return drewAll && settledAll
})
