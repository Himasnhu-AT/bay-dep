/**
 * What each export format is encoded as. Run with `pnpm test`.
 *
 * The assertions are what the formats must be for the file to play where people take it — not
 * a transcription of `codec-args.ts`. An `.mp4` has to be H.264 + AAC in 4:2:0 or QuickTime and
 * most phones refuse it; a `.webm` may only carry VP8/VP9/AV1 video and Opus/Vorbis audio, or
 * browsers reject the file; an `.mp3` is MP3. Numbers are checked by the direction they must
 * move as quality rises, not by their current values. H.264 is checked in both of the rate
 * controls VideoToolbox is driven in (quality on Apple silicon, bitrate on Intel) on any machine.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExportFormat } from '@shared/ipc'
import { findTool } from '@shared/mcp'
import {
  audioCodecArgs,
  containerArgs,
  extensionFor,
  tailOf,
  videoCodecArgs,
  type ExportQuality,
  type H264RateControl
} from './codec-args'

/** The value following `flag`, or undefined when the flag is absent. */
function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}

const QUALITIES: ExportQuality[] = ['draft', 'good', 'best']
const MODES: H264RateControl[] = ['quality', 'bitrate']
const HD = { width: 1920, height: 1080, fps: 30 }

/** The formats an agent can ask for, read from the tool's schema rather than listed here. */
function agentFormats(): ExportFormat[] {
  const spec = findTool('export_timeline')
  assert.ok(spec, 'export_timeline must be in the catalog')
  const format = (spec.inputSchema.properties as Record<string, { enum?: string[] }>)['format']
  assert.ok(format?.enum && format.enum.length > 0, 'export_timeline.format must be an enum')
  return format.enum as ExportFormat[]
}

test('every format an agent can request has an audio codec, and the video ones a video codec', () => {
  const formats = agentFormats()
  // The five this suite was written against. If the enum grows, this fails and names the new
  // one, so its codec gets asserted below rather than silently falling to the H.264 default.
  assert.deepEqual([...formats].sort(), ['mov', 'mp3', 'mp4', 'wav', 'webm'])
  for (const format of formats) {
    assert.ok(valueOf(audioCodecArgs(format), '-c:a'), `${format} has no audio codec`)
    if (format === 'wav' || format === 'mp3') continue
    for (const quality of QUALITIES) {
      assert.ok(valueOf(videoCodecArgs(format, quality), '-c:v'), `${format}/${quality} has no video codec`)
    }
  }
})

test('mp4 and mov are H.264 + AAC in 4:2:0, with the index moved to the front', () => {
  for (const format of ['mp4', 'mov'] as const) {
    for (const quality of QUALITIES) {
      for (const mode of MODES) {
        const video = videoCodecArgs(format, quality, HD, mode)
        // H.264, and never x264: bay's ffmpeg is LGPL and has none (capabilities.test.ts asks it).
        assert.equal(valueOf(video, '-c:v'), 'h264_videotoolbox', `${format}/${quality}/${mode}`)
        // An RGBA pipe would otherwise go to 4:4:4, which QuickTime cannot play.
        assert.equal(valueOf(video, '-pix_fmt'), 'yuv420p', `${format}/${quality}/${mode}`)
      }
    }
    assert.match(valueOf(audioCodecArgs(format), '-c:a') ?? '', /^aac(_at)?$/, format)
    assert.match(valueOf(containerArgs(format), '-movflags') ?? '', /faststart/, format)
  }
})

test('webm is VP9 (or VP8) + Opus (or Vorbis), in constant-quality mode, with no mov flags', () => {
  for (const quality of QUALITIES) {
    const video = videoCodecArgs('webm', quality)
    assert.match(valueOf(video, '-c:v') ?? '', /^libvpx(-vp9)?$/, quality)
    assert.equal(valueOf(video, '-pix_fmt'), 'yuv420p', quality)
    // libvpx treats -crf as a ceiling under its default target bitrate; only -b:v 0 makes it
    // constant quality, which is what the quality setting promises.
    assert.equal(valueOf(video, '-b:v'), '0', quality)
  }
  assert.match(valueOf(audioCodecArgs('webm'), '-c:a') ?? '', /^lib(opus|vorbis)$/)
  assert.deepEqual(containerArgs('webm'), [], 'movflags belongs to the mov/mp4 muxer only')
})

