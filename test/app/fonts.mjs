/**
 * Imported fonts in the running app — an IMPORTED Archivo[wdth,wght].ttf, never installed on the
 * machine, measured in pixels: `.brf` text through `renderFrame` (what `preview_frame` returns,
 * PREVIEW), the live preview canvas (PREVIEW), an exported file (EXPORT), a text item, an HTML
 * composition, and — in a second run after the app has been restarted — the saved project
 * reopened (REOPEN).
 *
 * The quantity is **ink width**, as in `brf-variations.mjs`: the span of lit columns as a fraction
 * of the frame width, of one white line on black. A wdth axis that works moves it a lot; a fallback
 * face or an ignored axis leaves it where it was. Every positive check has a control:
 *
 * - wdth 62 against 125 of the same string (must differ widely), and the plain face against
 *   `{ wdth: 100 }` (must match: the clone is the same font, not a fallback);
 * - a text item in "Archivo" draws without a substitution warning, beside one in a family nobody
 *   has, which warns;
 * - a composition in Archivo at font-stretch 62% against 125% must differ, beside the same pair in
 *   a family that is not imported (falls back to a monospace with no width axis), which must not.
 *
 * Phase 1 (default) imports, measures and saves the project, printing FONTS_EXPECT. Restart the
 * app, then run phase 2 with FONTS_REOPEN=<the .bay path> FONTS_EXPECT=<ink> to open the saved
 * project in a fresh process and measure again.
 *
 *   PORT=9275 node test/app/fonts.mjs
 *   PORT=9275 FONTS_REOPEN=/path/to/project.bay FONTS_EXPECT=0.2345 node test/app/fonts.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { attach, check, PreconditionError, runProbe } from './cdp.mjs'

const ARCHIVO = process.env.ARCHIVO ?? '/Users/himanshu/codes/dodle/studio/video/assets/fonts/Archivo[wdth,wght].ttf'
const FFMPEG = new URL('../../node_modules/ffmpeg-ffprobe-static/ffmpeg', import.meta.url).pathname
const REOPEN = process.env.FONTS_REOPEN ?? null

const installed = () =>
  [join(homedir(), 'Library', 'Fonts'), '/Library/Fonts'].flatMap((dir) => {
    try {
      return readdirSync(dir).filter((name) => /archivo/i.test(name)).map((name) => join(dir, name))
    } catch {
      return []
    }
  })

const { evaluate } = await attach()

const INK = `(d, w, h) => {
  let min = w, max = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    if (d[i] + d[i + 1] + d[i + 2] > 3 * 128) { if (x < min) min = x; if (x > max) max = x }
  }
  return max < 0 ? 0 : (max - min + 1) / w
}`

const render = (frame = 3) =>
  evaluate(`(async () => {
    const st = window.bayEngine.store.getState()
    const r = await window.bayEngine.renderFrame({ project: st.project, timelineId: st.project.activeTimelineId, frame: ${frame} })
    const img = new Image(); img.src = r.dataUrl; await img.decode()
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    return { ink: (${INK})(d, c.width, c.height), width: c.width, pending: r.pending, placeholders: r.placeholders, unresolved: r.unresolved }
  })()`, 90_000)

let seq = 0
const call = (tool, args = {}) => evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `f${++seq}`, tool, args })})`, 90_000)

const module = (font) => `
  export const vars = { wdth: 100, axes: 1 }
  export default ({ vars }) => (
    <scene duration={1} background="#000000">
      <text x="50%" y="50%" size="9%" weight={400} font=${JSON.stringify(font)}
        variations={vars.axes ? { wdth: vars.wdth } : undefined}>Brand Typography</text>
    </scene>
  )`

async function reopen() {
  const expected = Number(process.env.FONTS_EXPECT)
  if (!Number.isFinite(expected)) throw new PreconditionError('FONTS_EXPECT is not a number', 'pass the ink phase 1 printed')
  check('REOPEN: Archivo is still not installed on this machine', installed(), (list) => list.length === 0)
  const opened = await call('open_project', { filePath: REOPEN })
  if (!opened.ok) throw new PreconditionError('open_project refused', opened.error)
  const read = (await call('read_project')).value
  const font = read.fonts?.find((f) => f.family === 'Archivo')
  check('REOPEN: read_project lists the imported font', Boolean(font), true)
  const asset = await evaluate(`(() => window.bayEngine.store.getState().project.assets.find((a) => a.kind === 'font'))()`)
  check("REOPEN: the font's file is bay's copy, and it exists", asset?.path && existsSync(asset.path) && !asset.path.startsWith('/Users/himanshu/codes/dodle'), true)
  const served = await evaluate(`(async () => {
    const a = window.bayEngine.store.getState().project.assets.find((x) => x.kind === 'font')
    const bytes = btoa(String.fromCharCode(...new TextEncoder().encode(a.path))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
    const r = await fetch('bay://media/' + bytes)
    return { status: r.status, type: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength }
  })()`)
  check('REOPEN: bay:// serves it to a fresh process', served.status === 200 && served.type === 'font/ttf' && served.size > 100_000, true)
  const r = await render()
  console.log(`    reopened, wdth 62            ink ${(r.ink * 100).toFixed(2)}%  (phase 1: ${(expected * 100).toFixed(2)}%)`)
  check('REOPEN: the reopened project draws wdth 62 exactly as before', Math.abs(r.ink - expected), (d) => d < 0.002)
  check('REOPEN: nothing pending or placeheld', r.pending === 0 && r.placeholders === 0, true)
  return true
}

await runProbe(async () => {
  if (!existsSync(ARCHIVO)) throw new PreconditionError(`no font at ${ARCHIVO}`, 'set ARCHIVO to a variable font with a wdth axis')
  if (REOPEN) return reopen()
  check('Archivo is not installed on this machine (the whole point)', installed(), (list) => list.length === 0)

  const stale = await evaluate(`(() => {
    const s = window.bayEngine.store.getState()
    const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
    return tl ? tl.tracks.flatMap((t) => t.items.map((i) => i.id)) : null
  })()`)
  if (stale === null) throw new PreconditionError('no project is open', 'open or create a project in the window first')
  if (stale.length > 0) await call('delete_items', { itemIds: stale })

  // A project saved by an earlier run already holds the font: take it out, so "before the import"
  // is measured in the state it names rather than assumed. The snapshot restore puts it back.
  await evaluate(`(() => {
    const s = window.bayEngine.store.getState()
    for (const a of s.project.assets.filter((x) => x.kind === 'font')) window.bayEngine.store.getState().removeAsset(a.id)
    return true
  })()`)

  // -- import --------------------------------------------------------------------------------
  const before = await call('write_brf', { code: module('Archivo') })
  check('before the import, "Archivo" cannot take axes, and the refusal says how to add a font', !before.ok && /import_media/.test(before.error ?? ''), true)

  const imported = await call('import_media', { paths: [ARCHIVO] })
  if (!imported.ok) throw new PreconditionError('import_media refused the font', imported.error)
  const asset = imported.value.assets[0]
  console.log('    imported:', JSON.stringify(asset))
  check('import_media: kind font, not placeable, family Archivo', asset.kind === 'font' && asset.placeable === false && asset.font?.family === 'Archivo', true)
  check('import_media: both axes reported', asset.font?.axes?.map((a) => `${a.tag} ${a.min}-${a.max}`).join(', '), 'wght 100-900, wdth 62-125')
  check("the asset's file is bay's copy, not the original", asset.path !== ARCHIVO && existsSync(asset.path), true)
  const listed = (await call('read_project')).value.fonts
  check('read_project lists it', listed?.map((f) => f.family), (f) => Array.isArray(f) && f.includes('Archivo'))
  const browsed = (await call('browse_assets')).value.assets.find((a) => a.id === asset.id)
  check('browse_assets describes it', browsed?.font?.family, 'Archivo')
  const placed = await call('place_asset', { assetId: asset.id })
  check('place_asset refuses a font and names the family to use', !placed.ok && /name its family "Archivo"/.test(placed.error ?? ''), true)

  // -- the refusal names imported fonts, beside the positive control ---------------------------
  const unknown = await call('write_brf', { code: module('No Such Font Probe') })
  check('an unknown family is refused, naming the imported fonts first', !unknown.ok && /this project imported \("Archivo"\)/.test(unknown.error ?? ''), true)
  const written = await call('write_brf', { code: module('Archivo'), atFrame: 0, name: 'Fonts probe' })
  if (!written.ok) throw new PreconditionError('write_brf refused Archivo after the import', written.error)
  check('the same module in the imported family is accepted and placed', written.value.placed, true)
  const itemId = written.value.itemId
  const setVar = (name, value) => evaluate(`(() => { window.bayEngine.store.getState().setCompositionVariable(${JSON.stringify(itemId)}, ${JSON.stringify(name)}, ${JSON.stringify(value)}); return true })()`)

  // -- PREVIEW: renderFrame -------------------------------------------------------------------------
  const measure = async (label, axes, wdth) => {
    await setVar('axes', axes)
    await setVar('wdth', wdth)
    const r = await render()
    console.log(`    ${label.padEnd(30)} ink ${(r.ink * 100).toFixed(2)}% of ${r.width}px  pending ${r.pending}  placeholders ${r.placeholders}`)
    check(`PREVIEW ${label}: drawn, nothing pending or placeheld`, r.pending === 0 && r.placeholders === 0 && r.ink > 0, true)
    return r.ink
  }
  const plain = await measure('imported Archivo, plain', 0, 100)
  const w100 = await measure('imported Archivo, wdth 100', 1, 100)
  const w62 = await measure('imported Archivo, wdth 62', 1, 62)
  const w125 = await measure('imported Archivo, wdth 125', 1, 125)
  check('PREVIEW the default is unchanged: wdth 100 inks what the plain face inks (±0.3%)', Math.abs(w100 - plain), (d) => d < 0.003)
  check('PREVIEW wdth moves the ink: 125 at least 1.5x as wide as 62', w125 / w62, (r) => r > 1.5)

  // -- PREVIEW: the live canvas ----------------------------------------------------------------------
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
      const tl = store.getState().project.timelines.find((t) => t.id === store.getState().project.activeTimelineId)
      const scale = Math.min(c.width / tl.width, c.height / tl.height)
      const ink = (${INK})(d, c.width, c.height) * c.width / (tl.width * scale)
      if (ink > 0) return { ink, canvas: c.width + 'x' + c.height }
    }
    return { ink: 0 }
  })()`, 60_000)
  console.log(`    live preview, wdth 62          ink ${(live.ink * 100).toFixed(2)}% (${live.canvas ?? live.error})`)
  check('PREVIEW the live canvas draws wdth 62 as renderFrame does (±1% of the frame)', Math.abs(live.ink - w62), (d) => d < 0.01)

  // -- EXPORT ------------------------------------------------------------------------------------------
  const out = `${homedir()}/Movies/bay/df-fonts-${process.pid}.mp4`
  try {
    const job = await call('export_timeline', { outputPath: out, format: 'mp4', fromFrame: 0, toFrame: 5 })
    if (!job.ok) throw new PreconditionError('export_timeline refused', job.error)
    let last = null
    for (let i = 0; i < 240; i++) {
      last = (await call('track_export', { jobId: job.value.jobId })).value
      if (last.stage === 'done' || last.stage === 'failed') break
      await new Promise((r) => setTimeout(r, 500))
    }
    check('EXPORT finishes, complete', last?.stage === 'done' && last?.complete === true, true)
    const [w, h] = await evaluate(`(() => { const s = window.bayEngine.store.getState(); const t = s.project.timelines.find((x) => x.id === s.project.activeTimelineId); return [t.width, t.height] })()`)
    const raw = execFileSync(FFMPEG, ['-v', 'error', '-i', out, '-vf', 'select=eq(n\\,3),zscale=min=709:rin=limited:m=709:r=full,format=gray', '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 })
    check('EXPORT the decoded frame is the timeline size', raw.length, w * h)
    let min = w, max = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (raw[y * w + x] > 128) { if (x < min) min = x; if (x > max) max = x }
    const exported = max < 0 ? 0 : (max - min + 1) / w
    console.log(`    export, wdth 62                ink ${(exported * 100).toFixed(2)}% of ${w}px`)
    check('EXPORT draws wdth 62 as the preview does (±1% of the frame)', Math.abs(exported - w62), (d) => d < 0.01)
    check('EXPORT and not the default width', Math.abs(exported - plain), (d) => d > 0.02)
  } finally {
    if (existsSync(out)) unlinkSync(out)
  }

  // -- a text item in the imported family --------------------------------------------------------------
  await evaluate(`(() => { window.bayEngine.store.getState().patchLayout(${JSON.stringify(itemId)}, { opacity: 0 }); return true })()`)
  const textWarning = async (family) => {
    const made = await evaluate(`(() => {
      const s = window.bayEngine.store.getState()
      const id = 'ast_fonttext_' + Math.random().toString(36).slice(2)
      s.addAssets([{ id, kind: 'text', name: 'Fonts', path: null, text: 'Brand Typography', durationUs: 0, width: null, height: null, fps: null, hasAudio: false, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0 }])
      const itemId = s.placeAsset(id, 0)
      const st = window.bayEngine.store.getState()
      const item = st.project.timelines.flatMap((t) => t.tracks).flatMap((t) => t.items).find((i) => i.id === itemId)
      st.patchItem(itemId, { text: { fontFamily: ${JSON.stringify(family)}, fontSize: 96, fontWeight: 400, italic: false, color: '#FFFFFF', align: 'center', verticalAlign: 'middle', lineHeight: 1.2, letterSpacing: 0, stroke: null, shadow: null, background: null } })
      return itemId
    })()`)
    const frame = await call('preview_frame', { frame: 3 })
    await call('delete_items', { itemIds: [made] })
    return frame.ok ? (frame.value.textWarnings ?? []).join(' ') : `preview_frame failed: ${frame.error}`
  }
  const archivoText = await textWarning('"Archivo"')
  const missingText = await textWarning('"No Such Family Probe"')
  check('PREVIEW control: a text item in a family nobody has warns of substitution', /substitut/.test(missingText), true)
  check('PREVIEW a text item in the imported "Archivo" draws with no substitution warning', archivoText, (t) => !/substitut|not installed/.test(t))

  // -- an HTML composition in the imported family ---------------------------------------------------
  const scratch = mkdtempSync(join(tmpdir(), 'bay-fonts-probe-'))
  try {
    const compose = async (name, family, stretch) => {
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}
        .root{position:relative;width:1920px;height:1080px;background:#000}
        #t{position:absolute;left:0;right:0;top:420px;text-align:center;color:#fff;font-size:120px;font-weight:400;font-family:${family};font-stretch:${stretch}}</style></head>
        <body><div class="root" data-composition-id="${name}" data-duration="1" style="width:1920px;height:1080px"><div id="t">Brand Typography</div></div>
        <script>window.__timelines['${name}'] = { time: function () {}, duration: function () { return 1 } }</script></body></html>`
      const w = await call('write_composition', { path: join(scratch, `${name}.html`), html })
      if (!w.ok) throw new PreconditionError('write_composition refused', w.error)
      const assetId = w.value.assetId
      if (!assetId) throw new PreconditionError('write_composition did not import the composition', JSON.stringify(w.value))
      const p = await call('place_asset', { assetId, atFrame: 0 })
      if (!p.ok) throw new PreconditionError('place_asset refused the composition', p.error)
      const r = await render(3)
      await call('delete_items', { itemIds: [p.value.itemId] })
      console.log(`    composition ${name.padEnd(18)} ink ${(r.ink * 100).toFixed(2)}%  pending ${r.pending}`)
      return r.ink
    }
    const c62 = await compose('font-archivo-62', '"Archivo"', '62%')
    const c125 = await compose('font-archivo-125', '"Archivo"', '125%')
    const n62 = await compose('font-none-62', '"No Such Family Probe", monospace', '62%')
    const n125 = await compose('font-none-125', '"No Such Family Probe", monospace', '125%')
    check('PREVIEW control: a composition family that is not imported ignores font-stretch', Math.abs(n125 - n62), (d) => d < 0.01)
    check('PREVIEW a composition in the imported "Archivo" takes its width axis (125% ≥ 1.5× 62%)', c125 / c62, (r) => r > 1.5)
    // The same face as the .brf text, not merely some face with a width axis: at 120px against the
    // .brf's 9% of 1080, the ink scales by 120 / 97.2.
    check('PREVIEW the composition draws the face the .brf text does (wdth 62 ink, scaled by size, ±1%)', Math.abs(c62 - w62 * (120 / 97.2)), (d) => d < 0.01)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  // -- save, for the reopen run ----------------------------------------------------------------------
  await evaluate(`(() => { window.bayEngine.store.getState().patchLayout(${JSON.stringify(itemId)}, { opacity: 1 }); return true })()`)
  await setVar('wdth', 62)
  const saved = await evaluate(`(async () => (await window.bay.project.save(window.bayEngine.store.getState().project)).filePath)()`)
  console.log(`\nsaved to ${saved}\nrestart the app, then:\n  PORT=${process.env.PORT ?? 9222} FONTS_REOPEN=${JSON.stringify(saved)} FONTS_EXPECT=${w62} node test/app/fonts.mjs`)
  check('Archivo is still not installed on this machine', installed(), (list) => list.length === 0)
  return true
}, { timeoutMs: 400_000 })
