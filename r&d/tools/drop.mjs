// Drop real files onto a CDP page as if dragged from Finder.
//   node drop.mjs <port> <urlSubstring> <x> <y> <file...>
const [port, match, x, y, ...files] = process.argv.slice(2)
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = pages.find((t) => t.type === 'page' && t.url.includes(match))
if (!page) throw new Error('no page ' + match)
const sock = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => sock.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
sock.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const call = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); sock.send(JSON.stringify({ id: i, method, params })) })
const data = { items: [], files, dragOperationsMask: 1 }
const pt = { x: Number(x), y: Number(y) }
// Travel in from the window edge so hover states light up on the way.
for (const [i, type] of [[0, 'dragEnter'], [1, 'dragOver'], [2, 'dragOver'], [3, 'dragOver']].map(([i, t]) => [i, t])) {
  const r = await call('Input.dispatchDragEvent', { type, x: pt.x - (3 - i) * 40, y: pt.y - (3 - i) * 25, data })
  if (r.error) throw new Error(JSON.stringify(r.error))
  await new Promise((res) => setTimeout(res, 180))
}
await new Promise((res) => setTimeout(res, 500))
const r = await call('Input.dispatchDragEvent', { type: 'drop', ...pt, data })
console.log(r.error ? 'drop error ' + JSON.stringify(r.error) : 'dropped ' + files.length + ' file(s)')
sock.close()
