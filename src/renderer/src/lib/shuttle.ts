/**
 * JKL shuttle.
 *
 * L plays forward, and each further L doubles the rate up to 8×. J does the same backwards. K
 * stops, and holding K while tapping J or L steps one frame. What the engine can do sets how each
 * rate plays:
 *
 * - **1× forward is real playback** (`setPlaying(true)`): the clock, the audio and the preroll.
 * - **Any other rate is a shuttle**, not playback. The playhead is moved at that rate against the
 *   wall clock, and each frame is drawn the way a scrub draws it. There is no sound. The clock and
 *   the media elements only play forwards at 1×, and a 4× or reversed picture from `<video>`
 *   elements would mean seeking every frame anyway, which is what a scrub already does. So J
 *   really plays backwards, silently, at up to 8×. It is not a key that steps back one frame.
 *
 * The rate state machine is `nextShuttle`, pure, and tested. The driver around it is the only
 * part that touches the store.
 */

import { selectDuration, selectFps, useEditor } from '@/store/editor'

export const MAX_SHUTTLE_RATE = 8

export interface ShuttleInput {
  /** The rate playing now: 0 stopped, 1 normal playback, others a shuttle; negative is reverse. */
  rate: number
  /** K is being held down. */
  kHeld: boolean
}

export interface ShuttleOutput {
  rate: number
  /** A single-frame step to take instead of playing (K held with J or L). */
  step?: 1 | -1
}

export function nextShuttle({ rate, kHeld }: ShuttleInput, key: 'J' | 'K' | 'L'): ShuttleOutput {
  if (key === 'K') return { rate: 0 }
  const direction = key === 'L' ? 1 : -1
  if (kHeld) return { rate: 0, step: direction }
  // Pressing against the current direction starts over at 1× that way, as every NLE does.
  if (rate === 0 || Math.sign(rate) !== direction) return { rate: direction }
  return { rate: direction * Math.min(MAX_SHUTTLE_RATE, Math.abs(rate) * 2) }
}

/** Where a J/K/L came from: a key on the keyboard, or a menu item / button that has no key to hold. */
export type ShuttleSource = 'key' | 'menu' | 'ui'

/**
 * Whether K counts as held after this press. Only a K *key* goes down and later comes up; the
 * menu's Playback › Stop and a Stop button have no key-up, so marking K held for them left every
 * later L or J stepping one frame until a real K was pressed and released.
 */
export function holdsK(key: 'J' | 'K' | 'L', source: ShuttleSource, held: boolean): boolean {
  return key === 'K' && source === 'key' ? true : held
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

let shuttleRate = 0
let handle: number | null = null
let anchorTime = 0
let anchorFrame = 0
let kHeld = false
let listening = false

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('keydown', (event) => {
    if (event.key === 'k' || event.key === 'K') kHeld = true
  })
  window.addEventListener('keyup', (event) => {
    if (event.key === 'k' || event.key === 'K') kHeld = false
  })
  window.addEventListener('blur', () => {
    kHeld = false
  })
}

/** The rate playing now, whether it is the engine's playback or a shuttle. */
export function currentRate(): number {
  if (handle !== null) return shuttleRate
  return useEditor.getState().playing ? 1 : 0
}

/** Stops a shuttle if one is running, and says whether one was. It leaves real playback alone. */
export function stopShuttle(): boolean {
  const running = handle !== null
  if (handle !== null) cancelAnimationFrame(handle)
  handle = null
  shuttleRate = 0
  return running
}

function tick(time: number): void {
  const state = useEditor.getState()
  // Anything else taking the playhead ends the shuttle: a scrub, or playback started with Space.
  if (state.scrubbing || state.playing) {
    stopShuttle()
    return
  }
  const fps = selectFps(state)
  const end = selectDuration(state)
  const frame = Math.round(anchorFrame + ((time - anchorTime) / 1000) * fps * shuttleRate)
  if (frame <= 0 || frame >= end) {
    state.setPlayhead(Math.max(0, Math.min(frame, end)))
    stopShuttle()
    return
  }
  if (frame !== state.playhead) state.setPlayhead(frame)
  handle = requestAnimationFrame(tick)
}

function play(rate: number): void {
  const state = useEditor.getState()
  stopShuttle()
  if (rate === 0) {
    state.setPlaying(false)
    return
  }
  if (rate === 1) {
    state.setPlaying(true)
    return
  }
  state.setPlaying(false)
  shuttleRate = rate
  anchorFrame = state.playhead
  anchorTime = performance.now()
  handle = requestAnimationFrame(tick)
}

/** J, K or L pressed — on the keyboard (`'key'`), or chosen from a menu or button. */
export function shuttle(key: 'J' | 'K' | 'L', source: ShuttleSource = 'key'): void {
  listen()
  // Set here as well as by the listener: the first K arrives before the listener exists. Only
  // for the key itself — a menu Stop has no key-up to clear it.
  kHeld = holdsK(key, source, kHeld)
  const next = nextShuttle({ rate: currentRate(), kHeld }, key)
  if (next.step !== undefined) {
    stopShuttle()
    const state = useEditor.getState()
    state.setPlaying(false)
    state.nudgePlayhead(next.step)
    return
  }
  play(next.rate)
  if (Math.abs(next.rate) > 1 || next.rate < 0) {
    useEditor.getState().notify(`${next.rate < 0 ? 'Backwards' : 'Forwards'} ${Math.abs(next.rate)}×, without sound. K stops.`)
  }
}
