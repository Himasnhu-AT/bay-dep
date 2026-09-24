import { formatTimecode } from '@shared/project'
import { parseTime } from '@shared/pins'

/**
 * `format` / `parse` for a `NumberField` that holds a count of frames but shows a timecode —
 * the one format the transport and the status bar read (`HH:MM:SS:FF`, `@shared/timecode`).
 * Typing accepts what the range editor does: a timecode, `4.5s`, `135f`, or bare seconds.
 * Dragging and the arrow keys still move by whole frames.
 */
export function timecodeField(fps: number): {
  format(frames: number): string
  parse(text: string): number | null
  step: number
  precision: number
} {
  return {
    format: (frames) => formatTimecode(frames, fps, true),
    parse: (text) => parseTime(text, fps),
    step: 1,
    precision: 0
  }
}
