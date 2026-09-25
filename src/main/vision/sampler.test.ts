/**
 * Frame sampling against bay's own ffmpeg (skipped loudly without it): which frames are kept, at
 * what times, and that the bytes are the picture in RGB order.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { FRAME_BYTES, keptKeyframes, keyframeTimesUs, parseKeyframes, sampleArgs, sampleFrames, showinfoTimeUs, type SampledFrame } from './sampler'

const TOOLS = vendoredTools()
const SKIP = TOOLS ? false : NO_VENDORED_FFMPEG

test('ffprobe packet lines → keyframe times', () => {
  assert.deepEqual(parseKeyframes('0.000000,K__\n0.033333,___\n2.000000,K__\n\n4.5,K_D\nN/A,K__\n'), [0, 2_000_000, 4_500_000])
})

test('a keyframes-only pass keeps the same "one interval after the last" frames as the filter', () => {
  assert.deepEqual(keptKeyframes([0, 1_000_000, 2_000_000, 3_000_000, 4_500_000]), [0, 2_000_000, 4_500_000])
})

test('showinfo lines give the source time; other lines give nothing', () => {
  const line = '[Parsed_showinfo_1 @ 0x600003d6c000] n:   3 pts:  90000 pts_time:6       duration:   3000 duration_time:0.0333333 fmt:yuv420p'
  assert.equal(showinfoTimeUs(line), 6_000_000)
  assert.equal(showinfoTimeUs('[Parsed_showinfo_1 @ 0x1] n: 0 pts: 1 pts_time:0.0333333 duration:1'), 33_333)
  assert.equal(showinfoTimeUs('Stream #0:0: Video: h264, pts_time:4'), null)
  assert.equal(showinfoTimeUs('[Parsed_showinfo_1 @ 0x1] config in time_base: 1/30'), null)
})

test('the keyframes-only switch is the only difference between the two passes', () => {
  const full = sampleArgs('/x.mov', false)
  const keys = sampleArgs('/x.mov', true)
  assert.ok(!full.includes('-skip_frame'))
  assert.deepEqual(keys.slice(keys.indexOf('-skip_frame'), keys.indexOf('-skip_frame') + 2), ['-skip_frame', 'nokey'])
  assert.deepEqual(keys.filter((a) => a !== '-skip_frame' && a !== 'nokey'), full)
})

/** A 9 s clip whose picture is red for 4 s then blue, with a keyframe every `gop` frames at 10 fps. */
function makeClip(dir: string, name: string, gop: number): string {
  const path = join(dir, name)
  execFileSync(TOOLS!.ffmpeg, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=10:d=4',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10:d=5',
    '-filter_complex', '[0][1]concat=n=2:v=1:a=0',
    '-c:v', 'mpeg4', '-q:v', '2', '-g', String(gop), path
  ])
  return path
}

async function collect(path: string, kind: 'video' | 'image', durationUs: number): Promise<SampledFrame[]> {
  const frames: SampledFrame[] = []
  for await (const frame of sampleFrames(path, { ffmpeg: TOOLS!.ffmpeg, ffprobe: TOOLS!.ffprobe, kind, durationUs })) frames.push(frame)
  return frames
}

const rgbAt = (frame: SampledFrame): [number, number, number] => {
  const i = (112 * 224 + 112) * 3
  return [frame.rgb[i]!, frame.rgb[i + 1]!, frame.rgb[i + 2]!]
}

test('a short-GOP clip is sampled from keyframes, every two seconds, with the right pictures', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-sampler-'))
  const path = makeClip(dir, 'short-gop.mp4', 20)
  const keys = await keyframeTimesUs(TOOLS!.ffprobe, path)
  assert.ok(keys.length >= 4, `keyframes every 2 s: ${keys.join(', ')}`)
  const frames = await collect(path, 'video', 9_000_000)
  assert.deepEqual(frames.map((f) => f.us), [0, 2_000_000, 4_000_000, 6_000_000, 8_000_000])
  assert.ok(frames.every((f) => f.rgb.length === FRAME_BYTES))
  // Red, then blue — in RGB order. A BGR mix-up or a wrong time would swap these.
  const [r0, g0, b0] = rgbAt(frames[0]!)
  assert.ok(r0 > 200 && g0 < 60 && b0 < 60, `frame at 0 s is red: ${r0},${g0},${b0}`)
  const [r3, , b3] = rgbAt(frames[3]!)
  assert.ok(b3 > 200 && r3 < 60, `frame at 6 s is blue: ${rgbAt(frames[3]!)}`)
})

test('when keyframes suffice, the frames are the keyframes — the cheap pass really ran', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-sampler-'))
  // A keyframe every 1.5 s: close enough to use, and off the 2 s grid, so the two passes differ.
  const path = makeClip(dir, 'gop-15.mp4', 15)
  const expected = keptKeyframes(await keyframeTimesUs(TOOLS!.ffprobe, path))
  assert.notDeepEqual(expected, [0, 2_000_000, 4_000_000, 6_000_000, 8_000_000], 'the specimen must tell the passes apart')
  const frames = await collect(path, 'video', 9_000_000)
  assert.deepEqual(frames.map((f) => f.us), expected)
})

test('a long-GOP clip is decoded in full, so it is still sampled every two seconds', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-sampler-'))
  const path = makeClip(dir, 'long-gop.mp4', 1000)
  // The specimen really is long-GOP: keyframes only at the start and where the colour changes (the
  // encoder forces one there), so keyframes alone would leave the last 5 s unsampled.
  const keys = await keyframeTimesUs(TOOLS!.ffprobe, path)
  assert.ok(keys.length <= 2 && 9_000_000 - keys[keys.length - 1]! > 4_000_000, `keyframes: ${keys.join(', ')}`)
  const frames = await collect(path, 'video', 9_000_000)
  assert.deepEqual(frames.map((f) => f.us), [0, 2_000_000, 4_000_000, 6_000_000, 8_000_000])
})

test('an image is one frame at 0; a file with no picture is refused in words', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-sampler-'))
  const png = join(dir, 'still.png')
  execFileSync(TOOLS!.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=64x48', '-frames:v', '1', png])
  const frames = await collect(png, 'image', 0)
  assert.equal(frames.length, 1)
  assert.equal(frames[0]!.us, 0)
  const wav = join(dir, 'tone.wav')
  execFileSync(TOOLS!.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=d=1', wav])
  await assert.rejects(collect(wav, 'video', 1_000_000), /could not read|no picture/)
})

test('an aborted pass stops without an error', { skip: SKIP, timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-sampler-'))
  const path = makeClip(dir, 'abort.mp4', 20)
  const controller = new AbortController()
  const frames: SampledFrame[] = []
  for await (const frame of sampleFrames(path, { ffmpeg: TOOLS!.ffmpeg, ffprobe: TOOLS!.ffprobe, kind: 'video', durationUs: 9_000_000, signal: controller.signal })) {
    frames.push(frame)
    controller.abort()
  }
  assert.ok(frames.length >= 1 && frames.length < 5, `stopped early: ${frames.length}`)
})
