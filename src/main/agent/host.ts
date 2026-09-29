/**
 * The one agent conversation, owned by main.
 *
 * Main rather than the renderer because a child process outliving a window reload is a
 * stray `claude` nobody can reach, and because the socket path and the proxy bundle are
 * main's to know. The renderer gets events pushed to it and sends text back; it never learns
 * that a process exists.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc'
import {
  DEFAULT_AGENT_TUNING,
  parseAgentTuning,
  type AgentEntry,
  type AgentEvent,
  type AgentProvider,
  type AgentProviderStatus,
  type AgentTuning
} from '@shared/agent'
import { claudeProjectFolder, transcriptFolderName, transcriptMarkdown } from '@shared/transcript'
import { AGENT_SOCKET_NAME, socketPathIn } from '../mcp/socket-path'
import { CliAgentRuntime } from './cli'
import { CodexAgentRuntime, codexConfig, findCodexSession, migrateCodexHome, prepareCodexHome, userCodexHome } from './codex'
import { codexNotFoundMessage, findClaude, findCodex, notFoundMessage } from './locate'
import { searchDirs } from '../search-dirs'
import { agentSystemPrompt } from './prompt'
import { providerOf, RUNTIME_ENV, runtimeFor, type HostedAgentRuntime, type RuntimeKind } from './runtime'
import { track } from '../telemetry/service'
import { bundledExecutable, SdkAgentRuntime } from './sdk'
import { installSkills } from './skills'
import { ATTACHMENTS_FOLDER, prepareAttachments, sweepAttachments, withAttachmentNotes } from './attachments'
import { MessageDelivery } from './deliver'
import { ffmpegBin, ffprobeBin } from '../ffmpeg/ffmpeg'
import { isAllowed } from '../protocol'

let runtime: HostedAgentRuntime | null = null
/** Which provider `runtime` is — so a start asking for the other one replaces it. */
let runtimeProvider: AgentProvider = 'claude'
let offEvents: (() => void) | null = null
/**
 * The last conversation's session id and provider, kept past `dispose` so its transcript can
 * still be exported — the provider says where its session file lives.
 */
let lastSessionId: string | null = null
let lastProvider: AgentProvider = 'claude'
/**
 * Preferences › Agent's effort, model and longest turn, as the renderer last sent them. Kept past
 * `dispose` so the next conversation starts with them; parsed on arrival, never trusted.
 */
let tuning: AgentTuning = DEFAULT_AGENT_TUNING

/**
 * Where the agent's own files go.
 *
 * Inside `userData`, never the project directory and never the user's home. Bay's tools are
 * the only ones it has, so nothing it does should touch this — but a working directory is
 * inherited by anything spawned beneath it, and pointing that at a project folder is how a
 * "safe" agent ends up one `cd ..` from everything.
 */
function workspacePath(): string {
  return join(app.getPath('userData'), 'agent-workspace')
}

/**
 * The Codex runtime's own `CODEX_HOME` — bay's config, a link to the login, and Codex's sessions.
 *
 * Hidden (`.agent-codex`), so the in-app agent's path checks (`mcp/policy.ts`) refuse it like any
 * hidden folder: it is under home, and a visible name let a tool call write a composition or an
 * export into the agent's own config. The folder it used to be is moved here once per launch.
 */
let codexHomeMigrated = false
function codexHomePath(): string {
  const home = join(app.getPath('userData'), '.agent-codex')
  if (!codexHomeMigrated) {
    codexHomeMigrated = true
    try {
      migrateCodexHome(join(app.getPath('userData'), 'agent-codex'), home, userCodexHome())
    } catch (error) {
      console.warn(`[bay] could not move the old Codex agent folder: ${(error as Error).message}`)
    }
  }
  return home
}

function workspace(): string {
  const dir = workspacePath()
  // Created up front: spawning into a directory that does not exist fails with the same ENOENT
  // a missing binary gives, and two different faults wearing one error message is how an
  // afternoon disappears.
  mkdirSync(dir, { recursive: true })
  installSkills(dir)
  return dir
}

function broadcast(event: AgentEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.agentEvent, event)
  }
}

