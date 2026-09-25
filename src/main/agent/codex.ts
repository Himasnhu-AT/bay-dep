/**
 * OpenAI's Codex CLI, running inside bay, driving bay.
 *
 * The second provider beside Claude Code, and the same bargain: the `codex` binary the user
 * already installed and signed in to, so there is no API key to ask for. The panel cannot tell
 * the two apart — this runtime turns Codex's `--json` stream into the same `AgentEvent`s
 * (`codex-stream.ts`).
 *
 * **One process per turn.** `codex exec` takes one prompt and exits; there is no stream-json
 * input mode to keep a process listening. The first turn is `codex exec --json`, which names a
 * thread on its first line; every later turn is `codex exec resume <thread> --json`, which
 * carries the model's context over from the session file Codex wrote. Stop kills the turn's
 * process tree, and the next send resumes the same thread — so a stop loses the turn, not the
 * conversation.
 *
 * **Bay's tools and nothing else — as far as Codex allows, and measured rather than assumed**
 * (CLAUDE.md, "The in-app agent's sandbox"). Codex has no `--tools` allow-list, so isolation is
 * three layers:
 *
 * - **Its own `CODEX_HOME`** (`<userData>/agent-codex`), holding a `config.toml` bay writes on
 *   every start whose only MCP server is bay, and a link to the user's `auth.json` for the login
 *   — nothing else of `~/.codex`. The user's own MCP servers, plugins, rules, memories and
 *   AGENTS.md live in *their* `CODEX_HOME` and are never read.
 * - **Its own `HOME`**, because Codex also reads skills from `~/.agents/skills` — measured: the
 *   user's personal skills were listed to the model under an isolated `CODEX_HOME`, and were gone
 *   with `HOME` pointed elsewhere.
 * - **The config itself**: read-only sandbox, approval `never` (nothing can wait on a prompt no
 *   one can see), no web search, no project docs, and every tool family bay does not need turned
 *   off by feature flag — shell, apps (ChatGPT connectors: the account's Gmail and Drive tools
 *   were loaded otherwise), plugins, browser and computer use, image generation, memories, hooks.
 *   `--strict-config` makes a key this Codex does not recognise a failed start rather than an
 *   isolation setting silently ignored.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir, setPriority } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '@shared/agent'
import { TOOLS } from '@shared/mcp'
import { skillSegments, type BaySkill } from '@shared/skills'
import { AGENT_NICENESS, bayMcpServer, childEnv, killTree, TURN_TIMEOUT_MS } from './cli'
import { codexToAgentEvents, newCodexStreamState, parseCodexLine, type CodexStreamState } from './codex-stream'
import type { HostedAgentRuntime } from './runtime'

export interface CodexOptions {
  /** The `codex` binary. */
  binary: string
  /** Absolute path to bay's MCP proxy bundle — `out/main/mcp/index.js`. */
  proxyPath: string
  /** The agent's own socket, `bay-agent.sock`, under the in-app file policy. */
  socketPath: string
  /** Where the agent's own files live. Never the project directory. */
  cwd: string
  systemPrompt: string
  /** bay's `CODEX_HOME` for the agent — never the user's. */
  codexHome: string
}

/** The user's own Codex home, where their login lives. Read from, never written to. */
export function userCodexHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const set = env['CODEX_HOME']?.trim()
  return set ? set : join(home, '.codex')
}

/**
 * Feature flags turned off in the agent's config. Each is a tool family Codex would otherwise put
 * in the model's hands, or a source of instructions bay does not control. Names as
 * `codex features list` prints them (0.149.1).
 *
 * `code_mode_host` is deliberately **not** here: Codex exposes MCP tools to the model through
 * it — measured: with it off, bay's tools were unreachable ("code-mode host is disabled").
 */
export const DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'shell_snapshot',
  'apps',
  'plugins',
  'remote_plugin',
  'recommended_plugins',
  'tool_suggest',
  'browser_use',
  'browser_use_external',
  'in_app_browser',
  'computer_use',
  'image_generation',
  'view_image',
  'multi_agent',
  'multi_agent_v2',
  'goals',
  'memories',
  'hooks',
  'skill_mcp_dependency_install',
  'workspace_dependencies'
] as const

/**
 * A TOML basic string. JSON's string escapes (`\"`, `\\`, `\n`, `\uXXXX`) are all valid TOML
 * basic-string escapes, and JSON escapes every control character TOML forbids raw.
 */
export function tomlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * How long Codex waits on one bay tool call. Its default is 60 seconds, and `transcribe` alone is
 * allowed 15 minutes — so without this a first transcription, still downloading its model, would
 * be abandoned by Codex while bay was still working on it.
 */
