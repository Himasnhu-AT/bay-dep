/**
 * The audio-effect catalogue, the equaliser table, the plan and the chain operations — the pure
 * half. What ffmpeg actually does with these arguments is `main/audio-fx/*.test.ts`.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUDIO_EFFECT_CATALOG,
  AUDIO_EFFECT_PRESETS,
  BUTTERWORTH_Q,
  MAX_AUDIO_EFFECTS,
  NO_EFFECTS,
  activeEffects,
  afftdnFloor,
  applyEffectOp,
  bakeFilterGraph,
  bakeSignature,
  biquadCoefficients,
  biquadOf,
  biquadResponseDb,
  checkEffect,
  compressorOutDb,
  defaultEffect,
  ffmpegBands,
  gateOutDb,
  isIdentity,
  itemEffectPlan,
  limiterOutDb,
  quietLevelDb,
  stagesBeforeDenoise,
  trackBusBands,
  webAudioBiquad,
  type AudioEffect,
  type AudioEffectKind,
  type BiquadSpec
} from './audio-effects'

const fx = (kind: AudioEffectKind, params: Record<string, number> = {}, extra: Partial<AudioEffect> = {}): AudioEffect => {
  const base = defaultEffect(kind, `${kind}-id`)
  return { ...base, params: { ...base.params, ...params }, ...extra }
}
let counter = 0
const makeId = (): string => `id${(counter += 1)}`

/**
 * A `BiquadFilterNode`'s coefficients from the values set on it, written out from the Web Audio
 * specification on its own — Q in dB for the two passes — so the conversion in `webAudioBiquad`
 * is checked against the spec rather than against the function it feeds.
 */
function nodeCoefficients(node: { type: string; frequency: number; Q: number; gain: number }, rate: number): number[] {
  const w0 = (2 * Math.PI * node.frequency) / rate
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const A = Math.pow(10, node.gain / 40)
  const alphaQ = sin / (2 * node.Q)
  const alphaQdB = sin / (2 * Math.pow(10, node.Q / 20))
  const alphaS = (sin / 2) * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2)
  let c: number[]
  switch (node.type) {
    case 'lowpass':
      c = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alphaQdB, -2 * cos, 1 - alphaQdB]
      break
    case 'highpass':
      c = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alphaQdB, -2 * cos, 1 - alphaQdB]
      break
    case 'peaking':
      c = [1 + alphaQ * A, -2 * cos, 1 - alphaQ * A, 1 + alphaQ / A, -2 * cos, 1 - alphaQ / A]
      break
    case 'lowshelf':
      c = [
        A * (A + 1 - (A - 1) * cos + 2 * alphaS * Math.sqrt(A)), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - 2 * alphaS * Math.sqrt(A)),
        A + 1 + (A - 1) * cos + 2 * alphaS * Math.sqrt(A), -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - 2 * alphaS * Math.sqrt(A)
      ]
      break
    default:
      c = [
        A * (A + 1 + (A - 1) * cos + 2 * alphaS * Math.sqrt(A)), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - 2 * alphaS * Math.sqrt(A)),
        A + 1 - (A - 1) * cos + 2 * alphaS * Math.sqrt(A), 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - 2 * alphaS * Math.sqrt(A)
      ]
  }
  return c.map((v) => v / c[3]!)
}

const SPECIMENS: BiquadSpec[] = [
  { type: 'highpass', frequency: 80, q: BUTTERWORTH_Q, gainDb: 0 },
  { type: 'highpass', frequency: 1000, q: 3, gainDb: 0 },
  { type: 'lowpass', frequency: 4000, q: BUTTERWORTH_Q, gainDb: 0 },
  { type: 'lowpass', frequency: 12000, q: 0.5, gainDb: 0 },
  { type: 'lowshelf', frequency: 300, q: BUTTERWORTH_Q, gainDb: 9 },
  { type: 'highshelf', frequency: 5000, q: BUTTERWORTH_Q, gainDb: -12 },
  { type: 'peaking', frequency: 1000, q: 2, gainDb: 12 },
  { type: 'peaking', frequency: 8000, q: 6, gainDb: -18 }
]

