/**
 * Export settings as one value, the named presets over it, and the range an export covers.
 *
 * The export form and `export_timeline` both end in the same `ExportRequest`, so the pieces they
 * share live here: `checkExportRange` is the one validation of a frame range (the tool's
 * `fromFrame`/`toFrame` and the form's Range both go through it), and `exportRequestFields` is
 * the one mapping from settings to the request's format/quality/size/loudness.
 *
 * A preset is not stored anywhere. The form keeps only the settings; which preset is showing is
 * *derived* by comparing them (`matchExportPreset`). So editing any field reads as Custom without
 * anything having to remember to switch, and choosing values that happen to equal a preset reads
 * as that preset, which is what they are.
 */

import { LOUDNESS_PRESETS, parseLoudness, type LoudnessPreset, type LoudnessTarget } from './loudness'
import type { ExportFormat, ExportRequest } from './ipc'

export type ExportQuality = 'draft' | 'good' | 'best'

/**
 * The delivered frame size.
 *
 * - `timeline`: the canvas's own size.
 * - `height`: scaled to that height, keeping the canvas's shape (720p of a vertical canvas is
 *   720 tall, not 720 wide).
 * - `frame`: exactly this size, whatever the canvas — the platform presets, where the file's
 *   shape is the point. A canvas of another shape is fitted inside it with bars, never stretched.
 */
export type ExportSize =
  | { kind: 'timeline' }
  | { kind: 'height'; height: number }
  | { kind: 'frame'; width: number; height: number }

/** `off`, a named preset, or custom numbers. */
export type LoudnessSetting = 'off' | LoudnessPreset | LoudnessTarget

export interface ExportSettings {
  format: ExportFormat
  quality: ExportQuality
  size: ExportSize
  loudness: LoudnessSetting
}

export interface ExportPreset {
  id: string
  label: string
  /** One line under the menu: where the file is going and what it is. */
  description: string
  settings: ExportSettings
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  quality: 'good',
  size: { kind: 'timeline' },
  loudness: 'off'
}

/**
 * The destinations people export for. Platform presets master to −14 LUFS because that is what
 * those platforms normalise to; a file already there is not turned down by them. The Master
 * leaves the mix alone, because a master is what the other deliveries are made from.
 */
export const EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    id: 'youtube-1080',
    label: 'YouTube 1080p',
    description: 'MP4, 1920 × 1080, mastered to −14 LUFS.',
    settings: { format: 'mp4', quality: 'good', size: { kind: 'frame', width: 1920, height: 1080 }, loudness: 'streaming' }
  },
  {
    id: 'youtube-4k',
    label: 'YouTube 4K',
    description: 'MP4 at best quality, 3840 × 2160, mastered to −14 LUFS.',
    settings: { format: 'mp4', quality: 'best', size: { kind: 'frame', width: 3840, height: 2160 }, loudness: 'streaming' }
  },
  {
    id: 'vertical',
    label: 'Shorts, Reels, TikTok',
    description: 'Vertical MP4, 1080 × 1920, mastered to −14 LUFS.',
    settings: { format: 'mp4', quality: 'good', size: { kind: 'frame', width: 1080, height: 1920 }, loudness: 'streaming' }
  },
  {
    id: 'instagram-square',
    label: 'Instagram square',
    description: 'MP4, 1080 × 1080, mastered to −14 LUFS.',
    settings: { format: 'mp4', quality: 'good', size: { kind: 'frame', width: 1080, height: 1080 }, loudness: 'streaming' }
  },
  {
    id: 'instagram-portrait',
    label: 'Instagram 4:5',
    description: 'MP4, 1080 × 1350, mastered to −14 LUFS.',
    settings: { format: 'mp4', quality: 'good', size: { kind: 'frame', width: 1080, height: 1350 }, loudness: 'streaming' }
  },
  {
    id: 'podcast',
    label: 'Podcast (audio only)',
    description: 'MP3, mastered to −16 LUFS, the spoken-word norm.',
    settings: { format: 'mp3', quality: 'good', size: { kind: 'timeline' }, loudness: 'podcast' }
  },
  {
    id: 'master',
    label: 'Master (high quality)',
    description: 'MOV at best quality, canvas size, the mix as you hear it.',
    settings: { format: 'mov', quality: 'best', size: { kind: 'timeline' }, loudness: 'off' }
  }
]

