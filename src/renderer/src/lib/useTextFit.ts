import { useEffect, useState } from 'react'
import {
  fontIsAvailable,
  FONT_PROBE_STRING,
  layoutText,
  MIN_FONT_SIZE,
  type LaidOutText
} from '@/engine'
import { defaultTextStyle, type Asset, type Item } from '@shared/project'

export interface TextFitReport {
  laid: LaidOutText
  fontAvailable: boolean
  /**
   * Everything the user should be told, worst-hidden first. Empty when the text came out
   * as asked.
   *
   * A list rather than one string because two of these can be true at once and they are
   * independent faults: a substituted font is often *why* the words no longer fit, and
   * reporting only the clipping would hand someone the symptom while hiding the cause.
   */
  warnings: string[]
}

/**
 * What the compositor will do with this text, worked out ahead of it drawing.
 *
 * It calls the engine's own `layoutText` and `fontIsAvailable` rather than reimplementing
 * them — they are pure with an injected `measure` precisely so a second caller can ask the
 * same question from somewhere without a render target. So this is not a second
 * implementation that can drift; it is the same arithmetic with a different ruler.
 *
 * The Inspector needs this because the three ways text goes wrong are all **invisible in
 * the picture**. Shrunk type reads as a design choice. A substituted font has no cue at all.
 * Clipped text looks like text that was meant to be that long. Someone has to say so, and
 * the panel where the size was typed is where it will be read.
 */
export function useTextFit(
  item: Item | undefined,
  asset: Asset | undefined,
  box: { left: number; top: number; width: number; height: number }
): TextFitReport | null {
  const [report, setReport] = useState<TextFitReport | null>(null)

  const text = asset?.kind === 'text' ? (asset.text ?? '') : null
  const style = item?.text ?? defaultTextStyle()
  // Serialised so the effect re-runs on a value change rather than on every render — the
  // style object is rebuilt by `defaultTextStyle()` each time when the item has none.
  const key = JSON.stringify([text, style, box.width, box.height])

  useEffect(() => {
    if (text === null || text.trim() === '') {
      setReport(null)
      return
    }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const fontString = (size: number): string =>
      `${style.italic ? 'italic ' : ''}${style.fontWeight} ${size}px ${style.fontFamily}`

    const laid = layoutText(text, style, box, (line, fontSize) => {
      ctx.font = fontString(fontSize)
      ctx.letterSpacing = `${style.letterSpacing}px`
      return ctx.measureText(line).width
    })

    const available = fontIsAvailable(style.fontFamily, (family) => {
      ctx.font = `${style.fontWeight} 72px ${family}`
      ctx.letterSpacing = '0px'
      return ctx.measureText(FONT_PROBE_STRING).width
    })

    // Ordered by how well each fault hides, not by severity. A missing font is the one with
    // no cue whatsoever — it draws, it looks deliberate, and a family that ships with macOS
    // but is unreachable from this layer (SF Mono) substitutes as silently as a misspelling
    // does. Clipping and shrinking are at least visible on the canvas once you look.
    const warnings: string[] = []
    if (!available) {
      warnings.push(
        `${style.fontFamily} is not available here, so the system substituted another face. ` +
          `What you see is not the typeface chosen, and it will not be in the export either.`
      )
    }
    if (laid.clipped) {
      // Deliberately no percentage. Clipping is reported at the floor, where the scale is
      // ~4%, and "shrunk to 4%" tells a reader nothing they can act on.
      warnings.push(
        `Does not fit its box even at the minimum ${MIN_FONT_SIZE}px — the text is cut off. ` +
          `Give it a bigger box or fewer words.`
      )
    } else if (laid.scale < 1) {
      warnings.push(`Shrunk to ${Math.round(laid.scale * 100)}% (${laid.fontSize}px) to fit the box.`)
    }

    setReport({ laid, fontAvailable: available, warnings })
    // `key` is the real dependency; the objects it summarises are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return report
}