test('what is set on a BiquadFilterNode gives, by the Web Audio formulas, the section the table describes', () => {
  for (const spec of SPECIMENS) {
    const node = webAudioBiquad(spec)
    const c = biquadCoefficients(spec, 48000)
    const mine = [c.b0, c.b1, c.b2, c.a0, c.a1, c.a2].map((v) => v / c.a0)
    const theirs = nodeCoefficients(node, 48000)
    for (const [i, v] of mine.entries()) {
      assert.ok(Math.abs(v - theirs[i]!) < 1e-12, `${spec.type} ${spec.frequency} Hz: coefficient ${i} is ${v}, the node computes ${theirs[i]}`)
    }
  }
})

test('a high-pass node handed the linear Q would be a different filter: that is what the conversion removes', () => {
  const spec: BiquadSpec = { type: 'highpass', frequency: 1000, q: BUTTERWORTH_Q, gainDb: 0 }
  // The specimen must be able to show the fault: a node reading 0.707 as dB is not Butterworth.
  const wrong = nodeCoefficients({ type: 'highpass', frequency: 1000, Q: spec.q, gain: 0 }, 48000)
  const right = nodeCoefficients(webAudioBiquad(spec), 48000)
  const atCorner = (c: number[]): number => {
    const w = (2 * Math.PI * 1000) / 48000
    const re = (k: number[]): number => k[0]! + k[1]! * Math.cos(w) + k[2]! * Math.cos(2 * w)
    const im = (k: number[]): number => -(k[1]! * Math.sin(w) + k[2]! * Math.sin(2 * w))
    const n = c.slice(0, 3)
    const d = c.slice(3)
    return 10 * Math.log10((re(n) ** 2 + im(n) ** 2) / (re(d) ** 2 + im(d) ** 2))
  }
  assert.ok(Math.abs(atCorner(right) - -3.0103) < 0.01, `Butterworth is −3.01 dB at its corner; got ${atCorner(right)}`)
  assert.ok(atCorner(wrong) - atCorner(right) > 3, `the unconverted Q must read more than 3 dB different (${atCorner(wrong)})`)
  assert.ok(Math.abs(webAudioBiquad(spec).Q - -3.0103) < 0.001, 'Butterworth is −3.01 dB of resonance to a node')
})

test('each band does what its name says, at the frequencies that define it', () => {
  const at = (spec: BiquadSpec, f: number): number => biquadResponseDb(spec, f, 48000)
  const hp: BiquadSpec = { type: 'highpass', frequency: 200, q: BUTTERWORTH_Q, gainDb: 0 }
  assert.ok(Math.abs(at(hp, 200) + 3.0103) < 0.01, 'a high-pass is −3 dB at its frequency')
  assert.ok(Math.abs(at(hp, 25) - at(hp, 50) + 12) < 0.3, 'and falls 12 dB per octave below it')
  assert.ok(Math.abs(at(hp, 5000)) < 0.01, 'and leaves what is above alone')
  const lp: BiquadSpec = { type: 'lowpass', frequency: 2000, q: BUTTERWORTH_Q, gainDb: 0 }
  assert.ok(Math.abs(at(lp, 2000) + 3.0103) < 0.01)
  assert.ok(Math.abs(at(lp, 100)) < 0.01)
  assert.ok(at(lp, 16000) < -30)
  const bell: BiquadSpec = { type: 'peaking', frequency: 1000, q: 2, gainDb: 9 }
  assert.ok(Math.abs(at(bell, 1000) - 9) < 0.001, 'a band has its gain at its centre')
  assert.ok(Math.abs(at(bell, 60)) < 0.1 && Math.abs(at(bell, 15000)) < 0.1, 'and none far from it')
  const low: BiquadSpec = { type: 'lowshelf', frequency: 300, q: BUTTERWORTH_Q, gainDb: 8 }
  assert.ok(Math.abs(at(low, 20) - 8) < 0.1, 'a low shelf has its gain at the bottom')
  assert.ok(Math.abs(at(low, 300) - 4) < 0.01, 'half of it at its frequency')
  assert.ok(Math.abs(at(low, 10000)) < 0.05, 'and none at the top')
  const high: BiquadSpec = { type: 'highshelf', frequency: 5000, q: BUTTERWORTH_Q, gainDb: -10 }
  assert.ok(Math.abs(at(high, 20000) + 10) < 0.2)
  assert.ok(Math.abs(at(high, 5000) + 5) < 0.01)
  assert.ok(Math.abs(at(high, 100)) < 0.01)
})

