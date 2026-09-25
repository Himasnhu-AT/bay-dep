/**
 * The ffmpeg bay ships can do everything bay's code asks of it — asked of the code, not of a list.
 *
 * The vendored build is configured component by component (script/build-ffmpeg.sh), with GPL and
 * network parts left out, so "that encoder/filter exists" is no longer a given the way it was with
 * a kitchen-sink download. A missing one must fail here, by name, rather than as a failed export
 * on a user's machine — and it must be the code's own argument builders that decide what is
 * required: every codec `videoCodecArgs`/`audioCodecArgs` choose for every format and quality, and
 * every filter in the graphs `buildAudioGraph`, `masterFilter` and the BT.709 conversion write.
 * Rename or add a filter in any of those and this asks the binary for the new one.
 *
 * Then it runs them: each export format is really encoded (a few frames, audio and video through
 * the same args), because an encoder that is listed can still refuse its options.
 *
 * Proven: with `h264Args` switched back to `libx264`, the encoder test names `encoder libx264` and
 * the encode test fails with "Encoder not found"; with `vidstabtransform` added to `masterFilter`
 * (GPL, not in the build), the encoder test names `filter vidstabtransform`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExportFormat } from '@shared/ipc'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import {
  audioCodecArgs,
  containerArgs,
  extensionFor,
  H264_RATE_CONTROL,
  videoCodecArgs,
  type ExportQuality,
  type H264RateControl
} from '../export/codec-args'
import { buildAudioGraph } from '../export/audio-graph'
import { masterFilter } from '../export/master'
import { colourFilter } from '../media/frame-grab'
import { sceneCutFilter } from '../media/scene-cuts'
import { contactSheetArgs, contactSheetPlan, imageScaleFilter } from '../agent/attachments'
import { sampleFilter } from '@shared/visual-search'
import { NO_VENDORED_FFMPEG, vendoredTools } from './vendor'

const TOOLS = vendoredTools()
const FFMPEG = TOOLS?.ffmpeg ?? ''
const FFPROBE = TOOLS?.ffprobe ?? ''
const SKIP = TOOLS ? false : NO_VENDORED_FFMPEG

const FORMATS: ExportFormat[] = ['mp4', 'mov', 'webm', 'wav', 'mp3', 'png-sequence']
const QUALITIES: ExportQuality[] = ['draft', 'good', 'best']
const MODES: H264RateControl[] = ['quality', 'bitrate']
const HD = { width: 1920, height: 1080, fps: 30 }

/** The names of the filters in a filtergraph string: split on `,`/`;` outside quotes, labels off. */
function filterNames(graph: string): string[] {
  const names: string[] = []
  let quoted = false
  let segment = ''
  const flush = (): void => {
    const name = segment.replace(/^(\s*\[[^\]]*\])+/, '').trim().split('=')[0]?.replace(/\[.*$/, '').trim()
    if (name) names.push(name)
    segment = ''
  }
  for (const ch of graph) {
    if (ch === "'") quoted = !quoted
    if (!quoted && (ch === ',' || ch === ';')) flush()
    else segment += ch
  }
  flush()
  return names
}

test('filterNames reads names through quotes, labels and expressions', () => {
  // The specimen defeats a naive split on ',': the quoted expression holds commas of its own.
  const graph = "[0:a]aformat=sample_fmts=fltp,volume='if(lt(t,1),0,1)':eval=frame[a0];[a0][a1]amix=inputs=2[m];[m]apad[out]"
  assert.ok(graph.split(',').length > 4, 'the specimen must contain commas inside a quoted expression')
  assert.deepEqual(filterNames(graph), ['aformat', 'volume', 'amix', 'apad'])
})

function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}

function listed(kind: 'encoders' | 'decoders' | 'filters' | 'muxers' | 'demuxers'): Set<string> {
  const text = execFileSync(FFMPEG, ['-hide_banner', `-${kind}`], { encoding: 'utf8' })
  const names = new Set<string>()
  const formats = kind === 'muxers' || kind === 'demuxers'
  for (const line of text.split('\n')) {
    // `-encoders`: " V....D libx264 …", `-filters`: " TSC zscale V->V …" — flags, then the name.
    // `-demuxers` is fixed-width flag columns, " D   mov,mp4,…" or " D d lavfi" (a device), so
    // the name starts at column 6 whatever the flags hold.
    const word = formats ? line.slice(5).trim().split(/\s+/)[0] : line.trim().split(/\s+/)[1]
    if (word) for (const name of word.split(',')) names.add(name)
  }
  assert.ok(names.size > 20, `ffmpeg -${kind} must list something (${names.size})`)
  return names
}

