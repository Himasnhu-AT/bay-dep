/**
 * Text behind the subject, on a real clip of a person: does `put_behind_subject` put the title
 * between the background and the person — in `preview_frame` and in the exported file alike?
 *
 *     MASK_CLIP=/path/to/clip-with-a-person.mp4 node test/app/mask.mjs
 *
 * The repo holds no footage of people, so the clip is yours to name (any talking head works; the
 * research used Mixkit 43150, two hikers). Without MASK_CLIP the probe says CANNOT MEASURE.
 *
 * What it does, all through the open project (the harness restores it; nothing saves):
 *   1. import the clip, place 3 s of it on V1, add a big title over it, and call
 *      `put_behind_subject` — the tool under test, which computes the matte with Apple Vision;
 *   2. read the matte at the frame measured and move the title so its glyphs straddle the person
 *      (derived from the matte, so the check cannot miss the person by where the text happens to be);
 *   3. render, through `renderFrame` (the `preview_frame` path), five pictures of that frame:
 *        M  the arrangement            T  cut-out off (title over the clip, no mask)
 *        P  title and cut-out off      G  the title alone on black (where the glyphs are)
 *        U  the cut-out unmasked
 *   4. export the same frames and decode them.
 *
 * It passes if, over glyph pixels (G):
 *   - beside the person (matte α < 0.1) the title is visible in M;
 *   - over the person (matte α > 0.9) the title is hidden in M — the clip shows, as in P;
 * with the controls that make those two mean something:
 *   - without the mask the title IS visible over the person (T) — so "hidden" is the mask's doing;
 *   - an unmasked cut-out hides the title beside the person too (U) — so "visible beside" is too;
 *   - the exported frame matches M (per-channel mean within 3, and the same beside/over verdicts),
 *     and differs from T over the person — the comparison can fail.
 * The title's colour is chosen from the frame (the candidate farthest from the clip's own pixels),
 * never assumed.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { attach, check, runProbe, PreconditionError } from './cdp.mjs'
import { FFMPEG } from './ffmpeg.mjs'

const run = promisify(execFile)
const CLIP = process.env.MASK_CLIP
const FRAME = 45
const SPAN = 90

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
  __mask.variant = (edit) => {
    const project = JSON.parse(JSON.stringify(__mask.state().project))
    const tl = project.timelines.find((t) => t.id === project.activeTimelineId)
    for (const track of tl.tracks) for (const item of track.items) edit(item, track, tl)
    return project
  }
  __mask.render = async (project, maxSize) => {
    const r = await window.bayEngine.renderFrame({ project, timelineId: project.activeTimelineId, frame: ${FRAME}, maxSize })
    const p = await __mask.pixels(r.dataUrl)
    return { ...p, pending: r.pending, placeholders: r.placeholders, unresolved: r.unresolved }
  }
  __mask.mcp = (tool, args) => window.bayMcp.execute({ id: 'mask-' + Math.random(), tool, args })
  true
`

await runProbe(async () => {
  if (!CLIP || !existsSync(CLIP)) {
    throw new PreconditionError('MASK_CLIP must name a clip with a person in it', CLIP ? `${CLIP} does not exist` : 'not set')
  }
  await evaluate(HELPERS)

  // -- 1. the clip, a title, and the tool --------------------------------------------------------
  const setup = await evaluate(`(async () => {
    const [imported] = await window.bay.media.importPaths(${JSON.stringify([CLIP])})
    const asset = imported.asset
    if (asset.error || !asset.hasVideo) return { error: 'the clip did not import as video: ' + (asset.error || asset.kind) }
    const placed = await __mask.mcp('place_asset', { assetId: asset.id, atFrame: 0 })
    if (!placed.ok) return { error: 'place_asset: ' + placed.error }
    const clipId = placed.value.itemId
    const trimmed = await __mask.mcp('edit_item', { itemId: clipId, durationInFrames: ${SPAN} })
    if (!trimmed.ok) return { error: 'edit_item durationInFrames: ' + trimmed.error }
    const s = __mask.state()
    const textAsset = 'ast_mask_probe_' + Date.now()
    s.addAssets([{ id: textAsset, kind: 'text', name: 'BEHIND', path: null, durationUs: 0, width: null, height: null, fps: null,
      hasAudio: false, hasVideo: false, posterPath: null, waveformPath: null, text: 'BEHIND BEHIND', createdAt: Date.now() }])
    const text = await __mask.mcp('place_asset', { assetId: textAsset, atFrame: 0 })
    if (!text.ok) return { error: 'place text: ' + text.error }
    const textId = text.value.itemId
    const sized = await __mask.mcp('edit_item', { itemId: textId, durationInFrames: ${SPAN} })
    if (!sized.ok) return { error: 'edit_item text: ' + sized.error }
    const t0 = performance.now()
    const behind = await __mask.mcp('put_behind_subject', { textItemId: textId, videoItemId: clipId })
    return { clipId, textId, assetId: asset.id, behind, seconds: (performance.now() - t0) / 1000 }
  })()`, 300_000)
  if (setup.error) throw new PreconditionError('setting up the scene', setup.error)
  check('put_behind_subject succeeds on a clip of a person', setup.behind.ok, true)
  const behind = setup.behind.value
  console.log(`      matte: ${JSON.stringify(behind.matte)} in ${setup.seconds.toFixed(1)} s`)
  console.log(`      placed: ${behind.placed}`)
  check('it names the cut-out it made', typeof behind.cutoutItemId, 'string')

  // -- 2. the matte at the frame, and the title moved across the person ----------------------------
  const layout = await evaluate(`(async () => {
    const tl = __mask.timeline()
    const clip = tl.tracks.flatMap((t) => t.items).find((i) => i.id === ${JSON.stringify(setup.clipId)})
    const asset = __mask.state().project.assets.find((a) => a.id === clip.assetId)
    const record = asset.subjectMattes?.[asset.subjectMattes.length - 1]
    if (!record) return { error: 'no matte recorded on the asset' }
    const sourceUs = clip.sourceStartUs + Math.round((${FRAME} - clip.from) / tl.fps * 1e6 * clip.speed) + 500
    const store = window.bayEngine.subjectMattes
    let found = store.lookup(record, sourceUs)
    for (let i = 0; i < 20 && found.pending; i++) { await store.settle(3000); found = store.lookup(record, sourceUs) }
    if (!found.image) return { error: 'matte frame: ' + JSON.stringify(found) }
    const W = tl.width, H = tl.height
    const c = new OffscreenCanvas(W, H); const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(found.image.image, 0, 0, found.image.width, found.image.height, 0, 0, W, H)
    const d = x.getImageData(0, 0, W, H).data
    let minX = W, maxX = -1, minY = H, maxY = -1, n = 0
    for (let y = 0; y < H; y += 2) for (let xx = 0; xx < W; xx += 2) if (d[(y * W + xx) * 4 + 3] > 128) { n++; if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (y < minY) minY = y; if (y > maxY) maxY = y }
    if (n === 0) return { error: 'the matte finds no person at frame ${FRAME}' }
    // The title across the whole width, at the person's upper body: glyphs over and beside them.
    const top = Math.max(0, Math.round(minY + (maxY - minY) * 0.2)), height = Math.round(Math.min(H - top, Math.max(H * 0.3, (maxY - minY) * 0.4)))
    return { W, H, bbox: { minX, maxX, minY, maxY }, top, height, share: (n * 4) / (W * H) }
  })()`, 120_000)
  if (layout.error) throw new PreconditionError('reading the matte', layout.error)
  console.log(`      person at frame ${FRAME}: x ${layout.bbox.minX}–${layout.bbox.maxX}, y ${layout.bbox.minY}–${layout.bbox.maxY} (${(layout.share * 100).toFixed(0)}% of the frame)`)

  // The title's colour: whichever candidate is farthest from every pixel of the clip at that frame.
  const colour = await evaluate(`(async () => {
    const P = await __mask.render(__mask.variant((i) => { if (i.id !== ${JSON.stringify(setup.clipId)}) i.disabled = true }), 320)
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
  const styled = await evaluate(`__mask.mcp('edit_item', { itemId: ${JSON.stringify(setup.textId)}, left: 0, width: ${layout.W}, top: ${layout.top}, height: ${layout.height},
    text: { color: ${JSON.stringify(colour.hex)}, fontSize: ${Math.round(layout.height * 0.8)}, fontWeight: 900, align: 'center', verticalAlign: 'middle' } })`)
  check('the title is restyled across the person', styled.ok, true)
  const inspected = await evaluate(`__mask.mcp('inspect_item', { itemId: ${JSON.stringify(setup.textId)} })`)
  const textHex = inspected.value?.text?.color ?? colour.hex
  console.log(`      title colour ${textHex} (clear of ${(colour.clear * 100).toFixed(1)}% of the clip's pixels)`)

  // -- 3. the five pictures ------------------------------------------------------------------------
  const MAX = 640
  const verdict = await evaluate(`(async () => {
    window.bayEngine.subjectMattes.reset()
    const clipId = ${JSON.stringify(setup.clipId)}, textId = ${JSON.stringify(setup.textId)}, cutId = ${JSON.stringify(behind.cutoutItemId)}
    const M = await __mask.render(__mask.state().project, ${MAX})
    const T = await __mask.render(__mask.variant((i) => { if (i.id === cutId) i.disabled = true }), ${MAX})
    const P = await __mask.render(__mask.variant((i) => { if (i.id === cutId || i.id === textId) i.disabled = true }), ${MAX})
    const G = await __mask.render(__mask.variant((i) => { if (i.id !== textId) i.disabled = true }), ${MAX})
    const U = await __mask.render(__mask.variant((i) => { if (i.id === cutId) delete i.masks }), ${MAX})
    // The matte at render size.
    const tl = __mask.timeline()
    const clip = tl.tracks.flatMap((t) => t.items).find((i) => i.id === clipId)
    const asset = __mask.state().project.assets.find((a) => a.id === clip.assetId)
    const record = asset.subjectMattes[asset.subjectMattes.length - 1]
    const sourceUs = clip.sourceStartUs + Math.round((${FRAME} - clip.from) / tl.fps * 1e6 * clip.speed) + 500
    let found = window.bayEngine.subjectMattes.lookup(record, sourceUs)
    for (let i = 0; i < 20 && found.pending; i++) { await window.bayEngine.subjectMattes.settle(3000); found = window.bayEngine.subjectMattes.lookup(record, sourceUs) }
    const c = new OffscreenCanvas(M.w, M.h); const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(found.image.image, 0, 0, found.image.width, found.image.height, 0, 0, M.w, M.h)
    const A = x.getImageData(0, 0, M.w, M.h).data
    const hex = ${JSON.stringify(textHex)}
    const tc = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
    const dist = (d, i, rgb) => Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2])
    const same = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    const over = [], beside = []
    for (let i = 0; i < G.d.length; i += 4) {
      if (dist(G.d, i, tc) > 30) continue           // a glyph's interior, not its antialiased edge
      if (dist(P.d, i, tc) < 120) continue          // where the clip itself looks like the title, nothing can be told
      const a = A[i + 3]
      if (a > 230) over.push(i)
      else if (a < 25) beside.push(i)
    }
    const share = (list, test) => list.length ? list.filter(test).length / list.length : 0
    return {
      size: [M.w, M.h], complete: [M, T, P, G, U].map((r) => r.pending === 0 && r.placeholders === 0), unresolved: M.unresolved,
      overCount: over.length, besideCount: beside.length,
      besideVisible: share(beside, (i) => dist(M.d, i, tc) < 90),
      overHidden: share(over, (i) => same(M.d, P.d, i) < 45),
      controlOverVisibleWithoutMask: share(over, (i) => dist(T.d, i, tc) < 90),
      controlBesideHiddenByUnmaskedCopy: share(beside, (i) => same(U.d, P.d, i) < 45),
      over, beside
    }
  })()`, 180_000)
  console.log(`      ${verdict.size.join('x')}: ${verdict.overCount} glyph pixels over the person, ${verdict.besideCount} beside`)
  check('every render is complete (no pending, no placeholder)', verdict.complete.every(Boolean), true)
  if (verdict.overCount < 150 || verdict.besideCount < 150) {
    throw new PreconditionError('the title must cover some of the person and some of the background', `${verdict.overCount} over, ${verdict.besideCount} beside`)
  }
  const pc = (n) => `${(n * 100).toFixed(1)}%`
  check(`beside the person the title is visible (${pc(verdict.besideVisible)})`, verdict.besideVisible, (v) => v >= 0.85)
  check(`over the person the title is hidden (${pc(verdict.overHidden)})`, verdict.overHidden, (v) => v >= 0.85)
  check(`control: without the mask the title is visible over the person (${pc(verdict.controlOverVisibleWithoutMask)})`, verdict.controlOverVisibleWithoutMask, (v) => v >= 0.85)
  check(`control: an unmasked cut-out hides the title beside the person too (${pc(verdict.controlBesideHiddenByUnmaskedCopy)})`, verdict.controlBesideHiddenByUnmaskedCopy, (v) => v >= 0.85)

  // -- 4. export vs preview_frame ------------------------------------------------------------------
  const [W, H] = verdict.size
  const outDir = join(homedir(), 'Movies', 'bay')
  await mkdir(outDir, { recursive: true })
  const outputPath = join(outDir, `mask-probe-${Date.now()}.mp4`)
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
  check('the export wrote every frame complete (the matte was waited for)', exported.incomplete === null ? 'complete' : JSON.stringify(exported.incomplete), 'complete')
  const raw = join(outDir, `mask-probe-${Date.now()}.rgb`)
  await run(FFMPEG, ['-v', 'error', '-i', outputPath, '-vf', `select=eq(n\\,${FRAME - from}),zscale=min=709:rin=limited:m=709:r=full,format=rgb24`, '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-s', `${W}x${H}`, '-y', raw])
  const bytes = await readFile(raw)
  const compare = await evaluate(`(async () => {
    const e = ${JSON.stringify(Array.from(bytes))}
    const M = await __mask.render(__mask.state().project, ${MAX})
    const T = await __mask.render(__mask.variant((i) => { if (i.id === ${JSON.stringify(behind.cutoutItemId)}) i.disabled = true }), ${MAX})
    const P = await __mask.render(__mask.variant((i) => { if (i.id === ${JSON.stringify(behind.cutoutItemId)} || i.id === ${JSON.stringify(setup.textId)}) i.disabled = true }), ${MAX})
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
  check('the exported frame matches preview_frame (per-channel mean within 3)', compare.exportMean.every((v, i) => Math.abs(v - compare.previewMean[i]) <= 3), true)
  check(`in the export the title shows beside the person (${pc(compare.besideVisible)})`, compare.besideVisible, (v) => v >= 0.8)
  check(`in the export the title is hidden over the person (${pc(compare.overHidden)})`, compare.overHidden, (v) => v >= 0.8)
  check(`comparison control: the export does not match the unmasked picture over the person (${pc(compare.overMatchesUnmasked)})`, compare.overMatchesUnmasked, (v) => v <= 0.2)
  await rm(outputPath, { force: true })
  await rm(raw, { force: true })
  return true
}, { timeoutMs: Number(process.env.PROBE_TIMEOUT_MS) || 600_000 })
