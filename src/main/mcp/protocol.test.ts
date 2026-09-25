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
import { ALL_RESOURCES, RESOURCES } from '@shared/resources'
import assert from 'node:assert/strict'
import { TOOLS } from '@shared/mcp'
import {
  LineBuffer,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_INVALID_PARAMS,
  RPC_PARSE_ERROR,
  encode,
  isNotification,
  parseLine
} from './jsonrpc'
import {
  PROTOCOL_VERSION,
  TOOL_MODE_ENV,
  handleRequest,
  toContent,
  toolManifest,
  toolModeFromEnv,
  type RunTool
} from './protocol'

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
  // Pinned whole rather than by key: capabilities are what a client reads to decide which
  // methods it may call at all, so an accidental removal has to fail here rather than show up
  // as a guide nobody ever fetched.
  assert.deepEqual(result['capabilities'], {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false }
  })
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
    assert.equal('readOnly' in tool, false)
    // …but the fact itself is, in MCP's own vocabulary, so a client can tell a look from a write.
    const spec = TOOLS.find((t) => t.name === tool['name'])!
    assert.deepEqual(tool['annotations'], { readOnlyHint: spec.readOnly })
  }
})

test('the manifest advertises validateOnly on the dry-runnable tools and only those', () => {
  // The client sees the schema the manifest publishes; a flag the executor accepts but the
  // manifest omits is a feature no agent finds.
  const manifest = toolManifest()
  const takes = (name: string): boolean => {
    const tool = manifest.find((t) => t['name'] === name)!
    return 'validateOnly' in (tool['inputSchema'] as { properties: object }).properties
  }
  assert.equal(takes('remove_range'), true)
  assert.equal(takes('edit_item'), true)
  assert.equal(takes('export_timeline'), false)
  assert.equal(takes('read_project'), false)
  // A self-validating tool (generate_*) answers the flag in its own handler; it is published too.
  assert.equal(takes('generate_video'), true)
  for (const spec of TOOLS) assert.equal(takes(spec.name), spec.dryRunnable === true || spec.selfValidating === true, spec.name)
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
  // Was `resources/list` until bay grew resources, at which point this test correctly failed
  // rather than quietly asserting that a supported method was unsupported. `prompts/list` is
  // the next thing MCP defines that bay does not implement.
  const answer = await handleRequest(request('prompts/list'), neverCalled)
  const error = (answer as { error: { code: number; message: string } }).error
  assert.equal(error.code, RPC_METHOD_NOT_FOUND)
  assert.match(error.message, /prompts\/list/)
})

test('resources/list returns every document in the catalog, in MCP shape', async () => {
  const answer = await handleRequest(request('resources/list'), neverCalled)
  const resources = (answer as { result: { resources: Record<string, unknown>[] } }).result
    .resources

  // `ALL_RESOURCES`, not `RESOURCES`: the guides are only half of what is served. Templates
  // joined the catalog and this assertion is the thing that noticed, which is what it is for.
  assert.equal(resources.length, ALL_RESOURCES.length)
  assert.deepEqual(
    resources.map((r) => r['uri']),
    ALL_RESOURCES.map((r) => r.uri)
  )
  for (const resource of resources) {
    assert.equal(typeof resource['name'], 'string')
    assert.equal(typeof resource['description'], 'string')
  }
  // The two kinds carry different types, and an agent routes on that: a guide is prose to
  // read, a template is a document to write back. Collapsing them to one mimeType would make
  // the listing unusable for deciding which is which.
  const kinds = new Set(resources.map((r) => r['mimeType']))
  assert.deepEqual([...kinds].sort(), ['text/html', 'text/markdown'])
  assert.ok(
    resources.filter((r) => r['mimeType'] === 'text/markdown').length >= RESOURCES.length,
    'every guide is still listed'
  )
})

test('resources/read returns the body the reader supplies', async () => {
  const uri = RESOURCES[0]!.uri
  const answer = await handleRequest(request('resources/read', { uri }), neverCalled, (asked) =>
    asked === uri ? '# a body' : null
  )
  const contents = (answer as { result: { contents: Record<string, unknown>[] } }).result.contents

  assert.equal(contents.length, 1)
  assert.equal(contents[0]!['uri'], uri)
  assert.equal(contents[0]!['text'], '# a body')
  assert.equal(contents[0]!['mimeType'], 'text/markdown')
})

