/**
 * Do adjustments and blend modes reach pixels?
 *
 * `Item.adjustments` and `Item.blendMode` landed in the model with controls and an MCP schema
 * built against them, and for a while the compositor drew neither — a control that writes a
 * value nothing reads, which this project holds to be worse than an absent control, because
 * someone sets it, looks at the canvas, and concludes the engine is broken.
 *
 * Each case asserts a *directional* pixel change rather than "something changed": grayscale
 * must collapse the colour spread, brightness must raise the mean, invert must move it the
 * other way. A probe asserting only difference would pass against a filter chain applied in the
 * wrong order, or the wrong filter entirely.
 *
 * And identity adjustments must be **byte-identical** to no adjustments at all — the default
 * has to cost nothing and change nothing, or every project pays for a feature it is not using.
 */

import { attach, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { evaluate, close } = await attach()

await runProbe(async () => {
  const asset = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths([${JSON.stringify((CLIP.startsWith('/') ? CLIP : process.cwd() + '/' + CLIP))}])
    if (!im.length) throw new Error('import returned nothing')
    return im[0].asset
  })()`, 60_000)

  const draw = async (label, look, second) => {
    const out = await evaluate(`(async () => {
      const { store, MediaPool, awaitSources, engine } = window.bayEngine
      const st = store.getState()
      const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
      const look = ${JSON.stringify(look ?? null)}
      const second = ${JSON.stringify(second ?? null)}
      const mk = (id, trackId, extra) => ({
        id, assetId: ${JSON.stringify(asset.id)}, trackId, from: 0, durationInFrames: 60,
        sourceStartUs: 20000000,
        layout: { left: 0, top: -1166, width: base.width, height: 3413, opacity: 1, rotation: 0 },
        volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
      })
      const tracks = [{ id: 'lv0', kind: 'video', name: 'V1', locked: false, muted: false,
                        hidden: false, items: [mk('li0', 'lv0', look ?? {})] }]
      if (second) tracks.push({ id: 'lv1', kind: 'video', name: 'V2', locked: false, muted: false,
                                hidden: false, items: [mk('li1', 'lv1', second ?? {})] })
      const timeline = { ...base, background: '#000000', tracks }
      const project = { ...st.project, assets: [${JSON.stringify(asset)}],
                        timelines: [timeline], activeTimelineId: timeline.id }
      const pool = new MediaPool({ maxVideoElements: 6 })
      const compositor = new engine.compositor.constructor(pool)
      const c = document.createElement('canvas')
      const W = 240, H = 135
      c.width = W; c.height = H
      const x = c.getContext('2d', { willReadFrequently: true })
      x.setTransform(W / timeline.width, 0, 0, H / timeline.height, 0, 0)
      try {
        await awaitSources(pool, project, timeline, 0, 5000)
        compositor.drawFrame(x, project, timeline, 0, { mode: 'scrub' })
        const d = x.getImageData(0, 0, W, H).data
        let sum = 0, n = 0, hash = 5381, spread = 0
        for (let i = 0; i < d.length; i += 4) {
          const y = (d[i] * 299 + d[i+1] * 587 + d[i+2] * 114) / 1000
          sum += y; n++
          // How far the channels diverge — collapses to 0 for any grey image.
          spread += Math.max(d[i], d[i+1], d[i+2]) - Math.min(d[i], d[i+1], d[i+2])
          hash = ((hash * 33) ^ d[i] ^ (d[i+1] << 1) ^ (d[i+2] << 2) ^ (d[i+3] << 3)) >>> 0
        }
        return { mean: +(sum / n).toFixed(2), spread: +(spread / n).toFixed(2), hash }
      } finally { pool.dispose(); c.width = 0 }
    })()`, 90_000)
    console.log(`${label.padEnd(34)} mean ${String(out.mean).padStart(7)}  colourSpread ${String(out.spread).padStart(6)}`)
    return out
  }

  console.log('')
  const plain = await draw('no adjustments', undefined)
  const identity = await draw('identity adjustments', { adjustments: { brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 } })
  const bright = await draw('brightness 1.8', { adjustments: { brightness: 1.8, contrast: 1, saturate: 1, hueRotate: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 } })
  const dark = await draw('brightness 0.4', { adjustments: { brightness: 0.4, contrast: 1, saturate: 1, hueRotate: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 } })
  const grey = await draw('grayscale 1', { adjustments: { brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, blur: 0, grayscale: 1, sepia: 0, invert: 0 } })
  const inverted = await draw('invert 1', { adjustments: { brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, blur: 0, grayscale: 0, sepia: 0, invert: 1 } })
  const blurred = await draw('blur 6px', { adjustments: { brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, blur: 6, grayscale: 0, sepia: 0, invert: 0 } })
  const stacked = await draw('two clips, normal blend', undefined, { blendMode: 'normal' })
  const multiplied = await draw('two clips, multiply', undefined, { blendMode: 'multiply' })
  const screened = await draw('two clips, screen', undefined, { blendMode: 'screen' })

  const checks = [
    ['identity adjustments are byte-identical to none', identity.hash === plain.hash],
    ['brightness up raises the mean', bright.mean > plain.mean * 1.2],
    ['brightness down lowers the mean', dark.mean < plain.mean * 0.7],
    ['grayscale collapses the colour spread', grey.spread < plain.spread * 0.2],
    ['grayscale does not just darken', Math.abs(grey.mean - plain.mean) < plain.mean * 0.35],
    ['invert moves the mean the other way', inverted.mean > plain.mean],
    ['blur changes the picture without changing its brightness much',
      blurred.hash !== plain.hash && Math.abs(blurred.mean - plain.mean) < plain.mean * 0.2],
    ['multiply darkens against the layer below', multiplied.mean < stacked.mean],
    ['screen lightens against the layer below', screened.mean > stacked.mean],
    ['normal blend of identical clips looks like one clip', Math.abs(stacked.mean - plain.mean) < 0.5]
  ]

  console.log('')
  let bad = 0
  for (const [name, ok] of checks) {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  }
  console.log('')
  console.log(bad === 0
    ? 'PASS  adjustments and blend modes reach pixels, and the default costs nothing'
    : `FAIL  ${bad} check(s) failed`)
  close()
  return bad === 0
})
