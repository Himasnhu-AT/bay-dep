/**
 * Laying out a text item: wrapping, line breaking, and fitting it to its box.
 *
 * All of it is pure and takes an injected `measure`, for the same reason the clock takes an
 * injected `now`: the arithmetic is where the mistakes live, and none of it needs a canvas to
 * be wrong. The only thing that needs a real context is asking how wide a string is.
 *
 * Two rules decide the shape of this, and both came from the interface side:
 *
 * 1. **Wrap against the item's own box, never the canvas.** A lower third that wraps at the
 *    canvas edge has not been laid out.
 * 2. **Shrink only after wrapping.** Wrapping is free legibility; shrinking spends it. The
 *    order matters because a long title that would fit on two lines at full size should not
 *    come back as one line at 40%.
 *
 * And one rule about reporting, which is the whole reason `TextFit` exists: **a silently
 * shrunk title looks deliberate.** Smaller type reads as a design choice, not as a failure,
 * so neither a model looking at `preview_frame` nor a user glancing at the canvas can tell
 * the difference. The draw has to say so, the way missing media says `pending`.
 */

import { defaultTextStyle, type Item, type TextStyle } from '@shared/project'

/** Below this, type is not small — it is a smudge. Shrinking further is worse than saying no. */
export const MIN_FONT_SIZE = 8

/**
 * The style a text item is drawn with — the one answer the compositor, the inspector and the
 * fit hint all read.
 *
 * `item.text` absent means exactly the look that shipped before `TextStyle` existed: a size
 * derived from the box (40% of its height) rather than chosen. Keeping that as the fallback is
 * what makes the field optional without changing any project already on disk. It lived only in
 * the compositor once, while the inspector showed `defaultTextStyle()`'s 96 px for the same item:
 * a new title drew at 432 px on a 1080 canvas under a panel saying 96, and the first style edit
 * snapped it to 96. New titles now get an explicit style at placement; this keeps older ones
 * honest.
 */
export function resolvedTextStyle(item: Pick<Item, 'text' | 'layout'>): TextStyle {
  if (item.text) return item.text
  const height = Number.isFinite(item.layout.height) ? item.layout.height : 0
  return { ...defaultTextStyle(Math.max(MIN_FONT_SIZE, Math.round(height * 0.4))), lineHeight: 1.2 }
}

/** How the text of one item ended up being drawn. */
export interface TextFit {
  itemId: string
  /** 1 when the requested `fontSize` was honoured; below 1 when it had to shrink. */
  scale: number
  /** The size actually drawn, in canvas pixels. `scale` says it shrank; this says to what. */
  fontSize: number
  lines: number
  /** True when the text still overflowed at {@link MIN_FONT_SIZE} and is therefore cut off. */
  clipped: boolean
  /**
   * False when the requested family is not installed and the platform substituted another.
   *
   * The same class of problem as `scale` and harder to see: a substituted font looks entirely
   * deliberate, with no visual cue at all. Only detectable by measuring, which is why it is
   * reported from here rather than validated against a list of families we *expect* to exist.
   */
  fontAvailable: boolean
}

export interface TextBox {
  left: number
  top: number
  width: number
  height: number
}

export interface LaidOutText {
  lines: string[]
  fontSize: number
  scale: number
  clipped: boolean
  /** Distance between baselines, in canvas pixels. */
  lineHeight: number
  /** Total height of the laid-out block. */
  blockHeight: number
  /** The widest line, for the background plate and for alignment. */
  maxLineWidth: number
}

/** `measure` reports the width of a string at the size and family already set on the context. */
export type MeasureAt = (text: string, fontSize: number) => number

/**
 * Breaks `text` into lines that fit `maxWidth`, honouring existing newlines.
 *
 * A single word longer than the box is **not** broken mid-word. Hyphenating "extraordinary"
 * at an arbitrary column looks like a rendering fault, whereas one long word overflowing
 * reads as what it is, and the shrink pass then deals with it. Explicit newlines in the
 * user's string are respected as hard breaks — someone who typed two lines meant two lines.
 */
export function wrapLines(text: string, maxWidth: number, fontSize: number, measure: MeasureAt): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/[ \t]+/).filter((w) => w.length > 0)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = words[0] as string
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i] as string
      const candidate = `${line} ${word}`
      if (measure(candidate, fontSize) <= maxWidth) line = candidate
      else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out
}

