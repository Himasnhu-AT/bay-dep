/**
 * A grading wheel's arithmetic: one lift/gamma/gain `{ r, g, b }` as a **master** (the mean of the
 * three, exactly what the old averaged slider showed and set) plus a **balance** — the offset of
 * each channel from that mean, drawn as a puck on a disc.
 *
 * Nothing about the stored value changes: a wheel reads the same `{ r, g, b }` the model has always
 * held and writes one back, so an existing project's grade means what it meant. The mapping is
 * exact both ways (`wheelFromBalance(balanceOf(w)) === w`), which is what lets a person nudge the
 * puck without the master drifting, and the master without the cast drifting.
 */

export interface WheelRgb {
  r: number
  g: number
  b: number
}

export interface WheelBalance {
  /** The mean of r, g and b — the old averaged slider's value. */
  master: number
  /** The puck, in channel units: +x right, +y up. Its length is the size of the cast. */
  x: number
  y: number
}

/**
 * Where each channel pulls the puck, in degrees clockwise from straight up. Close to a
 * vectorscope's (and so Resolve's wheels'): red at about eleven o'clock, blue at four, green at
 * seven — spaced exactly 120° apart, which is what makes the projection invert exactly.
 */
export const WHEEL_AXES_DEG: Record<keyof WheelRgb, number> = { r: 347, g: 227, b: 107 }

const axis = (channel: keyof WheelRgb): [number, number] => {
  const rad = (WHEEL_AXES_DEG[channel] * Math.PI) / 180
  return [Math.sin(rad), Math.cos(rad)]
}
const AXES = { r: axis('r'), g: axis('g'), b: axis('b') }

/** The master and puck of a wheel value. A missing wheel is neutral: all zero. */
export function balanceOf(w: WheelRgb | undefined): WheelBalance {
  if (!w) return { master: 0, x: 0, y: 0 }
  const master = (w.r + w.g + w.b) / 3
  let x = 0
  let y = 0
  for (const channel of ['r', 'g', 'b'] as const) {
    const offset = w[channel] - master
    x += offset * AXES[channel][0]
    y += offset * AXES[channel][1]
  }
  return { master, x, y }
}

/**
 * The `{ r, g, b }` for a master and a puck — `balanceOf`'s inverse. Each channel is the master
 * plus two thirds of the puck's projection on that channel's axis: three unit axes 120° apart sum
 * to zero, so the offsets always sum to zero and the mean stays the master.
 */
export function wheelFromBalance(balance: WheelBalance): WheelRgb {
  const at = (channel: keyof WheelRgb): number =>
    balance.master + (2 / 3) * (balance.x * AXES[channel][0] + balance.y * AXES[channel][1])
  return { r: at('r'), g: at('g'), b: at('b') }
}

/** Each channel held to `min`…`max` — the agent's range per channel, as the old sliders clamped. */
export function clampWheel(w: WheelRgb, min: number, max: number): WheelRgb {
  const c = (v: number): number => Math.min(max, Math.max(min, v))
  return { r: c(w.r), g: c(w.g), b: c(w.b) }
}

/** The master changed, the cast kept: every channel moves by the same amount (the old `setWheel`). */
export function withMaster(w: WheelRgb | undefined, master: number, min: number, max: number): WheelRgb {
  const current = w ?? { r: 0, g: 0, b: 0 }
  const delta = master - balanceOf(current).master
  return clampWheel({ r: current.r + delta, g: current.g + delta, b: current.b + delta }, min, max)
}

/** The cast changed, the master kept. */
export function withBalance(w: WheelRgb | undefined, x: number, y: number, min: number, max: number): WheelRgb {
  const { master } = balanceOf(w)
  return clampWheel(wheelFromBalance({ master, x, y }), min, max)
}

/** The puck's position on a disc of `radiusPx` whose rim is `reach` channel units, held to the rim. */
export function puckPixels(balance: Pick<WheelBalance, 'x' | 'y'>, radiusPx: number, reach: number): { left: number; top: number } {
  let x = balance.x / reach
  let y = balance.y / reach
  const length = Math.hypot(x, y)
  if (length > 1) {
    x /= length
    y /= length
  }
  return { left: radiusPx + x * radiusPx, top: radiusPx - y * radiusPx }
}

/** "red +0.020, green −0.010, blue −0.010" — the channels as a screen reader should hear them. */
export function describeWheel(w: WheelRgb | undefined, decimals = 3): string {
  const value = w ?? { r: 0, g: 0, b: 0 }
  const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(decimals)}`
  return `red ${signed(value.r)}, green ${signed(value.g)}, blue ${signed(value.b)}`
}
