/**
 * Drives bay over MCP and writes a timestamped log of every call.
 *
 * The log is what makes a real edit possible afterwards: each shot can cut to the moment its
 * call actually landed, rather than to a guess that drifts a second by the end.
 */
import { call, tool, done } from './mcp.mjs'
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs'

const COMPS = '/tmp/bay-demo-comps'
const GSAP = '/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/040091dd-ab41-47c2-a7dd-937a61a97337/scratchpad/spike/gsap.min.js'
mkdirSync(COMPS, { recursive: true })
copyFileSync(GSAP, `${COMPS}/gsap.min.js`)

const FONT = '-apple-system,system-ui,Helvetica,sans-serif'
const t0 = Date.now()
const log = []
const beat = (ms) => new Promise((r) => setTimeout(r, ms))

const say = (text, kind = 'call') => {
  log.push({ at: (Date.now() - t0) / 1000, text, kind })
  console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${text}`)
}

const step = async (label, fn, pause = 1500) => {
  say(label)
  const r = await fn()
  if (r && r.isError) say(`  ✗ ${String(r.value).slice(0, 70)}`, 'error')
  await beat(pause)
  return r && r.isError ? null : r.value
}

const titleHtml = `<!doctype html>
<html data-composition-variables='[
  {"id":"heading","type":"string","label":"Heading","default":"bay"},
  {"id":"sub","type":"string","label":"Subtitle","default":"a video editor your agent can drive"}
]'>
<head><script src="gsap.min.js"></script><style>
  body{margin:0}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
        justify-content:center;gap:26px}
  h1{margin:0;font:700 150px/1 ${FONT};color:#f4f2ec;letter-spacing:-6px}
  p{margin:0;font:400 40px/1 ${FONT};color:#ffb020}
</style></head><body>
<div data-composition-id="open" data-duration="5"
     style="width:1920px;height:1080px;background:#0b0b0f;position:relative;overflow:hidden">
  <div class="wrap"><h1 id="h" data-var-text="heading">bay</h1>
  <p id="s" data-var-text="sub">a video editor your agent can drive</p></div>
</div>
<script>
  var tl = gsap.timeline({ paused: true });
  tl.fromTo('#h', { opacity:0, y:40 }, { opacity:1, y:0, duration:1.1, ease:'power3.out' });
  tl.fromTo('#s', { opacity:0 }, { opacity:1, duration:0.9 }, 0.45);
  window.__timelines['open'] = tl;
</script></body></html>`

const lowerHtml = `<!doctype html>
<html data-composition-variables='[
  {"id":"name","type":"string","label":"Name","default":"Jane Goodall"},
  {"id":"role","type":"string","label":"Role","default":"cut by an agent, in bay"},
  {"id":"accent","type":"color","label":"Accent","default":"#ffb020"}
]'>
<head><script src="gsap.min.js"></script><style>body{margin:0}</style></head><body>
<div data-composition-id="lower" data-duration="6"
     style="width:1920px;height:1080px;position:relative;background:transparent">
  <div id="bar" style="position:absolute;left:104px;bottom:150px;padding:24px 38px;
       background:rgba(14,14,18,.9);border-left:6px solid var(--accent);transform-origin:left center">
    <div data-var-text="name" style="font:600 50px ${FONT};color:#f4f2ec">Jane Goodall</div>
    <div data-var-text="role" style="font:400 30px ${FONT};color:var(--accent);margin-top:8px">role</div>
  </div>
</div>
<script>
  var tl = gsap.timeline({ paused: true });
  tl.fromTo('#bar', { scaleX:0, opacity:0 }, { scaleX:1, opacity:1, duration:0.6, ease:'power3.out' });
  window.__timelines['lower'] = tl;
</script></body></html>`

await call('initialize', {})
await beat(2500)
say('claude code → bay, over MCP', 'head')
await beat(1500)

const clip = await step('import_media  assets/podcast-cut/…/goodall.mp4', () =>
  tool('import_media', { paths: ['/Users/himanshu/codes/synthai/vii/assets/podcast-cut/output/goodall-transcript-cut.mp4'] }), 2200)

writeFileSync(`${COMPS}/open.html`, titleHtml)
const title = await step('write_composition  open.html — a title card, in HTML', () =>
  tool('write_composition', { path: `${COMPS}/open.html`, html: titleHtml }), 2400)

const titleItem = await step('place_asset  at frame 0', () =>
  tool('place_asset', { assetId: title.assetId, atFrame: 0 }), 1800)
await step('edit_item  durationInFrames: 90', () =>
  tool('edit_item', { itemId: titleItem.itemId, durationInFrames: 90 }), 1600)
await step('set_playhead  frame 25', () => tool('set_playhead', { frame: 25 }), 2600)

const item = await step('place_asset  the footage, at frame 90', () =>
  tool('place_asset', { assetId: clip.assets[0].id, atFrame: 90, trackId: titleItem.trackId }), 2000)
await step('edit_item  sourceStartSeconds: 8', () =>
  tool('edit_item', { itemId: item.itemId, sourceStartSeconds: 8 }), 1600)
await step('edit_item  durationInFrames: 270', () =>
  tool('edit_item', { itemId: item.itemId, durationInFrames: 270 }), 1600)

const tr = await step('add_transition  cross-dissolve', () =>
  tool('add_transition', { fromItemId: titleItem.itemId, toItemId: item.itemId, kind: 'cross-dissolve' }), 1600)
if (tr) say(`  → granted ${tr.durationInFrames ?? '?'} frames, ceiling ${tr.maxDurationInFrames}`, 'result')
await step('set_playhead  frame 92 — the dissolve', () => tool('set_playhead', { frame: 92 }), 2800)

writeFileSync(`${COMPS}/lower.html`, lowerHtml)
const lower = await step('write_composition  lower.html — transparent overlay', () =>
  tool('write_composition', { path: `${COMPS}/lower.html`, html: lowerHtml }), 2200)
const track = await step('add_track  video', () => tool('add_track', { kind: 'video' }), 1400)
const lowerItem = await step('place_asset  the lower third, at 150', () =>
  tool('place_asset', { assetId: lower.assetId, atFrame: 150, trackId: track.trackId }), 1800)
await step('set_playhead  frame 200', () => tool('set_playhead', { frame: 200 }), 2600)

await step('edit_item  variables: { name: "Ada Lovelace" }', () =>
  tool('edit_item', { itemId: lowerItem.itemId, variables: { name: 'Ada Lovelace', accent: '#66d9ef' } }), 3000)

say('twelve seconds of video, built by tool call', 'head')
await beat(2500)

writeFileSync('/tmp/calls.json', JSON.stringify(log, null, 2))
console.log(`\nlogged ${log.length} events to /tmp/calls.json`)
done()
