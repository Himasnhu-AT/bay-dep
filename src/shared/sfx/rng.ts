/**
 * The only source of randomness in the sound palette: a seeded 32-bit generator (mulberry32).
 *
 * `Math.random` would make a score render differently each time, and a sound file is
 * content-addressed — the same score has to be the same bytes, or every call mints a new asset.
 */

export type Rng = () => number

/** Uniform in [0, 1). */
export function rng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A stream of its own for the `index`th event of a score, so one event's noise does not depend
 * on how many samples the events before it drew.
 */
export function eventRng(seed: number, index: number): Rng {
  return rng((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0)
}
