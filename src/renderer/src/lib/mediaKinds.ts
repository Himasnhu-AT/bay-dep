import type { Asset, AssetKind } from '@shared/project'

/**
 * Which asset kinds ffmpeg can take a picture of. Posters and filmstrips are made by ffmpeg in
 * main, and it was asked for every asset with a path — so every HTML composition tile (and the
 * subtitles, which are compositions) logged "Error occurred in handler for 'media:thumbnail'…
 * Invalid data found when processing input", one per tile per launch, and filmstrips failed the
 * same way through ffprobe. A `Record` over every kind rather than a deny list: a kind added
 * later fails typecheck here until someone decides, instead of silently shelling out to ffmpeg.
 */
const POSTER: Record<AssetKind, boolean> = {
  video: true,
  image: true,
  gif: true,
  audio: false,
  text: false,
  html: false,
  brf: false,
  lut: false,
  font: false
}

const FILMSTRIP: Record<AssetKind, boolean> = {
  video: true,
  gif: true,
  image: false,
  audio: false,
  text: false,
  html: false,
  brf: false,
  lut: false,
  font: false
}

/** A poster can be made: a file ffmpeg reads, that probed without error. */
export function canMakePoster(asset: Asset): boolean {
  return Boolean(asset.path) && !asset.error && POSTER[asset.kind]
}

/** A filmstrip can be made: moving pictures ffmpeg reads, that probed without error. */
export function canMakeFilmstrip(asset: Asset): boolean {
  return Boolean(asset.path) && !asset.error && asset.hasVideo && FILMSTRIP[asset.kind]
}

/**
 * The pictures a timeline clip draws behind its name. Moving pictures get their filmstrip; a
 * still gets its poster once, repeated along the lane, because the filmstrip of an image is that
 * one picture. Clips used to draw only filmstrips, and `FILMSTRIP` refuses images, so every image
 * clip was a dark lane (a freeze frame, a photo) while its media tile showed a poster.
 */
export function laneFrames(asset: Asset, strip: readonly string[], poster: string | null): string[] {
  if (canMakeFilmstrip(asset)) return [...strip]
  if (canMakePoster(asset) && poster) return [poster]
  return []
}

/** Whether a clip asks for the asset's poster to draw on its lane (see `laneFrames`). */
export function wantsLanePoster(asset: Asset): boolean {
  return canMakePoster(asset) && !canMakeFilmstrip(asset)
}

/**
 * Which of `count` strip frames shows source time `sourceUs`. The frames are spread evenly over
 * the whole source. A source with no duration (a still) has one picture, the first; the clip
 * used to draw nothing at all for it.
 */
export function stripFrameIndex(count: number, sourceUs: number, durationUs: number): number {
  if (count <= 0) return -1
  if (!(durationUs > 0)) return 0
  const ratio = Math.min(0.999, Math.max(0, sourceUs / durationUs))
  return Math.min(count - 1, Math.floor(ratio * count))
}
