/**
 * Text behind the subject, on a real clip of a person: does `put_behind_subject` put the title
 * between the background and the person — in `preview_frame` and in the exported file alike?
 *
 *     MASK_CLIP=/path/to/clip-with-a-person.mp4 node test/app/mask.mjs
 *
 * The repo holds no footage of people, so the clip is yours to name (any talking head works).
 * Without MASK_CLIP the probe says CANNOT MEASURE. It runs two scenes on a 16:9 canvas (set with
 * `set_canvas`; the harness puts the project back): MASK_CLIP as given — a vertical selfie is
 * pillarboxed, which is the case that matters — and a 16:9 clip of the same person made from it
 * with ffmpeg (or MASK_CLIP_WIDE), which fills the frame.
 *
 * Per scene, all through the open project (the harness restores it; nothing saves):
 *   1. import and place 3 s of the clip after everything already on the timeline, add a big title
 *      over it, and call `put_behind_subject` — the tool under test;
 *   2. work out where the person is on the canvas **independently of the compositor**: the matte
 *      frame for that source time, laid over the whole source frame's rectangle on the timeline
 *      (`sourceFrameOnTimeline` from @shared/matte — the item's layout box, not the canvas: the
 *      first version of this probe stretched the matte over the whole 16:9 canvas, so for a
 *      pillarboxed vertical clip it called the empty bars "the person" and failed a correct draw),
 *      and move the title so its glyphs straddle the person;
 *   3. render (the `preview_frame` path) M the arrangement, T without the cut-out, P without title
 *      and cut-out, G the title alone, U the cut-out unmasked, and the cut-out alone on black and on
 *      white (C0/C1: where they agree, the cut-out is opaque — the matte *as drawn*);
 *   4. export the same frames and decode them.
 *
 * It passes if, over glyph pixels (G):
 *   - beside the person (independent matte α < 0.1) the title is visible in M;
 *   - over the person (α > 0.9) the title is hidden in M — the clip shows, as in P;
 * with the controls that make those two mean something:
 *   - the matte as drawn (C0/C1) agrees with the independent one (IoU ≥ 0.85) — a disagreement
 *     names the compositor's mapping, not the verdicts below it;
 *   - without the mask the title IS visible over the person (T);
 *   - an unmasked cut-out hides the title beside the person too (U);
 *   - the exported frame matches M (per-channel mean within 3, the same beside/over verdicts), and
 *     does not match T over the person.
 * The title's colour is chosen from the frame, never assumed.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attach, check, runProbe, PreconditionError } from './cdp.mjs'
import { FFMPEG, FFPROBE, H264 } from './ffmpeg.mjs'
import { sourceFrameOnTimeline } from '../../src/shared/matte-space.ts'

const run = promisify(execFile)
const CLIP = process.env.MASK_CLIP
const OFFSET = 45
const SPAN = 90
const MAX = 640

const { evaluate } = await attach()

const HELPERS = `
  window.__mask = window.__mask || {}
  __mask.pixels = async (dataUrl) => {
    const img = new Image(); img.src = dataUrl; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height)
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0)
    return { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data }
  }
  __mask.state = () => window.bayEngine.store.getState()
  __mask.timeline = () => { const st = __mask.state(); return st.project.timelines.find((t) => t.id === st.project.activeTimelineId) }
  __mask.variant = (edit, timelineEdit) => {
    const project = JSON.parse(JSON.stringify(__mask.state().project))
    const tl = project.timelines.find((t) => t.id === project.activeTimelineId)
    if (timelineEdit) timelineEdit(tl)
    for (const track of tl.tracks) for (const item of track.items) edit(item, track, tl)
    return project
  }
  __mask.render = async (project, frame, maxSize) => {
    const r = await window.bayEngine.renderFrame({ project, timelineId: project.activeTimelineId, frame, maxSize })
    const p = await __mask.pixels(r.dataUrl)
    return { ...p, pending: r.pending, placeholders: r.placeholders, unresolved: r.unresolved }
  }
  __mask.mcp = (tool, args) => window.bayMcp.execute({ id: 'mask-' + Math.random(), tool, args })
  // The matte frame at a source time, from the engine's store (exact, waited for).
  __mask.matte = async (record, sourceUs) => {
    const store = window.bayEngine.subjectMattes
    let found = store.lookup(record, sourceUs)
    for (let i = 0; i < 20 && found.pending; i++) { await store.settle(3000); found = store.lookup(record, sourceUs) }
    return found.image ? found.image : { error: JSON.stringify(found) }
  }
  // The matte laid over a rectangle (render pixels) of a w×h canvas; returns its alpha per pixel.
  __mask.matteOn = (image, rect, w, h) => {
    const c = new OffscreenCanvas(w, h); const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(image.image, 0, 0, image.width, image.height, rect.left, rect.top, rect.width, rect.height)
    const d = x.getImageData(0, 0, w, h).data
    const a = new Uint8Array(w * h)
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]
    return a
  }
  true
`

/** A 16:9 clip of the same person: the middle of a portrait clip, cropped and scaled to 1920×1080. */
async function wideClip(source) {
  if (process.env.MASK_CLIP_WIDE) return process.env.MASK_CLIP_WIDE
  const dir = join(homedir(), '.bay-probe-media', 'mask')
  await mkdir(dir, { recursive: true })
  const out = join(dir, 'wide-from-' + source.split('/').pop().replace(/[^A-Za-z0-9.]/g, '_') + '.mp4')
  if (existsSync(out)) return out
  await run(FFMPEG, ['-v', 'error', '-y', '-i', source, '-t', '6',
    '-vf', "crop=w='if(gt(iw/ih,16/9),ih*16/9,iw)':h='if(gt(iw/ih,16/9),ih,iw*9/16)':x='(iw-ow)/2':y='(ih-oh)*0.3',scale=1920:1080,setsar=1",
    ...H264, '-an', out])
  return out
}

