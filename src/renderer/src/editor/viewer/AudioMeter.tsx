import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '@/components'
import { cn } from '@/lib/cn'
import { useViewer } from '@/lib/viewer'
import { useEditor } from '@/store/editor'
import { emptyChannel, formatDb, meterPosition, stepChannel, type ChannelMeter } from './meter'

/** The full width; the transport narrows it by CSS (`className`) and the draw follows. */
const WIDTH = 88
const BAR = 4
const GAP = 2
const HEIGHT = BAR * 2 + GAP
/** The scale's colour zones, in dBFS: signal to -12, caution to -3, hot above. */
const CAUTION_DB = -12
const HOT_DB = -3

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The master level, stereo, beside the transport: an RMS bar, a peak-hold tick and a clip light
 * per channel.
 *
 * It draws on its own canvas from a rAF loop that runs only while playing, and it touches React
 * state only when a clip light changes — so a playing timeline costs one small canvas draw per
 * refresh and no re-render. Paused, it draws once, empty (the analysers hold their last window
 * forever, so reading them while paused would freeze a stale level on screen).
 */
export function AudioMeter({ className }: { className?: string }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playing = useEditor((state) => state.playing)
  const engine = useViewer((state) => state.engine)
  const channels = useRef<[ChannelMeter, ChannelMeter]>([emptyChannel(), emptyChannel()])
  const [clipped, setClipped] = useState(false)
  // The last peak, for the tooltip, read when the tooltip opens rather than rendered per frame.
  const [peakText, setPeakText] = useState('')
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
    const dpr = window.devicePixelRatio || 1
    // The width is whatever the layout gave the canvas — 88 px, or the compact meter a narrow
    // transport shows — read on every draw so the bars stay sharp across a container resize.
    let width = 0
    const fit = (): void => {
      const next = Math.max(1, Math.round(canvas.clientWidth || WIDTH))
      if (next === width) return
      width = next
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(HEIGHT * dpr)
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

    const draw = (): void => {
      fit()
      const cautionAt = meterPosition(CAUTION_DB) * width
      const hotAt = meterPosition(HOT_DB) * width
      ctx.clearRect(0, 0, width, HEIGHT)
      channels.current.forEach((channel, index) => {
        const y = index * (BAR + GAP)
        ctx.fillStyle = colours.track
        ctx.fillRect(0, y, width, BAR)
        const level = meterPosition(channel.rmsDb) * width
        // Three fills, not a gradient: the zones are information, and each reads as one colour.
        ctx.fillStyle = colours.signal
        ctx.fillRect(0, y, Math.min(level, cautionAt), BAR)
        if (level > cautionAt) {
          ctx.fillStyle = colours.caution
          ctx.fillRect(cautionAt, y, Math.min(level, hotAt) - cautionAt, BAR)
        }
        if (level > hotAt) {
          ctx.fillStyle = colours.hot
          ctx.fillRect(hotAt, y, level - hotAt, BAR)
        }
        const peak = meterPosition(channel.peakDb) * width
        if (peak > 0) {
          ctx.fillStyle = channel.peakDb >= HOT_DB ? colours.hot : colours.tick
          ctx.fillRect(Math.min(width - 1, peak), y, 1, BAR)
        }
      })
    }

    if (!playing || !engine) {
      channels.current = [
        { ...emptyChannel(), clipped: channels.current[0].clipped },
        { ...emptyChannel(), clipped: channels.current[1].clipped }
      ]
      draw()
      return
    }

    let frame = 0
    let last = performance.now()
    let lastSample = 0
    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick)
      // Reduced motion: a level that updates a few times a second, with no falling bars.
      if (!ballistics && now - lastSample < 250) return
      lastSample = now
      const levels = engine.masterLevels()
      const dt = now - last
      last = now
      const [left, right] = channels.current
      const nextLeft = stepChannel(left, levels?.left ?? { peak: 0, rms: 0 }, now, dt, ballistics)
      const nextRight = stepChannel(right, levels?.right ?? { peak: 0, rms: 0 }, now, dt, ballistics)
      channels.current = [nextLeft, nextRight]
      if ((nextLeft.clipped || nextRight.clipped) !== (left.clipped || right.clipped)) setClipped(true)
      draw()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, engine, theme])

  const resetClip = (): void => {
    channels.current = [
      { ...channels.current[0], clipped: false },
      { ...channels.current[1], clipped: false }
    ]
    setClipped(false)
  }

  const describe = (): void => {
    const [left, right] = channels.current
    setPeakText(`Peak L ${formatDb(left.peakDb)} · R ${formatDb(right.peakDb)}`)
  }

  return (
    <div className="flex shrink-0 items-center gap-1" onPointerEnter={describe} onFocus={describe}>
      <Tooltip
        side="top"
        label="Master level"
        detail={playing ? peakText || 'Left and right, RMS with peak hold' : 'Shows the mix while playing'}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Master level, left and right"
          tabIndex={0}
          className={cn('rounded-xs', className ?? 'w-[88px]')}
          style={{ height: HEIGHT }}
        />
      </Tooltip>
      <Tooltip
        side="top"
        label={clipped ? 'The mix clipped' : 'No clipping'}
        detail={clipped ? 'Something reached full scale. Click to clear.' : 'Lights if the mix reaches full scale'}
      >
        <button
          type="button"
          aria-label={clipped ? 'The mix clipped: clear the clip light' : 'Clip light: no clipping'}
          onClick={resetClip}
          className={cn(
            't-press size-2.5 rounded-xs border active:scale-[0.96]',
            clipped ? 'border-danger bg-danger' : 'cursor-default border-line bg-surface-3'
          )}
        />
      </Tooltip>
    </div>
  )
}
