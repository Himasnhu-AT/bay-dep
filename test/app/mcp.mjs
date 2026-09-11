/**
 * Do the MCP tools actually change the project, and do they refuse what they should?
 *
 * Two things this has to check, and the second is the one that matters. A tool that returns
 * `ok: true` having changed nothing is the failure shape this codebase keeps finding — the
 * store's mutators refuse silently, so `moveItem` onto occupied frames returns success and
 * does nothing unless someone checked first. So every assertion here reads the **store**
 * after the call, not the tool's own reply.
 *
 * The negative controls are half the probe: a call that must be refused, refused, with an
 * error an agent could act on. A probe that only drives the happy path cannot tell a
 * validating executor from one that says yes to everything.
 *
 * Drives the dispatcher directly through `window.bayMcp` rather than through the socket, on
 * purpose: it separates a fault in these tools from a fault in main's transport.
 */

import { attach, PreconditionError, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const ABSOLUTE = `${process.cwd()}/${CLIP}`
const { evaluate, close } = await attach()

await runProbe(async () => {

await evaluate(`(async () => {
  localStorage.setItem('bay.debug', '1')
  return true
})()`)
const present = await evaluate(`typeof window.bayMcp === 'object' && typeof window.bayMcp.execute === 'function'`)
if (!present) {
  throw new PreconditionError(
    'window.bayMcp is missing',
    'the executor did not register — is bay.debug set and the build current?'
  )
}

let seq = 0
const call = (tool, args = {}) =>
  evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `p${++seq}`, tool, args })})`)
const state = (expression) => evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
  const items = tl.tracks.flatMap((t) => t.items)
  return ${expression}
})()`)