/** Which providers' CLIs this machine has, for Preferences › Agent. Never throws. */
export async function agentProviders(): Promise<AgentProviderStatus[]> {
  const searched = (await searchDirs()).length
  const [claude, codex] = await Promise.all([findClaude(), findCodex()])
  const codexLogin = join(userCodexHome(), 'auth.json')
  return [
    { provider: 'claude', path: claude?.path ?? null, problem: claude ? null : notFoundMessage(searched) },
    {
      provider: 'codex',
      path: codex?.path ?? null,
      problem: !codex
        ? codexNotFoundMessage(searched)
        : existsSync(codexLogin)
          ? null
          : `Codex is installed but not signed in (no ${codexLogin}). Run \`codex login\` in a terminal once.`
    }
  ]
}

export async function startAgent(
  options: { provider?: AgentProvider; tuning?: AgentTuning } = {}
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (options.tuning !== undefined) tuning = parseAgentTuning(options.tuning)
  // The Settings choice unless `BAY_AGENT_RUNTIME` overrides it. Read per start rather than at
  // import, so a disposed conversation can be restarted under another runtime without relaunching.
  const choice = runtimeFor(process.env[RUNTIME_ENV], options.provider)
  if (!choice.ok) return { ok: false, error: choice.error }
  const provider = providerOf(choice.kind)

  if (runtime && runtimeProvider === provider) {
    runtime.configure(tuning)
    return { ok: true, id: runtime.id }
  }
  // A start for the other provider replaces the conversation rather than quietly answering with
  // the one already running — the user picked a different model and would be talking to the old.
  if (runtime) disposeAgent()

  const base = {
    // `out/main/agent/…` at runtime, so the proxy is two levels up beside main's own bundle.
    proxyPath: join(__dirname, 'mcp', 'index.js'),
    // The agent's own socket, under the in-app file policy (`mcp/policy.ts`).
    socketPath: socketPathIn(app.getPath('userData'), AGENT_SOCKET_NAME),
    cwd: workspace(),
    systemPrompt: agentSystemPrompt(provider),
    tuning
  }

  let created: HostedAgentRuntime
  try {
    if (choice.kind === 'codex') {
      const located = await findCodex()
      if (!located) return { ok: false, error: codexNotFoundMessage((await searchDirs()).length) }
      const codexHome = codexHomePath()
      const prepared = prepareCodexHome(codexHome, codexConfig(base), userCodexHome())
      if (!prepared.ok) return prepared
      created = new CodexAgentRuntime({ ...base, binary: located.path, codexHome, authSource: userCodexHome() })
    } else {
      // The SDK runtime prefers the Claude Code binary the SDK ships, pinned to the version it
      // was built against. Only when there is none does it need the user's own.
      const bundled = choice.kind === 'sdk' ? bundledExecutable() : null

      // Resolved before spawning rather than relying on PATH. A GUI-launched app inherits
      // `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else, so `spawn('claude')` fails with ENOENT
      // on a machine where `claude` works perfectly in a terminal — and the failure names the
      // binary, which sends everyone to check whether it is installed.
      const located = bundled ? null : await findClaude()
      const executable = bundled ?? located?.path
      if (!executable) return { ok: false, error: notFoundMessage((await searchDirs()).length) }
      created =
        choice.kind === 'sdk'
          ? new SdkAgentRuntime({ ...base, executable })
          : new CliAgentRuntime({ ...base, binary: executable })
    }
  } catch (error) {
    // Never throws across IPC: a rejected invoke surfaces in the renderer as a stack trace
    // naming an internal frame, which tells the user nothing they can act on.
    return { ok: false, error: (error as Error).message }
  }
  const counter = turnCounter(choice.kind)
  offEvents = created.onEvent((event) => {
    counter(event)
    broadcast(event)
  })
  runtime = created
  runtimeProvider = provider
  return { ok: true, id: created.id }
}

/**
 * `agent_turn` for each turn that ends: which runtime, how many tool calls, whether it completed.
 * Counts only — never the message, the tools' arguments or what they returned.
 */
function turnCounter(kind: RuntimeKind): (event: AgentEvent) => void {
  const calls = new Map<string, number>()
  return (event) => {
    if (event.type === 'started') calls.set(event.runId, 0)
    else if (event.type === 'tool') calls.set(event.runId, (calls.get(event.runId) ?? 0) + 1)
    else if (event.type === 'done') {
      track('agent_turn', { runtime: kind, toolCalls: calls.get(event.runId) ?? 0, ok: event.reason === 'complete' })
      calls.delete(event.runId)
    }
  }
}

/** `<userData>/agent-attachments` — bay's own folder, the only place attached files are read from. */
function attachmentsRoot(): string {
  return join(app.getPath('userData'), ATTACHMENTS_FOLDER)
}

