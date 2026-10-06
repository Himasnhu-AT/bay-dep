/**
 * Painting a laid-out title: the plan, and the one function that executes it.
 *
 * `text.ts` decides where the lines go; this decides what is drawn on them. It is split the same
 * way and for the same reason: `planText` is pure — the plates, the runs of glyphs, the gradient
 * geometry and how far the paint reaches are arithmetic over an injected `measure`, tested under
 * Node — and `paintText` is the short part that needs a canvas. The compositor's `#drawText` is
 * the only caller of `paintText`, so preview, `preview_frame` and export paint a title through
 * one function.
 *
 * **Order is load-bearing**: plates, then every shadow (and the glow, which is a shadow with no
 * offset), then outlines from the widest in, then fills from the bottom up. A shadow drawn with
 * the fill would fall over the outline it sits inside; an inner outline drawn first would be
 * covered by the wider one.
 *
 * **Runs.** A title with no per-unit animation in play is drawn a whole line at a time, exactly
 * as it always was. When `textUnitsAt` says lines, words or letters are moving, each is a run
 * with its own position, placed by measuring the text before it — so the letters sit where the
 * whole line would have put them, kerning and tracking included — and drawn under its own
 * transform from the same sampler that animates the clip.
 */

import type { TextStyle } from '@shared/project'
import { textExtents, textPaintOf, type Extents, type TextFill, type TextPaint } from '@shared/text-style'
import type { TextUnits, UnitPosition, UnitState } from '@shared/animation'
import type { LaidOutText, TextBox } from './text'

export interface PlateRect extends TextBox {
  radius: number
}

export interface PaintRun {
  text: string
  /** Where `fillText` is given this run, and the alignment it is given with. */
  x: number
  align: CanvasTextAlign
  baseline: number
  /** The run's left edge and width, whatever its alignment — for its transform and its mask. */
  left: number
  width: number
  position: UnitPosition
}

export interface TextPlan {
  paint: TextPaint
  /** The block of letters: every line's box, before any paint is added. */
  block: TextBox
  plates: PlateRect[]
  runs: PaintRun[]
  /** How far outline, shadows and offset fills reach past the letters. */
  extents: Extents
  /** Everything that is painted: the block grown by `extents`, joined with the plates. */
  painted: TextBox
  fontSize: number
  lineHeight: number
}

/** The share of the type size a line's mask allows below the baseline, for descenders. */
export const DESCENDER = 0.3

const lineLeft = (anchorX: number, align: CanvasTextAlign, width: number): number =>
  align === 'left' ? anchorX : align === 'right' ? anchorX - width : anchorX - width / 2

/** Graphemes where the platform can tell them, code points otherwise: an emoji is one letter. */
function letters(text: string): { text: string; index: number }[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(text: string): Iterable<{ segment: string; index: number }> } }).Segmenter
  if (Segmenter) return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => ({ text: part.segment, index: part.index }))
  const out: { text: string; index: number }[] = []
  let index = 0
  for (const char of text) {
    out.push({ text: char, index })
    index += char.length
  }
  return out
}

/** The words of a line and where each starts in it. */
function words(text: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = []
  for (const match of text.matchAll(/\S+/g)) out.push({ text: match[0], index: match.index })
  return out
}

/**
 * What to draw for `laid` in `style`.
 *
 * `measure` reports a string's width at the laid-out size, in the font and tracking already set.
 * `by` splits the lines into runs — null draws whole lines.
 */
