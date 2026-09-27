// Record a CDP page straight into ffmpeg until a stop file appears. Each screencast frame is
// piped as it arrives and stamped with wall-clock time, so the file keeps real timing and
// nothing piles up on disk.
//   node record-stream.mjs <port> <urlSubstring> <out.mp4> <stopFile> [maxWidth=2560]
// `<stopFile>.mark` containing a label appends "<seconds>\t<label>" to <out>.marks.txt.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, appendFileSync } from 'node:fs'

const [port, match, out, stopFile, maxWidth = '2560'] = process.argv.slice(2)
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = pages.find((t) => t.type === 'page' && t.url.includes(match))
if (!page) throw new Error('no page ' + match)

const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-use_wallclock_as_timestamps', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-',
  '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] })

const sock = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => sock.addEventListener('open', r, { once: true }))
let id = 0, n = 0, last = null
const send = (method, params = {}) => sock.send(JSON.stringify({ id: ++id, method, params }))
sock.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method !== 'Page.screencastFrame') return
  last = Buffer.from(m.params.data, 'base64')
  ff.stdin.write(last)
  n++
  send('Page.screencastFrameAck', { sessionId: m.params.sessionId })
})
send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1, maxWidth: Number(maxWidth), maxHeight: 1640 })
const start = Date.now()
console.log('recording', page.url)

// An idle UI sends no frames; re-send the last one every second so the tail keeps its length.
let lastBeat = Date.now()
while (!existsSync(stopFile)) {
  await new Promise((r) => setTimeout(r, 250))
  if (last && Date.now() - lastBeat > 1000) { ff.stdin.write(last); lastBeat = Date.now() }
  const mark = `${stopFile}.mark`
  if (existsSync(mark)) {
    appendFileSync(`${out}.marks.txt`, `${((Date.now() - start) / 1000).toFixed(1)}\t${readFileSync(mark, 'utf8').trim()}\n`)
    rmSync(mark, { force: true })
  }
}
send('Page.stopScreencast')
sock.close()
if (last) ff.stdin.write(last)
ff.stdin.end()
await new Promise((r) => ff.on('close', r))
console.log(`${n} frames over ${((Date.now() - start) / 1000).toFixed(1)}s -> ${out}`)
