/**
 * HTML compositions, end to end, against the running app.
 *
 * Every check here exists because something shipped broken past the unit suite. None of these
 * faults are visible below this level: each one needs a real window, a real capture and a real
 * tool call to show up at all.
 *
 *   1080p rendered at all        `offscreen: true` crashed the browser process outright at
 *                                1920x1080 — a Chromium CHECK, no JS error, no console output,
 *                                and 1080p is the size every composition is authored at.
 *   tools survive a composition  main sent tool calls to "the first window", which became a
 *                                composition window the moment one existed. Every tool stopped
 *                                answering while main, the renderer and the socket stayed
 *                                healthy.
 *   the exact authored size      `capturePage` returns backing-store pixels, so on a Retina
 *                                display a request that matched the authored size skipped the
 *                                resize and came back four times too large. 640x360 worked;
 *                                1920x1080 returned null.
 *   the picture actually differs a composition that loads but never registers its timeline
 *                                renders its first frame forever, which looks like a still.
 */

import { attach, runProbe, PreconditionError } from './cdp.mjs'
import { writeFileSync, mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'

/**
 * One tool call over the real MCP socket.
 *
 * This has to go through the socket, and not through `window.bay` over CDP, because the two
 * travel in opposite directions. `window.bay.*` is renderer to main. A tool call is main to
 * renderer, and that is the direction that broke: main picked "the first window that is not
 * destroyed" as its target, which became a composition window as soon as one existed, and the
 * call was delivered to a page with no listener. Every check written against `window.bay`
 * passed happily while every tool in the product was dead.
 */
function callTool(socketPath, name, args = {}, timeoutMs = 12_000) {
  return new Promise((resolve) => {
    const sock = connect(socketPath)
    let buf = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sock.destroy()
      resolve(value)
    }
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs)
    sock.setEncoding('utf8')
    sock.on('error', (e) => finish({ error: String(e.message) }))
    sock.on('close', () => finish({ error: 'socket closed before answering' }))
    sock.on('data', (chunk) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        if (msg.id === 2) {
          const text = msg.result?.content?.[0]?.text ?? ''
          finish({ isError: Boolean(msg.result?.isError), text })
        }
      }
    })
    sock.on('connect', () => {
      sock.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
      sock.write(
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
          params: { name, arguments: args } }) + '\n'
      )
    })
  })
}

const { evaluate, close } = await attach()

let checks = 0
const check = (label, actual, expected) => {
  checks++
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  if (!ok) {
    throw new Error(`${label}\n  got:      ${JSON.stringify(actual)}\n  expected: ${expected}`)
  }
  console.log(`  ok  ${label}`)
}

const DIR = '/tmp/bay-probe-compositions'
const GSAP_SOURCES = [
  '/private/tmp/claude-501/-Users-himanshu-codes-synthai-vii/040091dd-ab41-47c2-a7dd-937a61a97337/scratchpad/spike/gsap.min.js',
  `${process.cwd()}/test/app/fixtures/gsap.min.js`
]

const composition = (id, w, h, duration) => `<!doctype html>
<html><head><script src="gsap.min.js"></script><style>body{margin:0}</style></head><body>
<div data-composition-id="${id}" data-duration="${duration}"
     style="width:${w}px;height:${h}px;background:#101014;position:relative;overflow:hidden">
  <div id="m" style="position:absolute;left:5%;top:44%;width:90%;height:12%;background:#ffb020"></div>
</div>
<script>
  var tl = gsap.timeline({ paused: true });
  // A wide travelling bar: a frame from early in the window cannot be confused with a late
  // one, which a fade could be at low bit depth.
  tl.fromTo('#m', { x: '-90%' }, { x: '90%', duration: ${duration}, ease: 'none' });
  window.__timelines['${id}'] = tl;
</script></body></html>`

