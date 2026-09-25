/**
 * The Codex runtime's isolation: its config, its arguments, its environment, its login link —
 * and, when a `codex` binary is on this machine, what the real CLI actually puts in front of the
 * model under them (`codex debug prompt-input`, which renders the model-visible input without
 * calling a model).
 *
 * Every "this is kept out" assertion there has a positive control beside it: the same probe with
 * the isolation undone must see the thing, or the absence proves nothing (CLAUDE.md, "Every
 * negative control needs its own positive control").
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOOLS } from '@shared/mcp'
import { BAY_SKILLS } from '@shared/skills'
import {
  codexArgs,
  codexConfig,
  codexEnv,
  findCodexSession,
  prepareCodexHome,
  toolTimeoutSeconds,
  userCodexHome,
  withSkills
} from './codex'
import { findCodex } from './locate'
import { agentSystemPrompt } from './prompt'
import { installSkills } from './skills'

const OPTIONS = {
  proxyPath: '/Applications/bay.app/Contents/Resources/app.asar/out/main/mcp/index.js',
  socketPath: '/Users/x/Library/Application Support/bay/bay-agent.sock',
  systemPrompt: agentSystemPrompt('codex')
}

/** `[section]` headers of a TOML document, in order. */
const sections = (toml: string): string[] =>
  [...toml.matchAll(/^\[([^\]]+)\]\s*$/gm)].map((match) => match[1]!)

/** The value of `key = …` inside `[section]` (top level when section is ''). */
function valueIn(toml: string, section: string, key: string): string | undefined {
  let current = ''
  for (const line of toml.split('\n')) {
    const header = /^\[([^\]]+)\]\s*$/.exec(line)
    if (header) {
      current = header[1]!
      continue
    }
    const pair = /^([A-Za-z0-9_]+) = (.*)$/.exec(line)
    if (pair && current === section && pair[1] === key) return pair[2]
  }
  return undefined
}

test('the only MCP server in the agent config is bay', () => {
  const servers = sections(codexConfig(OPTIONS)).filter((name) => name.startsWith('mcp_servers.'))
  assert.deepEqual(servers, ['mcp_servers.bay', 'mcp_servers.bay.env'])
})

test('bay is launched the way the Claude runtimes launch it: its socket, full mode, run as Node', () => {
  const toml = codexConfig(OPTIONS)
  assert.equal(valueIn(toml, 'mcp_servers.bay', 'args'), `[${JSON.stringify(OPTIONS.proxyPath)}]`)
  assert.equal(valueIn(toml, 'mcp_servers.bay.env', 'BAY_MCP_SOCKET'), JSON.stringify(OPTIONS.socketPath))
  assert.equal(valueIn(toml, 'mcp_servers.bay.env', 'BAY_MCP_MODE'), '"full"')
  assert.equal(valueIn(toml, 'mcp_servers.bay.env', 'ELECTRON_RUN_AS_NODE'), '"1"')
})

test('the sandbox is read-only, nothing waits on approval, and there is no web search', () => {
  const toml = codexConfig(OPTIONS)
  assert.equal(valueIn(toml, '', 'sandbox_mode'), '"read-only"')
  assert.equal(valueIn(toml, '', 'approval_policy'), '"never"')
  assert.equal(valueIn(toml, '', 'web_search'), '"disabled"')
})

test('the shell, ChatGPT apps, plugins, browser and computer use are switched off', () => {
  const toml = codexConfig(OPTIONS)
  for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'browser_use', 'computer_use', 'image_generation']) {
    assert.equal(valueIn(toml, 'features', feature), 'false', feature)
  }
  // Codex reaches MCP tools through its code-mode host; turning it off leaves bay unreachable.
  assert.equal(valueIn(toml, 'features', 'code_mode_host'), undefined)
})

test('Codex waits on a bay tool at least as long as bay lets the slowest tool run', () => {
  // Codex's own default is 60s; `transcribe` is allowed 15 minutes.
  const slowest = Math.max(...TOOLS.map((tool) => tool.timeoutMs ?? 0))
  assert.ok(slowest > 60_000, 'the specimen needs a tool slower than Codex’s default')
  assert.ok(toolTimeoutSeconds() * 1000 >= slowest)
  assert.equal(valueIn(codexConfig(OPTIONS), 'mcp_servers.bay', 'tool_timeout_sec'), String(toolTimeoutSeconds()))
})

test('the system prompt survives TOML quoting byte for byte', () => {
  const nasty = 'Line one\n"quoted" and \\backslash\\ and a tab\there — ünïcode \u0001 """ end'
  const toml = codexConfig({ ...OPTIONS, systemPrompt: nasty })
  const raw = valueIn(toml, '', 'developer_instructions')!
  // One physical line: a raw newline inside a basic string is a TOML syntax error.
  assert.ok(!raw.includes('\n'))
  assert.equal(JSON.parse(raw), nasty)
})

