/**
 * `media:freeze-frame`: one source frame to a PNG in `<userData>/generated`, where bay keeps what
 * it makes for a project (subtitles live there too). The choice of frame and the grab are in
 * `frame-grab.ts`, which runs without Electron and is tested against the real binaries.
 */

import type { FreezeFrameRequest } from '@shared/ipc'
import { generatedDir } from '../paths'
import { ffmpegBin, ffprobeBin } from '../ffmpeg/ffmpeg'
import { grabFrame } from './frame-grab'

export async function freezeFrame(
  request: FreezeFrameRequest
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const result = await grabFrame(
      { ffmpeg: ffmpegBin(), ffprobe: ffprobeBin() },
      String(request.path),
      Number(request.seconds),
      generatedDir(),
      String(request.name || 'clip')
    )
    return result.ok ? { ok: true, path: result.path } : result
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
