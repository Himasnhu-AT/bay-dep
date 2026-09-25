/**
 * Does a clip's first frame carry picture, or background?
 *
 * Found by exporting a real two-clip edit and profiling the MP4: the second clip's first
 * frame was pure black in the delivered file. One black frame at every cut is the most
 * visible defect an export can have, and it gets worse the faster the edit is.
 *
 * This measures the mechanism rather than the artefact, and does it with a **fresh**
 * MediaPool each time — which is the whole condition. `awaitSources` is what the export loop
 * calls before drawing, so if it returns while the element still holds no decoded frame,
 * `drawFrame` reports `pending` and paints background. That is one function, and it is
 * reachable without an encoder, an output file or ffmpeg.
 *
 * Two scenarios, because they separate two mechanisms that both fit the symptom:
 *
 *   A. clip entering at frame 150 with sourceStartUs 0  — "a source that enters mid-export"
 *   B. the only clip, from frame 0, sourceStartUs 0     — "target equals a fresh element's
 *                                                          currentTime, so no seek is issued
 *                                                          and nothing is ever awaited"
 *
 * If A fails and B passes, it is about entering mid-export. If both fail, it is the second:
 * an element that merely *looks* to be at the right time while holding nothing.
 *
 * C is the control: same shape as B but with a non-zero source time, which forces a real
 * seek. It must pass in every version — without it, a probe that reported FAIL for
 * everything would look like a finding.
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

  const measure = async (label, items, frame) => {
    const out = await evaluate(`(async () => {
      const { store, MediaPool, awaitSources, engine } = window.bayEngine
      const st = store.getState()
      const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
      const spec = ${JSON.stringify(items)}
      const tracks = spec.map((s, i) => ({
        id: 'p_v' + i, kind: 'video', name: 'V' + (i + 1),
        locked: false, muted: false, hidden: false,
        items: [{
          id: 'p_i' + i, assetId: ${JSON.stringify(asset.id)}, trackId: 'p_v' + i,
          from: s.from, durationInFrames: s.dur, sourceStartUs: s.src,
          layout: { left: 0, top: -1166, width: base.width, height: 3413, opacity: 1, rotation: 0 },
          volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
        }]
      }))
      const timeline = { ...base, background: '#000000', tracks }
      const project = { ...st.project, assets: [${JSON.stringify(asset)}],
                        timelines: [timeline], activeTimelineId: timeline.id }

      // A fresh pool is the condition: the export loop meets each new source exactly once,
      // with an element that has just been created.
      const pool = new MediaPool({ maxVideoElements: 8 })
      const compositor = new engine.compositor.constructor(pool)
      const c = document.createElement('canvas')
      c.width = 320; c.height = 180
      const x = c.getContext('2d', { willReadFrequently: true })
      x.setTransform(320 / timeline.width, 0, 0, 180 / timeline.height, 0, 0)
      try {
        await awaitSources(pool, project, timeline, ${frame}, 5000)
        const stats = compositor.drawFrame(x, project, timeline, ${frame}, { mode: 'scrub' })
        const d = x.getImageData(0, 0, 320, 180).data
        let nz = 0, n = 0
        for (let i = 0; i < d.length; i += 4 * 7) { n++; if (d[i] > 0 || d[i+1] > 0 || d[i+2] > 0) nz++ }
        // A hash of the pixels, because "carries picture" and "carries the RIGHT picture"
        // are different claims: a fix that decoded *some* frame would pass the first and
        // fail the second. Two different source times must not produce the same image.
        let hash = 5381
        for (let i = 0; i < d.length; i += 4) hash = ((hash * 33) ^ d[i] ^ (d[i+1] << 1) ^ (d[i+2] << 2) ^ (d[i+3] << 3)) >>> 0
        const el = (pool.peek(${JSON.stringify(asset.id)}) || {}).element
        return { ...stats, hash, nonZero: +((nz / n) * 100).toFixed(1),
                 readyState: el ? el.readyState : null,
                 currentTime: el ? +el.currentTime.toFixed(3) : null }
      } finally { pool.dispose(); c.width = 0 }
    })()`, 60_000)
    const verdict = out.nonZero === 0 ? 'BLACK' : 'picture'
    console.log(`${label.padEnd(46)} drawn ${out.drawn} pending ${out.pending}  readyState ${out.readyState}  currentTime ${out.currentTime}  nonZero ${String(out.nonZero).padStart(5)}%  ${verdict}`)
    return out
  }

  console.log('')
  const a = await measure('A. clip enters at 150, sourceStartUs 0', [{ from: 0, dur: 150, src: 20000000 }, { from: 150, dur: 60, src: 0 }], 150)
  const b = await measure('B. only clip, frame 0, sourceStartUs 0', [{ from: 0, dur: 60, src: 0 }], 0)
  const c = await measure('C. control: frame 0, sourceStartUs 20s', [{ from: 0, dur: 60, src: 20000000 }], 0)

  console.log('')
  if (c.nonZero === 0) {
    console.log('CANNOT TRUST  the control is black too — a real seek is not resolving, so a FAIL')
    console.log('              here would not be about the zero-source-time case at all.')
    close()
    return false
  }
  if (a.nonZero === 0 || b.nonZero === 0) {
    console.log(b.nonZero === 0
      ? 'MECHANISM  target equals a fresh element currentTime: no seek issued, nothing awaited.'
      : 'MECHANISM  specific to a source entering mid-export.')
  }
  // B and C are the same clip at the same timeline frame, differing only in source time.
  // Identical pixels would mean the element is not actually landing where it was asked to.
  const distinct = b.hash !== c.hash
  console.log(`source times produce different pictures: ${distinct ? 'yes' : 'NO - same hash for 0s and 20s'}`)
  const ok = a.nonZero > 0 && b.nonZero > 0 && c.nonZero > 0 && distinct
  console.log('')
  console.log(ok
    ? "PASS  a clip's first frame carries picture, with and without a zero source time"
    : "FAIL  a clip's first frame is background: awaitSources returned before the element had one")
  close()
  return ok
})
