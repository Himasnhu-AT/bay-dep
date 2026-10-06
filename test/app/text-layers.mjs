/**
 * UNRUN. Written with the text paint stack and the animation presets and never executed: the
 * wave that added them was not allowed to launch the app. Treat the first run as a test of this
 * probe as much as of the code — and break something on purpose (the mutations at the bottom)
 * before trusting a green.
 *
 * Does a title's paint stack reach pixels, and does an animation preset move them — in the frame
 * `preview_frame` returns and the frame the compositor draws, which are the export's own?
 *
 * `src/renderer/src/engine/textPaint.test.ts` proves the *calls* the painter makes (order, widths,
 * which glyphs). It cannot prove what Chromium rasterises from them. This is that half:
 *
 *   - a gradient's first stop is at the top of the letters and its last at the bottom
 *   - a hollow title has less ink than a filled one; a second outline lands outside the first
 *   - a shadow with no outline is cast at all, and by its offset
 *   - a shadow is the same share of the picture at half scale (canvas shadows ignore the transform)
 *   - a per-line plate leaves the gap beside a short line unpainted
 *   - a fade-in is black at the head and whole after it; a slide starts a quarter-box away; a
 *     wipe shows the near half first; a typewriter's ink grows left to right; a rise is masked
 *   - a preset multiplies a keyed opacity rather than replacing it
 *
 * Every check is directional and derived from a baseline measured in the same run — "more red at
 * the top than the bottom", never "equals #FF0000" — and each negative has its positive beside it.
 *
 * A text asset needs no file, so this imports nothing, edits nothing in the open project and
 * saves nothing: every frame is drawn from a project built in the page.
 *
 *   ./run.sh && node test/app/text-layers.mjs
 */

import { attach, runProbe } from './cdp.mjs'

const { evaluate, close } = await attach()

const HELPERS = `
  window.__tl = window.__tl || {}
  __tl.W = 1280; __tl.H = 720
  __tl.project = (text, style, extra, box) => {
    const st = window.bayEngine.store.getState()
    const base = st.project.timelines.find((t) => t.id === st.project.activeTimelineId)
    const b = box || { left: 240, top: 210, width: 800, height: 300 }
    const asset = { id: 'tl_txt', kind: 'text', name: 'title', path: null, durationUs: 0, width: null, height: null,
      fps: null, hasAudio: false, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0, text }
    const item = { id: 'tl_itm', assetId: 'tl_txt', trackId: 'tl_v', from: 0, durationInFrames: 60, sourceStartUs: 0,
      layout: { left: b.left, top: b.top, width: b.width, height: b.height, opacity: 1, rotation: 0 },
      volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, text: style, ...(extra || {}) }
    const timeline = { ...base, width: __tl.W, height: __tl.H, fps: 30, background: '#000000', transitions: [],
      tracks: [{ id: 'tl_v', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [item] }] }
    return { project: { ...st.project, assets: [asset], timelines: [timeline], activeTimelineId: timeline.id }, timeline }
  }
  // Ink statistics of one frame: the lit bounding box, the mean colour of the lit pixels overall
  // and in each quarter of the box, and how many pixels are mostly one primary.
  __tl.stats = (d, w, h) => {
    let lit = 0, minX = w, maxX = -1, minY = h, maxY = -1, sum = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const v = d[i] + d[i + 1] + d[i + 2]
      sum += v
      if (v > 48) { lit++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    }
    const mean = (x0, x1, y0, y1) => {
      let r = 0, g = 0, b = 0, n = 0
      for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        const i = (y * w + x) * 4
        if (d[i] + d[i + 1] + d[i + 2] > 48) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++ }
      }
      return n ? { r: r / n, g: g / n, b: b / n, n } : { r: 0, g: 0, b: 0, n: 0 }
    }
    const midY = Math.round((minY + maxY) / 2), midX = Math.round((minX + maxX) / 2)
    let red = 0, green = 0, blue = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90) red++
      if (d[i + 1] > 150 && d[i] < 90 && d[i + 2] < 90) green++
      if (d[i + 2] > 150 && d[i] < 90 && d[i + 1] < 90) blue++
    }
    return lit === 0 ? { lit: 0, energy: 0, red, green, blue } : {
      lit, energy: sum / (w * h), minX, maxX, minY, maxY, red, green, blue,
      top: mean(minX, maxX, minY, midY), bottom: mean(minX, maxX, midY, maxY),
      left: mean(minX, midX, minY, maxY), right: mean(midX, maxX, minY, maxY)
    }
  }
  // Drawn by the compositor straight onto a canvas at 'scale' of the timeline — the preview's path.
  __tl.draw = (text, style, frame, extra, box, scale) => {
    const k = scale || 1
    const { project, timeline } = __tl.project(text, style, extra, box)
    const c = document.createElement('canvas')
    c.width = Math.round(__tl.W * k); c.height = Math.round(__tl.H * k)
    const x = c.getContext('2d', { willReadFrequently: true })
    x.scale(k, k)
    const stats = window.bayEngine.engine.compositor.drawFrame(x, project, timeline, frame || 0, { mode: 'scrub' })
    const d = x.getImageData(0, 0, c.width, c.height).data
    const out = { ...__tl.stats(d, c.width, c.height), fit: stats.textFits[0] || null, pending: stats.pending }
    c.width = 0
    return out
  }
  // The same frame through renderFrame — what preview_frame returns and the exporter draws from.
  __tl.render = async (text, style, frame, extra) => {
    const { project } = __tl.project(text, style, extra)
    const r = await window.bayEngine.renderFrame({ project, timelineId: project.activeTimelineId, frame: frame || 0, maxSize: __tl.W })
    const img = new Image(); img.src = r.dataUrl; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height)
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    return { ...__tl.stats(x.getImageData(0, 0, img.width, img.height).data, img.width, img.height), w: img.width }
  }
  true
`

