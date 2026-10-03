/**
 * The move library as a `.brf` module sees it: `import { BM } from 'bay'`.
 *
 * The guide's own example is run on every frame by `brf-code.test.ts`; this holds the claim that
 * example cannot — that what the module gets is the library itself, so a `.brf` graphic and an
 * HTML composition draw the same curve.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BAY_MODULE, REMOTION_MODULE, loadBrf, renderBrf } from '../brf-code'
import * as BM from './index'

function layersAt(source: string, frame: number): Record<string, unknown>[] {
  const loaded = loadBrf(source)
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error)
  const rendered = renderBrf(loaded.module, { frame, fps: 30, width: 1920, height: 1080, vars: loaded.module.vars })
  assert.ok(rendered.ok, rendered.ok ? '' : rendered.error)
  return rendered.doc.layers as unknown as Record<string, unknown>[]
}

test("a .brf module imports BM from 'bay' and gets the library's own numbers", () => {
  const source = `
    import { BM } from 'bay'
    const CARD = { x: 660, y: 420, w: 600, h: 240, r: 40 }
    const FULL = { x: 0, y: 0, w: 1920, h: 1080, r: 0 }
    export default ({ t }) => {
      const word = BM.wordLand(t, 0.2)
      const box = BM.rectMorph(t, 0.4, 1.2, CARD, FULL)
      return (
        <scene duration={2} size={[1920, 1080]}>
          <rect anchor={[0, 0]} x={box.x} y={box.y} w={box.w} h={box.h} radius={box.r} fill="#1B2A4A" />
          <text x={960} y={540 + word.y} size={120} opacity={word.op} scale={word.s}>Carried</text>
        </scene>
      )
    }`
  for (const frame of [0, 7, 13, 24, 36, 59]) {
    const t = frame / 30
    const [rect, text] = layersAt(source, frame)
    const box = BM.rectMorph(t, 0.4, 1.2, { x: 660, y: 420, w: 600, h: 240, r: 40 }, { x: 0, y: 0, w: 1920, h: 1080, r: 0 })
    const word = BM.wordLand(t, 0.2)
    assert.deepEqual([rect!.x, rect!.y, rect!.w, rect!.h, rect!.radius], [box.x, box.y, box.w, box.h, box.r], `the rect at frame ${frame}`)
    assert.deepEqual([text!.y, text!.opacity, text!.scale], [540 + word.y, word.op, word.s], `the word at frame ${frame}`)
  }
  // The specimen moves: frames differ, so agreeing with the library is not agreeing on a constant.
  assert.notDeepEqual(layersAt(source, 13), layersAt(source, 24))
})

test('BM is the library itself, every export, and the names bay already had still mean what they did', () => {
  assert.equal(BAY_MODULE.BM, BM)
  assert.ok(Object.keys(BAY_MODULE.BM).length >= 55)
  // `spring` from 'bay' is the Remotion-shaped one (stiffness/damping/mass); BM.spring takes a damping ratio.
  assert.notEqual(BAY_MODULE.spring, BM.spring)
  assert.ok(Math.abs(BAY_MODULE.spring(0.3, { stiffness: 100, damping: 10 }) - BM.spring(0.3, { damping: 0.5, frequency: 10 })) < 1e-12)
  // Remotion code is not handed bay's names.
  assert.equal('BM' in REMOTION_MODULE, false)
})

test('a sim built at the top of a module is a recording the frames only read', () => {
  const source = `
    import { BM } from 'bay'
    const sim = BM.simFollower((t) => [200 + 800 * BM.progress(t, 0.2, 0.6), 400], { duration: 2 })
    export default ({ t }) => (
      <scene duration={2} size={[1920, 1080]}>
        <ellipse x={sim.at(t).x} y={sim.at(t).y} w={40} h={40} fill="#fff" />
      </scene>
    )`
  const sim = BM.simFollower((t) => [200 + 800 * BM.progress(t, 0.2, 0.6), 400], { duration: 2 })
  // Out of order, and twice: a frame is the same whenever it is asked for.
  for (const frame of [40, 3, 22, 40, 0, 59]) {
    assert.equal(layersAt(source, frame)[0]!.x, sim.at(frame / 30).x, `frame ${frame}`)
  }
})
