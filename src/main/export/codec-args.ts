/**
 * The ffmpeg arguments each export format encodes with — pure, so they are testable.
 *
 * Split out of `encode.ts`, which imports Electron and so cannot load under `pnpm test`. These
 * decide what file the user actually receives (codec, container flags, quality), which is the
 * part of export most worth pinning and the part least visible from the renderer.
 */

import type { ExportFormat } from '@shared/ipc'

export type ExportQuality = 'draft' | 'good' | 'best'

const CRF: Record<ExportQuality, { h264: number; vp9: number }> = {
  draft: { h264: 28, vp9: 38 },
  good: { h264: 20, vp9: 32 },
  best: { h264: 16, vp9: 26 }
}

export function videoCodecArgs(format: ExportFormat, quality: ExportQuality): string[] {
  const crf = CRF[quality]
  switch (format) {
    case 'webm':
      return ['-c:v', 'libvpx-vp9', '-crf', String(crf.vp9), '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p']
    case 'png-sequence':
      return ['-c:v', 'png']
    default:
      return [
        '-c:v',
        'libx264',
        '-preset',
        quality === 'draft' ? 'veryfast' : 'medium',
        '-crf',
        String(crf.h264),
        '-pix_fmt',
        'yuv420p'
      ]
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
