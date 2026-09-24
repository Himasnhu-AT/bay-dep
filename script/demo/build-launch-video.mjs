/**
 * bay's launch video, take two.
 *
 * What was wrong with take one: Claude Code was never on screen, the whole 2880x1800 app was
 * squeezed into 1080p until its text was unreadable, and nothing moved — it read as a
 * slideshow of states.
 *
 * So: a terminal panel carrying the real call log down the left, and shots that punch into the
 * region that is actually changing rather than showing the entire window. Every zoom is a crop
 * plus a layout, which is exactly what those two features are for.
 */
import { call, tool, done } from './mcp.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'

const COMPS = '/tmp/bay-launch'
mkdirSync(COMPS, { recursive: true })
copyFileSync('/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/040091dd-ab41-47c2-a7dd-937a61a97337/scratchpad/spike/gsap.min.js', `${COMPS}/gsap.min.js`)

const FRAME = { w: 1920, h: 1080 }
const FPS = 30
const FONT = '-apple-system,system-ui,Helvetica,sans-serif'

const step = async (label, fn) => {
  const r = await fn()
  const bad = r && r.isError
  console.log(`${bad ? 'FAIL' : ' ok '} ${label}${bad ? `\n       ${String(r.value).slice(0, 170)}` : ''}`)
  return bad ? null : r.value
}

/**
 * A crop, plus the layout that makes the kept region fill the frame.
 *
 * Crop alone shrinks what is kept and leaves it where it was — that is the point of crop. To
 * *zoom*, the box is scaled so the kept region lands at frame size, and shifted so it lands at
 * the origin. The scale is uniform, so a region that is not 16:9 is centred rather than
 * stretched: a squashed screen recording reads as a broken export.
 */
/** The area beside the Claude Code panel. Everything bay-side is framed into this. */
const STAGE = { x: 560, y: 0, w: 1360, h: 1080 }

/**
 * A crop, plus the layout that lands the kept region inside the stage.
 *
 * Crop alone shrinks what is kept and leaves it where it was — that is what crop is for. To
 * *zoom*, the box is scaled so the kept region arrives at stage size and shifted so it lands in
 * the stage. Fitting to the stage rather than the whole frame is the difference between a shot
 * that reads and one that slides under the panel and gets clipped, which is what the first
 * attempt did.
 *
 * The scale is uniform, so a region that is not the stage's shape is centred rather than
 * stretched: a squashed screen recording reads as a broken export, not as a crop.
 */
function shot(region) {
  const { left, top, right, bottom } = region
  const keptW = 1 - left - right
  const keptH = 1 - top - bottom
  // How big the whole source must be for the kept part to fill the stage.
  const scale = Math.min(STAGE.w / (FRAME.w * keptW), STAGE.h / (FRAME.h * keptH))
  const width = Math.round(FRAME.w * scale)
  const height = Math.round(FRAME.h * scale)
  const keptPxW = width * keptW
  const keptPxH = height * keptH
  return {
    crop: { left, top, right, bottom },
    x: Math.round(STAGE.x + (STAGE.w - keptPxW) / 2 - width * left),
    y: Math.round(STAGE.y + (STAGE.h - keptPxH) / 2 - height * top),
    width,
    height
  }
}

const WIDE = { left: 0, top: 0, right: 0, bottom: 0 }
// Regions live right of the terminal panel, which covers the left 760px (0.396).
const PREVIEW = { left: 0.30, top: 0.05, right: 0.19, bottom: 0.35 }
const TIMELINE = { left: 0.30, top: 0.68, right: 0.005, bottom: 0.05 }
const INSPECTOR = { left: 0.79, top: 0.05, right: 0.005, bottom: 0.32 }

// Source seconds are footage time; the recorder led the driver by 1.5s.
const SHOTS = [
  // Zooms are timed onto moments that have something in them. A punch into the preview while
  // it holds a dark title card is a punch into black, which is how take one read.
  { from: 2.0, to: 6.4, region: WIDE },        // empty app, first two calls arrive
  { from: 6.4, to: 10.4, region: TIMELINE },   // the title clip lands
  { from: 10.4, to: 13.6, region: WIDE },      // trimmed, playhead moves
  { from: 13.6, to: 17.2, region: TIMELINE },  // the footage lands beside it, filmstrip and all
  { from: 17.2, to: 20.4, region: WIDE },
  { from: 20.4, to: 24.2, region: TIMELINE },  // the transition marker appears on the cut
  { from: 24.2, to: 27.6, region: PREVIEW },   // the dissolve, mid-flight
  { from: 27.6, to: 31.0, region: WIDE },      // the lower third goes on its own track
  { from: 31.0, to: 33.6, region: PREVIEW },   // the composite
  { from: 33.6, to: 36.2, region: INSPECTOR }, // the variables being set
  { from: 36.2, to: 39.4, region: PREVIEW }    // and the picture changing because of it
]

const titleHtml = `<!doctype html>
<html><head><style>
  body{margin:0}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
        justify-content:center;gap:30px}
  h1{margin:0;font:700 176px/1 ${FONT};color:#f4f2ec;letter-spacing:-8px}
  p{margin:0;font:400 44px/1 ${FONT};color:#ffb020}
  .rule{width:120px;height:3px;background:#ffb020;opacity:.5}
</style></head><body>
<div data-composition-id="title" data-duration="5"
     style="width:1920px;height:1080px;background:#09090c;position:relative;overflow:hidden">
  <div class="wrap">
    <h1 id="h">bay</h1><div class="rule" id="r"></div>
    <p id="s">a video editor your agent can drive</p>
  </div>
</div>
<script>
  window.__timelines['title'] = { time: function (t) {
    if (t === undefined) return 0
    var k = function (a, b) { return Math.max(0, Math.min(1, (t - a) / b)) }
    var h = document.getElementById('h'), r = document.getElementById('r'), s = document.getElementById('s')
    var e = function (x) { return 1 - Math.pow(1 - x, 3) }
    h.style.opacity = e(k(0, 0.9)); h.style.transform = 'translateY(' + (34 - 34 * e(k(0, 0.9))) + 'px)'
    r.style.transform = 'scaleX(' + e(k(0.35, 0.7)) + ')'
    s.style.opacity = e(k(0.6, 0.8))
    return this
  }, duration: function () { return 5 } }
</script></body></html>`