test('an unknown uri is refused with the real ones named', async () => {
  const answer = await handleRequest(
    request('resources/read', { uri: 'bay://guide/nope' }),
    neverCalled,
    () => null
  )
  const error = (answer as { error: { message: string } }).error

  // An error is a recovery instruction: listing the real uris is what lets the next call work.
  assert.match(error.message, /bay:\/\/guide\/nope/)
  assert.match(error.message, new RegExp(RESOURCES[0]!.uri.replace(/\//g, '\\/')))
})

test('a listed uri with no body says it is bay at fault, not the caller', async () => {
  // The two failures are different and must read differently: a bad uri is the agent's to fix,
  // a missing body is a build fault and no amount of rewriting the request will help.
  const answer = await handleRequest(
    request('resources/read', { uri: RESOURCES[0]!.uri }),
    neverCalled,
    () => null
  )
  const error = (answer as { error: { message: string } }).error

  assert.match(error.message, /fault in bay/i)
})

test('resources/read without a uri is an invalid-params error', async () => {
  const answer = await handleRequest(request('resources/read', {}), neverCalled, () => 'x')
  const error = (answer as { error: { code: number } }).error
  assert.equal(error.code, RPC_INVALID_PARAMS)
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

test('an image in a result becomes an image block, not text', () => {
  const content = toContent({ frame: 3, image: 'data:image/jpeg;base64,/9j/AAAA', canvas: { width: 1 } })
  assert.equal(content.length, 2)
  assert.deepEqual(content[1], { type: 'image', mimeType: 'image/jpeg', data: '/9j/AAAA' })
  const json = JSON.parse((content[0] as { text: string }).text) as Record<string, unknown>
  assert.equal(json['image'], '(attached as image 1)')
  assert.equal(json['frame'], 3)
  assert.deepEqual(json['canvas'], { width: 1 })
})

test('text that merely mentions a data URL is left alone', () => {
  // Positive control for the lift: only a field that IS a data URL moves. A caption quoting one,
  // or a non-image data URL, stays text.
  for (const value of [
    { note: 'see data:image/png;base64,AAAA for details' },
    { file: 'data:text/plain;base64,AAAA' },
    'data:image/png;base64,AAAA',
    [1, 2]
  ]) {
    const content = toContent(value)
    assert.equal(content.length, 1, JSON.stringify(value))
    assert.equal(content[0]!.type, 'text')
  }
})

test('pre-built content from the proxy is passed through untouched', async () => {
  const prebuilt = [
    { type: 'text' as const, text: '{}' },
    { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' }
  ]
  const answer = (await handleRequest(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'preview_frame', arguments: {} } },
    async () => ({ ok: true, value: 'ignored', content: prebuilt })
  )) as { result: { content: unknown[] } }
  assert.deepEqual(answer.result.content, prebuilt)
})

// ---------------------------------------------------------------------------
// Gateway mode
// ---------------------------------------------------------------------------

type CallResult = { content: { type: string; text?: string; data?: string }[]; isError: boolean }

async function gatewayCall(name: string, args: unknown, runTool: RunTool): Promise<CallResult> {
  const answer = await handleRequest(
    request('tools/call', { name, arguments: args }),
    runTool,
    () => null,
    'gateway'
  )
  return (answer as { result: CallResult }).result
}

async function listed(mode: 'full' | 'gateway' | undefined): Promise<string[]> {
  const answer = await handleRequest(request('tools/list'), neverCalled, () => null, mode)
  return (answer as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name)
}

test('gateway mode lists exactly the three gateway tools; the default lists the catalog', async () => {
  // Literal names: they are what an external client's config and prompts are written against.
  assert.deepEqual(await listed('gateway'), ['get_active_project', 'get_guidelines', 'execute'])
  // Positive control, and the default is still full with no mode given at all.
  assert.deepEqual(await listed(undefined), TOOLS.map((t) => t.name))
  assert.deepEqual(await listed('full'), TOOLS.map((t) => t.name))
})

test('get_guidelines names every catalog tool with its published schema and the guides', async () => {
  const result = await gatewayCall('get_guidelines', {}, neverCalled)
  assert.equal(result.isError, false)
  const text = result.content[0]!.text!
  for (const spec of TOOLS) {
    assert.ok(text.includes(`\n${spec.name} [`), `${spec.name} is missing from the guidelines`)
  }
  // The schema itself, not a paraphrase: remove_range's own argument names and validateOnly,
  // which only the published schema carries.
  const lines = text.split('\n')
  const line = lines[lines.findIndex((l) => l.startsWith('remove_range [')) + 1]
  assert.ok(line?.startsWith('  args: {'), 'remove_range has no schema line')
  const schema = JSON.parse(line!.slice('  args: '.length)) as { properties: object }
  assert.ok('fromFrame' in schema.properties && 'toFrame' in schema.properties)
  assert.ok('validateOnly' in schema.properties)
  assert.match(text, /bay:\/\/guide\/editing/, 'the guide to read first is not pointed at')
  assert.match(text, /execute \{ tool, args \}/)
})

test('execute dispatches to the real tool with its arguments, by the ordinary path', async () => {
  const seen: { name: string; args: Record<string, unknown> }[] = []
  const recording: RunTool = async (name, args) => {
    seen.push({ name, args })
    return { ok: true, value: { frame: 12, image: 'data:image/png;base64,AAAA' } }
  }
  const result = await gatewayCall(
    'execute',
    { tool: 'preview_frame', args: { frame: 12 } },
    recording
  )
  assert.deepEqual(seen, [{ name: 'preview_frame', args: { frame: 12 } }])
  assert.equal(result.isError, false)
  // The image is lifted out exactly as a direct call lifts it.
  assert.deepEqual(result.content[1], { type: 'image', mimeType: 'image/png', data: 'AAAA' })

  // args may be left out for a tool that takes none.
  seen.length = 0
  await gatewayCall('execute', { tool: 'undo' }, recording)
  assert.deepEqual(seen, [{ name: 'undo', args: {} }])
})

test('execute answers exactly as a direct call does, failures included', async () => {
  const failing: RunTool = async () => ({ ok: false, value: 'No id starting with "zz" exists here.' })
  const viaExecute = await gatewayCall(
    'execute',
    { tool: 'inspect_item', args: { itemId: 'zz' } },
    failing
  )
  const direct = (
    (await handleRequest(
      request('tools/call', { name: 'inspect_item', arguments: { itemId: 'zz' } }),
      failing
    )) as { result: CallResult }
  ).result
  assert.deepEqual(viaExecute, direct)
  assert.equal(viaExecute.isError, true)
})

test('an unknown tool inside execute gets the recovery instruction a direct call gets', async () => {
  const result = await gatewayCall('execute', { tool: 'make_it_good', args: {} }, neverCalled)
  assert.equal(result.isError, true)
  const text = result.content[0]!.text!
  assert.match(text, /No tool named "make_it_good"/)
  assert.match(text, /read_project/, 'the real tools are not named')
  assert.match(text, /execute/, 'the way to run them is not named')
  // Nor can execute reach the gateway's own tools as if they were catalog tools.
  const nested = await gatewayCall('execute', { tool: 'execute', args: {} }, neverCalled)
  assert.equal(nested.isError, true)
})

test('a malformed execute says what shape it wants', async () => {
  const noTool = await gatewayCall('execute', { args: {} }, neverCalled)
  assert.equal(noTool.isError, true)
  assert.match(noTool.content[0]!.text!, /requires "tool"/)
  const badArgs = await gatewayCall('execute', { tool: 'undo', args: [1] }, neverCalled)
  assert.equal(badArgs.isError, true)
  assert.match(badArgs.content[0]!.text!, /must be an object/)
})

test('get_active_project summarises read_project, including when it arrives as relayed content', async () => {
  // The proxy relays read_project as pre-rendered content, not a value; the summary has to read
  // through that, which is the case the real client hits.
  const project = {
    project: { name: 'Launch film', savedTo: '/x.bay' },
    timeline: { name: 'Main', width: 1920, height: 1080, fps: 30, durationInFrames: 900 },
    playhead: 42,
    tracks: [
      { id: 't1', items: [{ id: 'a' }, { id: 'b' }] },
      { id: 't2', items: [{ id: 'c' }] }
    ],
    assetCount: 5
  }
  const calls: string[] = []
  const relayed: RunTool = async (name) => {
    calls.push(name)
    return { ok: true, value: '', content: [{ type: 'text', text: JSON.stringify(project) }] }
  }
  const result = await gatewayCall('get_active_project', {}, relayed)
  assert.deepEqual(calls, ['read_project'])
  assert.equal(result.isError, false)
  const summary = JSON.parse(result.content[0]!.text!) as Record<string, unknown>
  assert.equal(summary['bay'], 'connected')
  assert.equal(summary['project'], 'Launch film')
  assert.deepEqual(summary['canvas'], { width: 1920, height: 1080 })
  assert.equal(summary['fps'], 30)
  assert.equal(summary['trackCount'], 2)
  assert.equal(summary['itemCount'], 3)
})

test('get_active_project with bay unreachable says so and passes on the reason', async () => {
  const down: RunTool = async () => ({
    ok: false,
    value: '"read_project" was not applied. No agent socket appeared at /tmp/x within 30s.'
  })
  const result = await gatewayCall('get_active_project', {}, down)
  assert.equal(result.isError, true)
  const summary = JSON.parse(result.content[0]!.text!) as Record<string, unknown>
  assert.equal(summary['bay'], 'unreachable')
  assert.match(String(summary['reason']), /No agent socket appeared/)
})

test('the gateway tools do not exist in full mode', async () => {
  // Otherwise a full-mode client could reach an undocumented second surface.
  const answer = await handleRequest(
    request('tools/call', { name: 'execute', arguments: { tool: 'undo' } }),
    neverCalled
  )
  const result = (answer as { result: CallResult }).result
  assert.equal(result.isError, true)
  assert.match(result.content[0]!.text!, /No tool named "execute"/)
})

test('the mode is read from the environment, and a typo is named rather than ignored', () => {
  assert.deepEqual(toolModeFromEnv(undefined), { mode: 'full', warning: null })
  assert.deepEqual(toolModeFromEnv('gateway'), { mode: 'gateway', warning: null })
  assert.deepEqual(toolModeFromEnv(' Gateway '), { mode: 'gateway', warning: null })
  const typo = toolModeFromEnv('gatway')
  assert.equal(typo.mode, 'full')
  assert.match(typo.warning ?? '', /"gatway" is not a mode/)
  assert.match(typo.warning ?? '', /BAY_MCP_MODE=gateway/)
  // Literal: it is the name documented for users' client configs.
  assert.equal(TOOL_MODE_ENV, 'BAY_MCP_MODE')
})
