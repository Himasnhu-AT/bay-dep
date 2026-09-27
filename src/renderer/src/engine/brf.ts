/**
 * Paints `.brf` documents (`@shared/brf`) — the half of the format that needs a canvas.
 *
 * `evaluateBrf` turns a document and a time into a flat list of draw operations; this turns that
 * list into pixels. Nothing here decides *what* is drawn, only how: transforms, alpha, blur and
 * shadow, rounded rectangles, SVG paths with a partial stroke, and text laid out, wrapped and
 * split into pieces that move on their own.
 *
 * The compositor draws each `.brf` item into a surface of its own at the size it will appear,
 * then hands that surface to the same `#drawSource` a video frame goes through — so crop, looks,
 * rotation, opacity and fades apply to motion graphics exactly as they do to footage, with no
 * second implementation of any of them. A surface is reused frame to frame and only reallocated
 * when the item's on-screen size changes.
 */

import {
  evaluateBrf,
  parseBrf,
  parseGradient,
  type BrfDocument,
  type BrfValues,
  type DrawOp,
  type Matrix
} from '@shared/brf'
import { sourceTimeAt, type Asset, type Item } from '@shared/project'
import { clampToAsset } from './compositionPool'
import { variationFaces } from './brfFonts'
import { importedFonts } from './importedFonts'
import { glassPatches, type GlassPatch } from './glass'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}

/** Device pixels per local unit, for lengths canvas does not transform (blur, shadow). */
function unitOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1
}

const paths = new Map<string, Path2D>()
const pathLengths = new Map<string, number>()

function pathOf(d: string): Path2D {
  let path = paths.get(d)
  if (!path) {
    if (paths.size > 512) paths.clear()
    path = new Path2D(d)
    paths.set(d, path)
  }
  return path
}

/**
 * A path's length, for drawing part of its stroke. Canvas cannot measure a Path2D, so an SVG
 * element does — the renderer has a document; where there is none, the stroke draws whole.
 */
function pathLength(d: string): number | null {
  const cached = pathLengths.get(d)
  if (cached !== undefined) return cached
  if (typeof document === 'undefined') return null
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  element.setAttribute('d', d)
  const length = element.getTotalLength()
  if (pathLengths.size > 512) pathLengths.clear()
  pathLengths.set(d, length)
  return length
}

interface Line {
  text: string
  width: number
  /** Top-left of the line inside the text block. */
  x: number
  y: number
}

type TextOp = Extract<DrawOp, { kind: 'text' }>

function wrap(ctx: Ctx, text: string, width: number | null): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (width === null) {
      out.push(paragraph)
      continue
    }
    let line = ''
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > width) {
        out.push(line)
        line = word
      } else line = next
    }
    out.push(line)
  }
  return out
}

function layout(ctx: Ctx, op: TextOp): { lines: Line[]; width: number; height: number } {
  const texts = wrap(ctx, op.text, op.width)
  const widths = texts.map((t) => ctx.measureText(t).width)
  const blockWidth = op.width ?? Math.max(0, ...widths)
  const lineHeight = op.size * op.lineHeight
  const lines = texts.map((text, i) => {
    const width = widths[i] ?? 0
    const x = op.align === 'left' ? 0 : op.align === 'right' ? blockWidth - width : (blockWidth - width) / 2
    return { text, width, x, y: i * lineHeight }
  })
  return { lines, width: blockWidth, height: texts.length * lineHeight }
}

interface Piece {
  text: string
  x: number
  y: number
  width: number
}

function piecesOf(ctx: Ctx, lines: Line[], split: 'word' | 'char' | 'line'): Piece[] {
  const pieces: Piece[] = []
  for (const line of lines) {
    if (split === 'line') {
      pieces.push({ text: line.text, x: line.x, y: line.y, width: line.width })
      continue
    }
    const parts = split === 'word' ? line.text.split(/(\s+)/) : [...line.text]
    let offset = 0
    for (const part of parts) {
      const width = ctx.measureText(part).width
      if (part.trim()) pieces.push({ text: part, x: line.x + offset, y: line.y, width })
      offset += width
    }
  }
  return pieces
}

