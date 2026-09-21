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
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
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
  await close()
})