test('the preview at 44.1 kHz and the export at 48 kHz are the same equaliser where it is heard', () => {
  // A preview context runs at the output device's rate; export is always 48 kHz. The two designs
  // are the same analogue prototype warped to different Nyquists, so they part only near the top.
  let worst = 0
  for (const spec of SPECIMENS) {
    for (let f = 20; f <= 16000; f *= 1.06) {
      const a = biquadResponseDb(spec, f, 44100)
      const b = biquadResponseDb(spec, f, 48000)
      // Where either is still above −12 dB: deeper in a stop band a dB is not heard.
      if (Math.max(a, b) > -12) worst = Math.max(worst, Math.abs(a - b))
    }
  }
  assert.ok(worst < 1, `the two rates differ by ${worst.toFixed(2)} dB at most below 16 kHz (stated bound: 1 dB)`)
  assert.ok(worst > 0.01, 'and they do differ — the bound is measured, not vacuous')
})

test('an effect that changes nothing costs nothing: no plan, no filter, no bake', () => {
  const nothing: AudioEffect[] = [
    fx('bell', { gain: 0 }),
    fx('lowshelf'),
    fx('compressor', { ratio: 1, makeup: 0 }),
    fx('gate', { range: 0 }),
    fx('denoise', { strength: 0 }),
    fx('highpass', {}, { enabled: false })
  ]
  for (const each of nothing.slice(0, 5)) assert.equal(isIdentity(each), true, each.kind)
  assert.equal(itemEffectPlan({ audioEffects: nothing }, { audioEffects: nothing }), NO_EFFECTS)
  assert.equal(itemEffectPlan(undefined, {}), NO_EFFECTS)
  assert.equal(ffmpegBands(trackBusBands({ audioEffects: nothing })), null)
  // The twin: the same kinds moved off their identity are all active.
  const something = [fx('bell', { gain: 1 }), fx('compressor', { ratio: 1, makeup: 3 }), fx('gate'), fx('denoise'), fx('highpass')]
  assert.equal(activeEffects(something).length, something.length)
  assert.notEqual(itemEffectPlan(undefined, { audioEffects: something }), NO_EFFECTS)
})

test('a clip bakes its chain up to its last dynamics stage and runs the bands after it live', () => {
  const chain = [fx('highpass'), fx('compressor'), fx('bell', { gain: 3 }), fx('highshelf', { gain: 2 })]
  const plan = itemEffectPlan(undefined, { audioEffects: chain })
  assert.deepEqual(plan.bake.map((e) => e.kind), ['highpass', 'compressor'], 'the band before the compressor is baked with it: order matters to a compressor')
  assert.deepEqual(plan.clip.map((b) => b.type), ['peaking', 'highshelf'])
  const eqOnly = itemEffectPlan(undefined, { audioEffects: [fx('highpass'), fx('bell', { gain: 3 })] })
  assert.equal(eqOnly.bake.length, 0, 'an equaliser alone bakes nothing')
  assert.deepEqual(eqOnly.clip.map((b) => b.type), ['highpass', 'peaking'])
})

test('a track’s dynamics are baked into each clip after the clip’s own chain; only its later bands are on the bus', () => {
  const track = { audioEffects: [fx('lowshelf', { gain: 2 }), fx('limiter'), fx('highshelf', { gain: -3 })] }
  const item = { audioEffects: [fx('denoise'), fx('bell', { gain: 4 })] }
  const plan = itemEffectPlan(track, item)
  assert.deepEqual(plan.bake.map((e) => e.kind), ['denoise', 'bell', 'lowshelf', 'limiter'])
  assert.deepEqual(plan.clip, [], 'nothing of the clip is left live once the track bakes after it')
  assert.deepEqual(trackBusBands(track).map((b) => b.type), ['highshelf'])
  // A track of bands only bakes nothing and puts all of them on the bus.
  const eqTrack = { audioEffects: [fx('highpass'), fx('bell', { gain: 2 })] }
  assert.equal(itemEffectPlan(eqTrack, {}).bake.length, 0)
  assert.deepEqual(itemEffectPlan(eqTrack, {}).clip, [])
  assert.deepEqual(trackBusBands(eqTrack).map((b) => b.type), ['highpass', 'peaking'])
})

