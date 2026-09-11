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

// Assets are listed once and items carry an id; the join has to actually work, or the
// dedupe traded 31% of the payload for a name the agent cannot resolve.
const itemsInRead = read.ok ? read.value.tracks.flatMap((t) => t.items) : []
const firstItem = itemsInRead[0]
check('items carry assetId rather than a repeated asset block',
  !!firstItem && typeof firstItem.assetId === 'string' && firstItem.asset === undefined,
  firstItem ? `assetId ${String(firstItem.assetId).slice(0, 12)}` : 'no items')
check('every assetId resolves against the top-level assets map',
  itemsInRead.length > 0 && itemsInRead.every((i) => !!read.value.assets?.[i.assetId]?.name),
  read.ok ? `${Object.keys(read.value.assets ?? {}).length} assets listed for ${itemsInRead.length} items` : '')
const browsedName = (await call('browse_assets')).value?.assets?.find((a) => a.id === assetId)?.name
check('the resolved name matches browse_assets',
  !!firstItem && read.value.assets[firstItem.assetId].name === browsedName,
  `${browsedName}`)

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

// -- text styling, each refusal beside its legal twin -------------------------
console.log('\n-- text styling --')
const textAssetId = await c_addText()
async function c_addText() {
  return evaluate(`(() => {
    const s = window.bayEngine.store.getState()
    s.addAssets([{ id: 'ast_probe_text', kind: 'text', name: 'Title', path: null, durationUs: 0,
      width: null, height: null, fps: null, hasAudio: false, hasVideo: false, posterPath: null,
      waveformPath: null, text: 'Chapter One', createdAt: Date.now() }])
    return 'ast_probe_text' })()`)
}
const textPlaced = await call('place_asset', { assetId: textAssetId })
check('setup: a text item placed', textPlaced.ok === true, textPlaced.ok ? '' : textPlaced.error)
const textId = textPlaced.ok ? textPlaced.value.itemId : null

const styled = await call('edit_item', { itemId: textId, text: { color: '#FF0055', fontSize: 120 } })
check('edit_item applies a text style', styled.ok === true && styled.value.text?.color === '#FF0055',
  styled.ok ? `size ${styled.value.text.fontSize}` : styled.error)
const mergedStyle = await call('edit_item', { itemId: textId, text: { fontWeight: 800 } })
check('a partial style merges rather than replacing',
  mergedStyle.ok === true && mergedStyle.value.text.color === '#FF0055' &&
    mergedStyle.value.text.fontSize === 120 && mergedStyle.value.text.fontWeight === 800,
  mergedStyle.ok ? 'colour and size survived a weight-only edit' : mergedStyle.error)

const strokeOn = await call('edit_item', { itemId: textId, text: { stroke: { color: '#000000', width: 6 } } })
check('an effect group sets wholesale', strokeOn.ok === true && strokeOn.value.text.stroke?.width === 6)
const strokeOff = await call('edit_item', { itemId: textId, text: { stroke: null } })
check('  twin: null switches the group off', strokeOff.ok === true && strokeOff.value.text.stroke === null)

const badWeight = await call('edit_item', { itemId: textId, text: { fontWeight: 550 } })
check('a bad weight is refused, naming the rule',
  badWeight.ok === false && /multiple of 100/.test(badWeight.error),
  badWeight.ok ? 'ACCEPTED' : badWeight.error.slice(0, 70))
const goodWeight = await call('edit_item', { itemId: textId, text: { fontWeight: 500 } })
check('  twin: a legal weight is accepted', goodWeight.ok === true)

const badColour = await call('edit_item', { itemId: textId, text: { color: 'hotpink' } })
check('a non-hex colour is refused, showing the form wanted',
  badColour.ok === false && /#FFFFFF/.test(badColour.error),
  badColour.ok ? 'ACCEPTED' : badColour.error.slice(0, 70))

const typo = await call('edit_item', { itemId: textId, text: { fontSizes: 12 } })
check('a mistyped style field is refused, listing the real ones',
  typo.ok === false && /fontFamily/.test(typo.error), typo.ok ? 'ACCEPTED' : typo.error.slice(0, 60))