test('the first turn starts a thread in the workspace; later turns resume it by id', () => {
  const first = codexArgs(null, '/w')
  assert.deepEqual(first.slice(0, 2), ['exec', '--json'])
  assert.equal(first[first.indexOf('--cd') + 1], '/w')
  assert.equal(first.at(-1), '-')
  assert.ok(first.includes('--strict-config'))

  const later = codexArgs('01a0d446-662c-7200-97f4-a3a89a897806', '/w')
  assert.deepEqual(later.slice(0, 3), ['exec', 'resume', '--json'])
  assert.deepEqual(later.slice(-2), ['01a0d446-662c-7200-97f4-a3a89a897806', '-'])
})

test('an image cannot swallow the stdin marker', () => {
  // `-i <FILE>...` takes every following word as an image, `-` included.
  const args = codexArgs(null, '/w', ['/a.png', '/b.png'])
  assert.ok(args.includes('--image=/a.png') && args.includes('--image=/b.png'))
  assert.ok(!args.includes('-i') && !args.includes('--image'))
  assert.equal(args.at(-1), '-')
})

test('Codex runs with bay’s CODEX_HOME and a HOME of its own, and no ELECTRON_RUN_AS_NODE', () => {
  const env = codexEnv('/u/agent-codex', {
    HOME: '/Users/x',
    CODEX_HOME: '/Users/x/.codex',
    ELECTRON_RUN_AS_NODE: '1',
    PATH: '/usr/bin'
  })
  assert.equal(env['CODEX_HOME'], '/u/agent-codex')
  assert.equal(env['HOME'], '/u/agent-codex/home')
  assert.equal(env['ELECTRON_RUN_AS_NODE'], undefined)
  assert.equal(env['PATH'], '/usr/bin')
})

test('the user’s login is found in their CODEX_HOME, or ~/.codex', () => {
  assert.equal(userCodexHome({}, '/Users/x'), '/Users/x/.codex')
  assert.equal(userCodexHome({ CODEX_HOME: '/elsewhere' }, '/Users/x'), '/elsewhere')
})

test('the agent home links the login, and refuses clearly when there is none', () => {
  const root = mkdtempSync(join(tmpdir(), 'bay-codex-'))
  const user = join(root, 'user-codex')
  const agent = join(root, 'agent-codex')
  mkdirSync(user)

  const missing = prepareCodexHome(agent, 'x = 1\n', user)
  assert.equal(missing.ok, false)
  assert.match((missing as { error: string }).error, /codex login/)

  writeFileSync(join(user, 'auth.json'), '{"auth_mode":"chatgpt"}')
  writeFileSync(join(agent, 'AGENTS.md'), 'left by someone')
  // A file where the link belongs — Codex replacing the link on a token refresh — is put back.
  writeFileSync(join(agent, 'auth.json'), '{"stale":true}')
  assert.deepEqual(prepareCodexHome(agent, 'x = 1\n', user), { ok: true })
  assert.ok(lstatSync(join(agent, 'auth.json')).isSymbolicLink())
  assert.equal(readlinkSync(join(agent, 'auth.json')), join(user, 'auth.json'))
  assert.equal(readFileSync(join(agent, 'config.toml'), 'utf8'), 'x = 1\n')
  assert.throws(() => lstatSync(join(agent, 'AGENTS.md')))
  // Nothing of the user's home was written to.
  assert.equal(readFileSync(join(user, 'auth.json'), 'utf8'), '{"auth_mode":"chatgpt"}')
})

test('a thread’s session file is found by its id, not by being newest', () => {
  const sessions = mkdtempSync(join(tmpdir(), 'bay-codex-sessions-'))
  const day = join(sessions, '2026', '09', '24')
  mkdirSync(day, { recursive: true })
  const mine = join(day, 'rollout-2026-09-24T22-02-58-01a0d443-5982-7263-85b3-40e561fc7a0c.jsonl')
  writeFileSync(mine, '{}\n')
  writeFileSync(join(day, 'rollout-2026-09-24T23-00-00-01a0d446-662c-7200-97f4-a3a89a897806.jsonl'), '{}\n')
  assert.equal(findCodexSession(sessions, '01a0d443-5982-7263-85b3-40e561fc7a0c'), mine)
  assert.equal(findCodexSession(sessions, '01a0d4ff-0000-0000-0000-000000000000'), null)
  assert.equal(findCodexSession(join(sessions, 'absent'), 'x'), null)
})

