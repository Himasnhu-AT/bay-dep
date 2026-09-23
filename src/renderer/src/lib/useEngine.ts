/**
 * Where the engine meets React and the store. It lives outside `engine/` so that nothing in
 * `engine/` knows either exists: everything there takes its inputs as arguments, which is what
 * makes the clock, the compositor and the audio graph testable without a window — and
 * `src/shared/boundaries.test.ts` holds that line.
 *
 * The wiring is one rule: **the clock is the only thing that says which frame to draw.**
 * An edit, a scrub, a seek and playback all arrive as a frame number from the same place,
 * so there is no second path that can draw a different frame than the playhead claims.
 */

import { useEffect, useRef, type RefObject } from 'react'
import { timelineDuration } from '@shared/project'
import { selectTimeline, useEditor, type EditorStore } from '@/store/editor'
import { AudioEngine, type TrackLevel } from '@/engine/audio'
import { Compositor } from '@/engine/compositor'
import { CompositionPool } from '@/engine/compositionPool'
import { PlaybackClock, type ClockStats } from '@/engine/clock'
import { MediaPool } from '@/engine/mediaPool'
import { renderFrame, awaitSources } from '@/engine/render'
import { FrameExporter } from '@/engine/exporter'
import { brfRuntime } from '@/engine/brfCode'

/**
 * The probe surface, and the flag that gates it.
 *
 * Every performance number this engine has produced came from a harness driving a fake
 * clock, which cannot answer the only question that matters: what reaches the screen when a
 * real decoder feeds a real display. Nothing inside the bundle is reachable from outside it,
 * so measuring the running app needs one handle a debugger can find — the same trade the
 * deleted Rust tree made with `BAY_UI_FRAMETIME=1` (tag `rust-engine-final`).
 *
 * It is **off unless asked for**. A handle that lets arbitrary page script read and mutate
 * the whole project should not exist in a release build merely because the page happens to
 * be local today. `localStorage` is the mechanism because it is the only one available to
 * the renderer alone: an env var or `app.isPackaged` would have to cross the preload bridge
 * and so becomes main's API rather than a debugging detail of this file. It survives the
 * reload a harness needs, and a release user never has the key.
 *
 *     localStorage.setItem('bay.debug', '1')   // then reload
 */
const DEBUG_FLAG = 'bay.debug'

function probeSurfaceEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_FLAG) === '1'
  } catch {
    // Storage can be unavailable (disabled, or a partitioned context). No flag, no handle.
    return false
  }
}
declare global {
  interface Window {
    bayEngine?: {
      engine: EngineHandle
      store: typeof useEditor
      /** The `preview_frame` entry point, so a probe can measure the artefact the agent sees. */
      renderFrame: typeof renderFrame
      /** So a probe can drive a real export and inspect the frames it produces. */
      FrameExporter: typeof FrameExporter
      /** A fresh pool plus the awaited-seek step: the export path's first frame, in isolation. */
      MediaPool: typeof MediaPool
      awaitSources: typeof awaitSources
      /** So a probe can time the draw alone — the grade pass's cost — without the awaits around it. */
      Compositor: typeof Compositor
    }
  }
}

export interface EngineHandle {
  clock: PlaybackClock
  pool: MediaPool
  compositor: Compositor
  audio: AudioEngine
  /** Frame pacing and compositing cost. Poll it; it allocates nothing worth caching. */
  stats(): ClockStats
  /** Per-track audio levels, keyed by track id. Reads the analysers at call time. */
  levels(): Record<string, TrackLevel>
  /** Redraws the current frame on the next animation frame. Coalesced. */
  redraw(): void
}

/**
 * The engine as one object, free of React. The hook below owns its lifetime; nothing else
 * should construct one, because two engines would mean two pools and two sets of elements
 * fighting over the same `currentTime`.
 */
class Engine {
  readonly pool = new MediaPool()
  readonly compositions = new CompositionPool({ live: true })
  readonly compositor = new Compositor(this.pool, this.compositions)
  readonly audio = new AudioEngine(this.pool)
  readonly clock = new PlaybackClock()

  /** Set by the hook so the probe surface can hand out the same object callers get. */
  handle: EngineHandle | null = null