test('a bake is named by what it sounds like: not by ids, not by stages that are off', () => {
  const a = [fx('compressor', { threshold: -20 }, { id: 'one' })]
  const b = [fx('compressor', { threshold: -20 }, { id: 'two' })]
  assert.equal(bakeSignature(a), bakeSignature(b))
  assert.notEqual(bakeSignature(a), bakeSignature([fx('compressor', { threshold: -21 })]))
  assert.notEqual(bakeSignature(a), bakeSignature([fx('gate')]))
  assert.notEqual(bakeSignature([fx('highpass'), fx('compressor')]), bakeSignature([fx('compressor'), fx('highpass')]), 'order is part of the sound')
})

test('a refusal names the legal range and unit; the nearest legal value is accepted', () => {
  const tooHigh = checkEffect({ kind: 'compressor', params: { ratio: 50 } }, 'x')
  assert.equal(tooHigh.ok, false)
  assert.match(tooHigh.ok ? '' : tooHigh.error, /compressor\.ratio must be 1 to 20/)
  assert.match(tooHigh.ok ? '' : tooHigh.error, /got 50/)
  assert.equal(checkEffect({ kind: 'compressor', params: { ratio: 20 } }, 'x').ok, true)

  const hz = checkEffect({ kind: 'highpass', params: { frequency: 5 } }, 'x')
  assert.match(hz.ok ? '' : hz.error, /highpass\.frequency must be 20 to 20000 Hz; got 5/)
  assert.equal(checkEffect({ kind: 'highpass', params: { frequency: 20 } }, 'x').ok, true)

  const nan = checkEffect({ kind: 'bell', params: { gain: Number.NaN } }, 'x')
  assert.match(nan.ok ? '' : nan.error, /bell\.gain must be -24 to 24 dB/)

  const kind = checkEffect({ kind: 'reverb' }, 'x')
  assert.match(kind.ok ? '' : kind.error, /The kinds are: highpass, lowpass, lowshelf, highshelf, bell, compressor, gate, deesser, limiter, denoise/)

  const param = checkEffect({ kind: 'limiter', params: { threshold: -3 } }, 'x')
  assert.match(param.ok ? '' : param.error, /limiter has no parameter "threshold"\. Its parameters: ceiling -24 to 0 dB/)

  const filled = checkEffect({ kind: 'gate', params: { threshold: -50 } }, 'x')
  assert.ok(filled.ok)
  assert.deepEqual(Object.keys(filled.value.params).sort(), ['attack', 'knee', 'range', 'ratio', 'release', 'threshold'], 'left-out parameters take their defaults')
  assert.equal(filled.value.params.threshold, -50)
})

