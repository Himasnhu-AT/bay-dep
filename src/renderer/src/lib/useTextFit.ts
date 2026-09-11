import { useEffect, useState } from 'react'
import { fontIsAvailable, layoutText, MIN_FONT_SIZE, type LaidOutText } from '@/engine'
import { defaultTextStyle, type Asset, type Item } from '@shared/project'

export interface TextFitReport {
  laid: LaidOutText
  fontAvailable: boolean
  /** Non-null when the user should be told something. Null when the text came out as asked. */
  warning: string | null
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
      return ctx.measureText('MWQjgq@10 iIl').width
    })

    let warning: string | null = null
    if (laid.clipped) {
      warning = `Does not fit even at ${MIN_FONT_SIZE}px — the text is cut off. Give it a bigger box or fewer words.`
    } else if (!available) {
      warning = 'This font is not installed, so the system substituted another. What you see is not the typeface chosen.'
    } else if (laid.scale < 1) {
      warning = `Shrunk to ${Math.round(laid.scale * 100)}% (${laid.fontSize}px) to fit the box.`
    }

    setReport({ laid, fontAvailable: available, warning })
    // `key` is the real dependency; the objects it summarises are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return report
}