function clip(id: string, from: number, duration: number, extra: Partial<Item> = {}): Item {
  return {
    id,
    assetId: 'tone',
    trackId: 't',
    from,
    durationInFrames: duration,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...extra
  }
}

/** Every filter bay's export writes: two audio graphs (one clip, and a faded, sped-up pair), mastering, BT.709. */
function filtersTheCodeWrites(): Set<string> {
  const tone: Asset = {
    id: 'tone', kind: 'audio', name: 'tone', path: '/tmp/tone.wav', durationUs: 10_000_000, width: 0, height: 0,
    fps: null, hasAudio: true, hasVideo: false, posterPath: null, waveformPath: null, createdAt: 0
  }
  const timeline = (items: Item[]): Timeline => ({
    id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000000', transitions: [],
    tracks: [{ id: 't', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items }]
  })
  const graphs: string[] = []
  for (const items of [
    [clip('a', 0, 60)],
    [clip('a', 0, 60, { fadeInFrames: 10 }), clip('b', 90, 60, { speed: 2, volume: 0.5, pan: -0.5 })]
  ]) {
    const t = timeline(items)
    const project: Project = { id: 'p', name: 'p', version: 1, assets: [tone], timelines: [t], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }
    const graph = buildAudioGraph(project, t, 0, 150)
    assert.ok(graph, 'an audible timeline must build a graph')
    graphs.push(graph.filter)
  }
  graphs.push(masterFilter({ gainDb: -3, limiterCeilingDb: -1 }))
  // detect_cuts (media/scene-cuts.ts): scale, scdet, metadata.
  graphs.push(sceneCutFilter(10))
  // Agent attachments (agent/attachments.ts): a video's contact sheet and an image's downscale.
  const sheet = contactSheetArgs('/in.mov', contactSheetPlan(10, 1920, 1080), '/out.jpg')
  graphs.push(valueOf(sheet, '-filter_complex') ?? '', imageScaleFilter(2000, 1000))
  // Visual search's index pass (shared/visual-search.ts `sampleFilter`): select, showinfo, scale, format.
  graphs.push(sampleFilter())
  for (const format of FORMATS) {
    for (const quality of QUALITIES) {
      const vf = valueOf(videoCodecArgs(format, quality), '-vf')
      if (vf) graphs.push(vf)
    }
  }
  const names = new Set(graphs.flatMap(filterNames))
  // Graphs written inline where this suite cannot reach them without Electron: the loudness meter
  // (master.ts `measureLoudness`), the thumbnail/filmstrip scaler (media/thumbnails.ts), and the
  // freeze-frame grab's colour step (media/frame-grab.ts `colourFilter`).
  for (const inline of ['ebur128', 'fps', ...filterNames(colourFilter(null))]) names.add(inline)
  return names
}

test('every encoder and filter bay asks for is in the ffmpeg it ships', { skip: SKIP }, () => {
  const encoders = listed('encoders')
  const filters = listed('filters')
  const codecs = new Set<string>()
  for (const format of FORMATS) {
    const audio = valueOf(audioCodecArgs(format), '-c:a')
    if (audio) codecs.add(audio)
    for (const quality of QUALITIES) {
      for (const mode of MODES) {
        const video = valueOf(videoCodecArgs(format, quality, HD, mode), '-c:v')
        if (video) codecs.add(video)
      }
    }
  }
  codecs.add('mjpeg') // thumbnails are .jpg
  codecs.add('png') // freeze frames are .png
  codecs.add('pcm_s16le') // the export's audio pass writes a WAV before the mux
  const wanted = filtersTheCodeWrites()
  // Every name here comes from a parsed graph, none from the inline list: proof the parse ran.
  assert.ok(
    ['amix', 'alimiter', 'setparams', 'atempo', 'aformat', 'pan', 'tile', 'trim'].every((f) => wanted.has(f)),
    `the graphs must parse: ${[...wanted].join(' ')}`
  )
  const missing = [
    ...[...codecs].filter((c) => !encoders.has(c)).map((c) => `encoder ${c}`),
    ...[...wanted].filter((f) => !filters.has(f)).map((f) => `filter ${f}`)
  ]
  assert.deepEqual(missing, [], `the vendored ffmpeg lacks what the code uses — rebuild with it (script/build-ffmpeg.sh)`)
})

