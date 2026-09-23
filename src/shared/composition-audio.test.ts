/**
 * Tests for when a composition's declared sounds play, and how loud.
 *
 * Every case is a way a composition clip could show one moment and sound another while both
 * preview and export agree with each other — the schedule and the gain are shared, so a fault
 * here is heard identically everywhere and caught nowhere else. The assertions are written
 * from the clip mapping (`sourceTimeAt`) and the gain rules, not from this module's arithmetic.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompositionSound } from './composition'
import type { Asset, Item, Project, Timeline, Transition, TransitionKind } from './project'
import { fadeGainAt, sourceTimeAt } from './project'
import { audibleSpan, itemAudioGainAt, transitionAudioGains } from './audio-gain'
import { scheduleCompositionSounds, soundSecondsAt } from './composition-audio'

const FPS = 30

function sound(over: Partial<CompositionSound> = {}): CompositionSound {
  return {
    id: 'whoosh',
    src: 'whoosh.wav',
    path: '/c/whoosh.wav',
    startSeconds: 0,
    durationSeconds: null,
    mediaStartSeconds: 0,
    volume: 1,
    line: 1,
    ...over
  }
}

function clip(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    assetId: 'comp',
    trackId: 't1',
    from: 0,
    durationInFrames: 150,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...over
  }
}

function composition(durationUs = 10_000_000): Asset {
  return {
    id: 'comp',
    kind: 'html',
    name: 'title.html',
    path: '/c/title.html',
    durationUs,
    width: 1920,
    height: 1080,
    fps: null,
    hasAudio: false,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0,
    compositionId: 'title'
  }
}

function world(items: Item[], transitions: Transition[] = []): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'Timeline 1',
    fps: FPS,
    width: 1920,
    height: 1080,
    background: '#000000',
    tracks: [{ id: 't1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items }],
    transitions
  }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    assets: [composition()],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

const ownSpan = (item: Item) => ({ firstFrame: item.from, endFrame: item.from + item.durationInFrames })

/** The composition second a clip shows at timeline second `t` — the clip mapping, restated. */
const shows = (item: Item, t: number): number => sourceTimeAt(item, t * FPS, FPS) / 1_000_000

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

test('a sound lands where the clip shows its data-start, not at the clip start', () => {
  const item = clip('c', { from: 30 })
  const [entry] = scheduleCompositionSounds(item, ownSpan(item), 10, [sound({ startSeconds: 0.2 })], FPS)
  assert.ok(entry)
  // Derived from the mapping: the timeline second at which the clip shows composition 0.2s.
  assert.ok(Math.abs(shows(item, entry.startSeconds) - 0.2) < 1e-9)
  assert.equal(entry.mediaStartSeconds, 0)
})

test('a clip trimmed into a sound enters it part-way, from the right place in the file', () => {
  // Head trimmed by one second: the clip opens on composition 1.0s, inside a sound that began
  // at 0.2s — so the file must be entered 0.8s in, plus its own media offset.
  const item = clip('c', { from: 60, sourceStartUs: 1_000_000 })
  const [entry] = scheduleCompositionSounds(
    item,
    ownSpan(item),
    10,
    [sound({ startSeconds: 0.2, durationSeconds: 3, mediaStartSeconds: 0.5 })],
    FPS
  )
  assert.ok(entry)
  assert.equal(entry.startSeconds, item.from / FPS)
  assert.ok(Math.abs(entry.mediaStartSeconds - (0.5 + 0.8)) < 1e-9)
  // And it stops where the declared duration ends: composition 3.2s.
  assert.ok(Math.abs(shows(item, entry.endSeconds) - 3.2) < 1e-9)
})

test('a clip that ends mid-sound cuts it at the clip end', () => {
  const item = clip('c', { durationInFrames: 45 })
  const [entry] = scheduleCompositionSounds(item, ownSpan(item), 10, [sound({ startSeconds: 1 })], FPS)
  assert.ok(entry)
  assert.equal(entry.endSeconds, 45 / FPS)
})