const pc = (n) => `${(n * 100).toFixed(1)}%`

async function scene(label, clipPath, expectPillarbox) {
  console.log(`\n-- ${label}: ${clipPath}`)
  // -- 1. the clip, a title, and the tool ---------------------------------------------------------
  const setup = await evaluate(`(async () => {
    const [imported] = await window.bay.media.importPaths(${JSON.stringify([clipPath])})
    const asset = imported.asset
    if (asset.error || !asset.hasVideo) return { error: 'the clip did not import as video: ' + (asset.error || asset.kind) }
    // importPaths probes and admits the file; it does not add it to the project.
    __mask.state().addAssets([asset])
    const tl = __mask.timeline()
    const start = Math.max(0, ...tl.tracks.flatMap((t) => t.items.map((i) => i.from + i.durationInFrames)))
    const placed = await __mask.mcp('place_asset', { assetId: asset.id, atFrame: start })
    if (!placed.ok) return { error: 'place_asset: ' + placed.error }
    const clipId = placed.value.itemId
    const trimmed = await __mask.mcp('edit_item', { itemId: clipId, durationInFrames: ${SPAN} })
    if (!trimmed.ok) return { error: 'edit_item durationInFrames: ' + trimmed.error }
    const textAsset = 'ast_mask_probe_' + Date.now()
    __mask.state().addAssets([{ id: textAsset, kind: 'text', name: 'BEHIND', path: null, durationUs: 0, width: null, height: null, fps: null,
      hasAudio: false, hasVideo: false, posterPath: null, waveformPath: null, text: 'BEHIND BEHIND', createdAt: Date.now() }])
    const text = await __mask.mcp('place_asset', { assetId: textAsset, atFrame: start })
    if (!text.ok) return { error: 'place text: ' + text.error }
    const textId = text.value.itemId
    const sized = await __mask.mcp('edit_item', { itemId: textId, durationInFrames: ${SPAN} })
    if (!sized.ok) return { error: 'edit_item text: ' + sized.error }
    const t0 = performance.now()
    const behind = await __mask.mcp('put_behind_subject', { textItemId: textId, videoItemId: clipId })
    return { clipId, textId, assetId: asset.id, start, behind, seconds: (performance.now() - t0) / 1000 }
  })()`, 300_000)
  if (setup.error) throw new PreconditionError(`${label}: setting up the scene`, setup.error)
  check(`${label}: put_behind_subject succeeds`, setup.behind.ok ? true : setup.behind.error, true)
  const behind = setup.behind.value
  const FRAME = setup.start + OFFSET
  console.log(`      matte: ${JSON.stringify(behind.matte)} in ${setup.seconds.toFixed(1)} s`)
  console.log(`      placed: ${behind.placed}`)

  // -- 2. where the person is, independently: matte over the source frame's rectangle -------------
  const item = await evaluate(`(() => {
    const tl = __mask.timeline()
    const clip = tl.tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(setup.clipId)})
    const asset = __mask.state().project.assets.find((a) => a.id === clip.assetId)
    return { layout: clip.layout, crop: clip.crop ?? null, from: clip.from, sourceStartUs: clip.sourceStartUs, speed: clip.speed,
      fps: tl.fps, W: tl.width, H: tl.height, record: asset.subjectMattes?.[asset.subjectMattes.length - 1] ?? null, source: [asset.width, asset.height] }
  })()`)
  if (!item.record) throw new PreconditionError(`${label}: no matte recorded on the asset`)
  if (item.crop || (item.layout.rotation ?? 0) !== 0) throw new PreconditionError(`${label}: the probe's clip must be uncropped and unrotated`, JSON.stringify({ crop: item.crop, rotation: item.layout.rotation }))
  const frameRect = sourceFrameOnTimeline(item.layout)
  const pillarboxed = frameRect.left > 1 || frameRect.left + frameRect.width < item.W - 1
  console.log(`      canvas ${item.W}×${item.H}, source ${item.source.join('×')}, source frame on the canvas x ${frameRect.left.toFixed(0)}–${(frameRect.left + frameRect.width).toFixed(0)}, y ${frameRect.top.toFixed(0)}–${(frameRect.top + frameRect.height).toFixed(0)}`)
  if (expectPillarbox && !pillarboxed) throw new PreconditionError(`${label}: the clip must not fill the canvas's width for this scene`, JSON.stringify(item.layout))
  const sourceUs = item.sourceStartUs + Math.round(((FRAME - item.from) / item.fps) * 1e6 * item.speed) + 500

  const person = await evaluate(`(async () => {
    const m = await __mask.matte(${JSON.stringify(item.record)}, ${sourceUs})
    if (m.error) return { error: m.error }
    const W = ${item.W}, H = ${item.H}
    const a = __mask.matteOn(m, ${JSON.stringify(frameRect)}, W, H)
    let minX = W, maxX = -1, minY = H, maxY = -1, n = 0
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (a[y * W + x] > 128) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    return { n, minX, maxX, minY, maxY, share: (n * 4) / (W * H), mw: m.width, mh: m.height }
  })()`, 120_000)
  if (person.error) throw new PreconditionError(`${label}: reading the matte`, person.error)
  if (person.n === 0) throw new PreconditionError(`${label}: the matte finds no person at frame ${FRAME}`)
  console.log(`      matte ${person.mw}×${person.mh}; person at frame ${FRAME}: x ${person.minX}–${person.maxX}, y ${person.minY}–${person.maxY} (${(person.share * 100).toFixed(0)}% of the canvas)`)
  const top = Math.max(0, Math.round(person.minY + (person.maxY - person.minY) * 0.2))
  const height = Math.round(Math.min(item.H - top, Math.max(item.H * 0.25, (person.maxY - person.minY) * 0.4)))

  const colour = await evaluate(`(async () => {
    const P = await __mask.render(__mask.variant((i) => { if (i.id !== ${JSON.stringify(setup.clipId)}) i.disabled = true }), ${FRAME}, 320)
    const candidates = ['#FF00FF', '#00FF00', '#00FFFF', '#FFFF00', '#FF0000', '#0000FF']
    let best = null, bestScore = -1
    for (const hex of candidates) {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
      let near = 0
      for (let i = 0; i < P.d.length; i += 4) if (Math.abs(P.d[i] - r) + Math.abs(P.d[i + 1] - g) + Math.abs(P.d[i + 2] - b) < 120) near++
      const score = 1 - near / (P.d.length / 4)
      if (score > bestScore) { bestScore = score; best = hex }
    }
    return { hex: best, clear: bestScore }
  })()`, 60_000)
  const styled = await evaluate(`__mask.mcp('edit_item', { itemId: ${JSON.stringify(setup.textId)}, left: 0, width: ${item.W}, top: ${top}, height: ${height},
    text: { color: ${JSON.stringify(colour.hex)}, fontSize: ${Math.round(height * 0.8)}, fontWeight: 900, align: 'center', verticalAlign: 'middle' } })`)
  check(`${label}: the title is restyled across the person`, styled.ok ? true : styled.error, true)
  const inspected = await evaluate(`__mask.mcp('inspect_item', { itemId: ${JSON.stringify(setup.textId)} })`)
  const textHex = inspected.value?.text?.color ?? colour.hex

  // -- 3. the pictures -----------------------------------------------------------------------------
  const verdict = await evaluate(`(async () => {
    window.bayEngine.subjectMattes.reset()
    const clipId = ${JSON.stringify(setup.clipId)}, textId = ${JSON.stringify(setup.textId)}, cutId = ${JSON.stringify(behind.cutoutItemId)}
    const F = ${FRAME}
    const M = await __mask.render(__mask.state().project, F, ${MAX})
    const T = await __mask.render(__mask.variant((i) => { if (i.id === cutId) i.disabled = true }), F, ${MAX})
    const P = await __mask.render(__mask.variant((i) => { if (i.id === cutId || i.id === textId) i.disabled = true }), F, ${MAX})
    const G = await __mask.render(__mask.variant((i) => { if (i.id !== textId) i.disabled = true }), F, ${MAX})
    const U = await __mask.render(__mask.variant((i) => { if (i.id === cutId) delete i.masks }), F, ${MAX})
    const C0 = await __mask.render(__mask.variant((i) => { if (i.id !== cutId) i.disabled = true }, (tl) => { tl.background = '#000000' }), F, ${MAX})
    const C1 = await __mask.render(__mask.variant((i) => { if (i.id !== cutId) i.disabled = true }, (tl) => { tl.background = '#FFFFFF' }), F, ${MAX})
    // The independent matte, at render size: the source frame's rectangle scaled with the canvas.
    const k = M.w / ${item.W}
    const rect = ${JSON.stringify(frameRect)}
    const A = __mask.matteOn(await __mask.matte(${JSON.stringify(item.record)}, ${sourceUs}), { left: rect.left * k, top: rect.top * k, width: rect.width * k, height: rect.height * k }, M.w, M.h)
    const hex = ${JSON.stringify(textHex)}
    const tc = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
    const dist = (d, i, rgb) => Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2])
    const same = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    // The matte as the compositor drew it: opaque where the cut-out looks the same on black and white.
    let both = 0, either = 0
    for (let p = 0, i = 0; p < A.length; p++, i += 4) {
      const drawn = same(C0.d, C1.d, i) < 30, ours = A[p] > 128
      if (drawn && ours) both++
      if (drawn || ours) either++
    }
    const over = [], beside = []
    for (let i = 0; i < G.d.length; i += 4) {
      if (dist(G.d, i, tc) > 30) continue           // a glyph's interior, not its antialiased edge
      if (dist(P.d, i, tc) < 120) continue          // where the clip itself looks like the title, nothing can be told
      const a = A[i / 4]
      if (a > 230) over.push(i)
      else if (a < 25) beside.push(i)
    }
    const share = (list, test) => list.length ? list.filter(test).length / list.length : 0
    return {
      size: [M.w, M.h], complete: [M, T, P, G, U, C0, C1].map((r) => r.pending === 0 && r.placeholders === 0), unresolved: M.unresolved,
      iou: either ? both / either : 0,
      overCount: over.length, besideCount: beside.length,
      besideVisible: share(beside, (i) => dist(M.d, i, tc) < 90),
      overHidden: share(over, (i) => same(M.d, P.d, i) < 45),
      controlOverVisibleWithoutMask: share(over, (i) => dist(T.d, i, tc) < 90),
      controlBesideHiddenByUnmaskedCopy: share(beside, (i) => same(U.d, P.d, i) < 45),
      over, beside
    }
  })()`, 180_000)
  console.log(`      ${verdict.size.join('x')}: ${verdict.overCount} glyph pixels over the person, ${verdict.besideCount} beside`)
  check(`${label}: every render is complete (no pending, no placeholder)`, verdict.complete.every(Boolean) ? true : JSON.stringify(verdict.unresolved), true)
  check(`${label}: the matte as drawn is where the independent mapping puts it (IoU ${pc(verdict.iou)})`, verdict.iou, (v) => v >= 0.85)
  if (verdict.overCount < 150 || verdict.besideCount < 150) {
    throw new PreconditionError(`${label}: the title must cover some of the person and some of the background`, `${verdict.overCount} over, ${verdict.besideCount} beside`)
  }
  check(`${label}: beside the person the title is visible (${pc(verdict.besideVisible)})`, verdict.besideVisible, (v) => v >= 0.85)
  check(`${label}: over the person the title is hidden (${pc(verdict.overHidden)})`, verdict.overHidden, (v) => v >= 0.85)
  check(`${label}: control — without the mask the title is visible over the person (${pc(verdict.controlOverVisibleWithoutMask)})`, verdict.controlOverVisibleWithoutMask, (v) => v >= 0.85)
  check(`${label}: control — an unmasked cut-out hides the title beside the person too (${pc(verdict.controlBesideHiddenByUnmaskedCopy)})`, verdict.controlBesideHiddenByUnmaskedCopy, (v) => v >= 0.85)

  // -- 4. export vs preview_frame ------------------------------------------------------------------
  const [W, H] = verdict.size
  const outDir = join(homedir(), 'Movies', 'bay')
  await mkdir(outDir, { recursive: true })
  const stamp = `${Date.now()}-${label.replace(/\W+/g, '-')}`
  const outputPath = join(outDir, `mask-probe-${stamp}.mp4`)
  const from = FRAME - 3
  const exported = await evaluate(`(async () => {
    window.bayEngine.subjectMattes.reset()
    const project = __mask.state().project
    const job = await window.bay.export.start({ project, timelineId: project.activeTimelineId, format: 'mp4',
      outputPath: ${JSON.stringify(outputPath)}, width: ${W}, height: ${H}, fromFrame: ${from}, toFrame: ${FRAME + 3} })
    return await new window.bayEngine.FrameExporter({ project, timelineId: project.activeTimelineId,
      jobId: job.jobId, width: ${W}, height: ${H}, fromFrame: ${from}, toFrame: ${FRAME + 3} }).run()
  })()`, 180_000)
  await new Promise((r) => setTimeout(r, 2500))
  check(`${label}: the export wrote every frame complete (the matte was waited for)`, exported.incomplete === null ? 'complete' : JSON.stringify(exported.incomplete), 'complete')
  const raw = join(outDir, `mask-probe-${stamp}.rgb`)
  await run(FFMPEG, ['-v', 'error', '-i', outputPath, '-vf', `select=eq(n\\,${FRAME - from}),zscale=min=709:rin=limited:m=709:r=full,format=rgb24`, '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-s', `${W}x${H}`, '-y', raw])
  const bytes = await readFile(raw)
  const compare = await evaluate(`(async () => {
    const e = ${JSON.stringify(Array.from(bytes))}
    const F = ${FRAME}
    const M = await __mask.render(__mask.state().project, F, ${MAX})
    const T = await __mask.render(__mask.variant((i) => { if (i.id === ${JSON.stringify(behind.cutoutItemId)}) i.disabled = true }), F, ${MAX})
    const P = await __mask.render(__mask.variant((i) => { if (i.id === ${JSON.stringify(behind.cutoutItemId)} || i.id === ${JSON.stringify(setup.textId)}) i.disabled = true }), F, ${MAX})
    const means = (get) => { let r = 0, g = 0, b = 0; const n = M.w * M.h; for (let k = 0; k < n; k++) { const [x, y, z] = get(k); r += x; g += y; b += z } return [r / n, g / n, b / n] }
    const em = means((k) => [e[k * 3], e[k * 3 + 1], e[k * 3 + 2]])
    const pm = means((k) => [M.d[k * 4], M.d[k * 4 + 1], M.d[k * 4 + 2]])
    const hex = ${JSON.stringify(textHex)}
    const tc = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
    const at = (i) => { const k = i / 4; return [e[k * 3], e[k * 3 + 1], e[k * 3 + 2]] }
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
    const over = ${JSON.stringify(verdict.over)}, beside = ${JSON.stringify(verdict.beside)}
    const share = (list, test) => list.length ? list.filter(test).length / list.length : 0
    return {
      exportMean: em, previewMean: pm,
      besideVisible: share(beside, (i) => dist(at(i), tc) < 110),
      overHidden: share(over, (i) => dist(at(i), [P.d[i], P.d[i + 1], P.d[i + 2]]) < 70),
      overMatchesUnmasked: share(over, (i) => dist(at(i), [T.d[i], T.d[i + 1], T.d[i + 2]]) < 70)
    }
  })()`, 120_000)
  const f1 = (a) => a.map((v) => v.toFixed(1)).join(' ')
  console.log(`      export mean ${f1(compare.exportMean)}   preview_frame mean ${f1(compare.previewMean)}`)
  check(`${label}: the exported frame matches preview_frame (per-channel mean within 3)`, compare.exportMean.every((v, i) => Math.abs(v - compare.previewMean[i]) <= 3), true)
  check(`${label}: in the export the title shows beside the person (${pc(compare.besideVisible)})`, compare.besideVisible, (v) => v >= 0.8)
  check(`${label}: in the export the title is hidden over the person (${pc(compare.overHidden)})`, compare.overHidden, (v) => v >= 0.8)
  check(`${label}: comparison control — the export does not match the unmasked picture over the person (${pc(compare.overMatchesUnmasked)})`, compare.overMatchesUnmasked, (v) => v <= 0.2)
  await rm(outputPath, { force: true })
  await rm(raw, { force: true })
}

await runProbe(async () => {
  if (!CLIP || !existsSync(CLIP)) {
    throw new PreconditionError('MASK_CLIP must name a clip with a person in it', CLIP ? `${CLIP} does not exist` : 'not set')
  }
  await evaluate(HELPERS)
  const canvas = await evaluate(`__mask.mcp('set_canvas', { preset: 'landscape-1080' })`)
  check('the canvas is 16:9 for both scenes', canvas.ok ? true : canvas.error, true)
  const dims = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', CLIP]).then((r) => r.stdout.trim().split(',').map(Number), () => [0, 0])
  const portrait = dims[1] > dims[0]
  await scene(portrait ? 'vertical clip, pillarboxed in 16:9' : 'the given clip in 16:9', CLIP, portrait)
  await scene('16:9 clip, filling 16:9', portrait ? await wideClip(CLIP) : CLIP, false)
  return true
}, { timeoutMs: Number(process.env.PROBE_TIMEOUT_MS) || 900_000 })
