/**
 * UNRUN. Written with the feature (editor-parity stream 2) and never executed against an app —
 * the wave's rule was that one verifier launches bay, later, on an isolated instance. Treat every
 * check below as a claim about what should happen, not as something measured. The first run is
 * also the first test of this file: break one thing on purpose (see the end) before trusting it.
 *
 * What it covers, in a running bay with a project open that has at least two video tracks with a
 * clip on one of them, and has been saved to a file (so the sidecar path is `<file>.autosave`):
 *
 * 1. **A probe does not autosave.** This file drives the store through `attach()`, which holds
 *    `window.__bayProbeSnapshot` — the thing `lib/autosave.ts` reads to stand down. Edits are made
 *    and the idle delay is waited out twice over; `<file>.autosave` must not appear, and one that
 *    was there must be byte-identical afterwards. This is the half of CLAUDE.md's "undo what a
 *    probe did, and do not save" that a unit test (`lib/autosave.test.ts`) can only model.
 * 2. **Track reorder**: `move_track` changes the stack, `undo` puts it back, and the timeline
 *    lists the track headers in the new order (video front layer first).
 * 3. **Heal**: a clip split through `split_at` and joined through `join_items` is the clip it was.
 * 4. **History**: `read_history` lists what this probe did as the agent's, and `undo` with
 *    `position` returns to where it started.
 * 5. **Bins**: `organize_assets` files an asset, `browse_assets` reports it, the pool shows a bin
 *    section, and removing the bin keeps the asset.
 *
 * What it cannot cover, because `attach()` is exactly what turns autosave off — do these by hand
 * with `agent-browser --session bay eval`, without attaching (the checklist in the stream's
 * report has the steps): an edit writes the sidecar after the delay; killing the process and
 * reopening offers Restore / Discard; Restore is one undo step; Save removes the sidecar.
 *
 * Usage: `node test/app/parity-structure.mjs` (PORT=9223 for an isolated instance).
 */

import { existsSync, readFileSync } from 'node:fs'
import { attach, runProbe, PreconditionError, ProbeFailure } from './cdp.mjs'

const { evaluate } = await attach()

