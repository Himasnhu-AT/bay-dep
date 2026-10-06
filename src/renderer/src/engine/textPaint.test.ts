/**
 * The title painter: what it plans, and what it then asks the canvas to do.
 *
 * `planText` is arithmetic over an injected `measure` — the same stated fake as `text.test.ts`,
 * every glyph half the font size wide — so the plates, the runs and the paint's reach are checked
 * as numbers. `paintText` is checked against a recording context: not what Chromium rasterises,
 * which only a running app can show (`test/app/text-style.mjs`), but the calls it receives, in
 * order, with the state each was made under. That is the level at which the three faults this
 * guards live: a shadow drawn with the fill, a narrow outline drawn before the wide one, and a
 * word painted that the animation says is not there yet.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/renderer/src/engine/textPaint.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultTextStyle, type Item, type TextStyle } from '@shared/project'
import { textUnitsAt } from '@shared/animation'
import { anchorFor, layoutText, type LaidOutText, type TextBox } from './text'
import { DESCENDER, gradientGeometry, paintOverflow, paintText, planText, unitTransform, type TextPlan } from './textPaint'

const SIZE = 40
/** Every glyph half the font size wide. */
const measureAt = (text: string, fontSize: number): number => text.length * fontSize * 0.5
const measure = (text: string): number => measureAt(text, SIZE)

const BOX: TextBox = { left: 100, top: 50, width: 800, height: 400 }

function setup(text: string, over: Partial<TextStyle> = {}, box: TextBox = BOX): { laid: LaidOutText; anchor: ReturnType<typeof anchorFor>; style: TextStyle } {
  const style: TextStyle = { ...defaultTextStyle(SIZE), lineHeight: 1.5, ...over }
  const laid = layoutText(text, style, box, measureAt)
  assert.equal(laid.fontSize, SIZE, 'the specimen must fit at the size asked, or the widths below are wrong')
  return { laid, anchor: anchorFor(box, laid, style.align, style.verticalAlign), style }
}

// -- a recording canvas -------------------------------------------------------------------------

interface Call {
  op: string
  args: unknown[]
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineJoin: string
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  globalAlpha: number
  textAlign: string
  filter: string
  /** The translation in effect, summed over the save stack. */
  tx: number
  ty: number
  clips: number
}

