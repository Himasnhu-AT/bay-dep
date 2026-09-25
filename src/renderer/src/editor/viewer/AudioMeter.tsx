import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '@/components'
import { cn } from '@/lib/cn'
import { useViewer } from '@/lib/viewer'
import { useEditor } from '@/store/editor'
import { frameLevels } from '../audio/frameLevels'
import { emptyChannel, formatDb, heldPeakText, meterPosition, meterTicks, stepChannel, type ChannelMeter } from './meter'

/** The full width of the transport's meter; the transport narrows it by CSS (`className`). */
const WIDTH = 88
/** A bar's thickness across the meter: thin beside the transport, wider on a mixer strip. */
const BAR = { horizontal: 4, vertical: 6 } as const
const GAP = 2
/** The scale's colour zones, in dBFS: signal to -12, caution to -3, hot above. */
const CAUTION_DB = -12
const HOT_DB = -3
/** How often a strip's printed peak changes: a number that moves every frame cannot be read. */
const READOUT_MS = 250

type Level = { peak: number; rms: number }
const SILENT: Level = { peak: 0, rms: 0 }

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface AudioMeterProps {
  /** Sizes the meter's length: a width when horizontal (default `w-[88px]`), a height when vertical. */
  className?: string
  /** `horizontal` is the transport's thin stereo strip; `vertical` is a mixer channel's meter. */
  orientation?: 'horizontal' | 'vertical'
  /**
   * Meter one track instead of the master: one bar, the track's signal as it leaves the track
   * and before its mute, so a muted track still shows what it would play (`engine/audio.ts`).
   */
  trackId?: string
  /** The accessible name. Defaults to the master's. */
  label?: string
  /** Print the held peak under a vertical meter, in dB, updated four times a second. */
  readout?: boolean
  /** Print a dB scale beside a vertical meter. */
  scale?: boolean
}

/**
 * A level meter: the master's stereo level beside the transport, or — vertical — a mixer strip's
 * meter for the master or one track. An RMS bar, a peak-hold tick and a clip light per meter.
 *
 * It draws on its own canvas from a rAF loop that runs only while playing, and it touches React
 * state only when a clip light changes (and, with `readout`, four times a second) — so a playing
 * timeline costs one small canvas draw per refresh and no re-render. Paused, it draws once, empty
 * (the analysers hold their last window forever, so reading them while paused would freeze a
 * stale level on screen).
 */