export function planText(
  laid: LaidOutText,
  anchor: { x: number; firstBaseline: number; textAlign: CanvasTextAlign },
  style: TextStyle,
  measure: (text: string) => number,
  by: TextUnits['by'] | null = null
): TextPlan {
  const paint = textPaintOf(style)
  const lineCount = laid.lines.length
  const baselineOf = (line: number): number => anchor.firstBaseline + line * laid.lineHeight
  const widths = laid.lines.map((line) => (line === '' ? 0 : measure(line)))

  const block: TextBox = {
    left: lineLeft(anchor.x, anchor.textAlign, laid.maxLineWidth),
    top: anchor.firstBaseline - laid.lineHeight,
    width: laid.maxLineWidth,
    height: laid.blockHeight
  }

  const plates: PlateRect[] = []
  if (paint.plate) {
    const { paddingX, paddingY, radius, perLine } = paint.plate
    const add = (left: number, top: number, width: number, height: number): void => {
      plates.push({ left, top, width, height, radius: Math.max(0, Math.min(radius, Math.min(width, height) / 2)) })
    }
    if (perLine) {
      for (let line = 0; line < lineCount; line += 1) {
        const width = widths[line] ?? 0
        // A blank line gets no bar: an empty rounded pill between two lines reads as a fault.
        if (width <= 0) continue
        add(lineLeft(anchor.x, anchor.textAlign, width) - paddingX, baselineOf(line) - laid.lineHeight - paddingY, width + paddingX * 2, laid.lineHeight + paddingY * 2)
      }
    } else {
      add(block.left - paddingX, block.top - paddingY, block.width + paddingX * 2, block.height + paddingY * 2)
    }
  }

  // Count the units first: a preset's stagger needs the totals before the first run is placed.
  const lineWords = laid.lines.map(words)
  const lineLetters = laid.lines.map((line) => letters(line).filter((letter) => letter.text.trim() !== ''))
  const totalWords = lineWords.reduce((sum, list) => sum + list.length, 0)
  const totalLetters = lineLetters.reduce((sum, list) => sum + list.length, 0)

  const runs: PaintRun[] = []
  let word = 0
  let letter = 0
  for (let line = 0; line < lineCount; line += 1) {
    const text = laid.lines[line] ?? ''
    const width = widths[line] ?? 0
    const left = lineLeft(anchor.x, anchor.textAlign, width)
    const baseline = baselineOf(line)
    const position = (wordIndex: number, letterIndex: number): UnitPosition => ({
      line,
      lines: lineCount,
      word: wordIndex,
      words: totalWords,
      letter: letterIndex,
      letters: totalLetters
    })
    const wordsHere = lineWords[line] ?? []
    const lettersHere = lineLetters[line] ?? []
    if (by === null || by === 'line') {
      // Drawn as the whole line always was — the same string, x and alignment.
      runs.push({ text, x: anchor.x, align: anchor.textAlign, baseline, left, width, position: position(word, letter) })
    } else if (by === 'word') {
      let lettersBefore = 0
      wordsHere.forEach((part, index) => {
        const start = left + (part.index === 0 ? 0 : measure(text.slice(0, part.index)))
        runs.push({ text: part.text, x: start, align: 'left', baseline, left: start, width: measure(part.text), position: position(word + index, letter + lettersBefore) })
        lettersBefore += lettersHere.filter((one) => one.index >= part.index && one.index < part.index + part.text.length).length
      })
    } else {
      lettersHere.forEach((part, index) => {
        const start = left + (part.index === 0 ? 0 : measure(text.slice(0, part.index)))
        const inWord = wordsHere.findIndex((one) => part.index >= one.index && part.index < one.index + one.text.length)
        runs.push({ text: part.text, x: start, align: 'left', baseline, left: start, width: measure(part.text), position: position(word + Math.max(0, inWord), letter + index) })
      })
    }
    word += wordsHere.length
    letter += lettersHere.length
  }

  const extents = textExtents(paint)
  let painted: TextBox = {
    left: block.left - extents.left,
    top: block.top - extents.top,
    width: block.width + extents.left + extents.right,
    height: block.height + extents.top + extents.bottom
  }
  for (const plate of plates) painted = union(painted, plate)

  return { paint, block, plates, runs, extents, painted, fontSize: laid.fontSize, lineHeight: laid.lineHeight }
}

function union(a: TextBox, b: TextBox): TextBox {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top
  }
}

/**
 * How far `painted` reaches outside `box` on each side, or null when it stays inside (to within
 * half a pixel). The glyphs themselves are fitted to the box by `layoutText`; this is the paint
 * around them, which layout does not shrink for.
 */
