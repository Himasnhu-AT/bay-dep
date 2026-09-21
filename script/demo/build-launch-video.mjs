/**
 * bay's launch video, built in bay, from a recording of bay being built in bay.
 *
 * Every graphic is an HTML composition. The captions are ONE composition placed five times
 * with different values — which is the variables feature demonstrating itself inside the video
 * that is selling it.
 */
import { call, tool, done } from './mcp.mjs'
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs'

const COMPS = '/tmp/bay-launch'
const GSAP = '/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/040091dd-ab41-47c2-a7dd-937a61a97337/scratchpad/spike/gsap.min.js'
mkdirSync(COMPS, { recursive: true })
copyFileSync(GSAP, `${COMPS}/gsap.min.js`)

const step = async (label, fn) => {
  const r = await fn()
  const bad = r && r.isError
  console.log(`${bad ? 'FAIL' : ' ok '} ${label}${bad ? `\n       ${String(r.value).slice(0, 190)}` : ''}`)
  return bad ? null : r.value
}

const FONT = '-apple-system,system-ui,Helvetica,sans-serif'

const titleHtml = `<!doctype html>
<html data-composition-variables='[
  {"id":"heading","type":"string","label":"Heading","default":"bay"},
  {"id":"sub","type":"string","label":"Subtitle","default":"a video editor your agent can drive"},
  {"id":"accent","type":"color","label":"Accent","default":"#ffb020"}
]'>
<head><script src="gsap.min.js"></script><style>
  body{margin:0}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
        justify-content:center;gap:28px}
  h1{margin:0;font:700 168px/1 ${FONT};color:#f4f2ec;letter-spacing:-7px}
  p{margin:0;font:400 42px/1 ${FONT};color:var(--accent)}
</style></head><body>
<div data-composition-id="title" data-duration="5"
     style="width:1920px;height:1080px;background:#0b0b0f;position:relative;overflow:hidden">
  <div class="wrap">
    <h1 id="h" data-var-text="heading">bay</h1>
    <p id="s" data-var-text="sub">a video editor your agent can drive</p>
  </div>
</div>
<script>
  var tl = gsap.timeline({ paused: true });
  tl.fromTo('#h', { opacity:0, y:44 }, { opacity:1, y:0, duration:1.2, ease:'power3.out' });
  tl.fromTo('#s', { opacity:0 }, { opacity:1, duration:0.9 }, 0.5);
  window.__timelines['title'] = tl;
</script></body></html>`

// One caption composition, five placements, five different strings.
const captionHtml = `<!doctype html>
<html data-composition-variables='[
  {"id":"text","type":"string","label":"Caption","default":"a tool call"},
  {"id":"accent","type":"color","label":"Accent","default":"#ffb020"},
  {"id":"inset","type":"number","label":"Inset","default":96,"min":0,"max":600,"step":8,"unit":"px"}
]'>
<head><script src="gsap.min.js"></script><style>body{margin:0}</style></head><body>
<div data-composition-id="caption" data-duration="5"
     style="width:1920px;height:1080px;position:relative;background:transparent;overflow:hidden">
  <div id="c" style="position:absolute;left:var(--inset);bottom:84px;padding:20px 30px;
       background:rgba(10,10,14,.9);border-left:5px solid var(--accent);transform-origin:left center">
    <span data-var-text="text"
          style="font:500 38px ${FONT};color:#f4f2ec;letter-spacing:-0.5px">a tool call</span>
  </div>
</div>
<script>
  var tl = gsap.timeline({ paused: true });
  tl.fromTo('#c', { scaleX:0, opacity:0 }, { scaleX:1, opacity:1, duration:0.5, ease:'power3.out' });
  tl.to('#c', { opacity:0, duration:0.4 }, 4.4);
  window.__timelines['caption'] = tl;
</script></body></html>`

