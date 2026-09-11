/**
 * What does `willReadFrequently: true` cost the export target, with a REAL decoded frame?
 *
 * `FrameExporter` asks for it because the export loop reads back every frame — literally the
 * case the flag exists for. `interface` measured it costing ~35% at 1080p and making a blur
 * roughly 60x more expensive at 4K, which would be a strong reason to drop it.
 *
 * Their caveat is the reason this probe exists rather than a patch: they measured a synthetic
 * source canvas. A decoded video frame is a **GPU texture**, and drawing one into a
 * software-backed canvas may force a readback of the *source* — a cost that simply is not
 * present when the source is already CPU-side. That is the one difference that could invert
 * the result, and the export path only ever draws decoded video.
 *
 * So: same comparison, real `<video>` source, at the sizes an export actually uses. Each cell
 * is the full per-frame cycle the export loop performs — `drawImage` plus a whole-frame
 * `getImageData` — because moving cost from the draw to the read would not help anyone.
 */

import { attach, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { evaluate, close } = await attach()

await runProbe(async () => {
  const asset = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
    if (!im.length) throw new Error('import returned nothing')
    return im[0].asset
  })()`, 60_000)

  /**
   * Why the source state is captured before the timing rather than after.
   *
   * `pool.dispose()` clears the element's src and resets `readyState` to 0 and `videoWidth`
   * to 0, so reading it at the end printed "0x0, readyState 0" above a set of perfectly
   * valid numbers — a measurement described by state sampled after the subject had been torn
   * down. The guard above it had already proved the frame was decoded.
   *
   * Note also where this comment is: **outside** the evaluate template. Prose inside one is
   * how a stray backtick closes the literal, which has cost four separate syntax errors in
   * this directory. Keep explanation in the module body and the template free of it.
   */
  const rows = await evaluate(`(async () => {
    // A real decoded frame, seeked and settled, via the engine's own pool.
    const { MediaPool } = window.bayEngine
    const pool = new MediaPool({ maxVideoElements: 4 })
    const entry = pool.acquire(${JSON.stringify(asset)})
    const el = entry.element
    await new Promise((r) => {
      if (el.readyState >= 1) return r()
      el.addEventListener('loadedmetadata', r, { once: true })
      setTimeout(r, 5000)
    })
    el.currentTime = 20
    await new Promise((r) => { el.addEventListener('seeked', r, { once: true }); setTimeout(r, 5000) })
    if (el.readyState < 2) throw new Error('the source never decoded a frame; nothing to measure')
    const source = { size: [el.videoWidth, el.videoHeight], readyState: el.readyState,
                     currentTime: +el.currentTime.toFixed(2) }

    const time = (w, h, readFrequently, filter, iterations) => {
      const c = new OffscreenCanvas(w, h)
      const x = c.getContext('2d', { willReadFrequently: readFrequently })
      x.filter = filter
      // Warm: the first frame pays for allocation and shader setup in both configurations.
      for (let i = 0; i < 3; i++) { x.drawImage(el, 0, 0, w, h); x.getImageData(0, 0, w, h) }
      const t0 = performance.now()
      for (let i = 0; i < iterations; i++) {
        x.drawImage(el, 0, 0, w, h)
        x.getImageData(0, 0, w, h)
      }
      return (performance.now() - t0) / iterations
    }

    const cases = [
      { label: '1080p, no filter', w: 1920, h: 1080, filter: 'none', n: 30 },
      { label: '1080p, blur(8px)', w: 1920, h: 1080, filter: 'blur(8px)', n: 15 },
      { label: '4K, no filter', w: 3840, h: 2160, filter: 'none', n: 12 },
      { label: '4K, blur(8px)', w: 3840, h: 2160, filter: 'blur(8px)', n: 6 }
    ]
    const out = []
    for (const c of cases) {
      // Interleaved and repeated: a machine that gets busy mid-run would otherwise hand the
      // whole penalty to whichever configuration happened to be measured second.
      const withFlag = [], without = []
      for (let run = 0; run < 3; run++) {
        withFlag.push(time(c.w, c.h, true, c.filter, c.n))
        without.push(time(c.w, c.h, false, c.filter, c.n))
      }
      const median = (a) => a.slice().sort((p, q) => p - q)[1]
      out.push({ label: c.label, withFlag: +median(withFlag).toFixed(2), without: +median(without).toFixed(2),
                 allWith: withFlag.map((v) => +v.toFixed(2)), allWithout: without.map((v) => +v.toFixed(2)) })
    }
    pool.dispose()
    return { source, out }
  })()`, 180_000)

  console.log('')
  console.log(`real decoded source ${rows.source.size.join('x')}, readyState ${rows.source.readyState}, ` +
    `currentTime ${rows.source.currentTime} — sampled at measurement time`)
  console.log('')
  console.log('case                   willReadFrequently:true   false     verdict')
  for (const r of rows.out) {
    const faster = r.without < r.withFlag ? 'flag COSTS' : 'flag helps'
    const ratio = (Math.max(r.withFlag, r.without) / Math.max(0.001, Math.min(r.withFlag, r.without))).toFixed(2)
    console.log(`${r.label.padEnd(22)} ${String(r.withFlag).padStart(10)} ms   ${String(r.without).padStart(7)} ms   ${faster} ${ratio}x`)
  }
  console.log('')
  console.log('per-run spread (median of 3 used above):')
  for (const r of rows.out) {
    console.log(`  ${r.label.padEnd(22)} true ${JSON.stringify(r.allWith)}  false ${JSON.stringify(r.allWithout)}`)
  }

  // No pass/fail: this is a measurement, and encoding today's hardware as a threshold would
  // make it fail on the machine the flag exists for. It reports, and a human decides.
  console.log('')
  console.log('MEASURED  no verdict asserted — the right setting is hardware-dependent, and')
  console.log('          the flag exists for machines with slow GPU-to-CPU transfer.')
  close()
  return true
})