export function AudioMeter({
  className,
  orientation = 'horizontal',
  trackId,
  label,
  readout = false,
  scale = false
}: AudioMeterProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playing = useEditor((state) => state.playing)
  const engine = useViewer((state) => state.engine)
  const count = trackId ? 1 : 2
  const channels = useRef<ChannelMeter[]>(Array.from({ length: count }, emptyChannel))
  const [clipped, setClipped] = useState(false)
  // The last peak, for the tooltip, read when the tooltip opens rather than rendered per frame.
  const [peakText, setPeakText] = useState('')
  const [held, setHeld] = useState('−∞')
  const vertical = orientation === 'vertical'
  const bar = BAR[orientation]
  const thickness = bar * count + GAP * (count - 1)
  // The bar colours are read from the theme's tokens when the effect runs; a theme switch while
  // paused would otherwise leave the old theme's near-black bars on a light transport, which
  // read as a full meter. `theme.js` sets `data-theme` on <html>, so that is what is watched.
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme'))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setTheme(root.getAttribute('data-theme')))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    if (channels.current.length !== count) channels.current = Array.from({ length: count }, emptyChannel)
    const dpr = window.devicePixelRatio || 1
    // The length is whatever the layout gave the canvas — 88 px, the compact meter a narrow
    // transport shows, or a mixer strip's height — read on every draw so the bars stay sharp
    // across a container resize.
    let length = 0
    const fit = (): void => {
      const measured = vertical ? canvas.clientHeight : canvas.clientWidth
      const next = Math.max(1, Math.round(measured || WIDTH))
      if (next === length) return
      length = next
      canvas.width = Math.round((vertical ? thickness : length) * dpr)
      canvas.height = Math.round((vertical ? length : thickness) * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const colours = {
      track: token('--color-surface-3', '#333'),
      signal: token('--color-success', '#3c3'),
      caution: token('--color-warning', '#cc3'),
      hot: token('--color-danger', '#c33'),
      tick: token('--color-ink-0', '#fff')
    }
    const ballistics = !prefersReducedMotion()

    /** Fills `from..to` along the meter (0 = silent end) on bar `index`. */
    const span = (index: number, from: number, to: number): void => {
      const across = index * (bar + GAP)
      if (to <= from) return
      if (vertical) ctx.fillRect(across, length - to, bar, to - from)
      else ctx.fillRect(from, across, to - from, bar)
    }

    const draw = (): void => {
      fit()
      const cautionAt = meterPosition(CAUTION_DB) * length
      const hotAt = meterPosition(HOT_DB) * length
      ctx.clearRect(0, 0, vertical ? thickness : length, vertical ? length : thickness)
      channels.current.forEach((channel, index) => {
        ctx.fillStyle = colours.track
        span(index, 0, length)
        const level = meterPosition(channel.rmsDb) * length
        // Three fills, not a gradient: the zones are information, and each reads as one colour.
        ctx.fillStyle = colours.signal
        span(index, 0, Math.min(level, cautionAt))
        ctx.fillStyle = colours.caution
        span(index, cautionAt, Math.min(level, hotAt))
        ctx.fillStyle = colours.hot
        span(index, hotAt, level)
        const peak = meterPosition(channel.peakDb) * length
        if (peak > 0) {
          ctx.fillStyle = channel.peakDb >= HOT_DB ? colours.hot : colours.tick
          const at = Math.min(length - 1, peak)
          span(index, at, at + 1)
        }
      })
    }

    if (!playing || !engine) {
      channels.current = channels.current.map((channel) => ({ ...emptyChannel(), clipped: channel.clipped }))
      draw()
      if (readout) setHeld('−∞')
      return
    }

    // A track strip reads the frame's shared levels: every strip calling `levels()` itself was
    // one walk of every track's analyser per strip per frame.
    const read = (now: number): Level[] => {
      if (trackId) return [frameLevels(engine, now)[trackId] ?? SILENT]
      const levels = engine.masterLevels()
      return [levels?.left ?? SILENT, levels?.right ?? SILENT]
    }

    let frame = 0
    let last = performance.now()
    let lastSample = 0
    let lastReadout = 0
    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick)
      // Reduced motion: a level that updates a few times a second, with no falling bars.
      if (!ballistics && now - lastSample < 250) return
      lastSample = now
      const levels = read(now)
      const dt = now - last
      last = now
      const before = channels.current
      const next = before.map((channel, index) => stepChannel(channel, levels[index] ?? SILENT, now, dt, ballistics))
      channels.current = next
      if (next.some((channel) => channel.clipped) !== before.some((channel) => channel.clipped)) setClipped(true)
      if (readout && now - lastReadout >= READOUT_MS) {
        lastReadout = now
        setHeld(heldPeakText(next))
      }
      draw()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, engine, theme, trackId, count, vertical, bar, thickness, readout])

  const resetClip = (): void => {
    channels.current = channels.current.map((channel) => ({ ...channel, clipped: false }))
    setClipped(false)
  }

  const describe = (): void => {
    const [left, right] = channels.current
    if (!left) return
    setPeakText(right ? `Peak L ${formatDb(left.peakDb)} · R ${formatDb(right.peakDb)}` : `Peak ${formatDb(left.peakDb)}`)
  }

  const name = label ?? (trackId ? 'Track level' : 'Master level, left and right')
  const tipLabel = label ?? (trackId ? 'Track level' : 'Master level')
  const idleDetail = trackId ? 'Shows the track while playing, muted or not' : 'Shows the mix while playing'
  const liveDetail = trackId ? 'RMS with peak hold, before the mute' : 'Left and right, RMS with peak hold'
  const what = trackId ? 'The track' : 'The mix'

  const clipLight = (
    <Tooltip
      side="top"
      label={clipped ? `${what} clipped` : 'No clipping'}
      detail={clipped ? 'Something reached full scale. Click to clear.' : `Lights if ${what.toLowerCase()} reaches full scale`}
    >
      <button
        type="button"
        aria-label={
          clipped
            ? `${what} clipped: clear the clip light`
            : trackId
              ? `Clip light for ${label ?? 'this track'}: no clipping`
              : 'Clip light: no clipping'
        }
        onClick={resetClip}
        className={cn(
          't-press size-2.5 rounded-xs border active:scale-[0.96]',
          clipped ? 'border-danger bg-danger' : 'cursor-default border-line bg-surface-3'
        )}
      />
    </Tooltip>
  )

  const tip = { side: 'top' as const, label: tipLabel, detail: playing ? peakText || liveDetail : idleDetail }

  if (!vertical) {
    return (
      <div className="flex shrink-0 items-center gap-1" onPointerEnter={describe} onFocus={describe}>
        <Tooltip {...tip}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={name}
            tabIndex={0}
            className={cn('rounded-xs', className ?? 'w-[88px]')}
            style={{ height: thickness }}
          />
        </Tooltip>
        {clipLight}
      </div>
    )
  }

  // Vertical, the canvas is sized by a box that takes the strip's remaining height, and measured
  // from it. A canvas left at an auto CSS height takes its height from its own pixel buffer, so
  // each resize to `height × dpr` would grow it again on the next measure.
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5" onPointerEnter={describe} onFocus={describe}>
      {clipLight}
      <div className="flex min-h-0 flex-1 items-stretch gap-1">
        <Tooltip {...tip}>
          <div className={cn('relative min-h-0 rounded-xs', className ?? 'min-h-24')} style={{ width: thickness }}>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={name}
              tabIndex={0}
              className="absolute inset-0 size-full rounded-xs"
            />
          </div>
        </Tooltip>
        {scale && <MeterScale />}
      </div>
      {readout && (
        <span className="font-mono text-[10px] text-ink-1 tabular-nums" aria-label={`Peak ${held} dB`}>
          {held}
        </span>
      )}
    </div>
  )
}

/** The dB marks beside a vertical meter, placed by the same mapping the bars are drawn with. */
function MeterScale(): ReactNode {
  return (
    <div aria-hidden="true" className="relative w-6 font-mono text-[9px] leading-none text-ink-2 tabular-nums">
      {meterTicks().map((tick) => (
        <span
          key={tick.db}
          className="absolute right-0 -translate-y-1/2"
          style={{ top: `${(1 - tick.position) * 100}%` }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  )
}