test('a chain is edited one operation at a time, and each refusal says what would be accepted', () => {
  let list: AudioEffect[] = []
  const apply = (op: Parameters<typeof applyEffectOp>[1]): void => {
    const next = applyEffectOp(list, op, makeId)
    assert.ok(next.ok, next.ok ? '' : next.error)
    list = next.value
  }
  const refused = (op: Parameters<typeof applyEffectOp>[1]): string => {
    const next = applyEffectOp(list, op, makeId)
    assert.equal(next.ok, false, `expected ${JSON.stringify(op)} to be refused`)
    return next.ok ? '' : next.error
  }

  assert.match(refused({ op: 'remove', effectId: 'nope' }), /the chain is empty/)
  apply({ op: 'add', kind: 'highpass' })
  apply({ op: 'add', kind: 'compressor', params: { ratio: 4 } })
  apply({ op: 'add', kind: 'bell', params: { gain: 3 }, index: 0 })
  assert.deepEqual(list.map((e) => e.kind), ['bell', 'highpass', 'compressor'])
  assert.equal(new Set(list.map((e) => e.id)).size, 3, 'ids are unique')
  const [bell, highpass, compressor] = list as [AudioEffect, AudioEffect, AudioEffect]

  apply({ op: 'edit', effectId: compressor.id, params: { threshold: -24 } })
  assert.equal(list[2]!.params.threshold, -24)
  assert.equal(list[2]!.params.ratio, 4, 'an edit keeps the parameters it does not name')
  assert.equal(list[2]!.id, compressor.id)
  assert.match(refused({ op: 'edit', effectId: compressor.id, params: { ratio: 0.5 } }), /compressor\.ratio must be 1 to 20/)
  assert.match(refused({ op: 'edit', effectId: 'gone', enabled: false }), new RegExp(`The chain holds: ${bell.id} \\(bell\\), ${highpass.id} \\(highpass\\)`))
  assert.match(refused({ op: 'edit', effectId: compressor.id }), /Nothing to change/)

  apply({ op: 'edit', effectId: highpass.id, enabled: false })
  assert.equal(list[1]!.enabled, false)
  apply({ op: 'edit', effectId: highpass.id, enabled: true })
  assert.equal('enabled' in list[1]!, false, 'on is stored as absence')

  apply({ op: 'move', effectId: compressor.id, toIndex: 0 })
  assert.deepEqual(list.map((e) => e.kind), ['compressor', 'bell', 'highpass'])
  assert.match(refused({ op: 'move', effectId: compressor.id, toIndex: 3 }), /toIndex must be a whole number from 0 \(first\) to 2 \(last\); got 3/)
  apply({ op: 'move', effectId: compressor.id, toIndex: 2 })

  apply({ op: 'remove', effectId: bell.id })
  assert.deepEqual(list.map((e) => e.kind), ['highpass', 'compressor'])
  apply({ op: 'clear' })
  assert.deepEqual(list, [])

  for (let i = 0; i < MAX_AUDIO_EFFECTS; i += 1) apply({ op: 'add', kind: 'bell' })
  assert.match(refused({ op: 'add', kind: 'bell' }), new RegExp(`at most ${MAX_AUDIO_EFFECTS} effects`))
})

test('a preset is data: it writes ordinary effects, every one inside its range, that are then edited like any other', () => {
  assert.deepEqual(AUDIO_EFFECT_PRESETS.map((p) => p.name).slice(0, 3), ['Podcast voice', 'Telephone', 'Radio'])
  for (const preset of AUDIO_EFFECT_PRESETS) {
    const made = applyEffectOp([], { op: 'preset', preset: preset.slug }, makeId)
    assert.ok(made.ok, `${preset.name}: ${made.ok ? '' : made.error}`)
    assert.equal(made.value.length, preset.effects.length)
    assert.equal(activeEffects(made.value).length, made.value.length, `${preset.name}: every stage does something`)
    for (const [i, effect] of made.value.entries()) {
      assert.equal(effect.kind, preset.effects[i]!.kind)
      assert.deepEqual(Object.keys(effect).sort(), ['id', 'kind', 'params'], 'nothing marks it as having come from a preset')
    }
    const first = made.value[0]!
    const edited = applyEffectOp(made.value, { op: 'edit', effectId: first.id, enabled: false }, makeId)
    assert.ok(edited.ok && edited.value[0]!.enabled === false)
  }
  const byName = applyEffectOp([], { op: 'preset', preset: 'Podcast Voice' }, makeId)
  assert.ok(byName.ok, 'a preset is found by its name as well as its slug')
  const appended = applyEffectOp([fx('highpass')], { op: 'preset', preset: 'telephone', mode: 'append' }, makeId)
  assert.ok(appended.ok && appended.value[0]!.kind === 'highpass' && appended.value.length === 5)
  const replaced = applyEffectOp([fx('gate')], { op: 'preset', preset: 'telephone' }, makeId)
  assert.ok(replaced.ok && replaced.value.every((e) => e.kind !== 'gate'))
  const unknown = applyEffectOp([], { op: 'preset', preset: 'cathedral' }, makeId)
  assert.match(unknown.ok ? '' : unknown.error, /The presets are: "podcast-voice" \(Podcast voice\), "telephone" \(Telephone\), "radio" \(Radio\)/)
  // The telephone band is what the name promises: speech frequencies kept, the rest gone.
  const phone = applyEffectOp([], { op: 'preset', preset: 'telephone' }, makeId)
  assert.ok(phone.ok)
  const bands = phone.value.map(biquadOf).filter((b): b is BiquadSpec => b !== null)
  const level = (f: number): number => bands.reduce((sum, b) => sum + biquadResponseDb(b, f, 48000), 0)
  assert.ok(level(60) < -20 && level(12000) < -20, `a telephone carries neither 60 Hz (${level(60).toFixed(1)}) nor 12 kHz (${level(12000).toFixed(1)})`)
  assert.ok(level(1000) > -1, `and does carry 1 kHz (${level(1000).toFixed(1)})`)
})

