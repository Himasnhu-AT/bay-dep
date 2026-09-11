/**
 * Tests for transition geometry.
 *
 * Every kind is arithmetic over `progress`, so all of it is reachable without a canvas — and
 * arithmetic is where the mistakes are. An offset with the wrong sign slides the wrong way; a
 * wipe that starts at the far edge flashes the incoming clip full-frame for one frame; a dip
 * whose halves do not meet at 0.5 shows a seam; an iris sized to half the width leaves the
 * corners on the outgoing clip at the very end.
 *
 * Two invariants are asserted for **every** kind rather than case by case, because they are
 * what a transition is for: it must start on the outgoing clip and end on the incoming, and it
 * must never leave the frame uncovered.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TransitionKind, TransitionDirection } from '@shared/project'
import { planTransition, transitionAudioGains, type TransitionStep } from './transitions'

const CANVAS = { width: 1920, height: 1080 }
const KINDS: TransitionKind[] = [
  'cross-dissolve',
  'dip-to-black',
  'dip-to-white',
  'wipe',
  'push',
  'slide',
  'iris'
]
const DIRECTIONS: TransitionDirection[] = ['left', 'right', 'up', 'down']

const paints = (steps: TransitionStep[]): Extract<TransitionStep, { kind: 'paint' }>[] =>
  steps.filter((s): s is Extract<TransitionStep, { kind: 'paint' }> => s.kind === 'paint')

/**
 * Is `which` visible, in full, covering the frame, with nothing over it?
 *
 * A step clipped to zero area paints nothing and so is not visible — a wipe at progress 0
 * legitimately lists the incoming clip behind a zero-width clip. Counting that as visible
 * made this helper report a working plan as broken, which is the instrument being wrong about
 * the thing it exists to check.
 */
function showsAlone(steps: TransitionStep[], which: 'from' | 'to'): boolean {
  const paintsNothing = (s: TransitionStep): boolean =>
    s.kind === 'paint' &&
    ((s.clipRect !== undefined && (s.clipRect.width <= 0 || s.clipRect.height <= 0)) ||
      (s.clipCircle !== undefined && s.clipCircle.radius <= 0) ||
      // Offset by a whole frame or more is entirely off-canvas — which is exactly how a push
      // parks the clip that is not yet meant to be seen.
      Math.abs(s.offsetX) >= CANVAS.width ||
      Math.abs(s.offsetY) >= CANVAS.height)
  const visible = steps.filter(
    (s) =>
      !paintsNothing(s) &&
      ((s.kind === 'paint' && s.alpha > 0.001) || (s.kind === 'fill' && s.alpha > 0.001))
  )
  if (visible.length !== 1) return false
  const only = visible[0]
  if (!only || only.kind !== 'paint') return false
  return (
    only.which === which &&
    only.alpha > 0.999 &&
    only.offsetX === 0 &&
    only.offsetY === 0 &&
    only.clipRect === undefined &&
    only.clipCircle === undefined
  )
}

// -- the two invariants, for every kind and direction -----------------------

test('every kind shows the outgoing clip alone at progress 0', () => {
  for (const kind of KINDS) {
    for (const direction of DIRECTIONS) {
      const steps = planTransition(kind, direction, 0, CANVAS)
      assert.ok(
        showsAlone(steps, 'from'),
        `${kind}/${direction} at 0 should be the outgoing clip alone, got ${JSON.stringify(steps)}`
      )
    }
  }
})

test('every kind shows the incoming clip alone at progress 1', () => {
  for (const kind of KINDS) {
    for (const direction of DIRECTIONS) {
      const steps = planTransition(kind, direction, 1, CANVAS)
      const visible = steps.filter((s) => (s.kind === 'paint' ? s.alpha > 0.001 : s.alpha > 0.001))
      // A wipe or iris at 1 still lists the outgoing clip underneath, fully covered by the
      // incoming — that is correct, so the assertion is that `to` is on top, unoffset and
      // effectively unclipped.
      const top = visible[visible.length - 1]
      assert.ok(top && top.kind === 'paint' && top.which === 'to' && top.alpha > 0.999,
        `${kind}/${direction} at 1 must end on the incoming clip, got ${JSON.stringify(steps)}`)
      assert.equal(top.offsetX, 0, `${kind}/${direction} at 1 must not be offset`)
      assert.equal(top.offsetY, 0, `${kind}/${direction} at 1 must not be offset`)
      if (top.clipRect) {
        assert.ok(top.clipRect.width >= CANVAS.width - 0.01 && top.clipRect.height >= CANVAS.height - 0.01,
          `${kind}/${direction} at 1 must reveal the whole frame, got ${JSON.stringify(top.clipRect)}`)
      }
      if (top.clipCircle) {
        // Must reach the corner, not the edge — half the width leaves the corners behind.
        assert.ok(top.clipCircle.radius >= Math.hypot(CANVAS.width, CANVAS.height) / 2 - 0.01,
          `iris at 1 must cover the corners, radius ${top.clipCircle.radius}`)
      }
    }
  }
})

