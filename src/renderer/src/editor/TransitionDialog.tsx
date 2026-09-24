import { useEffect, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { formatTimecode, type TransitionDirection, type TransitionKind } from '@shared/project'
import { Button, Field, InlineAlert, NumberField, Select, Modal } from '@/components'
import { useEditor } from '@/store/editor'
import { whyNoRoom, type Junction } from '@/lib/junctions'

const KINDS: { value: TransitionKind; label: string }[] = [
  { value: 'cross-dissolve', label: 'Cross dissolve' },
  { value: 'dip-to-black', label: 'Dip to black' },
  { value: 'dip-to-white', label: 'Dip to white' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'push', label: 'Push' },
  { value: 'slide', label: 'Slide' },
  { value: 'iris', label: 'Iris' }
]

/** Kinds that travel, and therefore have somewhere to travel from. */
const DIRECTIONAL = new Set<TransitionKind>(['wipe', 'push', 'slide'])

const DIRECTIONS: { value: TransitionDirection; label: string }[] = [
  { value: 'left', label: 'From left' },
  { value: 'right', label: 'From right' },
  { value: 'up', label: 'From bottom' },
  { value: 'down', label: 'From top' }
]

/**
 * The editor for one cut.
 *
 * It opens on a junction rather than on a transition, because a cut with no transition is the
 * interesting case: it is where someone goes to add one, and it is where they have to be told
 * that this particular cut cannot take one and why. A dialog that only existed once a
 * transition did would leave the refusal with nowhere to live, and the drop would just fail.
 */
export function TransitionDialog({
  junction,
  fps,
  onClose
}: {
  junction: Junction | null
  fps: number
  onClose(): void
}): ReactNode {
  const [kind, setKind] = useState<TransitionKind>('cross-dissolve')
  const [direction, setDirection] = useState<TransitionDirection>('left')
  const [requested, setRequested] = useState(20)

  // Re-seed from the junction each time one opens, so the dialog describes the cut in front
  // of it rather than the last one edited.
  useEffect(() => {
    if (!junction) return
    const existing = junction.transition
    setKind(existing?.kind ?? 'cross-dissolve')
    setDirection(existing?.direction ?? 'left')
    setRequested(existing?.durationInFrames ?? Math.min(20, Math.max(2, junction.capacityInFrames)))
  }, [junction?.key, junction?.transition?.id])

  if (!junction) return null

  const noRoom = whyNoRoom(junction)
  const existing = junction.transition
  const resolved = junction.resolved
  const store = useEditor.getState()

  // What the engine will actually play if this is applied as configured. Computed from the
  // capacity rather than from the field, because the field is a request.
  //
  // Rounded down to even first: a transition spends the same number of frames either side of
  // the cut, so `resolveTransition` floors the half and an odd request loses its last frame
  // before the capacity is even consulted. Comparing the raw request against the capacity
  // would call 21-against-20 a clamp and stay silent about the frame actually dropped.
  const evenRequest = requested - (requested % 2)
  const effective = Math.min(evenRequest, junction.capacityInFrames)
  const willClamp = noRoom === null && effective < evenRequest

  const apply = (): void => {
    store.transact(() => {
      if (existing) {
        // Patched rather than replaced. Remove-then-add would mint a new id for what the user
        // experiences as editing one transition, so an agent holding the id from
        // `add_transition` would find it gone after someone nudged the duration — and the undo
        // stack would show a deletion and a creation for a change of one number.
        store.patchTransition(existing.id, {
          kind,
          durationInFrames: requested,
          // Cleared when the new kind does not travel, or a wipe changed to a dissolve would
          // keep a direction nothing reads and hand it back on the next read.
          direction: DIRECTIONAL.has(kind) ? direction : undefined
        })
      } else {
        store.addTransition({
          fromItemId: junction.from.id,
          toItemId: junction.to.id,
          kind,
          durationInFrames: requested,
          ...(DIRECTIONAL.has(kind) ? { direction } : {})
        })
      }
    })
    onClose()
  }

  const remove = (): void => {
    if (existing) store.transact(() => store.removeTransition(existing.id))
    onClose()
  }

  return (
    <Modal
      open
      width={420}
      title={`Cut at ${formatTimecode(junction.cutFrame, fps, true)}`}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              onClick={remove}
              icon={<Trash2 className="size-3.5" />}
            >
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply} disabled={noRoom !== null}>
            {existing ? 'Update' : 'Add transition'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-3">
        {/* The refusal is the whole reason this dialog opens on cuts without transitions.
            Silently disabling the button would leave someone clicking it and guessing. */}
        {noRoom !== null ? (
          <InlineAlert tone="danger">
            <span>{noRoom}</span>
          </InlineAlert>
        ) : (
          <p className="text-[11px] leading-relaxed text-ink-2">
            This cut can carry up to{' '}
            <span className="text-ink-1 tabular-nums">{junction.capacityInFrames}</span> frames —{' '}
            {junction.fromRoom} spare on the outgoing clip and {junction.toRoom} on the incoming.
          </p>
        )}

        {/* Visible captions: `Select` names itself only to a screen reader, and two unlabelled
            dropdowns stacked in a dialog read as the same control twice. */}
        <div className="space-y-1.5">
          <Field label="Kind">
            <Select<TransitionKind>
              label="Transition kind"
              value={kind}
              options={KINDS}
              onChange={setKind}
              disabled={noRoom !== null}
            />
          </Field>

          {DIRECTIONAL.has(kind) && (
            <Field label="Direction">
              <Select<TransitionDirection>
                label="Transition direction"
                value={direction}
                options={DIRECTIONS}
                onChange={setDirection}
                disabled={noRoom !== null}
              />
            </Field>
          )}

          <NumberField
            row
            label="Duration"
            ariaLabel="Duration in frames"
            value={requested}
            min={2}
            step={2}
            suffix="f"
            onCommit={setRequested}
            disabled={noRoom !== null}
          />
        </div>

        {/* `clampedBecause`, before the fact. A 30-frame dissolve that plays as 8 is
            invisible on the canvas, so the number has to be contradicted here or nowhere. */}
        {willClamp && (
          <InlineAlert tone="warning">
            <span>
              This will play as <span className="tabular-nums">{effective}</span> frames, not{' '}
              <span className="tabular-nums">{requested}</span> — the cut only has{' '}
              {junction.capacityInFrames} to spend. Trim a clip shorter than its source for more.
            </span>
          </InlineAlert>
        )}

        {/* And after the fact, for a transition already stored: the engine's own reason,
            not this component's guess at it. */}
        {resolved?.clampedBecause && (
          <InlineAlert tone="warning">
            <span>
              Currently playing as{' '}
              <span className="tabular-nums">{resolved.durationInFrames}</span> frames rather than
              the {existing?.durationInFrames} asked for, because {resolved.clampedBecause}.
            </span>
          </InlineAlert>
        )}

        {existing && !resolved && (
          <InlineAlert tone="danger">
            <span>Stored, but nothing is drawing at this cut.</span>
          </InlineAlert>
        )}
      </div>
    </Modal>
  )
}
