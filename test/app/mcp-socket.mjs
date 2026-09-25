/**
 * The same tools, driven the way an agent actually reaches them.
 *
 * `mcp.mjs` calls the dispatcher directly through `window.bayMcp`, which is deliberate — it
 * separates a fault in the tools from a fault in the transport. This one closes the other
 * half: stdio → proxy → unix socket → main → IPC → renderer → store, and back. Between them
 * a failure is attributable to a layer rather than to "MCP".
 *
 * The property it exists for, which neither the unit suite nor the CDP probe can reach:
 * **a call the renderer never answers must reject rather than hang.** A hang here stalls an
 * agent's turn with no verdict, which is strictly worse than an error — the agent cannot
 * report failure, retry, or tell the user anything. It is tested by replacing the registered
 * executor with one that never resolves, which the bridge's documented "at most one
 * executor, a second registration replaces the first" makes possible from the outside.
 *
 * Run against an app launched with your own --user-data-dir; the socket lives inside it.
 *
 *     PORT=9530 USER_DATA=~/.bay-probe node test/app/mcp-socket.mjs
 *
 * **The profile directory has to be short.** A unix socket path caps at 104 bytes, and
 * `<userData>/bay-mcp.sock` under a deep scratch directory blows it — the app then starts
 * with no MCP server at all. Keep the profile near `$HOME` rather than nested under a
 * per-session temp path.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { attach, PreconditionError, runProbe } from './cdp.mjs'

const USER_DATA = process.env.USER_DATA
if (!USER_DATA) {
  console.error('CANNOT MEASURE: set USER_DATA to the --user-data-dir the app was launched with.')
  process.exit(2)
}
const SOCKET = join(USER_DATA, 'bay-mcp.sock')
const PROXY = 'out/main/mcp/index.js'

/** One short-lived proxy, spoken to over stdio exactly as an MCP client would. */
function openProxy() {
  const child = spawn(process.execPath, [PROXY], {
    env: { ...process.env, BAY_MCP_SOCKET: SOCKET },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let buffer = ''
  const waiting = new Map()
  const stderr = []
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk)
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        try {
          const message = JSON.parse(line)
          const pending = waiting.get(message.id)
          if (pending) { waiting.delete(message.id); pending(message) }
        } catch {
          // Anything unparseable on stdout is itself the bug this proxy exists to avoid —
          // a byte-exact stream — so it is kept rather than swallowed.
          stderr.push(`UNPARSEABLE STDOUT: ${line.slice(0, 200)}`)
        }
      }
      newline = buffer.indexOf('\n')
    }
  })

  let id = 0
  const send = (method, params, timeoutMs = 40_000) =>
    new Promise((resolve) => {
      const messageId = ++id
      const timer = setTimeout(
        () => { waiting.delete(messageId); resolve({ timedOut: true }) },
        timeoutMs
      )
      waiting.set(messageId, (message) => { clearTimeout(timer); resolve(message) })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: messageId, method, params })}\n`)
    })
  const notify = (method, params) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)

  return { send, notify, stderr, close: () => child.kill() }
}

if (!existsSync(PROXY)) {
  console.error(`CANNOT MEASURE: ${PROXY} is not built. Run pnpm build first.`)
  process.exit(2)
}

const { evaluate, close: closeCdp } = await attach()

await runProbe(async () => {

if (!existsSync(SOCKET)) {
  throw new PreconditionError(
    `no socket at ${SOCKET}`,
    'the app is not listening — was it launched with this --user-data-dir?'
  )
}

const checks = []
const check = (label, passed, detail) => {
  checks.push({ label, passed })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}
const textOf = (message) => {
  const content = message?.result?.content
  return Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : ''
}

const proxy = openProxy()
const init = await proxy.send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'bay-socket-probe', version: '0' }
})
check('initialize answers over the socket', !!init.result, init.result ? '' : JSON.stringify(init).slice(0, 90))
proxy.notify('notifications/initialized', {})

const listed = await proxy.send('tools/list', {})
const toolNames = (listed.result?.tools ?? []).map((t) => t.name)
check('tools/list returns the catalog', toolNames.length > 0, `${toolNames.length} tools`)

// A read that has to reach the store and come all the way back.
const read = await proxy.send('tools/call', { name: 'read_project', arguments: {} })
const readText = textOf(read)
check('read_project round-trips through the socket',
  read.result?.isError !== true && /"timeUnit"\s*:\s*"frames"/.test(readText),
  readText.slice(0, 70))

// A write, then a read of the store that must observe it — the round trip is only real if
// the project actually moved. `add_track` rather than `set_playhead`, because the playhead
// clamps to the timeline's duration and this profile is empty: asking for frame 7 on a
// zero-length timeline correctly lands on 0, and an earlier version of this probe read that
// correct clamp as a dead socket.
const tracksBefore = await evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  return s.project.timelines.find((t) => t.id === s.project.activeTimelineId).tracks.length
})()`)
const added = await proxy.send('tools/call', { name: 'add_track', arguments: { kind: 'video' } })
const tracksAfter = await evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  return s.project.timelines.find((t) => t.id === s.project.activeTimelineId).tracks.length
})()`)
check('a write through the socket reaches the store',
  added.result?.isError !== true && tracksAfter === tracksBefore + 1,
  `tracks ${tracksBefore} -> ${tracksAfter}`)

// And the clamp itself is reported rather than silently applied.
// A frame past the timeline's end, derived rather than a literal: frame 7 clamps only on an
// empty timeline, and on a project with a clip it is simply a legal playhead.
const pastEnd = await evaluate(`(() => {
  const s = window.bayEngine.store.getState()
  const tl = s.project.timelines.find((t) => t.id === s.project.activeTimelineId)
  return Math.max(0, ...tl.tracks.flatMap((t) => t.items.map((i) => i.from + i.durationInFrames))) + 7
})()`)
const clamped = await proxy.send('tools/call', { name: 'set_playhead', arguments: { frame: pastEnd } })
check('a clamped playhead says so instead of claiming the frame',
  clamped.result?.isError !== true && /clampedTo/.test(textOf(clamped)),
  textOf(clamped).replace(/\s+/g, ' ').slice(0, 70))

// A refusal has to survive the stack as a refusal, with its text intact.
const refused = await proxy.send('tools/call', { name: 'inspect_item', arguments: { itemId: 'nope' } })
const refusedText = textOf(refused)
check('a refusal survives the stack with its recovery instruction',
  refused.result?.isError === true && /read_project/.test(refusedText),
  refusedText.slice(0, 80))

// Schema validation must happen somewhere in the stack, not silently pass through.
const invalid = await proxy.send('tools/call', { name: 'set_playhead', arguments: { frame: -5 } })
check('an invalid argument is refused across the socket',
  invalid.result?.isError === true && /at least 0/.test(textOf(invalid)),
  textOf(invalid).slice(0, 70))

check('the proxy wrote nothing unparseable to stdout',
  !proxy.stderr.some((line) => line.startsWith('UNPARSEABLE STDOUT')))

// -- the property this probe exists for --------------------------------------
console.log('\n-- a call the renderer never answers --')

// The bridge documents "at most one executor; a second registration replaces the first",
// which is what makes this testable from outside without touching the executor's code.
await evaluate(`(() => {
  window.__restoreExecutor = window.bay.mcp.onToolCall(() => new Promise(() => {}))
  return true
})()`)

// Everything from here to the re-registration runs against a dead executor, so the
// re-registration is in a `finally`: a throw in between used to leave every tool in the user's
// app hanging until a reload.
let hung, elapsed
try {
const began = Date.now()
hung = await proxy.send('tools/call', { name: 'read_project', arguments: {} }, 60_000)
elapsed = Date.now() - began

check('a never-answered call comes back rather than hanging', hung.timedOut !== true,
  hung.timedOut ? `still nothing after ${elapsed}ms` : `answered in ${elapsed}ms`)
check('  and it comes back as an error, not a success',
  hung.timedOut !== true && (hung.result?.isError === true || !!hung.error),
  hung.timedOut ? 'n/a' : (textOf(hung) || JSON.stringify(hung.error)).slice(0, 80))
check('  within the declared MCP_CALL_TIMEOUT_MS (30s) plus slack',
  hung.timedOut !== true && elapsed < 45_000, `${elapsed}ms`)

} finally {
// Put the real executor back, or everything after this measures a dead app.
await evaluate(`(() => {
  if (window.__restoreExecutor) window.__restoreExecutor()
  delete window.__restoreExecutor
  window.bay.mcp.onToolCall(window.bayMcp.execute)
  return true
})()`)
}
const recovered = await proxy.send('tools/call', { name: 'read_project', arguments: {} })
check('the executor recovers once re-registered',
  recovered.result?.isError !== true && /"timeUnit"/.test(textOf(recovered)),
  textOf(recovered).slice(0, 50))

proxy.close()
closeCdp()
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
return failed.length === 0

})