export function paintOverflow(painted: TextBox, box: TextBox): Extents | null {
  const over: Extents = {
    left: Math.max(0, box.left - painted.left),
    top: Math.max(0, box.top - painted.top),
    right: Math.max(0, painted.left + painted.width - (box.left + box.width)),
    bottom: Math.max(0, painted.top + painted.height - (box.top + box.height))
  }
  return over.left > 0.5 || over.top > 0.5 || over.right > 0.5 || over.bottom > 0.5 ? over : null
}

/** The two points a linear fill runs between, or the centre and radius of a radial one. */
export function gradientGeometry(
  fill: Exclude<TextFill, { kind: 'solid' }>,
  block: TextBox
): { kind: 'linear'; x0: number; y0: number; x1: number; y1: number } | { kind: 'radial'; cx: number; cy: number; r: number } {
  const cx = block.left + block.width / 2
  const cy = block.top + block.height / 2
  if (fill.kind === 'linear') {
    const radians = (fill.angle * Math.PI) / 180
    const dx = Math.cos(radians)
    const dy = Math.sin(radians)
    // Long enough that the first and last stops land on the block's corners at any angle.
    const reach = (Math.abs(dx) * block.width + Math.abs(dy) * block.height) / 2
    return { kind: 'linear', x0: cx - dx * reach, y0: cy - dy * reach, x1: cx + dx * reach, y1: cy + dy * reach }
  }
  const half = Math.hypot(block.width, block.height) / 2
  return {
    kind: 'radial',
    cx: block.left + block.width * (fill.centerX ?? 0.5),
    cy: block.top + block.height * (fill.centerY ?? 0.5),
    r: Math.max(1, half * (fill.radius ?? 1))
  }
}

/** The transform one unit is drawn under, in canvas pixels about its own centre. */
export function unitTransform(
  run: Pick<PaintRun, 'left' | 'width' | 'baseline'>,
  state: UnitState,
  fontSize: number,
  lineHeight: number
): { cx: number; cy: number; dx: number; dy: number; scale: number; rotation: number; blur: number } {
  return {
    cx: run.left + run.width / 2,
    cy: run.baseline - fontSize * 0.35,
    dx: state.dx * fontSize,
    // A masked unit travels its whole line (and the descender allowance), so at progress 0 it is
    // entirely below the mask; anything else moves in type sizes.
    dy: state.masked ? state.dy * (lineHeight + fontSize * DESCENDER) : state.dy * fontSize,
    scale: state.scale,
    rotation: state.rotation,
    blur: state.blur * fontSize
  }
}

type Target = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * Executes `plan` on `ctx`, whose font, tracking, alpha, look and rotation are already set.
 *
 * `shadowScale` is the device scale times the clip's own zoom: canvas shadows are in device
 * pixels and ignore the transform, so without it a shadow drawn for a 1080p export is twice as
 * long on a half-size preview, and does not grow with a push-in.
 */
