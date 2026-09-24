/**
 * The shipped templates, rendered.
 *
 * `src/shared/templates.test.ts` proves every template *parses*: no fatal faults, a catalog
 * that matches the file, a default for every variable. None of that is a picture. A composition
 * can satisfy the whole contract and draw nothing — an element positioned off its own root, an
 * opacity that never leaves zero, a variable bound to an id no element carries. Every one of
 * those is a blank overlay and none of them is an error.
 *
 * So this asks the questions only pixels can answer, for every template bay ships:
 *
 * 1. **Does it draw?** Opaque pixels exist part-way through.
 * 2. **Is it an overlay?** Most of the frame is still transparent — a template that paints its
 *    own background hides the footage under it, and looks deliberate doing so.
 * 3. **Does it animate?** A frame near the start differs from the middle. Not "differs
 *    somewhere": these all enter from nothing, so a still template means the timeline never
 *    ran, which is what the `tl.time()` bug did for forty seconds.
 * 4. **Do its variables reach the picture?** Declared, accepted by `edit_item`, stored, read
 *    back — and still absent from the frame if the id matches no element. Only a re-render with
 *    a changed value can tell, and the value is derived from what is there rather than written
 *    as a literal, so the check cannot pass by accident against a default that already matched.
 * 5. **Does it survive the whole pipeline?** One template placed on a real timeline and
 *    exported, then the frames counted in the file.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { attach, runProbe, PreconditionError, ProbeFailure } from './cdp.mjs'

const SRC = `${process.cwd()}/src/main/templates`
const DIR = '/tmp/bay-probe-templates'
const { evaluate, close } = await attach()

let checks = 0
const check = (label, actual, expected) => {
  checks++
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) throw new ProbeFailure(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  console.log(`  ok  ${label}`)
}

await runProbe(async () => {

if ((await evaluate(`Boolean(window.bayMcp && window.bayEngine)`)) !== true) {
  throw new PreconditionError('window.bayMcp / window.bayEngine absent', 'bay.debug needs a reload')
}
mkdirSync(DIR, { recursive: true })

let n = 0
const mcp = async (tool, args = {}) => {
  const r = await evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `t${++n}`, tool, args })})`, 120_000)
  if (!r.ok) throw new Error(`${tool} refused: ${r.error}`)
  return r.value
}

/**
 * Raw RGBA straight from the composition window, so the numbers are the composition's own and
 * not something the compositor did to it.
 *
/**
 * The CSS form of a set of values, exactly as `cssVariables` in `@shared/composition` builds it.
 *
 * The rule that matters is the unit: a `number` variable declaring `unit: 'px'` becomes
 * `"10px"`, and sending the bare `10` makes `height: var(--thickness)` an invalid length. The
 * property then computes to nothing, the bar has no height, and the template draws zero pixels
 * — which is what this probe reported for `progress` the moment it started sending defaults.
 * Mirrored rather than imported because this file runs as plain Node against the built app.
 */
const cssForm = (specs, values) => {
  const out = {}
  for (const spec of specs) {
    const value = values[spec.id]
    if (value === undefined) continue
    out[spec.id] = spec.type === 'number' && spec.unit ? `${value}${spec.unit}` : String(value)
  }
  return out
}

/** * **Both variable fields, because the request has two and they do different jobs.**
 * `variables` drives `data-var-text` / `data-var-src`; `cssVariables` becomes the `--{id}`
 * custom properties, which is how every colour and every position in these templates is bound.
 * The renderer fills both (`compositionPool.ts` calls `cssVariables(info, values)`); a probe
 * that sent only the first changed no colour and read as a template ignoring its own variable.
 * A hand-assembled request has to assemble the whole request.
 */
