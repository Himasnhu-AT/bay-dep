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
