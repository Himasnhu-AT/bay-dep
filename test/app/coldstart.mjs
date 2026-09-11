/**
 * Does a project loaded from disk at launch actually draw, with nothing forcing it?
 *
 * `latearrival.mjs` covers a project delivered to the store after mount, which is the shape
 * `project.initial()` produces — but it delivers it by calling `setProject` directly. This
 * probe uses the real path instead: it saves a project to disk, reloads, and lets
 * `project.initial()` bring it back, because "the store was handed a project" and "the app
 * reopened the last project" are different code and only one of them runs at launch.
 *
 * Nothing here calls `redraw()`. If the canvas is bare at the end, the app cannot show you
 * your own project until you touch something.
 *
 * **This probe needs a profile that already has a saved project, and cannot make one.**
 * `project.save` opens a system dialog, which a CDP-driven run cancels, and `project.autosave`
 * of a project whose `filePath` is null does not become the reopenable one — measured:
 * autosave resolves, `app.storageReady()` reports `{ready: true}`, and `project.recent()` is
 * still empty while `project.initial()` returns "Untitled" with zero items. So run it against
 * a `--user-data-dir` that has been seeded by saving a project by hand once:
 *
 *     node test/app/coldstart.mjs   # PORT=<port>, app launched with the seeded profile
 *
 * Against an unseeded profile it reports CANNOT MEASURE, which is correct and not a failure
 * of the app.
 */

import { attach, CANVAS_PROFILE, CANVAS_READY, requirePrecondition, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const { send, evaluate, close } = await attach()

await runProbe(async () => {
  // 1. Build a project with a clip on it and put it on disk the way the app does.
  const saved = await evaluate(`(async () => {
    const { store } = window.bayEngine
    const imported = await window.bay.media.importPaths([${JSON.stringify(process.cwd() + '/' + CLIP)}])
    const asset = imported[0].asset
    store.getState().addAssets([asset])
    store.getState().placeAsset(asset.id, 0)
    const project = store.getState().project
    let filePath = null
    try { filePath = (await window.bay.project.save(project)).filePath } catch (e) { filePath = 'save failed: ' + e.message }
    try { await window.bay.project.autosave(store.getState().project) } catch {}
    return { filePath, items: project.timelines.flatMap(t => t.tracks).flatMap(t => t.items).length }
  })()`, 60_000)
  console.log('saved          ', JSON.stringify(saved))

  // 2. Reload. The engine mounts against the placeholder, then project.initial() resolves.
  await send('Page.reload', {})
  await new Promise((r) => setTimeout(r, 3000))
  await evaluate(`(async () => {
    for (let i = 0; i < 120; i++) { if (window.bayEngine) return true; await new Promise(r => setTimeout(r, 250)) }
    throw new Error('engine never remounted')
  })()`, 45_000)

  // 3. Wait for the preconditions, and force nothing.
  for (const [label, expression] of Object.values(CANVAS_READY)) {
    await requirePrecondition(evaluate, label, expression)
  }

  const reopened = await evaluate(`(() => {
    const { engine, store } = window.bayEngine
    const st = store.getState()
    const tl = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
    const items = tl ? tl.tracks.flatMap(t => t.items) : []
    const asset = st.project.assets[0]
    return {
      projectName: st.project.name,
      items: items.length,
      clockDuration: engine.clock.duration,
      samples: engine.stats().samples,
      poolStatus: asset ? engine.pool.readiness(asset.id).status : 'no asset',
      hasPicture: asset ? engine.pool.readiness(asset.id).hasPicture : false,
      profile: ${CANVAS_PROFILE}
    }
  })()`)

  const lit = reopened.profile.lit
  const bands = reopened.profile.bands.filter((b) => b.nonZero > 0).length
  console.log('reopened       ', JSON.stringify({ ...reopened, profile: undefined }))
  console.log('canvas         ', `lit ${lit}, bands with content ${bands}/20, rowExtent ${JSON.stringify(reopened.profile.rowExtent)}`)

  const drew = lit > 0
  console.log()
  console.log(drew
    ? 'PASS  a project reopened from disk draws itself, with nothing forcing a redraw'
    : 'FAIL  the reopened project is on the timeline but the canvas is bare - nothing asked for a frame')
  close()
  return drew
})
