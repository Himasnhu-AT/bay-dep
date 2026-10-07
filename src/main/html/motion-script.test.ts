/**
 * `bay-motion.js` against the TypeScript it is generated from.
 *
 * Two claims, kept apart because they fail for different reasons. The checked-in script is what
 * the generator makes of the sources on disk (stale → run `pnpm gen:motion`). And the script, run
 * as a page would run it, returns what the TypeScript returns for every export — which is the
 * claim that matters, since a composition and a `.brf` module are meant to draw the same curve.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import * as TS from '@shared/motion'
import { motionScript, motionScriptModule } from '@shared/motion-bundle'
import { MOTION_BANNER, MOTION_GLOBAL } from '@shared/motion-file'
import { MOTION_SCRIPT } from './motion-script.generated'

type Lib = typeof TS

const read = (id: string): string | null => {
  const path = join('src/shared', `${id}.ts`)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** The script, run the way a composition page runs it: as a classic script, leaving a global. */
function runScript(script: string): Lib {
  const context = vm.createContext({})
  vm.runInContext(script, context)
  return (context as Record<string, unknown>)[MOTION_GLOBAL] as Lib
}

test('the checked-in script is what the sources generate', () => {
  const fresh = motionScript(read)
  assert.ok(
    fresh === MOTION_SCRIPT,
    'src/main/html/motion-script.generated.ts is stale — something under src/shared/motion (or a file it ' +
      'imports) changed without regenerating it. Run `pnpm gen:motion` and commit the result.'
  )
  assert.ok(
    motionScriptModule(fresh) === readFileSync('src/main/html/motion-script.generated.ts', 'utf8'),
    'src/main/html/motion-script.generated.ts was edited by hand. Run `pnpm gen:motion`.'
  )
  assert.ok(MOTION_SCRIPT.startsWith(MOTION_BANNER), 'the script does not start with the banner bay recognises its own file by')
})

const times = (t0: number, t1: number, n: number): number[] => Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n)
const TIMES = times(-0.3, 3.3, 72)
const knots = [{ t: 0, x: 100, y: 900 }, { t: 0.7, x: 800, y: 500 }, { t: 2.4, x: 1400, y: 300 }]
const keys = [{ t: 0.2, x: 400, y: 300, zoom: 1 }, { t: 1.4, x: 1200, zoom: 6, rot: 4, curve: 'expoInOut' as const }, { t: 2.6, zoom: 0.5 }]
const card = { x: 1210, y: 640, w: 320, h: 180, r: 24 }
const tall = { w: 1080, h: 1920 }
const path = (t: number): [number, number] => [200 + 700 * Math.min(1, Math.max(0, t - 0.5)), 400 + 120 * Math.sin(t * 5)]

/**
 * One row per export: what to ask of the library, on a grid of inputs. Rows are thunks because
 * some exports return functions or recordings, and what must agree is what those return.
 */
