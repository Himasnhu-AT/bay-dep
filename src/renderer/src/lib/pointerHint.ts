/**
 * The one line the timeline shows before a drag: what the tool in hand, a trim armed from the
 * clip menu, or ⌥ held over a clip will do. Slip, slide and roll have no other visible
 * affordance — this line and the shortcuts sheet's "Mouse gestures" are where they are learned.
 * Pure, so each state's sentence is checked without a window.
 */

import { formatTimecode } from '@shared/project'
import type { TrimMode } from '@shared/trim'

export interface HintHover {
  zone: 'start' | 'end' | 'body'
  /** Where a blade click would cut; null when it would not (on an edge, or not the blade). */
  frame: number | null
}

export function pointerHint(
  tool: 'select' | 'blade',
  armed: TrimMode | null,
  mods: { alt: boolean; shift: boolean },
  hover: HintHover | null,
  fps: number
): string | null {
  if (tool === 'blade') {
    if (!hover) return 'Blade: click a clip to cut it, ⇧-click to cut every track. A or Escape for Select.'
    if (hover.frame === null) return 'Blade: that is the clip’s edge. Click inside the clip to cut it.'
    const at = formatTimecode(hover.frame, fps, true)
    return mods.shift ? `Click to cut every unlocked track at ${at}` : `Click to cut at ${at} · ⇧ cuts every track`
  }
  if (armed === 'slip') return 'Slip armed: drag a clip to change which part of its footage plays. Escape cancels.'
  if (armed === 'slide') return 'Slide armed: drag a clip to move it between its neighbours. Escape cancels.'
  if (armed === 'roll') return 'Roll armed: drag near a clip’s edge to move that cut. Escape cancels.'
  if (!mods.alt || !hover) return null
  if (hover.zone !== 'body') return 'Roll: drag to move this cut, trimming both clips at once'
  return mods.shift
    ? 'Slide: drag to move this clip between its neighbours; they trim to follow'
    : 'Slip: drag to change which part of the footage plays · add ⇧ to slide'
}