test('the static curves are the textbook ones', () => {
  const c = { threshold: -18, ratio: 4, knee: 6 }
  assert.equal(compressorOutDb(-40, c), -40, 'unity below the knee')
  assert.ok(Math.abs(compressorOutDb(-6, c) - (-18 + 12 / 4)) < 1e-9, 'slope 1/ratio above it')
  // Continuous at both edges of the knee.
  assert.ok(Math.abs(compressorOutDb(-21.0001, c) - compressorOutDb(-20.9999, c)) < 1e-3)
  assert.ok(Math.abs(compressorOutDb(-15.0001, c) - compressorOutDb(-14.9999, c)) < 1e-3)
  assert.ok(compressorOutDb(-18, c) < -18 && compressorOutDb(-18, c) > -18 - 1, 'the knee bends below the corner')
  assert.equal(compressorOutDb(-30, { ...c, makeup: 5 }), -25)
  const g = { threshold: -40, ratio: 2, range: -20 }
  assert.equal(gateOutDb(-30, g), -30)
  assert.equal(gateOutDb(-45, g), -50)
  assert.equal(gateOutDb(-70, g), -90, 'never turned down by more than the range')
  assert.equal(limiterOutDb(-20, { ceiling: -6, gain: 6 }), -14)
  assert.equal(limiterOutDb(-3, { ceiling: -6, gain: 6 }), -6)
})

test('the noise level is read from the quiet stretches, and the floor handed to afftdn sits just over it', () => {
  // Speech at −20 with room noise at −55 between the words, and digital silence at the head.
  const windows = [...Array(5).fill(-120), ...Array(30).fill(-55), ...Array(65).fill(-20)]
  assert.equal(quietLevelDb(windows), -55)
  assert.equal(quietLevelDb([-120, -130, Number.NEGATIVE_INFINITY]), Number.NEGATIVE_INFINITY, 'silence has no noise to measure')
  assert.equal(afftdnFloor(-55), -49)
  assert.equal(afftdnFloor(-10), -20, 'never past what the filter accepts')
  assert.equal(afftdnFloor(-200), -80)
  assert.equal(afftdnFloor(Number.NEGATIVE_INFINITY), -50)
  assert.deepEqual(stagesBeforeDenoise([fx('highpass'), fx('denoise'), fx('gate')])?.map((e) => e.kind), ['highpass'])
  assert.equal(stagesBeforeDenoise([fx('highpass'), fx('gate')]), null)
  assert.match(bakeFilterGraph([fx('denoise')], -37), /afftdn=nr=20\.000000:nf=-37\.000000/)
})

test('every kind is in the catalogue with a unit, a range that holds its default, and a hint', () => {
  for (const spec of AUDIO_EFFECT_CATALOG) {
    assert.ok(spec.params.length > 0, spec.kind)
    for (const p of spec.params) {
      assert.ok(p.min < p.max && p.default >= p.min && p.default <= p.max, `${spec.kind}.${p.key}`)
      assert.ok(['Hz', 'dB', 'ms', 'ratio', 'Q', '%'].includes(p.unit))
      assert.ok(p.hint.length > 10)
    }
  }
})