// The check neither side's probe covers on its own: that a style written through the tools
// actually reaches the pixels. Both halves can pass in isolation while nothing consumes the
// field — which is exactly the state this surface was in an hour before it shipped.
// Whole-image hashes: two PNGs of one size share a byte-identical header, so comparing a
// prefix would report "unchanged" for a completely different picture.
// Rendered at a frame the text item actually covers, taken from its own placement result.
// An earlier version asked for frame 0 — where a video clip placed by an earlier check sits
// instead — and read the empty `textFits` as "nothing consumes item.text". Fifth time a
// fixture assumption has accused working code in this file; see the README.
const textFrame = textPlaced.ok ? textPlaced.value.from + 1 : 0
const shotHash = async () => {
  const f = await call('preview_frame', { frame: textFrame })
  if (!f.ok) return null
  let h = 0
  for (let i = 0; i < f.value.image.length; i++) h = (Math.imul(31, h) + f.value.image.charCodeAt(i)) | 0
  return { hash: h, fits: f.value.textFits ?? [], warnings: f.value.textWarnings ?? [] }
}
// Every other video track hidden for the comparison. The text item shares the canvas with
// clips earlier checks placed, and a full-frame video drawing over it makes a colour change
// invisible in the composite — which reads exactly like a style nothing consumes. Hiding is
// fixture control, not the thing under test, so it goes through the store.
const restoreTracks = await evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
  const holder = tl.tracks.find((t) => t.items.some((i) => i.id === ${JSON.stringify(textId)}))
  const hidden = []
  for (const track of tl.tracks) {
    if (track.kind !== 'video' || track.id === holder?.id || track.hidden) continue
    hidden.push(track.id)
    window.bayEngine.store.getState().patchTrack(track.id, { hidden: true })
  }
  return JSON.stringify(hidden)
})()`)
const beforeStyle = await shotHash()
// A colour derived from the current one rather than a literal. An earlier check already set
// #FF0055, so a hard-coded "change" to the same value correctly changed nothing and the
// probe read that as a dead field — the seventh time a fixture assumption in this file has
// accused working code.
const currentColour = (await call('inspect_item', { itemId: textId })).value?.text?.color
const differentColour = currentColour === '#00FF88' ? '#FF0055' : '#00FF88'
const colourEdit = await call('edit_item', { itemId: textId, text: { color: differentColour } })
const afterStyle = await shotHash()
if (process.env.DEBUG_PIXELS === '1') {
  console.log('    DEBUG textFrame', textFrame, 'editOk', colourEdit.ok,
    'colourNow', colourEdit.ok ? colourEdit.value.text?.color : colourEdit.error.slice(0, 60))
  console.log('    DEBUG drawn/fits', JSON.stringify(beforeStyle?.fits), '->', JSON.stringify(afterStyle?.fits))
  console.log('    DEBUG hashes', beforeStyle?.hash, afterStyle?.hash)
}
check('a style change through the tools reaches the pixels',
  !!beforeStyle && !!afterStyle && beforeStyle.hash !== afterStyle.hash,
  beforeStyle && afterStyle ? (beforeStyle.hash !== afterStyle.hash ? 'picture changed' : 'IDENTICAL — nothing consumes item.text') : 'no frame')

await call('edit_item', { itemId: textId, text: { fontFamily: 'Definitely Not A Real Face' } })
const absent = await shotHash()
check('an uninstalled font is reported, since the picture cannot show it',
  !!absent && absent.fits[0]?.fontAvailable === false && /not installed/.test(absent.warnings[0] ?? ''),
  absent ? `fontAvailable ${absent.fits[0]?.fontAvailable}` : 'no frame')
await call('edit_item', { itemId: textId, text: { fontFamily: 'Georgia, serif' } })
const restored = await shotHash()
check('  twin: an installed font reports available',
  !!restored && restored.fits[0]?.fontAvailable === true)

await call('edit_item', { itemId: textId, width: 220, height: 90, text: { fontSize: 160 } })
const shrunk = await shotHash()
check('auto-shrink is reported rather than applied silently',
  !!shrunk && shrunk.fits[0]?.scale < 1 && /shrunk to/.test(shrunk.warnings[0] ?? ''),
  shrunk ? `scale ${shrunk.fits[0]?.scale}, ${shrunk.fits[0]?.fontSize}px` : 'no frame')

// Tracks put back, so later checks see the timeline they expect.
await evaluate(`(() => {
  for (const id of ${restoreTracks}) window.bayEngine.store.getState().patchTrack(id, { hidden: false })
  return true })()`)

const onVideo = await call('edit_item', { itemId, text: { color: '#FFFFFF' } })
check('styling a non-text item is refused, not silently stored',
  onVideo.ok === false && /no type to style/.test(onVideo.error),
  onVideo.ok ? 'ACCEPTED — would read back and draw nothing' : onVideo.error.slice(0, 80))

const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
close()
return failed.length === 0

})
