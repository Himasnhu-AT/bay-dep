import { useRef, useState, type ReactNode } from 'react'
import { Pipette } from 'lucide-react'
import { HexColorPicker } from 'react-colorful'
import { cn } from '@/lib/cn'
import { useFloatingTrigger } from '../Floating'
import { Popover } from '../Popover'
import { useGestureBracket, type Gesture } from './gesture'
import { normaliseHex } from './color'

export interface ColorFieldProps {
  label: string
  value: string
  onCommit(value: string): void
  disabled?: boolean
  className?: string
  /**
   * The caller's live-edit bracket: with one, dragging in the picker recolours the picture as it
   * goes and is one undo step; without one the picker commits when the drag ends.
   */
  gesture?: Gesture
}

/**
 * A colour swatch, a hex field and the system picker.
 *
 * The swatch opens bay's own picker (react-colorful, MIT): a saturation/brightness square and a
 * hue strip with a hex field under them, drawn in bay's theme and usable from the keyboard. The
 * pipette beside the hex field is the native picker, kept because macOS gives it an eyedropper
 * and the system palettes for free. The hex field exists because a brand colour arrives as a
 * string, and typing it beats hunting for it.
 *
 * It commits on release rather than on every change — react-colorful's `onChangeEnd` (mouseup,
 * touchend, keyup) — so a drag through a gradient is one undo step, not one per pixel; with a
 * `gesture` the drag is also live.
 */
export function ColorField({
  label,
  value,
  onCommit,
  disabled = false,
  className,
  gesture
}: ColorFieldProps): ReactNode {
  const [picking, setPicking] = useState<string | null>(null)
  const native = useRef(value)
  const picker = useFloatingTrigger('dialog')
  const bracket = useGestureBracket(gesture)

  const swatch = normaliseHex(picking ?? value) ?? '#000000'
  const commit = (next: string): void => {
    const hex = normaliseHex(next)
    if (hex && hex !== normaliseHex(value)) onCommit(hex)
  }

  return (
    <>
      <div
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-sm border border-line bg-surface-2 pl-1 t-fast',
          disabled
            ? 'opacity-40'
            : 'hover:border-line-strong focus-within:border-accent focus-within:ring-1 focus-within:ring-accent',
          className
        )}
      >
        <button
          type="button"
          {...picker.triggerProps}
          data-color-field=""
          aria-label={`${label}: ${swatch}. Open the colour picker`}
          title={disabled ? undefined : 'Open the colour picker'}
          disabled={disabled}
          className="size-5 shrink-0 cursor-pointer rounded-xs border border-line-strong outline-none disabled:cursor-not-allowed"
          style={{ background: swatch }}
        />
        <HexInput label={`${label} hex`} value={value} disabled={disabled} onCommit={commit} />
        {/* The system picker: its eyedropper samples anywhere on screen, the viewer included. */}
        <label
          title={disabled ? undefined : 'System colour picker, with an eyedropper'}
          className={cn('relative mr-1 flex size-5 shrink-0 items-center justify-center rounded-xs text-ink-2', !disabled && 'cursor-pointer hover:text-ink-0')}
        >
          <Pipette aria-hidden="true" className="size-3" />
          <input
            type="color"
            aria-label={`${label} (system picker)`}
            disabled={disabled}
            value={swatch}
            onChange={(event) => {
              native.current = event.target.value.toUpperCase()
              setPicking(native.current)
            }}
            onBlur={() => {
              setPicking(null)
              commit(native.current)
            }}
            // `change` on a native colour input fires on close in some engines and on every
            // drag in others; committing on blur, guarded by a value comparison, behaves the
            // same either way.
            onKeyUp={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </label>
      </div>
      <Popover {...picker.surfaceProps} label={label} width={188}>
        <div className="flex flex-col gap-2 [&_.react-colorful__hue]:h-3 [&_.react-colorful__hue]:rounded-full [&_.react-colorful__pointer]:size-4 [&_.react-colorful__saturation]:rounded-sm [&_.react-colorful__saturation]:border-b-0">
          <HexColorPicker
            color={swatch}
            style={{ width: '100%', height: 148, gap: 8 }}
            onChange={(next) => {
              const hex = next.toUpperCase()
              setPicking(hex)
              if (bracket.live) {
                bracket.begin()
                commit(hex)
              }
            }}
            onChangeEnd={(next) => {
              setPicking(null)
              commit(next)
              bracket.end()
            }}
          />
          <div className="flex h-7 items-center rounded-sm border border-line bg-surface-1 px-2 focus-within:border-accent">
            <HexInput label={`${label} hex, in the picker`} value={swatch} onCommit={commit} />
          </div>
        </div>
      </Popover>
    </>
  )
}

/**
 * A hex box that commits on Enter or blur, never per keystroke: typing `FF0000` passes through
 * `FF0`, which is a colour too, and each would otherwise be an undo step.
 */
function HexInput({
  label,
  value,
  disabled = false,
  onCommit
}: {
  label: string
  value: string
  disabled?: boolean
  onCommit(value: string): void
}): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelling = useRef(false)
  return (
    <input
      aria-label={label}
      disabled={disabled}
      value={draft ?? value.toUpperCase()}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setDraft(value.toUpperCase())}
      onBlur={() => {
        const cancelled = cancelling.current
        cancelling.current = false
        const next = draft === null || cancelled ? null : normaliseHex(draft)
        setDraft(null)
        // An unparseable hex reverts rather than committing a colour nothing can render.
        if (next) onCommit(next)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          cancelling.current = true
          event.currentTarget.blur()
        }
      }}
      className="min-w-0 flex-1 bg-transparent text-[11px] text-ink-0 uppercase tabular-nums outline-none disabled:cursor-not-allowed"
    />
  )
}
