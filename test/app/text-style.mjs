/**
 * Does text draw as styled, and does the engine tell the truth when it could not?
 *
 * Two claims, and the second is the one that needs a probe. That text appears is easy. That
 * the engine *reports* when the picture is not what was asked for is the thing no model and
 * no glancing user can check for themselves:
 *
 *   - a title auto-shrunk to 40% reads as a design choice, not as a failure
 *   - a substituted font has no visual cue at all
 *
 * So every case below asserts both a pixel consequence and the report that goes with it, and
 * the font case is a differential: a family that exists must come back available and one that
 * cannot exist must not, measured on the same machine in the same run. A `fontAvailable` that
 * is always true would pass a one-sided check.
 */

import { attach, runProbe } from './cdp.mjs'

const { evaluate, close } = await attach()

await runProbe(async () => {
  // A text asset needs no file, so this probe imports nothing and cannot be perturbed by a
  // fixture, a decoder or the media pool.
  const draw = async (label, { text, style, boxW, boxH }) => {
    const out = await evaluate(`(() => {
      const { store, engine } = window.bayEngine
      const st = store.getState()
      const base = st.project.timelines.find(t => t.id === st.project.activeTimelineId)
      const asset = { id: 'txt', kind: 'text', name: 'title', path: null, durationUs: 0,
        width: null, height: null, fps: null, hasAudio: false, hasVideo: true,
        posterPath: null, waveformPath: null, createdAt: 0, text: ${JSON.stringify(text)} }
      const item = { id: 'itm_txt', assetId: 'txt', trackId: 'tt_v', from: 0,
        durationInFrames: 60, sourceStartUs: 0,
        layout: { left: 100, top: 100, width: ${boxW}, height: ${boxH}, opacity: 1, rotation: 0 },
        volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1,
        text: ${JSON.stringify(style)} }
      const timeline = { ...base, background: '#000000',
        tracks: [{ id: 'tt_v', kind: 'video', name: 'V1', locked: false, muted: false,
                   hidden: false, items: [item] }] }
      const project = { ...st.project, assets: [asset], timelines: [timeline],
                        activeTimelineId: timeline.id }
      const c = document.createElement('canvas')
      c.width = base.width; c.height = base.height
      const x = c.getContext('2d', { willReadFrequently: true })
      const stats = engine.compositor.drawFrame(x, project, timeline, 0, { mode: 'scrub' })
      const d = x.getImageData(0, 0, c.width, c.height).data
      let lit = 0, minY = -1, maxY = -1, minX = c.width, maxX = -1
      for (let y = 0; y < c.height; y += 2) for (let px = 0; px < c.width; px += 2) {
        const i = (y * c.width + px) * 4
        if (d[i] > 24 || d[i+1] > 24 || d[i+2] > 24) {
          lit++; if (minY < 0) minY = y; maxY = y
          if (px < minX) minX = px; if (px > maxX) maxX = px
        }
      }
      c.width = 0
      return { fit: stats.textFits[0] ?? null, lit, rows: [minY, maxY], cols: [minX, maxX] }
    })()`)
    console.log(`${label.padEnd(38)} lit ${String(out.lit).padStart(6)}  rows ${JSON.stringify(out.rows).padEnd(12)}  fit ${JSON.stringify(out.fit)}`)
    return out
  }

  const style = (over) => ({
    fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 64, fontWeight: 600, italic: false,
    color: '#FFFFFF', align: 'center', verticalAlign: 'middle', lineHeight: 1.2,
    letterSpacing: 0, stroke: null, shadow: null, background: null, ...over
  })

  console.log('')
  const plain = await draw('short title, fits', { text: 'Hello', style: style({}), boxW: 1200, boxH: 400 })
  const wrapped = await draw('long title, must wrap', { text: 'The quick brown fox jumps over the lazy dog', style: style({}), boxW: 700, boxH: 600 })
  const shrunk = await draw('one long word, must shrink', { text: 'Extraordinarily', style: style({ fontSize: 200 }), boxW: 300, boxH: 600 })
  const clipped = await draw('cannot fit at all', { text: 'Extraordinarily', style: style({ fontSize: 200 }), boxW: 20, boxH: 30 })
  const realFont = await draw('a font that exists', { text: 'Hello', style: style({ fontFamily: 'Helvetica' }), boxW: 1200, boxH: 400 })
  const fakeFont = await draw('a font that cannot exist', { text: 'Hello', style: style({ fontFamily: 'NoSuchFamily12345' }), boxW: 1200, boxH: 400 })
  const decorated = await draw('stroke + shadow + plate', {
    text: 'Hello',
    style: style({ stroke: { color: '#FF0000', width: 6 }, shadow: { color: '#00FF00', blur: 12, offsetX: 6, offsetY: 6 }, background: { color: '#0000FF', padding: 24, radius: 12 } }),
    boxW: 1200, boxH: 400
  })

  const checks = [
    ['text appears at all', plain.lit > 500],
    ['no shrink when it fits', plain.fit?.scale === 1 && plain.fit?.lines === 1],
    ['wrapping happens, and at full size', wrapped.fit?.lines > 1 && wrapped.fit?.scale === 1],
    ['wrapped text is taller than one line', wrapped.rows[1] - wrapped.rows[0] > plain.rows[1] - plain.rows[0]],
    ['shrink is reported', shrunk.fit?.scale < 1 && shrunk.fit?.fontSize < 200],
    ['shrunk text still draws', shrunk.lit > 100],
    ['unfittable text is reported clipped', clipped.fit?.clipped === true],
    ['a real font reports available', realFont.fit?.fontAvailable === true],
    ['a fake font reports unavailable', fakeFont.fit?.fontAvailable === false],
    ['the fake font still draws something', fakeFont.lit > 500],
    ['decoration adds pixels rather than replacing them', decorated.lit > plain.lit]
  ]

  console.log('')
  let bad = 0
  for (const [name, ok] of checks) {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
  }

  // Does Chromium here honour ctx.letterSpacing, and does measureText account for it? Claimed
  // rather than verified would mean the wrap arithmetic silently ignores spacing.
  const spacing = await evaluate(`(() => {
    const c = document.createElement('canvas')
    const x = c.getContext('2d')
    x.font = '600 64px Helvetica'
    const plain = x.measureText('Hello').width
    const supported = 'letterSpacing' in x
    let spaced = plain
    if (supported) { x.letterSpacing = '20px'; spaced = x.measureText('Hello').width }
    return { supported, plain: +plain.toFixed(1), spaced: +spaced.toFixed(1) }
  })()`)
  const spacingWorks = spacing.supported && spacing.spaced > spacing.plain + 40
  console.log(`  ${spacingWorks ? 'ok  ' : 'FAIL'} ctx.letterSpacing is honoured and measured ` +
    `(${spacing.plain} -> ${spacing.spaced}, supported ${spacing.supported})`)
  if (!spacingWorks) bad += 1

  console.log('')
  console.log(bad === 0
    ? 'PASS  text draws as styled, and the engine reports what it could not honour'
    : `FAIL  ${bad} check(s) failed`)
  close()
  return bad === 0
})
