/**
 * The Agent SDK runtime: its sandbox, its turns, its stop.
 *
 * The sandbox half pins `sdkOptions` against the CLI runtime's own flags — not against a list
 * written here, because a list written here would only prove the SDK runtime agrees with this
 * file. Each assertion compares with what `cli.ts` actually passes, so the two cannot drift
 * apart without one of these going red.
 *
 * The conversation half drives `SdkAgentRuntime` with a scripted `query` that yields message
 * shapes the SDK declares (`SDKMessage` in its .d.ts), and records the options each turn was
 * started with.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '@shared/agent'
import { TOOLS } from '@shared/mcp'
import { allowedToolNames, cliArgs, DENIED_TOOLS } from './cli'
import {
  bundledExecutable,
  childEnv,
  SdkAgentRuntime,
  sdkOptions,
  sessionIdOf,
  unpackedPath,
  type QueryFn
} from './sdk'

const BASE = {
  proxyPath: '/app/out/main/mcp/index.js',
  socketPath: '/Users/x/Library/Application Support/bay/bay-mcp.sock',
  cwd: '/Users/x/Library/Application Support/bay/agent-workspace',
  systemPrompt: 'You are editing video inside bay.'
}

const options = sdkOptions(BASE, { resume: null, abortController: new AbortController() })
const cli = cliArgs(BASE, 'session-1')
const cliValueAfter = (flag: string): string | undefined => cli[cli.indexOf(flag) + 1]

// --- the sandbox, compared with the CLI's ----------------------------------------------------

test('the same bay tools are allowed as the CLI allows', () => {
  assert.deepEqual(options.allowedTools, allowedToolNames())
  assert.equal(options.allowedTools?.length, TOOLS.length)
  // And the CLI really does pass these — so this is a comparison, not a shared constant
  // agreeing with itself.
  const start = cli.indexOf('--allowedTools') + 1
  assert.deepEqual(cli.slice(start, start + TOOLS.length), options.allowedTools)
})

test('the same built-ins are denied by name as the CLI denies', () => {
  assert.deepEqual(options.disallowedTools, DENIED_TOOLS)
  for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'SendMessage']) {
    assert.ok(options.disallowedTools?.includes(tool), `${tool} must be denied`)
  }
})

test('the shell is removed, not merely un-allowed — `--restricted` reaches the argv', () => {
  // The SDK has no named option for it; `extraArgs` is appended verbatim, `null` meaning a
  // bare flag. Measured on the CLI: an allow-list alone let `Bash` run `id`.
  assert.ok(cli.includes('--restricted'))
  assert.deepEqual(options.extraArgs, { restricted: null })
})

test("the user's other MCP servers are not inherited", () => {
  assert.ok(cli.includes('--strict-mcp-config'))
  assert.equal(options.strictMcpConfig, true)
  assert.deepEqual(Object.keys(options.mcpServers ?? {}), ['bay'])
})

test('the MCP server is the CLI runtime’s, entry for entry', () => {
  const cliServer = JSON.parse(cliValueAfter('--mcp-config') ?? '{}').mcpServers.bay
  const sdkServer = options.mcpServers?.['bay'] as Record<string, unknown>
  assert.deepEqual({ ...sdkServer, type: undefined }, { ...cliServer, type: undefined })
  assert.equal(sdkServer['type'], 'stdio')
  const env = sdkServer['env'] as Record<string, string>
  assert.equal(env['BAY_MCP_SOCKET'], BASE.socketPath, 'the proxy must be told which bay')
  assert.equal(env['ELECTRON_RUN_AS_NODE'], '1', 'the proxy runs as plain Node')
})

test('anything that would prompt is denied instead of waiting', () => {
  assert.equal(cliValueAfter('--permission-prompts'), 'none')
  assert.equal(options.permissionPrompts, 'none')
  // `canUseTool` would make the SDK add `--permission-prompt-tool stdio` and route every
  // denied call here as a prompt.
  assert.equal(options.canUseTool, undefined)
  assert.equal(options.permissionPromptToolName, undefined)
})

test("the user's own settings and CLAUDE.md files are not inherited", () => {
  assert.equal(cliValueAfter('--setting-sources'), '')
  // `[]`, not omitted: omitted means *all* sources, the SDK's documented default.
  assert.deepEqual(options.settingSources, [])
})

test("bay's own system prompt and workspace are the ones in force", () => {
  assert.equal(options.systemPrompt, BASE.systemPrompt)
  assert.equal(options.cwd, BASE.cwd)
  assert.equal(options.includePartialMessages, true, 'without this there is no streaming text')
})

test('the child environment drops ELECTRON_RUN_AS_NODE and keeps the rest', () => {
  const env = childEnv({ PATH: '/usr/bin', HOME: '/Users/x', ELECTRON_RUN_AS_NODE: '1' })
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/Users/x' })
  // Positive control: a real environment keeps PATH, or the child cannot find anything.
  assert.ok('PATH' in childEnv())
})

test('an executable is passed through only when given', () => {
  assert.equal(options.pathToClaudeCodeExecutable, undefined)
  const withExe = sdkOptions(
    { ...BASE, executable: '/opt/claude' },
    { resume: null, abortController: new AbortController() }
  )
  assert.equal(withExe.pathToClaudeCodeExecutable, '/opt/claude')
})

// --- the bundled binary ---------------------------------------------------------------------

test('a path inside app.asar is moved to app.asar.unpacked, and nothing else is touched', () => {
  const inside = '/Applications/bay.app/Contents/Resources/app.asar/node_modules/x/claude'
  assert.equal(
    unpackedPath(inside),
    '/Applications/bay.app/Contents/Resources/app.asar.unpacked/node_modules/x/claude'
  )
  const dev = '/Users/x/bay/node_modules/.pnpm/x/claude'
  assert.equal(unpackedPath(dev), dev)
})

test('the bundled binary is resolved next to the SDK and returned unpacked', () => {
  const asked: string[] = []
  const found = bundledExecutable({
    platform: 'darwin',
    arch: 'arm64',
    resolve: () => '/R/app.asar/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
    resolveFrom: (base, specifier) => {
      asked.push(specifier)
      assert.ok(base.endsWith('claude-agent-sdk/sdk.mjs'), 'resolved relative to the SDK')
      return `/R/app.asar/node_modules/${specifier}`
    },
    exists: (path) => !path.includes('app.asar/')
  })
  assert.deepEqual(asked, ['@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'])
  assert.equal(found, '/R/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
})

test('no bundled binary is null, so the host falls back to the user’s claude', () => {
  const missing = bundledExecutable({
    platform: 'darwin',
    arch: 'x64',
    resolve: () => '/R/sdk.mjs',
    resolveFrom: () => {
      throw new Error('Cannot find module')
    }
  })
  assert.equal(missing, null)
})

test('on this machine, the bundled binary is actually found', () => {
  // Positive control for the two above: the real resolver, the real disk.
  const found = bundledExecutable()
  assert.ok(found, 'pnpm install should have fetched the optional platform package')
  assert.ok(found.endsWith(process.platform === 'win32' ? 'claude.exe' : 'claude'))
})

// --- the conversation -----------------------------------------------------------------------

const SESSION = '8f14e45f-ceea-467a-a7f3-2f0e1b0c1a01'

/** Message shapes as `SDKMessage` declares them, trimmed to what the runtime reads. */
const init = (sessionId: string): SDKMessage =>
  ({ type: 'system', subtype: 'init', session_id: sessionId }) as unknown as SDKMessage