export const AUDIO_ONLY_FORMATS: readonly ExportFormat[] = ['wav', 'mp3']

export const isAudioOnly = (format: ExportFormat): boolean => AUDIO_ONLY_FORMATS.includes(format)

function sameSize(a: ExportSize, b: ExportSize): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'height' && b.kind === 'height') return a.height === b.height
  if (a.kind === 'frame' && b.kind === 'frame') return a.width === b.width && a.height === b.height
  return true
}

function sameLoudness(a: LoudnessSetting, b: LoudnessSetting): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b
  return a.integratedLufs === b.integratedLufs && a.truePeakDb === b.truePeakDb
}

/**
 * The preset these settings are, or `'custom'`. Fields an audio-only file has no use for (size,
 * quality) are not compared for one, so the Podcast preset still reads as Podcast after the
 * size was changed while it was greyed out.
 */
export function matchExportPreset(settings: ExportSettings): string {
  for (const preset of EXPORT_PRESETS) {
    const want = preset.settings
    if (want.format !== settings.format || !sameLoudness(want.loudness, settings.loudness)) continue
    if (isAudioOnly(want.format)) return preset.id
    if (want.quality === settings.quality && sameSize(want.size, settings.size)) return preset.id
  }
  return 'custom'
}

const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2)

/**
 * Pixels for a size over a canvas. Always even: H.264's 4:2:0 chroma cannot encode an odd side.
 */
export function resolveExportSize(size: ExportSize, canvasWidth: number, canvasHeight: number): { width: number; height: number } {
  switch (size.kind) {
    case 'timeline':
      return { width: even(canvasWidth), height: even(canvasHeight) }
    case 'height': {
      const ratio = canvasHeight > 0 ? canvasWidth / canvasHeight : 16 / 9
      return { width: even(size.height * ratio), height: even(size.height) }
    }
    case 'frame':
      return { width: even(size.width), height: even(size.height) }
  }
}

/**
 * How a canvas of one shape sits in a frame of another: scaled to fit whole, centred, the rest
 * bars. Uniform on purpose — the alternative, a scale per axis, is a stretched picture, which is
 * what the exporter did before for a frame of another shape.
 */
export function fitCanvasInFrame(
  canvasWidth: number,
  canvasHeight: number,
  frameWidth: number,
  frameHeight: number
): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(frameWidth / Math.max(1, canvasWidth), frameHeight / Math.max(1, canvasHeight))
  return {
    scale,
    offsetX: (frameWidth - canvasWidth * scale) / 2,
    offsetY: (frameHeight - canvasHeight * scale) / 2
  }
}

/** Aspect ratios closer than this are the same shape: 1920×1080 against 1280×720 rounding. */
const ASPECT_TOLERANCE = 0.01

/**
 * Whether the export's frame is another shape from the canvas, and so will carry bars.
 * Null when the shapes agree (or the file has no picture). `bars` names which: `pillarbox` is
 * bars left and right (a wide frame around a taller canvas), `letterbox` above and below.
 */
export function exportAspectMismatch(
  settings: ExportSettings,
  canvasWidth: number,
  canvasHeight: number
): { frame: { width: number; height: number }; bars: 'pillarbox' | 'letterbox' } | null {
  if (isAudioOnly(settings.format) || settings.size.kind !== 'frame') return null
  const frame = resolveExportSize(settings.size, canvasWidth, canvasHeight)
  const canvasRatio = canvasWidth / Math.max(1, canvasHeight)
  const frameRatio = frame.width / frame.height
  if (Math.abs(canvasRatio - frameRatio) / frameRatio <= ASPECT_TOLERANCE) return null
  return { frame, bars: frameRatio > canvasRatio ? 'pillarbox' : 'letterbox' }
}

/**
 * A target as the form's setting: the preset's name when it is exactly a preset, else the
 * numbers — so a remembered "streaming" lights Streaming, not Custom. Null is Off.
 */
export function loudnessSetting(target: LoudnessTarget | null): LoudnessSetting {
  if (!target) return 'off'
  for (const [name, preset] of Object.entries(LOUDNESS_PRESETS) as [LoudnessPreset, LoudnessTarget][]) {
    if (preset.integratedLufs === target.integratedLufs && preset.truePeakDb === target.truePeakDb) return name
  }
  return { integratedLufs: target.integratedLufs, truePeakDb: target.truePeakDb }
}

