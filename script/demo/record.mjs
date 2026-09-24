/**
 * Screen-record bay's window over CDP while something else drives it.
 *
 * Frames are pulled with `Page.captureScreenshot` rather than a screen recorder so the capture
 * is of the app alone — no desktop, no cursor, no window chrome from another app drifting into
 * frame — and so it keeps working headless on someone else's machine.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const OUT = process.argv[2] ?? '/tmp/bay-recording'
const FPS = Number(process.argv[3] ?? 10)
const PORT = 9222

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const bay = targets.find((t) => (t.url ?? '').includes('out/renderer/index.html'))
if (!bay) throw new Error('bay renderer is not among the CDP targets')

const ws = new WebSocket(bay.webSocketDebuggerUrl)
const pending = new Map()
let id = 0
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  p(m.result)
}
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })

await new Promise((r) => { ws.onopen = r })
await send('Page.enable')

let frame = 0
let running = true
process.on('SIGTERM', () => { running = false })
process.on('SIGINT', () => { running = false })

const interval = 1000 / FPS
const started = Date.now()
while (running) {
  const tick = Date.now()
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    writeFileSync(`${OUT}/f${String(frame).padStart(5, '0')}.png`, Buffer.from(shot.data, 'base64'))
    frame += 1
  }
  const spent = Date.now() - tick
  if (spent < interval) await new Promise((r) => setTimeout(r, interval - spent))
  if (Date.now() - started > 15 * 60 * 1000) break
}
console.log(`captured ${frame} frames to ${OUT}`)
ws.close()
