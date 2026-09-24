// The ffmpeg and ffprobe the probes measure with: bay's own build (script/build-ffmpeg.sh), the
// same binaries the app spawns — or FFMPEG/FFPROBE from the environment. Refuses to guess: a probe
// that silently fell back to Homebrew's ffmpeg would measure with a build that lacks zscale.
import { accessSync, constants } from 'node:fs'

const dir = new URL(`../../vendor/ffmpeg/${process.platform}-${process.arch}/`, import.meta.url).pathname

function tool(name, override) {
  const path = override ?? `${dir}${name}`
  try {
    accessSync(path, constants.X_OK)
  } catch {
    console.error(`CANNOT MEASURE: no ${name} at ${path} — run script/build-ffmpeg.sh (or set ${name.toUpperCase()})`)
    process.exit(2)
  }
  return path
}

export const FFMPEG = tool('ffmpeg', process.env.FFMPEG)
export const FFPROBE = tool('ffprobe', process.env.FFPROBE)

/**
 * H.264 for a specimen clip, now that the build has no libx264: Apple's encoder at a quality high
 * enough that the specimen is not what a probe ends up measuring.
 */
export const H264 = ['-c:v', 'h264_videotoolbox', '-q:v', '90']
