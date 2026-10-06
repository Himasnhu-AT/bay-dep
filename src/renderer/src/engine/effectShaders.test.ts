/**
 * The catalog and its shaders, held together: every effect an item can store has passes to draw
 * it, every pass names a program that exists and hands it the uniforms it declares, and the
 * numbers a plan computes scale the way the conventions at the top of `effectShaders.ts` say.
 *
 * What this cannot do is compile GLSL — there is no WebGL under Node. A shader that does not
 * compile is reported at draw time (`drawEffects` → `gradeIssues`), and `test/app/effects.mjs`
 * draws every effect in the running app.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EFFECTS, EFFECT_KINDS } from '@shared/effects/index'
import { defaultParams } from '@shared/effects/edit'
import { glitchBand } from '@shared/effects/math'
import { resolveParams } from '@shared/effects/resolve'
import { EFFECT_PASSES, EFFECT_PROGRAMS, EFFECT_VERTEX, effectFragment, type EffectEnv, type PassStep } from './effectShaders'

const ENV: EffectEnv = { width: 1920, height: 1080, scale: 1, frame: 90 }

function plan(kind: string, overrides: Record<string, unknown> = {}, env: EffectEnv = ENV): PassStep[] {
  const spec = EFFECTS.find((candidate) => candidate.kind === kind)
  assert.ok(spec, kind)
  const passes = EFFECT_PASSES[kind]
  assert.ok(passes, `${kind} has no passes`)
  return passes(resolveParams(spec, { ...defaultParams(spec), ...overrides }), env)
}

test('every catalog effect has passes, and nothing has passes without being in the catalog', () => {
  assert.deepEqual(Object.keys(EFFECT_PASSES).sort(), [...EFFECT_KINDS].sort())
})

test('every pass names a program that exists, and every program is used', () => {
  const used = new Set<string>()
  for (const kind of EFFECT_KINDS) {
    for (const step of plan(kind)) {
      assert.ok(effectFragment(step.program), `${kind} draws with "${step.program}", which has no shader`)
      used.add(step.program)
    }
  }
  assert.deepEqual([...used].sort(), [...EFFECT_PROGRAMS].sort(), 'a shader no effect draws with is dead')
  assert.equal(effectFragment('nope'), null)
})

test('a plan ends in the result, reads only what was already drawn, and never draws into what it reads', () => {
  for (const kind of EFFECT_KINDS) {
    const steps = plan(kind)
    assert.equal(steps.at(-1)?.output, 'result', `${kind} must end by drawing its result`)
    assert.equal(steps.filter((step) => step.output === 'result').length, 1, `${kind} draws its result once`)
    const drawn = new Set<string>()
    for (const step of steps) {
      for (const input of [step.input, step.aux]) {
        if (input === undefined || input === 'current') continue
        assert.ok(drawn.has(input), `${kind}: "${step.program}" reads ${input} before any pass drew it`)
      }
      if (step.output !== 'result') {
        // A target bound for reading while it is drawn into is a WebGL feedback loop: the draw fails.
        assert.notEqual(step.output.scratch, step.input, `${kind}: "${step.program}" draws into its own input`)
        assert.notEqual(step.output.scratch, step.aux, `${kind}: "${step.program}" draws into its own second input`)
        assert.ok(step.output.width >= 1 && step.output.height >= 1)
        drawn.add(step.output.scratch)
      }
    }
  }
})

test('every uniform a plan sets is one its shader declares, with a matching size', () => {
  const sizes: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 }
  for (const kind of EFFECT_KINDS) {
    for (const step of plan(kind)) {
      const source = effectFragment(step.program) ?? ''
      for (const [name, value] of Object.entries(step.uniforms)) {
        const declared = new RegExp(`uniform (float|vec2|vec3|vec4) ${name};`).exec(source)
        assert.ok(declared, `${kind}: "${step.program}" has no uniform ${name} — it would be set and ignored`)
        const length = typeof value === 'number' ? 1 : value.length
        assert.equal(length, sizes[declared[1] as string], `${kind}: ${name} is ${declared[1]} but was given ${length} numbers`)
        for (const n of typeof value === 'number' ? [value] : value) assert.ok(Number.isFinite(n), `${kind}: ${name} is not finite`)
      }
      // And the reverse: a declared uniform nobody sets draws with 0.
      const standard = ['u_map', 'u_half', 'u_auxMap', 'u_auxHalf', 'u_px']
      for (const match of source.matchAll(/uniform (?:float|vec2|vec3|vec4) (u_\w+);/g)) {
        const name = match[1] as string
        if (standard.includes(name)) continue
        assert.ok(name in step.uniforms, `${kind}: "${step.program}" declares ${name}, which its plan never sets`)
      }
    }
  }
})

test('no shader reads a clock or a random source, so frame N is one picture everywhere', () => {
  for (const program of EFFECT_PROGRAMS) {
    const source = effectFragment(program) ?? ''
    assert.match(source, /^#version 300 es/)
    assert.doesNotMatch(source, /u_time|u_now|u_random|\brand\s*\(/i, program)
  }
  assert.match(EFFECT_VERTEX, /layout\(location = 0\) in vec2 a_pos/)
})

test('lengths in timeline pixels scale with the size the picture is drawn at', () => {
  // The same clip in a half-size preview and at export size: each length is the same share of it.
  const half: EffectEnv = { width: 960, height: 540, scale: 0.5, frame: 90 }
  const [blurFull] = plan('directional-blur', { length: 40 })
  const [blurHalf] = plan('directional-blur', { length: 40 }, half)
  assert.equal(blurFull?.uniforms.u_len, 40)
  assert.equal(blurHalf?.uniforms.u_len, 20)

  const [cellFull] = plan('pixelate', { size: 32 })
  const [cellHalf] = plan('pixelate', { size: 32 }, half)
  assert.deepEqual(cellFull?.uniforms.u_cell, cellHalf?.uniforms.u_cell, 'a mosaic block is the same share of the picture at any size')
  assert.deepEqual(cellFull?.uniforms.u_cell, [32 / 1920, 32 / 1080], 'and square in pixels')

  const [bandFull] = plan('glitch', { blockSize: 54 })
  const [bandHalf] = plan('glitch', { blockSize: 54 }, half)
  assert.equal(bandFull?.uniforms.u_band, 54 / 1080)
  assert.equal(bandHalf?.uniforms.u_band, bandFull?.uniforms.u_band)
})

test('angles are directions in image space: 0 is along x, 90 is down', () => {
  const dir = (angle: number): number[] => [...(plan('directional-blur', { angle })[0]?.uniforms.u_dir as number[])]
  const close = (a: number[], b: number[]): void => a.forEach((v, i) => assert.ok(Math.abs(v - (b[i] as number)) < 1e-12, `${a} vs ${b}`))
  close(dir(0), [1, 0])
  close(dir(90), [0, 1])
  close(dir(180), [-1, 0])
})

test('glow blurs a shrunken copy within the tap budget and composites it over its own input', () => {
  const steps = plan('glow', { radius: 40 })
  assert.deepEqual(steps.map((step) => step.program), ['glow-bright', 'gauss', 'gauss', 'glow-composite'])
  const [bright, horizontal, vertical, composite] = steps
  assert.ok(bright && horizontal && vertical && composite)
  assert.equal(bright.input, 'current')
  assert.equal(composite.input, 'current', 'the glow is added to the picture the effect was given')
  assert.equal(composite.aux, typeof vertical.output === 'object' ? vertical.output.scratch : '', 'and it is the blurred copy that is added')
  // 40 device px of sigma: shrunk 5x, blurred 8 texels — the blur asked for.
  assert.equal(bright.uniforms.u_down, 5)
  assert.equal(horizontal.uniforms.u_sigma, 8)
  assert.deepEqual(bright.output, { scratch: 'fxGlowA', width: 384, height: 216 })
  // One direction each, a texel of the shrunken copy at a time.
  assert.deepEqual(horizontal.uniforms.u_step, [1 / 384, 0])
  assert.deepEqual(vertical.uniforms.u_step, [0, 1 / 216])
  // A small radius is not shrunk at all.
  assert.equal(plan('glow', { radius: 4 })[0]?.uniforms.u_down, 1)
})

test('the glitch shader is handed the same step the mirrored function computes', () => {
  // frame 90, hold 3 → step 30; the TS mirror derives the same step from the same two numbers.
  const step = (frame: number, hold: number): number =>
    plan('glitch', { hold }, { ...ENV, frame })[0]?.uniforms.u_step as number
  assert.equal(step(90, 3), 30)
  assert.equal(step(92, 3), 30)
  assert.equal(step(93, 3), 31)
  assert.equal(step(-4, 3), 0, 'a handle frame before the clip is frame 0')
  assert.deepEqual(glitchBand(5, 92, 3, 0, 0.5), glitchBand(5, 90, 3, 0, 0.5))
  // The frame reaches no other effect: their plans are the same at every frame.
  for (const kind of EFFECT_KINDS.filter((k) => k !== 'glitch')) {
    assert.deepEqual(plan(kind, {}, { ...ENV, frame: 0 }), plan(kind, {}, { ...ENV, frame: 999 }), `${kind} must not vary with the frame`)
  }
})

test('a hard key edge reaches the shader as a narrow ramp, not a zero-width one', () => {
  const [hard] = plan('chroma-key', { smoothness: 0 })
  assert.ok((hard?.uniforms.u_soft as number) > 0, 'smoothstep with equal edges is undefined in GLSL')
  assert.equal(plan('chroma-key', { smoothness: 0.3 })[0]?.uniforms.u_soft, 0.3)
})
