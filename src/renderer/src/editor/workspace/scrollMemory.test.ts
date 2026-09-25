/**
 * The DOM half — that Chromium drops a moved scroller's offsets — was measured in the app, not
 * here: timeline scrolled to 5000/274, Edit → Audio → Edit read 0/0 before this, 5000/274 after.
 * This is the bookkeeping: what is remembered, what is put back, and what is not believed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ScrollMemory, type Scrollable } from './scrollMemory'

const scroller = (box = { clientWidth: 800, clientHeight: 200 }): Scrollable => ({ scrollLeft: 0, scrollTop: 0, ...box })

test('a move that zeroes the scroller is undone by restore', () => {
  const memory = new ScrollMemory<Scrollable>()
  const timeline = scroller()
  timeline.scrollLeft = 5000
  timeline.scrollTop = 274
  memory.record(timeline)

  // The move: Chromium's reset.
  timeline.scrollLeft = 0
  timeline.scrollTop = 0
  memory.restore(() => true)
  assert.deepEqual([timeline.scrollLeft, timeline.scrollTop], [5000, 274])
})

test('a clamp to 0 while the scroller has no box (parked, or a page gives it no height) is not believed', () => {
  const memory = new ScrollMemory<Scrollable>()
  const timeline = scroller()
  timeline.scrollLeft = 5000
  timeline.scrollTop = 274
  memory.record(timeline)

  // On a page where the region has no height: the offset clamps and a scroll event reports it.
  timeline.clientHeight = 0
  timeline.scrollTop = 0
  memory.record(timeline)

  // Back on a page that shows it, after the move reset it.
  timeline.clientHeight = 200
  timeline.scrollLeft = 0
  memory.restore(() => true)
  assert.deepEqual([timeline.scrollLeft, timeline.scrollTop], [5000, 274])
})

test('scrolling back to the start with a box is believed: the start is restored, not the old place', () => {
  const memory = new ScrollMemory<Scrollable>()
  const timeline = scroller()
  timeline.scrollLeft = 5000
  memory.record(timeline)
  timeline.scrollLeft = 0
  memory.record(timeline)
  timeline.scrollLeft = 17 // anything the move left behind that is not the user's
  memory.restore(() => true)
  assert.equal(timeline.scrollLeft, 17, 'nothing remembered, so nothing is written')
})

/** A scroller that clamps like the real one: `maxTop` is scrollHeight − clientHeight. */
function clamping(maxTop: number): Scrollable & { maxTop: number } {
  let top = 0
  return {
    scrollLeft: 0,
    clientWidth: 800,
    clientHeight: 200,
    maxTop,
    get scrollTop() {
      return top
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(value, this.maxTop))
    }
  }
}

test("the clamp a restore meets on a shorter-scrolling page is not taken for the user's scroll", () => {
  const memory = new ScrollMemory<Scrollable>()
  const timeline = clamping(274)
  timeline.scrollTop = 274
  memory.record(timeline)

  // Audio: a taller timeline, so less to scroll. The move resets; restore clamps to 107, and
  // the scroll event that follows reports 107.
  timeline.maxTop = 107
  timeline.scrollTop = 0
  memory.restore(() => true)
  assert.equal(timeline.scrollTop, 107)
  memory.record(timeline)

  // Back on Edit: 274 again, not 107.
  timeline.maxTop = 274
  timeline.scrollTop = 0
  memory.restore(() => true)
  assert.equal(timeline.scrollTop, 274)
})

test('a real scroll after a restore is believed', () => {
  const memory = new ScrollMemory<Scrollable>()
  const timeline = clamping(274)
  timeline.scrollTop = 274
  memory.record(timeline)
  memory.restore(() => true)
  memory.record(timeline) // the restore's own event
  timeline.scrollTop = 40 // the user
  memory.record(timeline)
  timeline.scrollTop = 0
  memory.restore(() => true)
  assert.equal(timeline.scrollTop, 40)
})

test('a scroller no longer inside the node is forgotten, not written to', () => {
  const memory = new ScrollMemory<Scrollable>()
  const gone = scroller()
  gone.scrollLeft = 300
  memory.record(gone)
  gone.scrollLeft = 0
  memory.restore(() => false)
  assert.equal(gone.scrollLeft, 0)
  memory.restore(() => true)
  assert.equal(gone.scrollLeft, 0, 'forgotten on the first restore that did not find it')
})
