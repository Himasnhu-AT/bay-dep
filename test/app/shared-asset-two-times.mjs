/**
 * Two items on one asset, at two source times, in one frame — each showing its own.
 *
 * This is the gate for transitions. The commonest transition anyone applies is a dissolve
 * between two halves of a clip that was split, which is two items on one asset at two source
 * times drawn in the same frame. One media element cannot be at two times at once, so before
 * the pool held more than one element per asset there were only two possible outcomes: a
 * permanent seek thrash (measured: readyState stuck at HAVE_METADATA, every item pending,
 * canvas blank for ever) or the one-writer rule, under which the outgoing half shows the
 * incoming half's frame and a dissolve dissolves into itself.
 *
 * So the assertion is not "it draws". It is that the two items draw **different pictures**,
 * each matching what that source time looks like on its own. A fix that gave both items an
 * element and left them on the same frame would pass "it draws" and fail this.
 *
 * Method: render one frame with the two items side by side — left half from 20s, right half
 * from 0s — and compare each half against a reference render of that source time alone. Halves
 * rather than a dissolve, because a blend of two frames cannot be compared to either.
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
   * Renders one frame of a timeline built from `spec` and returns a per-half profile.
   *
   * Each spec entry places the SAME asset, so `elementSlots` is what decides whether they
   * get one element or two.
   */
  const render = async (label, spec) => {
    const out = await evaluate(`(async () => {
      const { store, MediaPool, awaitSources, engine, renderFrame } = window.bayEngine
      const st = store.getState()
      const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
      const spec = ${JSON.stringify(spec)}
      const tracks = spec.map((s, i) => ({
        id: 't_v' + i, kind: 'video', name: 'V' + (i + 1), locked: false, muted: false, hidden: false,
        items: [{ id: 't_i' + i, assetId: ${JSON.stringify(asset.id)}, trackId: 't_v' + i,
          from: 0, durationInFrames: 60, sourceStartUs: s.src,
          // Side by side, so each item's pixels can be compared independently. A cover
          // layout is used within each half so the content is the same shape as elsewhere.
          layout: { left: s.left, top: -1166, width: base.width / 2, height: 3413,
                    opacity: 1, rotation: 0 },
          volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1 }]
      }))
      const timeline = { ...base, background: '#000000', tracks }
      const project = { ...st.project, assets: [${JSON.stringify(asset)}],
                        timelines: [timeline], activeTimelineId: timeline.id }

      const pool = new MediaPool({ maxVideoElements: 8 })
      const compositor = new engine.compositor.constructor(pool)
      const c = document.createElement('canvas')
      const W = 320, H = 180
      c.width = W; c.height = H
      const x = c.getContext('2d', { willReadFrequently: true })
      x.setTransform(W / timeline.width, 0, 0, H / timeline.height, 0, 0)
      try {
        await awaitSources(pool, project, timeline, 0, 5000)
        const stats = compositor.drawFrame(x, project, timeline, 0, { mode: 'scrub' })
        const d = x.getImageData(0, 0, W, H).data
        const half = (from, to) => {
          let sum = 0, n = 0, nz = 0, hash = 5381
          for (let y = 0; y < H; y++) for (let px = from; px < to; px++) {
            const i = (y * W + px) * 4
            const v = (d[i] * 299 + d[i+1] * 587 + d[i+2] * 114) / 1000
            sum += v; n++; if (v > 0) nz++
            hash = ((hash * 33) ^ d[i] ^ (d[i+1] << 1) ^ (d[i+2] << 2) ^ (d[i+3] << 3)) >>> 0
          }
          return { mean: +(sum / n).toFixed(1), nonZero: +((nz / n) * 100).toFixed(1), hash }
        }
        // Which elements the pool ended up holding for this one asset.
        const elements = []
        for (let slot = 0; slot < 4; slot++) {
          const e = pool.peek(${JSON.stringify(asset.id)}, slot)
          if (e && e.element) elements.push({ slot, readyState: e.element.readyState,
                                              currentTime: +e.element.currentTime.toFixed(2) })
        }
        return { ...stats, left: half(0, W / 2), right: half(W / 2, W), elements }
      } finally { pool.dispose(); c.width = 0 }
    })()`, 90_000)
    console.log(`${label.padEnd(34)} drawn ${out.drawn} pending ${out.pending}  elements ${JSON.stringify(out.elements)}`)
    return out
  }

  // References: each source time alone, occupying the same half it will occupy together.
  const refLeft = await render('reference 20s (left half only)', [{ src: 20000000, left: 0 }])
  const refRight = await render('reference 0s  (right half only)', [{ src: 0, left: 960 }])
  // The gate: both at once, one asset, two source times, one frame.
  const both = await render('both, one asset, two times', [{ src: 20000000, left: 0 }, { src: 0, left: 960 }])

  console.log('')
  console.log(`left  half   reference mean ${refLeft.left.mean}   together mean ${both.left.mean}`)
  console.log(`right half   reference mean ${refRight.right.mean}   together mean ${both.right.mean}`)

  const twoElements = both.elements.length === 2
  const drewBoth = both.drawn === 2 && both.pending === 0
  // Each half must match its own reference, which is what "showing its own source time" means.
  const leftMatches = both.left.hash === refLeft.left.hash
  const rightMatches = both.right.hash === refRight.right.hash
  // And the two halves must differ from each other, or both are showing one frame.
  const halvesDiffer = both.left.hash !== both.right.hash

  console.log('')
  console.log(`two elements for one asset   ${twoElements ? 'yes' : 'NO (' + both.elements.length + ')'}`)
  console.log(`both items drawn             ${drewBoth ? 'yes' : 'NO'}`)
  console.log(`left  matches its reference  ${leftMatches ? 'yes' : 'NO'}`)
  console.log(`right matches its reference  ${rightMatches ? 'yes' : 'NO'}`)
  console.log(`halves differ from each other ${halvesDiffer ? 'yes' : 'NO - both showing one source time'}`)

  // The references have to be trustworthy for any of this to mean anything.
  if (refLeft.drawn !== 1 || refRight.drawn !== 1) {
    console.log('\nCANNOT MEASURE  a single-item reference render did not draw; nothing to compare against.')
    close()
    return false
  }

  const ok = twoElements && drewBoth && leftMatches && rightMatches && halvesDiffer
  console.log('')
  console.log(ok
    ? 'PASS  two items on one asset draw two different source times in one frame'
    : 'FAIL  one asset cannot show two source times at once — transitions cannot work on this')
  close()
  return ok
})
