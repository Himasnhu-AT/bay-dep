import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { Item } from '@shared/project'
import { EFFECTS, effectSpec, MAX_EFFECTS } from '@shared/effects/index'
import { effectDraws, resolveParam } from '@shared/effects/resolve'
import type { Effect, EffectParam, EffectParamValue, EffectSpec } from '@shared/effects/spec'
import { ColorField, Field, IconButton, Section, Select, SliderField, Switch } from '@/components'
import { cn } from '@/lib/cn'
import { useEditor } from '@/store/editor'
import { LIVE } from './liveGesture'

/**
 * A clip's video effect stack: what is on it, in the order it is drawn, each with its switch, its
 * place and its parameters.
 *
 * Every control is declared by the effect itself (`@shared/effects`): the ranges here are the
 * ranges `edit_effects` accepts, so nothing the agent sets reads back as a pinned slider and
 * nothing set here is refused there. Changes go through the store's effect actions, which run the
 * same checks as the tool.
 *
 * One clip at a time. A stack is a list with an order, and "the third effect" of two different
 * clips is two different things — so with several clips selected this lists nothing and says so,
 * while Add still adds to each of them (as the Effects Library does).
 */

/** The readout beside a slider: the number as stored, then the parameter's unit. */
function formatNumber(value: number, param: Extract<EffectParam, { type: 'number' }>): string {
  if (!Number.isFinite(value)) return '—'
  const decimals = param.step >= 1 ? 0 : param.step >= 0.1 ? 1 : param.step >= 0.01 ? 2 : 3
  return `${value.toFixed(decimals)}${param.unit ?? ''}`
}

function ParamControl({
  spec,
  effect,
  name,
  param,
  disabled,
  onChange
}: {
  spec: EffectSpec
  effect: Effect
  name: string
  param: EffectParam
  disabled: boolean
  onChange(value: EffectParamValue): void
}): ReactNode {
  const caption = param.caption ?? param.label
  const accessible = `${spec.label} ${param.label}`
  // What draws, not what is stored: a value out of range or unreadable shows where the compositor
  // put it, so the slider and the picture agree.
  const resolved = resolveParam(param, effect.params[name])
  switch (param.type) {
    case 'number':
      return (
        <SliderField
          label={caption}
          ariaLabel={accessible}
          value={resolved as number}
          min={param.min}
          max={param.max}
          step={param.step}
          defaultValue={param.default}
          disabled={disabled}
          format={(value) => formatNumber(value, param)}
          onCommit={onChange}
          gesture={LIVE}
        />
      )
    case 'color':
      return (
        <Field label={caption}>
          <ColorField
            label={accessible}
            value={typeof effect.params[name] === 'string' ? (effect.params[name] as string) : param.default}
            disabled={disabled}
            onCommit={onChange}
            gesture={LIVE}
          />
        </Field>
      )
    case 'boolean':
      return (
        <Field label={caption}>
          <Switch label={accessible} checked={resolved === true} disabled={disabled} onChange={onChange} />
        </Field>
      )
    case 'point': {
      const [x, y] = resolved as [number, number]
      const axis = (label: string, value: number, set: (next: number) => [number, number]): ReactNode => (
        <SliderField
          label={`${caption} ${label}`}
          ariaLabel={`${accessible} ${label}`}
          value={value}
          min={0}
          max={1}
          step={0.01}
          defaultValue={label === 'X' ? param.default[0] : param.default[1]}
          disabled={disabled}
          format={(v) => `${Math.round(v * 100)}%`}
          onCommit={(next) => onChange(set(next))}
          gesture={LIVE}
        />
      )
      return (
        <>
          {axis('X', x, (next) => [next, y])}
          {axis('Y', y, (next) => [x, next])}
        </>
      )
    }
  }
}