test('a sound outside what the clip shows is not scheduled, and one inside is', () => {
  const item = clip('c', { durationInFrames: 30 }) // shows composition 0..1s
  const sounds = [sound({ id: 'late', startSeconds: 2 }), sound({ id: 'early', startSeconds: 0.5 })]
  const scheduled = scheduleCompositionSounds(item, ownSpan(item), 10, sounds, FPS)
  assert.deepEqual(scheduled.map((e) => e.sound.id), ['early'])
  assert.equal(scheduled[0]?.index, 1, 'the index is the declared position, a stable key')
})

test('nothing plays past the composition, even with no declared duration', () => {
  // A 150-frame clip of a 2s composition: the page holds its last frame from 2s, and the
  // sound stops there with it.
  const item = clip('c')
  const [entry] = scheduleCompositionSounds(item, ownSpan(item), 2, [sound()], FPS)
  assert.ok(entry)
  assert.equal(entry.endSeconds, 2)
})

test('speed is honoured: the sound arrives with its picture and plays at the clip rate', () => {
  const item = clip('c', { speed: 2 })
  const [entry] = scheduleCompositionSounds(item, ownSpan(item), 10, [sound({ startSeconds: 1 })], FPS)
  assert.ok(entry)
  assert.ok(Math.abs(shows(item, entry.startSeconds) - 1) < 1e-9, 'lands with the picture')
  assert.equal(entry.speed, 2)
  // One timeline second later the file has advanced two.
  assert.equal(soundSecondsAt(entry, entry.startSeconds + 1), 2)
})

test('a sound with no resolved file is not scheduled', () => {
  const item = clip('c')
  assert.deepEqual(
    scheduleCompositionSounds(item, ownSpan(item), 10, [sound({ path: null })], FPS),
    []
  )
})

test('soundSecondsAt is half-open, like every span in bay', () => {
  const item = clip('c', { durationInFrames: 30 })
  const [entry] = scheduleCompositionSounds(item, ownSpan(item), 10, [sound()], FPS)
  assert.ok(entry)
  assert.equal(soundSecondsAt(entry, entry.startSeconds), 0)
  assert.equal(soundSecondsAt(entry, entry.endSeconds), null)
})

// ---------------------------------------------------------------------------
// Transitions widen the span
// ---------------------------------------------------------------------------

/** A clip `a` cutting to composition clip `b` at frame 60, with a 20-frame transition. */
function junction(kind: TransitionKind = 'cross-dissolve', bOver: Partial<Item> = {}) {
  const a = clip('a', { durationInFrames: 60, sourceStartUs: 0 })
  const b = clip('b', { from: 60, durationInFrames: 90, sourceStartUs: 2_000_000, ...bOver })
  const transition: Transition = {
    id: 'x',
    kind,
    fromItemId: 'a',
    toItemId: 'b',
    durationInFrames: 20
  }
  return { a, b, ...world([a, b], [transition]) }
}

test('an incoming composition sounds during the transition before its own start', () => {
  const { b, project, timeline } = junction()
  const span = audibleSpan(project, timeline, b)
  assert.equal(span.firstFrame, 50, 'half the window before the cut')
  // A sound at composition 1.8s is shown at frame 54 — before b.from, inside the window.
  const [entry] = scheduleCompositionSounds(b, span, 10, [sound({ startSeconds: 1.8 })], FPS)
  assert.ok(entry)
  assert.ok(entry.startSeconds * FPS < b.from)
  // Positive control: without the transition's span it would not start until the cut.
  const [clipped] = scheduleCompositionSounds(b, ownSpan(b), 10, [sound({ startSeconds: 1.8 })], FPS)
  assert.equal(clipped?.startSeconds, b.from / FPS)
})

// ---------------------------------------------------------------------------
// Gain
// ---------------------------------------------------------------------------

