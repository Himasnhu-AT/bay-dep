import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  AUDIO_EFFECT_CATALOG,
  AUDIO_EFFECT_PRESETS,
  effectSpec,
  isBakedKind,
  isIdentity,
  itemEffectPlan,
  paramOf,
  type AudioEffect,
  type AudioEffectKind,
  type ParamSpec
} from '@shared/audio-effects'
import type { AudioBakeState } from '@shared/audio-bake'
import { findAsset, type Item, type Project, type Track } from '@shared/project'
import { Button, IconButton, InlineAlert, NumberField, Section, Select, Switch } from '@/components'
import { audioBakes } from '@/engine/audioBakes'
import { audioEffectsTool } from '@/mcp/audioEffects'
import { ToolError } from '@/mcp/helpers'
import { useEditor } from '@/store/editor'

/**
 * A clip's or a track's audio effect chain: add from the catalogue or a preset, switch each stage
 * on and off, move it up and down, set every parameter in its own unit, remove it.
 *
 * Every write goes through `audio_effects`' own executor, like the rest of the inspector's sound
 * controls, so what is set here is checked by the same ranges and read back by the same tool.
 */
export function AudioEffectsSection({
  target,
  effects,
  title,
  clips,
  project
}: {
  target: { itemId: string } | { trackId: string }
  effects: readonly AudioEffect[] | undefined
  title: string
  /** The clips this chain is heard on — the clip itself, or every clip of the track — with their tracks. */
  clips: readonly { item: Item; track: Track }[]
  project: Project
}): ReactNode {
  const list = effects ?? []
  const call = (args: Record<string, unknown>): void => {
    try {
      audioEffectsTool({ ...target, ...args })
    } catch (error) {
      if (!(error instanceof ToolError)) throw error
      useEditor.getState().notify(error.userMessage ?? error.message, 'error')
    }
  }
  const key = 'itemId' in target ? target.itemId : target.trackId

  return (
    <Section title={title} collapsible id={`audio-effects-${'itemId' in target ? 'clip' : 'track'}`}>
      <div className="flex items-center gap-1.5">
        <Select<string>
          label="Add an audio effect"
          value=""
          className="min-w-0 flex-1"
          options={[
            { value: '', label: 'Add effect…', disabled: true },
            ...AUDIO_EFFECT_CATALOG.map((spec) => ({ value: spec.kind, label: spec.label }))
          ]}
          onChange={(kind) => kind && call({ action: 'add', kind })}
        />
        <Select<string>
          label="Apply an audio effect preset"
          value=""
          className="min-w-0 flex-1"
          options={[
            { value: '', label: 'Preset…', disabled: true },
            ...AUDIO_EFFECT_PRESETS.map((preset) => ({ value: preset.slug, label: preset.name }))
          ]}
          onChange={(preset) => preset && call({ action: 'preset', preset })}
        />
      </div>

      {list.length === 0 ? (
        <p className="mt-2 text-[11px] text-pretty text-ink-2">
          No effects. Add an equaliser band, a compressor, a gate, a de-esser, a limiter or noise removal — or start
          from a preset and adjust it.
        </p>
      ) : (
        <ol className="mt-2 space-y-2" aria-label={`${title}, in the order they run`}>
          {list.map((effect, index) => (
            <EffectCard
              key={effect.id}
              scope={key}
              effect={effect}
              first={index === 0}
              last={index === list.length - 1}
              onEdit={(args) => call({ action: 'edit', effectId: effect.id, ...args })}
              onMove={(to) => call({ action: 'move', effectId: effect.id, index: to })}
              onRemove={() => call({ action: 'remove', effectId: effect.id })}
              index={index}
            />
          ))}
        </ol>
      )}

      {list.length > 0 && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => call({ action: 'clear' })}>
            Remove all
          </Button>
        </div>
      )}

      <BakeStatus clips={clips} project={project} />
    </Section>
  )
}

