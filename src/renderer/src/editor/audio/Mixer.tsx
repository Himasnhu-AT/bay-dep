import { useMemo, type ReactNode } from 'react'
import { Headphones, VolumeX } from 'lucide-react'
import { dbToGain, formatDb, formatPan, gainToDb, MAX_VOLUME_DB, spokenPan, VOLUME_DB_FLOOR } from '@shared/inspector'
import { Fader, Knob } from '@/components'
import { cn } from '@/lib/cn'
import { selectTimeline, useEditor } from '@/store/editor'
import { useExportSession } from '../export-session'
import { AudioMeter } from '../viewer/AudioMeter'
import { LIVE } from '../liveGesture'
import { mixerChannels, type MixerChannel } from './channels'

export interface MixerProps {
  className?: string
}

/**
 * The Audio page's mixer (Resolve's Fairlight mixer, minus what bay's model does not have): a
 * channel strip per track that can sound — its name, a V/A badge, Mute and Solo from the track,
 * and a live meter of the track's signal — and a Master strip with the mix's stereo meter, a dB
 * scale and the last render's measured loudness.
 *
 * Each strip has a pan knob and a vertical dB fader beside its meter, as a console lays them out:
 * `track.pan` and `track.volume`, applied after each clip's own (the Audio panel beside this sets
 * the selected clip's).
 */
export function Mixer({ className }: MixerProps): ReactNode {
  const project = useEditor((state) => state.project)
  const timeline = useEditor(selectTimeline)
  const channels = useMemo(() => (timeline ? mixerChannels(project, timeline) : []), [project, timeline])
  return (
    <section aria-label="Mixer" className={cn('flex h-full min-h-0 min-w-0 flex-col bg-surface-1', className)}>
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-chrome-raised px-3">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-ink-0 uppercase">Mixer</h2>
        <span className="truncate text-[11px] text-ink-2">
          {channels.length} {channels.length === 1 ? 'track' : 'tracks'} · meters move while playing
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div role="list" aria-label="Track channels" className="flex min-h-0 min-w-0 flex-1 overflow-x-auto">
          {channels.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-pretty text-ink-2">
              Nothing on this timeline makes sound yet. Place a clip with audio, or add an audio track.
            </p>
          ) : (
            channels.map((channel) => <ChannelStrip key={channel.track.id} channel={channel} />)
          )}
        </div>
        <MasterStrip />
      </div>
    </section>
  )
}

function ChannelStrip({ channel }: { channel: MixerChannel }): ReactNode {
  const patchTrack = useEditor((state) => state.patchTrack)
  const { track, badge, audible, state } = channel
  return (
    <div
      role="listitem"
      aria-label={`${track.name}${state ? `, ${state.toLowerCase()}` : ''}`}
      className={cn('flex w-[84px] shrink-0 flex-col items-stretch gap-1.5 border-r border-line px-2 py-2', !audible && 'bg-surface-2/60')}
    >
      <div className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            // The timeline's track colours, so V and A read the same here as on the track headers.
            'shrink-0 rounded-xs px-1 font-mono text-[9px] leading-4 font-semibold text-on-media',
            badge === 'V' ? 'bg-clip-video-edge' : 'bg-clip-audio-edge'
          )}
          title={badge === 'V' ? 'Video track with sound' : 'Audio track'}
        >
          {badge}
        </span>
        <span className="min-w-0 truncate text-[11px] font-medium text-ink-0" title={track.name}>
          {track.name}
        </span>
      </div>
      <TrackPan trackId={track.id} name={track.name} pan={track.pan ?? 0} />
      {/* The meter and the fader side by side, as on a console: the level you set beside the
          level you get. */}
      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-1.5">
        <div className="flex min-h-0 flex-col items-center">
          <AudioMeter orientation="vertical" trackId={track.id} label={`${track.name} level`} readout />
        </div>
        <TrackFader trackId={track.id} name={track.name} volume={track.volume ?? 1} />
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          aria-pressed={track.muted}
          aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
          title={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
          onClick={() => patchTrack(track.id, { muted: !track.muted })}
          className={cn(
            't-press flex h-6 items-center justify-center rounded-xs border text-[10px] font-semibold',
            track.muted ? 'border-danger/60 bg-danger/20 text-danger' : 'border-line bg-surface-2 text-ink-1 hover:text-ink-0'
          )}
        >
          {track.muted ? <VolumeX aria-hidden="true" className="size-3" /> : 'M'}
        </button>
        <button
          type="button"
          aria-pressed={track.solo === true}
          aria-label={track.solo ? `Unsolo ${track.name}` : `Solo ${track.name} — hear only soloed tracks`}
          title={track.solo ? `Unsolo ${track.name}` : `Solo ${track.name}`}
          onClick={() => patchTrack(track.id, { solo: !track.solo })}
          className={cn(
            't-press flex h-6 items-center justify-center rounded-xs border text-[10px] font-semibold',
            track.solo ? 'border-warning/60 bg-warning/20 text-warning' : 'border-line bg-surface-2 text-ink-1 hover:text-ink-0'
          )}
        >
          {track.solo ? <Headphones aria-hidden="true" className="size-3" /> : 'S'}
        </button>
      </div>
      <p className="h-6 text-center text-[9px] leading-tight text-pretty text-ink-2">{state ?? `${channel.soundingClips} ${channel.soundingClips === 1 ? 'clip' : 'clips'}`}</p>
    </div>
  )
}

