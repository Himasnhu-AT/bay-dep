/**
 * Only files ffmpeg can take a picture of are sent to it for posters and filmstrips.
 * The report: every HTML composition tile logged a failed `media:thumbnail` handler on launch
 * ("Invalid data found when processing input"), and filmstrips failed the same way — because
 * any asset with a path was sent. Each refusal is paired with a kind that must still get one.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { canMakeFilmstrip, canMakePoster, laneFrames, stripFrameIndex, wantsLanePoster } from './mediaKinds'

function asset(kind: Asset['kind'], extra: Partial<Asset> = {}): Asset {
  return {
    id: `a-${kind}`, kind, name: `x.${kind}`, path: `/tmp/x.${kind}`, durationUs: 5_000_000,
    width: 1080, height: 1920, hasAudio: false, hasVideo: kind === 'video' || kind === 'gif' || kind === 'html',
    createdAt: 0, ...extra
  } as Asset
}

test('a composition, .brf, LUT or sound file is never sent to ffmpeg for a poster; pictures still are', () => {
  for (const kind of ['html', 'brf', 'lut', 'audio', 'text'] as const) {
    assert.equal(canMakePoster(asset(kind)), false, `${kind} must not get an ffmpeg poster`)
  }
  for (const kind of ['video', 'image', 'gif'] as const) {
    assert.equal(canMakePoster(asset(kind)), true, `${kind} must still get a poster`)
  }
})

test('a filmstrip only for moving pictures ffmpeg reads — a composition reports video and still gets none', () => {
  // The specimen matters: an HTML composition has hasVideo, so a hasVideo check alone passes it.
  assert.equal(asset('html').hasVideo, true)
  assert.equal(canMakeFilmstrip(asset('html')), false)
  assert.equal(canMakeFilmstrip(asset('video')), true)
  assert.equal(canMakeFilmstrip(asset('gif')), true)
  assert.equal(canMakeFilmstrip(asset('image')), false)
})

test('an asset that failed to probe, or has no file, gets neither', () => {
  assert.equal(canMakePoster(asset('video', { error: 'unreadable' })), false)
  assert.equal(canMakePoster(asset('video', { path: undefined })), false)
  assert.equal(canMakeFilmstrip(asset('video', { error: 'unreadable' })), false)
})

test('an image clip draws its poster on the lane; a video draws its filmstrip; sound draws neither', () => {
  // The specimen is what a freeze frame imports as: an image with no duration.
  const still = asset('image', { durationUs: 0, hasVideo: true })
  assert.equal(canMakeFilmstrip(still), false, 'the specimen must be one the filmstrip path refuses')
  assert.deepEqual(laneFrames(still, [], 'bay://poster.png'), ['bay://poster.png'])
  assert.equal(wantsLanePoster(still), true)
  // Positive control: a video keeps its strip and never swaps it for the poster.
  assert.deepEqual(laneFrames(asset('video'), ['f0', 'f1'], 'bay://poster.png'), ['f0', 'f1'])
  assert.equal(wantsLanePoster(asset('video')), false)
  // No poster yet, or a kind ffmpeg cannot picture: nothing, rather than a broken URL.
  assert.deepEqual(laneFrames(still, [], null), [])
  assert.deepEqual(laneFrames(asset('html'), [], 'bay://poster.png'), [])
  assert.equal(wantsLanePoster(asset('audio')), false)
})

test('a still has its one strip frame at every source time; a video maps time across the strip', () => {
  assert.equal(stripFrameIndex(1, 0, 0), 0)
  assert.equal(stripFrameIndex(1, 3_000_000, 0), 0)
  assert.equal(stripFrameIndex(24, 0, 10_000_000), 0)
  assert.equal(stripFrameIndex(24, 5_000_000, 10_000_000), 12)
  assert.equal(stripFrameIndex(24, 10_000_000, 10_000_000), 23)
  assert.equal(stripFrameIndex(0, 0, 10_000_000), -1)
})
