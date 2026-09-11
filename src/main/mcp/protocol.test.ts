/**
 * Tests for MCP framing and dispatch.
 *
 * These cover the transport the way a real client exercises it, because the failure mode at
 * this boundary has no UI: a malformed frame or an answered notification does not raise an
 * error anywhere a person can see — the agent's tool simply never works, or the client closes
 * the connection and reports nothing useful.
 *
 * The chunk-splitting tests are the ones that would otherwise be found in production. A
 * socket hands over arbitrary chunks; small messages arrive whole in testing and split under
 * load, so treating a chunk as a message passes every manual check and then fails on the one
 * timeline big enough to matter.
 *
 * Mutation-tested: notifications answered, `isError` inverted, the tool-not-found case turned
 * into a JSON-RPC error, the protocol version changed, and `LineBuffer` returning its
 * remainder as a line. All fail here.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/mcp/protocol.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS } from '@shared/mcp'
import {
  LineBuffer,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  encode,
  isNotification,
  parseLine
} from './jsonrpc'
import { PROTOCOL_VERSION, handleRequest, toolManifest, type RunTool } from './protocol'

const neverCalled: RunTool = async () => {
  throw new Error('runTool must not be called for this request')
}

const echoTool: RunTool = async (name, args) => ({ ok: true, value: { name, args } })

function request(method: string, params?: unknown, id: string | number | null = 1) {
  return { jsonrpc: '2.0' as const, id, method, ...(params === undefined ? {} : { params }) }
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

test('every encoded message is exactly one line', () => {
  // The newline is the delimiter, so a message containing one would be read as two messages.
  const encoded = encode({
    jsonrpc: '2.0',
    id: 1,
    result: { text: 'line one\nline two\r\nline three' }
  })
  assert.equal(encoded.endsWith('\n'), true)
  assert.equal(encoded.trimEnd().includes('\n'), false, 'a raw newline escaped into the frame')
})

test('a chunked stream reassembles into whole messages', () => {
  // One write arriving as three reads is the normal case on a loaded socket.
  const buffer = new LineBuffer()
  assert.deepEqual(buffer.push('{"jsonrpc":"2.0",'), [])
  assert.deepEqual(buffer.push('"id":1,"method":"pi'), [])
  assert.deepEqual(buffer.push('ng"}\n'), ['{"jsonrpc":"2.0","id":1,"method":"ping"}'])
})

test('three messages in one chunk are three messages', () => {
  const buffer = new LineBuffer()
  assert.equal(buffer.push('{"a":1}\n{"b":2}\n{"c":3}\n').length, 3)
})

test('a partial trailing message is held, not delivered', () => {
  // Delivering it would hand a truncated line to the parser and answer a parse error to a
  // client that had done nothing wrong.
  const buffer = new LineBuffer()
  assert.deepEqual(buffer.push('{"a":1}\n{"b":'), ['{"a":1}'])
  assert.equal(buffer.remainder, '{"b":')
})

test('malformed input is answered, not thrown', () => {
  // The peer is a separate process; throwing would kill a transport still able to serve the
  // next line.
  assert.equal(parseLine('not json')?.error?.error.code, RPC_PARSE_ERROR)
  assert.equal(parseLine('[1,2,3]')?.error?.error.code, RPC_INVALID_REQUEST)
  assert.equal(parseLine('{"jsonrpc":"2.0","id":1}')?.error?.error.code, RPC_INVALID_REQUEST)
  assert.equal(parseLine('   '), null, 'a blank line is not a message')
})

test('a parse failure keeps the id when there is one to keep', () => {
  const parsed = parseLine('{"jsonrpc":"2.0","id":7}')
  assert.equal(parsed?.error?.id, 7)
})

test('a request without an id is a notification', () => {
  const parsed = parseLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')
  assert.ok(parsed?.request)
  assert.equal(isNotification(parsed!.request!), true)
  assert.equal(isNotification({ jsonrpc: '2.0', id: null, method: 'ping' }), false)
})

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

test('a notification is never answered', async () => {
  // An unexpected response in the client's stream is a protocol violation, and some clients
  // close the connection over it.
  const answer = await handleRequest(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    neverCalled
  )
  assert.equal(answer, null)
})

test('initialize reports the pinned protocol version and bay as the server', async () => {
  const answer = await handleRequest(request('initialize'), neverCalled)
  const result = (answer as { result: Record<string, unknown> }).result
  assert.equal(result['protocolVersion'], PROTOCOL_VERSION)
  assert.deepEqual(result['serverInfo'], { name: 'bay', version: '0.1.0' })
  assert.deepEqual(result['capabilities'], { tools: { listChanged: false } })
})

test('the protocol version is pinned as a literal', () => {
  // A compatibility surface with every client that has connected: negotiation tolerates a
  // server answering with a different version, but nothing guarantees the client accepts it.
  assert.equal(PROTOCOL_VERSION, '2024-11-05')
})

test('tools/list returns every tool in the contract, in MCP shape', async () => {
  const answer = await handleRequest(request('tools/list'), neverCalled)
  const tools = (answer as { result: { tools: Record<string, unknown>[] } }).result.tools

  assert.equal(tools.length, TOOLS.length)
  assert.deepEqual(
    tools.map((t) => t['name']),
    TOOLS.map((t) => t.name)
  )
  for (const tool of tools) {
    assert.equal(typeof tool['description'], 'string')
    assert.ok((tool['description'] as string).length > 0, `${tool['name']} has no description`)
    assert.equal((tool['inputSchema'] as { type: string }).type, 'object')
    // bay's own catalog fields are not MCP's, and sending them is noise in every session.
    assert.equal('category' in tool, false)
    assert.equal('alwaysLoad' in tool, false)
  }
})

test('the manifest can be built without the app running', () => {
  // This is what lets the proxy answer tools/list before bay has started — the milestone the
  // other agents work against.
  assert.equal(toolManifest().length, TOOLS.length)
})

test('ping answers empty', async () => {
  const answer = await handleRequest(request('ping'), neverCalled)
  assert.deepEqual((answer as { result: unknown }).result, {})
})

test('an unknown method is a JSON-RPC error naming the method', async () => {
  const answer = await handleRequest(request('resources/list'), neverCalled)
  const error = (answer as { error: { code: number; message: string } }).error
  assert.equal(error.code, RPC_METHOD_NOT_FOUND)
  assert.match(error.message, /resources\/list/)
})

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

test('a tool call reaches the runner with its arguments', async () => {
  const answer = await handleRequest(
    request('tools/call', { name: 'set_playhead', arguments: { frame: 120 } }),
    echoTool
  )
  const result = (answer as { result: { content: { text: string }[]; isError: boolean } }).result
  assert.equal(result.isError, false)
  assert.deepEqual(JSON.parse(result.content[0]!.text), {
    name: 'set_playhead',
    args: { frame: 120 }
  })
})

test('a call with no arguments gets an empty object, not undefined', async () => {
  const answer = await handleRequest(request('tools/call', { name: 'undo' }), echoTool)
  const text = (answer as { result: { content: { text: string }[] } }).result.content[0]!.text
  assert.deepEqual(JSON.parse(text).args, {})
})

test('a failing tool is a successful result marked isError, not a JSON-RPC error', async () => {
  // MCP's distinction, and it matters: a JSON-RPC error means the call could not be made and
  // may be retried; isError means it ran and the model should read the message and choose
  // differently. Collapsing them makes an agent retry a call that will never work.
  const failing: RunTool = async () => ({ ok: false, value: 'no item a1b2c3 on the timeline' })
  const answer = await handleRequest(request('tools/call', { name: 'undo' }), failing)

  assert.equal('error' in (answer as object), false, 'a tool failure became a transport failure')
  const result = (answer as { result: { content: { text: string }[]; isError: boolean } }).result
  assert.equal(result.isError, true)
  assert.match(result.content[0]!.text, /no item a1b2c3/)
})

test('an unknown tool names the real ones rather than just refusing', async () => {
  const answer = await handleRequest(
    request('tools/call', { name: 'make_it_good', arguments: {} }),
    neverCalled
  )
  const result = (answer as { result: { content: { text: string }[]; isError: boolean } }).result
  assert.equal(result.isError, true)
  assert.match(result.content[0]!.text, /make_it_good/)
  assert.match(result.content[0]!.text, /read_project/, 'the recovery path is not named')
})

test('a call with no name is a parameter error', async () => {
  const answer = await handleRequest(request('tools/call', { arguments: {} }), neverCalled)
  assert.ok('error' in (answer as object))
})

test('a string result is passed through as text, not re-encoded as JSON', async () => {
  const stringy: RunTool = async () => ({ ok: true, value: 'Playhead moved to frame 120.' })
  const answer = await handleRequest(request('tools/call', { name: 'set_playhead' }), stringy)
  const text = (answer as { result: { content: { text: string }[] } }).result.content[0]!.text
  assert.equal(text, 'Playhead moved to frame 120.')
})