/** A loudness setting as the request's target, or an error sentence for custom numbers. */
export function loudnessTarget(setting: LoudnessSetting): { target: LoudnessTarget | null } | { error: string } {
  if (setting === 'off') return { target: null }
  if (typeof setting === 'string') return { target: { ...LOUDNESS_PRESETS[setting] } }
  return parseLoudness(setting)
}

/**
 * The request fields the settings decide. A PNG sequence carries no audio, so no loudness;
 * an audio-only file has no picture, so the size is the canvas's (main ignores it).
 */
export function exportRequestFields(
  settings: ExportSettings,
  canvasWidth: number,
  canvasHeight: number
): Pick<ExportRequest, 'format' | 'quality' | 'width' | 'height' | 'loudness'> | { error: string } {
  const loudness = settings.format === 'png-sequence' ? { target: null } : loudnessTarget(settings.loudness)
  if ('error' in loudness) return loudness
  const size = isAudioOnly(settings.format)
    ? resolveExportSize({ kind: 'timeline' }, canvasWidth, canvasHeight)
    : resolveExportSize(settings.size, canvasWidth, canvasHeight)
  return {
    format: settings.format,
    quality: settings.quality,
    width: size.width,
    height: size.height,
    ...(loudness.target ? { loudness: loudness.target } : {})
  }
}

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

/**
 * `fromFrame`/`toFrame` as `export_timeline` takes them — both inclusive, either optional — checked
 * against the timeline, or the sentence that says why the range holds nothing. The tool and the
 * form both call this, so a range one of them accepts the other cannot refuse.
 */
export function checkExportRange(
  fromFrame: number | undefined,
  toFrame: number | undefined,
  duration: number
): { fromFrame: number; toFrame: number } | { error: string } {
  if (duration <= 0) {
    return { error: 'The timeline is empty, so an export would produce a file with no frames.' }
  }
  const from = fromFrame === undefined ? 0 : Math.max(0, Math.round(fromFrame))
  const to = toFrame === undefined ? duration - 1 : Math.max(0, Math.round(toFrame))
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { error: `The range must be whole frames; got ${fromFrame} to ${toFrame}.` }
  }
  if (to < from) return { error: `toFrame (${to}) is before fromFrame (${from}), so the range is empty.` }
  if (from >= duration) {
    return {
      error:
        `fromFrame ${from} is past the end of the timeline (${duration} frames), so the ` +
        `range holds nothing. Export from 0, or shorten fromFrame.`
    }
  }
  // A last frame past the end is clamped rather than refused: the frames that exist are exported.
  return { fromFrame: from, toFrame: Math.min(to, duration - 1) }
}

export type ExportRangeChoice =
  | { kind: 'whole' }
  | { kind: 'marks' }
  /** Start and end as the user typed them resolved to frames; `end` is exclusive, as marks are. */
  | { kind: 'custom'; start: number | null; end: number | null }

/**
 * The inclusive frames a Range choice exports, or why it cannot.
 *
 * In/out marks follow the timeline's convention: `rangeOut` is exclusive — the first frame after
 * the range, the same bound as `remove_range`'s `toFrame` — and either may be set alone (only In
 * runs to the end, only Out from the start). The request's `toFrame` is inclusive, so this is
 * where the two conventions meet.
 */
export function resolveExportRange(
  choice: ExportRangeChoice,
  duration: number,
  marks: { rangeIn: number | null; rangeOut: number | null }
): { fromFrame: number; toFrame: number } | { error: string } {
  switch (choice.kind) {
    case 'whole':
      return checkExportRange(undefined, undefined, duration)
    case 'marks': {
      if (marks.rangeIn === null && marks.rangeOut === null) {
        return { error: 'No In or Out is marked. Mark them on the timeline with I and O.' }
      }
      const start = marks.rangeIn ?? 0
      const end = marks.rangeOut ?? duration
      if (end <= start) return { error: 'Out is not after In, so the marked range is empty.' }
      return checkExportRange(start, end - 1, duration)
    }
    case 'custom': {
      if (choice.start === null || choice.end === null) {
        return { error: 'Type a start and an end, like 0:02:00 or 4.5s.' }
      }
      if (choice.end <= choice.start) return { error: 'The end must be after the start.' }
      return checkExportRange(choice.start, choice.end - 1, duration)
    }
  }
}
