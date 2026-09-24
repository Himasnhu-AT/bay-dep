import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { TextField } from '@/components'
import { FONT_PROBE_STRING, fontIsAvailable } from '@/engine/text'
import { normalizeFontStack } from '@/lib/fontStack'

let probe: CanvasRenderingContext2D | null = null

/** Whether any family in `stack` resolves on this machine — the compositor's own check. */
function resolves(stack: string): boolean {
  probe ??= document.createElement('canvas').getContext('2d')
  const ctx = probe
  if (!ctx) return true
  return fontIsAvailable(stack, (family) => {
    ctx.font = `400 72px ${family}`
    return ctx.measureText(FONT_PROBE_STRING).width
  })
}

/**
 * Any family or CSS stack, typed: the text item's `fontFamily`, which the agent can set to any
 * stack and the list above cannot. Applied on Enter or when the field loses focus, and it says
 * as you type whether the family is on this Mac — a family that is not draws in a substitute,
 * in the preview and the export alike, with nothing on the canvas to say so.
 */
export function FontFamilyField({ value, onCommit }: { value: string; onCommit(stack: string): void }): ReactNode {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const stack = normalizeFontStack(draft)
  const found = useMemo(() => (stack ? resolves(stack) : null), [stack])

  const commit = (): void => {
    if (stack && stack !== value) onCommit(stack)
    else setDraft(value)
  }

  const note =
    draft.trim() === ''
      ? 'Type a family name, or a list separated by commas.'
      : stack === null
        ? 'That cannot be a font name: remove ; { and }.'
        : found
          ? 'Found on this Mac.'
          : 'Not on this Mac: another face will be drawn instead, in the preview and the export.'

  return (
    <div className="flex flex-col gap-1">
      <TextField
        label="Font family, typed"
        placeholder="Archivo, sans-serif"
        value={draft}
        invalid={draft.trim() !== '' && (stack === null || found === false)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            setDraft(value)
          }
        }}
      />
      <p className={`text-[11px] text-pretty ${found === false || stack === null ? 'text-warning' : 'text-ink-2'}`}>{note}</p>
    </div>
  )
}
