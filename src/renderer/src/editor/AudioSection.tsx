import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Item, Project, Timeline } from '@shared/project'
import { resolveAudioOffsets, MAX_DUCK_DB } from '@shared/audio-gain'
import { asSentences, audioNoteForPerson, commonValue, dbToGain, formatDb, formatPan, gainToDb, MAX_VOLUME_DB, spokenPan, VOLUME_DB_FLOOR } from '@shared/inspector'
import { Field, Knob, NumberField, Section, SectionReset, Select, SliderField, Switch, TimecodeField } from '@/components'
import { useEditor } from '@/store/editor'
import { editItems } from './inspectorEdit'
import { Keyed } from './KeyframeControls'
import { LIVE } from './liveGesture'

/**
 * A clip's sound: level in dB (keyable), pan, the J/L cut, and ducking under another track.
 *
 * Level goes through the inspector's own volume path (which keys the playhead when volume is
 * animated); pan, J/L and duck go through `edit_item`'s executor, so they are validated and stored
 * exactly as the agent's calls are, and `inspect_item` reads back what was typed here.
 */
export function AudioSection({
  items,
  project,
  timeline,
  volume,
  onVolume,
  diamond,
  navigation
}: {
  /** The selected clips that can sound (not detached, asset has audio). */
  items: Item[]
  project: Project
  timeline: Timeline
  /** Linear gain at the playhead across the selection. */
  volume: { value: number; mixed: boolean }
  onVolume(gain: number): void
  diamond: ReactNode
  navigation: ReactNode
}): ReactNode {
  const first = items[0]
  if (!first) return null
  const fps = timeline.fps
  const ids = items.map((item) => item.id)

  const pan = commonValue(items.map((item) => (Number.isFinite(item.pan) ? (item.pan as number) : 0)))
  const lead = commonValue(items.map((item) => item.audioLeadFrames ?? 0))
  const trail = commonValue(items.map((item) => item.audioTrailFrames ?? 0))
  const ducked = items.filter((item) => item.duck)
  const duck = commonValue(items.map((item) => item.duck?.keyTrackId ?? ''))
  const amount = commonValue(items.map((item) => item.duck?.amountDb ?? 6))
  const attack = commonValue(items.map((item) => item.duck?.attackFrames ?? Math.round(fps * 0.25)))
  const release = commonValue(items.map((item) => item.duck?.releaseFrames ?? Math.round(fps * 0.5)))

  // A clip cannot duck under its own track; the choices are every other track, sound or not
  // (a dialogue track with nothing on it yet is still the right key to name).
  const ownTracks = new Set(items.map((item) => item.trackId))
  const keyTracks = timeline.tracks.filter((track) => !ownTracks.has(track.id))
  const suggested =
    keyTracks.find((track) => track.kind === 'audio') ?? keyTracks[0]

  const clamped = items.length === 1 ? resolveAudioOffsets(project, timeline, first).clamped : []
  const touched =
    items.some((item) => item.audioLeadFrames || item.audioTrailFrames || item.duck || item.pan) ||
    volume.mixed ||
    volume.value !== 1

  const reset = (): void => {
    // One undo step for the whole reset: nested transactions join this one.
    useEditor.getState().transact(() => {
      onVolume(1)
      editItems(ids, () => ({ pan: 0, audioLeadFrames: 0, audioTrailFrames: 0, duck: null }))
    })
  }

  const db = gainToDb(volume.value)
  return (
    <Section
      id="inspector.audio"
      title="Audio"
      collapsible
      actions={
        <span className="flex items-center gap-0.5">
          {navigation}
          <SectionReset show={touched} label="Reset volume, pan, J/L cut and ducking" onReset={reset} />
        </span>
      }
    >
      <Keyed diamond={diamond}>
        <SliderField
          label="Volume"
          ariaLabel="Volume in decibels"
          min={VOLUME_DB_FLOOR}
          max={Number(MAX_VOLUME_DB.toFixed(2))}
          step={0.5}
          value={Number.isFinite(db) ? Math.max(VOLUME_DB_FLOOR, db) : VOLUME_DB_FLOOR}
          mixed={volume.mixed}
          format={formatDb}
          onCommit={(next) => onVolume(dbToGain(next))}
          defaultValue={0}
          gesture={LIVE}
        />
      </Keyed>
      {/* A knob, as on a mixer's channel strip. Static, not keyed. Double-click to centre. */}
      <Field label="Pan" className="mt-1.5">
        <Knob
          label="Pan, left to right"
          min={-1}
          max={1}
          step={0.01}
          origin={0}
          value={pan.value ?? 0}
          mixed={pan.mixed}
          format={formatPan}
          valueText={spokenPan}
          onCommit={(next) => editItems(ids, () => ({ pan: next }))}
          defaultValue={0}
          gesture={LIVE}
          size={24}
          readout="side"
        />
      </Field>

      <h4
        className="mt-3 mb-1.5 text-[11px] font-medium text-ink-1"
        title="The sound starts before the picture (J) or runs on after it (L), reading footage beyond the clip’s edges."
      >
        J/L cut
      </h4>
      <div className="space-y-1.5">
        <TimecodeField
          row
          label="Sound early"
          ariaLabel="J-cut: sound starts before the picture"
          value={lead.value ?? 0}
          mixed={lead.mixed}
          min={0}
          defaultValue={0}
          fps={fps}
          onCommit={(next) => editItems(ids, () => ({ audioLeadFrames: Math.max(0, Math.round(next)) }))}
        />
        <TimecodeField
          row
          label="Sound late"
          ariaLabel="L-cut: sound runs on after the picture"
          value={trail.value ?? 0}
          mixed={trail.mixed}
          min={0}
          defaultValue={0}
          fps={fps}
          onCommit={(next) => editItems(ids, () => ({ audioTrailFrames: Math.max(0, Math.round(next)) }))}
        />
      </div>
      {clamped.length > 0 ? (
        <div className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-warning">
          <AlertTriangle aria-hidden="true" className="mt-px size-3 shrink-0" />
          {/* One line per limit: two reasons joined with a space read as one run-on sentence. */}
          <ul className="space-y-1">
            {asSentences(clamped.map(audioNoteForPerson)).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <label
          htmlFor={`duck-${first.id}`}
          className="text-[11px] text-ink-1"
          title="Down while the other track has clips with sound; a pause inside a line stays down."
        >
          Duck under another track
        </label>
        <Switch
          id={`duck-${first.id}`}
          checked={ducked.length > 0}
          disabled={ducked.length === 0 && !suggested}
          onChange={(on) =>
            editItems(ids, () =>
              on && suggested ? { duck: { keyTrackId: suggested.id } } : { duck: null }
            )
          }
        />
      </div>
      {ducked.length === 0 && !suggested && (
        <p className="mt-1 text-[10px] text-ink-2">Add another track to duck under.</p>
      )}
      {ducked.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          <Field label="Under">
            <Select<string>
              label="Duck under track"
              value={duck.mixed ? '' : duck.value || ''}
              options={[
                ...(duck.mixed ? [{ value: '', label: 'Mixed', disabled: true }] : []),
                ...keyTracks.map((track) => ({ value: track.id, label: track.name }))
              ]}
              onChange={(id) => id && editItems(ids, () => ({ duck: { keyTrackId: id } }))}
            />
          </Field>
          <NumberField
            row
            label="Amount"
            ariaLabel="Duck amount in dB"
            value={amount.value ?? 6}
            mixed={amount.mixed}
            min={0.5}
            max={MAX_DUCK_DB}
            step={0.5}
            precision={1}
            suffix="dB"
            defaultValue={6}
            onCommit={(next) => editItems(ids, (id) => ({ duck: { keyTrackId: keyOf(items, id, suggested?.id), amountDb: next } }))}
          />
          <TimecodeField
            row
            label="Attack"
            ariaLabel="Duck attack: ramp down before the key starts"
            value={attack.value ?? 0}
            mixed={attack.mixed}
            min={0}
            defaultValue={Math.round(fps * 0.25)}
            fps={fps}
            onCommit={(next) => editItems(ids, (id) => ({ duck: { keyTrackId: keyOf(items, id, suggested?.id), attackFrames: Math.round(next) } }))}
          />
          <TimecodeField
            row
            label="Release"
            ariaLabel="Duck release: ramp back up after the key ends"
            value={release.value ?? 0}
            mixed={release.mixed}
            min={0}
            defaultValue={Math.round(fps * 0.5)}
            fps={fps}
            onCommit={(next) => editItems(ids, (id) => ({ duck: { keyTrackId: keyOf(items, id, suggested?.id), releaseFrames: Math.round(next) } }))}
          />
        </div>
      )}
    </Section>
  )
}

/** The key track a field edit keeps: the clip's own, or — for one not yet ducked — the suggestion. */
function keyOf(items: Item[], itemId: string, fallback: string | undefined): string | undefined {
  return items.find((item) => item.id === itemId)?.duck?.keyTrackId ?? fallback
}
