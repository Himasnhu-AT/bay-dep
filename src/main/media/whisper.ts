/**
 * Local transcription with whisper.cpp: find the engine and a model, run it on a media file.
 *
 * The speech never leaves the machine. The audio is extracted with bay's own ffmpeg and
 * transcribed by `whisper-cli` — installed with `brew install whisper-cpp` (Settings can run that),
 * and on Apple silicon it runs on the GPU (measured: 0.7 s for 11 s of speech with ggml-base.en).
 *
 * Models are the one thing bay fetches from the network, and only from Hugging Face's whisper.cpp
 * repository: when the user clicks Download in Settings, or when a transcription finds no model
 * and "Download models when needed" is on (the renderer decides, and says so in the request). A
 * model the user already has — bay's folder, ~/.cache, Homebrew's share dir, another app's — is
 * used instead of fetching one.
 *
 * No Electron import, so the finding and choosing logic is testable; the caller passes the
 * folders.
 */

import { access, constants, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { parseWhisperJson, type TranscriptSegment } from '@shared/transcribe'
import {
  defaultWhisperModel,
  findWhisperModel,
  whisperFileName,
  whisperModelUrl,
  type InstalledWhisperModel,
  type WhisperDownload,
  type WhisperStatus
} from '@shared/whisper'
import { searchDirs } from '../agent/locate'
import { downloadVerified } from './download'
import { ffmpegBin, run } from './ffmpeg'

/**
 * Which model to use when several are present. Balanced for editing: accurate enough for
 * captions, fast enough to wait for. The English-only variant of a size is preferred when the
 * language is English (it is more accurate at the same size), and never chosen otherwise.
 */
const SIZE_ORDER = ['small', 'base', 'medium', 'large-v3-turbo', 'large', 'tiny']

export function pickWhisperModel(paths: readonly string[], language: string, preferred?: string | null): string | null {
  const usable = paths.filter((path) => {
    const name = basename(path)
    if (!/^ggml-.+\.bin$/.test(name) || name.includes('for-tests')) return false
    // An English-only model cannot transcribe another language; auto-detect needs multilingual.
    return language === 'en' || !name.includes('.en.')
  })
  // The one chosen in Settings wins — when it is here and can do this language. A French clip
  // with an English-only model chosen falls through to the ranking rather than failing.
  const chosen = preferred ? usable.find((path) => basename(path) === preferred) : undefined
  if (chosen) return chosen
  const rank = (path: string): number => {
    const name = basename(path)
    const size = SIZE_ORDER.findIndex((s) => name.startsWith(`ggml-${s}`))
    const english = name.includes('.en.') ? 0 : 0.5
    return (size < 0 ? SIZE_ORDER.length : size) + (language === 'en' ? english : 0)
  }
  return [...usable].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

/** Where bay keeps the models it downloads — the only folder it writes to or deletes from. */
export const ownModelDir = (userDataDir: string): string => join(userDataDir, 'whisper-models')

/** Where models are looked for, bay's own folder first. */
function modelDirs(userDataDir: string, homeDir: string): string[] {
  return [
    ownModelDir(userDataDir),
    join(homeDir, '.cache', 'whisper.cpp'),
    '/opt/homebrew/share/whisper-cpp',
    '/usr/local/share/whisper-cpp'
  ]
}

async function listModels(dirs: readonly string[], homeDir: string): Promise<string[]> {
  const found: string[] = []
  const tryDir = async (dir: string): Promise<void> => {
    try {
      for (const name of await readdir(dir)) if (name.endsWith('.bin')) found.push(join(dir, name))
    } catch {
      // Absent: nothing to add.
    }
  }
  for (const dir of dirs) await tryDir(dir)
  // Other apps on this Mac that keep whisper.cpp models in Application Support — a model the user
  // already downloaded is one they need not download again.
  try {
    const support = join(homeDir, 'Library', 'Application Support')
    for (const app of await readdir(support)) await tryDir(join(support, app, 'whisper-models'))
  } catch {
    // Not macOS, or unreadable.
  }
  // bay's own folder is also under Application Support, so the sweep finds it a second time.
  return [...new Set(found)]
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface WhisperSetup {
  engine: string | null
  model: string | null
  /** What to do when either is missing, in words. Null when both were found. */
  missing: string | null
}

async function findExecutable(name: string, extraDirs: readonly string[] = []): Promise<string | null> {
  for (const dir of [...(await searchDirs()), ...extraDirs]) {
    const candidate = join(dir, name)
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

// An app launched from the Dock gets a bare PATH, so Homebrew's prefixes are named outright.
const BREW_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']

async function findWhisper(
  userDataDir: string,
  homeDir: string,
  language: string,
  preferred?: string | null
): Promise<WhisperSetup> {
  const engine = await findExecutable('whisper-cli', BREW_DIRS)
  const model = pickWhisperModel(await listModels(modelDirs(userDataDir, homeDir), homeDir), language, preferred)
  const missing = !engine
    ? 'whisper.cpp is not installed. Open Settings (⌘,) → Transcription and click Install, or run `brew install whisper-cpp`, then try again.'
    : !model
      ? `No whisper.cpp model was found${language === 'en' ? '' : ' for that language (English-only models cannot be used)'}. ` +
        'Open Settings (⌘,) → Transcription to download one, or turn on "Download models when needed" there.'
      : null
  return { engine, model, missing }
}

// -- downloads ----------------------------------------------------------------
//
// One at a time, app-wide. A second request for the model already downloading joins it — a
// transcription started while Settings is fetching the same model waits for that download rather
// than starting another — and a request for a different model is refused with what to do.

interface Running {
  modelId: string
  promise: Promise<string>
  controller: AbortController
}

let running: Running | null = null
let lastDownload: WhisperDownload | null = null
const listeners = new Set<(download: WhisperDownload) => void>()

/** Every change to the download, for main to push to the windows. Returns an unsubscribe. */
export function onWhisperDownload(listener: (download: WhisperDownload) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(download: WhisperDownload): void {
  lastDownload = download
  for (const listener of listeners) listener(download)
}

export function downloadWhisperModel(
  modelId: string,
  userDataDir: string,
  reason: WhisperDownload['reason'],
  /** The fetch-and-verify step; a test substitutes one that needs no network. */
  download: typeof downloadVerified = downloadVerified
): Promise<string> {
  const spec = findWhisperModel(modelId)
  if (!spec) return Promise.reject(new Error(`There is no whisper model called "${modelId}".`))
  if (running) {
    if (running.modelId === modelId) return running.promise
    const other = findWhisperModel(running.modelId)?.label ?? running.modelId
    return Promise.reject(new Error(`${other} is downloading. Wait for it, or cancel it in Settings (⌘,) → Transcription.`))
  }
  const dest = join(ownModelDir(userDataDir), whisperFileName(modelId))
  const controller = new AbortController()
  const base = { modelId, reason, totalBytes: spec.bytes }
  emit({ ...base, state: 'downloading', receivedBytes: 0 })
  const promise = download(whisperModelUrl(modelId), dest, {
    signal: controller.signal,
    expected: { bytes: spec.bytes, sha256: spec.sha256 },
    onProgress: (p) => emit({ ...base, state: 'downloading', receivedBytes: p.receivedBytes, totalBytes: p.totalBytes || spec.bytes }),
    onVerifying: () => emit({ ...base, state: 'verifying', receivedBytes: lastDownload?.receivedBytes ?? 0 })
  }).then(
    () => {
      emit({ ...base, state: 'done', receivedBytes: spec.bytes })
      return dest
    },
    (error: unknown) => {
      const cancelled = controller.signal.aborted
      const message = error instanceof Error ? error.message : String(error)
      emit({ ...base, state: cancelled ? 'cancelled' : 'failed', receivedBytes: lastDownload?.receivedBytes ?? 0, ...(cancelled ? {} : { error: message }) })
      throw new Error(cancelled ? `The download of ${spec.label} was cancelled.` : `Downloading ${spec.label} failed: ${message}`)
    }
  ).finally(() => {
    running = null
  })
  running = { modelId, promise, controller }
  return promise
}

export function cancelWhisperDownload(): void {
  running?.controller.abort()
}

export async function whisperStatus(userDataDir: string, homeDir: string, preferred?: string | null): Promise<WhisperStatus> {
  const ownDir = ownModelDir(userDataDir)
  const paths = await listModels(modelDirs(userDataDir, homeDir), homeDir)
  const installed: InstalledWhisperModel[] = []
  for (const path of paths) {
    if (!/^ggml-.+\.bin$/.test(basename(path)) || basename(path).includes('for-tests')) continue
    const bytes = await stat(path).then((s) => s.size, () => 0)
    installed.push({ file: basename(path), path, bytes, own: dirname(path) === ownDir })
  }
  const active = pickWhisperModel(paths, 'en', preferred)
  return {
    engine: await findExecutable('whisper-cli', BREW_DIRS),
    brew: await findExecutable('brew', BREW_DIRS),
    modelDir: ownDir,
    installed,
    activeForEnglish: active ? basename(active) : null,
    installing: whisperInstalling(),
    download: running || lastDownload?.state === 'failed' ? lastDownload : null
  }
}

/** Delete a model bay downloaded. Another app's models are not bay's to remove. */
export async function deleteWhisperModel(userDataDir: string, file: string): Promise<{ ok: boolean; error?: string }> {
  const name = basename(file)
  if (!/^ggml-.+\.bin$/.test(name)) return { ok: false, error: `"${file}" is not a whisper model file.` }
  if (running && whisperFileName(running.modelId) === name) return { ok: false, error: 'That model is still downloading; cancel it first.' }
  await rm(join(ownModelDir(userDataDir), name), { force: true })
  return { ok: true }
}

/** `brew install whisper-cpp`. Minutes on a cold Homebrew; the caller shows it as running. */
let installing: Promise<{ ok: true } | { ok: false; error: string }> | null = null

/** Whether `brew install whisper-cpp` is running, for Settings reopened while it does. */
export function whisperInstalling(): boolean {
  return installing !== null
}

/**
 * One install at a time: a second request (Settings closed and reopened, the button pressed
 * again) joins the running one rather than starting another `brew`, which would fail on
 * Homebrew's own lock with an error about a lock file.
 */
export function installWhisperEngine(): Promise<{ ok: true } | { ok: false; error: string }> {
  installing ??= runInstall().finally(() => {
    installing = null
  })
  return installing
}

async function runInstall(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await findExecutable('whisper-cli', BREW_DIRS)) return { ok: true }
  const brew = await findExecutable('brew', BREW_DIRS)
  if (!brew) {
    return { ok: false, error: 'Homebrew is not installed, so bay cannot install whisper.cpp for you. Install Homebrew from brew.sh, or build whisper.cpp yourself and put whisper-cli on your PATH.' }
  }
  try {
    await run(brew, ['install', 'whisper-cpp'], { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' } })
  } catch (error) {
    return { ok: false, error: `brew install whisper-cpp failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  return (await findExecutable('whisper-cli', BREW_DIRS))
    ? { ok: true }
    : { ok: false, error: 'Homebrew finished, but whisper-cli is still not on the PATH bay searches.' }
}

export interface Transcript {
  segments: TranscriptSegment[]
  model: string
  language: string
}

/**
 * Transcribe a media file. Rejects with a message the caller can show as is.
 *
 * `-ml 42 -sow` splits segments at word boundaries into caption-sized lines — without it whisper
 * returned one 11-second, 100-character line for an 11-second sentence.
 */
export async function transcribeFile(
  mediaPath: string,
  options: {
    userDataDir: string
    homeDir: string
    language?: string
    /** Fetch the default model when none is found (the renderer's "Download models when needed"). */
    download?: boolean
    /** The model chosen in Settings, by file name. */
    model?: string | null
  }
): Promise<Transcript> {
  // Lowercased: "EN" is English, and treating it as another language would pass over every
  // English-only model and download a multilingual one.
  const language = options.language?.trim().toLowerCase() || 'en'
  let setup = await findWhisper(options.userDataDir, options.homeDir, language, options.model)
  if (setup.engine && !setup.model && options.download) {
    await downloadWhisperModel(defaultWhisperModel(language).id, options.userDataDir, 'transcribe')
    setup = await findWhisper(options.userDataDir, options.homeDir, language, options.model)
  }
  if (setup.missing || !setup.engine || !setup.model) throw new Error(setup.missing ?? 'whisper.cpp is not set up.')

  const work = await mkdtemp(join(tmpdir(), 'bay-whisper-'))
  try {
    const wav = join(work, 'audio.wav')
    // whisper.cpp wants 16 kHz mono PCM; any other rate is refused or mis-timed.
    await run(ffmpegBin(), ['-nostdin', '-v', 'error', '-y', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav])
    const out = join(work, 'transcript')
    await run(setup.engine, ['-m', setup.model, '-f', wav, '-l', language, '-oj', '-ml', '42', '-sow', '-np', '-of', out])
    const segments = parseWhisperJson(JSON.parse(await readFile(`${out}.json`, 'utf8')))
    return { segments, model: basename(setup.model), language }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