const endHtml = `<!doctype html>
<html><head><script src="gsap.min.js"></script><style>
  body{margin:0}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
        justify-content:center;gap:22px;text-align:center}
  h2{margin:0;font:600 76px/1.15 ${FONT};color:#f4f2ec;letter-spacing:-3px;max-width:1400px}
  p{margin:0;font:400 34px/1 ${FONT};color:#ffb020}
  code{font:500 30px/1 ui-monospace,SFMono-Regular,monospace;color:#8a8a96}
</style></head><body>
<div data-composition-id="end" data-duration="6"
     style="width:1920px;height:1080px;background:#0b0b0f;position:relative;overflow:hidden">
  <div class="wrap">
    <h2 id="h">This video was cut by an agent,<br/>in the editor it is announcing.</h2>
    <p id="p">bay</p>
    <code id="c">every graphic here is HTML</code>
  </div>
</div>
<script>
  var tl = gsap.timeline({ paused: true });
  tl.fromTo('#h', { opacity:0, y:30 }, { opacity:1, y:0, duration:1, ease:'power3.out' });
  tl.fromTo('#p', { opacity:0 }, { opacity:1, duration:0.8 }, 0.5);
  tl.fromTo('#c', { opacity:0 }, { opacity:1, duration:0.8 }, 0.9);
  window.__timelines['end'] = tl;
</script></body></html>`

await call('initialize', {})
console.log('\nbuilding bay\'s launch video, in bay\n')

writeFileSync(`${COMPS}/title.html`, titleHtml)
writeFileSync(`${COMPS}/caption.html`, captionHtml)
writeFileSync(`${COMPS}/end.html`, endHtml)

const footage = await step('import the recording of bay being driven',
  () => tool('import_media', { paths: ['/tmp/making-of.mp4'] }))
const title = await step('write the title card',
  () => tool('write_composition', { path: `${COMPS}/title.html`, html: titleHtml }))
const caption = await step('write one caption composition',
  () => tool('write_composition', { path: `${COMPS}/caption.html`, html: captionHtml }))
const end = await step('write the end card',
  () => tool('write_composition', { path: `${COMPS}/end.html`, html: endHtml }))

// --- V1: title -> footage -> end card ---------------------------------------------------
const titleItem = await step('place the title', () =>
  tool('place_asset', { assetId: title.assetId, atFrame: 0 }))
await step('trim it to 4s, keeping a handle', () =>
  tool('edit_item', { itemId: titleItem.itemId, durationInFrames: 120 }))

const clip = await step('place the recording after it', () =>
  tool('place_asset', { assetId: footage.assets[0].id, atFrame: 120, trackId: titleItem.trackId }))
await step('start half a second in, so the cut has a handle', () =>
  tool('edit_item', { itemId: clip.itemId, sourceStartSeconds: 0.5 }))
await step('hold 33 seconds of it', () =>
  tool('edit_item', { itemId: clip.itemId, durationInFrames: 990 }))

const tr = await step('dissolve into the recording', () =>
  tool('add_transition', { fromItemId: titleItem.itemId, toItemId: clip.itemId, kind: 'cross-dissolve' }))
if (tr) console.log(`       ${tr.durationInFrames ?? '?'} frames, ceiling ${tr.maxDurationInFrames}`)

const endItem = await step('place the end card', () =>
  tool('place_asset', { assetId: end.assetId, atFrame: 1110, trackId: titleItem.trackId }))
await step('trim the end card to 4s', () =>
  tool('edit_item', { itemId: endItem.itemId, durationInFrames: 120 }))
await step('dissolve out to it', () =>
  tool('add_transition', { fromItemId: clip.itemId, toItemId: endItem.itemId, kind: 'cross-dissolve' }))

// --- V2: five captions, one composition -------------------------------------------------
const track = await step('add a caption track', () => tool('add_track', { kind: 'video' }))

const captions = [
  [180, 'import_media — the footage'],
  [330, 'write_composition — a title card, written as HTML'],
  [510, 'place_asset, edit_item — trim it, keep a handle'],
  [690, 'add_transition — dissolve across the cut'],
  [900, 'one composition, five captions, five values']
]
for (const [at, text] of captions) {
  const item = await step(`caption at ${at}: "${String(text).slice(0, 38)}…"`, () =>
    tool('place_asset', { assetId: caption.assetId, atFrame: at, trackId: track.trackId }))
  if (!item) continue
  await step('  set its text', () =>
    tool('edit_item', { itemId: item.itemId, durationInFrames: 140, variables: { text } }))
}

const proj = await tool('read_project')
console.log('\n--- launch timeline ---')
for (const t of proj.value.tracks) {
  console.log(` ${t.name.padEnd(3)} ${t.items.map((i) => `${i.from}..${i.from + i.durationInFrames}`).join('  ') || '(empty)'}`)
}
console.log(`duration ${proj.value.timeline.durationInFrames} frames`)
done()