const delta = (text: string, sessionId: string): SDKMessage =>
  ({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    parent_tool_use_id: null,
    session_id: sessionId
  }) as unknown as SDKMessage
const toolUse = (sessionId: string): SDKMessage =>
  ({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__bay__read_project', input: {} }]
    },
    parent_tool_use_id: null,
    session_id: sessionId
  }) as unknown as SDKMessage
const toolResult = (sessionId: string): SDKMessage =>
  ({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '{}' }] }]
    },
    parent_tool_use_id: null,
    session_id: sessionId
  }) as unknown as SDKMessage
const success = (sessionId: string): SDKMessage =>
  ({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: sessionId }) as unknown as SDKMessage

interface Call {
  prompt: string
  options: Options | undefined
}

/** A `query` that plays one script per call and records what each call was given. */
function scripted(scripts: Array<(signal: AbortSignal) => AsyncIterable<SDKMessage>>) {
  const calls: Call[] = []
  const query: QueryFn = ({ prompt, options }) => {
    calls.push({ prompt, options })
    const script = scripts[calls.length - 1]
    assert.ok(script, `query called ${calls.length} times, scripted for ${scripts.length}`)
    return script(options?.abortController?.signal ?? new AbortController().signal)
  }
  return { calls, query }
}

function collect(runtime: SdkAgentRuntime) {
  const events: AgentEvent[] = []
  let waiters: Array<{ count: number; resolve: () => void }> = []
  runtime.onEvent((event) => {
    events.push(event)
    const doneCount = events.filter((e) => e.type === 'done').length
    waiters = waiters.filter((w) => (w.count <= doneCount ? (w.resolve(), false) : true))
  })
  const dones = (count: number): Promise<void> =>
    new Promise((resolve) => {
      if (events.filter((e) => e.type === 'done').length >= count) resolve()
      else waiters.push({ count, resolve })
    })
  return { events, dones }
}

