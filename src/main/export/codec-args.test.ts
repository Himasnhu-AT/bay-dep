/**
 * What each export format is encoded as. Run with `pnpm test`.
 *
 * The assertions are what the formats must be for the file to play where people take it — not
 * a transcription of `codec-args.ts`. An `.mp4` has to be H.264 + AAC in 4:2:0 or QuickTime and
 * most phones refuse it; a `.webm` may only carry VP8/VP9/AV1 video and Opus/Vorbis audio, or
 * browsers reject the file; an `.mp3` is MP3. Numbers are checked by the direction they must
 * move (more quality, lower CRF), not by their current values.
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
  type ExportQuality
} from './codec-args'

/** The value following `flag`, or undefined when the flag is absent. */
function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}

const QUALITIES: ExportQuality[] = ['draft', 'good', 'best']

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
      const video = videoCodecArgs(format, quality)
      assert.equal(valueOf(video, '-c:v'), 'libx264', `${format}/${quality}`)
      // 4:4:4 from an RGBA pipe is ffmpeg's default for libx264, and QuickTime cannot play it.
      assert.equal(valueOf(video, '-pix_fmt'), 'yuv420p', `${format}/${quality}`)
    }
    assert.equal(valueOf(audioCodecArgs(format), '-c:a'), 'aac', format)
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

test('higher quality means a lower CRF, inside each encoder’s legal range', () => {
  for (const [format, max] of [['mp4', 51], ['webm', 63]] as const) {
    const crf = QUALITIES.map((q) => Number(valueOf(videoCodecArgs(format, q), '-crf')))
    for (const value of crf) {
      assert.ok(Number.isInteger(value) && value >= 0 && value <= max, `${format} CRF ${value} out of 0–${max}`)
    }
    const [draft, good, best] = crf as [number, number, number]
    assert.ok(draft > good && good > best, `${format}: draft ${draft}, good ${good}, best ${best}`)
  }
})

test('draft trades encoder effort for speed; good and best do not', () => {
  const preset = (q: ExportQuality): string | undefined => valueOf(videoCodecArgs('mp4', q), '-preset')
  const order = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']
  const rank = (q: ExportQuality): number => order.indexOf(preset(q) ?? '')
  for (const q of QUALITIES) assert.ok(rank(q) >= 0, `${q} preset ${preset(q)} is not an x264 preset`)
  assert.ok(rank('draft') < rank('good'), 'draft must be a faster preset than good')
  assert.ok(rank('best') >= rank('good'), 'best must not be a faster preset than good')
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