const CASES: Record<keyof Lib, (BM: Lib) => unknown> = {
  FRAME: (BM) => BM.FRAME,
  EASES: (BM) => Object.entries(BM.EASES).map(([name, f]) => [name, times(-0.1, 1.1, 60).map((p) => f(p))]),
  EASE_T80: (BM) => BM.EASE_T80,
  clamp: (BM) => [BM.clamp(-2), BM.clamp(0.4), BM.clamp(9, 2, 5)],
  lerp: (BM) => TIMES.map((p) => BM.lerp(3.7, -912.25, p)),
  progress: (BM) => TIMES.map((t) => [BM.progress(t, 0.5, 2), BM.progress(t, 1, 1)]),
  smooth: (BM) => TIMES.map((p) => BM.smooth(p)),
  smoother: (BM) => TIMES.map((p) => BM.smoother(p)),
  rng: (BM) => [1, 2, 99].map((seed) => { const r = BM.rng(seed); return Array.from({ length: 20 }, () => r()) }),
  bezier: (BM) => times(0, 1, 50).map((p) => BM.bezier(0.2, 0.9, 0.1, 1)(p)),
  easeOf: (BM) => times(0, 1, 50).map((p) => [BM.easeOf('quintInOut')(p), BM.easeOf([0.7, 0, 0.3, 1])(p)]),
  easeTime: (BM) => (Object.keys(BM.EASES) as TS.EaseName[]).map((name) => [BM.easeTime(name), BM.easeTime(name, 0.5)]),
  spring: (BM) => [0.3, 0.6, 1, 1.7].map((damping) => TIMES.map((t) => BM.spring(t, { damping, frequency: 13 }))),
  springSpeed: (BM) => [0.3, 0.6, 1, 1.7].map((damping) => TIMES.map((t) => BM.springSpeed(t, { damping, frequency: 13 }))),
  springOvershoot: (BM) => [0, 0.2, 0.6, 1, 2].map((d) => BM.springOvershoot(d)),
  springTimed: (BM) => TIMES.map((t) => [BM.springTimed(t), BM.springTimed(t, { duration: 0.8, bounce: 0.3 })]),
  spline: (BM) => TIMES.map((t) => BM.spline(knots, t)),
  velocity: (BM) => TIMES.map((t) => BM.velocity(path, t)),
  matIdentity: (BM) => BM.matIdentity(),
  matTranslate: (BM) => BM.matTranslate(3, -4),
  matScale: (BM) => [BM.matScale(2), BM.matScale(2, 0.5)],
  matRotate: (BM) => [0, 33, 90, -170].map((d) => BM.matRotate(d)),
  matMultiply: (BM) => BM.matMultiply(BM.matTranslate(40, -7), BM.matRotate(33), BM.matScale(1.7, 0.6)),
  matInvert: (BM) => BM.matInvert(BM.matMultiply(BM.matTranslate(40, -7), BM.matRotate(33), BM.matScale(1.7, 0.6))),
  matApply: (BM) => BM.matApply(BM.matRotate(33), 12, 34),
  matCss: (BM) => BM.matCss(BM.matRotate(33)),
  matCanvas: (BM) => BM.matCanvas(BM.matRotate(33), 2),
  wordLand: (BM) => TIMES.map((t) => [BM.wordLand(t, 0.4), BM.wordLand(t, 0.4, { rise: 80, from: 0.5, lead: 0.2, damping: 0.4 })]),
  letterFall: (BM) => TIMES.map((t) => [0, 1, 5].map((i) => BM.letterFall(t, 0.2, i))),
  cardPop: (BM) => TIMES.map((t) => BM.cardPop(t, 0.3)),
  cardLift: (BM) => TIMES.map((t) => BM.cardLift(t, 1.1, { dur: 0.5 })),
  lineReveal: (BM) => TIMES.map((t) => [0, 2].map((i) => BM.lineReveal(t, 0.2, i))),
  typeOn: (BM) => TIMES.map((t) => BM.typeOn(t, 0.2, 'make it 😀 move', { cps: 9 })),
  checkTick: (BM) => TIMES.map((t) => BM.checkTick(t, 1)),
  rectMorph: (BM) => TIMES.map((t) => BM.rectMorph(t, 0.5, 1.6, card, { x: 0, y: 0, w: 1920, h: 1080 })),
  irisReach: (BM) => [BM.irisReach(300, 800), BM.irisReach(-20, 2000, tall)],
  iris: (BM) => TIMES.map((t) => [BM.iris(t, 0.5, 1.6, 300, 800), BM.iris(t, 0.5, 1.6, 300, 800, { from: 40, frame: tall, curve: 'expoIn' })]),
  pushInto: (BM) => TIMES.map((t) => [BM.pushInto(t, 0.5, 1.6, card), BM.pushInto(t, 0.5, 1.6, card, { fit: 'contain', frame: tall })]),
  arcHop: (BM) => TIMES.map((t) => BM.arcHop(t, 0.5, 1.1, [200, 800], [900, 760])),
  converge: (BM) => TIMES.map((t) => [0, 2, 4].map((i) => BM.converge(t, 0.5, 1.9, i, 5, [200 + i * 300, 900], [900, 300]))),
  rail: (BM) => TIMES.map((t) => BM.rail(t, [0.5, 1.4, 2.2])),
  wordCuts: (BM) => TIMES.map((t) => BM.wordCuts(t, [{ t: 0.5, word: 'a' }, { t: 0.9, word: 'b' }])),
  impact: (BM) => TIMES.map((t) => BM.impact(t, 0.7)),
  press: (BM) => TIMES.map((t) => BM.press(t, 0.6)),
  pointer: (BM) => TIMES.map((t) => BM.pointer(t, knots, [0.7, 2])),
  stretch: (BM) => [[0, 0], [500, 0], [-300, 900], [1e7, 3]].map(([vx, vy]) => BM.stretch(vx!, vy!)),
  simFollower: (BM) => { const sim = BM.simFollower(path, { duration: 3 }); return TIMES.map((t) => sim.at(t)) },
  simMagnet: (BM) => { const sim = BM.simMagnet(path, [700, 420], { duration: 3 }); return TIMES.map((t) => sim.at(t)) },
  simString: (BM) => { const sim = BM.simString(path, { duration: 3, gust: 700, seed: 4 }); return TIMES.map((t) => sim.at(t)) },
  homeCamera: (BM) => [BM.homeCamera(), BM.homeCamera(tall)],
  cameraAt: (BM) => TIMES.map((t) => BM.cameraAt(t, keys)),
  layerScale: (BM) => TIMES.map((t) => [0, 1.2, -0.1].map((depth) => BM.layerScale(BM.cameraAt(t, keys), depth))),
  layerMatrix: (BM) => TIMES.map((t) => [0, 1.2, -0.1].map((depth) => BM.layerMatrix(BM.cameraAt(t, keys), { depth }))),
  toScreen: (BM) => TIMES.map((t) => BM.toScreen(BM.layerMatrix(BM.cameraAt(t, keys)), 123, 456)),
  toWorld: (BM) => TIMES.map((t) => BM.toWorld(BM.layerMatrix(BM.cameraAt(t, keys)), 123, 456)),
  boxToScreen: (BM) => TIMES.map((t) => BM.boxToScreen(BM.layerMatrix(BM.cameraAt(t, keys)), { ...card, op: 0.5 })),
  inFrame: (BM) => TIMES.map((t) => { const b = BM.boxToScreen(BM.layerMatrix(BM.cameraAt(t, keys)), card); return [BM.inFrame(b), BM.inFrame(b, { whole: true })] }),
  shake: (BM) => TIMES.map((t) => [BM.shake(t, 0.7), BM.shake(t, 0.7, { seed: 8, amp: 30 })]),
  handheld: (BM) => TIMES.map((t) => BM.handheld(t, { seed: 3 })),
  farGrid: (BM) => TIMES.map((t) => BM.farGrid(BM.cameraAt(t, keys))),
  frameTravel: (BM) => TIMES.map((t) => BM.frameTravel(BM.cameraAt(t, keys), BM.cameraAt(t + 1 / 30, keys), { mid: BM.cameraAt(t + 1 / 60, keys) })),
  boxTravel: (BM) => BM.boxTravel({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 40, w: 50, h: 5 }),
  blurSamples: (BM) => [0, 7, 80, 1e6].map((px) => BM.blurSamples(px))
}