test('a skill the user names is put in front of the message; prose and unknown names are not', () => {
  const skill = BAY_SKILLS[0]!
  const other = BAY_SKILLS[1]
  const sent = withSkills(`tighten this with /${skill.slug} please`)
  assert.ok(sent.startsWith(`<bay-skill name="${skill.slug}">\n${skill.body}\n</bay-skill>`))
  assert.ok(sent.endsWith(`tighten this with /${skill.slug} please`))
  // Named twice, sent once.
  assert.equal(withSkills(`/${skill.slug} and again /${skill.slug}`).split('<bay-skill ').length, 2)
  if (other) {
    const both = withSkills(`/${skill.slug} then /${other.slug}`)
    assert.ok(both.includes(`name="${skill.slug}"`) && both.includes(`name="${other.slug}"`))
  }
  assert.equal(withSkills('/etc/hosts is odd'), '/etc/hosts is odd')
  assert.equal(withSkills('/not-a-bay-skill'), '/not-a-bay-skill')
})

test('each provider’s prompt names its own way of loading a skill', () => {
  assert.match(agentSystemPrompt('claude'), /with the Skill\s+tool/)
  assert.doesNotMatch(agentSystemPrompt('codex'), /Skill\s+tool/)
  assert.match(agentSystemPrompt('codex'), /<bay-skill name=/)
  // Everything else is shared.
  assert.ok(agentSystemPrompt('codex').startsWith('You are editing video inside bay'))
})

// ---------------------------------------------------------------------------
// Against the real binary. Skips loudly without one: an isolation test that cannot run must not
// read as a pass.
// ---------------------------------------------------------------------------

const codex = await findCodex()

/** The model-visible input Codex builds, as one string. No model is called. */
function promptInput(bin: string, cwd: string, env: Record<string, string>, extra: string[] = []): string {
  const out = spawnSync(bin, ['debug', 'prompt-input', ...extra, 'hello'], { cwd, env, encoding: 'utf8', timeout: 60_000 })
  assert.equal(out.status, 0, `codex debug prompt-input failed: ${out.stderr}`)
  return out.stdout
}

test('real codex: the model sees bay’s instructions, and not the user’s skills or project docs', { timeout: 120_000 }, (t) => {
  if (!codex) {
    t.skip('SKIPPED — no `codex` binary on this machine, so the isolation against the real CLI is unmeasured')
    return
  }
  const root = mkdtempSync(join(tmpdir(), 'bay-codex-real-'))
  const workspace = join(root, 'agent-workspace')
  mkdirSync(workspace)
  installSkills(workspace)
  // What the user's own setup would inject if it leaked: a personal skill and a project doc.
  const userHome = join(root, 'user-home')
  mkdirSync(join(userHome, '.agents', 'skills', 'user-marker-skill'), { recursive: true })
  writeFileSync(
    join(userHome, '.agents', 'skills', 'user-marker-skill', 'SKILL.md'),
    '---\nname: user-marker-skill\ndescription: a personal skill of the user\n---\n\nUSER-SKILL-BODY\n'
  )
  writeFileSync(join(workspace, 'AGENTS.md'), 'WORKSPACE-AGENTS-MARKER\n')

  const codexHome = join(root, 'agent-codex')
  mkdirSync(codexHome)
  const prompt = `${agentSystemPrompt('codex')}\nPROMPT-MARKER-7731`
  writeFileSync(join(codexHome, 'config.toml'), codexConfig({ ...OPTIONS, systemPrompt: prompt }))
  const env = codexEnv(codexHome)

  const seen = promptInput(codex.path, workspace, env)
  const messages = JSON.parse(seen) as { role?: string; content?: { text?: string }[] }[]
  const developer = messages
    .filter((message) => message.role === 'developer')
    .flatMap((message) => message.content ?? [])
    .map((part) => part.text ?? '')
  assert.ok(developer.includes(prompt), 'the system prompt reaches the model as a developer message, verbatim')
  assert.ok(!seen.includes('user-marker-skill'), "the user's personal skills are not listed")
  assert.ok(!seen.includes('WORKSPACE-AGENTS-MARKER'), 'no AGENTS.md is read from the workspace')
  assert.ok(!seen.includes('skill-creator'), "Codex's bundled skills are off")

  // Positive controls: the same probe with each isolation undone sees what it kept out.
  assert.ok(promptInput(codex.path, workspace, { ...env, HOME: userHome }).includes('user-marker-skill'))
  assert.ok(
    promptInput(codex.path, workspace, env, ['-c', 'project_doc_max_bytes=32768']).includes('WORKSPACE-AGENTS-MARKER')
  )
  assert.ok(promptInput(codex.path, workspace, env, ['-c', 'skills.bundled.enabled=true']).includes('skill-creator'))
})
