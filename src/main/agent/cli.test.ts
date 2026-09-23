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
import { allowedToolNames, BUILT_IN_TOOLS, cliArgs, killTree, mcpConfig } from './cli'
import { TOOLS } from '@shared/mcp'
import { BAY_SKILLS } from '@shared/skills'

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