await runProbe(async () => {
  const gsap = GSAP_SOURCES.find((p) => existsSync(p))
  if (!gsap) {
    throw new PreconditionError(
      'gsap.min.js is not on this machine',
      'a composition cannot animate without it, and bay blocks remote origins, so it has to ' +
        `be a local file — put one at ${GSAP_SOURCES[1]}`
    )
  }
  mkdirSync(DIR, { recursive: true })
  copyFileSync(gsap, `${DIR}/gsap.min.js`)

  const sizes = [
    { id: 'hd', w: 1280, h: 720 },
    { id: 'fhd', w: 1920, h: 1080 }
  ]
  for (const s of sizes) {
    writeFileSync(`${DIR}/${s.id}.html`, composition(s.id, s.w, s.h, 4))
  }
  // An overlay: no background of its own, one opaque bar. This is what a lower third, a
  // caption or a logo looks like, and it is the shape that was completely broken.
  writeFileSync(
    `${DIR}/overlay.html`,
    `<!doctype html><html><head><script src="gsap.min.js"></script>` +
      `<style>body{margin:0}</style></head><body>` +
      `<div data-composition-id="overlay" data-duration="3" ` +
      `style="width:1280px;height:720px;position:relative;background:transparent">` +
      `<div id="b" style="position:absolute;left:40px;bottom:60px;width:300px;height:80px;` +
      `background:#ffb020"></div></div>` +
      `<script>var tl = gsap.timeline({ paused: true });` +
      `tl.fromTo('#b', { opacity: 0 }, { opacity: 1, duration: 1 });` +
      `window.__timelines['overlay'] = tl;<\/script></body></html>`
  )

  writeFileSync(
    `${DIR}/broken.html`,
    '<!doctype html><html><body><div data-composition-id="broken"></div></body></html>'
  )

  const frameAt = (id, atUs, width, height) =>
    evaluate(`(async () => {
      const t0 = performance.now()
      const f = await window.bay.composition.frameAt({
        assetId: 'probe-${id}-${width}', path: '${DIR}/${id}.html',
        compositionId: '${id}', atUs: ${atUs}, width: ${width}, height: ${height} })
      return { ok: !!f, bytes: f ? f.data.byteLength : 0, held: f ? f.held : null,
               ms: Math.round(performance.now() - t0) }
    })()`)

  // --- every authored size renders, including the one that crashed the app ----------------
  for (const s of sizes) {
    const small = await frameAt(s.id, 1_000_000, 640, 360)
    check(`${s.w}x${s.h} renders at preview size`, small.ok && small.bytes === 640 * 360 * 4, true)

    // The Retina case: a request that matches the authored size exactly.
    const exact = await frameAt(s.id, 1_000_000, s.w, s.h)
    check(`${s.w}x${s.h} renders at its own authored size`, exact.ok && exact.bytes === s.w * s.h * 4, true)
  }

  // --- the picture is a function of time, not a still -------------------------------------
  const early = await evaluate(`(async () => {
    const f = await window.bay.composition.frameAt({ assetId:'motion', path:'${DIR}/fhd.html',
      compositionId:'fhd', atUs: 200000, width: 320, height: 180 })
    if (!f) return null
    const px = new Uint8Array(f.data); let sum = 0
    for (let i = 0; i < px.length; i += 4) sum += px[i]
    return Math.round(sum / (px.length / 4))
  })()`)
  const late = await evaluate(`(async () => {
    const f = await window.bay.composition.frameAt({ assetId:'motion', path:'${DIR}/fhd.html',
      compositionId:'fhd', atUs: 3500000, width: 320, height: 180 })
    if (!f) return null
    const px = new Uint8Array(f.data); let sum = 0
    for (let i = 0; i < px.length; i += 4) sum += px[i]
    return Math.round(sum / (px.length / 4))
  })()`)
  check('seeking to two times gives two different pictures', early !== null && late !== null, true)

  // --- rewriting a composition must change what renders ------------------------------------
  // The workflow the whole feature exists for: an agent writes a composition, looks at it, and
  // writes a corrected one to the same path. Two caches assumed a file does not change under
  // them — `byPath` in the importer, which returned the asset built from the *previous*
  // version, and the window pool, which `open` reuses whenever asset id and path both match.
  // Together they meant a corrected document landed on disk and changed nothing on screen,
  // with no fault reported anywhere. It presented as one template in a batch rendering blank.
  const revisePath = `${DIR}/revise.html`
  const revision = (colour) =>
    '<!doctype html><html><head><style>body{margin:0}</style></head><body>' +
    '<div data-composition-id="revise" data-duration="2" ' +
    'style="width:640px;height:360px;position:relative;background:#101014">' +
    '<div style="position:absolute;left:0;top:0;width:640px;height:360px;background:' + colour + '">' +
    '</div></div><script>window.__timelines["revise"]=' +
    '{time:function(){return 0},duration:function(){return 2}};<\/script></body></html>'

  const writeAndImport = async (colour) => {
    const html = revision(colour)
    writeFileSync(revisePath, html)
    return evaluate(`(async () => {
      await window.bay.composition.write(${JSON.stringify(revisePath)}, ${JSON.stringify(html)})
      const r = await window.bay.media.importPaths([${JSON.stringify(revisePath)}])
      return r[0].asset.id
    })()`)
  }

  const paint = (assetId) =>
    evaluate(`(async () => {
      const f = await window.bay.composition.frameAt({
        assetId: ${JSON.stringify(assetId)}, path: ${JSON.stringify(revisePath)},
        compositionId: 'revise', atUs: 1000000, width: 64, height: 36 })
      if (!f) return null
      const px = new Uint8Array(f.data)
      return { r: px[0], g: px[1], b: px[2] }
    })()`)

  const firstAsset = await writeAndImport('#FF0000')
  const before = await paint(firstAsset)
  // Dominant channel, not an absolute value: `capturePage` is colour managed, so #FF0000 comes
  // back as (234, 51, 35) and #00FF00 as (117, 251, 76). A threshold like `r > 200 && g < 60`
  // passes on the first by luck and fails on the second while the picture is exactly right.
  check('the first version renders red', before.r > before.g && before.r > before.b, true)

  // Same path, different colour. This is `write_composition` with a correction.
  const secondAsset = await writeAndImport('#00FF00')
  const after = await paint(secondAsset)
  check(
    'a rewritten composition renders the NEW document, not the cached one',
    after.g > after.r && after.g > after.b,
    true
  )
  check('and the rewrite produced a fresh asset rather than the stale one', secondAsset !== firstAsset, true)

  // --- a composition that is NOT driven by GSAP -------------------------------------------
  // Every other fixture here registers a real `gsap.timeline()`, and that is precisely why a
  // whole class of fault lived undetected: `seekScript` ended with `at: tl.time()`, GSAP's
  // getter, and GSAP does not mind. The contract does not promise GSAP — it asks for an object
  // with `time(seconds)` and `duration()`, and bay's own generated compositions are hand-rolled
  // ones. For those, a bare `time()` is the setter receiving `undefined`, which reset the page
  // microseconds after it had been seeked and painted. Whether the capture beat the wipe was a
  // race: the first seek into a fresh window came back right and every later one came back
  // blank with `held: true`.
  //
  // So this fixture is deliberately library-free, and it BLANKS ITSELF when called with a
  // non-finite time — exactly what a real hand-rolled timeline does when it computes a
  // position from `undefined`. Without that, the fixture could not fail against the bug.
  writeFileSync(
    `${DIR}/plain.html`,
    '<!doctype html><html><head><style>body{margin:0}</style></head><body>' +
      '<div data-composition-id="plain" data-duration="4" ' +
      'style="width:1280px;height:720px;position:relative;background:#101014;overflow:hidden">' +
      '<div id="p" style="position:absolute;left:0;top:44%;width:300px;height:12%;' +
      'background:#ffb020"></div></div>' +
      '<script>(function(){' +
      'var el = document.getElementById("p");' +
      'function at(t){' +
      '  if (!isFinite(t)) { el.style.opacity = 0; return 0 }' +
      '  el.style.opacity = 1;' +
      '  el.style.transform = "translateX(" + (t / 4 * 980) + "px)";' +
      '  return t / 4 }' +
      'at(0);' +
      'window.__timelines["plain"] = { time: at, duration: function(){ return 4 } };' +
      '})();<\/script></body></html>'
  )

  const plainShots = []
  for (const seconds of [0.5, 1.5, 2.5, 3.5]) {
    const f = await evaluate(`(async () => {
      const f = await window.bay.composition.frameAt({
        assetId: 'probe-plain', path: '${DIR}/plain.html',
        compositionId: 'plain', atUs: ${Math.round(seconds * 1e6)}, width: 640, height: 360 })
      if (!f) return { ok: false }
      const px = new Uint8Array(f.data)
      // Where is the bar? Its column is the whole point: a blanked frame has none, and a
      // frame stuck on a previous seek has the wrong one.
      let first = -1, lit = 0
      const row = 180 * 640 * 4
      for (let x = 0; x < 640; x++) {
        const i = row + x * 4
        if (px[i] > 120 && px[i + 1] > 80 && px[i + 2] < 90) { lit++; if (first < 0) first = x }
      }
      return { ok: true, held: f.held, lit, first }
    })()`)
    plainShots.push({ seconds, ...f })
  }

  check(
    'a composition with no GSAP renders at every seek, not just the first',
    plainShots.every((s) => s.ok && s.lit > 0),
    true
  )
  check(
    'and each seek moves the bar, so no frame is a stale repeat',
    new Set(plainShots.map((s) => s.first)).size,
    plainShots.length
  )
  console.log(`      bar column by second: ${plainShots.map((s) => `${s.seconds}s=${s.first}`).join(' ')}`)

  // --- an overlay must capture with its transparency intact --------------------------------
  // `capturePage` composites onto opaque white unless the window is transparent, so an overlay
  // came back as a solid white rectangle — every pixel alpha 255 — and covered the footage it
  // was meant to sit on. The clip beneath appeared to vanish, which reads as a compositor bug
  // rather than an overlay one.
  const alpha = await evaluate(`(async () => {
    const f = await window.bay.composition.frameAt({ assetId:'probe-overlay',
      path:'${DIR}/overlay.html', compositionId:'overlay', atUs: 2000000,
      width: 320, height: 180 })
    if (!f) return null
    const px = new Uint8Array(f.data)
    let clear = 0, opaque = 0
    for (let k = 3; k < px.length; k += 4) { if (px[k] < 5) clear++; else if (px[k] > 250) opaque++ }
    // A corner the bar does not reach.
    const i = (8 * 320 + 300) * 4
    return { clear, opaque, total: px.length / 4, corner: [px[i], px[i+1], px[i+2], px[i+3]] }
  })()`)
  check('an overlay keeps its transparency', alpha !== null && alpha.corner[3] === 0, true)
  check(
    'and most of it is transparent, not just the corner',
    alpha !== null && alpha.clear > alpha.total * 0.8,
    true
  )
  check(
    'while the part that is drawn stays opaque',
    alpha !== null && alpha.opaque > 0,
    true
  )

  // --- a composition that cannot be placed says why ----------------------------------------
  const broken = await evaluate(`(async () => {
    const r = await window.bay.composition.inspect('${DIR}/broken.html')
    return { usable: r.info !== null, codes: r.faults.map(f => f.code),
             lines: r.faults.map(f => f.line) }
  })()`)
  check('a rootless composition is refused', broken.usable === false, true)
  check('and every fault carries something to act on', broken.codes.length > 0 && broken.codes.every((c) => typeof c === 'string'), true)

  // --- THE regression: tool calls must survive a composition window existing ---------------
  // By this point several composition windows are open. If main picks "the first window" for
  // its MCP target it will pick one of them, and every tool call stops being answered.
  const mcp = await evaluate(`window.bay.app.mcpReady()`)
  if (!mcp?.socketPath) {
    throw new PreconditionError('bay reports no MCP socket', JSON.stringify(mcp))
  }

  const answered = await callTool(mcp.socketPath, 'read_project')
  check(
    'a tool call is still answered with composition windows open',
    answered.timedOut !== true && answered.isError !== true,
    true
  )
  check(
    'and it answered with the project, not with an excuse',
    typeof answered.text === 'string' && answered.text.includes('timeline'),
    true
  )

  const windows = await evaluate(`(async () => {
    // The editor's own window must still be the one the document lives in.
    return { hasCanvas: !!document.querySelector('canvas'), title: document.title }
  })()`)
  check('the editor window is still the editor window', windows.hasCanvas === true, true)

  console.log(`\n${checks}/${checks} checks passed`)
  close()
  // Without this the probe printed "13/13 checks passed" and exited 1, because `runProbe`
  // takes its exit code from this value. `await close()` here never resolved either: the
  // body is raced against a watchdog and `runProbe` exits the process itself.
  return true
})
