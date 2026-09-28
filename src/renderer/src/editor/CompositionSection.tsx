import type { ReactNode } from 'react'
import { Code2, RotateCcw } from 'lucide-react'
import type { Asset, Item } from '@shared/project'
import {
  resolveVariables,
  type CompositionVariable,
  type CompositionVariableValue
} from '@shared/composition'
import { ColorField, Field, IconButton, NumberField, Section, SectionReset, Select, SliderField, Switch } from '@/components'
import { useEditor } from '@/store/editor'

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
  if (!first || (asset?.kind !== 'html' && asset?.kind !== 'brf')) return null

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

  const overridden = declared.filter((variable) => items.some((item) => item.variables?.[variable.id] !== undefined))

  return (
    <Section
      id="inspector.composition"
      title={asset.kind === 'brf' ? 'Motion graphic' : 'Composition'}
      collapsible
      actions={
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-ink-2">
          <Code2 aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{asset.name}</span>
          <SectionReset
            show={overridden.length > 0}
            label="Reset every control to the composition's defaults"
            onReset={() =>
              transact(() => {
                for (const item of items) {
                  for (const variable of overridden) setVariable(item.id, variable.id, variable.default)
                }
              })
            }
          />
        </span>
      }
    >
      {declared.length === 0 ? (
        // How to declare one depends on what the file is: a motion graphic is a module, and HTML
        // instructions on it pointed at an element it does not have.
        asset.kind === 'brf' ? (
          <p className="text-[10px] leading-relaxed text-ink-2">
            This motion graphic declares no controls. Add them to its code with{' '}
            <code className="text-ink-1">export const vars = {'{'} title: 'Launch day' {'}'}</code>, then read{' '}
            <code className="text-ink-1">vars.title</code> in the scene; each becomes a field here.
          </p>
        ) : (
          <p className="text-[10px] leading-relaxed text-ink-2">
            This composition declares no controls. Add them to the file with{' '}
            <code className="text-ink-1">data-composition-variables</code> on its{' '}
            <code className="text-ink-1">&lt;html&gt;</code> element, then bind one with{' '}
            <code className="text-ink-1">data-var-text</code> or read it in CSS as{' '}
            <code className="text-ink-1">var(--id)</code>.
          </p>
        )
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
      <VariableControl variable={variable} value={value} onChange={onChange} />
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

/** One declared variable's control. Shared with the Templates panel, so a field is drawn one way. */
export function VariableControl({
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
          <Switch
            label={variable.label}
            checked={value === true}
            onChange={(next) => onChange(next)}
          />
        </label>
      )

    case 'enum':
      return (
        // Same reason as the origin selector: `Select` is aria-labelled only, and a bare
        // dropdown among named fields does not say what it sets.
        <Field label={variable.label} className="flex-1">
          <Select
            label={variable.label}
            value={String(value)}
            onChange={(next) => onChange(next)}
            options={(variable.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
          />
        </Field>
      )

    case 'number':
      // A slider when the author bounded it, a number field when they did not — a slider with
      // no range has nothing to slide between.
      return variable.min !== undefined && variable.max !== undefined ? (
        <div className="min-w-0 flex-1">
          <SliderField
            label={variable.label}
            min={variable.min}
            max={variable.max}
            step={variable.step ?? 1}
            value={Number(value)}
            format={(v) => `${Number(v.toFixed(2))}${variable.unit ?? ''}`}
            onCommit={(next) => onChange(next)}
            defaultValue={typeof variable.default === 'number' ? variable.default : undefined}
          />
        </div>
      ) : (
        <NumberField
          label={variable.label}
          value={Number(value)}
          min={variable.min}
          max={variable.max}
          step={variable.step}
          suffix={variable.unit}
          onCommit={(next) => onChange(next)}
          defaultValue={typeof variable.default === 'number' ? variable.default : undefined}
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
