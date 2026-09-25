import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFrameLevels } from './frameLevels'

/** An engine with `tracks` tracks that counts how often every analyser is walked. */
function engine(tracks: number) {
  let reads = 0
  return {
    get reads() {
      return reads
    },
    levels() {
      reads += 1
      return Object.fromEntries(Array.from({ length: tracks }, (_, i) => [`trk_${i}`, { peak: i / tracks, rms: 0 }]))
    }
  }
}

test('N strips drawing in one frame read the levels once, not N times', () => {
  const read = createFrameLevels<{ peak: number; rms: number }>()
  const source = engine(8)
  for (let strip = 0; strip < 8; strip += 1) {
    const levels = read(source, 1000)
    assert.equal(levels[`trk_${strip}`]?.peak, strip / 8, 'each strip still gets its own track')
  }
  assert.equal(source.reads, 1)
})

test('the next frame reads again, and so does another engine in the same frame', () => {
  const read = createFrameLevels<{ peak: number; rms: number }>()
  const a = engine(2)
  const b = engine(2)
  read(a, 1000)
  read(a, 1016.7)
  assert.equal(a.reads, 2, 'a new frame is a new read')
  read(b, 1016.7)
  assert.equal(b.reads, 1, 'an engine swapped mid-frame is not answered from the old one')
})