const checks = []
const check = (label, passed, detail) => {
  checks.push({ label, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

// -- read_project, before anything exists ------------------------------------
const empty = await call('read_project')
check('read_project succeeds on an empty project', empty.ok === true,
  empty.ok ? `fps ${empty.value.timeline.fps}, ${empty.value.tracks.length} tracks` : empty.error)
check('read_project states its time unit', empty.ok && empty.value.timeUnit === 'frames')

// -- import + place ----------------------------------------------------------
const imported = await call('import_media', { paths: [ABSOLUTE] })
check('import_media returns an asset', imported.ok === true && imported.value.assets.length === 1,
  imported.ok ? `unreadable ${imported.value.unreadable}` : imported.error)
const assetId = imported.ok ? imported.value.assets[0].id : null
check('import_media reports frames, not just microseconds',
  imported.ok && typeof imported.value.assets[0].durationInFrames === 'number',
  imported.ok ? `${imported.value.assets[0].durationInFrames} frames` : '')

const placed = await call('place_asset', { assetId, atFrame: 0 })
check('place_asset returns an item id', placed.ok === true && !!placed.value.itemId,
  placed.ok ? `${placed.value.itemId} on ${placed.value.trackName}` : placed.error)
const itemId = placed.ok ? placed.value.itemId : null
check('place_asset actually changed the store', await state('items.length') === 1)

// The ids a tool hands back must be the ids the other tools accept — the whole surface
// depends on read_project's output being usable without translation.
const read = await call('read_project')
const idFromRead = read.ok ? read.value.tracks.flatMap((t) => t.items).map((i) => i.id)[0] : null
check('read_project returns the id place_asset created', idFromRead === itemId, `${idFromRead}`)

// -- prefix ids --------------------------------------------------------------
const byPrefix = await call('inspect_item', { itemId: String(itemId).slice(0, 10) })
check('a 10-character id prefix resolves', byPrefix.ok === true,
  byPrefix.ok ? '' : byPrefix.error)

// -- edit_item: one call, many fields, one undo step --------------------------
const undoBefore = await state('s.past.length')
const edited = await call('edit_item', {
  itemId, from: 30, durationInFrames: 90, left: 100, top: 50, opacity: 0.5, volume: 0.25
})
check('edit_item succeeds', edited.ok === true, edited.ok ? '' : edited.error)
const after = await state('JSON.stringify({from: items[0].from, dur: items[0].durationInFrames, left: items[0].layout.left, opacity: items[0].layout.opacity, volume: items[0].volume})')
check('edit_item changed every field it was given',
  after === JSON.stringify({ from: 30, dur: 90, left: 100, opacity: 0.5, volume: 0.25 }), after)
const undoAfter = await state('s.past.length')
check('a multi-field edit_item is ONE undo step', undoAfter - undoBefore === 1,
  `past ${undoBefore} -> ${undoAfter}`)

// -- undo --------------------------------------------------------------------
const undone = await call('undo')
check('undo succeeds', undone.ok === true, undone.ok ? '' : undone.error)
check('undo reverted the whole edit', await state('items[0].from') === 0,
  `from ${await state('items[0].from')}`)

// -- REFUSALS, EACH BESIDE THE LEGAL CALL IT MUST NOT BREAK --------------------
// A surface that refuses everything passes every negative control on its own. Each pair
// below is one refusal and the nearest call that must still succeed, so the two together
// distinguish "correctly strict" from "simply broken".
console.log('\n-- refusals, each paired with its legal twin --')

const badTool = await call('make_it_pretty')
check('unknown tool refused, and names the alternatives',
  badTool.ok === false && /read_project/.test(badTool.error),
  badTool.ok ? 'ACCEPTED' : badTool.error.slice(0, 70))
check('  twin: a known tool still works', (await call('read_project')).ok === true)

const badArg = await call('edit_item', { itemId, opacity: 5 })
check('out-of-range argument refused, naming the bound',
  badArg.ok === false && /at most 1/.test(badArg.error), badArg.ok ? 'ACCEPTED' : badArg.error)
const goodArg = await call('edit_item', { itemId, opacity: 0.75 })
check('  twin: an in-range value is accepted', goodArg.ok === true,
  goodArg.ok ? `opacity ${await state('items[0].layout.opacity')}` : goodArg.error)

const badId = await call('inspect_item', { itemId: 'zzzzzzzz' })
check('unknown id refused, and says where ids come from',
  badId.ok === false && /read_project/.test(badId.error), badId.ok ? 'ACCEPTED' : badId.error.slice(0, 70))
check('  twin: a real id resolves', (await call('inspect_item', { itemId })).ok === true)

const unchanged = await state('items[0].layout.opacity')
check('a refused call changed nothing', unchanged === 0.75, `opacity ${unchanged}`)

// Occupied frames. The store accepts this and silently does nothing, so an executor that
// did not pre-check would report success here.
const second = await call('place_asset', { assetId, atFrame: 100000 })
check('setup: a second clip placed far away', second.ok === true, second.ok ? '' : second.error)
const secondId = second.ok ? second.value.itemId : null
const firstTrack = await state('tl.tracks.find((t) => t.items.some((i) => i.id === ' + JSON.stringify(itemId) + ')).id')
const collide = await call('edit_item', { itemId: secondId, from: 0, trackId: firstTrack })
check('occupied frames refused, naming the item in the way',
  collide.ok === false && /occupied/i.test(collide.error) && new RegExp(String(itemId).slice(0, 8)).test(collide.error),
  collide.ok ? 'ACCEPTED — the store would have no-opped' : collide.error.slice(0, 100))
// Past the end of the first clip, which read_project says is 2035 frames long. An earlier
// version of this probe used frame 500 — inside it — and then read the correct refusal as a
// failure of the executor.
const firstEnd = await state('items.find((i) => i.id === ' + JSON.stringify(itemId) + ').from + items.find((i) => i.id === ' + JSON.stringify(itemId) + ').durationInFrames')
const freeSlot = await call('edit_item', { itemId: secondId, from: firstEnd + 10, trackId: firstTrack })
check('  twin: free frames on the same track are accepted', freeSlot.ok === true,
  freeSlot.ok ? `from ${await state('items.find((i) => i.id === ' + JSON.stringify(secondId) + ').from')}` : freeSlot.error)

// Locked track.
const videoTrack = await state('tl.tracks.find((t) => t.kind === "video").id')
const lock = (locked) => evaluate(`(() => {
  window.bayEngine.store.getState().patchTrack(${JSON.stringify(videoTrack)}, { locked: ${locked} })
  return true })()`)
await lock(true)
const lockedCall = await call('edit_item', { itemId, from: 5 })
check('locked track refused, and says how to proceed',
  lockedCall.ok === false && /locked/i.test(lockedCall.error) && /unlock/i.test(lockedCall.error),
  lockedCall.ok ? 'ACCEPTED' : lockedCall.error.slice(0, 90))
await lock(false)
const unlockedCall = await call('edit_item', { itemId, from: 5 })
check('  twin: the same call succeeds once unlocked', unlockedCall.ok === true,
  unlockedCall.ok ? `from ${await state('items[0].from')}` : unlockedCall.error)

// A split on an edge would make a zero-length clip.
const edgeSplit = await call('split_at', { frame: 5 })
check('split on an item edge refused, naming nearby items',
  edgeSplit.ok === false && /zero-length/i.test(edgeSplit.error),
  edgeSplit.ok ? 'ACCEPTED' : edgeSplit.error.slice(0, 90))
const realSplit = await call('split_at', { frame: 40 })
check('  twin: a split inside an item works', realSplit.ok === true,
  realSplit.ok ? `${realSplit.value.itemsCut} cut, now ${await state('items.length')} items` : realSplit.error)

// Export paths.
const relPath = await call('export_timeline', { outputPath: 'relative.mp4', format: 'mp4' })
check('relative output path refused, and says why',
  relPath.ok === false && /absolute/i.test(relPath.error), relPath.ok ? 'ACCEPTED' : relPath.error.slice(0, 70))
const realExport = await call('export_timeline', {
  outputPath: '/tmp/bay-mcp-probe.mp4', format: 'mp4', fromFrame: 0, toFrame: 1
})
check('  twin: an absolute path starts a job', realExport.ok === true && !!realExport.value.jobId,
  realExport.ok ? realExport.value.jobId : realExport.error)

const noJob = await call('track_export', { jobId: 'nope' })
check('unknown job refused, and points at a usable id',
  noJob.ok === false && (/export_timeline/.test(noJob.error) || /Jobs started here/.test(noJob.error)),
  noJob.ok ? 'ACCEPTED' : noJob.error.slice(0, 80))
const realJob = realExport.ok ? await call('track_export', { jobId: realExport.value.jobId }) : { ok: false }
check('  twin: a real job id reports a stage', realJob.ok === true && !!realJob.value.stage,
  realJob.ok ? realJob.value.stage : 'no job to track')

// -- the remaining tools, so the probe covers the whole catalog ---------------
// "Every tool in TOOLS must work" is the catalog's first rule, and a probe that exercises
// nine of fourteen cannot say whether it holds.
console.log('\n-- remaining tools --')

const browsed = await call('browse_assets')
check('browse_assets lists the pool with placeability',
  browsed.ok === true && browsed.value.assets.length >= 1 && browsed.value.assets[0].placeable === true,
  browsed.ok ? `${browsed.value.assets.length} assets` : browsed.error)

const track = await call('add_track', { kind: 'video' })
check('add_track returns a usable id', track.ok === true && !!track.value.trackId,
  track.ok ? `${track.value.name}` : track.error)
const newTrack = track.ok ? track.value.trackId : null
check('add_track changed the store',
  await state(`tl.tracks.some((t) => t.id === ${JSON.stringify(newTrack)})`) === true)

const moved = await call('set_playhead', { frame: 12 })
check('set_playhead moves the playhead', moved.ok === true && await state('s.playhead') === 12,
  moved.ok ? `playhead ${await state('s.playhead')}` : moved.error)
const clamped = await call('set_playhead', { frame: 99999999 })
check('set_playhead reports a clamp rather than lying',
  clamped.ok === true && clamped.value.playhead === await state('s.playhead') &&
    clamped.value.clampedTo !== undefined,
  clamped.ok ? `asked ${clamped.value.requested}, got ${clamped.value.playhead}` : clamped.error)

// delete_items + ripple: three adjacent clips, remove the middle, the last must slide back
// by exactly the gap. Built on its own track so nothing else interferes.
// Positions chained from each placement's own endFrame rather than computed from a
// duration read elsewhere: earlier checks trim and split the first item, so any duration
// borrowed from it is stale by the time this runs.
const a = await call('place_asset', { assetId, atFrame: 0, trackId: newTrack })
const b = a.ok ? await call('place_asset', { assetId, atFrame: a.value.endFrame, trackId: newTrack }) : a
const c = b.ok ? await call('place_asset', { assetId, atFrame: b.value.endFrame, trackId: newTrack }) : b
check('setup: three adjacent clips on a fresh track', a.ok && b.ok && c.ok,
  a.ok && b.ok && c.ok ? `0, ${a.value.endFrame}, ${b.value.endFrame}` : (a.error || b.error || c.error))
const gap = b.ok ? b.value.durationInFrames : 0
const expectedThird = a.ok ? a.value.endFrame : 0

const undoBeforeRipple = await state('s.past.length')
const rippled = await call('delete_items', { itemIds: [b.value.itemId], ripple: true })
check('delete_items with ripple succeeds', rippled.ok === true, rippled.ok ? `rippled ${rippled.value.rippled}` : rippled.error)
const thirdFrom = await state('items.find((i) => i.id === ' + JSON.stringify(c.ok ? c.value.itemId : '') + ').from')
check('ripple closed the gap exactly', thirdFrom === expectedThird,
  `third clip now starts at ${thirdFrom}, expected ${expectedThird} (gap was ${gap})`)
check('a ripple delete is ONE undo step',
  await state('s.past.length') - undoBeforeRipple === 1,
  `past ${undoBeforeRipple} -> ${await state('s.past.length')}`)
check('ripple warns that other tracks are now out of sync',
  rippled.ok === true && typeof rippled.value.note === 'string' && /out of sync/i.test(rippled.value.note))

const plainDelete = await call('delete_items', { itemIds: [c.value.itemId] })
check('delete_items without ripple leaves the gap', plainDelete.ok === true,
  plainDelete.ok ? `${plainDelete.value.deleted.length} deleted` : plainDelete.error)

// preview_frame is the one tool whose rendering lives in the engine. Reported rather than
// asserted, because a red line here would be someone else's unfinished work, not a fault
// in this executor — but it must not pass silently either.
const preview = await call('preview_frame', { frame: 10 })
if (preview.ok) {
  check('preview_frame returns an image',
    typeof preview.value.image === 'string' && preview.value.image.startsWith('data:image'),
    `${preview.value.width}x${preview.value.height}`)
} else {
  console.log(`TOOL NOT READY  preview_frame  ${preview.error.slice(0, 90)}`)
}

const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
close()
return failed.length === 0

})
