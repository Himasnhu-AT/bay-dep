/**
 * Finding ffmpeg and ffprobe, and running them.
 *
 * Resolution is lazy and never throws. A machine with no usable binaries must still get a
 * running app with a clear message rather than a launch failure — every media feature is
 * allowed to degrade, none of them is allowed to take the window down with it.
 */

import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { SpawnOptionsWithoutStdio } from 'node:child_process'

export interface MediaTools {
  ready: boolean
  ffmpeg: string | null
  ffprobe: string | null
}

/**
 * Thrown when a media operation needs a binary that was never found. Carries a message the
 * renderer can show verbatim; callers should not try to interpret it.
 */
export class MediaToolsMissingError extends Error {
  constructor(tool: 'ffmpeg' | 'ffprobe') {
    super(
      `${tool} was not found. bay looks for its bundled copy first, then for ${tool} on your PATH. ` +
        'Install ffmpeg (or launch bay from a shell where it is on PATH) to enable media features.'
    )
    this.name = 'MediaToolsMissingError'
  }
}

/** An ffmpeg/ffprobe run that exited non-zero, with the tail of stderr attached. */
export class MediaToolError extends Error {
  // Declared and assigned rather than written as constructor parameter properties: those are
  // not erasable syntax, and this tree is typechecked with `erasableSyntaxOnly` so that Node
  // can strip types natively for `pnpm test` without a compile step.
  readonly tool: string
  readonly code: number | null
  readonly stderrTail: string

  constructor(tool: string, code: number | null, stderrTail: string) {
    super(`${tool} exited with ${code ?? 'no code'}: ${stderrTail || '(no stderr)'}`)
    this.name = 'MediaToolError'
    this.tool = tool
    this.code = code
    this.stderrTail = stderrTail
  }
}

function executable(path: string | null | undefined): string | null {
  if (!path) return null
  try {
    accessSync(path, constants.X_OK)
    return path
  } catch {
    return null
  }
}

/**
 * Inside a packaged app the static binaries live in the asar archive, which cannot be
 * spawned — the OS needs a real file. electron-builder's `asarUnpack` writes them beside it
 * in `app.asar.unpacked`, and the path has to be rewritten to match or every spawn fails in
 * production while working perfectly in development.
 */
function unAsar(path: string | null): string | null {
  if (!path) return null
  return path.includes('app.asar') ? path.replace('app.asar', 'app.asar.unpacked') : path
}

function staticPaths(): { ffmpeg: string | null; ffprobe: string | null } {
  try {
    const require_ = createRequire(import.meta.url)
    const mod = require_('ffmpeg-ffprobe-static') as {
      ffmpegPath?: string | null
      ffprobePath?: string | null
    }
    return { ffmpeg: unAsar(mod.ffmpegPath ?? null), ffprobe: unAsar(mod.ffprobePath ?? null) }
  } catch {
    // The package is optional in practice: a source checkout whose postinstall was skipped
    // still has to launch.
    return { ffmpeg: null, ffprobe: null }
  }
}

/**
 * An app launched from Finder inherits a minimal PATH that contains neither Homebrew prefix,
 * so PATH alone would report "no ffmpeg" on a machine that plainly has one. Those two
 * directories are checked explicitly for that reason.
 */
const EXTRA_SEARCH_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

function onPath(name: string): string | null {
  const fromEnv = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const suffix = process.platform === 'win32' ? '.exe' : ''
  for (const dir of [...fromEnv, ...EXTRA_SEARCH_DIRS]) {
    const candidate = executable(join(dir, name + suffix))
    if (candidate) return candidate
  }
  return null
}

let resolved: MediaTools | null = null

function resolveTools(): MediaTools {
  if (resolved) return resolved
  const bundled = staticPaths()
  const ffmpeg = executable(bundled.ffmpeg) ?? onPath('ffmpeg')
  const ffprobe = executable(bundled.ffprobe) ?? onPath('ffprobe')
  resolved = { ready: ffmpeg !== null && ffprobe !== null, ffmpeg, ffprobe }
  return resolved
}

export function mediaToolsReady(): MediaTools {
  return resolveTools()
}

export function ffmpegBin(): string {
  const tools = resolveTools()
  if (!tools.ffmpeg) throw new MediaToolsMissingError('ffmpeg')
  return tools.ffmpeg
}

export function ffprobeBin(): string {
  const tools = resolveTools()
  if (!tools.ffprobe) throw new MediaToolsMissingError('ffprobe')
  return tools.ffprobe
}

/** Keeps the last few KB of stderr; an ffmpeg failure is always explained in its final lines. */
const STDERR_TAIL_BYTES = 4096

function tail(text: string): string {
  const trimmed = text.trimEnd()
  return trimmed.length > STDERR_TAIL_BYTES ? trimmed.slice(-STDERR_TAIL_BYTES) : trimmed
}

export interface RunResult {
  stdout: string
  stderr: string
}

/** Runs a tool to completion, capturing stdout as text. Rejects with stderr's tail. */
export function run(
  bin: string,
  args: readonly string[],
  options?: SpawnOptionsWithoutStdio
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > STDERR_TAIL_BYTES * 4) stderr = stderr.slice(-STDERR_TAIL_BYTES * 2)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new MediaToolError(bin, code, tail(stderr)))
    })
  })
}

/** Same as `run`, but stdout is binary and comes back as one Buffer. */
export function runBinary(bin: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > STDERR_TAIL_BYTES * 4) stderr = stderr.slice(-STDERR_TAIL_BYTES * 2)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new MediaToolError(bin, code, tail(stderr)))
    })
  })
}
