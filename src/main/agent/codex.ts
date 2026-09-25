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
 * - **Its own `CODEX_HOME`** (`<userData>/.agent-codex` — hidden, so the in-app agent's path
 *   checks refuse it as they refuse any hidden folder), holding a `config.toml` bay writes on
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
import { randomBytes, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir, setPriority } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentEvent } from '@shared/agent'
import { TOOLS } from '@shared/mcp'
import { typedText } from '@shared/pins'
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
  /**
   * The user's own `CODEX_HOME`, whose `auth.json` bay's links to. When given, the link is
   * checked after every turn and on stop (`reconcileCodexAuth`).
   */
  authSource?: string
  /** How long a turn may run. `TURN_TIMEOUT_MS` unless a test needs to see one run out. */
  turnTimeoutMs?: number
}

/**
 * The user's own Codex home, where their login lives. Read from, and written to in exactly one
 * case: handing back a login Codex refreshed through bay's link (`reconcileCodexAuth`).
 */
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
    // With approval_policy "never", Codex refuses every MCP call it would otherwise ask about —
    // measured on 0.149.1: read_project ran, add_track came back "MCP tool call requires
    // approval, but approval policy is never" and the timeline was unchanged. bay's tools are
    // gated by bay (policy.ts, and "Ask before editing" through propose_edit), so Codex approves
    // them and leaves the decision to bay.
    'default_tools_approval_mode = "approve"',
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
 *
 * Without `CODEX_API_KEY` and `OPENAI_API_KEY`: bay borrows the ChatGPT login, and a key left in
 * the shell that launched bay would otherwise be what Codex spends — billing an API account the
 * user never chose for this, with nothing on screen to say so.
 */
export function codexEnv(codexHome: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env = childEnv(base)
  delete env['CODEX_API_KEY']
  delete env['OPENAI_API_KEY']
  env['CODEX_HOME'] = codexHome
  env['HOME'] = join(codexHome, 'home')
  return env
}

/** Where bay records the login it linked, so a later check can tell whose change a change is. */
const AUTH_RECORD = 'bay-auth-link.json'

/** A file's identity for "has it changed since": modification time to the nanosecond, and size. */
function fileStamp(path: string): { mtimeNs: string; size: number } | null {
  try {
    const stat = statSync(path, { bigint: true })
    return { mtimeNs: stat.mtimeNs.toString(), size: Number(stat.size) }
  } catch {
    return null
  }
}

function readRecord(codexHome: string): { mtimeNs: string; size: number } | null {
  try {
    const value = JSON.parse(readFileSync(join(codexHome, AUTH_RECORD), 'utf8')) as { mtimeNs?: unknown; size?: unknown }
    return typeof value.mtimeNs === 'string' && typeof value.size === 'number'
      ? { mtimeNs: value.mtimeNs, size: value.size }
      : null
  } catch {
    return null
  }
}

/** Link `<codexHome>/auth.json` to the user's login and record what that login looked like. */
function relink(codexHome: string, source: string): void {
  const target = join(codexHome, 'auth.json')
  rmSync(target, { force: true })
  if (!existsSync(source)) {
    rmSync(join(codexHome, AUTH_RECORD), { force: true })
    return
  }
  symlinkSync(source, target)
  writeFileSync(join(codexHome, AUTH_RECORD), JSON.stringify(fileStamp(source)))
}

export type AuthReconciled =
  /** The link is intact; nothing to do beyond noting the login's current state. */
  | 'linked'
  /** Codex had replaced the link with a refreshed login, and the user's was as bay left it: handed back. */
  | 'returned'
  /** Codex had replaced the link, but the user's login changed meanwhile (or bay cannot prove it did not): theirs wins. */
  | 'discarded'
  /** There was no link, or it pointed elsewhere; it points at the user's login again. */
  | 'relinked'