test('the script, run as a page runs it, returns what the TypeScript returns — for every export', () => {
  const BM = runScript(MOTION_SCRIPT)
  const names = Object.keys(TS).sort()
  assert.deepEqual(Object.keys(BM).filter((k) => k !== '__esModule').sort(), names, 'the script and the TypeScript export different names')
  assert.deepEqual(Object.keys(CASES).sort(), names, 'an export has no row in CASES (or a row names nothing): add one, so its two forms are compared')
  assert.ok(names.length >= 55, `only ${names.length} exports`)
  for (const name of names as (keyof Lib)[]) {
    const fromScript = JSON.stringify(CASES[name](BM))
    const fromSource = JSON.stringify(CASES[name](TS))
    assert.ok(fromSource.length > 2 && !fromSource.includes('null'), `${name}: the row produced nothing to compare, or a NaN`)
    assert.ok(fromScript === fromSource, `${name}: bay-motion.js and src/shared/motion disagree`)
  }
})

test('the script defines exactly one global, and needs nothing a page does not have', () => {
  // An empty context: no `require`, no `module`, no `window`, no DOM.
  const context = vm.createContext({})
  vm.runInContext(MOTION_SCRIPT, context)
  assert.deepEqual(Object.keys(context), [MOTION_GLOBAL])
})

test('the bundler follows relative imports, and names any import a composition folder could not hold', () => {
  const files: Record<string, string> = {
    'motion/index': "export * from './a'\nexport { helper } from '../util'\n",
    'motion/a': "import { helper } from '../util'\nexport const twice = (n: number): number => helper(n) * 2\n",
    util: 'export function helper(n: number): number { return n + 1 }\n'
  }
  const built = runScript(motionScript((id) => files[id] ?? null)) as unknown as { twice(n: number): number; helper(n: number): number }
  assert.equal(built.twice(4), 10)
  assert.equal(built.helper(1), 2)

  assert.throws(
    () => motionScript((id) => ({ ...files, 'motion/a': "import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n" })[id] ?? null),
    (error: Error) => error.message.includes('src/shared/motion/a.ts') && error.message.includes('"node:fs"')
  )
  assert.throws(
    () => motionScript((id) => ({ ...files, 'motion/a': "import { gone } from './gone'\nexport const x = gone\n" })[id] ?? null),
    (error: Error) => error.message.includes('src/shared/motion/a.ts') && error.message.includes('motion/gone')
  )
})
