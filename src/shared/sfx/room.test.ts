/**
 * The room, measured on an impulse and then on every material. Run with `pnpm test`.
 *
 * The claim under test is "one room": the tail a thump leaves and the tail a bell leaves decay
 * at the same rate, because both went to the same network. Decay is read the way a room's is
 * read — Schroeder's backward integral of the squared response, a line fitted between −5 and
 * −25 dB — and the reading is shown to move when the room does, so a tail that ignored
 * `decaySeconds` could not pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reverb, roomSeconds } from './room'
import { mixScore } from './render'
import { DEFAULT_ROOM, SFX_MATERIAL_NAMES, SFX_SAMPLE_RATE, type SfxMaterial, type SfxRoom, type SfxScore } from './score'
import { voiceSeconds } from './voices'

const FS = SFX_SAMPLE_RATE

function impulse(seconds: number, channel: 'left' | 'right' | 'both' = 'both'): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(Math.round(seconds * FS))
  const right = new Float32Array(left.length)
  if (channel !== 'right') left[0] = 1
  if (channel !== 'left') right[0] = 1
  return { left, right }
}

const energy = (samples: Float32Array, from = 0, to = samples.length): number => {
  let sum = 0
  for (let i = from; i < to; i += 1) sum += samples[i]! ** 2
  return sum
}

/** Seconds to fall 60 dB, from the slope of the energy decay curve between −5 and −25 dB. */
function decayTime(left: Float32Array, right: Float32Array, from: number): number {
  const n = left.length - from
  const remaining = new Float64Array(n)
  let sum = 0
  for (let i = n - 1; i >= 0; i -= 1) {
    sum += left[from + i]! ** 2 + right[from + i]! ** 2
    remaining[i] = sum
  }
  const level = (i: number): number => 10 * Math.log10(remaining[i]! / remaining[0]!)
  let at5 = -1
  let at25 = -1
  for (let i = 0; i < n; i += 1) {
    if (at5 < 0 && level(i) <= -5) at5 = i
    if (level(i) <= -25) {
      at25 = i
      break
    }
  }
  assert.ok(at5 >= 0 && at25 > at5, 'the tail falls 25 dB inside the buffer')
  return ((at25 - at5) / FS) * 3
}

function wetOf(room: Partial<SfxRoom>, channel: 'left' | 'right' | 'both' = 'both', seconds = 4): { left: Float32Array; right: Float32Array } {
  const send = impulse(seconds, channel)
  return reverb(send.left, send.right, { ...DEFAULT_ROOM, ...room }, FS)
}

test('the room decays in the time it is asked to, and a longer room is longer', () => {
  const one = wetOf({ decaySeconds: 1 })
  const measured = decayTime(one.left, one.right, 0)
  // Broadband, so a little under the low-frequency figure: the highs are damped.
  assert.ok(measured > 0.7 && measured < 1.1, `asked for 1 s, measured ${measured.toFixed(2)} s`)
  const two = wetOf({ decaySeconds: 2 })
  const ratio = decayTime(two.left, two.right, 0) / measured
  assert.ok(ratio > 1.7 && ratio < 2.3, `doubling the decay multiplied it by ${ratio.toFixed(2)}`)
})

test('with no damping the room decays in exactly the time asked; damping shortens only the highs', () => {
  const dry = wetOf({ decaySeconds: 1, damping: 0 })
  const flat = decayTime(dry.left, dry.right, 0)
  assert.ok(Math.abs(flat - 1) < 0.08, `undamped: ${flat.toFixed(3)} s`)
  const soft = wetOf({ decaySeconds: 1, damping: 1 })
  assert.ok(decayTime(soft.left, soft.right, 0) < flat * 0.9, 'a fully damped room is shorter broadband')
})

test('nothing comes back before the pre-delay and the first reflection, and moving the pre-delay moves it', () => {
  const firstSound = (preDelayMs: number): number => {
    const wet = wetOf({ preDelayMs }, 'both', 1)
    for (let i = 0; i < wet.left.length; i += 1) if (wet.left[i] !== 0 || wet.right[i] !== 0) return i
    return -1
  }
  const firstReflection = Math.round(0.0071 * FS)
  assert.equal(firstSound(15), Math.round(0.015 * FS) + firstReflection)
  assert.equal(firstSound(0), firstReflection)
  assert.equal(firstSound(40), Math.round(0.04 * FS) + firstReflection)
})

