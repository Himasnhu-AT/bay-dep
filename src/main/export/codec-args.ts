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

export function audioCodecArgs(format: ExportFormat): string[] {
  switch (format) {
    case 'webm':
      return ['-c:a', 'libopus', '-b:a', '128k']
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-q:a', '2']
    default:
      return ['-c:a', 'aac', '-b:a', '192k']
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