test('every kind paints at least one clip at every progress', () => {
  for (const kind of KINDS) {
    for (const direction of DIRECTIONS) {
      for (const p of [0, 0.01, 0.25, 0.49, 0.5, 0.51, 0.75, 0.99, 1]) {
        const drawn = paints(planTransition(kind, direction, p, CANVAS))
        assert.ok(drawn.length >= 1, `${kind}/${direction} at ${p} painted nothing`)
      }
    }
  }
})

test('progress outside 0..1 is clamped rather than extrapolated', () => {
  for (const kind of KINDS) {
    assert.deepEqual(planTransition(kind, 'left', -5, CANVAS), planTransition(kind, 'left', 0, CANVAS))
    assert.deepEqual(planTransition(kind, 'left', 5, CANVAS), planTransition(kind, 'left', 1, CANVAS))
    // NaN must not produce NaN offsets, which would silently draw nothing.
    for (const step of paints(planTransition(kind, 'left', Number.NaN, CANVAS))) {
      assert.ok(Number.isFinite(step.offsetX) && Number.isFinite(step.offsetY))
    }
  }
})

// -- per-kind behaviour -----------------------------------------------------

test('a cross dissolve is the incoming clip at alpha = progress over the outgoing', () => {
  const steps = paints(planTransition('cross-dissolve', undefined, 0.25, CANVAS))
  assert.equal(steps.length, 2)
  assert.equal(steps[0]?.which, 'from')
  assert.equal(steps[0]?.alpha, 1)
  assert.equal(steps[1]?.which, 'to')
  assert.equal(steps[1]?.alpha, 0.25, 'source-over at alpha p gives to*p + from*(1-p)')
})

test('a dip reaches full colour exactly at the midpoint, from both sides', () => {
  // The seam test: if the halves do not meet at 1 the frame flashes at the changeover.
  const before = planTransition('dip-to-black', undefined, 0.5, CANVAS)
  const fillBefore = before.find((s) => s.kind === 'fill')
  assert.ok(fillBefore && fillBefore.kind === 'fill')
  assert.ok(Math.abs(fillBefore.alpha - 1) < 0.001, `expected full dip at 0.5, got ${fillBefore.alpha}`)

  const justBefore = planTransition('dip-to-black', undefined, 0.499, CANVAS)
  const justAfter = planTransition('dip-to-black', undefined, 0.501, CANVAS)
  assert.equal(paints(justBefore)[0]?.which, 'from', 'the first half shows the outgoing clip')
  assert.equal(paints(justAfter)[0]?.which, 'to', 'the second half shows the incoming clip')
  const a = justBefore.find((s) => s.kind === 'fill')
  const b = justAfter.find((s) => s.kind === 'fill')
  assert.ok(a && b && a.kind === 'fill' && b.kind === 'fill')
  assert.ok(Math.abs(a.alpha - b.alpha) < 0.01, 'the dip must not jump across the midpoint')
})

test('dip to white uses white and dip to black uses black', () => {
  const black = planTransition('dip-to-black', undefined, 0.5, CANVAS).find((s) => s.kind === 'fill')
  const white = planTransition('dip-to-white', undefined, 0.5, CANVAS).find((s) => s.kind === 'fill')
  assert.equal(black?.kind === 'fill' ? black.color : null, '#000000')
  assert.equal(white?.kind === 'fill' ? white.color : null, '#FFFFFF')
})

test('a wipe reveals from the edge it comes from, and grows', () => {
  const quarter = paints(planTransition('wipe', 'left', 0.25, CANVAS))[1]
  assert.ok(quarter?.clipRect)
  assert.equal(quarter.clipRect.left, 0, 'a wipe from the left starts at the left edge')
  assert.equal(quarter.clipRect.width, CANVAS.width * 0.25)

  const fromRight = paints(planTransition('wipe', 'right', 0.25, CANVAS))[1]
  assert.ok(fromRight?.clipRect)
  assert.equal(fromRight.clipRect.left, CANVAS.width * 0.75, 'a wipe from the right hugs the right edge')

  const up = paints(planTransition('wipe', 'up', 0.25, CANVAS))[1]
  assert.ok(up?.clipRect)
  assert.equal(up.clipRect.top, 0)
  assert.equal(up.clipRect.height, CANVAS.height * 0.25)
})

test('a push moves both clips together and keeps them edge to edge', () => {
  const steps = paints(planTransition('push', 'left', 0.25, CANVAS))
  const from = steps[0]
  const to = steps[1]
  assert.ok(from && to)
  assert.equal(from.offsetX, -CANVAS.width * 0.25, 'the outgoing clip is pushed out')
  assert.equal(
    to.offsetX - from.offsetX,
    CANVAS.width,
    'exactly one frame width apart, or a gap opens between them'
  )
})