const shoot = (assetId, path, id, seconds, variables = {}, specs = []) =>
  evaluate(`(async () => {
    const f = await window.bay.composition.frameAt({
      assetId: ${JSON.stringify(assetId)}, path: ${JSON.stringify(path)},
      compositionId: ${JSON.stringify(id)}, atUs: ${Math.round(seconds * 1e6)},
      width: 540, height: 960,
      variables: ${JSON.stringify(variables)},
      cssVariables: ${JSON.stringify(cssForm(specs, variables))} })
    if (!f) return null
    const px = new Uint8Array(f.data)
    let opaque = 0, solid = 0, total = 0, sig = 0, r = 0, g = 0, b = 0
    // EVERY pixel. Sampling one in four first, for speed, made the thin-stroke checks flaky:
    // a callout's 2px border is one pixel after the capture is halved, and a 1-in-4 walk can
    // step straight over it — so recolouring the border changed nothing the digest could see.
    // It passed once and failed after, which is the worst way for a check to be wrong.
    for (let i = 0; i < px.length; i += 4) {
      total++
      const a = px[i + 3]
      if (a > 40) { r += px[i]; g += px[i + 1]; b += px[i + 2] }
      // Two thresholds, because they answer different questions. \`opaque\` is "something was
      // painted here at all". \`solid\` is "the footage underneath is gone". A title card's
      // scrim is deliberately the first and deliberately not the second — it dims a shot so
      // type reads over it, and at 0.72 that is alpha 184, visible everywhere and hiding
      // nothing. Counting a scrim as a fill accused two working templates.
      if (a > 40) opaque++
      if (a >= 250) solid++
      // Cheap order-dependent digest: two frames that differ anywhere differ here.
      sig = (sig * 31 + px[i] + px[i + 1] * 3 + px[i + 2] * 7 + a * 11) >>> 0
    }
    return { opaque, solid, total, sig, r, g, b, held: f.held }
  })()`, 90_000)

/**
 * Drop this composition's offscreen window.
 *
 * **Not tidiness — the pool holds eight windows and evicts the least recently used.** Seven
 * templates plus a control fills it exactly, so every shot after that evicted some other
 * template's window, and which one depended on how many windows earlier runs had left behind.
 * Checks then passed or failed by eviction order: the same assertion passed on one run and
 * failed on the next with the files untouched, and one template reported zero pixels drawn.
 * Finishing with each template before opening the next keeps one composition window alive at a
 * time and makes the result independent of whatever ran before.
 */
const release = (assetId) =>
  evaluate(`window.bay.composition.release(${JSON.stringify(assetId)}).then(() => true)`, 30_000)

const templates = readdirSync(SRC).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort()
check('every shipped template is on disk to test', templates.length, (c) => c >= 7)
console.log(`      ${templates.join('  ')}`)

/**
 * One template at a time, from import to release.
 *
 * Importing all seven and *then* measuring them is what made this probe unreliable: each
 * import opens a window, the pool holds eight, and the measurement loop then ran against a
 * pool that was already evicting. `lower-third` came back with zero pixels drawn — a template
 * that renders perfectly when it is the only one open. The failure moved with the batch size
 * rather than with the file, which is the tell.
 *
 * Doing the whole job for one template before touching the next is also how an agent works,
 * so the probe now exercises the order the product is actually used in.
 */
