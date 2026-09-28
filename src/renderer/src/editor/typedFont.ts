import type { TypedFont } from '@/components'
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
 * A family typed into the font picker: the stack a text item would hold (any family or CSS stack,
 * which the agent can set too), and whether it is on this Mac — a family that is not draws in a
 * substitute, in the preview and the export alike, with nothing on the canvas to say so.
 */
export function typedFont(text: string): TypedFont {
  const stack = normalizeFontStack(text)
  if (stack === null) return { stack: null, note: 'That cannot be a font name: remove ; { and }.', warn: true }
  return resolves(stack)
    ? { stack, note: 'Found on this Mac.', warn: false }
    : { stack, note: 'Not on this Mac: another face will be drawn instead, in the preview and the export.', warn: true }
}
