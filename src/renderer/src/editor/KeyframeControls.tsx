/**
 * The inspector's keyframe controls: a diamond beside each animatable field, and previous/next
 * key buttons for a section.
 *
 * The diamond reads three ways, the way every NLE's does: hollow and dim when the property is
 * not animated (click: start animating it, with a key at the playhead holding today's value);
 * hollow and lit when it is animated but the playhead is between keys (click: add a key here at
 * the value the curve has here, so nothing jumps); filled when the playhead sits on a key
 * (click: remove that key). A value typed or dragged into an animated field keys the playhead —
 * `Inspector` does that, through the same store action.
 *
 * Only one clip at a time: a key is a frame of one clip, and five clips with five different
 * curves have no single "key at the playhead" to show.
 */

import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react'
import { KEYFRAME_PROPERTIES, type Item, type KeyframeProperty } from '@shared/project'
import { keyframeValueAt } from '@shared/keyframes'
import { KEYFRAME_REGISTRY } from '@shared/keyframe-registry'
import { IconButton } from '@/components'
import { cn } from '@/lib/cn'
import { useEditor } from '@/store/editor'

/** The label a person reads for each property, in the diamond's tooltip: the registry's, in lower case. */
const nameOf = (property: KeyframeProperty): string => {
  const label = KEYFRAME_REGISTRY[property].label
  return label === 'X' || label === 'Y' ? label : label.toLowerCase()
}

/** The stored value a property holds when it has no keys. */
export function staticValue(item: Item, property: KeyframeProperty): number {
  return KEYFRAME_REGISTRY[property].read(item)
}

/** Item-relative playhead, or null when the playhead is not over the clip (no key can go there). */
export function relativeFrame(item: Item, playhead: number): number | null {
  const frame = playhead - item.from
  return frame >= 0 && frame <= item.durationInFrames ? frame : null
}

export function KeyDiamond({
  item,
  property,
  playhead
}: {
  item: Item
  property: KeyframeProperty
  /**
   * For drawing only — passed in so the inspector subscribes once rather than once per field, and
   * -1 when the clip has no keys (every diamond is then hollow wherever the playhead is). A click
   * reads the live playhead.
   */
  playhead: number
}): ReactNode {
  const setKeyframe = useEditor((state) => state.setKeyframe)
  const notify = useEditor((state) => state.notify)
  const keys = item.keyframes?.[property]
  const animated = Boolean(keys && keys.length > 0)
  const frame = relativeFrame(item, playhead)
  const onKey = animated && frame !== null && keys!.some((key) => key.frame === frame)
  const name = nameOf(property)

  const label = onKey
    ? `Remove the ${name} key at the playhead`
    : animated
      ? `Add a ${name} key at the playhead`
      : `Animate ${name}: add a key at the playhead`

  return (
    <IconButton
      label={label}
      size="xs"
      tooltipSide="left"
      active={onKey}
      className="mb-0.5"
      icon={
        <Diamond
          aria-hidden="true"
          className={cn(
            'size-3',
            onKey ? 'fill-accent text-accent' : animated ? 'text-accent' : 'text-ink-2'
          )}
        />
      }
      onClick={() => {
        const at = relativeFrame(item, useEditor.getState().playhead)
        if (at === null) {
          notify('Move the playhead over this clip to key it: a key is a frame of the clip.')
          return
        }
        if (animated && keys!.some((key) => key.frame === at)) {
          setKeyframe(item.id, property, at, null)
          return
        }
        // The value the clip shows here, so adding a key never makes the picture jump.
        const value = keyframeValueAt(keys, at) ?? staticValue(item, property)
        setKeyframe(item.id, property, at, value)
      }}
    />
  )
}

/** Previous/next key of any of `properties` on `item`, as section actions. */
export function KeyNavigation({
  item,
  properties = KEYFRAME_PROPERTIES,
  playhead
}: {
  item: Item
  properties?: readonly KeyframeProperty[]
  playhead: number
}): ReactNode {
  const setPlayhead = useEditor((state) => state.setPlayhead)
  const frames = new Set<number>()
  for (const property of properties) {
    for (const key of item.keyframes?.[property] ?? []) {
      // Keys a trim left outside the clip still shape the curve, but there is nothing to see there.
      if (key.frame >= 0 && key.frame <= item.durationInFrames) frames.add(item.from + key.frame)
    }
  }
  if (frames.size === 0) return null
  const sorted = [...frames].sort((a, b) => a - b)
  const previous = [...sorted].reverse().find((f) => f < playhead)
  const next = sorted.find((f) => f > playhead)
  return (
    <span className="flex items-center">
      <IconButton
        label="Previous key"
        size="xs"
        tooltipSide="left"
        disabled={previous === undefined}
        icon={<ChevronLeft aria-hidden="true" className="size-3" />}
        onClick={() => previous !== undefined && setPlayhead(previous)}
      />
      <IconButton
        label="Next key"
        size="xs"
        tooltipSide="left"
        disabled={next === undefined}
        icon={<ChevronRight aria-hidden="true" className="size-3" />}
        onClick={() => next !== undefined && setPlayhead(next)}
      />
    </span>
  )
}

/** A field with its diamond beside it, bottom-aligned so the diamond sits by the input. */
export function Keyed({ children, diamond }: { children: ReactNode; diamond: ReactNode }): ReactNode {
  if (!diamond) return children
  return (
    <div className="flex items-end gap-0.5">
      <div className="min-w-0 flex-1">{children}</div>
      {diamond}
    </div>
  )
}
