import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { findAsset, type Item } from '@shared/project'
import { EFFECT_CATEGORY_LABEL, EFFECTS, takesEffects, type EffectCategory, type EffectSpec } from '@shared/effects/index'
import { cn } from '@/lib/cn'
import { EFFECT_DRAG_TYPE, encodeEffectDrag } from '@/lib/effectDrag'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * Adds `kind` to each of `items` as one undo step, shows its controls, and says what happened.
 * The one edit behind a click in the library and a drop on a clip.
 */
export function addEffectTo(items: readonly Item[], kind: string, label: string): void {
  const state = useEditor.getState()
  if (items.length === 0) {
    state.notify(`Select a clip with a picture to add ${label} to, or drag it onto one on the timeline.`)
    return
  }
  let added = 0
  state.transact(() => {
    for (const item of items) if (useEditor.getState().addEffect(item.id, kind)) added += 1
  })
  // A refusal (a locked track, a full stack) has already been shown by the store.
  if (added === 0) return
  state.setInspectorTab('effects')
  state.notify(`${label} added to ${added === 1 ? '1 clip' : `${added} clips`}. Its controls are in the inspector’s Effects tab. ⌘Z to undo.`)
}

const CATEGORY_ORDER: EffectCategory[] = ['key', 'blur', 'stylize', 'colour', 'distort']

/**
 * The video effects, by category: click one to add it to the selected clips, or drag it onto any
 * clip on the timeline. Rows stay where they are with nothing selected, dimmed, under a line
 * saying what to do — the list does not jump when a clip is clicked.
 */
export function VideoEffects(): ReactNode {
  const selected = useSelectedItems()
  const project = useEditor((state) => state.project)
  const timeline = useEditor(selectTimeline)
  const targets = selected.filter((item) => {
    const track = timeline?.tracks.find((candidate) => candidate.id === item.trackId)
    return track?.kind === 'video' && takesEffects(findAsset(project, item.assetId)?.kind)
  })

  const row = (spec: EffectSpec): ReactNode => (
    <li key={spec.kind}>
      <button
        type="button"
        // Not disabled with nothing selected: a row still drags onto any clip, and a click says
        // why nothing happened.
        aria-label={`Add ${spec.label}${targets.length > 0 ? ` to ${targets.length === 1 ? 'the selected clip' : `${targets.length} selected clips`}` : ''}, or drag it onto a clip`}
        title={spec.description}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(EFFECT_DRAG_TYPE, encodeEffectDrag(spec.kind))
          event.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => addEffectTo(targets, spec.kind, spec.label)}
        className={cn(
          't-press flex w-full cursor-grab items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-3 active:scale-[0.98]',
          targets.length === 0 && 'opacity-60'
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-ink-0">{spec.label}</span>
          <span className="block truncate text-[11px] text-ink-2">{spec.description.split('. ')[0]}</span>
        </span>
        <Plus aria-hidden="true" className="size-3.5 shrink-0 text-ink-2" />
      </button>
    </li>
  )

  return (
    <div>
      <p className="px-3 pt-3 text-[11px] leading-snug text-ink-2">
        {targets.length === 0
          ? 'Select a clip with a picture, then click an effect — or drag one onto a clip.'
          : `Click to add to ${targets.length === 1 ? 'the selected clip' : `${targets.length} selected clips`}, or drag onto any clip.`}
      </p>
      {CATEGORY_ORDER.map((category) => {
        const specs = EFFECTS.filter((spec) => spec.category === category)
        if (specs.length === 0) return null
        return (
          <div key={category}>
            <h3 className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-[0.08em] text-ink-1 uppercase">{EFFECT_CATEGORY_LABEL[category]}</h3>
            <ul className="flex flex-col px-1.5">{specs.map(row)}</ul>
          </div>
        )
      })}
      <p className="px-3 pt-2 pb-1 text-[10px] leading-relaxed text-ink-2">
        An even soft blur is Blur under Adjustments; vignette, grain and halation are in the Color tab’s grade.
      </p>
    </div>
  )
}