export function toolTimeoutSeconds(): number {
  return Math.ceil(Math.max(60_000, ...TOOLS.map((tool) => tool.timeoutMs ?? 0)) / 1000) + 30
}

/** The agent's `config.toml`. The only MCP server is bay. */
export function codexConfig(options: Pick<CodexOptions, 'proxyPath' | 'socketPath' | 'systemPrompt'>): string {
  const server = bayMcpServer(options)
  const lines = [
    '# Written by bay on every agent start. Edits here are overwritten.',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    'web_search = "disabled"',
    // AGENTS.md from the working directory and its parents: none of them are bay's.
    'project_doc_max_bytes = 0',
    'check_for_update_on_startup = false',
    // Reasoning arrives as a summary item, which the panel shows as thinking.
    'model_reasoning_summary = "auto"',
    `developer_instructions = ${tomlString(options.systemPrompt)}`,
    '',
    '[analytics]',
    'enabled = false',
    '',
    // Codex's own bundled skills (image generation, skill and plugin authoring) are not bay's.
    '[skills.bundled]',
    'enabled = false',
    '',
    '[features]',
    ...DISABLED_FEATURES.map((feature) => `${feature} = false`),
    '',
    '[mcp_servers.bay]',
    `command = ${tomlString(server.command)}`,
    `args = [${server.args.map(tomlString).join(', ')}]`,
    'startup_timeout_sec = 30',
    `tool_timeout_sec = ${toolTimeoutSeconds()}`,
    '',
    '[mcp_servers.bay.env]',
    ...Object.entries(server.env).map(([key, value]) => `${key} = ${tomlString(value)}`),
    ''
  ]
  return lines.join('\n')
}

/**
 * The arguments for one turn. The prompt is read from stdin (`-`), never argv: a message can be
 * long, and argv is visible to every process on the machine.
 *
 * Images use `--image=<path>`, one per flag, because `-i <FILE>...` takes every following word
 * as another image — including the `-` that says the prompt is on stdin.
 */
export function codexArgs(threadId: string | null, cwd: string, images: readonly string[] = []): string[] {
  const common = [
    '--json',
    '--skip-git-repo-check',
    '--strict-config',
    ...images.map((image) => `--image=${image}`)
  ]
  return threadId
    ? ['exec', 'resume', ...common, threadId, '-']
    : ['exec', ...common, '--cd', cwd, '-']
}

/**
 * The environment for Codex's process: the Claude runtimes' base (no `ELECTRON_RUN_AS_NODE`),
 * plus bay's `CODEX_HOME`, and a `HOME` inside it so `~/.agents/skills` is bay's empty folder
 * rather than the user's skills.
 */
export function codexEnv(codexHome: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env = childEnv(base)
  env['CODEX_HOME'] = codexHome
  env['HOME'] = join(codexHome, 'home')
  return env
}

/**
 * Write the agent's `CODEX_HOME`: the config, and a link to the user's login.
 *
 * A **link**, not a copy. Codex refreshes its token in place; a copy would refresh on its own and
 * could leave the user's `~/.codex/auth.json` holding a refresh token that has since been rotated
 * out. Recreated on every start, so a link Codex replaced with a file is put back.
 */
export function prepareCodexHome(
  codexHome: string,
  config: string,
  authSource: string
): { ok: true } | { ok: false; error: string } {
  mkdirSync(join(codexHome, 'home'), { recursive: true })
  writeFileSync(join(codexHome, 'config.toml'), config)
  // Instructions are `developer_instructions`; an AGENTS.md here would be read alongside them.
  rmSync(join(codexHome, 'AGENTS.md'), { force: true })

  const source = join(authSource, 'auth.json')
  const target = join(codexHome, 'auth.json')
  let present = false
  try {
    lstatSync(target)
    present = true
  } catch {
    // Not there yet.
  }
  if (present) unlinkSync(target)
  if (!existsSync(source)) {
    return {
      ok: false,
      error:
        `Codex is installed but not signed in: there is no ${source}. Run \`codex login\` in a ` +
        `terminal once, then start the agent again.`
    }
  }
  symlinkSync(source, target)
  return { ok: true }
}

/**
 * The message with the instructions of every bay skill it names (`/captions`, anywhere, several
 * at once) put in front of it, each in a `<bay-skill>` tag the system prompt tells the model about.
 * A message naming none is returned unchanged. Only bay's own skills count — `/etc/hosts` is prose.
 */
export function withSkills(text: string): string {
  const named: BaySkill[] = []
  for (const part of skillSegments(text)) {
    if (part.skill && !named.includes(part.skill)) named.push(part.skill)
  }
  if (named.length === 0) return text
  const blocks = named.map((skill) => `<bay-skill name="${skill.slug}">\n${skill.body}\n</bay-skill>`)
  return `${blocks.join('\n\n')}\n\n${text}`
}

