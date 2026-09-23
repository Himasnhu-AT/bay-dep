import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  brfVariableDeclarations,
  parseGradient,
  ease,
  evaluateBrf,
  parseBrf,
  type BrfDocument,
  type DrawOp
} from './brf'

/** The lower third bay ships as HTML (`main/templates/lower-third.html`), as a `.brf`. */
export const LOWER_THIRD: BrfDocument = {
  brf: 1,
  duration: 4,
  vars: { name: 'Himanshu', role: 'building bay', accent: '#11D1A0' },
  layers: [
    {
      type: 'group', x: '7%', y: '76%', anchor: [0, 0.5], in: ['fade', 0.3], out: ['fade', 0.3],
      layers: [
        { type: 'rect', x: 0, y: 0, w: 10, h: 120, anchor: [0, 0.5], radius: 5, fill: '$accent', sy: [[0, 0], [0.4, 1, 'out']] },
        { type: 'text', text: '$name', x: 32, y: -22, anchor: [0, 0.5], align: 'left', size: 68, weight: 900, in: ['left', 0.42] },
        { type: 'text', text: '$role', x: 32, y: 38, anchor: [0, 0.5], align: 'left', size: 38, fill: '$accent', in: ['left', 0.42, 0.09] }
      ]
    }
  ]
}

const faultsOf = (input: unknown): string[] => {
  const parsed = parseBrf(input)
  return parsed.ok ? [] : parsed.faults.map((f) => `${f.at}: ${f.message}`)
}

const at = (doc: BrfDocument, t: number, values = {}): DrawOp[] => evaluateBrf(doc, t, 1920, 1080, values)
const only = <K extends DrawOp['kind']>(ops: DrawOp[], kind: K): Extract<DrawOp, { kind: K }>[] =>
  ops.filter((op): op is Extract<DrawOp, { kind: K }> => op.kind === kind)

test('the lower third as a scene document is valid', () => {
  assert.deepEqual(faultsOf(LOWER_THIRD), [])
})

test('a document is accepted from its JSON text as well as an object', () => {
  assert.deepEqual(faultsOf(JSON.stringify(LOWER_THIRD)), [])
  assert.match(faultsOf('{"brf":1,')[0]!, /not valid JSON/)
})

test('every fault is reported at once, each with where it is and what to write instead', () => {
  const faults = faultsOf({
    brf: 1,
    duration: 3,
    layers: [
      { type: 'rect', w: 10, h: 10, fill: '#fff', opactiy: 0.5 },
      { type: 'txt', text: 'x' },
      { type: 'text', text: 'hi', x: [[1, 0], [0.5, 10]] },
      { type: 'text', text: '$missing' },
      { type: 'ellipse', w: 4, h: 4 },
      { type: 'rect', w: 1, h: 1, fill: 'teal-ish', in: 'zoom' },
      { type: 'text', text: 'late', y: [[0, 0], [9, 1, 'bouncy']] }
    ]
  })
  const expect = [
    /layers\[0\]\.opactiy: .*did you mean "opacity"/,
    /layers\[1\]\.type: must be one of .*did you mean "text"/,
    /layers\[2\]\.x\[1\]: keys must be in time order/,
    /layers\[3\]\.text: refers to \$missing, which "vars" does not declare/,
    /layers\[4\]: a ellipse needs a "fill" or a "stroke"/,
    /layers\[5\]\.fill: "teal-ish" is not a colour/,
    /layers\[5\]\.in: must be a preset/,
    /layers\[6\]\.y\[1\]: 9s is outside the document's 0–3s/,
    /layers\[6\]\.y\[1\]: unknown easing "bouncy"/
  ]
  for (const pattern of expect) {
    assert.ok(faults.some((f) => pattern.test(f)), `no fault matching ${pattern}\n${faults.join('\n')}`)
  }
})

test('the positive control: the nearest legal document to each fault is accepted', () => {
  assert.deepEqual(
    faultsOf({
      brf: 1,
      duration: 3,
      vars: { word: 'hi' },
      layers: [
        { type: 'rect', w: 10, h: 10, fill: '#fff', opacity: 0.5 },
        { type: 'text', text: 'x' },
        { type: 'text', text: 'hi', x: [[0.5, 0], [1, 10]] },
        { type: 'text', text: '$word' },
        { type: 'ellipse', w: 4, h: 4, stroke: '#000', strokeWidth: 2 },
        { type: 'rect', w: 1, h: 1, fill: 'rgba(0,128,128,0.5)', in: 'pop' },
        { type: 'text', text: 'late', y: [[0, 0], [3, 1, 'spring']] }
      ]
    }),
    []
  )
})