/** At startup: attachments left by a conversation that never reached `dispose` (a crash, a kill). */
export function sweepAgentAttachments(): void {
  sweepAttachments(attachmentsRoot())
}

/**
 * One user message, with what they attached. `attachments` arrive from the renderer unchecked —
 * validated here (count, size, type), written into bay's own folder, and only those files handed
 * to the runtime. A message whose attachments cannot all be prepared is not sent at all.
 */
const delivery = new MessageDelivery({
  runtime: () => runtime,
  prepare: async (inputs, signal) => {
    let tools: { ffmpeg: string; ffprobe: string }
    try {
      tools = { ffmpeg: ffmpegBin(), ffprobe: ffprobeBin() }
    } catch (error) {
      return { ok: false, error: `Attachments need ffmpeg, which bay could not find: ${(error as Error).message}` }
    }
    return prepareAttachments(inputs, { root: attachmentsRoot(), tools, isAllowed, signal })
  },
  compose: withAttachmentNotes
})

export async function sendToAgent(text: string, attachments?: unknown): Promise<{ ok: boolean; error?: string }> {
  return delivery.send(text, attachments)
}

/** Preferences › Agent changed: the running conversation takes it from its next turn. */
export function configureAgent(value: unknown): void {
  tuning = parseAgentTuning(value)
  runtime?.configure(tuning)
}

export function stopAgent(): void {
  // A message still being prepared is part of the turn the user stopped.
  delivery.cancel()
  runtime?.stop()
}

export function disposeAgent(): void {
  delivery.cancel()
  if (runtime?.sessionId) {
    lastSessionId = runtime.sessionId
    lastProvider = runtimeProvider
  }
  offEvents?.()
  offEvents = null
  runtime?.dispose()
  runtime = null
  // What the user attached belongs to the conversation, and goes with it.
  sweepAttachments(attachmentsRoot())
}

/**
 * Where the provider wrote this conversation's own session file, or null before one exists.
 * Found by id, never by "newest in the folder": with a stopped turn or two sessions in a day, the
 * newest is not necessarily this one.
 */
function sessionFileFor(provider: AgentProvider, sessionId: string | null): { path: string | null; lookedIn: string } {
  if (provider === 'codex') {
    const sessions = join(codexHomePath(), 'sessions')
    return { path: sessionId ? findCodexSession(sessions, sessionId) : null, lookedIn: sessions }
  }
  const file = sessionId
    ? join(homedir(), '.claude', 'projects', claudeProjectFolder(workspacePath()), `${sessionId}.jsonl`)
    : null
  return { path: file && existsSync(file) ? file : null, lookedIn: file ?? join(homedir(), '.claude', 'projects') }
}

/**
 * Debug mode's "Export transcript": the conversation as the user saw it (markdown and the panel's
 * JSON) and as the model saw it (the provider's own session file — Claude Code's session jsonl or
 * Codex's rollout jsonl), in a new folder in Downloads, revealed in Finder. See
 * `@shared/transcript` for why both.
 *
 * When the session file cannot be found, the panel JSON says where it looked rather than the
 * folder silently lacking it.
 */
export async function exportTranscript(
  projectName: string,
  log: AgentEntry[]
): Promise<{ ok: true; folder: string } | { ok: false; error: string }> {
  try {
    const now = new Date()
    const folder = join(app.getPath('downloads'), transcriptFolderName(projectName, now))
    mkdirSync(folder, { recursive: true })
    const live = runtime?.sessionId ?? null
    const sessionId = live ?? lastSessionId
    const provider = live ? runtimeProvider : lastProvider
    const session = sessionFileFor(provider, sessionId)
    const copiedAs = provider === 'codex' ? 'codex-session.jsonl' : 'claude-session.jsonl'
    if (session.path) copyFileSync(session.path, join(folder, copiedAs))
    writeFileSync(join(folder, 'transcript.md'), transcriptMarkdown(projectName, log, now.toISOString()))
    writeFileSync(
      join(folder, 'panel.json'),
      JSON.stringify(
        {
          project: projectName,
          exportedAt: now.toISOString(),
          provider,
          sessionId,
          [provider === 'codex' ? 'codexSession' : 'claudeSession']: session.path
            ? copiedAs
            : `not found${sessionId ? ` in ${session.lookedIn}` : ' — no conversation has started'}`,
          log
        },
        null,
        2
      )
    )
    shell.showItemInFolder(join(folder, 'transcript.md'))
    return { ok: true, folder }
  } catch (error) {
    return { ok: false, error: `The transcript could not be written: ${(error as Error).message}` }
  }
}
