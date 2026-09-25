/**
 * One read of every track's level per frame, shared by every meter that draws in that frame.
 *
 * `levels()` walks every track's analyser and returns all of them, and each mixer strip wanted
 * one — so N strips each reading all N tracks was N² analyser reads a frame, for N answers. Every
 * `requestAnimationFrame` callback in one frame receives the same timestamp, so the timestamp is
 * the frame's identity: the first strip to draw reads, the rest take its answer.
 */

export interface LevelSource<T> {
  levels(): Record<string, T>
}

export function createFrameLevels<T>(): (source: LevelSource<T>, frameTime: number) => Record<string, T> {
  let cached: { source: LevelSource<T>; at: number; levels: Record<string, T> } | null = null
  return (source, frameTime) => {
    if (cached && cached.source === source && cached.at === frameTime) return cached.levels
    const levels = source.levels()
    cached = { source, at: frameTime, levels }
    return levels
  }
}

/** The one the meters share. */
export const frameLevels = createFrameLevels<{ peak: number; rms: number }>()
