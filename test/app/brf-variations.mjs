/**
 * Variable-font axes in `.brf` text, measured in pixels — through `renderFrame` (what
 * `preview_frame` returns), the live preview canvas, and an exported file.
 *
 * The quantity is **ink width**: the span of columns holding lit pixels, as a fraction of the
 * frame's width, of one white line on black. A width axis that works moves it a lot (Archivo at
 * wdth 62 against 125 measured 262px against 492px in a bare canvas); one that is silently
 * ignored leaves it exactly where it was. So:
 *
 * - the positive control is wdth 62 against 125 of the same string — they must differ widely;
 * - "the default is unchanged" is the plain face (no `variations`) against `{ wdth: 100 }`, the
 *   font's own default: equal, so the synthetic face is the same font and not a fallback;
 * - the three paths are compared as fractions of their own width, since each renders at its own
 *   size.
 *
 * Archivo is not installed on this machine and bay has no font import, so the probe gives the
 * editor an `@font-face` rule for it (a data: URL, which the CSP's `font-src` allows) — the same
 * kind of source the fonts bay bundles have. It is removed afterwards. The installed-font path
 * (`local()`) is measured separately with Skia, which every Mac has and whose `wdth` axis runs
 * 0.62–1.3 in its own units.
 *
 * Set ARCHIVO to the font file; the default is the one this was first measured with.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { attach, check, PreconditionError, runProbe } from './cdp.mjs'

const ARCHIVO = process.env.ARCHIVO ?? '/Users/himanshu/codes/dodle/studio/video/assets/fonts/Archivo[wdth,wght].ttf'
import { FFMPEG } from './ffmpeg.mjs'
const FAMILY = 'Archivo Probe'

const { evaluate } = await attach()

await runProbe(async () => {
  if (!existsSync(ARCHIVO)) throw new PreconditionError(`no font at ${ARCHIVO}`, 'set ARCHIVO to a variable font with a wdth axis')
  let seq = 0
  const call = (tool, args = {}) => evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `v${++seq}`, tool, args })})`, 90_000)
  const catalog = await evaluate(`window.bayMcp.tools.map((t) => t.name)`)
  if (!catalog.includes('write_brf')) throw new PreconditionError('write_brf is not in this build', 'run pnpm build and restart')

  const stale = await evaluate(`(() => {
    const s = window.bayEngine.store.getState()
    const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
    return tl.tracks.flatMap((t) => t.items.map((i) => i.id))
  })()`)
  if (stale.length > 0) {
    const cleared = await call('delete_items', { itemIds: stale })
    if (!cleared.ok) throw new PreconditionError('could not clear the timeline', cleared.error)
  }

  const b64 = readFileSync(ARCHIVO).toString('base64')
  await evaluate(`(() => {
    const style = document.createElement('style')
    style.id = 'brf-variations-probe'
    style.textContent = "@font-face { font-family: '${FAMILY}'; src: url(data:font/ttf;base64,${b64}) format('truetype'); font-weight: 100 900; font-stretch: 62% 125%; }"
    document.head.appendChild(style)
    return true
  })()`)

  try {
    /** Ink span of lit pixels as a fraction of the image width, from an image the page can decode. */
    const INK = `(d, w, h) => {
      let min = w, max = -1
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (d[i] + d[i + 1] + d[i + 2] > 3 * 128) { if (x < min) min = x; if (x > max) max = x }
      }
      return max < 0 ? 0 : (max - min + 1) / w
    }`
    const render = () =>
      evaluate(`(async () => {
        const st = window.bayEngine.store.getState()
        const r = await window.bayEngine.renderFrame({ project: st.project, timelineId: st.project.activeTimelineId, frame: 3 })
        const img = new Image(); img.src = r.dataUrl; await img.decode()
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
        const d = x.getImageData(0, 0, c.width, c.height).data
        return { ink: (${INK})(d, c.width, c.height), width: c.width, pending: r.pending, placeholders: r.placeholders, unresolved: r.unresolved }
      })()`, 90_000)

    const module = (font) => `
      export const vars = { wdth: 100, axes: 1 }
      export default ({ vars }) => (
        <scene duration={1} background="#000000">
          <text x="50%" y="50%" size="9%" weight={400} font=${JSON.stringify(font)}
            variations={vars.axes ? { wdth: vars.wdth } : undefined}>Brand Typography</text>
        </scene>
      )`

    // -- refusal, beside its positive control ---------------------------------------------------
    const unknown = await call('write_brf', { code: module('No Such Font Probe') })
    check(
      'a family nothing can load is refused, naming what was tried and what to do',
      !unknown.ok && /"No Such Font Probe" cannot take variations/.test(unknown.error) && /PostScript name/.test(unknown.error) && /"Inter Variable"/.test(unknown.error),
      true
    )

    // -- Archivo, through an @font-face rule ----------------------------------------------------
    const written = await call('write_brf', { code: module(FAMILY), atFrame: 0, name: 'Variations probe' })
    if (!written.ok) throw new PreconditionError('write_brf refused the Archivo module', written.error)
    check('the positive control: the same module in a loadable family is accepted and placed', written.value.placed, true)
    const itemId = written.value.itemId
    const setVar = (name, value) => evaluate(`(() => { window.bayEngine.store.getState().setCompositionVariable(${JSON.stringify(itemId)}, ${JSON.stringify(name)}, ${JSON.stringify(value)}); return true })()`)

    const measure = async (label, axes, wdth) => {
      await setVar('axes', axes)
      await setVar('wdth', wdth)
      const r = await render()
      console.log(`    ${label.padEnd(26)} ink ${(r.ink * 100).toFixed(2)}% of ${r.width}px  pending ${r.pending}  placeholders ${r.placeholders}`)
      check(`${label}: drawn, nothing pending or placeheld`, r.pending === 0 && r.placeholders === 0 && r.ink > 0, true)
      return r.ink
    }
    const plain = await measure('Archivo, no variations', 0, 100)
    const w100 = await measure('Archivo, wdth 100', 1, 100)
    const w62 = await measure('Archivo, wdth 62', 1, 62)
    const w125 = await measure('Archivo, wdth 125', 1, 125)
    check('the default is unchanged: wdth 100 inks what the plain face inks (within 0.3% of the frame)', Math.abs(w100 - plain), (d) => d < 0.003)
    check('wdth moves the ink: 125 is at least 1.5x as wide as 62', w125 / w62, (r) => r > 1.5)
    check('and 62 is narrower than the default, 125 wider', w62 < w100 && w125 > w100, true)

    // -- the live preview canvas, at wdth 62 ------------------------------------------------------
    await setVar('wdth', 62)
    const live = await evaluate(`(async () => {
      const { engine, store } = window.bayEngine
      store.getState().setPlayhead(3)
      for (let i = 0; i < 40; i++) {
        engine.redraw()
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        await new Promise((r) => setTimeout(r, 50))
        const canvases = [...document.querySelectorAll('canvas')].filter((c) => c.isConnected && c.width > 200)
        const c = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0]
        if (!c) return { error: 'no preview canvas' }
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data
        // The frame sits letterboxed inside the canvas; measure against the frame, not the canvas.
        const tl = store.getState().project.timelines[0]
        const scale = Math.min(c.width / tl.width, c.height / tl.height)
        const ink = (${INK})(d, c.width, c.height) * c.width / (tl.width * scale)
        if (ink > 0) return { ink, canvas: c.width + 'x' + c.height }
      }
      return { ink: 0 }
    })()`, 60_000)
    console.log(`    live preview, wdth 62       ink ${(live.ink * 100).toFixed(2)}% (${live.canvas ?? live.error})`)
    check('the live preview draws wdth 62 as renderFrame does (within 1% of the frame)', Math.abs(live.ink - w62), (d) => d < 0.01)

    // -- export, at wdth 62 -----------------------------------------------------------------------
    const out = `${homedir()}/Movies/bay/brfh-variations-${Date.now()}.mp4`
    const job = await call('export_timeline', { outputPath: out, format: 'mp4', fromFrame: 0, toFrame: 5 })
    if (!job.ok) throw new PreconditionError('export_timeline refused', job.error)
    let last = null
    for (let i = 0; i < 240; i++) {
      last = (await call('track_export', { jobId: job.value.jobId })).value
      if (last.stage === 'done' || last.stage === 'failed') break
      await new Promise((r) => setTimeout(r, 500))
    }
    check('the export finishes', last?.stage, 'done')
    try {
      const size = await evaluate(`(() => { const t = window.bayEngine.store.getState().project.timelines[0]; return [t.width, t.height] })()`)
      const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', out, '-vf', 'select=eq(n\\,3)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 28 })
      const [w, h] = size
      check('the decoded frame is the timeline size', raw.length, w * h)
      let min = w, max = -1
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (raw[y * w + x] > 128) { if (x < min) min = x; if (x > max) max = x }
      const exported = max < 0 ? 0 : (max - min + 1) / w
      console.log(`    export, wdth 62             ink ${(exported * 100).toFixed(2)}% of ${w}px`)
      check('the export draws wdth 62 as renderFrame does (within 1% of the frame)', Math.abs(exported - w62), (d) => d < 0.01)
      check('and not the default width (the export is not ignoring the axis)', Math.abs(exported - plain), (d) => d > 0.02)
    } finally {
      if (existsSync(out)) unlinkSync(out)
    }

    // -- an installed font, through local() --------------------------------------------------------
    const skia = await call('write_brf', { code: module('Skia-Regular').replace('wdth: 100', 'wdth: 1'), atFrame: 0, name: 'Variations probe, Skia' })
    check('an installed variable font named by its PostScript name is accepted', skia.ok ? 'accepted' : skia.error, 'accepted')
    await evaluate(`(() => { window.bayEngine.store.getState().patchLayout(${JSON.stringify(itemId)}, { opacity: 0 }); return true })()`)
    const skiaId = skia.value.itemId
    const skiaAt = async (wdth) => {
      await evaluate(`(() => { window.bayEngine.store.getState().setCompositionVariable(${JSON.stringify(skiaId)}, 'wdth', ${wdth}); return true })()`)
      const r = await render()
      console.log(`    Skia-Regular, wdth ${String(wdth).padEnd(6)}    ink ${(r.ink * 100).toFixed(2)}%  pending ${r.pending}`)
      return r.ink
    }
    const narrow = await skiaAt(0.62)
    const wide = await skiaAt(1.3)
    check('Skia\'s wdth axis moves its ink too (1.3 at least 1.3x as wide as 0.62)', wide / narrow, (r) => r > 1.3)
  } finally {
    await evaluate(`(() => { document.getElementById('brf-variations-probe')?.remove(); return true })()`)
  }
  return true
})
