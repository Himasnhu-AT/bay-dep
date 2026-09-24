/**
 * The whisper.cpp models bay can download, and the shape of what Settings shows about them.
 *
 * One catalog for both processes: main needs the URLs, the renderer needs the names and sizes to
 * draw the list, and a list kept twice would offer a model the other side cannot fetch. Sizes and
 * hashes are pinned: a download must match both exactly, so a republished (or tampered) file is
 * refused rather than handed to whisper's native parser. Updating a model means updating its
 * row here.
 */

export interface WhisperModelSpec {
  /** Also the file stem: `ggml-<id>.bin`. */
  id: string
  /**
   * The file's SHA-256, pinned here. Checked against the download instead of trusting the
   * server's own header, which would only prove the bytes match what that server claims.
   * Read from Hugging Face's `x-linked-etag`, and for tiny.en and base.en confirmed against
   * `shasum -a 256` of real downloads.
   */
  sha256: string
  label: string
  bytes: number
  /** English-only: more accurate at its size, and unusable for any other language. */
  englishOnly: boolean
  note: string
}

export const WHISPER_MODELS: readonly WhisperModelSpec[] = [
  { id: 'tiny.en', sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f', label: 'Tiny (English)', bytes: 77_704_715, englishOnly: true, note: 'Fastest, roughest' },
  { id: 'base.en', sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', label: 'Base (English)', bytes: 147_964_211, englishOnly: true, note: 'Fast and good — the default' },
  { id: 'small.en', sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d', label: 'Small (English)', bytes: 487_614_201, englishOnly: true, note: 'Noticeably more accurate' },
  { id: 'base', sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', label: 'Base (any language)', bytes: 147_951_465, englishOnly: false, note: 'The default for other languages' },
  { id: 'small', sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', label: 'Small (any language)', bytes: 487_601_967, englishOnly: false, note: 'More accurate, any language' },
  { id: 'large-v3-turbo-q5_0', sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', label: 'Large v3 Turbo, compressed', bytes: 574_041_195, englishOnly: false, note: 'Near-best accuracy at a third of the size' },
  { id: 'large-v3-turbo', sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69', label: 'Large v3 Turbo', bytes: 1_624_555_275, englishOnly: false, note: 'Best accuracy; slow on older Macs' }
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
  /** `brew install whisper-cpp` is running (started from Settings, possibly before a reopen). */
  installing: boolean
  download: WhisperDownload | null
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

/**
 * The error a download the user cancelled ends with. Main throws it; a panel that asked for the
 * download (or for a transcription that started one) reads it with `isCancelledDownloadError` to
 * say "Download cancelled" plainly rather than as a failure — a cancel the user asked for is not
 * an error. One sentence, built in one place, so the two cannot drift.
 */
export function cancelledDownloadError(label: string): string {
  return `The download of ${label} was cancelled.`
}

/** Whether `message` (possibly wrapped by the transcription that started it) is a cancelled download. */
export function isCancelledDownloadError(message: string): boolean {
  return /The download of .+ was cancelled\./.test(message)
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