test('a keyed value interpolates with the easing of the key it arrives at, and holds outside', () => {
  const doc: BrfDocument = {
    brf: 1,
    duration: 2,
    layers: [{ type: 'rect', w: 10, h: 10, fill: '#fff', anchor: [0, 0], x: [[0.5, 0], [1.5, 100, 'linear']] }]
  }
  const x = (t: number): number => only(at(doc, t), 'rect')[0]!.matrix[4]
  assert.equal(x(0), 0)
  assert.equal(x(0.5), 0)
  assert.equal(x(1), 50)
  assert.equal(x(1.5), 100)
  assert.equal(x(2), 100)
})

test('every named easing starts at 0 and ends at 1', () => {
  for (const name of ['linear', 'in', 'out', 'inOut', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic', 'inExpo', 'outExpo', 'inOutExpo', 'inBack', 'outBack', 'inOutBack', 'outElastic', 'outBounce', 'spring', 'hold'] as const) {
    assert.ok(Math.abs(ease(name, 0)) < 1e-9, `${name}(0) = ${ease(name, 0)}`)
    assert.equal(ease(name, 1), 1, name)
  }
  // A bezier with a known midpoint: the symmetric ease-in-out passes through (0.5, 0.5).
  assert.ok(Math.abs(ease([0.42, 0, 0.58, 1], 0.5) - 0.5) < 1e-4)
  assert.equal(ease('hold', 0.99), 0)
})

test('percentages are of the frame: x of its width, y of its height, sizes of its short side', () => {
  const doc: BrfDocument = {
    brf: 1,
    duration: 1,
    layers: [{ type: 'rect', anchor: [0, 0], x: '50%', y: '50%', w: '10%', h: '10%', radius: '1%', fill: '#fff' }]
  }
  const [rect] = only(at(doc, 0), 'rect')
  assert.equal(rect!.matrix[4], 960)
  assert.equal(rect!.matrix[5], 540)
  assert.equal(rect!.w, 192)
  assert.equal(rect!.h, 108)
  assert.equal(rect!.radius, 10.8)
})

test('an entrance preset starts away and arrives at rest; an exit leaves by the end', () => {
  const doc: BrfDocument = {
    brf: 1,
    duration: 3,
    layers: [{ type: 'rect', w: 10, h: 10, fill: '#fff', in: ['up', 0.5], out: ['fade', 0.5] }]
  }
  const rect = (t: number) => only(at(doc, t), 'rect')[0]
  assert.equal(rect(0), undefined, 'fully transparent at the start, so nothing is drawn')
  assert.ok(rect(0.25)!.alpha > 0 && rect(0.25)!.alpha < 1)
  assert.ok(rect(0.25)!.matrix[5] > rect(1)!.matrix[5], 'rises into place')
  assert.equal(rect(1)!.alpha, 1)
  assert.ok(rect(2.75)!.alpha < 1)
  assert.equal(rect(3), undefined)
})

test('split text staggers in reading order, in and out', () => {
  const doc: BrfDocument = {
    brf: 1,
    duration: 4,
    layers: [{ type: 'text', text: 'one two three', split: 'word', stagger: 0.2, in: ['fade', 0.2], out: ['fade', 0.2] }]
  }
  const piece = (t: number, i: number) => only(at(doc, t), 'text')[0]!.piece!(i, 3)
  // Entering: at 0.2s the first word is in, the third has not started.
  assert.equal(piece(0.2, 0).alpha, 1)
  assert.equal(piece(0.2, 2).alpha, 0)
  // Leaving: the first word leaves first, and the last is gone as the layer ends.
  assert.ok(piece(3.5, 0).alpha < piece(3.5, 2).alpha)
  assert.equal(piece(4, 2).alpha, 0)
})

test('a group moves its children, multiplies their opacity, and clips when asked', () => {
  const doc: BrfDocument = {
    brf: 1,
    duration: 1,
    layers: [
      {
        type: 'group', x: 100, y: 50, anchor: [0, 0], w: 20, h: 20, clip: true, opacity: 0.5,
        layers: [{ type: 'rect', x: 10, y: 0, anchor: [0, 0], w: 5, h: 5, fill: '#fff', opacity: 0.5 }]
      }
    ]
  }
  const ops = at(doc, 0)
  assert.deepEqual(ops.map((op) => op.kind), ['clip', 'rect', 'unclip'])
  const rect = only(ops, 'rect')[0]!
  assert.equal(rect.matrix[4], 110)
  assert.equal(rect.matrix[5], 50)
  assert.equal(rect.alpha, 0.25)
})

test('rotation and scale turn about the anchor', () => {
  const doc: BrfDocument = {
    brf: 1,
    duration: 1,
    layers: [{ type: 'rect', x: 50, y: 50, w: 20, h: 20, rotate: 90, scale: 2, fill: '#fff' }]
  }
  const [a, b, c, d, e, f] = only(at(doc, 0), 'rect')[0]!.matrix
  // The box's centre (10, 10 in local units) must land on (50, 50).
  const cx = a * 10 + c * 10 + e
  const cy = b * 10 + d * 10 + f
  assert.ok(Math.abs(cx - 50) < 1e-9 && Math.abs(cy - 50) < 1e-9, `${cx}, ${cy}`)
  assert.ok(Math.abs(b - 2) < 1e-9, 'x axis now points down, twice as long')
})

test('variables fill strings and numbers, and a placement overrides them', () => {
  const doc: BrfDocument = {
    brf: 1,
    duration: 1,
    vars: { who: 'Ada', tint: '#ff0000', left: 40 },
    layers: [{ type: 'text', text: '$who', x: '$left', fill: '$tint' }]
  }
  const text = (values = {}) => only(at(doc, 0, values), 'text')[0]!
  assert.equal(text().text, 'Ada')
  assert.equal(text().fill, 'rgba(255,0,0,1)')
  assert.equal(text().matrix[4], 40)
  assert.equal(text({ who: 'Grace', left: 80 }).text, 'Grace')
  assert.equal(text({ who: 'Grace', left: 80 }).matrix[4], 80)
})

test('colours interpolate through their channels, alpha included', () => {
  const doc: BrfDocument = {
    brf: 1,
    duration: 1,
    layers: [{ type: 'rect', w: 1, h: 1, fill: [[0, '#00000000'], [1, '#ffffffff', 'linear']] }]
  }
  assert.equal(only(at(doc, 0.5), 'rect')[0]!.fill, 'rgba(128,128,128,0.5)')
})

test('evaluation is a pure function of time: the same moment twice is the same picture', () => {
  const strip = (ops: DrawOp[]) => JSON.stringify(ops, (_, v) => (typeof v === 'function' ? 'fn' : v))
  for (const t of [0, 0.37, 1.2, 3.99]) assert.equal(strip(at(LOWER_THIRD, t)), strip(at(LOWER_THIRD, t)))
  // Asking for a time outside the document draws its first or last frame, not nothing.
  assert.equal(strip(at(LOWER_THIRD, -5)), strip(at(LOWER_THIRD, 0)))
  assert.equal(strip(at(LOWER_THIRD, 99)), strip(at(LOWER_THIRD, 4)))
})

test('vars become declarations the Inspector and edit_item already understand', () => {
  assert.deepEqual(brfVariableDeclarations(LOWER_THIRD).map((v) => [v.id, v.type]), [
    ['name', 'string'],
    ['role', 'string'],
    ['accent', 'color']
  ])
})

test('a gradient fill reads its angle and stops, spreading stops without a position evenly', () => {
  assert.deepEqual(parseGradient('linear(90, #ff0000, rgba(0,0,255,0.5) 80%)'), {
    kind: 'linear',
    angle: 90,
    stops: [
      { color: 'rgba(255,0,0,1)', at: 0 },
      { color: 'rgba(0,0,255,0.5)', at: 0.8 }
    ]
  })
  assert.equal(parseGradient('radial(#fff, #000, #fff)')!.stops[1]!.at, 0.5)
  assert.equal(parseGradient('linear(#fff, #000)')!.angle, 180, 'top to bottom by default, as CSS')
  const doc = (fill: unknown) => ({ brf: 1, duration: 1, layers: [{ type: 'rect', w: 1, h: 1, fill }] })
  assert.deepEqual(faultsOf(doc('linear(180, #000000cc, #00000000 80%)')), [])
  assert.match(faultsOf(doc('linear(180, #000000cc)'))[0]!, /layers\[0\]\.fill: .* is not a gradient/)
  assert.match(faultsOf(doc('linear(180, #000, notacolour)'))[0]!, /is not a gradient/)
  // Variables inside a gradient resolve like any colour — declared ones, that is.
  const withVars = { brf: 1, duration: 1, vars: { accent: '#ff0000' }, layers: [{ type: 'rect', w: 1, h: 1, fill: 'linear(90, $accent, #0000ff)' }] }
  assert.deepEqual(faultsOf(withVars), [])
  assert.equal(only(evaluateBrf(withVars as BrfDocument, 0, 10, 10, { accent: '#00ff00' }), 'rect')[0]!.fill, 'linear(90, #00ff00, #0000ff)')
  assert.match(faultsOf({ ...withVars, vars: {} })[0]!, /refers to \$accent, which "vars" does not declare/)
})
