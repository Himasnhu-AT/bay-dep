/**
 * The one agent conversation, owned by main.
 *
 * Main rather than the renderer because a child process outliving a window reload is a
 * stray `claude` nobody can reach, and because the socket path and the proxy bundle are
 * main's to know. The renderer gets events pushed to it and sends text back; it never learns
 * that a process exists.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { BAY_SKILLS, skillMarkdown } from '@shared/skills'
import type { AgentEvent } from '@shared/agent'
import { socketPathIn } from '../mcp/socket-path'
import { CliAgentRuntime } from './cli'
import { findClaude, notFoundMessage, searchDirs } from './locate'
import { AGENT_SYSTEM_PROMPT } from './prompt'
import { chooseRuntime, RUNTIME_ENV, type HostedAgentRuntime } from './runtime'
import { bundledExecutable, SdkAgentRuntime } from './sdk'

let runtime: HostedAgentRuntime | null = null
let offEvents: (() => void) | null = null

/**
 * Where the agent's own files go.
 *
 * Inside `userData`, never the project directory and never the user's home. Bay's tools are
 * the only ones it has, so nothing it does should touch this — but a working directory is
 * inherited by anything spawned beneath it, and pointing that at a project folder is how a
 * "safe" agent ends up one `cd ..` from everything.
 */
function workspace(): string {
  const dir = join(app.getPath('userData'), 'agent-workspace')
  // Created up front: spawning into a directory that does not exist fails with the same ENOENT
  // a missing binary gives, and two different faults wearing one error message is how an
  // afternoon disappears.
  mkdirSync(dir, { recursive: true })
  installSkills(dir)
  return dir
}

/**
 * bay's skills, as the project skills of the agent's working directory.
 *
 * The CLI runs with project settings from this directory and nothing else, so these — and only
 * these — are the skills the in-app agent has. Rewritten on every start: the directory is bay's,
 * the skills ship with the build, and a skill removed or renamed in a new build must not linger
 * from an old one.
 */
function installSkills(dir: string): void {
  const root = join(dir, '.claude', 'skills')
  rmSync(root, { recursive: true, force: true })
  for (const skill of BAY_SKILLS) {
    const folder = join(root, skill.slug)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), skillMarkdown(skill))
  }
}

function broadcast(event: AgentEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.agentEvent, event)
  }
}

export async function startAgent(): Promise<
  { ok: true; id: string } | { ok: false; error: string }
> {
  if (runtime) return { ok: true, id: runtime.id }

  // The CLI unless `BAY_AGENT_RUNTIME=sdk`. Read per start rather than at import, so a
  // disposed conversation can be restarted under the other runtime without relaunching.
  const choice = chooseRuntime(process.env[RUNTIME_ENV])
  if (!choice.ok) return { ok: false, error: choice.error }

  // The SDK runtime prefers the Claude Code binary the SDK ships, pinned to the version it
  // was built against. Only when there is none does it need the user's own.
  const bundled = choice.kind === 'sdk' ? bundledExecutable() : null

  // Resolved before spawning rather than relying on PATH. A GUI-launched app inherits
  // `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else, so `spawn('claude')` fails with ENOENT on
  // a machine where `claude` works perfectly in a terminal — and the failure names the binary,
  // which sends everyone to check whether it is installed.
  const located = bundled ? null : await findClaude()
  const executable = bundled ?? located?.path
  if (!executable) return { ok: false, error: notFoundMessage((await searchDirs()).length) }

  const base = {
    // `out/main/agent/…` at runtime, so the proxy is two levels up beside main's own bundle.
    proxyPath: join(__dirname, 'mcp', 'index.js'),
    socketPath: socketPathIn(app.getPath('userData')),
    cwd: workspace(),
    systemPrompt: AGENT_SYSTEM_PROMPT
  }

  try {
    const created: HostedAgentRuntime =
      choice.kind === 'sdk'
        ? new SdkAgentRuntime({ ...base, executable })
        : new CliAgentRuntime({ ...base, binary: executable })
    offEvents = created.onEvent(broadcast)
    runtime = created
    return { ok: true, id: created.id }
  } catch (error) {
    // Never throws across IPC: a rejected invoke surfaces in the renderer as a stack trace
    // naming an internal frame, which tells the user nothing they can act on.
    return { ok: false, error: (error as Error).message }
  }
}

export function sendToAgent(text: string): { ok: boolean; error?: string } {
  if (!runtime) return { ok: false, error: 'No agent conversation is running. Start one first.' }
  try {
    runtime.send(text)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export function stopAgent(): void {
  runtime?.stop()
}

export function disposeAgent(): void {
  offEvents?.()
  offEvents = null
  runtime?.dispose()
  runtime = null
}