const endHtml = `<!doctype html>
<html><head><style>
  body{margin:0}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
        justify-content:center;gap:24px;text-align:center}
  h2{margin:0;font:600 72px/1.2 ${FONT};color:#f4f2ec;letter-spacing:-2.5px;max-width:1450px}
  p{margin:0;font:400 32px/1 ${FONT};color:#ffb020}
  code{font:500 27px/1 ui-monospace,SFMono-Regular,monospace;color:#70707c}
</style></head><body>
<div data-composition-id="end" data-duration="6"
     style="width:1920px;height:1080px;background:#09090c;position:relative;overflow:hidden">
  <div class="wrap">
    <h2 id="h">Every frame of this was made<br/>by tool call.</h2>
    <p id="p">bay — a video editor your agent can drive</p>
    <code id="c">the title, the captions and this card are HTML</code>
  </div>
</div>
<script>
  window.__timelines['end'] = { time: function (t) {
    if (t === undefined) return 0
    var k = function (a, b) { return Math.max(0, Math.min(1, (t - a) / b)) }
    var e = function (x) { return 1 - Math.pow(1 - x, 3) }
    var h = document.getElementById('h'), p = document.getElementById('p'), c = document.getElementById('c')
    h.style.opacity = e(k(0, 0.9)); h.style.transform = 'translateY(' + (26 - 26 * e(k(0, 0.9))) + 'px)'
    p.style.opacity = e(k(0.45, 0.8)); c.style.opacity = e(k(0.8, 0.8))
    return this
  }, duration: function () { return 6 } }
</script></body></html>`

require('node:fs').writeFileSync(`${COMPS}/title.html`, titleHtml)
require('node:fs').writeFileSync(`${COMPS}/end.html`, endHtml)

await call('initialize', {})
console.log('\nbuilding the launch cut\n')

const footage = await step('import the shoot', () =>
  tool('import_media', { paths: ['/tmp/shoot.mp4'] }))
const title = await step('write the title', () =>
  tool('write_composition', { path: `${COMPS}/title.html`, html: titleHtml }))
const terminal = await step('write the claude code panel', () =>
  tool('write_composition', { path: `${COMPS}/terminal.html`, html: readFileSync(`${COMPS}/terminal.html`, 'utf8') }))
const end = await step('write the end card', () =>
  tool('write_composition', { path: `${COMPS}/end.html`, html: endHtml }))

const TITLE_FRAMES = 90
const titleItem = await step('place the title', () =>
  tool('place_asset', { assetId: title.assetId, atFrame: 0 }))
await step('trim the title', () =>
  tool('edit_item', { itemId: titleItem.itemId, durationInFrames: TITLE_FRAMES }))

// --- the shots, back to back on V1 -------------------------------------------------------
let at = TITLE_FRAMES
let first = null
for (const [i, s] of SHOTS.entries()) {
  const frames = Math.round((s.to - s.from) * FPS)
  const geo = shot(s.region)
  const placed = await step(`shot ${i + 1}: ${s.from}s–${s.to}s`, () =>
    tool('place_asset', { assetId: footage.assets[0].id, atFrame: at, trackId: titleItem.trackId }))
  if (!placed) continue
  if (!first) first = placed
  await step(`  frame it`, () =>
    tool('edit_item', {
      itemId: placed.itemId,
      sourceStartSeconds: s.from,
      durationInFrames: frames,
      left: geo.x, top: geo.y, width: geo.width, height: geo.height,
      ...(s.region === WIDE ? {} : { crop: geo.crop })
    }))
  at += frames
}

const SHOT_START = TITLE_FRAMES
const SHOT_END = at

await step('dissolve from the title into the first shot', () =>
  tool('add_transition', { fromItemId: titleItem.itemId, toItemId: first.itemId, kind: 'cross-dissolve' }))

// --- the terminal panel, spanning every shot ---------------------------------------------
const track = await step('add the overlay track', () => tool('add_track', { kind: 'video' }))
const termItem = await step('place the claude code panel over all of it', () =>
  tool('place_asset', { assetId: terminal.assetId, atFrame: SHOT_START, trackId: track.trackId }))
await step('  align it to footage time', () =>
  tool('edit_item', {
    itemId: termItem.itemId,
    sourceStartSeconds: SHOTS[0].from,
    durationInFrames: SHOT_END - SHOT_START
  }))

const endItem = await step('place the end card', () =>
  tool('place_asset', { assetId: end.assetId, atFrame: SHOT_END, trackId: titleItem.trackId }))
await step('trim the end card', () =>
  tool('edit_item', { itemId: endItem.itemId, durationInFrames: 120 }))

const proj = await tool('read_project')
console.log('\n--- cut ---')
for (const t of proj.value.tracks) {
  console.log(` ${t.name.padEnd(3)} ${t.items.length} item(s)`)
}
console.log(`duration ${proj.value.timeline.durationInFrames} frames  (${(proj.value.timeline.durationInFrames / FPS).toFixed(1)}s)`)
done()
