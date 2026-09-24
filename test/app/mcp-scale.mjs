/**
 * What does `read_project` actually cost an agent on a big timeline?
 *
 * The question as first asked was "does the payload survive 200 clips", and the payload size
 * is the less interesting half. An agent re-reads after most writes, so the cost that
 * compounds is **bytes per turn**, not bytes per call — a one-clip change followed by a full
 * re-dump pays for all 200 again. So this measures both: the payload at several sizes, and a
 * realistic read/write/read sequence totalled across the turn.
 *
 * It also prints the structure at size, because legibility is not bytes. A wall of similar
 * objects where the model has to count to find the third clip on V2 is a failure at 200 clips
 * whatever the byte count says, and narrowing the payload would not fix it.
 *
 * The fixture is built through the store rather than through the tools: 200 `place_asset`
 * calls would measure the tools' throughput, which is not the question, and would take
 * minutes. Everything *measured* goes through the real dispatcher.
 *
 * **Report, no verdict.** Exits 0 whenever it could measure and 2 when it could not; nothing is
 * compared with an expectation, so a green exit says the numbers exist, not that they are good.
 */

import { attach, PreconditionError, runProbe } from './cdp.mjs'

const CLIP = process.env.CLIP ?? 'assets/podcast-cut/output/goodall-transcript-cut.mp4'
const ABSOLUTE = `${process.cwd()}/${CLIP}`
const SIZES = (process.env.SIZES ?? '10,50,200').split(',').map(Number)
const { evaluate, close } = await attach()

