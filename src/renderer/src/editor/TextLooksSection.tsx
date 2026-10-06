import { useEffect, useRef, type ReactNode } from 'react'
import type { Item, TextStyle } from '@shared/project'
import { TEXT_LOOKS, activeTextLook, applyTextLook, type TextLook } from '@shared/text-style'
import { anchorFor, layoutText, resolvedTextStyle } from '@/engine/text'
import { paintText, planText } from '@/engine/textPaint'
import { Button, Section } from '@/components'
import { cn } from '@/lib/cn'
import { ToolError } from '@/mcp/helpers'
import { applyTextLookTool } from '@/mcp/textLooks'
import { useEditor } from '@/store/editor'

const TILE = { width: 84, height: 44 }

/**
 * One look, drawn by the compositor's own painter — `planText` and `paintText`, the functions
 * that draw the title in the viewer and the export — so the tile cannot promise a picture the
 * canvas will not deliver. In the title's own typeface: a look keeps the font, so the preview does.
 */
function LookPreview({ style }: { style: TextStyle }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  // The style object is rebuilt each render; its content is the dependency.
  const key = JSON.stringify(style)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(TILE.width * ratio)
    canvas.height = Math.round(TILE.height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, TILE.width, TILE.height)
    const font = (size: number): string => `${style.italic ? 'italic ' : ''}${style.fontWeight} ${size}px ${style.fontFamily}`
    ctx.letterSpacing = `${style.letterSpacing}px`
    const box = { left: 6, top: 4, width: TILE.width - 12, height: TILE.height - 8 }
    const laid = layoutText('Aa', style, box, (text, size) => {
      ctx.font = font(size)
      return ctx.measureText(text).width
    })
    ctx.font = font(laid.fontSize)
    ctx.textBaseline = 'alphabetic'
    const anchor = anchorFor(box, laid, 'center', 'middle')
    paintText(ctx, planText(laid, anchor, style, (text) => ctx.measureText(text).width), ratio, null)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} aria-hidden="true" style={{ width: TILE.width, height: TILE.height }} className="block" />
}

/** The size the tiles draw at: small enough to fit, with the look's lengths scaled to match. */
const PREVIEW_SIZE = 26

export interface TextLooksSectionProps {
  /** The selected titles. A look applies to all of them, as one undo step. */
  items: Item[]
}

/**
 * Named looks for the selected titles, and "make the others match".
 *
 * A look is paint and weight: it keeps each title's font, size, box and alignment. The two
 * buttons copy *this* title's whole look — whatever it is now, a named one or hand-made — onto
 * every title on its track or on the timeline, through `apply_text_look`, the same call the agent
 * makes; its refusal ("every title is on a locked track") is the toast.
 */
export function TextLooksSection({ items }: TextLooksSectionProps): ReactNode {
  const patchItem = useEditor((state) => state.patchItem)
  const transact = useEditor((state) => state.transact)
  const notify = useEditor((state) => state.notify)
  const first = items[0]
  if (!first) return null
  const style = resolvedTextStyle(first)
  const active = activeTextLook(style)

  const wear = (look: TextLook): void => {
    transact(() => {
      for (const item of items) patchItem(item.id, { text: applyTextLook(resolvedTextStyle(item), look) })
    })
  }

  const copyTo = (scope: { trackId: string } | { all: true }): void => {
    try {
      const result = applyTextLookTool({ fromItemId: first.id, ...scope }) as { changed: number; warning?: string }
      const count = `${result.changed} other title${result.changed === 1 ? '' : 's'}`
      notify(result.changed === 0 ? 'Every other title there already has this look.' : `Applied this look to ${count}.${result.warning ? ` ${result.warning}` : ''}`)
    } catch (error) {
      if (!(error instanceof ToolError)) throw error
      notify(error.userMessage ?? error.message, 'error')
    }
  }

  return (
    <Section
      id="inspector.looks"
      title="Looks"
      collapsible
      hint="A look sets the paint and weight and keeps the font, size and position. Change any field afterwards."
    >
      <ul className="grid grid-cols-3 gap-1.5" aria-label="Text looks">
        {TEXT_LOOKS.map((look) => {
          const isActive = active?.id === look.id
          return (
            <li key={look.id}>
              <button
                type="button"
                aria-pressed={isActive}
                title={look.description}
                onClick={() => wear(look)}
                className={cn(
                  't-fast flex w-full flex-col items-center gap-0.5 overflow-hidden rounded-sm border bg-surface-3 pb-1 text-[10px]',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                  isActive ? 'border-accent text-ink-0' : 'border-line text-ink-1 hover:border-ink-2'
                )}
              >
                <LookPreview style={applyTextLook({ ...style, fontSize: PREVIEW_SIZE, lineHeight: 1.2 }, look)} />
                <span className="max-w-full truncate px-1">{look.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 border-t border-line pt-2">
        <p className="text-[10px] leading-relaxed text-ink-2">Give other titles this title’s look — its font, paint and weight; each keeps its own size and place.</p>
        <div className="mt-1.5 flex gap-1.5">
          <Button onClick={() => copyTo({ trackId: first.trackId })}>All on this track</Button>
          <Button onClick={() => copyTo({ all: true })}>All on the timeline</Button>
        </div>
      </div>
    </Section>
  )
}
