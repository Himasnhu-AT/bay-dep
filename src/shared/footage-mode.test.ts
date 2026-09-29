/**
 * The footage classifier on synthetic signal sets: one specimen per mode, each beside the nearest
 * case that must come out differently (a lav-recorded talking head is not a podcast; a podcast
 * with no speech measured is still a podcast, less sure; speech-heavy short clips are not B-roll).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionsFor, classifyFootage, FOOTAGE_MODES, type FootageAssetSignal, type FootageMode } from './footage-mode'
import { TOOLS } from './mcp'
import { BAY_SKILLS } from './skills'

const video = (name: string, durationSec: number, extra: Partial<FootageAssetSignal> = {}): FootageAssetSignal => ({
  name,
  kind: 'video',
  durationSec,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  ...extra
})
const audio = (name: string, durationSec: number, extra: Partial<FootageAssetSignal> = {}): FootageAssetSignal => ({
  name,
  kind: 'audio',
  durationSec,
  hasAudio: true,
  channels: 1,
  ...extra
})
const mode = (assets: FootageAssetSignal[]): FootageMode => classifyFootage({ assets }).mode

test('two cameras and two mics of one conversation are a podcast', () => {
  const result = classifyFootage({
    assets: [
      video('cam-a.mov', 3600, { speechRatio: 0.7 }),
      video('cam-b.mov', 3598, { speechRatio: 0.7 }),
      audio('mic-host.wav', 3601, { speechRatio: 0.6 }),
      audio('mic-guest.wav', 3600, { speechRatio: 0.55 })
    ]
  })
  assert.equal(result.mode, 'podcast')
  assert.ok(result.confidence >= 0.8, String(result.confidence))
  assert.equal(result.summary.matchingGroup.length, 4)
  assert.ok(result.reasons.some((r) => r.includes('4 recordings')), result.reasons.join('|'))
})

test('a podcast with no speech measured is still a podcast, but less sure', () => {
  const measured = classifyFootage({ assets: [video('a.mov', 1800, { speechRatio: 0.8 }), video('b.mov', 1801, { speechRatio: 0.8 })] })
  const unmeasured = classifyFootage({ assets: [video('a.mov', 1800), video('b.mov', 1801)] })
  assert.equal(unmeasured.mode, 'podcast')
  assert.ok(unmeasured.confidence < measured.confidence)
  assert.ok(unmeasured.reasons.some((r) => r.includes('not measured')))
})

test('matching lengths but music, not speech, are not a podcast', () => {
  assert.notEqual(mode([video('a.mov', 600, { speechRatio: 0.05 }), video('b.mov', 600, { speechRatio: 0.05 })]), 'podcast')
})

test('one camera with a separate lav is a talking head, not a podcast', () => {
  const lav = [video('me.mov', 600, { speechRatio: 0.8 }), audio('lav.wav', 601, { speechRatio: 0.8 })]
  assert.equal(mode(lav), 'talking-head')
  // …while one camera with TWO mics is a (one-camera) podcast.
  assert.equal(mode([...lav, audio('guest.wav', 600, { speechRatio: 0.7 })]), 'podcast')
})

test('one long take to camera with speech is a talking head; a short one is not', () => {
  assert.equal(mode([video('take.mov', 420, { activityRatio: 0.8 }), video('logo.mov', 5, { hasAudio: false })]), 'talking-head')
  assert.notEqual(mode([video('take.mov', 30, { activityRatio: 0.8 })]), 'talking-head')
  // Already cut to pieces: not a raw talking head.
  assert.notEqual(mode([video('edit.mov', 420, { speechRatio: 0.8, cutsPerMin: 6 })]), 'talking-head')
})

test('a recording at a display resolution that barely cuts is a screen recording', () => {
  assert.equal(mode([video('screen.mov', 900, { width: 2880, height: 1800, speechRatio: 0.5, cutsPerMin: 0 })]), 'screen-recording')
  assert.equal(mode([video('screen.mov', 900, { width: 1440, height: 900 })]), 'screen-recording')
  // The same length at a camera's 1920×1080 is not.
  assert.notEqual(mode([video('cam.mov', 900, { speechRatio: 0.5, cutsPerMin: 0 })]), 'screen-recording')
})

test('many short clips with hardly any words are a B-roll pile; the same with talking are not', () => {
  const clips = (speech: number) => Array.from({ length: 8 }, (_, i) => video(`b${i}.mov`, 8 + i * 2, { speechRatio: speech }))
  assert.equal(mode(clips(0.02)), 'b-roll-pile')
  assert.notEqual(mode(clips(0.7)), 'b-roll-pile')
  assert.equal(mode(Array.from({ length: 6 }, (_, i) => video(`c${i}.mov`, 12, { hasAudio: false }))), 'b-roll-pile')
})

test('a song with a steady beat under several clips is a music video; so is footage cut fast', () => {
  assert.equal(mode([audio('song.mp3', 210, { beatConfidence: 0.8, speechRatio: 0.02 }), video('a.mov', 20), video('b.mov', 30)]), 'music-video')
  assert.equal(mode([video('edit.mov', 180, { cutsPerMin: 40 })]), 'music-video')
  // A song with no steady beat is not evidence of one.
  assert.notEqual(mode([audio('ambient.wav', 210, { beatConfidence: 0.1, speechRatio: 0 }), video('a.mov', 20), video('b.mov', 30)]), 'music-video')
})

test('nothing imported is mixed with no confidence; a jumble is mixed', () => {
  const empty = classifyFootage({ assets: [] })
  assert.equal(empty.mode, 'mixed')
  assert.equal(empty.confidence, 0)
  assert.equal(mode([video('a.mov', 200, { speechRatio: 0.4 }), video('b.mov', 150, { speechRatio: 0.2 }), audio('vo.wav', 90, { speechRatio: 0.9 })]), 'mixed')
})

test('every mode names real tools and skills, and offers at least one action', () => {
  const tools = new Set(TOOLS.map((t) => t.name))
  const skills = new Set(BAY_SKILLS.map((s) => s.slug))
  for (const [name, info] of Object.entries(FOOTAGE_MODES)) {
    for (const tool of info.tools) assert.ok(tools.has(tool), `${name}: ${tool} is not a bay tool`)
    for (const skill of info.skills) assert.ok(skills.has(skill), `${name}: ${skill} is not a bay skill`)
    assert.ok(actionsFor(name as FootageMode).length > 0, name)
    for (const action of info.actions) {
      if (action.tool) assert.ok(tools.has(action.tool.name), `${name}/${action.id}: ${action.tool.name}`)
      for (const slug of action.prompt.match(/(?<=^|\s)\/([a-z0-9-]+)/g) ?? []) {
        assert.ok(skills.has(slug.slice(1)), `${name}/${action.id} names ${slug}, which is not a skill`)
      }
    }
  }
})
