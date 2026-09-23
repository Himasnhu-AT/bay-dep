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
 *
 * **What it can and cannot prove depends on how `attach()` found the app**, and the probe says
 * which one it measured:
 *
 * - **The app was on its projects screen** (a fresh launch): `attach()` opened the most recent
 *   project through `open_project`, which reads it from disk — the real reopen path. This is
 *   the case the probe exists for.
 * - **A project was already open** (a live instance someone is using): nothing was reopened,
 *   and `attach()` no longer reloads a page that already has the probe handle, so the project
 *   on screen arrived long ago. The probe then re-delivers it with `setProject` — a structural
 *   copy, so the engine sees a new project — and waits for a draw with nothing forcing one.
 *   That proves a project *arriving* draws itself (the `latearrival.mjs` question), not that
 *   persistence hands the store a drawable project. For that, run it against a fresh launch.
 *
 * Either way it is read-only against the file: nothing is saved, and `runProbe` restores the
 * open project, its history and its dirty flag afterwards.
 */

import { attach, CANVAS_PROFILE, requirePrecondition, runProbe } from './cdp.mjs'

const { evaluate, close, opened } = await attach()
const DRAW_WAIT_MS = Number(process.env.DRAW_WAIT_MS ?? 8000)

await runProbe(async () => {
  const path = opened === 'editor' ? 'redelivered' : 'reopened'
  console.log(path === 'reopened'
    ? `path       reopened from disk by attach() (${opened}) — the real launch path`
    : 'path       a project was already open; re-delivered with setProject — proves arrival, NOT persistence')
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

  if (path === 'redelivered') {
    // The canvas is blanked first, in the same turn: it already shows this project, so without
    // that a lit canvas afterwards would be the old frame and prove nothing about a new draw.
    await evaluate(`(() => {
      const { store } = window.bayEngine
      const c = document.querySelector('canvas')
      const x = c.getContext('2d')
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.restore()
      store.getState().setProject(structuredClone(store.getState().project))
      return true
    })()`)
  }

  // Wait for a draw rather than sampling once. The old comment here said "attach() has already
  // reloaded" and read the canvas immediately; attach() no longer reloads a live page, and a
  // single read taken in the same turn as the delivery measures the frame before it.
  const deadline = Date.now() + DRAW_WAIT_MS
  let lit = 0
  while (Date.now() < deadline) {
    lit = await evaluate(`(${CANVAS_PROFILE}).lit`)
    if (lit > 0) break
    await new Promise((r) => setTimeout(r, 250))
  }

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

  console.log(path.padEnd(11), JSON.stringify({ ...seen, profile: undefined }))
  console.log('canvas    ', `lit ${seen.profile.lit}, rowExtent ${JSON.stringify(seen.profile.rowExtent)}`)

  if (seen.profile.lit > 0) {
    console.log(path === 'reopened'
      ? '\nPASS  a project reopened from disk draws itself, with nothing forcing a redraw'
      : '\nPASS  a project delivered to a live editor draws itself, with nothing forcing a redraw'
        + '\n      (the persistence path was not exercised: run against a fresh launch for that)')
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