function paintText(ctx: Ctx, op: TextOp, lineHeightPx: number): void {
  ctx.font = `${op.italic ? 'italic ' : ''}${op.weight} ${op.size}px ${op.font}`
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${op.tracking}px`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  const block = layout(ctx, op)
  ctx.translate(-op.anchor[0] * block.width, -op.anchor[1] * block.height)
  if (op.wipe < 1) {
    ctx.beginPath()
    ctx.rect(0, -op.size, block.width * op.wipe, block.height + op.size * 2)
    ctx.clip()
  }
  const mid = lineHeightPx / 2
  const fill = op.fill ? paintOf(ctx, op.fill, block.width, block.height) : null
  const draw = (text: string, x: number, y: number): void => {
    if (op.stroke && op.strokeWidth > 0) {
      ctx.strokeStyle = op.stroke
      ctx.lineWidth = op.strokeWidth
      ctx.strokeText(text, x, y + mid)
    }
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillText(text, x, y + mid)
    }
  }

  if (!op.split || !op.piece) {
    // Unsplit: the `type` preset reveals characters across the whole block.
    let budget = op.reveal >= 1 ? Infinity : Math.round(op.reveal * op.text.replace(/\n/g, '').length)
    for (const line of block.lines) {
      if (budget <= 0) break
      const shown = budget >= line.text.length ? line.text : line.text.slice(0, budget)
      budget -= line.text.length
      draw(shown, line.x, line.y)
    }
    return
  }

  const pieces = piecesOf(ctx, block.lines, op.split)
  const base = ctx.globalAlpha
  pieces.forEach((piece, index) => {
    const state = op.piece!(index, pieces.length)
    if (state.alpha <= 0.0005 || state.reveal <= 0) return
    const shown = state.reveal >= 1 ? piece.text : piece.text.slice(0, Math.ceil(state.reveal * piece.text.length))
    ctx.save()
    ctx.globalAlpha = base * state.alpha
    // Each piece scales about its own centre, so a popping word grows in place.
    ctx.translate(piece.x + piece.width / 2 + state.dx, piece.y + mid + state.dy)
    ctx.scale(state.scale, state.scale)
    draw(shown, -piece.width / 2, -mid)
    ctx.restore()
  })
}

/**
 * Paints `ops` onto `ctx`, with `base` mapping document pixels to the context's pixels.
 * Exported apart from the surfaces so it can be driven with any context.
 */
export function paintBrf(ctx: Ctx, ops: DrawOp[], base: Matrix): void {
  for (const op of ops) {
    if (op.kind === 'clip') {
      // Left open until the matching `unclip`, so every op between is clipped by it.
      ctx.save()
      ctx.setTransform(...multiply(base, op.matrix))
      ctx.beginPath()
      ctx.rect(0, 0, op.w, op.h)
      ctx.clip()
      continue
    }
    if (op.kind === 'unclip') {
      ctx.restore()
      continue
    }
    const m = multiply(base, op.matrix)
    const unit = unitOf(m)
    ctx.save()
    ctx.setTransform(...m)
    ctx.globalAlpha = op.alpha
    if (op.blur > 0) ctx.filter = `blur(${op.blur * unit}px)`
    if (op.shadow) {
      // Shadow lengths are in device pixels whatever the transform, so they are scaled here.
      ctx.shadowColor = op.shadow.color
      ctx.shadowBlur = op.shadow.blur * unit
      ctx.shadowOffsetX = (op.shadow.x ?? 0) * unit
      ctx.shadowOffsetY = (op.shadow.y ?? 0) * unit
    }
    // A path has no box to wipe across; it reveals with `draw`. Text wipes inside `paintText`,
    // where its block has been measured.
    if (op.wipe < 1 && (op.kind === 'rect' || op.kind === 'ellipse' || op.kind === 'glass')) {
      ctx.beginPath()
      ctx.rect(0, 0, op.w * op.wipe, op.h)
      ctx.clip()
    }
    switch (op.kind) {
      case 'rect': {
        ctx.beginPath()
        if (op.radius > 0) ctx.roundRect(0, 0, op.w, op.h, Math.min(op.radius, op.w / 2, op.h / 2))
        else ctx.rect(0, 0, op.w, op.h)
        fillAndStroke(ctx, op)
        break
      }
      case 'ellipse': {
        ctx.beginPath()
        ctx.ellipse(op.w / 2, op.h / 2, Math.abs(op.w / 2), Math.abs(op.h / 2), 0, 0, Math.PI * 2)
        fillAndStroke(ctx, op)
        break
      }
      case 'path': {
        const path = pathOf(op.d)
        if (op.fill) {
          // A path has no box for a gradient to span; its first stop is used as a flat fill.
          const gradient = /^\s*(linear|radial)\(/i.test(op.fill) ? parseGradient(op.fill) : null
          ctx.fillStyle = gradient ? (gradient.stops[0]?.color ?? 'transparent') : op.fill
          ctx.fill(path)
        }
        if (op.stroke && op.strokeWidth > 0 && op.draw > 0) {
          if (op.draw < 1) {
            const length = pathLength(op.d)
            if (length !== null) ctx.setLineDash([length * op.draw, length + 1])
          }
          ctx.strokeStyle = op.stroke
          ctx.lineWidth = op.strokeWidth
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke(path)
        }
        break
      }
      case 'text':
        paintText(ctx, op, op.size * op.lineHeight)
        break
      case 'glass':
        paintGlassPane(ctx, op, unit)
        break
    }
    ctx.restore()
  }
}

/**
 * The pane's own paint, over the backdrop the compositor draws under it (`engine/glass.ts`): the
 * tint, a sheen falling off from the top, and a rim lit from the upper left — quick-liquid's
 * default light angle — drawn on the inside of the edge so it never widens the pane. Without the
 * backdrop (a cropped-away canvas, no OffscreenCanvas) this alone is still a legible tinted pane.
 */
function paintGlassPane(ctx: Ctx, op: Extract<DrawOp, { kind: 'glass' }>, unit: number): void {
  const { w, h } = op
  const r = Math.max(0, Math.min(op.radius, w / 2, h / 2))
  const pane = (): void => {
    ctx.beginPath()
    if (r > 0) ctx.roundRect(0, 0, w, h, r)
    else ctx.rect(0, 0, w, h)
  }
  pane()
  ctx.fillStyle = op.look.tint
  ctx.fill()
  ctx.shadowColor = 'transparent'
  const light = Math.max(0, Math.min(1, op.look.edgeHighlight))
  if (light <= 0) return
  const sheen = ctx.createLinearGradient(0, 0, 0, h)
  sheen.addColorStop(0, `rgba(255,255,255,${(0.14 * light).toFixed(3)})`)
  sheen.addColorStop(0.45, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fill()
  // Clipped to the pane and stroked at twice the width, so only the inner half shows.
  ctx.save()
  ctx.clip()
  const rim = ctx.createLinearGradient(0, 0, w, h)
  rim.addColorStop(0, `rgba(255,255,255,${(0.8 * light).toFixed(3)})`)
  rim.addColorStop(0.5, `rgba(255,255,255,${(0.12 * light).toFixed(3)})`)
  rim.addColorStop(1, `rgba(255,255,255,${(0.4 * light).toFixed(3)})`)
  ctx.strokeStyle = rim
  ctx.lineWidth = (2 * 1.5) / unit
  pane()
  ctx.stroke()
  ctx.restore()
}

/**
 * A fill as canvas takes it: the colour itself, or a gradient built across the `w`×`h` box the
 * layer draws in (its local coordinates), so the gradient moves and scales with the layer.
 */
function paintOf(ctx: Ctx, fill: string, w: number, h: number): string | CanvasGradient {
  const gradient = /^\s*(linear|radial)\(/i.test(fill) ? parseGradient(fill) : null
  if (!gradient) return fill
  let g: CanvasGradient
  if (gradient.kind === 'radial') {
    g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
  } else {
    // CSS angles: 0 points up, 90 right. The line runs through the centre, long enough that the
    // end stops land on the box's corners, as CSS places them.
    const rad = (gradient.angle * Math.PI) / 180
    const dx = Math.sin(rad)
    const dy = -Math.cos(rad)
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
    g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half)
  }
  for (const stop of gradient.stops) g.addColorStop(Math.max(0, Math.min(1, stop.at)), stop.color)
  return g
}

function fillAndStroke(ctx: Ctx, op: { fill?: string; stroke?: string; strokeWidth: number; w: number; h: number }): void {
  if (op.fill) {
    ctx.fillStyle = paintOf(ctx, op.fill, op.w, op.h)
    ctx.fill()
  }
  if (op.stroke && op.strokeWidth > 0) {
    // A shadow on both would draw it twice, darker than asked.
    if (op.fill) ctx.shadowColor = 'transparent'
    ctx.strokeStyle = op.stroke
    ctx.lineWidth = op.strokeWidth
    ctx.stroke()
  }
}

/** A document ready to draw, or why it cannot be. Cached per document object. */
const parsed = new WeakMap<object, { doc: BrfDocument } | { error: string }>()

export function documentOf(asset: Asset): { doc: BrfDocument } | { error: string } {
  const source = asset.brf
  if (!source) return { error: 'has no motion document' }
  let entry = parsed.get(source)
  if (!entry) {
    const result = parseBrf(source)
    entry = result.ok
      ? { doc: result.doc }
      : { error: result.faults.map((f) => `${f.at}: ${f.message}`).join('; ') }
    parsed.set(source, entry)
  }
  return entry
}

/**
 * Where on its surface the document draws: authored at a `size`, it is fitted whole and centred
 * (contain), so a 1080×1920 design in a 1920×1080 box letterboxes rather than stretching; with no
 * `size` it is laid out at the box's own timeline size, which is what makes `"50%"` responsive.
 */
function placement(
  doc: BrfDocument,
  box: { width: number; height: number },
  px: { width: number; height: number }
): { width: number; height: number; base: Matrix } {
  if (doc.size) {
    const [dw, dh] = doc.size
    const s = Math.min(px.width / dw, px.height / dh)
    return { width: dw, height: dh, base: [s, 0, 0, s, (px.width - dw * s) / 2, (px.height - dh * s) / 2] }
  }
  return { width: box.width, height: box.height, base: [px.width / box.width, 0, 0, px.height / box.height, 0, 0] }
}

export class BrfSurfaces {
  #surfaces = new Map<string, OffscreenCanvas>()

  /**
   * `doc` at `seconds`, painted for `item` at `px` device pixels into a layout box of `box`
   * timeline pixels. `values` are the placement's vars.
   */
  draw(
    doc: BrfDocument,
    item: Item,
    seconds: number,
    box: { width: number; height: number },
    px: { width: number; height: number },
    values: BrfValues
  ): { surface: OffscreenCanvas; glass: GlassPatch[] } | { pending: true } | { error: string } {
    const width = Math.max(1, Math.round(px.width))
    const height = Math.max(1, Math.round(px.height))
    const where = placement(doc, box, { width, height })
    const ops = evaluateBrf(doc, seconds, where.width, where.height, values)
    // Text with variable-font axes draws in a face registered for those settings. Resolved before
    // anything is painted: a face still loading makes the whole item pending (drawn once it
    // arrives, and waited for by export), never drawn in the plain face as a stand-in.
    for (const op of ops) {
      if (op.kind !== 'text') continue
      // An imported face still loading is pending too — with or without axes.
      if (importedFonts.isLoading(op.font)) return { pending: true }
      if (!op.variations) continue
      const face = variationFaces.resolve(op.font, op.variations)
      if ('pending' in face) return { pending: true }
      if ('error' in face) return { error: face.error }
      op.font = face.font
    }

    let surface = this.#surfaces.get(item.id)
    if (!surface || surface.width !== width || surface.height !== height) {
      if (this.#surfaces.size > 64) this.#surfaces.clear()
      surface = new OffscreenCanvas(width, height)
      this.#surfaces.set(item.id, surface)
    }
    const ctx = surface.getContext('2d')
    if (!ctx) return { error: 'could not get a 2D context to draw it into' }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (doc.background) {
      ctx.save()
      ctx.setTransform(...where.base)
      ctx.fillStyle = doc.background
      ctx.fillRect(0, 0, where.width, where.height)
      ctx.restore()
    }
    paintBrf(ctx, ops, where.base)
    // The panes, in surface pixels, for the compositor's backdrop pass: the surface cannot see
    // what is under it, so the frost is drawn by whoever can (`engine/glass.ts`).
    return { surface, glass: glassPatches(ops, where.base, where) }
  }

  reset(): void {
    this.#surfaces.clear()
  }
}

/**
 * The size a `.brf` item's scene is laid out at: its declared `size`, or the clip's box. The
 * compositor passes it to the code runtime, so a module that reads `width`/`height` sees the same
 * numbers `%` lengths are measured against.
 */
export function layoutSizeOf(asset: Asset, box: { width: number; height: number }): { width: number; height: number } {
  return asset.width && asset.height ? { width: asset.width, height: asset.height } : { width: Math.round(box.width), height: Math.round(box.height) }
}

/** The seconds into the asset that `item` shows at timeline `frame`. */
export function secondsAt(asset: Asset, item: Item, frame: number, fps: number): number {
  return clampToAsset(sourceTimeAt(item, frame, fps), asset) / 1_000_000
}
