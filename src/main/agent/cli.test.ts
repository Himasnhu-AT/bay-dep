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
import { allowedToolNames, cliArgs, DENIED_TOOLS, killTree, mcpConfig } from './cli'
import { TOOLS } from '@shared/mcp'

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
  assert.equal(allowedToolNames().length, TOOLS.length)
  for (const tool of TOOLS) assert.ok(allowedToolNames().includes(`mcp__bay__${tool.name}`))
})

test('the shell is removed, not merely un-allowed', () => {
  // `--allowedTools` alone governs what needs *approval*, not what exists. Measured: with only
  // an allow-list, `Bash` with `id` ran and returned the user's uid and groups.
  assert.ok(args.includes('--restricted'), 'removes the tools that run commands or code')
  assert.ok(DENIED_TOOLS.includes('Bash'))
  assert.ok(args.includes('--disallowedTools'))
})

test('the file tools are denied by name, not left to a directory boundary', () => {
  // They were refused with "path is outside allowed working directories" — which means a path
  // *inside* the agent's working directory would have been allowed. Bay's tools are the whole
  // surface, so the boundary happening to sit in the right place is not the guarantee wanted.
  for (const tool of ['Read', 'Write', 'Edit', 'Glob', 'Grep']) {
    assert.ok(DENIED_TOOLS.includes(tool), `${tool} must be denied by name`)
  }
})

test('nothing reaches the network or other sessions', () => {
  for (const tool of ['WebFetch', 'WebSearch', 'SendMessage', 'Task']) {
    assert.ok(DENIED_TOOLS.includes(tool), `${tool} must be denied`)
  }
})

test('no denied tool is also allowed', () => {
  // A tool in both lists is a contradiction the CLI resolves however it likes.
  const allowed = new Set(allowedToolNames())
  for (const denied of DENIED_TOOLS) assert.equal(allowed.has(denied), false)
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

test("the user's own instructions are not inherited", () => {
  // A CLAUDE.md written for some other repository would put rules about that repository into
  // a video edit.
  assert.equal(valueAfter('--setting-sources'), '')
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
  const sent: [number, string][] = []
  killTree(4242, 'SIGTERM', (pid, signal) => sent.push([pid, signal]))
  assert.deepEqual(sent, [[process.platform === 'win32' ? 4242 : -4242, 'SIGTERM']])
  // A pid that is already gone is not an error.
  assert.doesNotThrow(() =>
    killTree(4242, 'SIGTERM', () => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
    })
  )
  // No pid (spawn failed) signals nothing.
  const none: number[] = []
  killTree(undefined, 'SIGTERM', (pid) => none.push(pid))
  assert.deepEqual(none, [])
})
