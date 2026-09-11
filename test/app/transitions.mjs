/**
 * Do the seven transition kinds draw, and does a clamped one say so?
 *
 * Two claims. The first is that each kind produces a picture that changes across its window —
 * a transition that draws the outgoing clip for every frame and then cuts is indistinguishable
 * from no transition at all, and looks deliberate.
 *
 * The second is the one that needs a probe rather than a unit test: **`clampedBecause` reaches
 * the caller.** A 30-frame dissolve silently playing as 8 because the outgoing clip has no
 * footage past its end is the same class as a title silently drawn at 40% — the picture looks
 * intentional and nothing in it says otherwise. The model is asked for a transition longer than
 * the handles allow, and the report must name the reason.
 *
 * The geometry itself is unit tested in `transitions.test.ts` against every kind and direction;
 * what cannot be tested there is that the plan reaches a canvas and moves pixels.
 */

import { attach, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const KINDS = ['cross-dissolve', 'dip-to-black', 'dip-to-white', 'wipe', 'push', 'slide', 'iris']
const { evaluate, close } = await attach()

await runProbe(async () => {
  const asset = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
    if (!im.length) throw new Error('import returned nothing')
    return im[0].asset
  })()`, 60_000)

  /**
   * Builds a two-clip timeline with a transition and samples frames across its window.
   *
   * The two clips read from different parts of the source (20s and 0s) so the two halves are
   * visibly different pictures — a dissolve between two identical frames is a still.
   */
  const sample = async (kind, { duration = 30, fromSrc = 20_000_000, toSrc = 20_000_000, fromDur = 60, toDur = 60 } = {}) => {
    const out = await evaluate(`(async () => {
      const { store, MediaPool, awaitSources, engine } = window.bayEngine
      const st = store.getState()
      const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
      const mk = (id, from, dur, src) => ({
        id, assetId: ${JSON.stringify(asset.id)}, trackId: 'tr_v', from,
        durationInFrames: dur, sourceStartUs: src,
        layout: { left: 0, top: -1166, width: base.width, height: 3413, opacity: 1, rotation: 0 },
        volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
      })
      const a = mk('it_a', 0, ${fromDur}, ${fromSrc})
      const b = mk('it_b', ${fromDur}, ${toDur}, ${toSrc})
      const timeline = { ...base, background: '#000000',
        tracks: [{ id: 'tr_v', kind: 'video', name: 'V1', locked: false, muted: false,
                   hidden: false, items: [a, b] }],
        transitions: [{ id: 'tx', kind: ${JSON.stringify(kind)}, fromItemId: 'it_a',
                        toItemId: 'it_b', durationInFrames: ${duration}, direction: 'left' }] }
      const project = { ...st.project, assets: [${JSON.stringify(asset)}],
                        timelines: [timeline], activeTimelineId: timeline.id }

      const pool = new MediaPool({ maxVideoElements: 8 })
      const compositor = new engine.compositor.constructor(pool)
      const c = document.createElement('canvas')
      const W = 240, H = 135
      c.width = W; c.height = H
      const x = c.getContext('2d', { willReadFrequently: true })
      const frames = []
      try {
        // Across the window centred on the cut, plus a frame either side of it.
        for (const frame of [${fromDur} - 12, ${fromDur} - 6, ${fromDur}, ${fromDur} + 5, ${fromDur} + 11]) {
          x.setTransform(1, 0, 0, 1, 0, 0)
          x.clearRect(0, 0, W, H)
          x.setTransform(W / timeline.width, 0, 0, H / timeline.height, 0, 0)
          await awaitSources(pool, project, timeline, frame, 5000)
          const stats = compositor.drawFrame(x, project, timeline, frame, { mode: 'scrub' })
          const d = x.getImageData(0, 0, W, H).data
          let sum = 0, n = 0, hash = 5381
          for (let i = 0; i < d.length; i += 4) {
            sum += (d[i] * 299 + d[i+1] * 587 + d[i+2] * 114) / 1000; n++
            hash = ((hash * 33) ^ d[i] ^ (d[i+1] << 1) ^ (d[i+2] << 2) ^ (d[i+3] << 3)) >>> 0
          }
          frames.push({ frame, mean: +(sum / n).toFixed(1), hash,
                        progress: stats.transition ? +stats.transition.progress.toFixed(2) : null,
                        drawn: stats.drawn, pending: stats.pending })
        }
        const mid = Math.floor(${fromDur})
        await awaitSources(pool, project, timeline, mid, 5000)
        const midStats = compositor.drawFrame(x, project, timeline, mid, { mode: 'scrub' })
        return { frames, report: midStats.transition ?? null }
      } finally { pool.dispose(); c.width = 0 }
    })()`, 120_000)
    return out
  }

  console.log('')
  let bad = 0
  for (const kind of KINDS) {
    const { frames, report } = await sample(kind)
    const hashes = new Set(frames.map((f) => f.hash))
    const progresses = frames.map((f) => f.progress)
    const active = progresses.filter((p) => p !== null).length
    const changes = hashes.size
    const ok = changes >= 4 && active === frames.length && frames.every((f) => f.pending === 0)
    if (!ok) bad += 1
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${kind.padEnd(15)} distinct pictures ${changes}/${frames.length}` +
      `  progress ${JSON.stringify(progresses)}  means ${JSON.stringify(frames.map((f) => f.mean))}`
    )
    if (report?.clampedBecause) console.log(`       unexpectedly clamped: ${report.clampedBecause}`)
  }

  // Three cases around the handles, because they are three different answers and only one of
  // them is a clamp:
  //
  //   - handles smaller than asked  -> the transition exists and says why it is shorter
  //   - handles ample               -> it exists and reports no clamp (the positive control)
  //   - no handles at all           -> resolveTransition returns null and there is NO
  //                                    transition, which is not the same as a clamped one
  //
  // Conflating the third with the first is how this probe first passed vacuously: a null
  // report was accepted as "clamped", so a transition that never existed counted as reported.
  console.log('')
  const clamped = await sample('cross-dissolve', { duration: 60, toSrc: 200_000 })
  const generous = await sample('cross-dissolve', { duration: 30 })
  const impossible = await sample('cross-dissolve', { duration: 30, toSrc: 0 })
  console.log('asked 60 frames, incoming has ~6 frames of handle:')
  console.log('   report', JSON.stringify(clamped.report))
  console.log('asked 30 frames, both clips have ample handles:')
  console.log('   report', JSON.stringify(generous.report))
  console.log('asked 30 frames, incoming starts at source 0 (no handle at all):')
  console.log('   report', JSON.stringify(impossible.report))

  const clampReported =
    clamped.report !== null &&
    clamped.report.clampedBecause !== null &&
    clamped.report.durationInFrames < clamped.report.requestedFrames
  const notClampedWhenFine = generous.report !== null && generous.report.clampedBecause === null
  const noneWhenImpossible = impossible.report === null
  console.log('')
  console.log(`${clampReported ? 'ok  ' : 'FAIL'} a shortened transition exists AND says why, with both durations`)
  console.log(`${notClampedWhenFine ? 'ok  ' : 'FAIL'} a transition that fits reports no clamp (positive control)`)
  console.log(`${noneWhenImpossible ? 'ok  ' : 'FAIL'} no handles at all means no transition, not a clamped one`)
  if (!clampReported) bad += 1
  if (!notClampedWhenFine) bad += 1
  if (!noneWhenImpossible) bad += 1

  console.log('')
  console.log(bad === 0
    ? 'PASS  every kind draws across its window, and a clamped duration is reported'
    : `FAIL  ${bad} check(s) failed`)
  close()
  return bad === 0
})