async function* play(...messages: SDKMessage[]): AsyncIterable<SDKMessage> {
  for (const message of messages) yield message
}

test('a turn streams text, tool calls and results, and ends done', { timeout: 5000 }, async () => {
  const { query } = scripted([
    () => play(init(SESSION), delta('Hel', SESSION), delta('lo', SESSION), toolUse(SESSION), toolResult(SESSION), success(SESSION))
  ])
  const runtime = new SdkAgentRuntime({ ...BASE, query })
  const { events, dones } = collect(runtime)
  const runId = runtime.send('hi')
  await dones(1)
  assert.deepEqual(events, [
    { type: 'started', runId },
    { type: 'text', runId, delta: 'Hel' },
    { type: 'text', runId, delta: 'lo' },
    { type: 'tool', runId, callId: 'toolu_1', tool: 'read_project', args: {} },
    { type: 'tool-result', runId, callId: 'toolu_1', ok: true, summary: '{}' },
    { type: 'done', runId, reason: 'complete' }
  ])
})

test('the second turn resumes the session the first one reported', { timeout: 5000 }, async () => {
  const { calls, query } = scripted([
    () => play(init(SESSION), delta('one', SESSION), success(SESSION)),
    () => play(init(SESSION), delta('two', SESSION), success(SESSION))
  ])
  const runtime = new SdkAgentRuntime({ ...BASE, query })
  const { dones } = collect(runtime)
  runtime.send('first')
  await dones(1)
  runtime.send('second')
  await dones(2)

  assert.equal(calls.length, 2)
  // Negative and positive in one: the first turn has nothing to resume, the second resumes
  // exactly the id the first turn's messages carried.
  assert.equal(calls[0]?.options?.resume, undefined)
  assert.equal(calls[1]?.options?.resume, SESSION)
  assert.equal(calls[1]?.prompt, 'second')
  // The sandbox is not a first-turn-only property.
  assert.deepEqual(calls[1]?.options?.settingSources, [])
  assert.deepEqual(calls[1]?.options?.disallowedTools, DENIED_TOOLS)
})

