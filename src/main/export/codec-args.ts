/**
 * The ffmpeg arguments each export format encodes with — pure, so they are testable.
 *
 * Split out of `encode.ts`, which imports Electron and so cannot load under `pnpm test`. These
 * decide what file the user actually receives (codec, container flags, quality), which is the
 * part of export most worth pinning and the part least visible from the renderer.
 */

import type { ExportFormat } from '@shared/ipc'

export type ExportQuality = 'draft' | 'good' | 'best'

const VP9_CRF: Record<ExportQuality, number> = { draft: 38, good: 32, best: 26 }

/**
 * H.264 is Apple's VideoToolbox encoder. It used to be libx264 at CRF 28/20/16, but x264 is GPL
 * and the ffmpeg bay ships is LGPL (vendor/ffmpeg/README.md), so there is no x264 to call.
 *
 * On Apple silicon VideoToolbox has a constant-quality mode (`-q:v`, 1–100, higher is better).
 * These values were chosen by measurement, not by feel: five 6-second clips (bay's own 1080×1920
 * export, a grain-heavy 4K texture at 1080p, 360p camera footage, `testsrc2` graphics, a 768×1344
 * generated shot) fed exactly as an export feeds them — RGBA on stdin, then these args — and each
 * value is the lowest whose SSIM *and* PSNR against the source are at least libx264's at the old
 * CRF on every clip (the grain clip set draft; the generated shot set good and best, by 0.0002
 * SSIM). VMAF agreed at every level. VideoToolbox spends more bits for it: +7–57% at good.
 * The encoder quantises the scale — 53 and 54 produce identical files, as do 72/73 and 79/80.
 * The table, and the script that measures it again: vendor/ffmpeg/README.md.
 */
export const H264_QUALITY: Record<ExportQuality, number> = { draft: 53, good: 72, best: 79 }

/**
 * An Intel Mac has no constant-quality mode: ffmpeg refuses `-q:v` for VideoToolbox on anything
 * but arm64 ("qscale not available for encoder"), so the x64 build asks for a bitrate, in bits per
 * pixel per frame. A bitrate cannot follow the content the way a quality target does — these are
 * the lowest that meet the old CRF on four of the five clips; the grain clip falls short at every
 * level (it needs 0.7+) and flat graphics get more than they need. Measured through the x64
 * binary on Apple silicon's encoder (under Rosetta); an Intel Mac's encoder was not available.
 */
export const H264_BITS_PER_PIXEL: Record<ExportQuality, number> = { draft: 0.1, good: 0.3, best: 0.45 }

export type H264RateControl = 'quality' | 'bitrate'

/** Which mode this process's ffmpeg can drive VideoToolbox in: the binary is built for our arch. */
export const H264_RATE_CONTROL: H264RateControl = process.arch === 'arm64' ? 'quality' : 'bitrate'

/** A keyframe at least every 250 frames, as x264 did. VideoToolbox's own default was every 12
 *  frames, which cost 3–20% more bits at the same measured quality. */
const H264_GOP = '250'

export interface FrameShape {
  width: number
  height: number
  fps: number
}

const HD: FrameShape = { width: 1920, height: 1080, fps: 30 }

function h264Args(quality: ExportQuality, frame: FrameShape, rateControl: H264RateControl): string[] {
  if (rateControl === 'quality') return ['-c:v', 'h264_videotoolbox', '-q:v', String(H264_QUALITY[quality]), '-g', H264_GOP]
  const kbps = Math.ceil((H264_BITS_PER_PIXEL[quality] * frame.width * frame.height * frame.fps) / 1000)
  return ['-c:v', 'h264_videotoolbox', '-b:v', `${kbps}k`, '-g', H264_GOP]
}

/**
 * The frames arrive as sRGB RGBA, and 4:2:0 needs a matrix to get there. Left to itself, swscale
 * converts with BT.601 and writes no tags — and every player decodes an untagged HD file as
 * BT.709, so the picture came back darker and shifted: Gym Buddy green #30d158 (48, 209, 88)
 * decoded as (33, 183, 83). Convert with BT.709 in limited range and say so in the stream, so
 * the file carries the colours the canvas drew.
 *
 * `setparams` tags the frames themselves. Since ffmpeg 7 an encoder takes its colour description
 * from the frames it is given, and the `-color_primaries`/`-color_trc` flags below no longer
 * reach the stream on their own: with ffmpeg 8.1 both H.264 (VideoToolbox) and VP9 files came out
 * with primaries and transfer "unknown" and only the matrix set. colour.test.ts reads all four.
 */
const BT709 = [
  '-vf',
  'scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
  '-pix_fmt',
  'yuv420p',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
  '-color_range',
  'tv'
]

/**
 * `frame` sizes the bitrate on an Intel Mac (see `H264_BITS_PER_PIXEL`) and is unused on Apple
 * silicon; `rateControl` is a parameter so the tests reach both modes on either machine.
 */
export function videoCodecArgs(
  format: ExportFormat,
  quality: ExportQuality,
  frame: FrameShape = HD,
  rateControl: H264RateControl = H264_RATE_CONTROL
): string[] {
  switch (format) {
    case 'webm':
      return ['-c:v', 'libvpx-vp9', '-crf', String(VP9_CRF[quality]), '-b:v', '0', '-row-mt', '1', ...BT709]
    case 'png-sequence':
      return ['-c:v', 'png']
    default:
      return [...h264Args(quality, frame, rateControl), ...BT709]
  }
}

export function containerArgs(format: ExportFormat): string[] {
  // faststart moves the index to the front so the file starts playing before it is fully
  // downloaded — the difference between a shareable file and one that only works locally.
  return format === 'mp4' || format === 'mov' ? ['-movflags', '+faststart'] : []
}

/**
 * The AAC encoder: AudioToolbox's on macOS, where the bundled ffmpeg has it; ffmpeg's own elsewhere.
 *
 * ffmpeg's native `aac` at 192k overshoots limited, transient material by an amount that depends
 * on where each hit falls against its 1024-sample frames — measured on a real mix limited to
 * −1.5 dBFS: +4.3, +0.9, −0.3, +2.0, +0.2, +3.9 dBTP for the same audio shifted by 0–512
 * samples, and still +0.4 with the limiter lowered to −5. The mastering loop lowers the ceiling
 * to correct an overshoot, which cannot converge against one that does not fall with it, so a
 * `loudness: "streaming"` export shipped at +2.6 dBTP. `aac_at` on the same audio holds −1.0 to
 * −0.1 at every shift, and its overshoot falls as the ceiling does. 256k because that is what a
 * delivery spec asks for and what leaves the codec least to smear.
 */
export const AAC_ENCODER = process.platform === 'darwin' ? 'aac_at' : 'aac'

export function audioCodecArgs(format: ExportFormat): string[] {
  switch (format) {
    case 'webm':
      return ['-c:a', 'libopus', '-b:a', '128k']
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-q:a', '2']
    default:
      return ['-c:a', AAC_ENCODER, '-b:a', '256k']
  }
}

export function extensionFor(format: ExportFormat): string {
  switch (format) {
    case 'png-sequence':
      return ''
    default:
      return format
  }
}

/** The end of ffmpeg's stderr, bounded, for an error message. The last lines name the fault. */
export function tailOf(text: string): string {
  const trimmed = text.trimEnd()
  return trimmed.length > 4096 ? trimmed.slice(-4096) : trimmed
}
