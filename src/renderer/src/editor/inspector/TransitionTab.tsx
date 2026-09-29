import { useState, type ReactNode } from 'react'
import { Plus, Scissors, Trash2 } from 'lucide-react'
import {
  findAsset,
  formatTimecode,
  type Item,
  type KeyframeEase,
  type Project,
  type Timeline,
  type TransitionDirection,
  type TransitionKind
} from '@shared/project'
import { Button, EaseEditor, Field, IconButton, InlineAlert, Section, Select, TimecodeField } from '@/components'
import { LIVE } from '../liveGesture'
import { formatShortcut, runCommand, shortcutOf } from '@/lib/commands'
import { defaultTransitionFrames, junctionsForTrack, whyNoRoom, type Junction } from '@/lib/junctions'
import { useEditor } from '@/store/editor'
import { DIRECTIONAL, TRANSITION_DIRECTIONS, TRANSITION_KINDS } from '../TransitionDialog'

/**
 * The cuts at the selected clips' edges, in timeline order.
 *
 * A cut is not a selectable object in the store — the timeline opens its dialog from a marker —
 * so the inspector reads the cuts off the selection: a clip selected is a clip whose head and
 * tail cuts you are about to want. Only video tracks, as `add_transition` and ⌘T allow.
 */
export function selectedJunctions(project: Project, timeline: Timeline, items: readonly Item[]): Junction[] {
  const ids = new Set(items.map((item) => item.id))
  const trackIds = new Set(items.map((item) => item.trackId))
  return timeline.tracks
    .filter((track) => track.kind === 'video' && trackIds.has(track.id))
    .flatMap((track) => junctionsForTrack(project, timeline, track))
    .filter((junction) => ids.has(junction.from.id) || ids.has(junction.to.id))
    .sort((a, b) => a.cutFrame - b.cutFrame)
}

/** At most this many cuts are listed; a wide multi-selection is not how one edits transitions. */
const MAX_CUTS = 6

export function TransitionTab({
  items,
  project,
  timeline
}: {
  items: Item[]
  project: Project
  timeline: Timeline
}): ReactNode {
  const junctions = selectedJunctions(project, timeline, items)
  const shortcut = shortcutOf('clip.addTransition')
  const addButton = (
    <Button
      variant="subtle"
      icon={<Plus aria-hidden="true" className="size-3.5" />}
      onClick={() => runCommand('clip.addTransition')}
    >
      Add transition{shortcut ? ` (${formatShortcut(shortcut)})` : ''}
    </Button>
  )

  if (junctions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <Scissors aria-hidden="true" className="size-5 text-ink-3" />
        <p className="text-[12px] font-medium text-ink-1">Select a cut on the timeline</p>
        <p className="text-[11px] text-ink-2">
          Cuts where a selected clip meets another on its track appear here.
        </p>
        <div className="mt-1">{addButton}</div>
      </div>
    )
  }

  return (
    <>
      {junctions.slice(0, MAX_CUTS).map((junction) => (
        <CutEditor key={junction.key} junction={junction} project={project} fps={timeline.fps} />
      ))}
      {junctions.length > MAX_CUTS && (
        <p className="px-3 pt-2 text-[11px] text-ink-2">
          {junctions.length - MAX_CUTS} more cuts — select fewer clips to see them.
        </p>
      )}
    </>
  )
}

/**
 * One cut, edited in place. A stored transition's fields commit as they change, one undo step
 * each (Resolve's inspector has no Apply); a bare cut offers the kind and an Add button. The
 * refusal for a cut with no handles is shown in short with the full reason in its tooltip.
 */
