/**
 * Does a project reopened from disk draw itself, with nothing forcing a redraw?
 *
 * `latearrival.mjs` covers a project handed to the store after mount by calling `setProject`.
 * This is the real launch path instead: main's persistence resolves `project.initial()` and
 * the store receives it — different code, and only this one runs at startup.
 *
 * **This probe is read-only and must stay that way.** An earlier version imported a clip,
 * placed it and called `project.save()` to seed itself. On a profile whose project already
 * has a `filePath`, `save()` writes without a dialog — so the probe silently *appended* a
 * clip to the shared fixture on every run, taking it from 1 item to 3 and breaking a
 * different probe that assumed one video track. A probe that mutates the fixture it measures
 * is not a measurement. It now requires a seeded profile and never writes.
 *
 * Seed one by hand: launch with a `--user-data-dir`, import a clip, place it, save the
 * project, quit. Then point this at a launch using that profile.
 */

import { attach, CANVAS_PROFILE, requirePrecondition, runProbe } from './cdp.mjs'

const { evaluate, close } = await attach()

await runProbe(async () => {
  // `attach()` has already reloaded, so project.initial() has run for this page.
  await requirePrecondition(
    evaluate,
    'the profile has a saved project with an item on the timeline (seed one by hand; this probe will not)',
    `(() => { const st = window.bayEngine.store.getState()
       const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
       return !!tl && tl.tracks.some(t => t.items.length > 0) })()`
  )
  await requirePrecondition(
    evaluate,
    'the preview canvas has been sized by the engine',
    `(() => { const c = document.querySelector('canvas')
       return !!c && !(c.width === 300 && c.height === 150) && c.width > 0 })()`
  )

  const seen = await evaluate(`(() => {
    const { engine, store } = window.bayEngine
    const st = store.getState()
    const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    return {
      projectName: st.project.name,
      items: tl.tracks.flatMap(t => t.items).length,
      videoTracks: tl.tracks.filter(t => t.kind === 'video').length,
      clockDuration: engine.clock.duration,
      profile: ${CANVAS_PROFILE}
    }
  })()`)

  console.log('reopened  ', JSON.stringify({ ...seen, profile: undefined }))
  console.log('canvas    ', `lit ${seen.profile.lit}, rowExtent ${JSON.stringify(seen.profile.rowExtent)}`)

  if (seen.profile.lit > 0) {
    console.log('\nPASS  a project reopened from disk draws itself, with nothing forcing a redraw')
    close()
    return true
  }

  /**
   * A bare canvas has several causes and they live in different subsystems, so the verdict
   * has to say which. Guessing "nothing asked for a frame" once sent two people into the
   * scheduling path for a fault where draws were running fine and had nothing drawable to
   * draw. `drawFrame` already reports that distinction; ask it rather than infer.
   *
   * Deliberately not using `stats().samples` as a draw counter — it is the length of a
   * rolling window capped at 240, so above that it stops counting and reads as "stalled".
   */
  const why = await evaluate(`(() => {
    const { engine, store } = window.bayEngine
    const st = store.getState()
    const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    const c = document.querySelector('canvas')
    const ctx = c.getContext('2d', { willReadFrequently: true })
    // Synchronous: no scheduling in the path at all, so this isolates drawability.
    const stats = engine.compositor.drawFrame(ctx, st.project, tl, store.getState().playhead, { mode: 'scrub' })
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let lit = 0
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 0 || d[i+1] > 0 || d[i+2] > 0) lit++
    const assets = st.project.assets.map(a => ({ id: a.id, ...engine.pool.readiness(a.id) }))
    return { stats, litAfterForcedDraw: lit, assets }
  })()`)

  console.log('forced draw', JSON.stringify(why))
  console.log()
  if (why.stats.pending > 0 && why.stats.drawn === 0) {
    console.log('FAIL  draws are running and every item reports `pending` — the media is not')
    console.log('      drawable (decode or seek), which is the pool/compositor, NOT the scheduler.')
  } else if (why.stats.placeholders > 0 && why.stats.drawn === 0) {
    console.log('FAIL  every item drew a placeholder — the assets are unreadable, which is the')
    console.log('      bay:// path or the files themselves, NOT the render path.')
  } else if (why.stats.drawn > 0 && why.litAfterForcedDraw === 0) {
    console.log('FAIL  items drew and produced no lit pixels — geometry or the source content.')
    console.log('      Check test/app/geometry.mjs before suspecting the scheduler.')
  } else if (why.litAfterForcedDraw > 0) {
    console.log('FAIL  a forced draw lights the canvas but nothing scheduled one — this IS the')
    console.log('      scheduling path (index.ts / mediaPool onReady).')
  } else {
    console.log('FAIL  the canvas is bare and a forced draw did not mend it; see the stats above.')
  }
  close()
  return false
})
