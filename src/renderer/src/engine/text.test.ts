/**
 * Tests for text layout.
 *
 * The whole module takes an injected `measure`, so all of this runs without a canvas. The fake
 * used here is deliberately simple and stated: every glyph is `0.5 * fontSize` wide. That is
 * not a real font, and it does not need to be — what is under test is the wrapping, the
 * shrink order and the anchor arithmetic, none of which depend on the metric being realistic.
 * A test that needed real metrics would be testing Chromium.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultTextStyle } from '@shared/project'
import { wrapLines, layoutText, anchorFor, fontIsAvailable, MIN_FONT_SIZE } from './text'

/** Every glyph half the font size wide. Monospace, which makes expected widths arithmetic. */
const measure = (text: string, fontSize: number): number => text.length * fontSize * 0.5

const box = (width: number, height: number, left = 0, top = 0): {
  left: number
  top: number
  width: number
  height: number
} => ({ left, top, width, height })

// -- wrapping ---------------------------------------------------------------

test('a line that fits is not wrapped', () => {
  assert.deepEqual(wrapLines('hello world', 200, 10, measure), ['hello world'])
})

test('a line too long is broken at a space', () => {
  // 'hello world' at 10px is 55px; a 40px box takes 'hello' (25) but not 'hello world'.
  assert.deepEqual(wrapLines('hello world', 40, 10, measure), ['hello', 'world'])
})

test('explicit newlines are hard breaks and survive wrapping', () => {
  // Someone who typed two lines meant two lines, even when both would fit on one.
  assert.deepEqual(wrapLines('one\ntwo', 1000, 10, measure), ['one', 'two'])
})

test('a blank line is preserved rather than collapsed', () => {
  assert.deepEqual(wrapLines('a\n\nb', 1000, 10, measure), ['a', '', 'b'])
})

test('a single word longer than the box is not broken mid-word', () => {
  // Hyphenating at an arbitrary column reads as a rendering fault. Overflow reads as
  // overflow, and the shrink pass is what deals with it.
  assert.deepEqual(wrapLines('extraordinary', 20, 10, measure), ['extraordinary'])
})

test('runs of whitespace do not produce empty words', () => {
  assert.deepEqual(wrapLines('a    b', 1000, 10, measure), ['a b'])
})

// -- fitting ----------------------------------------------------------------

test('text that fits keeps the size it asked for', () => {
  const style = { ...defaultTextStyle(20), lineHeight: 1 }
  const laid = layoutText('hi', style, box(1000, 1000), measure)
  assert.equal(laid.fontSize, 20)
  assert.equal(laid.scale, 1)
  assert.equal(laid.clipped, false)
  assert.equal(laid.lines.length, 1)
})

test('wrapping is tried before shrinking', () => {
  // The rule that matters: this text fits on two lines at full size, so it must come back at
  // full size on two lines — not as one shrunken line. Box is 60 wide by 100 tall; at 20px
  // 'hello world' is 110 wide, 'hello' is 50, and two 20px lines are 40 tall.
  const style = { ...defaultTextStyle(20), lineHeight: 1 }
  const laid = layoutText('hello world', style, box(60, 100), measure)
  assert.equal(laid.scale, 1, 'no shrink was needed')
  assert.deepEqual(laid.lines, ['hello', 'world'])
})

test('shrinking happens only when wrapping cannot make it fit', () => {
  // One unbreakable word, 13 glyphs. At 20px it is 130 wide; the box is 40. No wrap can help,
  // so it shrinks: 13 * size * 0.5 <= 40 gives size 6, below the floor of 8.
  const style = { ...defaultTextStyle(20), lineHeight: 1 }
  const laid = layoutText('extraordinary', style, box(40, 500), measure)
  assert.ok(laid.scale < 1, 'it had to shrink')
  assert.equal(laid.lines.length, 1)
})

test('height drives a shrink as well as width', () => {
  // Three hard lines at 20px with lineHeight 1 need 60px of height; the box has 30.
  const style = { ...defaultTextStyle(20), lineHeight: 1 }
  const laid = layoutText('a\nb\nc', style, box(1000, 30), measure)
  assert.equal(laid.lines.length, 3)
  assert.ok(laid.fontSize <= 10, `three lines in 30px means <=10px each, got ${laid.fontSize}`)
  assert.ok(laid.blockHeight <= 30)
})

