import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridFrames, gridLayout, LABEL_HEIGHT, MAX_GRID_CELLS, MAX_GRID_EDGE, spokenAround } from './frame-grid'
import type { TranscriptSegment } from './transcribe'

test('gridFrames takes the middle of equal slices, never the range ends', () => {
  // 0..119 in 12 slices of 10: the middles are 5, 15, … 115.
  assert.deepEqual(gridFrames(0, 119, 12), [5, 15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115])
  const frames = gridFrames(300, 450, 6)
  assert.ok(frames.every((f) => f > 300 && f < 450), frames.join(','))
  // Reversed bounds are the same range.
  assert.deepEqual(gridFrames(450, 300, 6), frames)
})

test('gridFrames gives one cell per frame for a short range, and caps the count', () => {
  assert.deepEqual(gridFrames(10, 13, 12), [10, 11, 12, 13])
  assert.deepEqual(gridFrames(7, 7, 12), [7])
  assert.equal(gridFrames(0, 10_000, 500).length, MAX_GRID_CELLS)
  const many = gridFrames(0, 10_000, 36)
  assert.equal(new Set(many).size, many.length, 'distinct')
  assert.deepEqual([...many].sort((a, b) => a - b), many, 'ascending')
})

test('gridLayout stays inside the edge bound on both sides, for landscape and portrait', () => {
  for (const aspect of [16 / 9, 9 / 16, 1, 21 / 9, 4 / 5]) {
    for (const cells of [1, 2, 5, 12, 20, 36]) {
      const g = gridLayout(cells, aspect)
      assert.ok(g.width <= MAX_GRID_EDGE && g.height <= MAX_GRID_EDGE, `${cells} @ ${aspect.toFixed(2)}: ${g.width}×${g.height}`)
      assert.ok(g.columns * g.rows >= cells)
      assert.equal(g.height, g.rows * (g.cellHeight + LABEL_HEIGHT))
      // No wasted row.
      assert.ok(g.columns * (g.rows - 1) < cells)
    }
  }
})

test('gridLayout lays twelve landscape frames out as a grid, not a strip', () => {
  const g = gridLayout(12, 16 / 9)
  assert.ok(g.columns >= 3 && g.columns <= 4, `columns ${g.columns}`)
  // Portrait frames want more columns for the same overall shape.
  assert.ok(gridLayout(12, 9 / 16).columns > g.columns)
  // Cells are big enough to see a face in.
  assert.ok(g.cellWidth >= 320, `cell ${g.cellWidth}`)
})

const WORDS: TranscriptSegment[] = [
  {
    startSeconds: 0,
    endSeconds: 3,
    text: ' the quick brown fox',
    words: [
      { startSeconds: 0, endSeconds: 0.5, text: 'the' },
      { startSeconds: 0.5, endSeconds: 1.2, text: 'quick' },
      { startSeconds: 1.2, endSeconds: 2, text: 'brown' },
      { startSeconds: 2, endSeconds: 3, text: 'fox' }
    ]
  },
  { startSeconds: 5, endSeconds: 8, text: ' jumps over the lazy dog' }
]

test('spokenAround reads word times when there are some', () => {
  assert.equal(spokenAround(WORDS, 1.5, 0.2), 'brown')
  assert.equal(spokenAround(WORDS, 1.2, 0.4), 'quick brown')
  // Nothing said at 4s.
  assert.equal(spokenAround(WORDS, 4, 0.5), '')
})

test('spokenAround falls back to the whole line holding the moment, trimmed around the middle', () => {
  assert.equal(spokenAround(WORDS, 6, 0.5), 'jumps over the lazy dog')
  assert.equal(spokenAround(WORDS, 6, 0.5, 3), '…over the lazy…')
  // A line near the window but not holding the moment is not the words at it.
  assert.equal(spokenAround(WORDS, 4.8, 0.5), '')
})
