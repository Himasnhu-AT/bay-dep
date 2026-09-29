import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cubicBezierAt, easeProgress, parseEase } from './ease'
import { easeProgress as fromKeyframes } from './keyframes'
import { transitionAtFrame, type KeyframeEase, type Project, type Timeline } from './project'
import { transitionOfItemAt } from './audio-gain'

const ASSET = {
  id: 'a1', kind: 'video' as const, name: 'clip.mp4', path: '/tmp/clip.mp4', durationUs: 60_000_000,
  width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0
}

function item(id: string, from: number, sourceStartUs: number) {
  return {
    id, assetId: 'a1', trackId: 'v1', from, durationInFrames: 60, sourceStartUs,
    layout: { left: 0, top: 0, width: 1920, height: 1080, rotation: 0, opacity: 1 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

/** Two clips abutting at frame 60 on one track, a 30-frame dissolve across the cut, with `ease`. */
function fixture(ease?: KeyframeEase): { project: Project; timeline: Timeline } {
  const timeline = {
    id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000',
    tracks: [{ id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: [item('A', 0, 5_000_000), item('B', 60, 30_000_000)] }],
    transitions: [{ id: 't1', fromItemId: 'A', toItemId: 'B', kind: 'cross-dissolve', durationInFrames: 30, ...(ease ? { ease } : {}) }]
  } as unknown as Timeline
  const project = { id: 'p', name: 'P', createdAt: 0, updatedAt: 0, assets: [ASSET], timelines: [timeline], activeTimelineId: 'tl' } as unknown as Project
  return { project, timeline }
}

test('keyframes and transitions sample one ease: the keyframes export is the same function', () => {
  assert.equal(fromKeyframes, easeProgress)
})

test('a transition with no ease is linear, as every transition written before the field was', () => {
  const { project, timeline } = fixture()
  const at = (frame: number): number => transitionAtFrame(project, timeline, frame)!.progress
  const first = transitionAtFrame(project, timeline, 45)!.resolved
  const span = first.lastFrame - first.firstFrame
  for (let frame = first.firstFrame; frame <= first.lastFrame; frame += 1) {
    assert.ok(Math.abs(at(frame) - (frame - first.firstFrame) / span) < 1e-12, `frame ${frame}`)
  }
})

test('an eased transition follows its curve, and the picture and the sound agree on it', () => {
  const linear = fixture()
  const eased = fixture('inOut')
  const window = transitionAtFrame(eased.project, eased.timeline, 60)!.resolved
  const quarter = Math.round(window.firstFrame + (window.lastFrame - window.firstFrame) / 4)
  const picture = transitionAtFrame(eased.project, eased.timeline, quarter)!.progress
  const plain = transitionAtFrame(linear.project, linear.timeline, quarter)!.progress
  // ease-in-out is slower than linear a quarter of the way in…
  assert.ok(picture < plain, `${picture} < ${plain}`)
  // …and exactly the CSS curve there.
  assert.ok(Math.abs(picture - easeProgress('inOut', plain)) < 1e-12)
  // The sound's gain lookup (`transitionOfItemAt`, what preview and export audio read) gets the
  // same progress for both clips — one curve, not two opinions about it.
  const itemA = eased.timeline.tracks[0]!.items[0]!
  const itemB = eased.timeline.tracks[0]!.items[1]!
  for (let frame = window.firstFrame; frame <= window.lastFrame; frame += 1) {
    const shown = transitionAtFrame(eased.project, eased.timeline, frame)!.progress
    assert.equal(transitionOfItemAt(eased.project, eased.timeline, itemA, frame)!.progress, shown)
    assert.equal(transitionOfItemAt(eased.project, eased.timeline, itemB, frame)!.progress, shown)
  }
  // The ends still land: all outgoing at the first frame, all incoming at the last.
  assert.equal(transitionAtFrame(eased.project, eased.timeline, window.firstFrame)!.progress, 0)
  assert.equal(transitionAtFrame(eased.project, eased.timeline, window.lastFrame)!.progress, 1)
})

test('a custom bezier transition samples the bezier', () => {
  const curve: KeyframeEase = [0.1, 0.9, 0.2, 1]
  const { project, timeline } = fixture(curve)
  const window = transitionAtFrame(project, timeline, 60)!.resolved
  const mid = Math.round((window.firstFrame + window.lastFrame) / 2)
  const linear = (mid - window.firstFrame) / (window.lastFrame - window.firstFrame)
  assert.ok(Math.abs(transitionAtFrame(project, timeline, mid)!.progress - cubicBezierAt(0.1, 0.9, 0.2, 1, linear)) < 1e-12)
})

test('parseEase takes names and tuples, reads linear as absent, and refuses time running backwards', () => {
  assert.equal(parseEase('linear', 'x'), undefined)
  assert.equal(parseEase('inOut', 'x'), 'inOut')
  assert.deepEqual(parseEase([0.2, 1.4, 0.8, -0.2], 'x'), [0.2, 1.4, 0.8, -0.2])
  const backwards = parseEase([1.2, 0, 0.5, 1], 'add_transition', 'the progress across the cut')
  assert.ok(backwards && typeof backwards === 'object' && 'error' in backwards)
  assert.match((backwards as { error: string }).error, /x1 and x2 must be within 0\.\.1/)
  const nonsense = parseEase('bouncy', 'add_transition', 'the progress across the cut')
  // The refusal names what to send instead, and what the ease shapes here.
  assert.match((nonsense as { error: string }).error, /"inOut"/)
  assert.match((nonsense as { error: string }).error, /the progress across the cut/)
})
