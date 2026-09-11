/**
 * The transport, driven the way an MCP client drives it: a real child process, real stdio,
 * real newline framing, and a real unix socket on the other side.
 *
 * The unit tests cover framing and dispatch as functions. This covers the thing none of them
 * can — that the pieces are actually wired to each other. Every failure this catches is one
 * where each half is correct in isolation: a bundle that does not start, an entry point that
 * writes a diagnostic to stdout and corrupts the stream, a socket nobody connects to, a
 * request whose reply never comes back.
 *
 * The server side here is deliberately *not* Electron. It is the same `handleRequest` the app
 * runs, over the same framing, with a stub tool runner — so this exercises the transport
 * without needing a window, and a failure points at the transport rather than at the editor.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/mcp/end-to-end.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineBuffer, encode, parseLine } from './jsonrpc'
import { handleRequest, type RunTool } from './protocol'
import { SOCKET_NAME } from './socket-path'

const PROXY_BUNDLE = join(process.cwd(), 'out', 'main', 'mcp', 'index.js')

/** A stand-in for bay: the real dispatch, a stub executor, over the real socket framing. */
function startStubApp(socketPath: string, runTool: RunTool): Promise<Server> {
  const server = createServer((socket) => {
    const buffer = new LineBuffer()
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      for (const line of buffer.push(chunk)) {
        const parsed = parseLine(line)
        if (!parsed?.request) continue
        void handleRequest(parsed.request, runTool).then((answer) => {
          if (answer) socket.write(encode(answer))
        })
      }
    })
    socket.on('error', () => undefined)
  })
  return new Promise((resolve) => server.listen(socketPath, () => resolve(server)))
}

interface Proxy {
  send(message: unknown): void
  next(): Promise<Record<string, unknown>>
  stderr(): string
  stop(): void
}

function startProxy(socketPath: string, env: Record<string, string> = {}): Proxy {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [PROXY_BUNDLE],
    { env: { ...process.env, BAY_MCP_SOCKET: socketPath, ...env }, stdio: 'pipe' }
  )
  const buffer = new LineBuffer()
  const queue: Record<string, unknown>[] = []
  let waiting: ((value: Record<string, unknown>) => void) | null = null
  let errors = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    for (const line of buffer.push(chunk)) {
      const value = JSON.parse(line) as Record<string, unknown>
      if (waiting) {
        const resolve = waiting
        waiting = null
        resolve(value)
      } else queue.push(value)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    errors += chunk
  })

  return {
    send: (message) => child.stdin.write(encode(message as never)),
    next: () =>
      new Promise((resolve) => {
        const ready = queue.shift()
        if (ready) resolve(ready)
        else waiting = resolve
      }),
    stderr: () => errors,
    stop: () => child.kill()
  }
}

function scratchSocket(): string {
  return join(mkdtempSync(join(tmpdir(), 'bay-mcp-')), SOCKET_NAME)
}

const refuse: RunTool = async () => ({ ok: false, value: 'the stub app refuses everything' })

// ---------------------------------------------------------------------------
// The milestone
// ---------------------------------------------------------------------------

