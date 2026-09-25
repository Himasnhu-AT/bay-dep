import { useMemo, type ReactNode } from 'react'
import { AudioLines } from 'lucide-react'
import { findAsset, type Item, type Project, type Timeline } from '@shared/project'
import { animatedVolumeAt } from '@shared/keyframes'
import { canSound, commonValue } from '@shared/inspector'
import { EmptyState, ScrollArea, Section } from '@/components'
import { cn } from '@/lib/cn'
import { useSelectedItems } from '@/lib/useSelectedItems'
import { selectTimeline, useEditor } from '@/store/editor'
import { AudioSection } from '../AudioSection'
import { KeyDiamond, KeyNavigation, relativeFrame } from '../KeyframeControls'

export interface AudioPanelProps {
  className?: string
}

/**
 * The Audio page's right side: the selected clip's sound (the inspector's `AudioSection` — level,
 * pan, J/L cut, ducking), and a summary of the ducking and J/L cuts across the whole timeline, so
 * the mix's automatic moves are visible without selecting each clip.
 */
export function AudioPanel({ className }: AudioPanelProps): ReactNode {
  const selected = useSelectedItems()
  const project = useEditor((state) => state.project)
  const timeline = useEditor(selectTimeline)
  const soundItems = selected.filter((item) => canSound(findAsset(project, item.assetId), item))
  const single = soundItems.length === 1 ? soundItems[0] : undefined
  // The playhead only when one animated clip is selected, as in the inspector: every other state
  // shows stored values, and subscribing to the playhead for those re-renders at the frame rate.
  const keyedPlayhead = useEditor((state) => (single?.keyframes?.volume ? state.playhead : -1))

  return (
    <section aria-label="Audio" className={cn('flex h-full min-h-0 min-w-0 flex-col bg-surface-1', className)}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-chrome-raised px-3">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-ink-0 uppercase">Audio</h2>
        <span className="min-w-0 truncate text-[11px] text-ink-2">
          {single ? (findAsset(project, single.assetId)?.name ?? '') : soundItems.length > 1 ? `${soundItems.length} clips` : ''}
        </span>
      </header>
      <ScrollArea className="flex-1">
        {!timeline ? null : soundItems.length === 0 ? (
          <EmptyState
            icon={<AudioLines className="size-6" />}
            title={selected.some((item) => item.audioDetached) ? 'Sound detached' : 'Select a clip with sound'}
            hint={
              selected.some((item) => item.audioDetached)
                ? 'Its level, J/L cut and ducking are on the linked audio clip. Select that one.'
                : 'Its level, pan, J/L cut and ducking appear here. Mute and solo a whole track in the mixer.'
            }
            className="h-auto py-6"
          />
        ) : (
          <AudioSection
            items={soundItems}
            project={project}
            timeline={timeline}
            volume={volumeOf(soundItems, keyedPlayhead)}
            onVolume={(gain) => setVolume(soundItems, gain)}
            diamond={single ? <KeyDiamond item={single} property="volume" playhead={keyedPlayhead} /> : null}
            navigation={
              single?.keyframes?.volume ? <KeyNavigation item={single} properties={['volume']} playhead={keyedPlayhead} /> : null
            }
          />
        )}
        {timeline && <MixSummary project={project} timeline={timeline} />}
      </ScrollArea>
    </section>
  )
}

/** The level the selection plays at the playhead: keyed values when animated, else as stored. */
function volumeOf(items: Item[], keyedPlayhead: number): { value: number; mixed: boolean } {
  const values = items.map((item) =>
    item.keyframes?.volume && keyedPlayhead >= 0 ? animatedVolumeAt(item, keyedPlayhead) : item.volume
  )
  const common = commonValue(values)
  return { value: common.value ?? 1, mixed: common.mixed }
}

/**
 * Writes a level the way the inspector does: onto the key at the playhead when the clip's volume
 * is animated (its stored field draws nowhere then), else onto the clip. One undo step.
 */
function setVolume(items: Item[], gain: number): void {
  const store = useEditor.getState()
  store.transact(() => {
    for (const item of items) {
      if (item.keyframes?.volume?.length) {
        const frame = relativeFrame(item, useEditor.getState().playhead)
        if (frame === null) {
          store.notify('Move the playhead over the clip to change its animated volume: its keys set it everywhere.')
          continue
        }
        store.setKeyframe(item.id, 'volume', frame, gain)
        continue
      }
      store.patchItem(item.id, { volume: gain })
    }
  })
}

/** Every duck and J/L cut on the timeline, in a sentence each. */
function MixSummary({ project, timeline }: { project: Project; timeline: Timeline }): ReactNode {
  const lines = useMemo(() => {
    const trackName = (id: string): string => timeline.tracks.find((track) => track.id === id)?.name ?? 'a deleted track'
    const ducks = new Map<string, { count: number; tracks: Set<string>; amountDb: number }>()
    let leads = 0
    let trails = 0
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        if (!canSound(findAsset(project, item.assetId), item)) continue
        if ((item.audioLeadFrames ?? 0) > 0) leads += 1
        if ((item.audioTrailFrames ?? 0) > 0) trails += 1
        if (!item.duck) continue
        const entry = ducks.get(item.duck.keyTrackId) ?? { count: 0, tracks: new Set<string>(), amountDb: item.duck.amountDb ?? 6 }
        entry.count += 1
        entry.tracks.add(track.name)
        ducks.set(item.duck.keyTrackId, entry)
      }
    }
    const out: string[] = []
    for (const [key, entry] of ducks) {
      out.push(
        `${entry.count} ${entry.count === 1 ? 'clip' : 'clips'} on ${[...entry.tracks].join(', ')} ${entry.count === 1 ? 'ducks' : 'duck'} under ${trackName(key)} by ${entry.amountDb} dB.`
      )
    }
    if (leads > 0) out.push(`${leads} J-${leads === 1 ? 'cut' : 'cuts'}: sound starts before the picture.`)
    if (trails > 0) out.push(`${trails} L-${trails === 1 ? 'cut' : 'cuts'}: sound runs on after the picture.`)
    return out
  }, [project, timeline])

  return (
    <Section title="In this mix">
      {lines.length === 0 ? (
        <p className="text-[11px] text-pretty text-ink-2">No ducking or J/L cuts yet. Set them per clip above.</p>
      ) : (
        <ul className="space-y-1">
          {lines.map((line) => (
            <li key={line} className="text-[11px] text-pretty text-ink-1">
              {line}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
