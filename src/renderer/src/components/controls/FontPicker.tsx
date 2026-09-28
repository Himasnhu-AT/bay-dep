import { useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFloatingTrigger } from '../Floating'
import { Popover } from '../Popover'
import { fontGroups } from './fonts'

export interface FontOption {
  /** The CSS stack stored on the text item — `"Archivo", sans-serif`. */
  value: string
  /** The family's name as a person reads it. */
  label: string
  /** Which list it belongs to: the project's own imported fonts, or this machine's. */
  group: 'project' | 'system'
}

/** What a typed family would be: the stack to store (null when it cannot be one) and a note. */
export interface TypedFont {
  stack: string | null
  note: string
  /** The note is a warning — not a font name, or not on this machine. */
  warn: boolean
}

export interface FontPickerProps {
  /** The accessible name — "Font family". */
  label: string
  value: string
  options: FontOption[]
  onChange(stack: string): void
  /**
   * Reads a family typed into the search box, for the "Use …" row — the escape hatch for any
   * family or stack the lists do not hold. Without it only listed families can be chosen.
   */
  typed?(text: string): TypedFont
  disabled?: boolean
  mixed?: boolean
}

/**
 * A font picker in the shape of shadcn's Command (cmdk, MIT): type to filter, arrows to move,
 * Enter to choose, each family drawn in its own face. The project's imported fonts come first —
 * they travel with the project — then the families measured present on this machine. A family
 * not in either can still be typed: the last row uses what was typed, with a note saying whether
 * it is on this Mac (a missing family draws in a substitute, in the preview and the export).
 */
export function FontPicker({ label, value, options, onChange, typed, disabled = false, mixed = false }: FontPickerProps): ReactNode {
  const trigger = useFloatingTrigger('dialog')
  const [query, setQuery] = useState('')
  const current = options.find((option) => option.value === value)
  const shownName = mixed ? 'Mixed' : (current?.label ?? value.split(',')[0]?.replace(/["']/g, '').trim() ?? value)
  const { project, system } = fontGroups(options, query)
  const exact = options.some((option) => option.label.toLowerCase() === query.trim().toLowerCase())
  const custom = typed && query.trim() !== '' && !exact ? typed(query) : null

  const choose = (stack: string): void => {
    trigger.setOpen(false)
    setQuery('')
    if (stack !== value) onChange(stack)
  }

  const row = (option: FontOption): ReactNode => (
    <Command.Item
      key={option.value}
      value={option.value}
      onSelect={() => choose(option.value)}
      className="flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] text-ink-0 data-[selected=true]:bg-accent/14 outline-none"
    >
      <Check aria-hidden="true" className={cn('size-3 shrink-0 text-accent', option.value === value ? 'opacity-100' : 'opacity-0')} />
      {/* Drawn in its own face: choosing a typeface by its name alone is choosing blind. */}
      <span className="min-w-0 flex-1 truncate" style={{ fontFamily: option.value }}>
        {option.label}
      </span>
    </Command.Item>
  )

  return (
    <>
      <button
        type="button"
        {...trigger.triggerProps}
        disabled={disabled}
        aria-label={`${label}: ${shownName}`}
        className={cn(
          'flex h-7 w-full min-w-0 items-center gap-2 rounded-sm border border-line bg-surface-2 pr-1.5 pl-2 text-left text-[12px] text-ink-0 t-fast',
          disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-line-strong'
        )}
      >
        <span className="min-w-0 flex-1 truncate" style={mixed ? undefined : { fontFamily: value }}>
          {shownName}
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-3 shrink-0 text-ink-2" />
      </button>
      <Popover {...trigger.surfaceProps} label={label} width={232} className="p-1.5">
        {/* Filtering is ours (by family name); cmdk keeps the keyboard, the ARIA combobox and
            listbox, and the selection. */}
        <Command label={label} shouldFilter={false} loop>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search fonts, or type any family"
            className="mb-1 h-7 w-full rounded-sm border border-line bg-surface-1 px-2 text-[12px] text-ink-0 outline-none placeholder:text-ink-2 focus:border-accent"
          />
          <Command.List className="max-h-64 overflow-y-auto">
            {project.length === 0 && system.length === 0 && !custom && (
              <Command.Empty className="px-2 py-3 text-[11px] text-ink-2">No font by that name.</Command.Empty>
            )}
            {project.length > 0 && (
              <Command.Group heading="In this project" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-ink-2">
                {project.map(row)}
              </Command.Group>
            )}
            {system.length > 0 && (
              <Command.Group heading="On this Mac" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-ink-2">
                {system.map(row)}
              </Command.Group>
            )}
            {custom && (
              <Command.Group heading="Typed" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-ink-2">
                <Command.Item
                  value={`typed:${query}`}
                  disabled={custom.stack === null}
                  onSelect={() => custom.stack && choose(custom.stack)}
                  className="flex cursor-default flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 outline-none data-[disabled=true]:opacity-60 data-[selected=true]:bg-accent/14"
                >
                  <span className="text-[13px] text-ink-0" style={custom.stack ? { fontFamily: custom.stack } : undefined}>
                    Use “{query.trim()}”
                  </span>
                  <span className={cn('text-[11px] text-pretty', custom.warn ? 'text-warning' : 'text-ink-2')}>{custom.note}</span>
                </Command.Item>
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </Popover>
    </>
  )
}