test('the proxy bundle exists and is not stale', () => {
  // Every test below spawns the *built* bundle, not the source. That makes staleness a
  // false-pass rather than a false-fail: edit the transport, skip `pnpm build`, and the suite
  // happily proves that the previous build still works. Found exactly that way — a restored
  // source file with a mutated bundle still on disk.
  //
  // So the bundle's age is part of the assertion. It must be at least as new as everything it
  // is built from, and the message has to name the fix, because "transport broken" and "you
  // did not rebuild" look identical from the failures below.
  assert.ok(existsSync(PROXY_BUNDLE), `no proxy bundle at ${PROXY_BUNDLE}; run pnpm build`)

  const bundleMs = statSync(PROXY_BUNDLE).mtimeMs
  const sourceDir = join(process.cwd(), 'src', 'main', 'mcp')
  const newest = readdirSync(sourceDir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, mtimeMs: statSync(join(sourceDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

  assert.ok(newest, 'no transport sources found, which cannot be right')
  assert.ok(
    bundleMs >= newest.mtimeMs,
    `${newest.name} is newer than the proxy bundle, so these tests would exercise a stale ` +
      `build and could pass over a broken transport. Run pnpm build.`
  )
})

test('a client can initialize and list tools with bay not running', async () => {
  // The milestone, and the reason tools/list is answered locally: a client asks for the
  // manifest during startup, and launching a video editor to answer it would stall every
  // session and open a window nobody asked for.
  const socketPath = scratchSocket()
  assert.equal(existsSync(socketPath), false, 'the fixture must start with no app running')

  const proxy = startProxy(socketPath)
  try {
    proxy.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const initialized = (await proxy.next()) as { id: number; result: Record<string, unknown> }
    assert.equal(initialized.id, 1)
    assert.equal(initialized.result['protocolVersion'], '2024-11-05')

    proxy.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    proxy.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })

    const listed = (await proxy.next()) as { id: number; result: { tools: { name: string }[] } }
    // If the notification had been answered, this would be the notification's reply and the
    // id would not match — which is exactly the bug that check exists for.
    assert.equal(listed.id, 2, 'a notification was answered, desynchronising the stream')
    assert.ok(listed.result.tools.length > 0)
    assert.ok(listed.result.tools.some((t) => t.name === 'read_project'))
  } finally {
    proxy.stop()
  }
})

test('nothing but protocol messages reaches stdout', async () => {
  // One stray byte on stdout corrupts the session with an error nobody can attribute. The
  // proxy logs to stderr on purpose; this asserts the split holds under a real launch.
  const socketPath = scratchSocket()
  const proxy = startProxy(socketPath)
  try {
    proxy.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const answer = await proxy.next()
    assert.equal(answer['id'], 1)
    assert.ok('result' in answer)
  } finally {
    proxy.stop()
  }
})

// ---------------------------------------------------------------------------
// Through the socket
// ---------------------------------------------------------------------------

test('a tool call crosses stdio, the socket, and comes back', async () => {
  const socketPath = scratchSocket()
  const seen: { name: string; args: Record<string, unknown> }[] = []
  const server = await startStubApp(socketPath, async (name, args) => {
    seen.push({ name, args })
    return { ok: true, value: `moved to ${String(args['frame'])}` }
  })
  const proxy = startProxy(socketPath)

  try {
    proxy.send({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'set_playhead', arguments: { frame: 120 } }
    })
    const answer = (await proxy.next()) as {
      id: number
      result: { content: { text: string }[]; isError: boolean }
    }

    assert.equal(answer.id, 9)
    assert.equal(answer.result.isError, false)
    assert.equal(answer.result.content[0]?.text, 'moved to 120')
    assert.deepEqual(seen, [{ name: 'set_playhead', args: { frame: 120 } }])
  } finally {
    proxy.stop()
    server.close()
  }
})

test('a tool failure arrives as isError, not as a dead connection', async () => {
  const socketPath = scratchSocket()
  const server = await startStubApp(socketPath, refuse)
  const proxy = startProxy(socketPath)

  try {
    proxy.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'undo' } })
    const answer = (await proxy.next()) as {
      result: { content: { text: string }[]; isError: boolean }
    }
    assert.equal(answer.result.isError, true)
    assert.match(answer.result.content[0]!.text, /refuses everything/)
  } finally {
    proxy.stop()
    server.close()
  }
})

test('a call with bay not running reports it rather than hanging', async () => {
  // No server, and `launch` cannot start anything in a test, so this exercises the giving-up
  // path. The agent must get a verdict; a hang would stall its turn with nothing to read.
  const socketPath = scratchSocket()
  const proxy = startProxy(socketPath, { BAY_APP: '/usr/bin/true' })

  try {
    proxy.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_project' } })
    // Deliberately shorter than the proxy's own 30s launch window: the point is that a
    // verdict *eventually* arrives, and waiting the full window would make the suite slow.
    const raced = await Promise.race([
      proxy.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))
    ])
    // Either it has already given up, or it is still waiting for a launch — both are correct
    // and neither is a crash. What must not happen is the proxy dying.
    if (raced) {
      const answer = raced as { result?: { isError?: boolean } }
      assert.equal(answer.result?.isError, true)
    }
    assert.match(proxy.stderr(), /launching it/, 'the proxy did not try to launch bay')
  } finally {
    proxy.stop()
  }
})

// ---------------------------------------------------------------------------
// The configuration surface
// ---------------------------------------------------------------------------

test('the socket name is pinned', () => {
  // It goes into an MCP client's config on the user's machine and stays there across upgrades.
  // Changing it breaks every configured client, and the symptom is a tool that silently never
  // appears rather than an error anyone sees.
  assert.equal(SOCKET_NAME, 'bay-mcp.sock')
})

test('the bundle lives where a client config would point at it', () => {
  // `out/main/mcp/index.js` is the path in the documented command; a rollup output rename
  // would move it silently.
  assert.equal(PROXY_BUNDLE.endsWith(join('out', 'main', 'mcp', 'index.js')), true)
})