function EffectCard({
  scope,
  effect,
  index,
  first,
  last,
  onEdit,
  onMove,
  onRemove
}: {
  scope: string
  effect: AudioEffect
  index: number
  first: boolean
  last: boolean
  onEdit(args: { params?: Record<string, number>; enabled?: boolean }): void
  onMove(toIndex: number): void
  onRemove(): void
}): ReactNode {
  const spec = effectSpec(effect.kind)
  if (!spec) return null
  const on = effect.enabled !== false
  const switchId = `afx-${scope}-${effect.id}`
  return (
    <li className="rounded-sm border border-line bg-surface-2 p-2">
      <div className="flex items-center gap-1.5">
        <Switch id={switchId} checked={on} onChange={(enabled) => onEdit({ enabled })} />
        <label htmlFor={switchId} className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-0" title={spec.description}>
          {spec.label}
        </label>
        <IconButton
          label={`Move ${spec.label} earlier`}
          icon={<ChevronUp className="size-3.5" />}
          disabled={first}
          onClick={() => onMove(index - 1)}
        />
        <IconButton
          label={`Move ${spec.label} later`}
          icon={<ChevronDown className="size-3.5" />}
          disabled={last}
          onClick={() => onMove(index + 1)}
        />
        <IconButton label={`Remove ${spec.label}`} icon={<X className="size-3.5" />} onClick={onRemove} />
      </div>
      <div className={on ? 'mt-1.5 space-y-1.5' : 'mt-1.5 space-y-1.5 opacity-50'}>
        {spec.params.map((param) => (
          <NumberField
            key={param.key}
            row
            label={param.label}
            ariaLabel={`${spec.label} ${param.label.toLowerCase()}, ${unitWords(param)}. ${param.hint}`}
            value={paramOf(effect, param.key)}
            min={param.min}
            max={param.max}
            step={stepOf(param)}
            precision={precisionOf(param)}
            suffix={suffixOf(param)}
            defaultValue={param.default}
            onCommit={(next) => onEdit({ params: { [param.key]: Math.min(param.max, Math.max(param.min, next)) } })}
          />
        ))}
      </div>
      {on && isIdentity(effect) && (
        <p className="mt-1.5 text-[10px] text-ink-2">As set, this changes nothing.</p>
      )}
      {on && isBakedKind(effect.kind as AudioEffectKind) && !isIdentity(effect) && (
        <p className="mt-1.5 text-[10px] text-pretty text-ink-2">
          Rendered into the clip’s sound, so preview and export are the same samples. A change takes a moment to be heard.
        </p>
      )}
    </li>
  )
}

const unitWords = (param: ParamSpec): string =>
  ({ Hz: 'hertz', dB: 'decibels', ms: 'milliseconds', ratio: 'ratio to one', Q: 'Q', '%': 'percent' })[param.unit]

const suffixOf = (param: ParamSpec): string => (param.unit === 'ratio' ? ':1' : param.unit === 'Q' ? '' : param.unit)

const stepOf = (param: ParamSpec): number =>
  param.unit === 'Hz' ? 10 : param.unit === 'ms' ? 1 : param.unit === '%' ? 1 : 0.1

const precisionOf = (param: ParamSpec): number =>
  param.unit === 'Hz' || param.unit === '%' ? 0 : param.unit === 'Q' ? 2 : 1

/**
 * What is true of the processed sound right now: being rendered, failed (with why, and a retry),
 * or nothing to say. Asking here is also what starts a bake while the transport is stopped, so
 * the processed file is usually there by the time play is pressed.
 */
function BakeStatus({ clips, project }: { clips: readonly { item: Item; track: Track }[]; project: Project }): ReactNode {
  useSyncExternalStore(audioBakes.subscribe, audioBakes.version)
  const wanted = clips.flatMap(({ item, track }) => {
    const asset = findAsset(project, item.assetId)
    const plan = itemEffectPlan(track, item)
    if (!asset?.path || !asset.hasAudio || asset.error || item.audioDetached || plan.bake.length === 0) return []
    return [{ path: asset.path, name: asset.name, effects: plan.bake }]
  })
  // After render: `lookup` notifies subscribers, which must not happen while React is rendering.
  useEffect(() => {
    for (const each of wanted) audioBakes.lookup(each.path, each.effects)
  })
  if (wanted.length === 0) return null
  const states = wanted.map((each) => ({ ...each, state: audioBakes.peek(each.path, each.effects) ?? PENDING }))
  const failed = states.filter((each) => each.state.state === 'failed')
  const pending = states.filter((each) => each.state.state === 'pending')
  if (failed.length > 0) {
    const first = failed[0]!
    return (
      <InlineAlert tone="danger" className="mt-2">
        <span className="text-pretty">
          {failed.length === 1 ? `${first.name}: ` : `${failed.length} clips could not be processed. ${first.name}: `}
          {first.state.state === 'failed' ? first.state.error : ''} The preview plays the unprocessed sound; an export will
          stop with this error.
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="mt-1"
          onClick={() => failed.forEach((each) => audioBakes.retry(each.path, each.effects))}
        >
          Try again
        </Button>
      </InlineAlert>
    )
  }
  if (pending.length > 0) {
    return (
      <p className="mt-2 text-[10px] text-pretty text-ink-2" role="status">
        Processing the sound of {pending.length === 1 ? pending[0]!.name : `${pending.length} clips`}… Until it is ready
        the preview plays {pending.length === 1 ? 'it' : 'them'} without the compressor, gate, de-esser, limiter and noise
        removal.
      </p>
    )
  }
  return null
}

const PENDING: AudioBakeState = { state: 'pending' }
