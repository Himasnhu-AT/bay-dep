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

import { attach, CANVAS_PROFILE } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { evaluate, close } = await attach()

const placed = await evaluate(`(async () => {
  const { store } = window.bayEngine
  const imported = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
  if (!imported.length) throw new Error('import returned nothing')
  const asset = imported[0].asset
  store.getState().addAssets([asset])
  const itemId = store.getState().placeAsset(asset.id, 0)
  return { assetId: asset.id, itemId, source: [asset.width, asset.height] }
})()`)
await new Promise((r) => setTimeout(r, 2500))

const result = await evaluate(`(() => {
  const { store } = window.bayEngine
  const st = store.getState()
  const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
  const item = tl.tracks.flatMap(t => t.items)[0]
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
process.exit(ok ? 0 : 1)
