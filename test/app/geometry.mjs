/**
 * Does the compositor put a clip where the layout says?
 *
 * This probe exists because the question was answered wrongly three times, by three people,
 * from lit-pixel measurements. A 1080x1920 clip in a 1920x1080 project gets a `coverLayout`
 * that must leave no black anywhere — and the canvas is nonetheless black across its top two
 * thirds, because *the clip itself* is pure black there. Eight consecutive bands of the
 * decoded source measure 0.0% non-zero.
 *
 * So lit pixels cannot test a layout. What can is the **horizontal** extent: this clip is not
 * black at its left and right edges, so `colExtent` reflects the drawn rectangle. The probe
 * asserts that, and prints the band profile beside the prediction so the vertical story is
 * visible rather than mysterious.
 */

import { attach, CANVAS_PROFILE, CANVAS_READY, requirePrecondition, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { evaluate, close, patch } = await attach()

await runProbe(async () => {

const skipPlacement = process.env.VERIFY_PRECONDITION === '1'

// Only for testing the self-check itself: puts an item on the timeline first, so
// VERIFY_PRECONDITION can be exercised from the state a seeded project produces.
if (process.env.SEED_ITEM === '1') {
  await evaluate(`(async () => {
    const { store } = window.bayEngine
    const imported = await window.bay.media.importPaths([${JSON.stringify((CLIP.startsWith('/') ? CLIP : process.cwd() + '/' + CLIP))}])
    store.getState().addAssets([imported[0].asset])
    store.getState().placeAsset(imported[0].asset.id, 0)
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
}

// The self-check must fail from *any* starting state, not just from an empty project.
// Placing nothing is not enough: against a seeded project that already has an item under the
// playhead the precondition is satisfied before the probe does anything, and the mode proves
// nothing while looking like it passed. So it empties the timeline explicitly.
// It empties the timeline before placing, too: the canvas is measured as a whole, so an item
// the project already had (a title, another clip) would widen the lit extent, and `items[0]`
// would read that item's layout instead of the clip's. Restored by `runProbe` like every edit.
if (skipPlacement || process.env.SEED_ITEM !== '1') {
  await evaluate(`(() => {
    const { store } = window.bayEngine
    const st = store.getState()
    store.getState().setProject({
      ...st.project,
      timelines: st.project.timelines.map(t => ({ ...t, tracks: t.tracks.map(k => ({ ...k, items: [] })) }))
    })
    return true
  })()`)
}

const placed = skipPlacement
  ? { assetId: null, source: ['-', '-'] }
  : await evaluate(`(async () => {
      const { store } = window.bayEngine
      const imported = await window.bay.media.importPaths([${JSON.stringify((CLIP.startsWith('/') ? CLIP : process.cwd() + '/' + CLIP))}])
      if (!imported.length) throw new Error('import returned nothing')
      const asset = imported[0].asset
      store.getState().addAssets([asset])
      const itemId = store.getState().placeAsset(asset.id, 0)
      return { assetId: asset.id, itemId, source: [asset.width, asset.height] }
    })()`)

// Wait on the preconditions, never on a timer. A fixed sleep is a guess about how long a
// cold start takes, and when the guess was wrong this probe reported an unsized 300x150
// canvas as "the drawn rect does not match the layout" — accusing the compositor of a
// fault when the compositor had never run. `VERIFY_PRECONDITION=1` places nothing, so the
// preconditions cannot hold and the probe must say CANNOT MEASURE rather than FAIL.
for (const [label, expression] of Object.values(CANVAS_READY)) {
  await requirePrecondition(evaluate, label, expression, { timeoutMs: skipPlacement ? 4000 : 20000 })
}
await requirePrecondition(
  evaluate,
  'the clip has decoded a picture to draw',
  `window.bayEngine.engine.pool.readiness(${JSON.stringify(placed.assetId)}).hasPicture`
)

/**
 * Self-check: break the draw and confirm the probe notices.
 *
 * This narrows `drawImage`'s destination rect at runtime, which is a broken compositor
 * without touching the compositor. It has to break the *draw* and not the *layout* —
 * `expectedCols` is derived from the layout, so moving both together would pass whatever
 * the code did, which is the tautology this check exists to avoid.
 */
if (process.env.VERIFY_PROBE === '1') {
  // Through `patch()`, so `runProbe` puts the real `drawImage` back — this used to stay
  // installed in the user's editor after the run, halving every clip until a reload.
  await patch('CanvasRenderingContext2D.prototype', 'drawImage',
    '(original) => function (image, x, y, w, h) { return original.call(this, image, x, y, w / 2, h) }')
  await evaluate(`(() => { window.bayEngine.engine.redraw(); return true })()`)
  await new Promise((r) => setTimeout(r, 1200))
}

const result = await evaluate(`(() => {
  const { store } = window.bayEngine
  const st = store.getState()
  const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
  const items = tl.tracks.flatMap(t => t.items)
  const item = items.find(i => i.id === ${JSON.stringify(placed.itemId ?? null)}) ?? items[0]
  const c = document.querySelector('canvas')
  const scale = c.width / tl.width
  const L = item.layout
  return {
    timeline: [tl.width, tl.height],
    layout: { left: L.left, top: L.top, width: L.width, height: L.height },
    expectedCols: [Math.round(L.left * scale), Math.round((L.left + L.width) * scale) - 1],
    profile: ${CANVAS_PROFILE}
  }
})()`)

const { colExtent, size } = result.profile
const [wantFrom, wantTo] = result.expectedCols
// Two columns of slack: the sampling stride is 4px and the edge column may be black.
const ok = Math.abs(colExtent[0] - Math.max(0, wantFrom)) <= 8 &&
           Math.abs(colExtent[1] - Math.min(size[0] - 1, wantTo)) <= 8

console.log('source           ', placed.source.join('x'))
console.log('timeline         ', result.timeline.join('x'), '-> canvas', size.join('x'))
console.log('layout           ', JSON.stringify(result.layout))
console.log('expected columns ', JSON.stringify(result.expectedCols))
console.log('measured columns ', JSON.stringify(colExtent))
console.log('rows (footage, not geometry):')
for (const b of result.profile.bands) {
  console.log('  band', String(b.band).padStart(2), 'y', String(b.yFrom).padStart(4),
              'mean', String(b.mean).padStart(6), 'nonZero', String(b.nonZero).padStart(6) + '%')
}
console.log(ok ? '\nPASS: the drawn rect matches the layout' : '\nFAIL: drawn rect does not match the layout')
close()
if (process.env.VERIFY_PROBE === '1') {
  // Inverted: under a deliberately broken draw, a passing probe is the failure.
  console.log(ok ? 'SELF-CHECK FAILED: the probe cannot see a halved destination rect'
                 : 'SELF-CHECK PASSED: the probe detects a broken draw')
  return !ok
}
return ok

})