test('wav is PCM and mp3 is MP3, and neither gets container flags meant for mp4', () => {
  assert.match(valueOf(audioCodecArgs('wav'), '-c:a') ?? '', /^pcm_/)
  assert.equal(valueOf(audioCodecArgs('mp3'), '-c:a'), 'libmp3lame')
  assert.deepEqual(containerArgs('wav'), [])
  assert.deepEqual(containerArgs('mp3'), [])
})

test('a PNG sequence is encoded as PNG frames', () => {
  assert.equal(valueOf(videoCodecArgs('png-sequence', 'good'), '-c:v'), 'png')
})

test('higher quality asks more of each encoder, inside its legal range', () => {
  const vp9 = QUALITIES.map((q) => Number(valueOf(videoCodecArgs('webm', q), '-crf')))
  for (const value of vp9) assert.ok(Number.isInteger(value) && value >= 0 && value <= 63, `VP9 CRF ${value} out of 0–63`)
  assert.ok(vp9[0]! > vp9[1]! && vp9[1]! > vp9[2]!, `VP9 CRF must fall as quality rises: ${vp9.join(', ')}`)

  // VideoToolbox's quality scale runs the other way: 1–100, higher is better.
  const q = QUALITIES.map((quality) => Number(valueOf(videoCodecArgs('mp4', quality, HD, 'quality'), '-q:v')))
  for (const value of q) assert.ok(Number.isInteger(value) && value >= 1 && value <= 100, `-q:v ${value} out of 1–100`)
  assert.ok(q[0]! < q[1]! && q[1]! < q[2]!, `-q:v must rise with quality: ${q.join(', ')}`)

  const kbps = QUALITIES.map((quality) => parseInt(valueOf(videoCodecArgs('mp4', quality, HD, 'bitrate'), '-b:v') ?? '', 10))
  assert.ok(kbps[0]! < kbps[1]! && kbps[1]! < kbps[2]!, `-b:v must rise with quality: ${kbps.join(', ')}`)
})

test('on an Intel Mac the H.264 bitrate follows the picture, and -q:v is never sent', () => {
  // ffmpeg refuses -q:v for VideoToolbox on x86_64 ("qscale not available for encoder"), so a
  // quality flag there is a failed export, not a worse one.
  for (const quality of QUALITIES) {
    const hd = videoCodecArgs('mp4', quality, HD, 'bitrate')
    assert.equal(valueOf(hd, '-q:v'), undefined, quality)
    const uhd60 = videoCodecArgs('mp4', quality, { width: 3840, height: 2160, fps: 60 }, 'bitrate')
    const ratio = parseInt(valueOf(uhd60, '-b:v') ?? '', 10) / parseInt(valueOf(hd, '-b:v') ?? '', 10)
    assert.ok(Math.abs(ratio - 8) < 0.01, `4K60 has 8× the pixels per second of 1080p30; its bitrate is ${ratio.toFixed(3)}×`)
  }
  // And this machine's default is the mode its own ffmpeg accepts.
  const native = videoCodecArgs('mp4', 'good')
  if (process.arch === 'arm64') assert.ok(valueOf(native, '-q:v'), 'Apple silicon uses the constant-quality mode')
  else assert.equal(valueOf(native, '-q:v'), undefined, 'an Intel build must not send -q:v')
})

test('H.264 has a keyframe at least every 250 frames, so a long export still seeks', () => {
  for (const mode of MODES) {
    for (const quality of QUALITIES) {
      const gop = Number(valueOf(videoCodecArgs('mp4', quality, HD, mode), '-g'))
      assert.ok(gop > 0 && gop <= 250, `${mode}/${quality}: -g ${gop}`)
    }
  }
})

test('a file format’s extension is its own name; a PNG sequence is a folder with none', () => {
  for (const format of agentFormats()) assert.equal(extensionFor(format), format)
  assert.equal(extensionFor('png-sequence'), '')
})

test('tailOf keeps the end of stderr, where ffmpeg names the fault, and bounds it', () => {
  const noise = 'frame=  1 fps=0.0\n'.repeat(1000)
  const tail = tailOf(`${noise}Error: Invalid argument\n\n  `)
  assert.ok(tail.endsWith('Error: Invalid argument'), 'the last line survives, trailing space trimmed')
  assert.ok(tail.length <= 4096, `bounded, got ${tail.length}`)
  // Positive control: short text comes back whole.
  assert.equal(tailOf('short\n'), 'short')
})
