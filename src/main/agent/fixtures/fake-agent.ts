/**
 * Stand-ins for the `claude` and `codex` binaries, for tests of what the runtimes do to the
 * processes they start — never a model call.
 *
 * Each fake is a small Node script behind a `#!/bin/sh` wrapper that `exec`s it, so the pid the
 * runtime holds is the script's own. Each one also starts a child the way Codex 0.149.1 starts an
 * MCP server — **in a process group of its own**, so signalling the agent's group does not reach
 * it — and writes both pids to `pids-<pid>.json` in the folder named by `FAKE_PIDS_DIR` (or, for
 * the Codex fake, its `CODEX_HOME`, which the runtime sets and a test cannot).
 */

import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const START_MCP = `
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
function startMcp(dir) {
  // Detached: its own process group, as Codex starts bay's proxy. stdin ignored, so only a
  // signal can end it — which is what the test is about.
  const mcp = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' })
  writeFileSync(join(dir, 'pids-' + process.pid + '.json'), JSON.stringify({ agent: process.pid, mcp: mcp.pid }))
}
`

/** One `codex exec` turn: names a thread, and finishes the turn only if the prompt says "complete". */
const CODEX = `${START_MCP}
startMcp(process.env.CODEX_HOME)
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: '01a0d443-5982-7263-85b3-40e561fc7a0c' }) + '\\n')
let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { prompt += chunk })
process.stdin.on('end', () => {
  if (prompt.includes('complete')) {
    process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: {} }) + '\\n')
  }
  // Either way it lingers, as a process that has not yet exited does.
})
setInterval(() => {}, 1000)
`

/** A long-lived `claude --input-format stream-json` that reads messages and never answers. */
const CLAUDE = `${START_MCP}
startMcp(process.env.FAKE_PIDS_DIR)
process.stdin.resume()
setInterval(() => {}, 1000)
`

function wrap(dir: string, name: string, script: string): string {
  const source = join(dir, `${name}.cjs`)
  writeFileSync(source, script)
  const binary = join(dir, name)
  writeFileSync(binary, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(source)} "$@"\n`)
  chmodSync(binary, 0o755)
  return binary
}

export function fakeCodex(): string {
  return wrap(mkdtempSync(join(tmpdir(), 'bay-fake-codex-')), 'codex', CODEX)
}

export function fakeClaude(): string {
  return wrap(mkdtempSync(join(tmpdir(), 'bay-fake-claude-')), 'claude', CLAUDE)
}

export interface FakePids {
  agent: number
  mcp: number
}

/** Every fake started so far that wrote its pids into `dir`, in no particular order. */
export function pidsIn(dir: string): FakePids[] {
  return readdirSync(dir)
    .filter((name) => /^pids-\d+\.json$/.test(name))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(join(dir, name), 'utf8')) as FakePids
      } catch {
        return null
      }
    })
    .filter((value): value is FakePids => value !== null)
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Poll until `check` holds, or fail naming what was waited for. The default is a ceiling, not an
 * expectation: 5 s was exceeded by a fake agent's start-up while parallel builds loaded the
 * machine, and a longer wait costs nothing when the thing arrives.
 */
export async function waitFor(what: string, check: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** Kill whatever a test left running, so a failing assertion does not leak processes. */
export function reap(pids: readonly FakePids[]): void {
  for (const { agent, mcp } of pids) {
    for (const pid of [agent, mcp]) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }
}