test('it reads what people import, and holds the tools the agent is being given', { skip: SKIP }, () => {
  const decoders = listed('decoders')
  const encoders = listed('encoders')
  const filters = listed('filters')
  const demuxers = listed('demuxers')
  // Import: the camera, phone, screen-recording and web formats bay's media kinds accept.
  const read = ['h264', 'hevc', 'prores', 'vp8', 'vp9', 'libdav1d', 'mjpeg', 'png', 'webp', 'gif', 'aac', 'mp3', 'opus', 'vorbis', 'flac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le']
  const containers = ['mov', 'matroska', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'image2']
  // The agent's cleanup and analysis tools (denoise, silence and scene detection, stabilise,
  // HEVC/ProRes delivery). Stabilisation is `deshake`: vid.stab is GPL and cannot ship.
  const tools = ['afftdn', 'arnndn', 'silencedetect', 'scdet', 'deshake', 'lut3d', 'haldclut', 'loudnorm', 'sidechaincompress']
  const delivery = ['h264_videotoolbox', 'hevc_videotoolbox', 'prores_videotoolbox', 'prores_ks']
  const missing = [
    ...read.filter((d) => !decoders.has(d)).map((d) => `decoder ${d}`),
    ...containers.filter((d) => !demuxers.has(d)).map((d) => `demuxer ${d}`),
    ...tools.filter((f) => !filters.has(f)).map((f) => `filter ${f}`),
    ...delivery.filter((e) => !encoders.has(e)).map((e) => `encoder ${e}`)
  ]
  assert.deepEqual(missing, [])
})

test('it is LGPL 2.1: nothing GPL or non-free is compiled in', { skip: SKIP }, () => {
  const licence = execFileSync(FFMPEG, ['-hide_banner', '-L'], { encoding: 'utf8' })
  assert.match(licence, /GNU Lesser General Public\s+License/)
  assert.match(licence, /version 2\.1/)
  assert.doesNotMatch(licence, /GNU General Public\s+License/)
  const conf = execFileSync(FFMPEG, ['-hide_banner', '-buildconf'], { encoding: 'utf8' })
  assert.doesNotMatch(conf, /--enable-(gpl|nonfree|version3|libx264|libx265|libvidstab)\b/)
  // The positive half: the GPL-only encoder and filter are absent, their LGPL stand-ins present.
  const encoders = listed('encoders')
  const filters = listed('filters')
  assert.ok(!encoders.has('libx264') && encoders.has('h264_videotoolbox'), 'H.264 is VideoToolbox, not x264')
  assert.ok(!filters.has('vidstabdetect') && filters.has('deshake'), 'stabilisation is deshake, not vid.stab')
})

// On this machine's own rate control only: -q:v is refused by an x86_64 ffmpeg and -b:v is the
// only mode it has, so each machine encodes the mode it would really export with (codec-args.test
// holds the other mode's arguments on either machine).
test('every export format actually encodes, audio and video, through its own args', { skip: SKIP, timeout: 60_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bay-capabilities-'))
  const cases: { format: ExportFormat; mode: H264RateControl }[] = FORMATS.map((format) => ({ format, mode: H264_RATE_CONTROL }))
  // The bitrate mode also runs on Apple silicon: VideoToolbox accepts -b:v on every Mac.
  if (H264_RATE_CONTROL === 'quality') cases.push({ format: 'mp4', mode: 'bitrate' })
  for (const { format, mode } of cases) {
    const out = format === 'png-sequence' ? join(dir, 'seq-%04d.png') : join(dir, `probe-${mode}.${extensionFor(format)}`)
    const audioOnly = format === 'wav' || format === 'mp3'
    const args = [
      '-v', 'error', '-y',
      ...(audioOnly ? [] : ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=0.5']),
      ...(format === 'png-sequence' ? [] : ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5']),
      ...(audioOnly ? ['-vn'] : videoCodecArgs(format, 'good', { width: 320, height: 180, fps: 30 }, mode)),
      ...(format === 'png-sequence' ? [] : audioCodecArgs(format)),
      ...containerArgs(format),
      out
    ]
    const run = spawnSync(FFMPEG, args, { encoding: 'utf8' })
    assert.equal(run.status, 0, `${format}/${mode} did not encode: ${run.stderr.trim().split('\n').slice(-3).join(' | ')}`)
    if (format === 'png-sequence') continue
    const streams = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', out], { encoding: 'utf8' })
    if (!audioOnly) assert.match(streams, /video/, `${format} has no video stream`)
    assert.match(streams, /audio/, `${format} has no audio stream`)
  }
})