let checks = 0
const check = (label, actual, expected) => {
  checks += 1
  const ok = typeof expected === 'function' ? expected(actual) : JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) throw new ProbeFailure(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${typeof expected === 'function' ? expected : JSON.stringify(expected)}`)
  console.log(`  ok  ${label}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await runProbe(async () => {
  if ((await evaluate(`Boolean(window.bayMcp && window.bayEngine)`)) !== true) {
    throw new PreconditionError('window.bayMcp / window.bayEngine absent', 'bay.debug needs a reload')
  }
  let n = 0
  const raw = (tool, args = {}) => evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `ps${++n}`, tool, args })})`, 60_000)
  const mcp = async (tool, args = {}) => {
    const result = await raw(tool, args)
    if (!result.ok) throw new Error(`${tool} refused: ${result.error}`)
    return result.value
  }
  const store = (expression) => evaluate(`(() => { const s = window.bayEngine.store.getState(); return ${expression} })()`)

  const filePath = await store('s.project.filePath ?? null')
  if (!filePath) throw new PreconditionError('the open project has never been saved', 'open a project that lives in a file, so its sidecar path is known')
  const sidecar = `${filePath}.autosave`
  const sidecarBefore = existsSync(sidecar) ? readFileSync(sidecar) : null
  const startPosition = await store('s.past.length')
  const tracksBefore = await store(`s.project.timelines.find((t) => t.id === s.project.activeTimelineId).tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, items: t.items.length }))`)
  const video = tracksBefore.filter((t) => t.kind === 'video')
  if (video.length < 2) throw new PreconditionError('fewer than two video tracks', 'the reorder check needs two to swap')
  const withClip = video.find((t) => t.items > 0)
  if (!withClip) throw new PreconditionError('no clip on any video track', 'the heal check needs one to split')

  // -- 2. track reorder ---------------------------------------------------------------
  const from = video.findIndex((t) => t.id === video[0].id) + 1
  // Derived, not a literal: wherever V1 is not.
  const to = from === 1 ? 2 : 1
  const moved = await mcp('move_track', { trackId: video[0].id, position: to })
  check('move_track reports the move', [moved.from, moved.to], [`V${from}`, `V${to}`])
  const videoAfter = await store(`s.project.timelines.find((t) => t.id === s.project.activeTimelineId).tracks.filter((t) => t.kind === 'video').map((t) => t.id)`)
  check('the moved track is at its new place in the stack', videoAfter.indexOf(video[0].id) + 1, to)
  // The headers, top to bottom, are the video stack reversed (front layer first).
  const headers = await evaluate(`[...document.querySelectorAll('[data-track-header][data-track-kind="video"]')].map((el) => el.dataset.trackHeader)`)
  check('the timeline lists the headers in the new order, front layer first', headers, [...videoAfter].reverse())
  const refused = await raw('move_track', { trackId: video[0].id, position: to })
  check('a move to where it already is is refused, by name', refused.ok === false && /already V/.test(refused.error), true)

  // -- 3. heal ------------------------------------------------------------------------
  const clip = await store(`(() => { const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId); const i = tl.tracks.find((t) => t.id === ${JSON.stringify(withClip.id)}).items[0]; return { id: i.id, from: i.from, durationInFrames: i.durationInFrames, sourceStartUs: i.sourceStartUs } })()`)
  if (clip.durationInFrames < 4) throw new PreconditionError('the first clip is under four frames', 'nothing to split in the middle')
  const cutAt = clip.from + Math.floor(clip.durationInFrames / 2)
  await mcp('split_at', { frame: cutAt, itemIds: [clip.id] })
  const joined = await mcp('join_items', { itemIds: [clip.id] })
  check('join_items joins the cut it was given', joined.joined.some((j) => j.itemId === clip.id), true)
  const clipAfter = await store(`(() => { const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId); const i = tl.tracks.flatMap((t) => t.items).find((x) => x.id === ${JSON.stringify(clip.id)}); return { id: i.id, from: i.from, durationInFrames: i.durationInFrames, sourceStartUs: i.sourceStartUs } })()`)
  check('split then join is the clip it was', clipAfter, clip)

  // -- 4. history ---------------------------------------------------------------------
  const history = await mcp('read_history')
  check('the history is at the position the store is', history.position, await store('s.past.length'))
  const mine = history.steps.slice(startPosition)
  check('this probe’s three edits are listed, as the agent’s', mine.map((s) => s.by), ['Agent', 'Agent', 'Agent'])
  check('the move is named', /^Move track V/.test(mine[0].did), true)

  // -- 5. bins ------------------------------------------------------------------------
  const assets = (await mcp('browse_assets')).assets
  if (assets.length === 0) throw new PreconditionError('the media pool is empty', 'the bins check needs an asset to file')
  const binName = `Probe bin ${Date.now().toString(36)}`
  const filed = await mcp('organize_assets', { assetIds: [assets[0].id], bin: binName })
  check('organize_assets made the bin and filed the asset in one call', [filed.createdBin, filed.moved], [true, [assets[0].id]])
  const browsed = await mcp('browse_assets')
  check('browse_assets says which bin the asset is in', browsed.assets.find((a) => a.id === assets[0].id).bin?.name, binName)
  const removed = await mcp('organize_assets', { removeBin: binName })
  check('removing the bin keeps the asset', removed.backAtTopOfPool, [assets[0].id])
  check('and it is still in the pool', (await mcp('browse_assets')).assets.some((a) => a.id === assets[0].id), true)

  // -- 1. no autosave from a probe ----------------------------------------------------
  // Waited for last, so every edit above has had its idle delay (3 s by default, 120 s at most;
  // read the preference rather than assume it).
  const idleSeconds = Number(await evaluate(`Number(localStorage.getItem('bay.autosave.idleSeconds') ?? 3)`))
  check('the project is dirty, so autosave would have something to write', await store('s.dirty'), true)
  await sleep(Math.min(125_000, idleSeconds * 2000 + 1000))
  const sidecarAfter = existsSync(sidecar) ? readFileSync(sidecar) : null
  check(
    'no sidecar was written (or the one that was there is untouched) while the probe drove',
    sidecarBefore === null ? sidecarAfter === null : sidecarAfter !== null && sidecarBefore.equals(sidecarAfter),
    true
  )

  // -- and back -----------------------------------------------------------------------
  const back = await mcp('undo', { position: startPosition })
  check('undo with a position returns to where the probe began', back.position, startPosition)
  const tracksAfter = await store(`s.project.timelines.find((t) => t.id === s.project.activeTimelineId).tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, items: t.items.length }))`)
  check('the tracks are as they were', tracksAfter, tracksBefore)
  // `attach()`'s restore puts `past`, `future` and `dirty` back and drops the snapshot.

  console.log(`\n${checks} checks.`)
  // To prove this file can fail: in `src/shared/autosave.ts` delete the `probeDriving` line of
  // `autosaveSkip`, rebuild, restart, run this on a COPY of a project — check 1 must go red and a
  // `<file>.autosave` must appear beside the copy.
  //
  // Done without a rebuild on the first run, by taking the snapshot away from the page while this
  // probe waited (`window.__stash = window.__bayProbeSnapshot; delete window.__bayProbeSnapshot`
  // from a second connection, put back before the wait ended): check 1 went red and the sidecar
  // appeared. That first run also ended CANNOT MEASURE with 17 checks green — the body returned
  // nothing, which `runProbe` rightly refuses to read as a verdict.
  return true
})