await runProbe(async () => {
  await evaluate(HELPERS)
  let bad = 0
  const check = (ok, label, detail = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
    if (!ok) bad += 1
  }
  const style = (over) => ({
    fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 160, fontWeight: 800, italic: false, color: '#FFFFFF',
    align: 'center', verticalAlign: 'middle', lineHeight: 1.2, letterSpacing: 0, stroke: null, shadow: null, background: null, ...over
  })
  const draw = (text, s, frame = 0, extra = null, box = null, scale = 1) =>
    evaluate(`__tl.draw(${JSON.stringify(text)}, ${JSON.stringify(s)}, ${frame}, ${JSON.stringify(extra)}, ${JSON.stringify(box)}, ${scale})`)
  const box = (m) => `x ${m.minX}..${m.maxX} y ${m.minY}..${m.maxY} lit ${m.lit}`

  const plain = await draw('HELLO', style({}))
  check(plain.lit > 5000 && plain.pending === 0, 'baseline: a plain title draws', box(plain))

  // -- fills -------------------------------------------------------------------------------------
  const stops = [{ at: 0, color: '#FF0000' }, { at: 1, color: '#0000FF' }]
  const down = await draw('HELLO', style({ fills: [{ kind: 'linear', angle: 90, stops }] }))
  check(down.top.r > down.top.b + 40 && down.bottom.b > down.bottom.r + 40, 'a 90° gradient is its first stop at the top and its last at the bottom',
    `top R ${down.top.r.toFixed(0)} B ${down.top.b.toFixed(0)}, bottom R ${down.bottom.r.toFixed(0)} B ${down.bottom.b.toFixed(0)}`)
  const across = await draw('HELLO', style({ fills: [{ kind: 'linear', angle: 0, stops }] }))
  check(across.left.r > across.left.b + 40 && across.right.b > across.right.r + 40 && Math.abs(across.top.r - across.bottom.r) < 30,
    'a 0° gradient runs left to right instead, and not top to bottom', `left R ${across.left.r.toFixed(0)}, right B ${across.right.b.toFixed(0)}`)
  check(Math.abs(down.lit - plain.lit) / plain.lit < 0.03, 'a gradient fills the same letters a colour does', `${down.lit} vs ${plain.lit}`)

  const outlined = await draw('HELLO', style({ stroke: { color: '#FFFFFF', width: 6 } }))
  const hollow = await draw('HELLO', style({ fills: [], stroke: { color: '#FFFFFF', width: 6 } }))
  check(hollow.lit > 500 && hollow.lit < outlined.lit * 0.75, 'a hollow title draws its outline and not its inside', `${hollow.lit} vs filled ${outlined.lit}`)

  const lifted = await draw('HELLO', style({ fills: [{ kind: 'solid', color: '#FF0000', offsetX: 12, offsetY: 16 }, { kind: 'solid', color: '#FFFFFF' }] }))
  check(lifted.red > 500 && lifted.maxY - plain.maxY >= 12 && lifted.maxX - plain.maxX >= 8 && lifted.minY === plain.minY,
    'an offset fill under the face shows below and to the right of it only', `red ${lifted.red}, bottom +${lifted.maxY - plain.maxY}, top +${plain.minY - lifted.minY}`)

  // -- outlines ----------------------------------------------------------------------------------
  const single = await draw('HELLO', style({ stroke: { color: '#FF0000', width: 12 } }))
  const double = await draw('HELLO', style({ stroke: { color: '#FF0000', width: 12 }, strokes: [{ color: '#00FF00', width: 16 }] }))
  check(single.green === 0 && double.green > 500 && double.red > 500, 'a second outline adds its colour and keeps the first', `green ${double.green}, red ${double.red}`)
  check(single.minX - double.minX >= 6 && single.minX - double.minX <= 10, 'and it lands outside the first, by half its width',
    `left edge ${single.minX} -> ${double.minX}`)

  // -- shadows -----------------------------------------------------------------------------------
  const shadow = { color: '#00FF00', blur: 0, offsetX: 0, offsetY: 30 }
  const cast = await draw('HELLO', style({ shadow }))
  check(cast.green > 500, 'a shadow with no outline is cast (it was not, before the stack)', `green ${cast.green}`)
  check(Math.abs(cast.maxY - plain.maxY - 30) <= 2 && cast.minY === plain.minY, 'by its offset, downward only', `bottom +${cast.maxY - plain.maxY}`)
  check(plain.green === 0, 'control: with no shadow there is no green at all')
  const half = await draw('HELLO', style({ shadow }), 0, null, null, 0.5)
  const halfPlain = await draw('HELLO', style({}), 0, null, null, 0.5)
  check(Math.abs(half.maxY - halfPlain.maxY - 15) <= 2, 'at half scale the shadow is half as long: the same share of the picture',
    `+${half.maxY - halfPlain.maxY}px at 0.5x (30px at 1x)`)

  const glow1 = await draw('HELLO', style({ glow: { color: '#00FF00', blur: 30 } }))
  const glow3 = await draw('HELLO', style({ glow: { color: '#00FF00', blur: 30, strength: 3 } }))
  check(plain.minX - glow1.minX >= 8 && glow1.maxY - plain.maxY >= 8 && plain.minY - glow1.minY >= 8, 'a glow spreads on every side', box(glow1))
  check(glow3.energy > glow1.energy * 1.05, 'and more layers of it is more light', `${glow1.energy.toFixed(2)} -> ${glow3.energy.toFixed(2)}`)

  // -- plates ------------------------------------------------------------------------------------
  const twoLines = 'HI\nMUCH LONGER'
  const plateStyle = (plate) => style({ fontSize: 80, color: '#FFFFFF', background: { color: '#0000FF', padding: 10, radius: 0 }, ...(plate ? { plate } : {}) })
  const block = await draw(twoLines, plateStyle(null))
  const perLine = await draw(twoLines, plateStyle({ perLine: true }))
  check(block.blue > 2000 && perLine.blue > 1000 && perLine.blue < block.blue * 0.85, 'a plate per line paints less than one block: the gap beside the short line is left',
    `block ${block.blue}, per line ${perLine.blue}`)
  check(Math.abs(block.minX - perLine.minX) <= 2 && Math.abs(block.maxX - perLine.maxX) <= 2, 'and the long line\'s bar is as wide as the block was')

  // -- the fit report ------------------------------------------------------------------------------
  const tight = { left: 0, top: 260, width: 1280, height: 200 }
  const edge = await draw('HELLO', style({ align: 'left', stroke: { color: '#FF0000', width: 40 } }), 0, null, tight)
  check(edge.fit?.paintOverflow?.left > 15, 'paint that crosses the box is reported, with how far', JSON.stringify(edge.fit?.paintOverflow ?? null))
  check(plain.fit && plain.fit.paintOverflow === undefined, 'control: a plain title in a roomy box reports none')

  // -- animation presets ---------------------------------------------------------------------------
  const rest = await draw('HELLO', style({}), 30)
  const fade = { animation: { in: { kind: 'fade', frames: 20 } } }
  const fade0 = await draw('HELLO', style({}), 0, fade)
  const fade10 = await draw('HELLO', style({}), 10, fade)
  const fade20 = await draw('HELLO', style({}), 20, fade)
  check(fade0.lit === 0 && fade10.energy > 0 && fade10.energy < rest.energy * 0.95 && Math.abs(fade20.energy - rest.energy) < rest.energy * 0.01,
    'fade in: nothing at the head, partly there mid-way, whole when it ends', `${fade0.energy.toFixed(2)} / ${fade10.energy.toFixed(2)} / ${fade20.energy.toFixed(2)} of ${rest.energy.toFixed(2)}`)

  const slide = { animation: { in: { kind: 'slide', frames: 20, from: 'right' } } }
  const slide1 = await draw('HELLO', style({}), 1, slide)
  const slide20 = await draw('HELLO', style({}), 20, slide)
  check(slide1.lit > 0 && slide1.minX - rest.minX > 100 && slide1.minX - rest.minX <= 200, 'slide from the right starts up to a quarter of its box to the right',
    `left edge ${slide1.minX} vs ${rest.minX} at rest`)
  check(slide20.minX === rest.minX && slide20.maxX === rest.maxX, 'and is home when the In ends')

  const wipe = { animation: { in: { kind: 'wipe', frames: 20 } } }
  const wipe10 = await draw('HELLO', style({}), 10, wipe)
  // The top is compared within a round letter's overshoot: half way through, "HEL" is showing and
  // the O is not, and an O stands a few pixels above a flat capital (measured: 340 against 336).
  check(wipe10.minX === rest.minX && wipe10.maxX < rest.maxX - 50 && Math.abs(wipe10.minY - rest.minY) <= 6, 'a wipe from the left shows the left of the title first, and moves nothing',
    `right edge ${wipe10.maxX} of ${rest.maxX}, top ${wipe10.minY} vs ${rest.minY}`)

  const type = { animation: { in: { kind: 'typewriter', frames: 20 } } }
  const typed = []
  for (const frame of [0, 5, 10, 15, 20]) typed.push(await draw('HELLO', style({}), frame, type))
  const edges = typed.map((m) => (m.lit === 0 ? -1 : m.maxX))
  check(edges[0] === -1 && edges.every((x, i) => i === 0 || x >= edges[i - 1]) && edges[4] === rest.maxX && edges[1] < edges[3],
    'a typewriter\'s ink grows left to right, from nothing to the whole word', edges.join(' -> '))
  check(typed[2].minX === rest.minX, 'and the letters already typed are where the whole word has them', `${typed[2].minX} vs ${rest.minX}`)

  const rise = { animation: { in: { kind: 'rise', frames: 20, by: 'line' } } }
  const rise4 = await draw('HELLO', style({}), 4, rise)
  check(rise4.lit > 0 && rise4.lit < rest.lit * 0.9 && rise4.minY > rest.minY, 'a rise by line shows only what has come up through the line\'s mask',
    `${rise4.lit} of ${rest.lit} lit, top ${rise4.minY} vs ${rest.minY}`)

  const keyed = { keyframes: { opacity: [{ frame: 0, value: 0.5 }] } }
  const keyedOnly = await draw('HELLO', style({}), 10, keyed)
  const keyedFade = await draw('HELLO', style({}), 10, { ...keyed, ...fade })
  const ratio = keyedFade.energy / keyedOnly.energy
  const alone = fade10.energy / rest.energy
  check(Math.abs(ratio - alone) < 0.06 && keyedOnly.energy < rest.energy * 0.6, 'a preset multiplies a keyed opacity: the fade is the same share of it as of an unkeyed title',
    `${ratio.toFixed(3)} of the keyed title vs ${alone.toFixed(3)} of the plain one`)

  // -- one path ------------------------------------------------------------------------------------
  const rich = style({ fills: [{ kind: 'linear', angle: 90, stops }], stroke: { color: '#FFFFFF', width: 8 }, shadow, glow: { color: '#00FF00', blur: 20 } })
  const viaDraw = await draw('HELLO', rich, 10, slide)
  const viaRender = await evaluate(`__tl.render('HELLO', ${JSON.stringify(rich)}, 10, ${JSON.stringify(slide)})`, 60_000)
  check(viaRender.w === 1280 && Math.abs(viaRender.lit - viaDraw.lit) / viaDraw.lit < 0.02 && Math.abs(viaRender.minX - viaDraw.minX) <= 2 && Math.abs(viaRender.maxY - viaDraw.maxY) <= 2,
    'preview_frame\'s picture (renderFrame) is the compositor\'s own, stack and preset included', `lit ${viaRender.lit} vs ${viaDraw.lit}`)

  console.log('')
  console.log(bad === 0 ? 'PASS  the paint stack and the presets reach pixels as declared' : `FAIL  ${bad} check(s) failed`)
  console.log(`
Before trusting a PASS, break each of these and confirm the named check goes red:
  - textPaint.ts: drop "* shadowScale" from shadowOffsetY        -> "at half scale the shadow is half as long"
  - textPaint.ts: reverse paint.strokes before drawing            -> "it lands outside the first"
  - textPaint.ts: gradientGeometry, swap x0/y0 with x1/y1         -> "first stop at the top"
  - animation.ts: return REST from endState for 'wipe'            -> "a wipe from the left shows the left ... first"
  - keyframes.ts: animatedItemAt, skip keyedItemAt under a preset -> "a preset multiplies a keyed opacity"
Not covered here (needs footage or a file on disk): a transition setting a preset aside; the same
frame decoded from an exported file (run test/app/export-vs-preview.mjs with a styled, animated title).`)
  close()
  return bad === 0
})
