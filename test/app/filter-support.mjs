/**
 * Does `ctx.filter` work where the *export* actually draws, and what does it cost?
 *
 * MDN flags canvas `filter` as not Baseline, and the export target is not the same object as
 * the preview's: `FrameExporter.makeTarget` builds an **`OffscreenCanvas`** with
 * `willReadFrequently: true`, while the preview draws to an onscreen `<canvas>` without it.
 * A filter that works on one and not the other would ship an effect that looks right while
 * editing and vanishes in the delivered file — the canonical web-editor bug, and the one a
 * shared compositor is supposed to make impossible.
 *
 * `willReadFrequently` matters for the second question as much as the first: it asks
 * Chromium for a software-backed store, so the export path may not get whatever GPU
 * acceleration the preview does. Blur is the expensive filter, and "seems fine" measured on
 * the preview canvas would say nothing about a 4K export.
 *
 * **The probe's own negative control** is `blur(0px)` and a syntactically invalid filter:
 * both must come back *identical* to no filter at all. Without that, an instrument that
 * always reports "changed" would pass this whole file.
 */

import { attach, runProbe } from './cdp.mjs'

const { evaluate, close } = await attach()

await runProbe(async () => {

const result = await evaluate(`(() => {
  // Exactly what FrameExporter.makeTarget does, including the flag.
  const exportCtx = (w, h) => new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
  const previewCtx = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    return c.getContext('2d')
  }

  // Colour and hard edges so greyscale and blur have something to bite, and a transparent
  // margin so drop-shadow has somewhere to land. A source that fills the target opaquely
  // casts its shadow off the edge, and an earlier version of this probe read that as
  // "drop-shadow is not supported" on both contexts at once — which should have been the
  // tell, since two different implementations rarely fail identically.
  const source = (() => {
    const c = new OffscreenCanvas(256, 256)
    const x = c.getContext('2d')
    for (let i = 0; i < 16; i++) {
      x.fillStyle = \`hsl(\${i * 22}, 90%, 55%)\`
      x.fillRect(48 + (i % 4) * 40, 48 + Math.floor(i / 4) * 40, 40, 40)
    }
    return c
  })()

  // Alpha is in the hash, and that is not incidental. An earlier version summed only R, G
  // and B — so a black drop-shadow over transparency, which is pure alpha and contributes
  // nothing to RGB, came back byte-identical and the probe reported drop-shadow as
  // unsupported on both contexts. It is supported; the instrument could not see it.
  const hashOf = (ctx, w, h) => {
    const d = ctx.getImageData(0, 0, w, h).data
    let a = 0, b = 0
    for (let i = 0; i < d.length; i += 4) {
      a = (a + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) | 0
      b = (b ^ (a + i)) | 0
    }
    return \`\${a}:\${b}\`
  }

  const drawWith = (make, filter, composite) => {
    const ctx = make(256, 256)
    ctx.clearRect(0, 0, 256, 256)
    if (composite) { ctx.fillStyle = '#4080ff'; ctx.fillRect(0, 0, 256, 256) }
    ctx.filter = filter ?? 'none'
    if (composite) ctx.globalCompositeOperation = composite
    ctx.drawImage(source, 0, 0)
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
    return hashOf(ctx, 256, 256)
  }

  const support = {}
  for (const [name, make] of [['export (OffscreenCanvas, willReadFrequently)', exportCtx],
                              ['preview (onscreen canvas)', previewCtx]]) {
    const base = drawWith(make, 'none')
    support[name] = {
      // Each filter compared against no filter on the *same* kind of context.
      blur: drawWith(make, 'blur(8px)') !== base,
      grayscale: drawWith(make, 'grayscale(1)') !== base,
      brightness: drawWith(make, 'brightness(1.6)') !== base,
      contrast: drawWith(make, 'contrast(2)') !== base,
      saturate: drawWith(make, 'saturate(0.2)') !== base,
      hueRotate: drawWith(make, 'hue-rotate(120deg)') !== base,
      sepia: drawWith(make, 'sepia(1)') !== base,
      invert: drawWith(make, 'invert(1)') !== base,
      dropShadow: drawWith(make, 'drop-shadow(6px 6px 4px black)') !== base,
      composed: drawWith(make, 'grayscale(1) brightness(1.4) blur(2px)') !== base,
      blendMultiply: drawWith(make, 'none', 'multiply') !== drawWith(make, 'none', 'source-over'),
      blendScreen: drawWith(make, 'none', 'screen') !== drawWith(make, 'none', 'source-over'),
      blendOverlay: drawWith(make, 'none', 'overlay') !== drawWith(make, 'none', 'source-over'),
      // CONTROLS: both must be false, or the instrument cannot tell "applied" from "ignored".
      controlZeroBlur: drawWith(make, 'blur(0px)') !== base,
      controlNonsense: drawWith(make, 'notafilter(3)') !== base
    }
  }

  // -- cost -------------------------------------------------------------------
  const timeIt = (make, w, h, filter, iterations) => {
    const src = new OffscreenCanvas(w, h)
    const sx = src.getContext('2d')
    for (let i = 0; i < 24; i++) {
      sx.fillStyle = \`hsl(\${i * 15}, 80%, 50%)\`
      sx.fillRect((i % 6) * (w / 6), Math.floor(i / 6) * (h / 4), w / 6, h / 4)
    }
    const ctx = make(w, h)
    // Warm up: the first draw pays for allocation and shader setup.
    for (let i = 0; i < 3; i++) { ctx.filter = filter; ctx.drawImage(src, 0, 0) }
    ctx.filter = 'none'
    const t0 = performance.now()
    for (let i = 0; i < iterations; i++) {
      ctx.filter = filter
      ctx.drawImage(src, 0, 0)
    }
    // getImageData forces the draw to have actually happened rather than being queued.
    ctx.getImageData(0, 0, 1, 1)
    const ms = (performance.now() - t0) / iterations
    ctx.filter = 'none'
    return Math.round(ms * 100) / 100
  }

  const cost = {}
  for (const [label, w, h, iters] of [['1080p', 1920, 1080, 20], ['4K', 3840, 2160, 6]]) {
    cost[label] = {
      exportNone: timeIt(exportCtx, w, h, 'none', iters),
      exportBlur8: timeIt(exportCtx, w, h, 'blur(8px)', iters),
      exportGrayscale: timeIt(exportCtx, w, h, 'grayscale(1)', iters),
      exportBrightness: timeIt(exportCtx, w, h, 'brightness(1.4)', iters),
      previewNone: timeIt(previewCtx, w, h, 'none', iters),
      previewBlur8: timeIt(previewCtx, w, h, 'blur(8px)', iters)
    }
  }

  return JSON.stringify({ support, cost })
})()`)

const { support, cost } = JSON.parse(result)

let ok = true
for (const [context, flags] of Object.entries(support)) {
  console.log(`\n${context}`)
  const controlsClean = flags.controlZeroBlur === false && flags.controlNonsense === false
  for (const [name, applied] of Object.entries(flags)) {
    if (name.startsWith('control')) continue
    console.log(`  ${applied ? 'APPLIES ' : 'IGNORED '} ${name}`)
    if (!applied) ok = false
  }
  console.log(`  ${controlsClean ? 'CONTROL ok' : 'CONTROL FAILED'}  blur(0px) and an invalid filter both left the image unchanged`)
  if (!controlsClean) ok = false
}

console.log('\ncost per drawImage, milliseconds')
for (const [size, numbers] of Object.entries(cost)) {
  console.log(`  ${size}`)
  console.log(`    export  none ${numbers.exportNone}  blur8 ${numbers.exportBlur8}  grayscale ${numbers.exportGrayscale}  brightness ${numbers.exportBrightness}`)
  console.log(`    preview none ${numbers.previewNone}  blur8 ${numbers.previewBlur8}`)
}

const blur4k = cost['4K']?.exportBlur8 ?? 0
console.log(`\n4K export with blur: ${blur4k}ms a frame → ${Math.round(blur4k * 30 * 60 / 1000)}s of blur cost per minute of 30fps footage`)
console.log(ok ? '\nPASS: every filter and blend applies on both contexts' : '\nFAIL: something does not apply where it must')
close()
return ok

})