const pipelineTemplate = { id: 'lower-third' }
console.log('\n── every template draws, stays transparent, moves, and hears its variables')
for (const id of templates) {
  const path = `${DIR}/${id}.html`
  const html = readFileSync(`${SRC}/${id}.html`, 'utf8')
  writeFileSync(path, html)
  const w = await mcp('write_composition', { path, html, import: true })
  if (!w.usable) throw new PreconditionError(`${id} is not usable`, JSON.stringify(w))
  const t = { id, path, assetId: w.assetId, seconds: w.durationSeconds, variables: w.variables ?? [] }
  if (id === pipelineTemplate.id) Object.assign(pipelineTemplate, t)
  // The renderer resolves every declared variable against its default before sending the
  // request, so a template in the app never renders with an unset variable. Shooting with `{}`
  // instead let each template fall back to the value written in its own CSS — which meant a
  // declared default and a CSS fallback could disagree and nothing here would notice, and a
  // mutation that changed a declared default changed no pixel. Send what production sends.
  const defaults = Object.fromEntries(
    t.variables.filter((v) => v.default !== undefined).map((v) => [v.id, v.default])
  )
  const early = await shoot(t.assetId, t.path, t.id, t.seconds * 0.06, defaults, t.variables)
  const mid = await shoot(t.assetId, t.path, t.id, t.seconds * 0.5, defaults, t.variables)
  if (!early || !mid) throw new Error(`${t.id}: the composition returned no frame`)

  const painted = ((mid.opaque / mid.total) * 100).toFixed(1)
  const hidden = ((mid.solid / mid.total) * 100).toFixed(1)
  console.log(`   ${t.id.padEnd(12)} mid  painted ${painted.padStart(5)}%   hides ${hidden.padStart(5)}%`)

  check(`${t.id}: draws something at its midpoint`, mid.opaque, (v) => v > 0)
  check(
    `${t.id}: leaves the footage visible — dims it at most, never replaces it`,
    mid.solid / mid.total,
    (f) => f < 0.97
  )
  check(`${t.id}: the picture changes between its entrance and its middle`, early.sig !== mid.sig, true)

  const colour = t.variables.find((v) => v.type === 'color')
  const text = t.variables.find((v) => v.type === 'string')
  const at = t.seconds * 0.5

  if (colour) {
    // Two shots that differ in this one variable and nothing else — not "default versus a
    // value", which also differs in every variable left unset. Both values are chosen against
    // the template's own default so neither can accidentally be what it already draws.
    const current = String(colour.default ?? '').toUpperCase()
    const a = current === '#FF00AA' ? '#00FFAA' : '#FF00AA'
    const b = current === '#1188FF' ? '#FFAA11' : '#1188FF'
    const one = await shoot(t.assetId, t.path, t.id, at, { ...defaults, [colour.id]: a }, t.variables)
    const two = await shoot(t.assetId, t.path, t.id, at, { ...defaults, [colour.id]: b }, t.variables)
    // Channel sums rather than the digest: a colour change must move colour, and a digest
    // that happens to collide says nothing about what moved.
    const moved = Math.abs(one.r - two.r) + Math.abs(one.g - two.g) + Math.abs(one.b - two.b)
    check(`${t.id}: "${colour.id}" reaches the pixels`, moved, (v) => v > one.opaque * 0.02)
  } else if (text) {
    const one = await shoot(t.assetId, t.path, t.id, at, { ...defaults, [text.id]: 'IIII IIII' }, t.variables)
    const two = await shoot(t.assetId, t.path, t.id, at, { ...defaults, [text.id]: 'WWWW MMMM WWWW' }, t.variables)
    // Different glyph widths, so the painted area must differ even if the colour cannot.
    check(`${t.id}: "${text.id}" reaches the pixels`, one.opaque !== two.opaque, true)
  } else {
    throw new Error(`${t.id} declares no colour or string variable to verify`)
  }

  await release(t.assetId)
}

console.log('\n── the probe can see a template that does not draw')
// A negative control for every assertion above. Without it, "it drew" proves nothing: a
// measurement that reports success for a blank composition is not a measurement.
const blankPath = `${DIR}/blank.html`
writeFileSync(
  blankPath,
  '<!doctype html><html><body><div data-composition-id="blank" data-duration="2" ' +
    'style="width:1080px;height:1920px;position:relative"><div id="x" style="position:absolute;' +
    'left:40px;top:40px;width:400px;height:120px;background:#ffb020;opacity:0"></div></div>' +
    '<script>window.__timelines["blank"]={time:function(){return 0},duration:function(){return 2}};<\/script>' +
    '</body></html>'
)
const blankAsset = await mcp('write_composition', { path: blankPath, html: readFileSync(blankPath, 'utf8'), import: true })
const blankShot = await shoot(blankAsset.assetId, blankPath, 'blank', 1)
check('a composition that paints nothing reports no opaque pixels', blankShot.opaque, 0)
await release(blankAsset.assetId)

