/**
 * 2D affine matrices as `[a, b, c, d, e, f]` — the order `ctx.setTransform(a, b, c, d, e, f)` and
 * CSS `matrix(a, b, c, d, e, f)` both take: x′ = a·x + c·y + e, y′ = b·x + d·y + f.
 */

import type { Point } from './core'

export type Matrix = [number, number, number, number, number, number]

export function matIdentity(): Matrix {
  return [1, 0, 0, 1, 0, 0]
}

export function matTranslate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y]
}

export function matScale(sx: number, sy = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0]
}

/** Rotation by `degrees`, clockwise on screen (y down), as in CSS and canvas. */
export function matRotate(degrees: number): Matrix {
  const r = (degrees * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [c, s, -s, c, 0, 0]
}

/** The product A·B·…: `matMultiply(A, B)` applies B to a point first, then A — the last one named is the innermost. */
export function matMultiply(m: Matrix, ...rest: Matrix[]): Matrix {
  let out = m
  for (const n of rest) {
    out = [
      out[0] * n[0] + out[2] * n[1],
      out[1] * n[0] + out[3] * n[1],
      out[0] * n[2] + out[2] * n[3],
      out[1] * n[2] + out[3] * n[3],
      out[0] * n[4] + out[2] * n[5] + out[4],
      out[1] * n[4] + out[3] * n[5] + out[5]
    ]
  }
  return out
}

/** The matrix that undoes `m`. A matrix that flattens the plane (zero determinant) has none, and throws. */
export function matInvert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2]
  if (det === 0 || !Number.isFinite(det)) {
    throw new Error(`matInvert: [${m.join(', ')}] has no inverse (a scale of 0 flattens the plane)`)
  }
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det
  ]
}

export function matApply(m: Matrix, x: number, y: number): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** For `element.style.transform`, with `transform-origin: 0 0` on the element. */
export function matCss(m: Matrix): string {
  return `matrix(${m.join(',')})`
}

/**
 * The six arguments for `ctx.setTransform(...)`. `dpr` is the canvas's backing scale (its pixel
 * width over its layout width): setTransform replaces the whole transform, so the scale a canvas
 * was set up with has to be multiplied back in.
 */
export function matCanvas(m: Matrix, dpr = 1): Matrix {
  return [m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr]
}
