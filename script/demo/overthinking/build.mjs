/**
 * Build the edit: the phone video, plus six HyperFrames compositions placed at times that
 * came out of its own transcript.
 *
 * No content cut. The first pass of this removed 10s-25s, which is the history and the
 * "everyone has become an overthinker" turn — the spine of the argument. Knowing what the
 * video says changes the edit, not just the graphics on top of it.
 */
import { readFileSync } from 'node:fs'
import { attach, runProbe, PreconditionError } from '/Users/himanshu/codes/synthai/vii/test/app/cdp.mjs'

const SRC = '/Users/himanshu/Downloads/telegram-cloud-document-5-6100349007802934467.mp4'
const DIR = '/tmp/claude-501/-Users-himanshu-codes-synthai-vii/040091dd-ab41-47c2-a7dd-937a61a97337/scratchpad/e2e'
const PLAN = JSON.parse(readFileSync(`${DIR}/comp/plan.json`, 'utf8'))
const FPS = 30

const { evaluate, close } = await attach()
let checks = 0
const check = (label, actual, expected) => {
  checks++
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) throw new Error(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  console.log(`   ok  ${label}`)
}

await runProbe(async () => {

let n = 0
const mcp = async (tool, args = {}) => {
  const r = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `b${++n}`, tool, args })})`, 180_000)
  if (!r.ok) throw new Error(`${tool} refused: ${r.error}`)
  return r.value
}
const tl = (expr) => evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  const t = s.project.timelines.find(x => x.id === s.project.activeTimelineId)
  return ${expr}
})()`)

console.log('\n── canvas + source')
// Clear whatever the profile reopened, through the agent surface rather than by reaching
// into the store: the default profile restores the last saved project, and building this
// edit on top of someone else's timeline would mix two documents.
const existing = await tl('t.tracks.flatMap(k => k.items).map(i => i.id)')
if (existing.length > 0) {
  await mcp('delete_items', { itemIds: existing })
  console.log(`   cleared ${existing.length} item(s) left by the reopened project`)
}
check('the timeline starts empty', await tl('t.tracks.flatMap(k => k.items).length'), 0)
await evaluate(`window.bayEngine.store.getState().setCanvasPreset('vertical-1080')`)
check('vertical 1080x1920', await tl('t.width + "x" + t.height'), '1080x1920')

const asset = (await mcp('import_media', { paths: [SRC] })).assets[0]
const base = (await mcp('place_asset', { assetId: asset.id, atFrame: 0 })).itemId
const baseInfo = await mcp('inspect_item', { itemId: base })
check('the talking head fills the frame at 2x', `${baseInfo.layout.width}x${baseInfo.layout.height}`, '1080x1920')
check('full length, nothing cut', baseInfo.timing.durationInFrames, 1438)

// A gentle lift so white captions sit on something. Not a "look" — the shirt is already
// near-black and the wall is the only bright region, so this only touches the wall.
await mcp('edit_item', { itemId: base, adjustments: { brightness: 0.94, contrast: 1.06, saturate: 1.04 } })
check('a small grade landed', (await mcp('inspect_item', { itemId: base })).adjustments, (a) => !!a)

console.log('\n── six compositions, at transcript times')
const placedComps = []
for (const spec of PLAN) {
  const path = `${DIR}/comp/${spec.id}.html`
  const written = await mcp('write_composition', { path, html: readFileSync(path, 'utf8'), import: true })
  if (!written.usable) throw new PreconditionError(`${spec.id} is not usable`, JSON.stringify(written))
  const track = (await mcp('add_track', { kind: 'video' })).trackId
  const atFrame = Math.round(spec.start * FPS)
  const item = (await mcp('place_asset', { assetId: written.assetId, atFrame, trackId: track })).itemId
  const info = await mcp('inspect_item', { itemId: item })
  const wantFrames = Math.round(spec.dur * FPS)
  console.log(`   ${spec.id.padEnd(9)} frame ${String(atFrame).padStart(4)}  ${info.timing.durationInFrames} frames (declared ${wantFrames})`)
  check(`${spec.id} placed where the words are`, info.timing.from, atFrame)
  check(`${spec.id} is as long as it declares`, Math.abs(info.timing.durationInFrames - wantFrames) <= 1, true)
  placedComps.push({ ...spec, item, track, atFrame })
}

// Fade the captions in and out so they do not snap on at frame 0 or cut at the end.
const caps = placedComps.find((p) => p.id === 'captions')
await mcp('edit_item', { itemId: caps.item, fadeInFrames: 8, fadeOutFrames: 12 })