export function paintText(ctx: Target, plan: TextPlan, shadowScale: number, units: TextUnits | null): void {
  const { paint, fontSize, lineHeight } = plan

  if (plan.plates.length > 0 && paint.plate) {
    ctx.fillStyle = paint.plate.color
    // One path, filled once: bars that overlap by their padding must not double a translucent colour.
    ctx.beginPath()
    for (const plate of plan.plates) {
      // `roundRect` is in Chromium; the fallback keeps this drawable if it ever is not.
      if (typeof (ctx as CanvasRenderingContext2D).roundRect === 'function') {
        ;(ctx as CanvasRenderingContext2D).roundRect(plate.left, plate.top, plate.width, plate.height, plate.radius)
      } else ctx.rect(plate.left, plate.top, plate.width, plate.height)
    }
    ctx.fill()
  }

  const eachRun = (draw: (run: PaintRun) => void): void => {
    for (const run of plan.runs) {
      if (run.text === '') continue
      if (!units) {
        draw(run)
        continue
      }
      const state = units.state(run.position)
      if (state.opacity <= 0) continue
      const t = unitTransform(run, state, fontSize, lineHeight)
      ctx.save()
      if (state.masked) {
        const reach = Math.max(plan.extents.left, plan.extents.right) + fontSize
        ctx.beginPath()
        ctx.rect(run.left - reach, run.baseline - lineHeight - plan.extents.top, run.width + reach * 2, lineHeight + fontSize * DESCENDER + plan.extents.top + plan.extents.bottom)
        ctx.clip()
      }
      ctx.globalAlpha *= Math.min(1, state.opacity)
      ctx.translate(t.cx + t.dx, t.cy + t.dy)
      if (t.rotation !== 0) ctx.rotate((t.rotation * Math.PI) / 180)
      if (t.scale !== 1) ctx.scale(t.scale, t.scale)
      ctx.translate(-t.cx, -t.cy)
      if (t.blur > 0.05) ctx.filter = ctx.filter && ctx.filter !== 'none' ? `${ctx.filter} blur(${t.blur.toFixed(2)}px)` : `blur(${t.blur.toFixed(2)}px)`
      draw(run)
      ctx.restore()
    }
  }

  const text = (run: PaintRun, how: 'fill' | 'stroke'): void => {
    ctx.textAlign = run.align
    if (how === 'fill') ctx.fillText(run.text, run.x, run.baseline)
    else ctx.strokeText(run.text, run.x, run.baseline)
  }

  const setStroke = (index: number): boolean => {
    const stroke = paint.strokes[index]
    if (!stroke) return false
    ctx.lineWidth = stroke.lineWidth
    ctx.strokeStyle = stroke.color
    ctx.lineJoin = stroke.join
    if (stroke.join === 'miter') ctx.miterLimit = 4
    return true
  }

  const fillRun = (run: PaintRun, fill: TextFill): void => {
    const dx = fill.offsetX ?? 0
    const dy = fill.offsetY ?? 0
    const opacity = fill.opacity ?? 1
    const plain = dx === 0 && dy === 0 && opacity >= 1
    if (!plain) {
      ctx.save()
      ctx.globalAlpha *= Math.max(0, Math.min(1, opacity))
      ctx.translate(dx, dy)
    }
    ctx.fillStyle = fillPaint(ctx, fill, plan.block)
    text(run, 'fill')
    if (!plain) ctx.restore()
  }

  // Shadows: cast by the silhouette — the widest outline and the bottom fill, which are drawn
  // again below without one. A hollow title (no fills) casts only its outline's shadow.
  if (paint.shadows.length > 0) {
    const bottom = paint.fills[0]
    for (const shadow of paint.shadows) {
      ctx.shadowColor = shadow.color
      ctx.shadowBlur = shadow.blur * shadowScale
      ctx.shadowOffsetX = shadow.offsetX * shadowScale
      ctx.shadowOffsetY = shadow.offsetY * shadowScale
      eachRun((run) => {
        if (setStroke(0)) text(run, 'stroke')
        if (bottom) fillRun(run, bottom)
      })
    }
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }

  for (let index = 0; index < paint.strokes.length; index += 1) {
    eachRun((run) => {
      setStroke(index)
      text(run, 'stroke')
    })
  }

  for (const fill of paint.fills) eachRun((run) => fillRun(run, fill))
}

function fillPaint(ctx: Target, fill: TextFill, block: TextBox): string | CanvasGradient {
  if (fill.kind === 'solid') return fill.color
  const geometry = gradientGeometry(fill, block)
  const gradient =
    geometry.kind === 'linear'
      ? ctx.createLinearGradient(geometry.x0, geometry.y0, geometry.x1, geometry.y1)
      : ctx.createRadialGradient(geometry.cx, geometry.cy, 0, geometry.cx, geometry.cy, geometry.r)
  for (const stop of fill.stops) {
    // A colour the canvas cannot parse throws from `addColorStop`; skip the stop, keep the title.
    try {
      gradient.addColorStop(Math.max(0, Math.min(1, stop.at)), stop.color)
    } catch {
      /* skipped */
    }
  }
  return gradient
}
