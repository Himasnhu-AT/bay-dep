import { useState, type ReactNode } from 'react'
import { findAsset, type Item, type Project, type Timeline } from '@shared/project'
import { Field, Section, Select } from '@/components'
import { AudioEffectsSection } from './AudioEffectsSection'

/**
 * The selected clip's own effect chain. One clip at a time: a chain is an ordered list edited by
 * position, and "the third effect" of five clips with five different chains is not one thing. To
 * treat many clips alike, the chain belongs on their track.
 */
export function ClipAudioEffects({
  items,
  project,
  timeline
}: {
  /** The selected clips that can sound. */
  items: readonly Item[]
  project: Project
  timeline: Timeline
}): ReactNode {
  const own = items.filter((item) => findAsset(project, item.assetId)?.kind !== 'html')
  if (own.length === 0) return null
  const item = own[0]!
  const track = timeline.tracks.find((t) => t.id === item.trackId)
  if (own.length > 1 || !track) {
    return (
      <Section title="Effects" collapsible id="audio-effects-clip">
        <p className="text-[11px] text-pretty text-ink-2">
          Select one clip to edit its effects. To give several clips the same effects, put them on the clips’ track
          — Audio page, Track effects.
        </p>
      </Section>
    )
  }
  return (
    <AudioEffectsSection
      key={item.id}
      target={{ itemId: item.id }}
      effects={item.audioEffects}
      title="Effects"
      clips={[{ item, track }]}
      project={project}
    />
  )
}

/**
 * A track's effect chain, with the track chosen here: the mixer strip is too narrow to hold a
 * chain, and a track is not something the timeline selects. It starts on the selected clip's
 * track, so "this clip, and everything else on its track" is one glance down the panel.
 */
export function TrackAudioEffects({
  project,
  timeline,
  preferTrackId
}: {
  project: Project
  timeline: Timeline
  preferTrackId: string | undefined
}): ReactNode {
  const [chosen, setChosen] = useState<string | null>(null)
  const tracks = timeline.tracks
  const track =
    tracks.find((t) => t.id === chosen) ??
    tracks.find((t) => t.id === preferTrackId) ??
    tracks.find((t) => t.kind === 'audio') ??
    tracks[0]
  if (!track) return null
  return (
    <>
      <Section title="Track effects" hint="On everything the track plays, after each clip’s own effects.">
        <Field label="Track">
          <Select<string>
            label="Track whose effects to edit"
            value={track.id}
            options={tracks.map((t) => ({
              value: t.id,
              label: t.audioEffects?.length ? `${t.name} — ${t.audioEffects.length} effect${t.audioEffects.length === 1 ? '' : 's'}` : t.name
            }))}
            onChange={(id) => setChosen(id)}
          />
        </Field>
      </Section>
      <AudioEffectsSection
        key={track.id}
        target={{ trackId: track.id }}
        effects={track.audioEffects}
        title={`Effects on ${track.name}`}
        clips={track.items.map((item) => ({ item, track }))}
        project={project}
      />
    </>
  )
}
