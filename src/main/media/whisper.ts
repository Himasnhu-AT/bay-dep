/**
 * Local transcription with whisper.cpp: find the engine and a model, run it on a media file.
 *
 * Everything stays on the machine. The audio is extracted with bay's own ffmpeg and transcribed
 * by `whisper-cli` — installed with `brew install whisper-cpp`, and on Apple silicon it runs on
 * the GPU (measured: 0.7 s for 11 s of speech with ggml-base.en). bay does not download a model:
 * it looks for one the user has, in bay's own folder first, and when there is none it says which
 * file to put where. Fetching weights silently would be the network access this app promises not
 * to make.
 *
 * No Electron import, so the finding and choosing logic is testable; the caller passes the
 * folders.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { access, constants } from 'node:fs/promises'
import { parseWhisperJson, type TranscriptSegment } from '@shared/transcribe'
import { searchDirs } from '../agent/locate'
import { ffmpegBin, run } from './ffmpeg'

/**
 * Which model to use when several are present. Balanced for editing: accurate enough for
 * captions, fast enough to wait for. The English-only variant of a size is preferred when the
 * language is English (it is more accurate at the same size), and never chosen otherwise.
 */
const SIZE_ORDER = ['small', 'base', 'medium', 'large-v3-turbo', 'large', 'tiny']

export function pickWhisperModel(paths: readonly string[], language: string): string | null {
  const usable = paths.filter((path) => {
    const name = basename(path)
    if (!/^ggml-.+\.bin$/.test(name) || name.includes('for-tests')) return false
    // An English-only model cannot transcribe another language; auto-detect needs multilingual.
    return language === 'en' || !name.includes('.en.')
  })
  const rank = (path: string): number => {
    const name = basename(path)
    const size = SIZE_ORDER.findIndex((s) => name.startsWith(`ggml-${s}`))
    const english = name.includes('.en.') ? 0 : 0.5
    return (size < 0 ? SIZE_ORDER.length : size) + (language === 'en' ? english : 0)
  }
  return [...usable].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

/** Where models are looked for, bay's own folder first. */
export function modelDirs(userDataDir: string, homeDir: string): string[] {
  return [
    join(userDataDir, 'whisper-models'),
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
  return found
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

export async function findWhisper(userDataDir: string, homeDir: string, language: string): Promise<WhisperSetup> {
  let engine: string | null = null
  for (const dir of await searchDirs()) {
    const candidate = join(dir, 'whisper-cli')
    if (await isExecutable(candidate)) {
      engine = candidate
      break
    }
  }
  const model = pickWhisperModel(await listModels(modelDirs(userDataDir, homeDir), homeDir), language)
  const ownDir = modelDirs(userDataDir, homeDir)[0]!
  const missing = !engine
    ? 'whisper.cpp is not installed. Install it with `brew install whisper-cpp`, then try again.'
    : !model
      ? `No whisper.cpp model was found${language === 'en' ? '' : ' for that language (English-only models cannot be used)'}. ` +
        `Put one in ${ownDir} — for example: mkdir -p "${ownDir}" && curl -L -o "${ownDir}/ggml-base${language === 'en' ? '.en' : ''}.bin" ` +
        `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base${language === 'en' ? '.en' : ''}.bin`
      : null
  return { engine, model, missing }
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
  options: { userDataDir: string; homeDir: string; language?: string }
): Promise<Transcript> {
  const language = options.language?.trim() || 'en'
  const setup = await findWhisper(options.userDataDir, options.homeDir, language)
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
