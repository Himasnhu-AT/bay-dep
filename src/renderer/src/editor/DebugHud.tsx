import { useEffect, useState, type ReactNode } from 'react'
import type { AppMetrics } from '@shared/ipc'
import { formatFps } from '@shared/project'
import type { ClockStats } from '@/engine/clock'
import { bay } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { selectFps, useEditor } from '@/store/editor'

/**
 * Debug mode's readout over the preview: the player's frame rate, and the app's CPU, memory and
 * the machine's GPU, once a second for as long as debug mode is on.
 *
 * The frame rate is **pictures drawn per second**, not animation ticks — a tick that redraws the
 * same image is not a frame (CLAUDE.md, "Playback is driven by wall-clock time"). It is only
 * meaningful while playing; paused, the HUD says so rather than showing a zero that reads as a
 * stall. CPU is percent of one core, summed over this app's processes, as Activity Monitor shows it
 * (so it can pass 100); the GPU figure is the whole Mac's, because macOS reports no per-app GPU use.
 */
const POLL_MS = 1000

export function DebugHud({ stats }: { stats: () => ClockStats }): ReactNode {
  const playing = useEditor((state) => state.playing)
  const fps = useEditor(selectFps)
  const [clock, setClock] = useState<ClockStats | null>(null)
  const [metrics, setMetrics] = useState<AppMetrics | null>(null)

  useEffect(() => {
    let live = true
    const sample = (): void => {
      setClock(stats())
      void bay()
        ?.app.metrics()
        .then((next) => {
          if (live) setMetrics(next)
        })
        .catch(() => undefined)
    }
    sample()
    const timer = setInterval(sample, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [stats])

  const rate = clock?.picturesPerSecond ?? 0
  const ratio = fps > 0 ? rate / fps : 0
  const tone = !playing ? 'text-ink-2' : ratio >= 0.95 ? 'text-success' : ratio >= 0.75 ? 'text-warning' : 'text-danger'
  const byGroup = (group: string) => metrics?.groups.find((g) => g.group === group)

  return (
    <div
      aria-label="Debug readout"
      className="pointer-events-none absolute top-2 left-2 z-10 rounded-md bg-black/70 px-2.5 py-2 font-mono text-[10.5px] leading-[1.55] text-white/90 tabular-nums shadow-pop backdrop-blur-sm"
    >
      <Row label="player">
        {playing ? (
          <>
            <span className={cn('font-semibold', tone)}>{rate.toFixed(1)}</span>
            <span className="text-white/60"> / {formatFps(fps)} fps</span>
          </>
        ) : (
          <span className="text-white/60">paused · {formatFps(fps)} fps project</span>
        )}
      </Row>
      {clock && (
        <Row label="draw">
          p50 {clock.compositeP50Ms.toFixed(1)} · p99 {clock.compositeP99Ms.toFixed(1)} ms
          {clock.skippedFrames > 0 && <span className="text-warning"> · {clock.skippedFrames} skipped</span>}
        </Row>
      )}
      <Row label="cpu">
        {metrics ? (
          <>
            {metrics.totals.cpu.toFixed(1)}%
            <span className="text-white/55">
              {' '}
              (ui {(byGroup('renderer')?.cpu ?? 0).toFixed(0)} · gpu {(byGroup('gpu')?.cpu ?? 0).toFixed(0)} · main{' '}
              {(byGroup('main')?.cpu ?? 0).toFixed(0)})
            </span>
          </>
        ) : (
          '…'
        )}
      </Row>
      <Row label="mem">{metrics ? `${metrics.totals.memoryMB} MB` : '…'}</Row>
      <Row label="gpu">
        {metrics === null ? '…' : metrics.gpu ? (
          <>
            {metrics.gpu.utilization}%<span className="text-white/55"> whole Mac</span>
          </>
        ) : (
          <span className="text-white/55">not reported</span>
        )}
      </Row>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex gap-2">
      <span className="w-11 shrink-0 text-white/45 uppercase">{label}</span>
      <span>{children}</span>
    </div>
  )
}
