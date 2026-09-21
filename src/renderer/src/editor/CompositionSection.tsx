import type { ReactNode } from 'react'
import { Code2, RotateCcw } from 'lucide-react'
import type { Asset, Item } from '@shared/project'
import {
  resolveVariables,
  type CompositionVariable,
  type CompositionVariableValue
} from '@shared/composition'
import { ColorField, IconButton, NumberField, Section, Select, Slider } from '@/components'
import { useEditor } from '@/store/editor'
import { cn } from '@/lib/cn'

/**
 * The controls an HTML composition declares for itself.
 *
 * bay does not guess at which parts of arbitrary HTML are editable — it draws exactly the
 * controls the composition declared on `<html data-composition-variables>`, and nothing else.
 * That is what makes this tractable: a field here is bound to something the author wired up,
 * so it cannot be one of the dead controls this codebase keeps finding.
 *
 * Values live on the **item**, so one lower-third template placed four times can name four
 * different people. A composition that declares nothing gets a short explanation of how to
 * declare something rather than an empty panel, because "no controls" and "this composition
 * has no controls" look identical otherwise.
 */
export interface CompositionSectionProps {
  items: Item[]
  asset: Asset | undefined
}

export function CompositionSection({ items, asset }: CompositionSectionProps): ReactNode {
  const setVariable = useEditor((state) => state.setCompositionVariable)
  const transact = useEditor((state) => state.transact)
  const first = items[0]
  if (!first || asset?.kind !== 'html') return null

  const declared = asset.compositionVariables ?? []
  const values = resolveVariables({ variables: declared }, first.variables)

  const set = (id: string, value: CompositionVariableValue): void => {
    // One undo step for a change made across a multiple selection, so Cmd+Z reverses the edit
    // rather than the last clip it happened to touch.
    transact(() => {
      for (const item of items) setVariable(item.id, id, value)
    })
  }

  const isOverridden = (id: string): boolean => first.variables?.[id] !== undefined

  return (
    <Section
      title="Composition"
      actions={
        <span className="flex items-center gap-1.5 text-[10px] text-ink-2">
          <Code2 aria-hidden="true" className="size-3" />
          {asset.name}
        </span>
      }
    >
      {declared.length === 0 ? (
        <p className="text-[10px] leading-relaxed text-ink-2">
          This composition declares no controls. Add them to the file with{' '}
          <code className="text-ink-1">data-composition-variables</code> on its{' '}
          <code className="text-ink-1">&lt;html&gt;</code> element, then bind one with{' '}
          <code className="text-ink-1">data-var-text</code> or read it in CSS as{' '}
          <code className="text-ink-1">var(--id)</code>.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {declared.map((variable) => (
            <VariableField
              key={variable.id}
              variable={variable}
              value={values[variable.id] ?? variable.default}
              overridden={isOverridden(variable.id)}
              onChange={(value) => set(variable.id, value)}
              onReset={() => set(variable.id, variable.default)}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

function VariableField({
  variable,
  value,
  overridden,
  onChange,
  onReset
}: {
  variable: CompositionVariable
  value: CompositionVariableValue
  overridden: boolean
  onChange: (value: CompositionVariableValue) => void
  onReset: () => void
}): ReactNode {
  // Every control here carries its own label, so there is no `Field` wrapper: one would label
  // the row and the control would label itself again.
  return (
    <div className="flex items-end gap-1.5">
      <Control variable={variable} value={value} onChange={onChange} />
      {/* Offered only when there is something to reset to. An always-present control that
          usually does nothing trains people to ignore it. */}
      {overridden ? (
        <IconButton
          label={`Reset ${variable.label} to the composition's default`}
          icon={<RotateCcw aria-hidden="true" className="size-3" />}
          onClick={onReset}
          size="sm"
          variant="subtle"
        />
      ) : null}
    </div>
  )
}

function Control({
  variable,
  value,
  onChange
}: {
  variable: CompositionVariable
  value: CompositionVariableValue
  onChange: (value: CompositionVariableValue) => void
}): ReactNode {
  switch (variable.type) {
    case 'color':
      return (
        <ColorField
          label={variable.label}
          value={String(value)}
          onCommit={(next) => onChange(next)}
          className="flex-1"
        />
      )

    case 'boolean':
      return (
        <label className="flex flex-1 items-center justify-between gap-2">
          <span className="text-[11px] text-ink-1">{variable.label}</span>
          <button
          type="button"
          role="switch"
          aria-label={variable.label}
          aria-checked={value === true}
          onClick={() => onChange(value !== true)}
          className={cn(
            'h-6 w-10 rounded-full border transition-colors',
            value === true ? 'border-accent bg-accent/70' : 'border-line bg-surface-2'
          )}
        >
          <span
            className={cn(
              'block size-4 rounded-full bg-ink-0 transition-transform',
              value === true ? 'translate-x-5' : 'translate-x-0.5'
            )}
          />
          </button>
        </label>
      )

    case 'enum':
      return (
        <Select
          label={variable.label}
          value={String(value)}
          onChange={(next) => onChange(next)}
          options={(variable.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
          className="flex-1"
        />
      )

    case 'number':
      // A slider when the author bounded it, a number field when they did not — a slider with
      // no range has nothing to slide between.
      return variable.min !== undefined && variable.max !== undefined ? (
        <Slider
          label={variable.label}
          min={variable.min}
          max={variable.max}
          step={variable.step ?? 1}
          value={Number(value)}
          onCommit={(next) => onChange(next)}
          className="flex-1"
        />
      ) : (
        <NumberField
          label={variable.label}
          value={Number(value)}
          min={variable.min}
          max={variable.max}
          step={variable.step}
          suffix={variable.unit}
          onCommit={(next) => onChange(next)}
          className="flex-1"
        />
      )

    default:
      return (
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[11px] text-ink-1">{variable.label}</span>
          <input
            type="text"
            value={String(value)}
            placeholder={variable.placeholder}
            maxLength={variable.maxLength}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-xs text-ink-0 outline-none focus:border-accent"
          />
        </label>
      )
  }
}