function EffectCard({ item, effect, index, count }: { item: Item; effect: Effect; index: number; count: number }): ReactNode {
  const patchEffect = useEditor((state) => state.patchEffect)
  const moveEffect = useEditor((state) => state.moveEffect)
  const removeEffect = useEditor((state) => state.removeEffect)
  const toggleEffect = useEditor((state) => state.toggleEffect)
  const spec = effectSpec(effect.kind)
  const on = effect.enabled !== false
  const name = spec?.label ?? effect.kind

  return (
    <li className="rounded-sm border border-line bg-surface-2">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Switch label={`${name} on`} checked={on} onChange={() => toggleEffect(item.id, effect.id)} />
        <span className={cn('min-w-0 flex-1 truncate text-[12px]', on ? 'text-ink-0' : 'text-ink-2')} title={spec?.description}>
          {name}
        </span>
        <IconButton
          size="xs"
          label={`Move ${name} earlier`}
          icon={<ChevronUp aria-hidden="true" className="size-3" />}
          disabled={index === 0}
          onClick={() => moveEffect(item.id, effect.id, index - 1)}
        />
        <IconButton
          size="xs"
          label={`Move ${name} later`}
          icon={<ChevronDown aria-hidden="true" className="size-3" />}
          disabled={index === count - 1}
          onClick={() => moveEffect(item.id, effect.id, index + 1)}
        />
        <IconButton
          size="xs"
          label={`Remove ${name}`}
          icon={<X aria-hidden="true" className="size-3" />}
          onClick={() => removeEffect(item.id, effect.id)}
        />
      </div>
      {spec ? (
        <div className={cn('space-y-0.5 border-t border-line px-2 py-1.5', !on && 'opacity-60')}>
          {Object.entries(spec.params).map(([key, param]) => (
            <ParamControl
              key={key}
              spec={spec}
              effect={effect}
              name={key}
              param={param}
              disabled={!on}
              onChange={(value) => patchEffect(item.id, effect.id, { params: { [key]: value } })}
            />
          ))}
          {/* On, and still drawing nothing: said here, because a slider at zero looks like any other. */}
          {on && !effectDraws(effect) && (
            <p className="pt-0.5 text-[10px] text-ink-2">At these values it changes nothing, so it is not drawn.</p>
          )}
        </div>
      ) : (
        <p className="border-t border-line px-2 py-1.5 text-[10px] leading-relaxed text-warning">
          This version of bay has no “{effect.kind}” effect, so it is skipped. Remove it, or open the project in the version that made it.
        </p>
      )}
    </li>
  )
}

export function EffectStackSection({ items }: { items: Item[] }): ReactNode {
  const addEffect = useEditor((state) => state.addEffect)
  const transact = useEditor((state) => state.transact)
  const first = items[0]
  if (!first) return null
  const single = items.length === 1
  const stack = single ? (first.effects ?? []) : []
  const full = items.every((item) => (item.effects?.length ?? 0) >= MAX_EFFECTS)

  const add = (kind: string): void => {
    if (!kind) return
    transact(() => {
      for (const item of items) addEffect(item.id, kind)
    })
  }

  return (
    <Section
      id="inspector.effects"
      title="Effects"
      collapsible
      hint="Shader effects drawn on this clip, top to bottom, after its colour grade and before Adjustments. Order changes the picture."
    >
      <Field label="Add">
        <Select
          label="Add an effect"
          value=""
          disabled={full}
          options={[{ value: '', label: full ? `At most ${MAX_EFFECTS} effects` : 'Choose an effect…' }, ...EFFECTS.map((spec) => ({ value: spec.kind, label: spec.label }))]}
          onChange={add}
        />
      </Field>
      {!single ? (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
          {items.length} clips selected. Add puts the effect on each; select one clip to change or reorder its effects.
        </p>
      ) : stack.length === 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
          No effects on this clip. Add one here, or from Effects in the library — click it, or drag it onto a clip.
        </p>
      ) : (
        <ol aria-label="Effects on this clip, in the order they are drawn" className="mt-2 flex flex-col gap-1.5">
          {stack.map((effect, index) => (
            <EffectCard key={effect.id} item={first} effect={effect} index={index} count={stack.length} />
          ))}
        </ol>
      )}
    </Section>
  )
}

/** Whether any clip has an effect that is switched on — the Effects tab's badge. */
export function effectsTouched(items: Item[]): boolean {
  return items.some((item) => item.effects?.some((effect) => effect.enabled !== false))
}
