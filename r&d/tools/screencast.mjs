// Record the active page of a Chrome over CDP as a constant-frame-rate video.
// Screencast frames arrive on repaint with timestamps; each is held until the next one,
// so the output keeps real timing. Usage:
//   node screencast.mjs <browser-ws> <out.mp4> <seconds> [urlSubstring]
// Actions are driven separately (agent-browser) while this runs.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const [ws, out, secs, match = ''] = process.argv.slice(2)
const httpBase = ws.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '')
const targets = await (await fetch(`${httpBase}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.url.includes(match))
if (!page) throw new Error(`no page matching "${match}": ${targets.map((t) => t.url).join(', ')}`)

const sock = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => sock.addEventListener('open', r, { once: true }))
let id = 0
const send = (method, params = {}) => sock.send(JSON.stringify({ id: ++id, method, params }))

const dir = resolve(`${out}.frames`)
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const frames = []
sock.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method !== 'Page.screencastFrame') return
  const { data, metadata, sessionId } = msg.params
  const file = join(dir, `${String(frames.length).padStart(6, '0')}.jpg`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  frames.push({ file, t: metadata.timestamp })
  send('Page.screencastFrameAck', { sessionId })
})

send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1, maxWidth: 3840, maxHeight: 2160 })
console.log('recording', page.url)
await new Promise((r) => setTimeout(r, Number(secs) * 1000))
send('Page.stopScreencast')
sock.close()

if (frames.length < 2) throw new Error(`only ${frames.length} frames captured`)
const lines = []
for (let i = 0; i < frames.length; i++) {
  const next = frames[i + 1]?.t ?? frames[i].t + 1 / 30
  lines.push(`file '${frames[i].file}'`, `duration ${(next - frames[i].t).toFixed(4)}`)
}
lines.push(`file '${frames.at(-1).file}'`)
writeFileSync(`${dir}/list.txt`, lines.join('\n'))
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`,
  '-vf', 'fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', out])
const span = frames.at(-1).t - frames[0].t
console.log(`${frames.length} frames over ${span.toFixed(2)}s (${(frames.length / span).toFixed(1)} fps avg) -> ${out}`)