await runProbe(async () => {

await evaluate(`localStorage.setItem('bay.debug', '1')`)
if (!(await evaluate(`typeof window.bayMcp?.execute === 'function'`))) {
  throw new PreconditionError('window.bayMcp is missing', 'is bay.debug set and the build current?')
}

let seq = 0
const call = (tool, args = {}) =>
  evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `s${++seq}`, tool, args })})`)
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length

// One import, reused by every item: an agent's timeline is usually a handful of sources cut
// many times, not 200 distinct files, and assets are a separate payload anyway.
const imported = await call('import_media', { paths: [ABSOLUTE] })
if (!imported.ok) throw new PreconditionError('could not import the fixture clip', imported.error)
const assetId = imported.value.assets[0].id

/**
 * Builds `count` items across four video tracks, 60 frames each, laid down in rows.
 *
 * Written straight into the store rather than through `place_asset`: 200 tool calls would
 * measure the tools' throughput rather than the payload, and take minutes. Everything this
 * probe *measures* still goes through the real dispatcher.
 */
const build = (count) => evaluate(`(() => {
  const project = structuredClone(window.bayEngine.store.getState().project)
  const tl = project.timelines.find((t) => t.id === project.activeTimelineId)
  for (const track of tl.tracks) track.items = []
  const videos = tl.tracks.filter((t) => t.kind === 'video')
  while (videos.length < 4) {
    const track = {
      id: 'trk_scale' + videos.length, kind: 'video', name: 'V' + (videos.length + 1),
      locked: false, muted: false, hidden: false, items: []
    }
    tl.tracks.push(track)
    videos.push(track)
  }
  let made = 0
  let row = 0
  while (made < ${count}) {
    for (const track of videos) {
      if (made >= ${count}) break
      track.items.push({
        id: 'itm_scale' + String(made).padStart(4, '0'),
        assetId: ${JSON.stringify(assetId)},
        trackId: track.id,
        from: row * 60,
        durationInFrames: 60,
        sourceStartUs: 0,
        layout: { left: 0, top: 0, width: tl.width, height: tl.height, opacity: 1, rotation: 0 },
        volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
      })
      made++
    }
    row++
  }
  window.bayEngine.store.getState().setProject(project)
  const live = window.bayEngine.store.getState().project
  return live.timelines.find((t) => t.id === live.activeTimelineId)
    .tracks.reduce((n, t) => n + t.items.length, 0)
})()`)

console.log('payload  items   read_project bytes   per item')
const payloads = {}
for (const size of SIZES) {
  const made = await build(size)
  if (made !== size) throw new PreconditionError(`fixture built ${made} items, wanted ${size}`, '')
  const read = await call('read_project')
  if (!read.ok) throw new PreconditionError('read_project failed on the fixture', read.error)
  const size_ = bytes(read.value)
  payloads[size] = size_
  console.log(`         ${String(size).padStart(4)}   ${String(size_).padStart(12)}   ${String(Math.round(size_ / size)).padStart(6)}`)
}

// -- the number that actually decides it -------------------------------------
// A realistic turn on the 200-clip timeline: orient, act, verify, act, verify.
console.log('\nturn    a realistic read/write/read sequence on 200 clips')
await build(200)
const turn = []
const record = async (label, tool, args) => {
  const result = await call(tool, args)
  turn.push({ label, bytes: bytes(result.ok ? result.value : result.error), ok: result.ok })
  return result
}
await record('read_project (orient)', 'read_project', {})
const target = (await call('read_project')).value.tracks[0].items[2].id
await record('edit_item (trim one clip)', 'edit_item', { itemId: target, durationInFrames: 45 })
await record('read_project (verify)', 'read_project', {})
await record('inspect_item (the one clip)', 'inspect_item', { itemId: target })
await record('edit_item (move it)', 'edit_item', { itemId: target, left: 40 })
await record('read_project (verify)', 'read_project', {})

let total = 0
for (const step of turn) {
  total += step.bytes
  console.log(`        ${step.label.padEnd(28)} ${String(step.bytes).padStart(7)} bytes${step.ok ? '' : '  (error)'}`)
}
const rereads = turn.filter((s) => s.label.startsWith('read_project')).reduce((n, s) => n + s.bytes, 0)
console.log(`        ${'TOTAL'.padEnd(28)} ${String(total).padStart(7)} bytes`)
console.log(`        of which full re-reads:      ${String(rereads).padStart(7)} bytes  (${Math.round((rereads / total) * 100)}%)`)
console.log(`        the same turn, if the write results were trusted and not re-read:`)
console.log(`                                     ${String(total - rereads + payloads[200]).padStart(7)} bytes  (one orienting read)`)

// -- where the bytes actually go ---------------------------------------------
// Measured rather than argued: each variant is the *real* payload transformed, so the
// numbers are a property of this data rather than of an estimate.
console.log('\nshape   where the 200-clip payload goes')
const full = (await call('read_project')).value
const variants = {
  'as returned today (assets listed once)': full,
  're-nested: the asset block on every item': {
    ...full,
    assets: undefined,
    tracks: full.tracks.map((t) => ({
      ...t,
      items: t.items.map(({ assetId, ...rest }) => ({
        ...rest,
        asset: { id: assetId, ...(full.assets[assetId] ?? {}) }
      }))
    }))
  },
  'without endFrame (derivable, kept on purpose)': {
    ...full,
    tracks: full.tracks.map((t) => ({
      ...t,
      items: t.items.map(({ endFrame, ...rest }) => rest)
    }))
  }
}
const baseline = bytes(full)
for (const [label, value] of Object.entries(variants)) {
  const size = bytes(value)
  const delta = Math.round(((size - baseline) / baseline) * 100)
  console.log(`        ${label.padEnd(46)} ${String(size).padStart(6)} bytes  ${delta === 0 ? '' : `${delta}%`}`)
}

// -- legibility, which bytes do not measure ----------------------------------
console.log('\nshape   what the model sees (first track, trimmed to 3 items)')
const sample = (await call('read_project')).value
const firstTrack = { ...sample.tracks[0], items: sample.tracks[0].items.slice(0, 3) }
console.log(JSON.stringify({ timeline: sample.timeline, tracks: [firstTrack] }, null, 2)
  .split('\n').map((line) => `        ${line}`).join('\n'))
console.log(`\n        tracks: ${sample.tracks.length}, items: ${sample.tracks.reduce((n, t) => n + t.items.length, 0)}`)
console.log(`        items per track: ${sample.tracks.map((t) => t.items.length).join(', ')}`)

console.log('\nREPORT ONLY: no verdict — read the sizes above.')
close()
return true

})
