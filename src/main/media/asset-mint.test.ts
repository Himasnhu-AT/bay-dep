/**
 * How an imported file becomes an asset. Run with `pnpm test`.
 *
 * The kind decides everything downstream — a still minted as a one-frame video cannot be
 * stretched on the timeline, an audio file minted as video gets a black picture — so it is
 * decided from what the probe found in the file, with the extension consulted only where the
 * streams cannot say (a GIF is video to ffprobe; a file with no readable streams).
 *
 * This is also the writer half of the `.bay` additive-only rule for assets (the store's half is
 * `src/renderer/src/store/project-format.test.ts`, which cannot import from main): every asset
 * key a version-1 file on disk carries must still be written by today's importer, checked
 * against the fixture *text*, so a rename cannot move the expectation along with the code.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ProbeResult } from '@shared/ipc'
import { isCompositionPath } from '@shared/composition'
import { V1_ON_DISK } from '@shared/project-fixtures'
import { assetFrom, failedAsset, kindFor } from './asset-mint'

const probed = (extra: Partial<ProbeResult>): ProbeResult => ({
  path: '/m/x',
  durationUs: 10_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  summary: '',
  ...extra
})

const VIDEO_WITH_SOUND = probed({})
const VIDEO_SILENT = probed({ hasAudio: false })
const AUDIO_ONLY = probed({ hasVideo: false, width: null, height: null, fps: null })
/** What ffprobe reports for a still: one video stream, no rate, no length. */
const STILL = probed({ hasAudio: false, fps: null, durationUs: 0 })
const NO_STREAMS = probed({ hasVideo: false, hasAudio: false, width: null, height: null, fps: null, durationUs: 0 })

test('video files are video, with or without a sound track', () => {
  assert.equal(kindFor('/m/interview.mp4', VIDEO_WITH_SOUND), 'video')
  assert.equal(kindFor('/m/broll.mov', VIDEO_SILENT), 'video')
})

test('an audio file is audio, whatever container it came in', () => {
  assert.equal(kindFor('/m/voice.wav', AUDIO_ONLY), 'audio')
  // An m4a is an MP4 container; the streams, not the family resemblance, decide.
  assert.equal(kindFor('/m/voice.m4a', AUDIO_ONLY), 'audio')
})

test('a still is an image, however it is packaged — and a still-looking video is not', () => {
  assert.equal(kindFor('/m/logo.png', STILL), 'image')
  assert.equal(kindFor('/m/frame.mp4', STILL), 'image', 'a one-frame "video" is a still')
  // Positive control: the same path with a rate and a length is real video.
  assert.equal(kindFor('/m/frame.mp4', VIDEO_SILENT), 'video')
})

test('a GIF is its own kind even though ffprobe sees a video stream, in any case', () => {
  assert.equal(kindFor('/m/anim.gif', VIDEO_SILENT), 'gif')
  assert.equal(kindFor('/m/ANIM.GIF', VIDEO_SILENT), 'gif')
})

test('uppercase extensions are read the same as lowercase', () => {
  assert.equal(kindFor('/m/PHOTO.JPG', NO_STREAMS), 'image')
  assert.equal(kindFor('/m/photo.jpg', NO_STREAMS), 'image')
  assert.equal(kindFor('/m/CLIP.MOV', VIDEO_WITH_SOUND), 'video')
})

test('an unknown extension is decided by its streams, not guessed from the name', () => {
  assert.equal(kindFor('/m/recording.xyz', AUDIO_ONLY), 'audio')
  assert.equal(kindFor('/m/recording.xyz', VIDEO_WITH_SOUND), 'video')
  assert.equal(kindFor('/m/no-extension', AUDIO_ONLY), 'audio')
})

test('HTML compositions are routed away from ffprobe, in any case, and media is not', () => {
  // `kindFor` never sees these: `importPaths` sends a composition to `compositionAsset` first.
  for (const path of ['/c/intro.html', '/c/INTRO.HTML', '/c/intro.htm', '/c/intro.xhtml']) {
    assert.equal(isCompositionPath(path), true, path)
  }
  for (const path of ['/m/clip.mp4', '/m/html', '/m/page.html.mp4']) {
    assert.equal(isCompositionPath(path), false, path)
  }
})

