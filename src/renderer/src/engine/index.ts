/**
 * The engine's public surface. Nothing in `engine/` imports React or the store — the clock,
 * the compositor and the audio graph take their inputs as arguments, which is what makes them
 * testable without a window. The one place they meet the store is `@/lib/useEngine`.
 */

export { MediaPool, assetUrl, isDrawable, DEFAULT_MAX_VIDEO_ELEMENTS } from './mediaPool'
export type { MediaEntry, MediaReadiness, MediaStatus } from './mediaPool'
export { PlaybackClock } from './clock'
export type { ClockStats, ClockOptions, FrameListener } from './clock'
export { Compositor } from './compositor'
export type { DrawOptions, DrawStats, RenderTarget } from './compositor'
export { AudioEngine } from './audio'
export type { AudioUpdate, TrackLevel } from './audio'
export { FrameExporter, ExportCancelled } from './exporter'
export {
  renderFrame,
  awaitSources,
  previewSize,
  DEFAULT_PREVIEW_MAX_EDGE,
  DEFAULT_SOURCE_TIMEOUT_MS
} from './render'
export type { RenderFrameOptions, RenderedFrame } from './render'
export {
  layoutText,
  wrapLines,
  anchorFor,
  fontIsAvailable,
  FONT_PROBE_STRING,
  MIN_FONT_SIZE
} from './text'
export type { TextFit, LaidOutText, TextBox } from './text'
export type { ExporterOptions, ExportOutcome, ExportProgressReport } from './exporter'
export {
  DRIFT_TOLERANCE_SECONDS,
  clamp,
  clamp01,
  finite,
  sourceSecondsAt
} from './sync'
