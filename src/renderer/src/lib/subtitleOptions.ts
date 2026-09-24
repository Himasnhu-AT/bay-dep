/**
 * The Subtitles section's choices, turned into `add_subtitles` arguments — pure, so the rule
 * "send only what the user changed" is tested rather than trusted.
 *
 * Only changed options are sent because the tool's defaults are the design's own: a style's
 * accent and bottom offset differ per design, so a panel that always sent the values it showed
 * would pin the first design's accent onto the next one the user picked.
 */

import type { SubtitleStyle } from '@shared/subtitles'

/** The languages offered, as whisper's codes. `auto` lets whisper detect it (multilingual only). */
export const SUBTITLE_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'auto', label: 'Detect automatically' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' }
]

export interface SubtitleChoices {
  itemId: string
  style: SubtitleStyle
  language: string
  /** Null: the design's own. */
  accent: string | null
  /** 1 is the design's own size. */
  scale: number
  /** Null: the design's own offset. */
  bottom: number | null
}

export function subtitleArgs(choices: SubtitleChoices): Record<string, unknown> {
  const args: Record<string, unknown> = { itemId: choices.itemId, style: choices.style.id }
  if (choices.language !== 'en') args['language'] = choices.language
  if (choices.accent !== null && choices.accent.toUpperCase() !== choices.style.accent.toUpperCase()) {
    args['accent'] = choices.accent
  }
  if (choices.scale !== 1) args['scale'] = choices.scale
  if (choices.bottom !== null && choices.bottom !== choices.style.bottom) args['bottom'] = choices.bottom
  return args
}

/**
 * Whether a model on this Mac can transcribe `language` — the same test main's `pickWhisperModel`
 * applies: an English-only file (`ggml-base.en.bin`) is usable for English and nothing else.
 * False means the transcription will need a multilingual model downloaded (or will fail).
 */
export function hasModelFor(files: readonly string[], language: string): boolean {
  return files.some((file) => /^ggml-.+\.bin$/.test(file) && (language === 'en' || !file.includes('.en.')))
}