/**
 * Put bay's `auth.json` back to being a link to the user's, without losing a refreshed login.
 *
 * Codex writes its token by renaming a new file over `auth.json`. Through a link, that replaces
 * the *link* with a regular file holding a newly rotated refresh token, while the user's own
 * `~/.codex/auth.json` keeps the old one — which the server has since retired, so their terminal
 * `codex` would fail to refresh and make them sign in again.
 *
 * So after every turn: if the link is now a file, and the user's login is exactly as it was when
 * bay linked it (modification time and size, recorded at link time), the new login is written
 * back over theirs — atomically, mode 0600 — and the link restored. If theirs changed meanwhile
 * (they signed in again, or their own `codex` refreshed it), theirs is newer than anything bay
 * holds: bay's copy is discarded. **This is the only write bay makes to the user's Codex home.**
 */
export function reconcileCodexAuth(codexHome: string, authSource: string): AuthReconciled {
  const source = join(authSource, 'auth.json')
  const target = join(codexHome, 'auth.json')
  let kind: 'link' | 'file' | 'none' = 'none'
  try {
    const stat = lstatSync(target)
    kind = stat.isSymbolicLink() ? 'link' : stat.isFile() ? 'file' : 'none'
  } catch {
    // Not there.
  }

  if (kind === 'link' && readlinkSync(target) === source) {
    // Codex may also refresh *through* the link, which changes the user's file legitimately;
    // noting its state now keeps that from reading as the user's own change next time.
    const stamp = fileStamp(source)
    if (stamp) writeFileSync(join(codexHome, AUTH_RECORD), JSON.stringify(stamp))
    return 'linked'
  }

  if (kind === 'file') {
    const record = readRecord(codexHome)
    const now = fileStamp(source)
    const unchanged = record !== null && now !== null && record.mtimeNs === now.mtimeNs && record.size === now.size
    if (unchanged) {
      const contents = readFileSync(target)
      const temp = join(dirname(source), `.auth.json.bay-${randomBytes(6).toString('hex')}`)
      writeFileSync(temp, contents, { mode: 0o600 })
      renameSync(temp, source)
      relink(codexHome, source)
      return 'returned'
    }
    relink(codexHome, source)
    return 'discarded'
  }

  relink(codexHome, source)
  return 'relinked'
}

/**
 * Write the agent's `CODEX_HOME`: the config, and a link to the user's login.
 *
 * A **link**, not a copy, so a login refreshed by the user's own `codex` reaches bay's at once.
 * A refresh by bay's Codex that replaced the link with a file is handed back first
 * (`reconcileCodexAuth`) — bay may have quit before the turn's own check ran.
 */
export function prepareCodexHome(
  codexHome: string,
  config: string,
  authSource: string
): { ok: true } | { ok: false; error: string } {
  mkdirSync(join(codexHome, 'home'), { recursive: true })
  writeFileSync(join(codexHome, 'config.toml'), config)
  // Instructions are `developer_instructions`; an AGENTS.md here — or the override Codex reads
  // in its place — would be read alongside them.
  rmSync(join(codexHome, 'AGENTS.md'), { force: true })
  rmSync(join(codexHome, 'AGENTS.override.md'), { force: true })

  const source = join(authSource, 'auth.json')
  reconcileCodexAuth(codexHome, authSource)
  if (!existsSync(source)) {
    return {
      ok: false,
      error:
        `Codex is installed but not signed in: there is no ${source}. Run \`codex login\` in a ` +
        `terminal once, then start the agent again.`
    }
  }
  return { ok: true }
}

/**
 * Move an agent home from the folder bay used to use (`<userData>/agent-codex`, visible, so the
 * in-app agent's path checks did not refuse it) to the hidden one, then remove the old folder.
 *
 * It held only what bay writes on every start — the config, the login link — and Codex's
 * `sessions/`, which are moved so an earlier conversation's transcript can still be exported. A
 * refreshed login left there is handed back first, under the same rule as after a turn.
 */
