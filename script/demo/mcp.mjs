import { connect } from 'node:net'
const sock = connect(process.env.BAY_MCP_SOCKET ?? '/tmp/bay-demo/bay-mcp.sock')
let buf = ''; const pending = new Map(); let id = 0
sock.setEncoding('utf8')
sock.on('data', (c) => { buf += c; let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const m = JSON.parse(line); const p = pending.get(m.id)
    if (p) { pending.delete(m.id); p(m) }
  } })
sock.on('close', () => { for (const [, p] of pending) p({ error: { message: 'socket closed' } }) })
await new Promise((r) => sock.on('connect', r))
export const call = (method, params) => new Promise((res) => {
  const n = ++id; pending.set(n, res)
  sock.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n')
})
export const tool = async (name, args = {}) => {
  const r = await call('tools/call', { name, arguments: args })
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? r)
  try { return { isError: !!r.result?.isError, value: JSON.parse(text) } }
  catch { return { isError: !!r.result?.isError, value: text } }
}
export const done = () => sock.end()
