/**
 * The delivered file, read back and checked against what the export was for.
 *
 * Kept free of Electron (unlike `encode.ts`, which calls it) so the whole path — ffprobe on a
 * real file, then `exportFindings` — runs under `pnpm test` against the vendored binaries.
 */

import { stat } from 'node:fs/promises'
import { exportFindings, type DeliveredFile, type ExpectedExport, type Finding } from '@shared/findings'
import { probe } from '../ffmpeg/probe'

export async function measureDelivered(path: string): Promise<{ file: DeliveredFile | null; probeError?: string }> {
  let sizeBytes: number
  try {
    sizeBytes = (await stat(path)).size
  } catch {
    return { file: null }
  }
  const empty: DeliveredFile = { sizeBytes, hasVideo: false, hasAudio: false, durationUs: null }
  if (sizeBytes === 0) return { file: empty }
  try {
    const probed = await probe(path)
    return {
      file: { sizeBytes, hasVideo: probed.hasVideo, hasAudio: probed.hasAudio, durationUs: probed.durationUs > 0 ? probed.durationUs : null }
    }
  } catch (error) {
    return { file: empty, probeError: error instanceof Error ? error.message : String(error) }
  }
}

/** Reads the file at `path` back and returns what is wrong with it for `expected`. Never throws. */
export async function deliveredFindings(path: string, expected: ExpectedExport): Promise<Finding[]> {
  const { file, probeError } = await measureDelivered(path)
  return exportFindings(file, expected, probeError)
}