test('inside the clip the gain is volume times the fade envelope', () => {
  const item = clip('c', { volume: 0.5, fadeInFrames: 10, fadeOutFrames: 10 })
  const { project, timeline } = world([item])
  for (const frame of [0, 5, 10, 75, 140, 145, 149]) {
    assert.equal(itemAudioGainAt(project, timeline, item, frame), 0.5 * fadeGainAt(item, frame))
  }
})

test('outside the clip, with no transition, it is silent', () => {
  const item = clip('c', { from: 30, durationInFrames: 30 })
  const { project, timeline } = world([item])
  assert.equal(itemAudioGainAt(project, timeline, item, 29), 0)
  assert.equal(itemAudioGainAt(project, timeline, item, 60), 0)
  assert.equal(itemAudioGainAt(project, timeline, item, 30), 1, 'positive control')
})

test('inside a transition the curve is the shared transition curve, before and after the cut', () => {
  const { a, b, project, timeline } = junction()
  for (const frame of [50, 55, 59, 60, 65, 69]) {
    const p = (frame - 50) / 19
    const gains = transitionAudioGains('cross-dissolve', p)
    assert.ok(Math.abs(itemAudioGainAt(project, timeline, b, frame) - gains.to) < 1e-12, `b @${frame}`)
    assert.ok(Math.abs(itemAudioGainAt(project, timeline, a, frame) - gains.from) < 1e-12, `a @${frame}`)
  }
})

test('where a transition meets the clip fade at the same end, the transition wins', () => {
  // A 12-frame fade-in on b, under a dissolve at b's head. Multiplied, the two would dip to
  // near-silence mid-window; the rule is that the fade at that end is set aside.
  const { b, project, timeline } = junction('cross-dissolve', { fadeInFrames: 12, fadeOutFrames: 12 })
  const mid = 60 // p = 10/19
  const expected = transitionAudioGains('cross-dissolve', 10 / 19).to
  assert.ok(Math.abs(itemAudioGainAt(project, timeline, b, mid) - expected) < 1e-12)
  // The fade at the *other* end still applies: b's last frame is inside its fade-out.
  assert.equal(itemAudioGainAt(project, timeline, b, 149), fadeGainAt(b, 149))
})

test('the same rule holds at the outgoing end: a fade-out under a dissolve is set aside', () => {
  const a = clip('a', { durationInFrames: 60, fadeInFrames: 12, fadeOutFrames: 12 })
  const b = clip('b', { from: 60, durationInFrames: 90, sourceStartUs: 2_000_000 })
  const { project, timeline } = world(
    [a, b],
    [{ id: 'x', kind: 'cross-dissolve', fromItemId: 'a', toItemId: 'b', durationInFrames: 20 }]
  )
  // Frame 55 is inside a's fade-out (5 frames left) and inside the window (p = 5/19).
  assert.ok(fadeGainAt(a, 55) < 1, 'the specimen must be inside the fade, or this tests nothing')
  const expected = transitionAudioGains('cross-dissolve', 5 / 19).from
  assert.ok(Math.abs(itemAudioGainAt(project, timeline, a, 55) - expected) < 1e-12)
  // And the fade at the other end still applies.
  assert.equal(itemAudioGainAt(project, timeline, a, 3), fadeGainAt(a, 3))
})

test('a dip passes through silence at its midpoint', () => {
  const { a, b, project, timeline } = junction('dip-to-black')
  // The window is frames 50..69; progress 0.5 falls between 59 and 60, where both are near 0.
  assert.ok(itemAudioGainAt(project, timeline, a, 59) < 0.06)
  assert.ok(itemAudioGainAt(project, timeline, b, 60) < 0.06)
})

test('a non-finite volume plays at 1 rather than silencing the clip', () => {
  const item = clip('c', { volume: Number.NaN })
  const { project, timeline } = world([item])
  assert.equal(itemAudioGainAt(project, timeline, item, 10), 1)
})