/**
 * Wraps, then shrinks only if wrapping was not enough.
 *
 * The search is a plain descending scan rather than a binary search, and deliberately: each
 * step re-wraps, because a smaller size may fit *more* words per line and so need fewer
 * lines — the relationship between size and height is not monotonic in the way a bisection
 * would assume. It steps by 1px from the requested size down to {@link MIN_FONT_SIZE}, which
 * is at most 90-odd measures for a 96px title and is not on the interactive path anyway.
 */
export function layoutText(
  text: string,
  style: Pick<TextStyle, 'fontSize' | 'lineHeight'>,
  box: TextBox,
  measure: MeasureAt
): LaidOutText {
  const requested = Math.max(1, Math.round(style.fontSize))
  const lineHeightRatio = style.lineHeight > 0 ? style.lineHeight : 1.2
  const maxWidth = Math.max(1, box.width)
  const maxHeight = Math.max(1, box.height)

  const attempt = (fontSize: number): LaidOutText => {
    const lines = wrapLines(text, maxWidth, fontSize, measure)
    const lineHeight = fontSize * lineHeightRatio
    let maxLineWidth = 0
    for (const line of lines) maxLineWidth = Math.max(maxLineWidth, measure(line, fontSize))
    return {
      lines,
      fontSize,
      scale: fontSize / requested,
      clipped: false,
      lineHeight,
      blockHeight: lines.length * lineHeight,
      maxLineWidth
    }
  }

  const fits = (laid: LaidOutText): boolean =>
    laid.blockHeight <= maxHeight && laid.maxLineWidth <= maxWidth

  const full = attempt(requested)
  if (fits(full)) return full

  for (let size = requested - 1; size >= MIN_FONT_SIZE; size -= 1) {
    const laid = attempt(size)
    if (fits(laid)) return laid
  }

  // Nothing fits. Draw at the floor and say it is clipped rather than shrinking into a
  // smudge — an unreadable title that technically fits is not a better answer.
  return { ...attempt(MIN_FONT_SIZE), clipped: true }
}

/**
 * Where the block of text sits inside the box, given the alignment.
 *
 * Returns the x to pass with `textAlign` already set to match, and the y of the **first
 * baseline**. Baselines rather than box tops because that is what `fillText` takes, and
 * converting at the call site is how a one-line block ends up half a line too high.
 */
export function anchorFor(
  box: TextBox,
  laid: Pick<LaidOutText, 'blockHeight' | 'lineHeight'>,
  align: TextStyle['align'],
  verticalAlign: TextStyle['verticalAlign']
): { x: number; firstBaseline: number; textAlign: CanvasTextAlign } {
  const x =
    align === 'left' ? box.left : align === 'right' ? box.left + box.width : box.left + box.width / 2
  const textAlign: CanvasTextAlign = align === 'center' ? 'center' : align
  const top =
    verticalAlign === 'top'
      ? box.top
      : verticalAlign === 'bottom'
        ? box.top + box.height - laid.blockHeight
        : box.top + (box.height - laid.blockHeight) / 2
  // `textBaseline = 'alphabetic'` puts the baseline at the y given, so the first line's
  // baseline sits one line-height down from the block's top.
  return { x, firstBaseline: top + laid.lineHeight, textAlign }
}

/**
 * A string whose width differs between almost any two real fonts, used to detect fallback.
 *
 * Mixed widths and shapes on purpose: a string of `iiii` measures nearly the same in many
 * families and would report a substitution as a match.
 *
 * **Both detectors must measure this same string, which is why it is a constant.** It was
 * declared here and then hardcoded at both call sites — the compositor's and `useTextFit`'s —
 * leaving one value in three places with the named authority as the copy nobody read. Two
 * detectors that disagree about the string disagree about whether a font substituted, and a
 * substituted font is the fault with no visual cue at all: it draws, and it looks deliberate.
 */
export const FONT_PROBE_STRING = 'MWQjgq@10 iIl'

/**
 * Whether `family` is actually installed, or the platform quietly substituted something.
 *
 * Measures the probe string in the requested stack and again in a family that certainly does
 * not exist. Equal widths mean the requested one did not exist either, because both requests
 * resolved to the same fallback. `setFont` must set the context's font to the given stack and
 * return the measured width.
 */
export function fontIsAvailable(
  family: string,
  measureWithFamily: (family: string) => number
): boolean {
  const absent = '__bay_no_such_family__'
  const requested = measureWithFamily(`${family}, ${absent}`);
  const fallback = measureWithFamily(absent)
  // A stack that names several families is available if *any* of them resolved, which is
  // what the browser's own fallback within the stack already decides.
  return Math.abs(requested - fallback) > 0.01
}