/** The rollout file Codex wrote for a thread, found by id — never "the newest file". */
export function findCodexSession(sessionsDir: string, threadId: string): string | null {
  const suffix = `${threadId}.jsonl`
  const walk = (dir: string, depth: number): string | null => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isFile() && entry.name.endsWith(suffix)) return path
      // sessions/YYYY/MM/DD/rollout-…-<thread>.jsonl
      if (entry.isDirectory() && depth < 4) {
        const found = walk(path, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return walk(sessionsDir, 0)
}

export class CodexAgentRuntime implements HostedAgentRuntime {
  readonly id = randomUUID()
  #child: ChildProcessWithoutNullStreams | null = null
  #buffer = ''
  #listeners = new Set<(event: AgentEvent) => void>()
  #runId: string | null = null
  #stream: CodexStreamState = newCodexStreamState()
  #timer: NodeJS.Timeout | null = null
  /** Codex's thread id, from the first turn's `thread.started`. Every later turn resumes it. */
  #threadId: string | null = null
  readonly #options: CodexOptions

  constructor(options: CodexOptions) {
    this.#options = options
  }

  get sessionId(): string | null {
    return this.#threadId
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(event: AgentEvent): void {
    for (const listener of this.#listeners) listener(event)
  }

  send(text: string, images: readonly string[] = []): string {
    const runId = randomUUID()
    // One turn at a time: a second send while one runs abandons the first, as the CLI's does.
    if (this.#runId) this.stop()
    this.#runId = runId
    this.#stream = newCodexStreamState(this.#threadId)
    this.#emit({ type: 'started', runId })

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(this.#options.binary, codexArgs(this.#threadId, this.#options.cwd, images), {
        cwd: this.#options.cwd,
        env: codexEnv(this.#options.codexHome),
        stdio: ['pipe', 'pipe', 'pipe'],
        // Its own process group, so `killTree` reaches bay's MCP proxy that Codex spawns.
        detached: process.platform !== 'win32'
      })
    } catch (error) {
      this.#fail(`codex could not be started: ${(error as Error).message}`)
      return runId
    }
    this.#child = child
    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, AGENT_NICENESS)
      } catch {
        // Normal priority is a degradation, not a failure.
      }
    }

    this.#buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.#consume(chunk, runId))
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000)
    })
    child.on('error', (error) => {
      if (this.#runId === runId) this.#fail(`codex could not be started: ${error.message}`)
    })
    // `close`, not `exit`: `exit` can fire while stdout still holds the last lines, and the last
    // line is the `turn.completed` that says the turn succeeded.
    child.on('close', (code) => {
      if (this.#child === child) this.#child = null
      // Exiting without `turn.completed`/`turn.failed` is a failure whatever the code says: the
      // panel is waiting for an answer that is never coming.
      if (this.#runId === runId) {
        this.#fail(
          code === 0
            ? 'codex exited before finishing the turn.'
            : `codex exited with code ${code}. ${stderrReason(stderr)}`
        )
      }
    })

    this.#timer = setTimeout(
      () => this.#fail(`The turn ran past ${Math.round(TURN_TIMEOUT_MS / 60000)} minutes and was stopped.`),
      TURN_TIMEOUT_MS
    )
    child.stdin.on('error', () => {
      // The process died before reading its prompt; `exit` reports that.
    })
    child.stdin.end(withSkills(text))
    return runId
  }

  #consume(chunk: string, runId: string): void {
    this.#buffer += chunk
    let index: number
    while ((index = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, index)
      this.#buffer = this.#buffer.slice(index + 1)
      const message = parseCodexLine(line)
      if (!message || this.#runId !== runId) continue
      for (const event of codexToAgentEvents(message, runId, this.#stream)) {
        if (event.type === 'done') this.#settle()
        this.#emit(event)
      }
      if (this.#stream.threadId) this.#threadId = this.#stream.threadId
    }
  }

  #settle(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#runId = null
  }

  #fail(message: string): void {
    const runId = this.#runId
    this.#settle()
    if (runId) this.#emit({ type: 'done', runId, reason: 'error', message })
  }

  stop(): void {
    this.#fail('Stopped.')
    killTree(this.#child?.pid)
    this.#child = null
    this.#buffer = ''
  }

  dispose(): void {
    this.#settle()
    this.#listeners.clear()
    killTree(this.#child?.pid)
    this.#child = null
  }
}

/**
 * The useful end of Codex's stderr. It opens with "Reading additional input from stdin..." on
 * every run and logs at ERROR for things that did not stop the turn, so the tail is the part that
 * says why it ended.
 */
function stderrReason(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('Reading additional input from stdin'))
    .slice(-3)
    .join('\n')
    .slice(-500)
}