test('a room with wet 0 returns silence, and roomSeconds says it adds no time', () => {
  const wet = wetOf({ wet: 0 })
  assert.equal(energy(wet.left) + energy(wet.right), 0)
  assert.equal(roomSeconds({ ...DEFAULT_ROOM, wet: 0 }), 0)
  assert.equal(roomSeconds(DEFAULT_ROOM), DEFAULT_ROOM.preDelayMs / 1000 + DEFAULT_ROOM.decaySeconds)
  // The control: the same impulse into an open room is not silent.
  const open = wetOf({})
  assert.ok(energy(open.left) + energy(open.right) > 0.1)
})

test('in the default room a hit sent at 1 returns about as much energy as it had dry', () => {
  const wet = wetOf({})
  const returned = (energy(wet.left) + energy(wet.right)) / 2
  assert.ok(returned > 0.7 && returned < 1.4, `returned ${returned.toFixed(2)} of the dry energy`)
  // And wet scales it as a level: half the return is a quarter of the energy.
  const half = wetOf({ wet: 0.5 })
  assert.ok(Math.abs((energy(half.left) + energy(half.right)) / 2 / returned - 0.25) < 0.01)
})

test('a hit on the left starts on the left, and the tail fills both sides', () => {
  const wet = wetOf({}, 'left')
  // Before any line has been round the matrix once: pre-delay plus the shortest line, twice.
  const early = Math.round(0.07 * FS)
  assert.ok(energy(wet.left, 0, early) > 4 * energy(wet.right, 0, early), 'the first 70 ms is on the side the hit was')
  const lateLeft = energy(wet.left, FS / 2)
  const lateRight = energy(wet.right, FS / 2)
  assert.ok(lateLeft / lateRight > 0.5 && lateLeft / lateRight < 2, `after half a second: left/right ${(lateLeft / lateRight).toFixed(2)}`)
  // The mirror image, as the control that "left" is not just where this room is louder.
  const mirrored = wetOf({}, 'right')
  assert.ok(energy(mirrored.right, 0, early) > 4 * energy(mirrored.left, 0, early))
})

test('the room rings no louder for a longer input than its decay allows: it is stable', () => {
  const wet = wetOf({ decaySeconds: 3, damping: 0 }, 'both', 12)
  assert.ok(energy(wet.left, 11 * FS) < energy(wet.left, 0, FS) * 1e-5, 'eleven seconds on, a 3 s room has died')
  for (const sample of wet.left) assert.ok(Number.isFinite(sample))
})

/** One hit of a material, all of it sent to the room, left to ring. */
function tailOf(material: SfxMaterial, decaySeconds: number): number {
  const score: SfxScore = {
    durationSeconds: 0.5,
    events: [{ t: 0, material, gain: 1, pan: 0, pitch: 0, size: 0.25, brightness: 0.5, send: 1 }],
    room: { ...DEFAULT_ROOM, decaySeconds, damping: 0 },
    seed: 3,
    ceilingDb: -8,
    tail: 'ring'
  }
  const bus = mixScore(score)
  // Read from where the voice itself has ended: what is left is the room alone.
  return decayTime(bus.left, bus.right, Math.round((voiceSeconds(material, 0.25) + 0.05) * FS))
}

test('every material rings in the same room: the tail each leaves decays at the same rate', () => {
  const times = SFX_MATERIAL_NAMES.map((material) => ({ material, seconds: tailOf(material, 1.2) }))
  for (const { material, seconds } of times) {
    assert.ok(Math.abs(seconds - 1.2) < 0.2, `${material} rings for ${seconds.toFixed(2)} s in a 1.2 s room`)
  }
  const all = times.map((time) => time.seconds)
  assert.ok(Math.max(...all) / Math.min(...all) < 1.2, `the materials disagree: ${times.map((t) => `${t.material} ${t.seconds.toFixed(2)}`).join(', ')}`)
  // The control: the same measurement in a different room reads differently for each of them.
  for (const material of SFX_MATERIAL_NAMES) {
    const short = tailOf(material, 0.5)
    assert.ok(short < 0.7, `${material} in a 0.5 s room rings ${short.toFixed(2)} s`)
  }
})
