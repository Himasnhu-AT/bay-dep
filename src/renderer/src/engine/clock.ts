/**
 * The playback clock.
 *
 * Two rules, and getting either wrong is a bug that hides well:
 *
 * 1. **The frame comes from the wall clock, never from a counter.** Incrementing a frame
 *    per `requestAnimationFrame` callback ties playback speed to the display: correct on a
 *    60Hz panel, double speed on a 120Hz one, and slow motion the moment a frame is late.
 *    Elapsed real time times the project's fps is the only definition that survives being
 *    moved to another machine.
 * 2. **A tick is not a picture.** A 120Hz display running a 30fps project gets four ticks
 *    per frame, and three of them have nothing new to show. The clock emits only when the
 *    frame index changes, and it reports the two counts separately — a probe that cannot
 *    tell them apart reports a healthy 120/s while the picture updates four times a second.
 *
 * The clock owns no rendering. It says which frame, and times how long the subscriber took.
 */

export interface ClockStats {
  /** rAF callbacks since the last `resetStats`. */
  ticks: number
  /** Frames actually dispatched — i.e. pictures drawn. Always <= ticks while playing. */
  pictures: number
  /** Rates over the last completed one-second window, or 0 before one has completed. */
  ticksPerSecond: number
  picturesPerSecond: number
  /** Milliseconds spent inside the frame subscribers, over a rolling window. */
  compositeP50Ms: number
  compositeP99Ms: number
  /** Frames the clock had to step over because the previous one took too long. */
  skippedFrames: number
  /** How many composite samples the percentiles are drawn from. */
  samples: number
}

export interface ClockOptions {
  /** Injectable for tests; defaults to `performance.now`. */
  now?: () => number
  requestFrame?: (callback: (time: number) => void) => number
  cancelFrame?: (handle: number) => void
  /** How many composite timings the percentiles run over. */
  sampleWindow?: number
}

export type FrameListener = (frame: number) => void

const DEFAULT_SAMPLE_WINDOW = 240
const RATE_WINDOW_MS = 1000

export class PlaybackClock {
  readonly #now: () => number
  readonly #requestFrame: (callback: (time: number) => void) => number
  readonly #cancelFrame: (handle: number) => void

  readonly #frameListeners = new Set<FrameListener>()
  readonly #endListeners = new Set<() => void>()

  #fps = 30
  /** Exclusive end of the timeline, in frames; playback stops here. */
  #duration = 0
  #frame = 0
  #running = false
  #yielding = false
  #handle: number | null = null

  /** Wall clock and frame the current run is measured from; reset on every re-anchor. */
  #anchorTime = 0
  #anchorFrame = 0

  #ticks = 0
  #pictures = 0
  #skipped = 0
  #windowStart = 0
  #windowTicks = 0
  #windowPictures = 0
  #ticksPerSecond = 0
  #picturesPerSecond = 0

  readonly #samples: number[]
  #sampleCount = 0
  #sampleNext = 0

  constructor(options: ClockOptions = {}) {
    this.#now = options.now ?? (() => performance.now())
    this.#requestFrame =
      options.requestFrame ?? ((callback) => requestAnimationFrame(callback))
    this.#cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle))
    this.#samples = new Array<number>(Math.max(1, options.sampleWindow ?? DEFAULT_SAMPLE_WINDOW))
  }

  get frame(): number {
    return this.#frame
  }

  get running(): boolean {
    return this.#running
  }

  /**
   * The timeline length the clock is working to, in frames.
   *
   * Exposed because it is the one value that separates "the engine never heard about the
   * project" from "the engine heard and something else is wrong": it is derived from the
   * store's timeline, so a non-zero duration proves the store reached the engine.
   */
  get duration(): number {
    return this.#duration
  }