test('a push in every direction closes onto the frame at progress 1', () => {
  for (const direction of DIRECTIONS) {
    const to = paints(planTransition('push', direction, 1, CANVAS))[1]
    assert.ok(to)
    assert.equal(to.offsetX, 0, `push/${direction} must land the incoming clip at 0`)
    assert.equal(to.offsetY, 0, `push/${direction} must land the incoming clip at 0`)
  }
})

test('a slide moves only the incoming clip', () => {
  const steps = paints(planTransition('slide', 'left', 0.25, CANVAS))
  assert.equal(steps[0]?.offsetX, 0, 'the outgoing clip does not move in a slide')
  assert.equal(steps[0]?.offsetY, 0)
  assert.equal(steps[1]?.offsetX, CANVAS.width * 0.75, 'the incoming clip arrives from off-frame')
})

test('a slide arrives from the side it is told, not the opposite one', () => {
  // The sign test. 'left' means it comes *from* the left, so it starts at negative x and
  // travels right — getting this backwards is invisible in a still and obvious in motion.
  assert.ok((paints(planTransition('slide', 'right', 0.5, CANVAS))[1]?.offsetX ?? 0) < 0)
  assert.ok((paints(planTransition('slide', 'left', 0.5, CANVAS))[1]?.offsetX ?? 0) > 0)
  assert.ok((paints(planTransition('slide', 'down', 0.5, CANVAS))[1]?.offsetY ?? 0) < 0)
  assert.ok((paints(planTransition('slide', 'up', 0.5, CANVAS))[1]?.offsetY ?? 0) > 0)
})

test('an iris grows from the centre and reaches the corners', () => {
  const mid = paints(planTransition('iris', undefined, 0.5, CANVAS))[1]
  assert.ok(mid?.clipCircle)
  assert.equal(mid.clipCircle.centreX, CANVAS.width / 2)
  assert.equal(mid.clipCircle.centreY, CANVAS.height / 2)
  const corner = Math.hypot(CANVAS.width, CANVAS.height) / 2
  assert.ok(Math.abs(mid.clipCircle.radius - corner / 2) < 0.01)
  // The failure this guards: a radius of w/2 looks finished on a 16:9 frame and leaves the
  // corners showing the outgoing clip.
  assert.ok(mid.clipCircle.radius * 2 > CANVAS.width / 2)
})

test('a 1x1 canvas produces finite geometry', () => {
  for (const kind of KINDS) {
    for (const step of paints(planTransition(kind, 'left', 0.5, { width: 1, height: 1 }))) {
      assert.ok(Number.isFinite(step.offsetX) && Number.isFinite(step.offsetY))
      if (step.clipRect) assert.ok(step.clipRect.width >= 0 && step.clipRect.height >= 0)
      if (step.clipCircle) assert.ok(step.clipCircle.radius >= 0)
    }
  }
})

// -- audio ------------------------------------------------------------------

test('a visual transition cross-fades the sound rather than cutting it', () => {
  // A hard audio cut in the middle of a two-second wipe sounds like a mistake, so every kind
  // except a dip cross-fades. This is a judgement rather than a derivation, which is why it is
  // pinned: someone could reasonably assume a wipe cuts the audio at the wipe edge.
  for (const kind of ['cross-dissolve', 'wipe', 'push', 'slide', 'iris'] as TransitionKind[]) {
    assert.deepEqual(transitionAudioGains(kind, 0), { from: 1, to: 0 }, kind)
    assert.deepEqual(transitionAudioGains(kind, 1), { from: 0, to: 1 }, kind)
    const mid = transitionAudioGains(kind, 0.5)
    assert.ok(Math.abs(mid.from - 0.5) < 0.001 && Math.abs(mid.to - 0.5) < 0.001, kind)
  }
})

test('a dip passes through silence at the midpoint, where the picture is fully the dip colour', () => {
  for (const kind of ['dip-to-black', 'dip-to-white'] as TransitionKind[]) {
    assert.deepEqual(transitionAudioGains(kind, 0), { from: 1, to: 0 }, kind)
    assert.deepEqual(transitionAudioGains(kind, 1), { from: 0, to: 1 }, kind)
    const mid = transitionAudioGains(kind, 0.5)
    assert.equal(mid.from, 0, `${kind} should be silent at the midpoint`)
    assert.equal(mid.to, 0, `${kind} should be silent at the midpoint`)
  }
})

test('a dip is audible on both sides of its silence', () => {
  // The sound must come back, not stay at zero for the second half.
  const quarter = transitionAudioGains('dip-to-black', 0.25)
  const threeQuarters = transitionAudioGains('dip-to-black', 0.75)
  assert.ok(quarter.from > 0 && quarter.to === 0)
  assert.ok(threeQuarters.to > 0 && threeQuarters.from === 0)
})

test('audio gains never exceed the range a gain node should see', () => {
  for (const kind of KINDS) {
    for (const p of [-5, 0, 0.1, 0.5, 0.9, 1, 5, Number.NaN]) {
      const g = transitionAudioGains(kind, p)
      for (const v of [g.from, g.to]) {
        assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${kind} at ${p} gave ${v}`)
      }
    }
  }
})
