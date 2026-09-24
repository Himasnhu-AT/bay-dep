/**
 * Does `preview_frame` show what is actually on the timeline?
 *
 * This is the probe that matters most in `test/app/`, because `preview_frame` is the tool
 * the agent trusts to check every other tool. **A preview that always returns something
 * plausible is the worst possible failure here**: the agent looks at a stale or constant
 * image, concludes an edit is wrong, and "fixes" something that was right — confidently, and
 * on the user's project.
 *
 * So the assertion is differential rather than absolute. Rendering one frame and finding
 * pixels in it proves almost nothing: a tool that returned a cached image, or the wrong
 * frame, or a hard-coded picture would pass. The probe moves the clip off-canvas between two
 * renders and requires the two images to differ *in the direction the edit predicts* —
 * content first, empty after, and back again when the clip returns.
 *
 * `VERIFY_PROBE=1` makes `toDataURL` return a constant, which is exactly the "always returns
 * something plausible" tool. The probe must fail against it.
 */

import { attach, requirePrecondition, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
/**
 * `CANVAS=vertical-1080` (any `set_canvas` preset) runs the probe on that canvas; the restore
 * puts the project's own canvas back. The size check derives from whatever canvas it finds.
 */
const CANVAS = process.env.CANVAS
const { evaluate, close, patch } = await attach()

await runProbe(async () => {
  if (CANVAS) {
    const set = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: 'pf-canvas', tool: 'set_canvas', args: { preset: CANVAS } })})`)
    if (!set.ok) throw new Error(`set_canvas ${CANVAS} refused: ${set.error}`)
  }
  const asset = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
    if (!im.length) throw new Error('import returned nothing')
    return im[0].asset
  })()`, 60_000)

  const placed = await evaluate(`(() => {
    const { store } = window.bayEngine
    store.getState().addAssets([${JSON.stringify(asset)}])
    const st = store.getState()
    const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    store.getState().setProject({
      ...st.project,
      timelines: st.project.timelines.map(t =>
        t.id === tl.id ? { ...t, background: '#000000', tracks: t.tracks.map(k => ({ ...k, items: [] })) } : t)
    })
    const id = store.getState().placeAsset(${JSON.stringify(asset.id)}, 0)
    if (!id) throw new Error('placeAsset refused')
    store.getState().setPlayhead(30)
    const placedTl = store.getState().project.timelines.find(t => t.id === tl.id)
    const item = placedTl.tracks.flatMap(k => k.items).find(i => i.id === id)
    // What the canvas is, and where placement put the clip: the size check and the restore
    // below both derive from these rather than from a landscape project someone assumed.
    return { itemId: id, canvas: [placedTl.width, placedTl.height], layout: item.layout }
  })()`)

  await requirePrecondition(
    evaluate,
    'the clip has decoded a picture to render',
    `window.bayEngine.engine.pool.readiness(${JSON.stringify(asset.id)}).hasPicture`
  )

  if (process.env.VERIFY_PROBE === '1') {
    // A tool that always returns something plausible. This is the failure being guarded,
    // and it has to break the *rendering*, not the edit: moving the clip back would remove
    // the difference the probe looks for and prove nothing.
    // Through `patch()`, so the real `toDataURL` is back after the run: left in place, every
    // later `preview_frame` in the user's session returned this constant.
    await patch('HTMLCanvasElement.prototype', 'toDataURL', `(original) => {
      const c = document.createElement('canvas')
      c.width = 8; c.height = 8
      const frozen = original.call(c, 'image/png')
      return function () { return frozen }
    }`)
  }

  /** Renders through the engine's own entry point and measures the PNG that comes back. */
  const render = async (label) => {
    const out = await evaluate(`(async () => {
      const { renderFrame } = window.bayEngine
      const st = window.bayEngine.store.getState()
      const r = await renderFrame({
        project: st.project,
        timelineId: st.project.activeTimelineId,
        frame: st.playhead
      })
      // Decode the PNG we are handing the agent, not the canvas we drew — this measures
      // the artefact that actually crosses the wire.
      const img = new Image()
      img.src = r.dataUrl
      await img.decode().catch(() => {})
      const c = document.createElement('canvas')
      c.width = img.naturalWidth || 1
      c.height = img.naturalHeight || 1
      const x = c.getContext('2d', { willReadFrequently: true })
      x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, c.width, c.height).data
      let lit = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] > 8 || d[i+1] > 8 || d[i+2] > 8) lit++
      // A hash over the WHOLE data URL. Comparing a prefix does not work: two PNGs of the
      // same dimensions share a byte-identical header, so the first 48 characters match for
      // a full frame and an empty one alike — an instrument that cannot see the difference
      // it is there to detect. (Found by this probe failing against a working tool.)
      let hash = 5381
      for (let i = 0; i < r.dataUrl.length; i++) hash = ((hash * 33) ^ r.dataUrl.charCodeAt(i)) >>> 0
      return { width: r.width, height: r.height, drawn: r.drawn, pending: r.pending,
               placeholders: r.placeholders, unresolved: r.unresolved,
               bytes: r.dataUrl.length, decoded: [c.width, c.height], lit, hash }
    })()`, 60_000)
    console.log(label.padEnd(16), JSON.stringify(out))
    return out
  }

  const inPlace = await render('clip in frame')

  // Move it entirely off-canvas. Nothing about the timeline changes except where it sits.
  await evaluate(`(() => {
    window.bayEngine.store.getState().patchLayout(${JSON.stringify(placed.itemId)},
      { left: 100000, top: 100000 })
    return true
  })()`)
  const offCanvas = await render('clip off-canvas')

  await evaluate(`(() => {
    window.bayEngine.store.getState().patchLayout(${JSON.stringify(placed.itemId)},
      ${JSON.stringify(placed.layout)})
    return true
  })()`)
  const restored = await render('clip restored')

  // The requirement, not the implementation: the longest edge is capped at 640 (or the canvas's
  // own, if smaller), and the picture keeps the canvas's shape to within a pixel of rounding.
  // It was `640x360` literally, which failed on every vertical project with a working tool.
  const [cw, ch] = placed.canvas
  const longest = Math.min(640, Math.max(cw, ch))
  const [ow, oh] = cw >= ch ? [inPlace.width, inPlace.height] : [inPlace.height, inPlace.width]
  const [lw, sw] = cw >= ch ? [cw, ch] : [ch, cw]
  const sized = ow === longest && Math.abs(oh - (longest * sw) / lw) <= 1 &&
    inPlace.decoded[0] === inPlace.width && inPlace.decoded[1] === inPlace.height
  const hadContent = inPlace.lit > 1000
  const wentEmpty = offCanvas.lit === 0
  const cameBack = restored.lit > 1000
  const changed = inPlace.hash !== offCanvas.hash

  console.log()
  console.log(`capped to 640     ${sized ? 'yes' : 'NO'} — ${inPlace.width}x${inPlace.height} for a ${cw}x${ch} canvas`)
  console.log(`content in frame  ${inPlace.lit} lit`)
  console.log(`off-canvas        ${offCanvas.lit} lit`)
  console.log(`restored          ${restored.lit} lit`)
  console.log(`image changed     ${changed ? 'yes' : 'NO — identical bytes for a different edit'}`)

  const ok = sized && hadContent && wentEmpty && cameBack && changed
  if (process.env.VERIFY_PROBE === '1') {
    console.log(ok
      ? '\nSELF-CHECK FAILED: the probe passed against a tool returning a constant image'
      : '\nSELF-CHECK PASSED: the probe detects a preview that does not follow the edit')
    close()
    return !ok
  }
  console.log(ok
    ? '\nPASS  preview_frame follows the edit: content, then empty, then back'
    : '\nFAIL  preview_frame does not track what is on the timeline')
  close()
  return ok
})