  setFps(fps: number): void {
    const next = Number.isFinite(fps) && fps > 0 ? fps : 30
    if (next === this.#fps) return
    this.#fps = next
    // The anchor is expressed in the old rate; keeping it would make the next tick compute
    // an elapsed frame count against a rate that no longer applies.
    this.#reanchor()
  }

  setDuration(frames: number): void {
    this.#duration = Number.isFinite(frames) && frames > 0 ? Math.floor(frames) : 0
  }

  /**
   * While the user is scrubbing, the drag owns the playhead and the clock stands aside. It
   * keeps re-anchoring so that releasing the drag resumes from where the user left it
   * rather than jumping forward by however long the drag lasted.
   */
  setYielding(yielding: boolean): void {
    if (yielding === this.#yielding) return
    this.#yielding = yielding
    if (!yielding) this.#reanchor()
  }

  start(): void {
    if (this.#running) return
    if (this.#duration <= 0) return
    // Starting from the end is a replay, not a no-op that looks like a broken button.
    if (this.#frame >= this.#duration) this.#frame = 0
    this.#running = true
    this.#reanchor()
    this.#windowStart = this.#now()
    this.#windowTicks = 0
    this.#windowPictures = 0
    this.#handle = this.#requestFrame(this.#tick)
  }

  stop(): void {
    if (!this.#running) return
    this.#running = false
    if (this.#handle !== null) {
      this.#cancelFrame(this.#handle)
      this.#handle = null
    }
  }

  /**
   * Moves the playhead without starting or stopping, and draws if the frame changed.
   *
   * The no-change case returns *before* re-anchoring, and that early return is the whole
   * point: while playing, the engine writes each frame back to the store and the store
   * echoes it here. Re-anchoring on every echo would throw away the fraction of a frame
   * already elapsed, so each frame would take a full 1/fps measured from the echo and
   * playback would run slow by however long the round trip takes.
   */
  seek(frame: number): void {
    const next = clampFrame(frame, this.#duration)
    if (next === this.#frame) return
    this.#frame = next
    this.#reanchorAt(next)
    this.#dispatch(next)
  }

  onFrame(listener: FrameListener): () => void {
    this.#frameListeners.add(listener)
    return () => this.#frameListeners.delete(listener)
  }

  /** Fired once when playback reaches the end of the timeline. */
  onEnd(listener: () => void): () => void {
    this.#endListeners.add(listener)
    return () => this.#endListeners.delete(listener)
  }

  /**
   * Records how long a draw took. The clock counts pictures but deliberately does not time
   * its own dispatch: the subscriber does more than composite — it writes the playhead
   * back to the store, which renders React — and folding that into the number would make
   * "compositing cost" mean something else entirely. The caller times the draw and only
   * the draw.
   */
  recordComposite(milliseconds: number): void {
    if (!Number.isFinite(milliseconds)) return
    this.#samples[this.#sampleNext] = milliseconds
    this.#sampleNext = (this.#sampleNext + 1) % this.#samples.length
    if (this.#sampleCount < this.#samples.length) this.#sampleCount += 1
  }

  stats(): ClockStats {
    const sorted = this.#samples.slice(0, this.#sampleCount).sort((a, b) => a - b)
    return {
      ticks: this.#ticks,
      pictures: this.#pictures,
      ticksPerSecond: this.#ticksPerSecond,
      picturesPerSecond: this.#picturesPerSecond,
      compositeP50Ms: percentile(sorted, 0.5),
      compositeP99Ms: percentile(sorted, 0.99),
      skippedFrames: this.#skipped,
      samples: this.#sampleCount
    }
  }

  resetStats(): void {
    this.#ticks = 0
    this.#pictures = 0
    this.#skipped = 0
    this.#sampleCount = 0
    this.#sampleNext = 0
    this.#windowStart = this.#now()
    this.#windowTicks = 0
    this.#windowPictures = 0
    this.#ticksPerSecond = 0
    this.#picturesPerSecond = 0
  }

  dispose(): void {
    this.stop()
    this.#frameListeners.clear()
    this.#endListeners.clear()
  }

  // -- internals ------------------------------------------------------------

  readonly #tick = (): void => {
    if (!this.#running) return
    this.#handle = this.#requestFrame(this.#tick)

    const now = this.#now()
    this.#ticks += 1
    this.#windowTicks += 1
    this.#rollRateWindow(now)

    // Nothing to re-anchor here: `setYielding(false)` does it on release, and that is the
    // only way out of this branch. Re-anchoring per tick as well looks like belt and
    // braces and is unfalsifiable — no test can tell the two apart, because a drag that
    // receives ticks is a drag whose release re-anchors anyway. The case that *does*
    // distinguish them is a drag with no ticks at all (an occluded window stops rAF), and
    // only the release path covers it.
    if (this.#yielding) return

    const elapsedSeconds = (now - this.#anchorTime) / 1000
    const target = this.#anchorFrame + Math.floor(elapsedSeconds * this.#fps)

    if (target >= this.#duration) {
      const end = clampFrame(this.#duration, this.#duration)
      if (end !== this.#frame) {
        this.#frame = end
        this.#dispatch(end)
      }
      this.stop()
      for (const listener of this.#endListeners) listener()
      return
    }

    if (target === this.#frame) return
    if (target > this.#frame + 1) this.#skipped += target - this.#frame - 1
    this.#frame = target
    this.#dispatch(target)
  }

  /** One picture: the frame index changed and the subscribers are being told to draw it. */
  #dispatch(frame: number): void {
    this.#pictures += 1
    this.#windowPictures += 1
    for (const listener of this.#frameListeners) listener(frame)
  }

  #rollRateWindow(now: number): void {
    const elapsed = now - this.#windowStart
    if (elapsed < RATE_WINDOW_MS) return
    const seconds = elapsed / 1000
    this.#ticksPerSecond = this.#windowTicks / seconds
    this.#picturesPerSecond = this.#windowPictures / seconds
    this.#windowStart = now
    this.#windowTicks = 0
    this.#windowPictures = 0
  }

  #reanchor(): void {
    this.#reanchorAt(this.#frame)
  }

  #reanchorAt(frame: number): void {
    this.#anchorTime = this.#now()
    this.#anchorFrame = frame
  }
}

function clampFrame(frame: number, duration: number): number {
  if (!Number.isFinite(frame)) return 0
  const max = Math.max(0, duration)
  return Math.max(0, Math.min(Math.round(frame), max))
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index] ?? 0
}