  #getCanvas: () => HTMLCanvasElement | null = () => null
  #offs: Array<() => void> = []
  #pendingDraw: number | null = null
  /** The canvas currently under the resize observer, and the CSS size it last reported. */
  #observed: HTMLCanvasElement | null = null
  #resizeObserver: ResizeObserver | null = null
  #lastClientWidth = 0
  #lastClientHeight = 0

  attach(getCanvas: () => HTMLCanvasElement | null): () => void {
    this.#getCanvas = getCanvas
    const state = useEditor.getState()
    this.#syncTimeline(state)

    this.#offs.push(this.clock.onFrame(this.#onFrame))
    this.#offs.push(
      this.clock.onEnd(() => {
        useEditor.getState().setPlaying(false)
      })
    )
    this.#offs.push(useEditor.subscribe(this.#onStoreChange))

    // A composition file rewritten on disk (by the agent, or by reverting one of its turns)
    // leaves this pool's frames of the old document cached under the same asset id. Drop them
    // for every asset at that path, and draw again.
    let epochs = state.compositionEpochs
    this.#offs.push(
      useEditor.subscribe((next) => {
        if (next.compositionEpochs === epochs) return
        const before = epochs
        epochs = next.compositionEpochs
        const changed = Object.keys(epochs).filter((path) => epochs[path] !== before[path])
        for (const asset of next.project.assets) {
          if (asset.path && changed.includes(asset.path)) this.compositions.release(asset.id)
        }
        this.redraw()
      })
    )

    // Media becoming drawable is the fourth thing that changes the picture, alongside the
    // clock, the store and the canvas size — and it was the missing one. A decode or a
    // seek completing has to ask for a frame, or the draw that found it loading is the
    // last one anybody schedules.
    this.#offs.push(this.pool.onReady(() => this.redraw()))

    // And a composition frame arriving is the fifth. It is the same omission one subsystem
    // along, and it fails harder: a video that is still decoding draws on the next clock tick
    // anyway, but a composition is only fetched *because* a draw asked for it, and the pool
    // answers from cache or not at all. With nothing listening here, the first draw requested
    // the frame, the frame arrived and cached, and no redraw was ever scheduled to show it —
    // so the preview stayed black for as long as the playhead did not move, while
    // `preview_frame` and export both rendered it correctly. They go through `render.ts`,
    // which waits for the pool; the live engine had no equivalent.
    this.#offs.push(this.compositions.onReady(() => this.redraw()))
    this.#offs.push(brfRuntime.onReady(() => this.redraw()))

    // An occluded or minimised window stops `requestAnimationFrame`. The clock then stops
    // producing frames while the media elements play on, so the sound runs away from a
    // frozen picture — measured at 4.5 seconds of drift in six. Pausing is the honest
    // response for an editor: the alternative is playing something nobody can see.
    // Whether playback should instead continue in the background is a product decision,
    // and this is the one place it is made.
    // Only the hidden half is real. Redrawing on the way back looked prudent and is not:
    // a frame requested while hidden is deferred, not dropped, so it draws itself on
    // restore — and `#drawTimed` reads the store fresh, so it draws the current state
    // rather than the state at the time it was queued.
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'hidden') return
      if (this.clock.running) useEditor.getState().setPlaying(false)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    this.#offs.push(() => document.removeEventListener('visibilitychange', onVisibilityChange))

    this.clock.seek(state.playhead)
    this.redraw()
    if (this.handle && probeSurfaceEnabled()) {
      window.bayEngine = { engine: this.handle, store: useEditor, renderFrame, FrameExporter, MediaPool, awaitSources, Compositor }
    }
    return () => this.detach()
  }

  detach(): void {
    delete window.bayEngine
    for (const off of this.#offs) off()
    this.#offs = []
    if (this.#pendingDraw !== null) {
      cancelAnimationFrame(this.#pendingDraw)
      this.#pendingDraw = null
    }
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#observed = null
    this.clock.dispose()
    this.audio.dispose()
    this.compositor.reset()
    this.pool.dispose()
    this.compositions.dispose()
    this.#getCanvas = () => null
  }

  /**
   * Asks for a frame, coalescing repeated calls into one.
   *
   * This once carried a staleness re-arm — cancel and re-request a frame outstanding longer
   * than 250ms — on the theory that a callback queued while the window is hidden can be
   * *dropped*, latching the flag forever and silently killing every later redraw. **It was
   * measured and the theory is wrong.** Across occlusions held 4s, 6s and 15s, a callback
   * armed while `visibilityState === 'hidden'` never fired during occlusion and always
   * fired once the page was verifiably visible again. The queue survives occlusion and
   * drains on restore, so the latch cannot be permanent and nothing could distinguish the
   * guard's presence from its absence. It was deleted rather than kept and tested.
   *
   * The other stranding path is closed here by construction: the flag is cleared *before*
   * `#drawTimed` runs, so a throw inside the draw cannot leave it set.
   */
  redraw(): void {
    if (this.#pendingDraw !== null) return
    this.#pendingDraw = requestAnimationFrame(() => {
      this.#pendingDraw = null
      this.#drawTimed(this.clock.frame)
    })
  }

  // -- internals ------------------------------------------------------------

  readonly #onFrame = (frame: number): void => {
    this.#drawTimed(frame)
    // Only when the clock is the author of the playhead. During a scrub the drag owns it,
    // and writing it back would fight the pointer. `setPlayhead` clamps, so this cannot
    // run past the end.
    if (this.#clockOwnsPlayhead(useEditor.getState())) useEditor.getState().setPlayhead(frame)
  }

  readonly #onStoreChange = (state: EditorStore, previous: EditorStore): void => {
    // The store notifies on every change, including a toast or a selection. Deriving the
    // duration walks every item on every track, so it is gated on the project actually
    // having changed rather than run per keystroke.
    if (state.project !== previous.project) this.#syncTimeline(state)

    if (state.scrubbing !== previous.scrubbing) this.clock.setYielding(state.scrubbing)

    if (state.playing !== previous.playing) {
      this.compositions.setPlaying(state.playing)
      if (state.playing) {
        void this.audio.resume()
        this.clock.seek(state.playhead)
        this.clock.start()
      } else {
        this.clock.stop()
        this.audio.stop()
        // Pause the elements here rather than letting the next draw do it. The next draw
        // is a `requestAnimationFrame`, and the case that matters most is the one where
        // rAF has stopped.
        this.compositor.pauseAll()
        // Repaint in scrub mode so the picture is pinned to where the user stopped.
        this.redraw()
      }
    }

    // While the clock is the author of the playhead, echoing its own writes back into
    // `seek` would re-anchor it every frame. But "running" alone is the wrong test: a
    // scrub that starts *during* playback leaves the clock running and yielding, and the
    // drag is then the author — without this the picture would sit still under the
    // pointer for the whole drag and only catch up on release.
    if (!this.#clockOwnsPlayhead(state) && state.playhead !== previous.playhead) {
      this.clock.seek(state.playhead)
    }

    if (state.project !== previous.project) this.redraw()
  }

  /**
   * Redraws when the canvas's CSS box changes, because the backing store is sized from it.
   * The interface sets only the CSS size; nothing else would tell the engine that the
   * preview now has more pixels to fill, and it would stay at the resolution it was first
   * laid out at. Guarded on the size actually changing so that a layout whose CSS size
   * depends on the backing store cannot drive this in a loop.
   */
  #observe(canvas: HTMLCanvasElement): void {
    if (this.#observed === canvas) return
    this.#resizeObserver?.disconnect()
    this.#lastClientWidth = 0
    this.#lastClientHeight = 0
    this.#resizeObserver = new ResizeObserver(() => {
      const observed = this.#observed
      if (!observed) return
      if (
        observed.clientWidth === this.#lastClientWidth &&
        observed.clientHeight === this.#lastClientHeight
      ) {
        return
      }
      this.#lastClientWidth = observed.clientWidth
      this.#lastClientHeight = observed.clientHeight
      this.redraw()
    })
    this.#resizeObserver.observe(canvas)
    this.#observed = canvas
  }

  #clockOwnsPlayhead(state: EditorStore): boolean {
    return this.clock.running && !state.scrubbing
  }

  #syncTimeline(state: EditorStore): void {
    const timeline = selectTimeline(state)
    this.clock.setFps(timeline?.fps ?? 30)
    this.clock.setDuration(timeline ? timelineDuration(timeline) : 0)
  }

  #drawTimed(frame: number): void {
    const canvas = this.#getCanvas()
    if (!canvas) return
    this.#observe(canvas)
    const state = useEditor.getState()
    const timeline = selectTimeline(state)
    if (!timeline) return

    const projectWidth = Math.max(1, Math.round(timeline.width))
    const projectHeight = Math.max(1, Math.round(timeline.height))
    const { width, height } = previewBacking(canvas, projectWidth, projectHeight)
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Resizing a canvas resets its transform, and the compositor draws in timeline
    // coordinates whatever the backing store is — the same mechanism the exporter uses to
    // composite at delivery size rather than upscaling a preview.
    ctx.setTransform(width / projectWidth, 0, 0, height / projectHeight, 0, 0)

    const playing = this.clock.running && !state.scrubbing
    const started = performance.now()
    this.compositor.drawFrame(ctx, state.project, timeline, frame, {
      mode: playing ? 'playback' : 'scrub'
    })
    this.clock.recordComposite(performance.now() - started)

    // Creating an AudioContext before anything wants sound leaves a suspended context on
    // every launch; once one exists it has to be kept in step even while paused, so that
    // pressing play starts from the right sample.
    if (playing || this.audio.hasContext) {
      this.audio.update({ project: state.project, timeline, frame, playing })
    }

    // Both consumers have now voted for this generation, so anything neither asked for is
    // genuinely idle. Doing this inside the compositor would silence hidden tracks, whose
    // sound is still in the mix — `hidden` is a picture property, `muted` is the sound one.
    this.pool.retireIdle()
  }
}

