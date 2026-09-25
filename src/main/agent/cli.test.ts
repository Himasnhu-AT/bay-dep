/**
 * The flags bay spawns `claude` with.
 *
 * These are the sandbox. Not a comment about the sandbox, not a policy the panel enforces — the
 * argument list is the whole of it, so it is pinned here. Every assertion below names a hole
 * that was open until the flag it checks was added, and all of them were found by asking a
 * running agent to try rather than by reading documentation.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '@shared/agent'
import {
  allowedToolNames,
  BUILT_IN_TOOLS,
  CliAgentRuntime,
  cliArgs,
  descendantsOf,
  killTree,
  mcpConfig,
  processTable,
  TURN_TIMEOUT_MS,
  userContent,
  type ProcessTable
} from './cli'
import { TOOLS } from '@shared/mcp'
import { BAY_SKILLS } from '@shared/skills'
import { alive, fakeClaude, pidsIn, reap, waitFor, type FakePids } from './fixtures/fake-agent'

const OPTIONS = {
  proxyPath: '/app/out/main/mcp/index.js',
  socketPath: '/Users/x/Library/Application Support/bay/bay-mcp.sock',
  cwd: '/Users/x/Library/Application Support/bay/agent-workspace',
  systemPrompt: 'You are editing video inside bay.'
}

const args = cliArgs(OPTIONS, 'session-1')
const valueAfter = (flag: string): string | undefined => args[args.indexOf(flag) + 1]

test('every bay tool is allowed, under the name the CLI reports', () => {
  // Derived from the catalog, so a tool added tomorrow is allowed without editing this.
  for (const tool of TOOLS) assert.ok(allowedToolNames().includes(`mcp__bay__${tool.name}`))
})

test('Skill is permitted only for bay’s own skills, by name', () => {
  const skills = allowedToolNames().filter((name) => name.startsWith('Skill'))
  assert.deepEqual(skills, BAY_SKILLS.map((skill) => `Skill(${skill.slug})`))
  // Never the bare tool name, which would permit every bundled skill too.
  assert.equal(allowedToolNames().includes('Skill'), false)
})

test('the built-ins that exist are named, so everything else — shell, files, web — is absent', () => {
  // `--allowedTools` alone governs what needs *approval*, not what exists: measured, with only
  // an allow-list `Bash` ran `id`. `--tools` decides what exists. Measured with this exact
  // list: the session's tools were bay's plus these two, and a request to run `id` had nothing
  // to run it with.
  // Skill is the one addition since: the CLI expands only a leading /skill, so a message naming
  // several needs the model to load them — measured, it loaded both and followed both.
  assert.deepEqual([...BUILT_IN_TOOLS], ['ListMcpResourcesTool', 'ReadMcpResourceTool', 'Skill'])
  assert.equal(valueAfter('--tools'), 'ListMcpResourcesTool,ReadMcpResourceTool,Skill')
  for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'Agent', 'Task', 'Monitor']) {
    assert.equal(valueAfter('--tools')?.split(',').includes(tool), false, `${tool} must not exist`)
  }
})

test('--restricted is not passed: it switches off project skills', () => {
  // Measured: with --restricted the workspace skill was absent from the session and
  // "/motion-graphics" was "not installed". --tools covers what it removed, and more.
  assert.equal(args.includes('--restricted'), false)
})

test("the user's other MCP servers are not inherited", () => {
  // Measured, not assumed: a session started with `--setting-sources ''` still had another
  // server's tools in its tool list. Only `--strict-mcp-config` keeps them out.
  assert.ok(args.includes('--strict-mcp-config'))
  const config = JSON.parse(valueAfter('--mcp-config') ?? '{}')
  assert.deepEqual(Object.keys(config.mcpServers), ['bay'])
})

test('the proxy is told which bay to talk to', () => {
  // Without the socket path the proxy would look for the default one — and, finding none,
  // launch a second bay rather than talking to this one.
  const config = JSON.parse(valueAfter('--mcp-config') ?? '{}')
  assert.equal(config.mcpServers.bay.env.BAY_MCP_SOCKET, OPTIONS.socketPath)
  assert.equal(config.mcpServers.bay.args[0], OPTIONS.proxyPath)
})

test('the panel pins the full tool surface rather than inheriting a gateway mode', () => {
  // The panel allows its agent tools by name. A BAY_MCP_MODE=gateway inherited from the shell
  // that launched bay would publish three tools, none of them on the allowed list, and the
  // agent would have nothing it may call. Literal, because the proxy reads this exact name.
  const config = JSON.parse(valueAfter('--mcp-config') ?? '{}')
  assert.equal(config.mcpServers.bay.env.BAY_MCP_MODE, 'full')
})

test('the proxy runs as plain Node even though the binary is Electron', () => {
  // Chromium writes to stdout when it likes, and the protocol needs that stream byte-exact.
  const config = JSON.parse(valueAfter('--mcp-config') ?? '{}')
  assert.equal(config.mcpServers.bay.env.ELECTRON_RUN_AS_NODE, '1')
})

test('anything that would prompt is denied instead of waiting', () => {
  // There is no terminal here and the panel renders no permission dialogs, so a prompt would
  // hang the turn on a question nobody can answer.
  assert.equal(valueAfter('--permission-prompts'), 'none')
})

test("only the workspace's project settings load: bay's skills, not the user's instructions", () => {
  // A CLAUDE.md written for some other repository would put rules about that repository into a
  // video edit. The workspace holds nothing but bay's skills.
  assert.equal(valueAfter('--setting-sources'), 'project')
})

test('the stream is machine-readable in both directions', () => {
  assert.equal(valueAfter('--output-format'), 'stream-json')
  assert.equal(valueAfter('--input-format'), 'stream-json')
  assert.ok(args.includes('--include-partial-messages'), 'without this there is no streaming text')
  assert.ok(args.includes('--print'))
})

test("bay's own system prompt is the one in force", () => {
  assert.equal(valueAfter('--system-prompt'), OPTIONS.systemPrompt)
  assert.equal(valueAfter('--session-id'), 'session-1')
})

test('the config is valid JSON on one line, because it is an argv entry', () => {
  const raw = mcpConfig(OPTIONS)
  assert.doesNotThrow(() => JSON.parse(raw))
  assert.equal(raw.includes('\n'), false)
})

test('a second process for the same session resumes it rather than re-creating it', () => {
  // After Stop, the next message starts a new process. `--session-id` with an id that already
  // exists is refused by the CLI, so the restart must resume.
  const again = cliArgs(OPTIONS, 'session-1', true)
  assert.equal(again[again.indexOf('--resume') + 1], 'session-1')
  assert.equal(again.includes('--session-id'), false)
  // Positive control: the first process creates it.
  assert.equal(args.includes('--resume'), false)
})

test('killing the agent signals its whole process group, not just the pid we hold', () => {
  // The CLI spawns bay's MCP proxy. Signalling only the CLI's pid orphans the proxy, still
  // connected to the app's socket — one per stopped turn.
  const empty = (): ProcessTable => new Map()
  const sent: [number, string][] = []
  killTree(4242, 'SIGTERM', (pid, signal) => sent.push([pid, signal]), empty)
  assert.deepEqual(sent, [[process.platform === 'win32' ? 4242 : -4242, 'SIGTERM']])
  // A pid that is already gone is not an error.
  assert.doesNotThrow(() =>
    killTree(
      4242,
      'SIGTERM',
      () => {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      },
      empty
    )
  )
  // No pid (spawn failed) signals nothing.
  const none: number[] = []
  killTree(undefined, 'SIGTERM', (pid) => none.push(pid), empty)
  assert.deepEqual(none, [])
})

test('descendants outside the group are signalled by pid; those inside are left to the group signal', () => {
  // 4242 leads its group. 5000 is its child in the same group; 5001 a child that made its own
  // group (Codex's MCP server), 5002 that one's child; 6000 is unrelated.
  const table: ProcessTable = new Map([
    [4242, { ppid: 1, pgid: 4242 }],
    [5000, { ppid: 4242, pgid: 4242 }],
    [5001, { ppid: 4242, pgid: 5001 }],
    [5002, { ppid: 5001, pgid: 5001 }],
    [6000, { ppid: 1, pgid: 6000 }]
  ])
  assert.deepEqual(descendantsOf(4242, table).sort(), [5000, 5001, 5002])
  if (process.platform === 'win32') return
  const sent: number[] = []
  killTree(4242, 'SIGTERM', (pid) => sent.push(pid), () => table)
  assert.deepEqual(sent, [-4242, 5001, 5002])
})

test('a real grandchild in its own process group dies with the tree; the group signal alone misses it', { timeout: 15_000 }, async (t) => {
  if (process.platform === 'win32') {
    t.skip('SKIPPED — no process groups on Windows')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'bay-killtree-'))
  const start = (): Promise<FakePids> => {
    const parent = spawn(fakeClaude(), [], {
      env: { ...process.env, FAKE_PIDS_DIR: dir },
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: true
    })
    return waitFor('the fake to start its MCP child', () => pidsIn(dir).some((p) => p.agent === parent.pid)).then(
      () => pidsIn(dir).find((p) => p.agent === parent.pid)!
    )
  }
  const started: FakePids[] = []
  try {
    assert.ok(processTable().size > 0, 'ps answered, or nothing below is measured')

    // Negative control: the group alone — what killTree did before — leaves the MCP child running.
    const before = await start()
    started.push(before)
    killTree(before.agent, 'SIGTERM', process.kill, () => new Map())
    await waitFor('the agent to die', () => !alive(before.agent))
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.ok(alive(before.mcp), 'specimen: the MCP child is outside the group signal')

    const after = await start()
    started.push(after)
    killTree(after.agent)
    await waitFor('the agent to die', () => !alive(after.agent), 3000)
    await waitFor('its MCP child to die', () => !alive(after.mcp), 3000)
  } finally {
    reap(started)
  }
})

// ---------------------------------------------------------------------------
// The runtime's process, against a fake `claude` (fixtures/fake-agent.ts). No model is called.
// ---------------------------------------------------------------------------

function fakeRuntime(dir: string, turnTimeoutMs?: number): { runtime: CliAgentRuntime; events: AgentEvent[] } {
  process.env['FAKE_PIDS_DIR'] = dir
  const runtime = new CliAgentRuntime({
    ...OPTIONS,
    cwd: dir,
    binary: fakeClaude(),
    ...(turnTimeoutMs === undefined ? {} : { turnTimeoutMs })
  })
  const events: AgentEvent[] = []
  runtime.onEvent((event) => events.push(event))
  return { runtime, events }
}

test('a turn that times out kills claude, rather than leaving it working on the timeline', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-cli-rt-'))
  const { runtime, events } = fakeRuntime(dir, 2000)
  let pids: FakePids[] = []
  try {
    runtime.send('work forever')
    await waitFor('the fake claude to start', () => pidsIn(dir).length === 1)
    pids = pidsIn(dir)
    const [{ agent, mcp }] = pids as [FakePids]
    await waitFor('the turn to time out', () => events.some((event) => event.type === 'done'))
    assert.match(JSON.stringify(events.find((event) => event.type === 'done')), /ran past/)
    await waitFor('claude to be killed', () => !alive(agent), 3000)
    await waitFor('its MCP child to be killed', () => !alive(mcp), 3000)
  } finally {
    runtime.dispose()
    reap(pids)
  }
})

test('a stopped claude exiting late does not take the next turn’s process with it', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-cli-rt-'))
  const { runtime, events } = fakeRuntime(dir)
  let pids: FakePids[] = []
  try {
    const first = runtime.send('one')
    await waitFor('the first claude to start', () => pidsIn(dir).length === 1)
    const [old] = pidsIn(dir) as [FakePids]
    runtime.stop()
    // Sent before the stopped process has exited: its exit arrives while the second runs.
    const second = runtime.send('two')
    await waitFor('the second claude to start', () => pidsIn(dir).length === 2)
    pids = pidsIn(dir)
    await waitFor('the stopped claude to exit', () => !alive(old.agent), 3000)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const next = pids.find((entry) => entry.agent !== old.agent)!
    // The old exit neither failed the new turn nor dropped the handle on the new process.
    assert.deepEqual(
      events.filter((event) => event.type === 'done').map((event) => event.runId),
      [first],
      'only the stopped turn is done'
    )
    assert.ok(second)
    runtime.stop()
    await waitFor('stop to reach the second claude', () => !alive(next.agent), 3000)
    await waitFor('and its MCP child', () => !alive(next.mcp), 3000)
  } finally {
    runtime.dispose()
    reap(pids)
  }
})

test('a turn outlasts the slowest tool call, with room for the model around it', () => {
  // `transcribe` may spend minutes downloading a model before it transcribes; a turn that
  // times out first kills an agent whose tool was still inside its own budget.
  const slowest = Math.max(...TOOLS.map((tool) => tool.timeoutMs ?? 0))
  assert.ok(slowest > 10 * 60 * 1000, 'specimen: some tool is allowed longer than the old 10-minute turn')
  assert.ok(TURN_TIMEOUT_MS >= slowest + 5 * 60 * 1000, `turn ${TURN_TIMEOUT_MS} ms vs tool ${slowest} ms`)
})

test('an attached image goes to Claude inline, as base64 content before the text', () => {
  const files: Record<string, Buffer> = { '/att/t/a.png': Buffer.from('png-bytes'), '/att/t/sheet-1.jpg': Buffer.from('jpg-bytes') }
  const content = userContent('what colour?', ['/att/t/a.png', '/att/t/sheet-1.jpg'], (path) => {
    const bytes = files[path]
    assert.ok(bytes, `read ${path}, which was not attached`)
    return bytes
  })
  assert.deepEqual(content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('png-bytes').toString('base64') } },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('jpg-bytes').toString('base64') } },
    { type: 'text', text: 'what colour?' }
  ])
  // Nothing attached is the one text block every turn sent before attachments existed.
  assert.deepEqual(userContent('hi'), [{ type: 'text', text: 'hi' }])
})

test('the CLI runtime writes the image blocks into the stream-json turn on stdin', { skip: process.platform === 'win32', timeout: 10_000 }, async () => {
  // A stand-in `claude` that copies its stdin to a file: what bay wrote is what the CLI would read.
  const dir = mkdtempSync(join(tmpdir(), 'bay-cli-stdin-'))
  const captured = join(dir, 'stdin.jsonl')
  const binary = join(dir, 'claude')
  writeFileSync(binary, `#!/bin/sh\ncat > "${captured}"\n`)
  chmodSync(binary, 0o755)
  const image = join(dir, 'a.png')
  writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  const runtime = new CliAgentRuntime({ ...OPTIONS, cwd: dir, binary })
  runtime.send('what colour is this?', [image])
  let line = ''
  for (let i = 0; i < 100 && !line; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    line = existsSync(captured) ? readFileSync(captured, 'utf8').split('\n')[0] ?? '' : ''
  }
  runtime.dispose()
  const message = JSON.parse(line) as { type: string; message: { role: string; content: unknown[] } }
  assert.equal(message.type, 'user')
  assert.deepEqual(message.message.content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(image).toString('base64') } },
    { type: 'text', text: 'what colour is this?' }
  ])
})
