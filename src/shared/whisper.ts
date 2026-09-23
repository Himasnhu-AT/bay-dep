/**
 * The whisper.cpp models bay can download, and the shape of what Settings shows about them.
 *
 * One catalog for both processes: main needs the URLs, the renderer needs the names and sizes to
 * draw the list, and a list kept twice would offer a model the other side cannot fetch. Sizes are
 * read off Hugging Face's `x-linked-size` for each file; the download checks the real size and
 * SHA-256 against the server's headers rather than against these, so a republished file is a
 * slightly wrong progress bar, not a refused download.
 */

export interface WhisperModelSpec {
  /** Also the file stem: `ggml-<id>.bin`. */
  id: string
  label: string
  bytes: number
  /** English-only: more accurate at its size, and unusable for any other language. */
  englishOnly: boolean
  note: string
}

export const WHISPER_MODELS: readonly WhisperModelSpec[] = [
  { id: 'tiny.en', label: 'Tiny (English)', bytes: 77_704_715, englishOnly: true, note: 'Fastest, roughest' },
  { id: 'base.en', label: 'Base (English)', bytes: 147_964_211, englishOnly: true, note: 'Fast and good — the default' },
  { id: 'small.en', label: 'Small (English)', bytes: 487_614_201, englishOnly: true, note: 'Noticeably more accurate' },
  { id: 'base', label: 'Base (any language)', bytes: 147_951_465, englishOnly: false, note: 'The default for other languages' },
  { id: 'small', label: 'Small (any language)', bytes: 487_601_967, englishOnly: false, note: 'More accurate, any language' },
  { id: 'large-v3-turbo-q5_0', label: 'Large v3 Turbo, compressed', bytes: 574_041_195, englishOnly: false, note: 'Near-best accuracy at a third of the size' },
  { id: 'large-v3-turbo', label: 'Large v3 Turbo', bytes: 1_624_555_275, englishOnly: false, note: 'Best accuracy; slow on older Macs' }
]

export const whisperFileName = (id: string): string => `ggml-${id}.bin`

export const whisperModelUrl = (id: string): string =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${whisperFileName(id)}`

/** What is fetched when a transcription finds no model and downloading is allowed. */
export function defaultWhisperModel(language: string): WhisperModelSpec {
  const id = language === 'en' ? 'base.en' : 'base'
  return WHISPER_MODELS.find((model) => model.id === id)!
}

export function findWhisperModel(id: string): WhisperModelSpec | undefined {
  return WHISPER_MODELS.find((model) => model.id === id)
}

/** A model file found on this machine. */
export interface InstalledWhisperModel {
  file: string
  path: string
  bytes: number
  /** In bay's own folder — the only ones Settings can delete. Others belong to another app. */
  own: boolean
}

/**
 * One download, as the sentence Settings shows for it:
 * downloading → "Base (English) — 42 MB of 148 MB"; verifying → "Checking the download…";
 * done → "Downloaded"; failed → "Download failed: <error>"; cancelled → "Download cancelled".
 */
export interface WhisperDownload {
  modelId: string
  state: 'downloading' | 'verifying' | 'done' | 'failed' | 'cancelled'
  receivedBytes: number
  totalBytes: number
  error?: string
  /** Who started it: a click in Settings, or a transcription that found no model. */
  reason: 'user' | 'transcribe'
}

export interface WhisperStatus {
  /** `whisper-cli`, or null when whisper.cpp is not installed. */
  engine: string | null
  /** Homebrew, when present — the one way bay can install the engine for the user. */
  brew: string | null
  /** Where bay keeps the models it downloads. */
  modelDir: string
  installed: InstalledWhisperModel[]
  /** The model an English transcription would use now, by file name; null when there is none. */
  activeForEnglish: string | null
  download: WhisperDownload | null
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

/** The line the status bar shows for a download — the sentence `WhisperDownload` was written from. */
export function downloadSentence(download: WhisperDownload): string {
  const label = findWhisperModel(download.modelId)?.label ?? download.modelId
  switch (download.state) {
    case 'downloading':
      return `Downloading ${label} — ${formatBytes(download.receivedBytes)} of ${formatBytes(download.totalBytes)}`
    case 'verifying':
      return `Checking ${label}…`
    case 'done':
      return `Downloaded ${label}`
    case 'failed':
      return `Download of ${label} failed`
    case 'cancelled':
      return `Download of ${label} cancelled`
  }
}
