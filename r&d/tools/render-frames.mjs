// Deterministic page renderer: steps a headless Chrome one frame at a time on a virtual clock,
// so a page's timers, requestAnimationFrame, performance.now and CSS/Web animations all advance
// by exactly 1/fps per frame — no dropped or held frames, however slow a frame is to paint.
// Sub-frames (--sub N) are averaged per output frame for motion blur (a 180° shutter).
//
//   node render-frames.mjs --url <url> --out <file.mp4> --seconds <s>
//        [--width 3840 --height 2160] [--fps 60] [--sub 2] [--before <js file>]... [--script <js>]
//        [--setup <js expr>] [--run <js expr returning a promise>] [--quality 92] [--log <file>]
//
// --before files are evaluated in order once the page has loaded (e.g. prep.js, film.js, takes.js);
// --setup runs next (before frame 0); --run is started at frame 0 and keeps running on virtual
// time while frames are captured; its resolved value is written to --log.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : argv[i + 1] }
const many = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []))
const URL_ = opt('url'), OUT = opt('out'), SECONDS = Number(opt('seconds', 5))
const W = Number(opt('width', 3840)), H = Number(opt('height', 2160))
const FPS = Number(opt('fps', 60)), SUB = Math.max(1, Number(opt('sub', 2))), Q = Number(opt('quality', 92))
const SHELL = opt('shell', `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`)
if (!URL_ || !OUT) { console.error('need --url and --out'); process.exit(2) }

const profile = mkdtempSync(join(tmpdir(), 'render-frames-'))
const chrome = spawn(SHELL, [
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--mute-audio',
  '--run-all-compositor-stages-before-draw', '--disable-threaded-animation', '--disable-threaded-scrolling',
  '--disable-checker-imaging', '--disable-new-content-rendering-timeout', '--disable-image-animation-resync',
  `--window-size=${W},${H}`, '--force-device-scale-factor=1'
], { stdio: ['ignore', 'ignore', 'pipe'] })
const wsUrl = await new Promise((res, rej) => {
  let buf = ''
  chrome.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\S+)/); if (m) res(m[1]) })
  chrome.on('exit', (c) => rej(new Error('chrome exited ' + c + '\n' + buf)))
})

const sock = new WebSocket(wsUrl)
await new Promise((r) => sock.addEventListener('open', r, { once: true }))
let seq = 0
const waiting = new Map(), listeners = []
sock.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result) }
  else if (m.method) for (const l of listeners) l(m)
})
const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); sock.send(JSON.stringify({ id, method, params, sessionId })) })
const once = (method, sessionId) => new Promise((res) => { const l = (m) => { if (m.method === method && (!sessionId || m.sessionId === sessionId)) { listeners.splice(listeners.indexOf(l), 1); res(m.params) } }; listeners.push(l) })

const { targetId } = await call('Target.createTarget', { url: 'about:blank', width: W, height: H })
const { sessionId: S } = await call('Target.attachToTarget', { targetId, flatten: true })
await call('Page.enable', {}, S)
await call('Runtime.enable', {}, S)
await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, S)

// Virtual time starts paused; the page loads on a generous budget, then every step is exact.
const step = 1000 / (FPS * SUB)
let ticks = 0 // BeginFrame time, ms
async function advance(ms) {
  const done = once('Emulation.virtualTimeBudgetExpired', S)
  await call('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: ms, maxVirtualTimeTaskStarvationCount: 5000 }, S)
  await done
}
// macOS has no BeginFrameControl, so a screenshot is what forces each frame to be produced.
async function frame(screenshot) {
  ticks += step
  // Without a produced frame, requestAnimationFrame never fires (a count-up on page load would
  // start late and read wrong); a 1-pixel capture renders the frame for almost nothing.
  if (!screenshot) { await call('Page.captureScreenshot', { format: 'jpeg', quality: 10, clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } }, S); return null }
  const r = await call('Page.captureScreenshot', { format: 'jpeg', quality: Q, optimizeForSpeed: true }, S)
  return Buffer.from(r.data, 'base64')
}
const evaluate = async (expression, awaitPromise = true) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, S)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result?.value
}

await call('Emulation.setVirtualTimePolicy', { policy: 'pause' }, S)
await call('Page.navigate', { url: URL_ }, S)
// let it load and settle: pump frames on virtual time for up to ~3 s of page time
for (let i = 0; i < 60 * 3; i++) {
  await advance(1000 / 60); await frame(false)
  if (i > 30 && (await evaluate('document.readyState', false)) === 'complete' && i > 90) break
}
for (const f of many('before')) await evaluate(readFileSync(f, 'utf8'), false)
if (opt('setup')) await evaluate(opt('setup'), false)
for (let i = 0; i < 6; i++) { await advance(1000 / 60); await frame(false) } // let setup paint

// start the choreography without awaiting it; it runs on virtual time as we step
if (opt('run')) await evaluate(`window.__renderRun = Promise.resolve().then(() => (${opt('run')})).then(v => (window.__renderResult = v), e => (window.__renderResult = 'ERR ' + e))`, false)

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS * SUB), '-i', '-',
  '-vf', `${SUB > 1 ? `tmix=frames=${SUB}:weights=1,` : ''}fps=${FPS}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT],
  { stdio: ['pipe', 'inherit', 'inherit'] })
const total = Math.round(SECONDS * FPS * SUB)
const t0 = Date.now()
for (let f = 0; f < total; f++) {
  await advance(step)
  const jpg = await frame(true)
  if (!jpg) throw new Error('no screenshot at subframe ' + f)
  if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
  if (f % (FPS * SUB) === 0) process.stderr.write(`  ${(f / (FPS * SUB)).toFixed(0)}s/${SECONDS}s  (${((Date.now() - t0) / 1000).toFixed(0)}s wall)\n`)
}
ff.stdin.end()
await new Promise((r) => ff.on('close', r))
const result = await evaluate('window.__renderResult ?? null', false).catch(() => null)
if (opt('log')) writeFileSync(opt('log'), JSON.stringify(result ?? null))
console.log(`${total} subframes → ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s; result: ${JSON.stringify(result)?.slice(0, 200)}`)
sock.close(); chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true })