function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = []
  const state = {
    fillStyle: '#000000' as unknown,
    strokeStyle: '#000000' as unknown,
    lineWidth: 1,
    lineJoin: 'miter',
    miterLimit: 10,
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    textAlign: 'start',
    filter: 'none',
    tx: 0,
    ty: 0,
    clips: 0
  }
  const stack: (typeof state)[] = []
  const record = (op: string, args: unknown[]): void => {
    const { miterLimit: _limit, ...rest } = state
    calls.push({ op, args, ...rest })
  }
  const ctx = {
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop()),
    beginPath: () => record('beginPath', []),
    rect: (...args: number[]) => record('rect', args),
    roundRect: (...args: number[]) => record('roundRect', args),
    fill: () => record('fill', []),
    clip: () => {
      state.clips += 1
      record('clip', [])
    },
    translate: (x: number, y: number) => {
      state.tx += x
      state.ty += y
    },
    rotate: (angle: number) => record('rotate', [angle]),
    scale: (x: number, y: number) => record('scale', [x, y]),
    fillText: (...args: unknown[]) => record('fillText', args),
    strokeText: (...args: unknown[]) => record('strokeText', args),
    createLinearGradient: (...args: number[]) => ({ kind: 'linear', args, stops: [] as unknown[], addColorStop(at: number, color: string) { this.stops.push([at, color]) } }),
    createRadialGradient: (...args: number[]) => ({ kind: 'radial', args, stops: [] as unknown[], addColorStop(at: number, color: string) { this.stops.push([at, color]) } })
  }
  for (const key of Object.keys(state) as (keyof typeof state)[]) {
    if (key === 'tx' || key === 'ty' || key === 'clips') continue
    Object.defineProperty(ctx, key, { get: () => state[key], set: (value: never) => { state[key] = value }, enumerable: true })
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const glyphs = (calls: Call[]): Call[] => calls.filter((call) => call.op === 'fillText' || call.op === 'strokeText')

// -- the plan -----------------------------------------------------------------------------------

test('a title with no animation in play is planned as whole lines, at the x and alignment it always had', () => {
  const { laid, anchor, style } = setup('hello world\nbye')
  const plan = planText(laid, anchor, style, measure)
  assert.deepEqual(plan.runs.map((run) => [run.text, run.x, run.align, run.baseline]), [
    ['hello world', anchor.x, 'center', anchor.firstBaseline],
    ['bye', anchor.x, 'center', anchor.firstBaseline + laid.lineHeight]
  ])
  // 'hello world' is 11 glyphs of 20px; centred in a box whose middle is x = 500.
  assert.deepEqual(plan.block, { left: 500 - 110, top: anchor.firstBaseline - 60, width: 220, height: 120 })
  assert.deepEqual(plan.plates, [])
  assert.deepEqual(plan.painted, plan.block, 'no paint beyond the letters')
})

test('the plate is the block it always was: the widest line plus padding, from one line above the first baseline', () => {
  for (const align of ['left', 'center', 'right'] as const) {
    const { laid, anchor, style } = setup('hello world\nbye', { align, background: { color: '#000000', padding: 24, radius: 300 } })
    const [plate, ...rest] = planText(laid, anchor, style, measure).plates
    assert.equal(rest.length, 0)
    const width = 220 + 48
    // Spelled as the three cases the single-plate code had, not as the planner's own formula.
    const left = align === 'left' ? anchor.x - 24 : align === 'right' ? anchor.x - width + 24 : anchor.x - width / 2
    assert.deepEqual({ left: plate!.left, top: plate!.top, width: plate!.width, height: plate!.height }, { left, top: anchor.firstBaseline - laid.lineHeight - 24, width, height: laid.blockHeight + 48 })
    assert.equal(plate!.radius, (laid.blockHeight + 48) / 2, 'a radius larger than the plate is held to a pill')
  }
})

test('a plate per line is one bar per line of words, each as wide as its own, and none for a blank line', () => {
  const { laid, anchor, style } = setup('hello world\n\nbye', { background: { color: '#000000', padding: 10, radius: 4 }, plate: { perLine: true, paddingX: 16, paddingY: 2 } })
  const plates = planText(laid, anchor, style, measure).plates
  assert.equal(plates.length, 2)
  assert.deepEqual(plates.map((plate) => plate.width), [220 + 32, 60 + 32])
  assert.deepEqual(plates.map((plate) => plate.left), [500 - 110 - 16, 500 - 30 - 16])
  assert.deepEqual(plates.map((plate) => plate.top), [anchor.firstBaseline - 60 - 2, anchor.firstBaseline + 2 * 60 - 60 - 2])
  assert.ok(plates.every((plate) => plate.height === 60 + 4))
})

test('by word, each word is a run placed where the whole line would have put it, counted across lines', () => {
  const { laid, anchor, style } = setup('one two\nthree', { align: 'left' })
  const plan = planText(laid, anchor, style, measure, 'word')
  assert.deepEqual(plan.runs.map((run) => [run.text, run.left, run.align]), [
    ['one', 100, 'left'],
    // After 'one ' — four glyphs of 20px.
    ['two', 180, 'left'],
    ['three', 100, 'left']
  ])
  assert.deepEqual(plan.runs.map((run) => [run.position.word, run.position.words, run.position.line, run.position.lines]), [[0, 3, 0, 2], [1, 3, 0, 2], [2, 3, 1, 2]])
  // A word knows which letter it starts on, so a letter-counted preset can still place it.
  assert.deepEqual(plan.runs.map((run) => run.position.letter), [0, 3, 6])
  assert.equal(plan.runs[0]!.position.letters, 11)
})

test('by letter, spaces are not letters and each letter sits after the text before it', () => {
  const { laid, anchor, style } = setup('ab c', { align: 'right' })
  const plan = planText(laid, anchor, style, measure, 'letter')
  const lineLeft = 900 - 80
  assert.deepEqual(plan.runs.map((run) => [run.text, run.left]), [['a', lineLeft], ['b', lineLeft + 20], ['c', lineLeft + 60]])
  assert.deepEqual(plan.runs.map((run) => [run.position.letter, run.position.letters, run.position.word]), [[0, 3, 0], [1, 3, 0], [2, 3, 1]])
})

test('the paint reaches past the letters by the outline and shadow, and the report says how far it leaves the box', () => {
  // A line that exactly fills the box's width, top-aligned: any paint at all crosses three sides.
  const box: TextBox = { left: 0, top: 0, width: 200, height: 60 }
  const plain = setup('0123456789', { verticalAlign: 'top' }, box)
  assert.equal(paintOverflow(planText(plain.laid, plain.anchor, plain.style, measure).painted, box), null)
  const heavy = setup('0123456789', { verticalAlign: 'top', stroke: { color: '#000000', width: 20 }, shadow: { color: '#000000', blur: 6, offsetX: 0, offsetY: 10 } }, box)
  const plan = planText(heavy.laid, heavy.anchor, heavy.style, measure)
  assert.deepEqual(plan.extents, { left: 16, top: 10, right: 16, bottom: 26 })
  assert.deepEqual(paintOverflow(plan.painted, box), { left: 16, top: 10, right: 16, bottom: 26 })
  // The same paint on the same words in a box with room is not reported.
  const roomy = setup('0123456789', { stroke: { color: '#000000', width: 20 }, shadow: { color: '#000000', blur: 6, offsetX: 0, offsetY: 10 } })
  assert.equal(paintOverflow(planText(roomy.laid, roomy.anchor, roomy.style, measure).painted, BOX), null)
  // A plate counts too.
  const plated = setup('0123456789', { verticalAlign: 'top', background: { color: '#000000', padding: 8, radius: 0 } }, box)
  assert.deepEqual(paintOverflow(planText(plated.laid, plated.anchor, plated.style, measure).painted, box), { left: 8, top: 8, right: 8, bottom: 8 })
})

test('a gradient runs across the whole block: left to right at 0°, top to bottom at 90°, corner to corner between', () => {
  const block: TextBox = { left: 100, top: 200, width: 400, height: 100 }
  const stops = [{ at: 0, color: '#FFFFFF' }, { at: 1, color: '#000000' }]
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9
  const flat = gradientGeometry({ kind: 'linear', angle: 0, stops }, block)
  assert.ok(flat.kind === 'linear' && near(flat.x0, 100) && near(flat.x1, 500) && near(flat.y0, 250) && near(flat.y1, 250))
  const down = gradientGeometry({ kind: 'linear', angle: 90, stops }, block)
  assert.ok(down.kind === 'linear' && near(down.y0, 200) && near(down.y1, 300) && near(down.x0, 300) && near(down.x1, 300))
  const reversed = gradientGeometry({ kind: 'linear', angle: 180, stops }, block)
  assert.ok(reversed.kind === 'linear' && near(reversed.x0, 500) && near(reversed.x1, 100))
  assert.deepEqual(gradientGeometry({ kind: 'radial', stops }, block), { kind: 'radial', cx: 300, cy: 250, r: Math.hypot(400, 100) / 2 })
  assert.deepEqual(gradientGeometry({ kind: 'radial', stops, centerX: 0, centerY: 1, radius: 0.5 }, block), { kind: 'radial', cx: 100, cy: 300, r: Math.hypot(400, 100) / 4 })
})

// -- the painting -------------------------------------------------------------------------------

function paint(text: string, over: Partial<TextStyle>, shadowScale = 1): { calls: Call[]; plan: TextPlan; anchor: ReturnType<typeof anchorFor>; laid: LaidOutText } {
  const { laid, anchor, style } = setup(text, over)
  const plan = planText(laid, anchor, style, measure)
  const { ctx, calls } = recorder()
  paintText(ctx, plan, shadowScale, null)
  return { calls, plan, anchor, laid }
}

test('a plain title is one fillText per line, in its colour, with no shadow — what it always was', () => {
  const { calls, anchor, laid } = paint('hello\nbye', { color: '#ABCDEF' })
  assert.deepEqual(calls.map((call) => [call.op, ...call.args]), [
    ['fillText', 'hello', anchor.x, anchor.firstBaseline],
    ['fillText', 'bye', anchor.x, anchor.firstBaseline + laid.lineHeight]
  ])
  assert.ok(calls.every((call) => call.fillStyle === '#ABCDEF' && call.textAlign === 'center' && call.shadowColor === 'transparent'))
})

test('order: the plate, then the shadow, then the outline, then the fill — and the final fill casts no shadow', () => {
  const { calls } = paint('hello', {
    color: '#FFFFFF',
    stroke: { color: '#111111', width: 8 },
    shadow: { color: '#000000', blur: 12, offsetX: 3, offsetY: 5 },
    background: { color: '#222222', padding: 10, radius: 4 }
  })
  const order = calls.filter((call) => call.op === 'fill' || call.op === 'fillText' || call.op === 'strokeText')
  assert.equal(order[0]!.op, 'fill')
  assert.equal(order[0]!.fillStyle, '#222222')
  assert.equal(order[0]!.shadowColor, 'transparent', 'the plate casts no shadow')
  const casting = order.filter((call) => call.shadowColor === '#000000')
  assert.ok(casting.length >= 1, 'something is drawn with the shadow on')
  assert.ok(casting.every((call) => call.shadowBlur === 12 && call.shadowOffsetX === 3 && call.shadowOffsetY === 5))
  const lastCasting = order.lastIndexOf(casting[casting.length - 1]!)
  const after = order.slice(lastCasting + 1)
  assert.deepEqual(after.map((call) => call.op), ['strokeText', 'fillText'], 'the real outline and fill come after every shadow')
  assert.ok(after.every((call) => call.shadowColor === 'transparent'))
  assert.equal(after[0]!.strokeStyle, '#111111')
  assert.equal(after[0]!.lineWidth, 8)
  assert.equal(after[0]!.lineJoin, 'round')
  assert.equal(after[1]!.fillStyle, '#FFFFFF')
})

test('a shadow with no outline is still cast — by the letters themselves', () => {
  const { calls } = paint('hello', { shadow: { color: '#102030', blur: 8, offsetX: 0, offsetY: 4 } })
  const casting = glyphs(calls).filter((call) => call.shadowColor === '#102030')
  assert.deepEqual(casting.map((call) => call.op), ['fillText'])
  // And with no shadow in the style, nothing is ever drawn with one on.
  assert.ok(glyphs(paint('hello', {}).calls).every((call) => call.shadowColor === 'transparent'))
})

test('outlines are drawn widest first, so each narrower one lands on top of the last', () => {
  const { calls } = paint('hello', { stroke: { color: '#111111', width: 10 }, strokes: [{ color: '#FFFFFF', width: 8 }, { color: '#FF0000', width: 4, join: 'bevel' }] })
  const strokes = calls.filter((call) => call.op === 'strokeText')
  assert.deepEqual(strokes.map((call) => [call.strokeStyle, call.lineWidth, call.lineJoin]), [['#FF0000', 22, 'bevel'], ['#FFFFFF', 18, 'round'], ['#111111', 10, 'round']])
  assert.ok(calls.indexOf(strokes[2]!) < calls.findIndex((call) => call.op === 'fillText'), 'and the fill covers the inner half of the innermost')
})

test('fills are painted bottom to top, an offset one moved by its offset and a faint one by its opacity', () => {
  const { calls, plan } = paint('hello', {
    fills: [
      { kind: 'solid', color: '#000000', offsetX: 6, offsetY: 8 },
      { kind: 'linear', angle: 90, stops: [{ at: 0, color: '#FFD36E' }, { at: 1, color: '#7A5CFF' }], opacity: 0.5 }
    ]
  })
  const fills = calls.filter((call) => call.op === 'fillText')
  assert.equal(fills.length, 2)
  assert.deepEqual([fills[0]!.fillStyle, fills[0]!.tx, fills[0]!.ty, fills[0]!.globalAlpha], ['#000000', 6, 8, 1])
  const gradient = fills[1]!.fillStyle as { kind: string; args: number[]; stops: unknown[] }
  assert.equal(gradient.kind, 'linear')
  assert.deepEqual(gradient.stops, [[0, '#FFD36E'], [1, '#7A5CFF']])
  // Down the block: from its top edge to its bottom edge.
  assert.ok(Math.abs(gradient.args[1]! - plan.block.top) < 1e-9 && Math.abs(gradient.args[3]! - (plan.block.top + plan.block.height)) < 1e-9)
  assert.deepEqual([fills[1]!.tx, fills[1]!.ty, fills[1]!.globalAlpha], [0, 0, 0.5])
})

test('a hollow title strokes and never fills', () => {
  const { calls } = paint('hello', { fills: [], stroke: { color: '#FFFFFF', width: 4 } })
  assert.deepEqual(glyphs(calls).map((call) => call.op), ['strokeText'])
})

test('shadows are scaled to the device and the clip\'s zoom, because the canvas does not', () => {
  const style = { shadow: { color: '#000000', blur: 12, offsetX: 3, offsetY: 5 } }
  const half = glyphs(paint('hello', style, 0.5).calls).find((call) => call.shadowColor === '#000000')!
  assert.deepEqual([half.shadowBlur, half.shadowOffsetX, half.shadowOffsetY], [6, 1.5, 2.5])
  const full = glyphs(paint('hello', style, 1).calls).find((call) => call.shadowColor === '#000000')!
  assert.deepEqual([full.shadowBlur, full.shadowOffsetX, full.shadowOffsetY], [12, 3, 5])
})

// -- animation by unit: which glyph boxes are painted at a frame -------------------------------------

function titleItem(animation: Item['animation']): Item {
  return {
    id: 'itm',
    assetId: 'ast',
    trackId: 'trk',
    from: 0,
    durationInFrames: 100,
    sourceStartUs: 0,
    layout: { left: BOX.left, top: BOX.top, width: BOX.width, height: BOX.height, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    text: defaultTextStyle(SIZE),
    animation
  }
}

function paintedAt(text: string, item: Item, frame: number): Call[] {
  const { laid, anchor, style } = setup(text, { align: 'left' })
  const units = textUnitsAt(item, frame)
  const { ctx, calls } = recorder()
  paintText(ctx, planText(laid, anchor, style, measure, units?.by ?? null), 1, units)
  return calls
}

test('typewriter: only the letters typed so far are painted, and after the window the whole line is one call again', () => {
  const item = titleItem({ in: { kind: 'typewriter', frames: 10 } })
  const typed = (frame: number): string => glyphs(paintedAt('hey you', item, frame)).map((call) => String(call.args[0])).join('|')
  assert.equal(typed(0), '')
  assert.equal(typed(2), 'h', 'six letters over ten frames: one by the third frame')
  assert.equal(typed(5), 'h|e|y')
  assert.equal(typed(9), 'h|e|y|y|o')
  assert.equal(typed(10), 'hey you', 'the window is over: drawn as the line it is')
})

test('word by word: the first word is on screen and at full strength while the last is still to come', () => {
  const item = titleItem({ in: { kind: 'fade', frames: 20, by: 'word' } })
  const at = (frame: number): Record<string, number> =>
    Object.fromEntries(glyphs(paintedAt('one two three four', item, frame)).map((call) => [String(call.args[0]), call.globalAlpha]))
  assert.deepEqual(Object.keys(at(0)), [], 'nothing at the head')
  const mid = at(8)
  assert.ok(mid.one! > 0.9, `the first word has arrived, got ${mid.one}`)
  assert.ok(mid.four === undefined, 'the last word is not painted at all yet')
  assert.ok(mid.two! > (mid.three ?? 0), 'and the ones between are in order')
  // Each word is placed where the line would have put it: 'two' after 'one ' (4 glyphs of 20px).
  const two = glyphs(paintedAt('one two three four', item, 8)).find((call) => call.args[0] === 'two')!
  assert.equal(two.args[1], BOX.left + 80)
})

test('a rise by line draws each line under a mask over its own line, travelling up from below it', () => {
  const item = titleItem({ in: { kind: 'rise', frames: 20, by: 'line' } })
  const calls = paintedAt('first\nsecond', item, 4)
  const lines = glyphs(calls)
  assert.ok(lines.length >= 1)
  for (const line of lines) {
    assert.equal(line.clips, 1, 'drawn inside a clip')
    assert.ok(line.ty > 0, 'and below where it rests')
  }
  const rects = calls.filter((call) => call.op === 'rect')
  const { laid, anchor } = setup('first\nsecond', { align: 'left' })
  // The mask spans the line's own height (plus room for descenders), starting a line above its baseline.
  assert.equal(rects[0]!.args[1], anchor.firstBaseline - laid.lineHeight)
  assert.equal(rects[0]!.args[3], laid.lineHeight + SIZE * DESCENDER)
  // Fully risen it is neither clipped nor moved.
  const rested = glyphs(paintedAt('first\nsecond', item, 20))
  assert.ok(rested.every((line) => line.clips === 0 && line.ty === 0))
})

test('a unit\'s transform is about its own centre, in type sizes — or a whole line when it rises through a mask', () => {
  const run = { left: 100, width: 60, baseline: 300 }
  const base = { opacity: 1, dx: 0.5, dy: 0.25, scale: 1.2, rotation: 3, blur: 0.1, reveal: null }
  assert.deepEqual(unitTransform(run, { ...base, masked: false }, 40, 60), { cx: 130, cy: 300 - 14, dx: 20, dy: 10, scale: 1.2, rotation: 3, blur: 4 })
  // Masked, a `dy` of 1 is the whole line and its descender allowance: entirely below the mask.
  assert.equal(unitTransform(run, { ...base, dy: 1, masked: true }, 40, 60).dy, 60 + 40 * DESCENDER)
})