console.log('\n── stacking order')
const order = await tl('t.tracks.filter(k => k.kind === "video").map(k => k.name + ":" + k.items.length)')
console.log(`   ${order.join('  ')}`)
check('the video is on the bottom video track', await tl(
  `t.tracks.filter(k => k.kind === "video")[0].items.length`), 1)
check('seven video tracks: the source plus six overlays', await tl(
  `t.tracks.filter(k => k.kind === "video").length`), 7)

const duration = await tl('t.tracks.flatMap(k => k.items).reduce((m,i) => Math.max(m, i.from + i.durationInFrames), 0)')
console.log(`\n   timeline: ${duration} frames = ${(duration / FPS).toFixed(2)}s`)
console.log('\n── render the beats and write them out')
const { writeFileSync, mkdirSync } = await import('node:fs')
mkdirSync(`${DIR}/shots`, { recursive: true })
const WANT = [
  [60, 'hook-strike'], [100, 'hook-line2'], [300, 'captions-only'],
  [560, 'everyone-2'], [660, 'everyone-all'], [800, 'input'],
  [1030, 'modes'], [1360, 'turn'],
]
const sizes = []
// `preview_frame` reports `incomplete` when a composition has not finished rendering, and
// says in the message to ask again in a moment. Compositions render in a hidden window off
// the main path, so the first request for a new frame is usually early. Retrying is the
// documented answer; judging the edit from the first picture would be reading a frame the
// export will not produce.
const settled = async (frame) => {
  let last
  for (let i = 0; i < 40; i++) {
    last = await mcp('preview_frame', { frame })
    if (!last.incomplete) return { shot: last, tries: i + 1 }
    if (i === 0 || i === 8) {
      console.log(`      f${frame} still incomplete: drawn=${last.itemsDrawn} pending=${last.pending} ` +
        `placeholders=${last.placeholders} unresolved=${JSON.stringify(last.unresolved)}`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  const live = await tl(`t.tracks.flatMap(k => k.items).filter(i => i.from <= ${frame} && i.from + i.durationInFrames > ${frame}).map(i => i.id + '@' + i.assetId.slice(0,8))`)
  throw new Error(`frame ${frame} never completed.\n  pending=${last.pending} placeholders=${last.placeholders}\n  unresolved=${JSON.stringify(last.unresolved)}\n  live items there=${JSON.stringify(live)}`)
}
for (const [frame, name] of WANT) {
  const { shot: s, tries } = await settled(frame)
  const b64 = String(s.image).split(',')[1]
  writeFileSync(`${DIR}/shots/${String(frame).padStart(4, '0')}-${name}.png`, Buffer.from(b64, 'base64'))
  sizes.push(b64.length)
  const flags = [s.incomplete ? `INCOMPLETE(${s.unresolved})` : null, ...(s.textWarnings ?? [])].filter(Boolean)
  console.log(`   f${String(frame).padStart(4)} ${name.padEnd(14)} ${s.itemsDrawn} items ${s.width}x${s.height}` +
    (tries > 1 ? `  (settled after ${tries} asks)` : '') + (flags.length ? `  WARN ${flags.join(' | ')}` : ''))
  check(`${name}: the composition layer actually drew`, s.itemsDrawn, (d) => d >= 2)
  check(`${name}: nothing was missing from the picture`, s.incomplete, undefined)
}
check('every beat is a different picture', new Set(sizes).size, WANT.length)

console.log('\n── export')
const OUT = `${DIR}/overthinking-edit.mp4`
const job = await mcp('export_timeline', { outputPath: OUT, format: 'mp4' })
console.log(`   job ${job.jobId}`)
const t0 = Date.now()
let last = null
for (let i = 0; i < 3000; i++) {
  last = await mcp('track_export', { jobId: job.jobId })
  if (last.stage === 'done' || last.stage === 'failed') break
  if (i % 30 === 0) {
    const done = last.framesDone ?? 0
    const rate = done > 0 ? ((Date.now() - t0) / 1000 / done) : 0
    const left = rate > 0 ? Math.round((duration - done) * rate) : '?'
    console.log(`   ${last.stage} ${done}/${last.framesTotal ?? duration}  ${rate ? rate.toFixed(2) + 's/frame, ~' + left + 's left' : ''}`)
  }
  await new Promise((r) => setTimeout(r, 1000))
}
const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`   final after ${secs}s: ${JSON.stringify(last)}`)
check('the export finished', last.stage, 'done')
check('every frame was written', last.framesDone, duration)
console.log(`OUTPUT=${OUT}`)

console.log(`\n${checks}/${checks} checks passed`)
close()
return true

}, { timeoutMs: 45 * 60 * 1000 })