console.log('\n── one template through the whole pipeline')
const existing = await evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  const t = s.project.timelines.find(x => x.id === s.project.activeTimelineId)
  return t.tracks.flatMap(k => k.items).map(i => i.id)
})()`)
if (existing.length) await mcp('delete_items', { itemIds: existing })

// Re-imported rather than reusing the id from the loop above, whose window was released.
const pickHtml = readFileSync(`${SRC}/${pipelineTemplate.id}.html`, 'utf8')
const pickWritten = await mcp('write_composition', {
  path: `${DIR}/${pipelineTemplate.id}.html`, html: pickHtml, import: true
})
const pick = { ...pipelineTemplate, assetId: pickWritten.assetId }
// No `add_track`: bay picks a free one, and a probe that adds a track per run leaves the
// timeline a little different for whatever runs next. Two other probes assume a shape.
const item = (await mcp('place_asset', { assetId: pick.assetId, atFrame: 0 })).itemId
const placed = await mcp('inspect_item', { itemId: item })
check(`${pick.id} places at its declared length`, placed.timing.durationInFrames, Math.round(pick.seconds * 30))
check('and on a video track', placed.track.kind, 'video')
check('and the inspector can see what it accepts', (placed.asset.compositionVariables ?? []).length, pick.variables.length)

let frame = null
for (let i = 0; i < 40; i++) {
  frame = await mcp('preview_frame', { frame: Math.round(pick.seconds * 30 * 0.5) })
  if (!frame.incomplete) break
  await new Promise((r) => setTimeout(r, 500))
}
check('it composites onto the timeline', frame.incomplete, undefined)
check('and the frame carries the item', frame.itemsDrawn, (d) => d >= 1)

// The same question as the variables section, asked through the route an agent takes rather
// than through a request this file assembled: `edit_item` -> the store -> the renderer's own
// `cssVariables` -> the window. Comparing the returned PNGs is enough to answer "did the
// picture change", because an unchanged picture encodes to identical bytes.
const colourVar = pick.variables.find((v) => v.type === 'color')
if (colourVar) {
  const before = frame.image
  const current = String(colourVar.default ?? '').toUpperCase()
  const next = current === '#FF00AA' ? '#00FFAA' : '#FF00AA'
  await mcp('edit_item', { itemId: item, variables: { [colourVar.id]: next } })
  let after = null
  for (let i = 0; i < 40; i++) {
    after = await mcp('preview_frame', { frame: Math.round(pick.seconds * 30 * 0.5) })
    if (!after.incomplete && after.image !== before) break
    await new Promise((r) => setTimeout(r, 500))
  }
  check(`${pick.id}: "${colourVar.id}" set through edit_item changes the composited frame`,
    after.image !== before, true)
  check('and the value reads back from the item', 
    (await mcp('inspect_item', { itemId: item })).variables?.[colourVar.id], next)
}

const out = `${DIR}/export.mp4`
const job = await mcp('export_timeline', { outputPath: out, format: 'mp4' })
let last = null
for (let i = 0; i < 600; i++) {
  last = await mcp('track_export', { jobId: job.jobId })
  if (last.stage === 'done' || last.stage === 'failed') break
  await new Promise((r) => setTimeout(r, 500))
}
check('the export finishes', last.stage, 'done')
const counted = Number(
  execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out]).toString().trim()
)
console.log(`      wrote ${counted} frames, reported ${last.framesDone}`)
check('and the file holds every frame it reported', counted, last.framesDone)

await mcp('delete_items', { itemIds: [item] })
console.log(`\n${checks}/${checks} checks passed`)
close()
return true

}, { timeoutMs: 15 * 60 * 1000 })