test('text that cannot fit even at the floor is reported clipped, not shrunk further', () => {
  // 13 glyphs at the 8px floor is 52px wide; the box is 10. Nothing fits.
  const style = { ...defaultTextStyle(20), lineHeight: 1 }
  const laid = layoutText('extraordinary', style, box(10, 500), measure)
  assert.equal(laid.clipped, true)
  assert.equal(laid.fontSize, MIN_FONT_SIZE, 'it stops at the floor rather than going smaller')
})

test('scale is the ratio actually drawn to the size requested', () => {
  const style = { ...defaultTextStyle(100), lineHeight: 1 }
  const laid = layoutText('extraordinary', style, box(10, 500), measure)
  assert.equal(laid.fontSize, MIN_FONT_SIZE)
  assert.equal(laid.scale, MIN_FONT_SIZE / 100)
})

test('lineHeight scales the block, not the glyphs', () => {
  const tight = layoutText('a\nb', { ...defaultTextStyle(20), lineHeight: 1 }, box(1000, 1000), measure)
  const loose = layoutText('a\nb', { ...defaultTextStyle(20), lineHeight: 2 }, box(1000, 1000), measure)
  assert.equal(tight.fontSize, loose.fontSize, 'the type is the same size')
  assert.equal(loose.blockHeight, tight.blockHeight * 2, 'the block is twice as tall')
})

test('a zero or negative lineHeight falls back rather than collapsing the block', () => {
  const laid = layoutText('a\nb', { ...defaultTextStyle(20), lineHeight: 0 }, box(1000, 1000), measure)
  assert.ok(laid.blockHeight > 0, 'a zero line height would stack every line on one baseline')
})

test('a degenerate box does not throw and still reports something drawable', () => {
  const style = { ...defaultTextStyle(20), lineHeight: 1 }
  for (const b of [box(0, 0), box(-5, -5), box(1, 1)]) {
    const laid = layoutText('hello', style, b, measure)
    assert.ok(laid.fontSize >= MIN_FONT_SIZE)
    assert.ok(laid.lines.length >= 1)
  }
})

// -- anchoring --------------------------------------------------------------

test('horizontal alignment picks the x the canvas textAlign expects', () => {
  const laid = { blockHeight: 20, lineHeight: 20 }
  const b = box(100, 100, 10, 10)
  assert.deepEqual(anchorFor(b, laid, 'left', 'top'), { x: 10, firstBaseline: 30, textAlign: 'left' })
  assert.deepEqual(anchorFor(b, laid, 'right', 'top'), { x: 110, firstBaseline: 30, textAlign: 'right' })
  assert.deepEqual(anchorFor(b, laid, 'center', 'top'), { x: 60, firstBaseline: 30, textAlign: 'center' })
})

test('vertical alignment positions the block, and the baseline is one line down from its top', () => {
  // The off-by-one-line trap: `fillText` takes a baseline, not a box top, so a block anchored
  // at the top of its box must have its first baseline one line-height lower.
  const laid = { blockHeight: 40, lineHeight: 20 }
  const b = box(100, 100, 0, 0)
  assert.equal(anchorFor(b, laid, 'center', 'top').firstBaseline, 20)
  // block is 40 tall in a 100 box, so its top is at 30 and the first baseline 20 lower
  assert.equal(anchorFor(b, laid, 'center', 'middle').firstBaseline, 50)
  assert.equal(anchorFor(b, laid, 'center', 'bottom').firstBaseline, 80)
})

test('a block taller than its box still anchors predictably', () => {
  const laid = { blockHeight: 200, lineHeight: 20 }
  const b = box(100, 100, 0, 0)
  assert.equal(anchorFor(b, laid, 'center', 'top').firstBaseline, 20)
  assert.equal(anchorFor(b, laid, 'center', 'bottom').firstBaseline, -80, 'overflows upward, not silently clamped')
})

// -- font availability ------------------------------------------------------

test('a family that measures differently from the fallback is available', () => {
  const widths: Record<string, number> = { 'Helvetica, __bay_no_such_family__': 100, __bay_no_such_family__: 120 }
  assert.equal(fontIsAvailable('Helvetica', (f) => widths[f] ?? 0), true)
})

test('a family that measures identically to the fallback is not available', () => {
  // Both requests resolved to the same substitute, which is exactly what a missing font looks
  // like — and it is invisible in the picture, which is why it is reported at all.
  assert.equal(fontIsAvailable('Futura', () => 120), false)
})
