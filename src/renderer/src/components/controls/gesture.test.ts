import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGestureBracket, WHEEL_GESTURE_IDLE_MS, type Gesture } from './gesture'

function recorder(): { gesture: Gesture; log: string[] } {
  const log: string[] = []
  return { gesture: { begin: () => log.push('begin'), end: () => log.push('end') }, log }
}

/** A clock the test advances by hand. */
function fakeTimers(): {
  timers: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void }
  advance(ms: number): void
} {
  let now = 0
  let next = 1
  const pending = new Map<number, { at: number; run: () => void }>()
  return {
    timers: {
      set(run, ms) {
        const id = next++
        pending.set(id, { at: now + ms, run })
        return id
      },
      clear(handle) {
        pending.delete(handle as number)
      }
    },
    advance(ms) {
      now += ms
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id)
          timer.run()
        }
      }
    }
  }
}

test('a drag opens the gesture once and closes it once, however many moves it makes', () => {
  const { gesture, log } = recorder()
  const bracket = createGestureBracket(() => gesture)
  for (let i = 0; i < 50; i += 1) bracket.begin()
  bracket.end()
  bracket.end()
  assert.deepEqual(log, ['begin', 'end'])
})

test('an end with nothing open does not close the store’s gesture', () => {
  // `endGesture` on a depth-0 store is harmless today, but a stray end inside someone else's
  // open gesture would close theirs early and split one edit into two undo steps.
  const { gesture, log } = recorder()
  const bracket = createGestureBracket(() => gesture)
  bracket.end()
  assert.deepEqual(log, [])
})

test('unmounting mid-drag closes the gesture, so history is not left grouping every later edit', () => {
  const { gesture, log } = recorder()
  const bracket = createGestureBracket(() => gesture)
  bracket.begin()
  bracket.dispose()
  assert.deepEqual(log, ['begin', 'end'])
})

test('a run of wheel notches is one gesture that closes after the wheel rests', () => {
  const { gesture, log } = recorder()
  const clock = fakeTimers()
  const bracket = createGestureBracket(() => gesture, clock.timers)
  bracket.touch()
  clock.advance(WHEEL_GESTURE_IDLE_MS - 50)
  bracket.touch()
  clock.advance(WHEEL_GESTURE_IDLE_MS - 50)
  bracket.touch()
  // Still open: every notch arrived inside the idle window of the one before.
  assert.deepEqual(log, ['begin'])
  clock.advance(WHEEL_GESTURE_IDLE_MS)
  assert.deepEqual(log, ['begin', 'end'])
  // The next notch is a new gesture — a new undo step.
  bracket.touch()
  clock.advance(WHEEL_GESTURE_IDLE_MS)
  assert.deepEqual(log, ['begin', 'end', 'begin', 'end'])
})