export function migrateCodexHome(oldHome: string, newHome: string, authSource: string): void {
  if (!existsSync(oldHome)) return
  if (lstatSync(join(oldHome, 'auth.json'), { throwIfNoEntry: false })) reconcileCodexAuth(oldHome, authSource)
  const sessions = join(oldHome, 'sessions')
  if (existsSync(sessions)) moveInto(sessions, join(newHome, 'sessions'))
  rmSync(oldHome, { recursive: true, force: true })
}

/** Move `from`'s contents into `to`, merging folders; a file already at the destination is kept. */
function moveInto(from: string, to: string): void {
  if (!existsSync(to)) {
    mkdirSync(dirname(to), { recursive: true })
    renameSync(from, to)
    return
  }
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) moveInto(source, target)
    else if (!existsSync(target)) renameSync(source, target)
  }
}

/**
 * The message with the instructions of every bay skill the *user typed* (`/captions`, anywhere,
 * several at once) put in front of it, each in a `<bay-skill>` tag the system prompt tells the
 * model about. A message naming none is returned unchanged but for the neutralising below. Only
 * bay's own skills count — `/etc/hosts` is prose.
 *
 * Three things keep the tag bay's:
 * - Skills are read from `typedText`, so a `/slug` inside a pinned asset's or clip's name — text
 *   bay quotes, not text the user wrote — loads nothing.
 * - Every `<bay-skill` or `</bay-skill` in the message itself becomes `‹bay-skill`, so a name, a
 *   pasted transcript or the user's own text cannot open or close a block.
 * - Real blocks carry `nonce`, random per message; the system prompt says only blocks at the top
 *   carrying the first one's nonce count. Text written before this message cannot know it.
 */
export function withSkills(text: string, nonce: string = randomBytes(12).toString('hex')): string {
  const safe = text.replace(/<(?=\s*\/?\s*bay-skill)/gi, '‹')
  const named: BaySkill[] = []
  for (const part of skillSegments(typedText(text))) {
    if (part.skill && !named.includes(part.skill)) named.push(part.skill)
  }
  if (named.length === 0) return safe
  const blocks = named.map((skill) => `<bay-skill name="${skill.slug}" nonce="${nonce}">\n${skill.body}\n</bay-skill>`)
  return `${blocks.join('\n\n')}\n\n${safe}`
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
    // One turn at a time: a second send abandons the first, as the CLI's does — and kills its
    // process whether or not a turn is still counted as running. Keyed on `#runId` alone, a turn
    // that had already been failed (a timeout) left its codex running, and assigning the next
    // one over `#child` dropped the only handle on it: a detached process calling bay's tools,
    // outliving quit.
    if (this.#runId || this.#child) this.stop()
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
      // After every turn, however it ended: a login Codex refreshed goes back to the user.
      this.#reconcileAuth()
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

    // Stopped means killed: failing the turn alone told the panel it had stopped while codex
    // carried on calling tools against the timeline.
    const timeout = this.#options.turnTimeoutMs ?? TURN_TIMEOUT_MS
    this.#timer = setTimeout(
      () => this.#abort(`The turn ran past ${Math.round(timeout / 60000)} minutes and was stopped.`),
      timeout
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

  #reconcileAuth(): void {
    if (!this.#options.authSource) return
    try {
      reconcileCodexAuth(this.#options.codexHome, this.#options.authSource)
    } catch (error) {
      console.warn(`[bay] could not check the Codex login link: ${(error as Error).message}`)
    }
  }

  stop(): void {
    this.#abort('Stopped.')
  }

  #abort(message: string): void {
    this.#fail(message)
    killTree(this.#child?.pid)
    this.#child = null
    this.#buffer = ''
    this.#reconcileAuth()
  }

  dispose(): void {
    this.#settle()
    this.#listeners.clear()
    killTree(this.#child?.pid)
    this.#child = null
    this.#reconcileAuth()
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
