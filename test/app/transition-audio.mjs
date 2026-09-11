/**
 * Does a transition cross-fade the sound, or show two pictures and play one?
 *
 * The defect this guards is the most audible one the feature can have, and it is invisible to
 * every check that looks at pixels. It comes from a structural detail: a
 * `MediaElementAudioSourceNode` is bound to one element for life, and a transition between two
 * halves of a split clip needs two elements to show two source times. One node per *asset*
 * therefore binds both clips to one element — two pictures, one sound.
 *
 * Measured on the analysers rather than inferred from the graph, because "the gain node has the
 * right value" and "the sound changed" are different claims and only the second matters. The
 * assertion is directional across the window: the outgoing clip loud and the incoming silent at
 * the start, reversed at the end, and both audible in the middle.
 */

import { attach, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { send, evaluate, close } = await attach()

await runProbe(async () => {
  const asset = await evaluate(`(async () => {
    const im = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
    if (!im.length) throw new Error('import returned nothing')
    const a = im[0].asset
    if (!a.hasAudio) throw new Error('the probe clip has no audio track')
    return a
  })()`, 60_000)

  // An AudioContext will not leave `suspended` without a gesture, and a suspended context is
  // silence that looks exactly like a broken mixer.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: 400, y: 300, button: 'left', clickCount: 1 })
  }

  /**
   * Plays once through the window, sampling the two meters and **recording the playhead with
   * each reading**.
   *
   * The first version set the playhead, started playback, waited 900ms and read the meters —
   * by which time playback had carried the playhead to frame 81, well past a window ending at
   * 74. It measured a frame outside the transition and reported the cross-fade broken. Same
   * class as reading a source's state after its pool was disposed: a number sampled at a
   * different moment than the one it is said to describe.
   *
   * Recording the playhead alongside each sample makes that impossible, and gives a better
   * test than three snapshots: the cross-fade is a curve, so the assertion is its trend.
   *
   * Two tracks, not one, because one would mix both clips into a single meter — and the sum
   * across a cross-fade is roughly constant, which is exactly what makes it unobservable.
   */
  const sweep = async (kind) => {
    const out = await evaluate(`(async () => {
      const { store, engine } = window.bayEngine
      const st = store.getState()
      const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
      const layout = { left: 0, top: -1166, width: base.width, height: 3413, opacity: 1, rotation: 0 }
      const common = { assetId: ${JSON.stringify(asset.id)}, layout, volume: 1,
                       fadeInFrames: 0, fadeOutFrames: 0, speed: 1 }
      const a = { ...common, id: 'xa', trackId: 'xva', from: 0, durationInFrames: 60, sourceStartUs: 5000000 }
      const b = { ...common, id: 'xb', trackId: 'xvb', from: 60, durationInFrames: 60, sourceStartUs: 30000000 }
      const timeline = { ...base, background: '#000000',
        tracks: [
          { id: 'xva', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [a] },
          { id: 'xvb', kind: 'video', name: 'V2', locked: false, muted: false, hidden: false, items: [b] }
        ],
        transitions: [{ id: 'xtx', kind: ${JSON.stringify(kind)}, fromItemId: 'xa', toItemId: 'xb',
                        durationInFrames: 30 }] }
      store.getState().setProject({ ...st.project, assets: [${JSON.stringify(asset)}],
        timelines: [timeline], activeTimelineId: timeline.id })
      // Start a little before the window so the elements are already playing when it opens.
      store.getState().setPlayhead(36)
      await new Promise(r => setTimeout(r, 900))
      store.getState().setPlaying(true)
      const samples = []
      const t0 = performance.now()
      while (performance.now() - t0 < 2400) {
        const levels = engine.levels()
        samples.push({
          frame: store.getState().playhead,
          outgoing: +(levels['xva']?.peak ?? 0).toFixed(4),
          incoming: +(levels['xvb']?.peak ?? 0).toFixed(4)
        })
        await new Promise(r => setTimeout(r, 55))
      }
      store.getState().setPlaying(false)
      return { samples, contextState: engine.audio.context().state }
    })()`, 90_000)
    return out
  }

  const { samples, contextState } = await sweep('cross-dissolve')
  // Window for a 30-frame transition at cut 60.
  const inWindow = samples.filter((s) => s.frame >= 45 && s.frame <= 74)
  const firstHalf = inWindow.filter((s) => s.frame < 60)
  const secondHalf = inWindow.filter((s) => s.frame >= 60)
  const loudest = (rows, key) => rows.reduce((m, r) => Math.max(m, r[key]), 0)

  console.log('')
  console.log('frame   outgoing   incoming')
  for (const s of inWindow) {
    console.log(`${String(s.frame).padStart(5)}   ${String(s.outgoing).padStart(8)}   ${String(s.incoming).padStart(8)}`)
  }

  const outEarly = loudest(firstHalf, 'outgoing')
  const inEarly = loudest(firstHalf, 'incoming')
  const outLate = loudest(secondHalf, 'outgoing')
  const inLate = loudest(secondHalf, 'incoming')

  /**
   * The share of the sound coming from the incoming clip.
   *
   * Comparing one clip's peak to the other's does **not** measure the cross-fade: a meter shows
   * gain times content, the two clips are different audio, and speech is not stationary — the
   * incoming clip's raw level peaked higher than the outgoing clip's early in the window even
   * at a low gain, and the first version of this check called that a failure. A ratio cancels
   * absolute loudness to first order and measures the balance, which is what a cross-fade
   * actually changes.
   */
  const share = (rows) => {
    const usable = rows.filter((r) => r.outgoing + r.incoming > 0.01)
    if (usable.length === 0) return null
    return usable.reduce((sum, r) => sum + r.incoming / (r.outgoing + r.incoming), 0) / usable.length
  }
  const earlyShare = share(firstHalf)
  const lateShare = share(secondHalf)

  const checks = [
    ['the audio context is running', contextState === 'running'],
    ['the window was actually sampled', inWindow.length >= 6 && firstHalf.length >= 2 && secondHalf.length >= 2],
    ['both halves carried enough signal to measure', earlyShare !== null && lateShare !== null],
    ['the outgoing clip is audible in the first half', outEarly > 0.01],
    ['the incoming clip is audible in the second half', inLate > 0.01],
    ['the outgoing clip dominates early', earlyShare !== null && earlyShare < 0.5],
    ['the incoming clip dominates late', lateShare !== null && lateShare > 0.5],
    ['the balance reverses across the cut, by a clear margin',
      earlyShare !== null && lateShare !== null && lateShare - earlyShare > 0.2]
  ]

  console.log('')
  console.log(`first half  loudest outgoing ${outEarly}  incoming ${inEarly}  incoming share ${earlyShare?.toFixed(3)}`)
  console.log(`second half loudest outgoing ${outLate}  incoming ${inLate}  incoming share ${lateShare?.toFixed(3)}`)
  console.log('')
  let bad = 0
  for (const [name, ok] of checks) {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  }
  console.log('')
  console.log(bad === 0
    ? 'PASS  a transition cross-fades the sound as well as the picture'
    : `FAIL  ${bad} check(s) failed — the sound does not follow the transition`)
  close()
  return bad === 0
})