/**
 * The backing-store size for the preview: the project's resolution, capped at what the
 * canvas can actually show.
 *
 * Compositing more pixels than the project has is invention, and compositing more than the
 * screen displays is waste — a 4K project in an 800px panel would otherwise composite 8.3M
 * pixels every frame to show 0.5M of them. Export is unaffected: it runs its own canvas at
 * the delivery size, which is what keeps a 4K export from being a preview scaled up.
 *
 * The scale is quantised to sixteenths and rounded *up*, so dragging a panel divider
 * reallocates the backing store a handful of times rather than on every pixel, and never
 * lands below the resolution the display is asking for.
 */
function previewBacking(
  canvas: HTMLCanvasElement,
  projectWidth: number,
  projectHeight: number
): { width: number; height: number } {
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  // Before first layout there is no box to size against; the project's own resolution is
  // the honest default, and the resize observer corrects it as soon as there is one.
  if (cssWidth <= 0 || cssHeight <= 0) return { width: projectWidth, height: projectHeight }

  const dpr = window.devicePixelRatio || 1
  const needed = Math.max((cssWidth * dpr) / projectWidth, (cssHeight * dpr) / projectHeight)
  const scale = Math.min(1, Math.ceil(needed * 16) / 16)
  return {
    width: Math.max(1, Math.round(projectWidth * scale)),
    height: Math.max(1, Math.round(projectHeight * scale))
  }
}

/**
 * Wires the engine to a canvas for the life of the component.
 *
 * The canvas is read through the ref on every draw rather than captured once, so a remount
 * that swaps the element is picked up without re-attaching the store subscription.
 */
export function useEngine(canvasRef: RefObject<HTMLCanvasElement | null>): EngineHandle {
  const engineRef = useRef<Engine | null>(null)
  if (engineRef.current === null) engineRef.current = new Engine()
  const engine = engineRef.current

  useEffect(() => engine.attach(() => canvasRef.current), [engine, canvasRef])

  const handleRef = useRef<EngineHandle | null>(null)
  if (handleRef.current === null) {
    handleRef.current = engine.handle = {
      clock: engine.clock,
      pool: engine.pool,
      compositor: engine.compositor,
      audio: engine.audio,
      stats: () => engine.clock.stats(),
      levels: () => engine.audio.levels(),
      redraw: () => engine.redraw()
    }
  }
  return handleRef.current
}