test('stop aborts the running turn and ends it exactly once', { timeout: 5000 }, async () => {
  let aborted = false
  const { calls, query } = scripted([
    (signal) =>
      (async function* () {
        yield init(SESSION)
        yield delta('working', SESSION)
        // Hang until aborted, then fail the way the SDK does — an AbortError out of the iterator.
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
        aborted = true
        yield delta('late text after abort', SESSION)
        throw Object.assign(new Error('Claude Code process aborted by user'), { name: 'AbortError' })
      })(),
    () => play(init(SESSION), success(SESSION))
  ])
  const runtime = new SdkAgentRuntime({ ...BASE, query })
  const { events, dones } = collect(runtime)
  const runId = runtime.send('long job')
  // Let the first two messages through.
  while (!events.some((e) => e.type === 'text')) await new Promise((r) => setImmediate(r))

  runtime.stop()
  assert.equal(calls[0]?.options?.abortController?.signal.aborted, true, 'the query was aborted')
  await dones(1)
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(aborted, 'the scripted query observed the abort')

  const forRun = events.filter((e) => e.runId === runId)
  assert.deepEqual(forRun.at(-1), { type: 'done', runId, reason: 'error', message: 'Stopped.' })
  assert.equal(forRun.filter((e) => e.type === 'done').length, 1, 'the AbortError must not end it twice')
  assert.equal(
    forRun.some((e) => e.type === 'text' && e.delta.includes('late')),
    false,
    'nothing from a stopped turn reaches the panel'
  )

  // The conversation survives the stop: the next turn resumes it.
  runtime.send('again')
  await dones(2)
  assert.equal(calls[1]?.options?.resume, SESSION)
})

test('stop with nothing running is harmless', () => {
  const runtime = new SdkAgentRuntime({ ...BASE, query: scripted([]).query })
  const { events } = collect(runtime)
  runtime.stop()
  assert.deepEqual(events, [])
})

test('a query that throws ends the turn as an error that says why', { timeout: 5000 }, async () => {
  const runtime = new SdkAgentRuntime({
    ...BASE,
    query: scripted([
      () =>
        (async function* () {
          throw new Error('Claude Code executable not found at /nope')
        })()
    ]).query
  })
  const { events, dones } = collect(runtime)
  runtime.send('hi')
  await dones(1)
  const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>
  assert.equal(done.reason, 'error')
  assert.match(done.message ?? '', /executable not found at \/nope/)
})

test('a stream that ends without a result still ends the turn', { timeout: 5000 }, async () => {
  const runtime = new SdkAgentRuntime({ ...BASE, query: scripted([() => play(init(SESSION))]).query })
  const { events, dones } = collect(runtime)
  runtime.send('hi')
  await dones(1)
  assert.equal((events.at(-1) as { reason: string }).reason, 'error')
})

test('a turn that runs past the timeout is aborted and ended', { timeout: 5000 }, async () => {
  const { calls, query } = scripted([
    (signal) =>
      (async function* () {
        yield init(SESSION)
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
        throw new Error('aborted')
      })()
  ])
  const runtime = new SdkAgentRuntime({ ...BASE, query, turnTimeoutMs: 30 })
  const { events, dones } = collect(runtime)
  runtime.send('hi')
  await dones(1)
  assert.equal(calls[0]?.options?.abortController?.signal.aborted, true)
  assert.match((events.at(-1) as { message: string }).message, /ran past/)
  assert.equal(events.filter((e) => e.type === 'done').length, 1)
})

test('session ids are read from any message that carries one', () => {
  assert.equal(sessionIdOf(init('abc')), 'abc')
  assert.equal(sessionIdOf({ type: 'result' }), null)
  assert.equal(sessionIdOf({ session_id: '' }), null)
  assert.equal(sessionIdOf(null), null)
})

test('dispose aborts and silences the runtime', { timeout: 5000 }, async () => {
  const { calls, query } = scripted([
    (signal) =>
      (async function* () {
        yield init(SESSION)
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
        throw new Error('aborted')
      })()
  ])
  const runtime = new SdkAgentRuntime({ ...BASE, query })
  const { events } = collect(runtime)
  runtime.send('hi')
  while (calls.length === 0) await new Promise((r) => setImmediate(r))
  const before = events.length
  runtime.dispose()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(calls[0]?.options?.abortController?.signal.aborted, true)
  assert.equal(events.length, before, 'no event after dispose')
})