test('a minted asset carries the probe’s measurements and the file’s name', () => {
  const probe = probed({ durationUs: 67_833_333, width: 1080, height: 1920, fps: 29.97 })
  const before = Date.now()
  const asset = assetFrom('/footage/Goodall Interview.MP4', probe)
  assert.equal(asset.name, 'Goodall Interview.MP4')
  assert.equal(asset.path, '/footage/Goodall Interview.MP4')
  assert.equal(asset.kind, 'video')
  assert.equal(asset.durationUs, probe.durationUs)
  assert.equal(asset.width, probe.width)
  assert.equal(asset.height, probe.height)
  assert.equal(asset.fps, probe.fps)
  assert.equal(asset.hasAudio, true)
  assert.equal(asset.hasVideo, true)
  // A poster recorded before the file exists would be a lie; the renderer asks for it later.
  assert.equal(asset.posterPath, null)
  assert.equal(asset.waveformPath, null)
  assert.ok(asset.createdAt >= before && asset.createdAt <= Date.now())
  assert.equal(asset.error, undefined, 'a successful import carries no error key')
})

test('two imports of identical probes get different ids', () => {
  assert.notEqual(assetFrom('/m/a.mp4', VIDEO_WITH_SOUND).id, assetFrom('/m/a.mp4', VIDEO_WITH_SOUND).id)
})

test('a failed import keeps the file listed, with its error and nothing claimed about it', () => {
  const asset = failedAsset('/m/corrupt.mp4', 'moov atom not found')
  assert.equal(asset.name, 'corrupt.mp4')
  assert.equal(asset.path, '/m/corrupt.mp4')
  assert.equal(asset.error, 'moov atom not found')
  // Claiming streams or a length for a file that did not probe would let it be placed.
  assert.equal(asset.hasAudio, false)
  assert.equal(asset.hasVideo, false)
  assert.equal(asset.durationUs, 0)
  assert.equal(asset.fps, null)
})

test('an imported sound keeps its channel count; a file that does not say, or has no sound, gets none', () => {
  assert.equal(assetFrom('/m/voice.wav', { ...AUDIO_ONLY, channels: 1 }).channels, 1)
  assert.equal(assetFrom('/m/music.wav', { ...AUDIO_ONLY, channels: 2 }).channels, 2)
  // Absent, not undefined-valued: nothing is written to the .bay for it.
  assert.equal('channels' in assetFrom('/m/voice.wav', AUDIO_ONLY), false)
  assert.equal('channels' in assetFrom('/m/broll.mov', { ...VIDEO_SILENT, channels: 2 }), false)
})

/** The keys of the version-1 fixture's assets, read from the document's text. */
function onDiskAssetKeys(): string[] {
  const document = JSON.parse(V1_ON_DISK) as { assets: Record<string, unknown>[] }
  return [...new Set(document.assets.flatMap((asset) => Object.keys(asset)))]
}

test('the version-1 fixture has asset keys to check against', () => {
  // The instrument first: an empty list would pass the two tests below vacuously.
  const keys = onDiskAssetKeys()
  for (const key of ['id', 'kind', 'durationUs', 'hasAudio', 'posterPath', 'createdAt']) {
    assert.ok(keys.includes(key), `${key} missing from ${keys.join(',')}`)
  }
})

const minted = {
  'an imported file': () => assetFrom('/footage/goodall.mp4', VIDEO_WITH_SOUND),
  'a file that failed to probe': () => failedAsset('/footage/corrupt.mp4', 'moov atom not found')
}

for (const [label, mint] of Object.entries(minted)) {
  test(`an asset minted today for ${label} carries every asset key of the version-1 document`, () => {
    // Through JSON, as `writeProjectFile` serialises it: a key holding `undefined` is not written.
    const written = new Set(Object.keys(JSON.parse(JSON.stringify(mint())) as object))
    const missing = onDiskAssetKeys().filter((key) => !written.has(key))
    assert.deepEqual(
      missing,
      [],
      `Importing no longer writes asset key(s) ${missing.join(', ')}. Files already on disk carry ` +
        `them and older builds read them. Renaming or removing a persisted field needs a ` +
        `PROJECT_VERSION bump and a migration (src/main/project/migrations.ts), not a refactor.`
    )
  })
}