function CutEditor({ junction, project, fps }: { junction: Junction; project: Project; fps: number }): ReactNode {
  const existing = junction.transition
  const resolved = junction.resolved
  const noRoom = whyNoRoom(junction)
  const [kind, setKind] = useState<TransitionKind>('cross-dissolve')
  const [direction, setDirection] = useState<TransitionDirection>('left')
  const nameOf = (item: Item): string => findAsset(project, item.assetId)?.name ?? 'clip'

  const patch = (change: { kind?: TransitionKind; durationInFrames?: number; direction?: TransitionDirection; ease?: KeyframeEase }): void => {
    if (!existing) return
    const store = useEditor.getState()
    const nextKind = change.kind ?? existing.kind
    store.transact(() =>
      store.patchTransition(existing.id, {
        ...change,
        // Cleared when the kind does not travel, as the dialog does, or a wipe changed to a
        // dissolve would keep a direction nothing reads.
        direction: DIRECTIONAL.has(nextKind) ? (change.direction ?? existing.direction ?? 'left') : undefined
      })
    )
  }

  const add = (): void => {
    const store = useEditor.getState()
    let outcome: { id: string } | { error: string } = { error: '' }
    store.transact(() => {
      outcome = store.addTransition({
        fromItemId: junction.from.id,
        toItemId: junction.to.id,
        kind,
        durationInFrames: defaultTransitionFrames(junction, fps),
        ...(DIRECTIONAL.has(kind) ? { direction } : {})
      })
    })
    if ('error' in outcome && outcome.error) store.notify(outcome.error, 'error')
  }

  const remove = (): void => {
    if (!existing) return
    const store = useEditor.getState()
    store.transact(() => store.removeTransition(existing.id))
  }

  const shownKind = existing?.kind ?? kind
  const shownDirection = existing?.direction ?? direction

  return (
    <Section
      id="inspector.transition"
      title={`Cut at ${formatTimecode(junction.cutFrame, fps, true)}`}
      actions={
        existing ? (
          <IconButton
            size="xs"
            tooltipSide="left"
            label="Remove transition"
            icon={<Trash2 aria-hidden="true" className="size-3" />}
            onClick={remove}
          />
        ) : undefined
      }
    >
      <p className="mb-2 truncate text-[11px] text-ink-2" title={`${nameOf(junction.from)} → ${nameOf(junction.to)}`}>
        {nameOf(junction.from)} → {nameOf(junction.to)}
      </p>
      {noRoom !== null && !existing ? (
        <p className="text-[11px] text-ink-2" title={noRoom}>
          {noRoom.split(', so ')[0]}. Trim a clip shorter than its source to make room.
        </p>
      ) : (
        <div className="space-y-1.5">
          <Field label="Kind">
            <Select<TransitionKind>
              label="Transition kind"
              value={shownKind}
              options={TRANSITION_KINDS}
              onChange={(next) => (existing ? patch({ kind: next }) : setKind(next))}
            />
          </Field>
          {DIRECTIONAL.has(shownKind) && (
            <Field label="Direction">
              <Select<TransitionDirection>
                label="Transition direction"
                value={shownDirection}
                options={TRANSITION_DIRECTIONS}
                onChange={(next) => (existing ? patch({ direction: next }) : setDirection(next))}
              />
            </Field>
          )}
          {existing ? (
            <TimecodeField
              row
              label="Duration"
              ariaLabel="Transition duration"
              value={existing.durationInFrames}
              fps={fps}
              min={2}
              step={2}
              framesReadout
              onCommit={(next) => patch({ durationInFrames: Math.max(2, Math.round(next)) })}
              defaultValue={defaultTransitionFrames(junction, fps)}
            />
          ) : (
            <Button variant="primary" className="mt-1 w-full" onClick={add}>
              Add {TRANSITION_KINDS.find((option) => option.value === kind)?.label.toLowerCase() ?? 'transition'}
            </Button>
          )}
          {existing && (
            // The curve the transition travels along — picture and audio cross-fade alike.
            <Field label="Ease">
              <EaseEditor
                label="Transition ease: how it travels across the cut"
                value={existing.ease}
                onChange={(ease) => patch({ ease })}
                gesture={LIVE}
                overshoot={false}
              />
            </Field>
          )}
          {existing && (
            <p className="text-[10px] text-ink-2 tabular-nums">
              Up to {junction.capacityInFrames} frames at this cut
            </p>
          )}
        </div>
      )}
      {/* The engine's own reason, not this component's guess: a 30-frame dissolve that plays as
          8 is invisible on the canvas, so the number has to be contradicted here or nowhere. */}
      {resolved?.clampedBecause && (
        <InlineAlert tone="warning" className="mt-2">
          <span>
            Plays as <span className="tabular-nums">{resolved.durationInFrames}</span> frames, not{' '}
            {existing?.durationInFrames}: {resolved.clampedBecause}.
          </span>
        </InlineAlert>
      )}
      {existing && !resolved && (
        <InlineAlert tone="danger" className="mt-2">
          <span>Stored, but nothing is drawing at this cut.</span>
        </InlineAlert>
      )}
    </Section>
  )
}

/** How many of the selection's cuts carry a transition — the Transition tab's badge. */
export function transitionCount(project: Project, timeline: Timeline, items: readonly Item[]): number {
  return selectedJunctions(project, timeline, items).filter((junction) => junction.transition).length
}