/**
 * The track's fader: `track.volume`, applied after each clip's own by the one gain function
 * preview and export share (`itemAudioGainAt`). Vertical and in dB with a log taper, unity marked
 * (`Fader`). A drag lands live and is one undo step; double-click puts it back to 0 dB.
 */
function TrackFader({ trackId, name, volume }: { trackId: string; name: string; volume: number }): ReactNode {
  const patchTrack = useEditor((state) => state.patchTrack)
  return (
    <Fader
      label={`${name} volume`}
      value={gainToDb(volume)}
      floorDb={VOLUME_DB_FLOOR}
      maxDb={MAX_VOLUME_DB}
      format={formatDb}
      marks={false}
      className="w-7"
      // Unity is stored as absence, so a mixer left at 0 dB saves unchanged.
      onCommit={(db) => patchTrack(trackId, { volume: dbToGain(db) })}
      gesture={LIVE}
    />
  )
}

/** The track's pan knob: `track.pan`, composed with each clip's pan per channel (`routedPanGains`). */
function TrackPan({ trackId, name, pan }: { trackId: string; name: string; pan: number }): ReactNode {
  const patchTrack = useEditor((state) => state.patchTrack)
  return (
    <div className="flex items-center justify-center">
      <Knob
        label={`${name} pan`}
        value={pan}
        min={-1}
        max={1}
        step={0.01}
        origin={0}
        defaultValue={0}
        format={formatPan}
        valueText={spokenPan}
        onCommit={(next) => patchTrack(trackId, { pan: next })}
        gesture={LIVE}
        size={26}
      />
    </div>
  )
}

/** The mix: a tall stereo meter with its scale, the held peak, and the last measured loudness. */
function MasterStrip(): ReactNode {
  // The newest finished render that was mastered, from this window's render history.
  const loudness = useExportSession((state) => state.history.find((record) => record.progress.loudness)?.progress.loudness ?? null)
  return (
    <div
      aria-label="Master"
      className="flex w-[148px] shrink-0 flex-col gap-1.5 border-l border-line-strong bg-surface-2/40 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-ink-0 uppercase">Master</span>
        <span className="text-[9px] text-ink-2">dBFS</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center">
        <AudioMeter orientation="vertical" readout scale />
      </div>
      <div className="border-t border-line pt-1.5">
        <p className="text-[10px] font-medium text-ink-1">Loudness</p>
        {loudness?.measured ? (
          <p className="text-[10px] leading-snug text-pretty text-ink-2 tabular-nums" title={loudness.summary}>
            Last render {loudness.measured.integratedLufs.toFixed(1).replace('-', '−')} LUFS ·{' '}
            {Number.isFinite(loudness.measured.truePeakDb) ? `${loudness.measured.truePeakDb.toFixed(1).replace('-', '−')} dBTP` : 'silent'}
          </p>
        ) : (
          <p className="text-[10px] leading-snug text-pretty text-ink-2">
            Measured on a render, not live. Set a target in Deliver › Audio.
          </p>
        )}
      </div>
    </div>
  )
}
