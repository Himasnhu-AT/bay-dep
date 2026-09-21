/**
 * The take: an agent building a video in bay over MCP, paced so a person can follow it.
 *
 * Each beat pauses long enough to be read on screen. That pacing is the only thing here that
 * exists for the camera — every call is a real tool call against the running editor.
 */
import { call, tool, done } from './mcp.mjs'
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs'

const REPO = '/Users/himanshu/codes/synthai/vii'
const FOOTAGE = `${REPO}/assets/podcast-cut/output/goodall-transcript-cut.mp4`
const COMPS = '/tmp/bay-demo-comps'
const GSAP = process.env.GSAP ?? `${REPO}/script/demo/gsap.min.js`
mkdirSync(COMPS, { recursive: true })
copyFileSync(GSAP, `${COMPS}/gsap.min.js`)

const beat = (ms = 1400) => new Promise((r) => setTimeout(r, ms))
const step = async (label, fn, pause = 1400) => {
  process.stdout.write(`  ${label} ... `)
  const r = await fn()
  console.log(r && r.isError ? 'FAIL' : 'ok')
  await beat(pause)
  return r && r.isError ? null : r.value
}

const titleHtml = `<!doctype html>
<html><head><script src="gsap.min.js"></script><style>
  body{margin:0}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:26px}
  h1{margin:0;font:700 150px/1 -apple-system,system-ui,sans-serif;color:#f4f2ec;letter-spacing:-6px}
  p{margin:0;font:400 40px/1 -apple-system,system-ui,sans-serif;color:#ffb020}
</style></head><body>
<div data-composition-id="open" data-duration="4"
     style="width:1920px;height:1080px;background:#0e0e12;position:relative;overflow:hidden">
  <div class="wrap"><h1 id="h">bay</h1><p id="s">a video editor your agent can drive</p></div>
</div>
<script>
  var tl = gsap.timeline({ paused: true });
  tl.fromTo('#h', { opacity:0, y:40 }, { opacity:1, y:0, duration:1.1, ease:'power3.out' });
  tl.fromTo('#s', { opacity:0 }, { opacity:1, duration:0.9 }, 0.45);
  window.__timelines['open'] = tl;
</script></body></html>`

const lowerHtml = `<!doctype html>
<html><head><script src="gsap.min.js"></script><style>body{margin:0}</style></head><body>
<div data-composition-id="lower" data-duration="6"
     style="width:1920px;height:1080px;position:relative;overflow:hidden;background:transparent">
  <div id="bar" style="position:absolute;left:104px;bottom:150px;padding:24px 38px;
       background:rgba(14,14,18,.9);border-left:6px solid #ffb020;transform-origin:left center">
    <div style="font:600 50px -apple-system,system-ui,sans-serif;color:#f4f2ec">Jane Goodall</div>
    <div style="font:400 30px -apple-system,system-ui,sans-serif;color:#ffb020;margin-top:8px">
      cut by an agent, in bay</div>
  </div>
</div>
<script>
  var tl = gsap.timeline({ paused: true });
  tl.fromTo('#bar', { scaleX:0, opacity:0 }, { scaleX:1, opacity:1, duration:0.65, ease:'power3.out' });
  tl.to('#bar', { opacity:0, duration:0.5 }, 4.7);
  window.__timelines['lower'] = tl;
</script></body></html>`

await call('initialize', {})
await beat(2200)

console.log('\nan agent builds a video in bay, over MCP\n')

const clip = await step('import_media  — the footage', () =>
  tool('import_media', { paths: [FOOTAGE] }))

writeFileSync(`${COMPS}/open.html`, titleHtml)
const open = await step('write_composition  — a title card, as HTML', () =>
  tool('write_composition', { path: `${COMPS}/open.html`, html: titleHtml }), 1800)

const title = await step('place_asset  — the title at frame 0', () =>
  tool('place_asset', { assetId: open.assetId, atFrame: 0 }))
await step('edit_item  — trim it, keeping a handle', () =>
  tool('edit_item', { itemId: title.itemId, durationInFrames: 90 }))
await step('set_playhead  — look at it', () => tool('set_playhead', { frame: 25 }), 2400)

const item = await step('place_asset  — the footage after it', () =>
  tool('place_asset', { assetId: clip.assets[0].id, atFrame: 90, trackId: title.trackId }))
await step('edit_item  — start 8s into the source', () =>
  tool('edit_item', { itemId: item.itemId, sourceStartSeconds: 8 }))
await step('edit_item  — hold nine seconds', () =>
  tool('edit_item', { itemId: item.itemId, durationInFrames: 270 }))

const tr = await step('add_transition  — dissolve across the cut', () =>
  tool('add_transition', { fromItemId: title.itemId, toItemId: item.itemId, kind: 'cross-dissolve' }))
if (tr) console.log(`      granted ${tr.durationInFrames ?? '?'} frames, ceiling ${tr.maxDurationInFrames}`)
await step('set_playhead  — watch the dissolve', () => tool('set_playhead', { frame: 92 }), 2400)

writeFileSync(`${COMPS}/lower.html`, lowerHtml)
const lower = await step('write_composition  — a lower third, transparent', () =>
  tool('write_composition', { path: `${COMPS}/lower.html`, html: lowerHtml }), 1800)
const track = await step('add_track  — a layer above', () => tool('add_track', { kind: 'video' }))
await step('place_asset  — the lower third over the footage', () =>
  tool('place_asset', { assetId: lower.assetId, atFrame: 150, trackId: track.trackId }))
await step('set_playhead  — the composite', () => tool('set_playhead', { frame: 200 }), 3000)

await step('set_playhead  — and again, later', () => tool('set_playhead', { frame: 260 }), 2600)

console.log('\n  twelve seconds of video, built by tool call.\n')
await beat(2500)
done()
