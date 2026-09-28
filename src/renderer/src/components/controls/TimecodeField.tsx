import type { ReactNode } from 'react'
import { formatTimecode } from '@shared/project'
import { NumberField, type NumberFieldProps } from './NumberField'
import { spokenTimecode, timecodeEntry } from './timecode'

export interface TimecodeFieldProps
  extends Omit<NumberFieldProps, 'format' | 'parse' | 'precision' | 'step' | 'suffix' | 'valueText'> {
  /** The timeline's frame rate: what a second and a timecode's frame field mean. */
  fps: number
  /** Frames per pixel of drag and per arrow press. Default 1; a transition's length steps by 2. */
  step?: number
  /** Print the frame count beside the timecode (`24f`), where a frame at a cut matters. */
  framesReadout?: boolean
}

/**
 * A count of frames shown as `HH:MM:SS:FF` — the one format the transport and the status bar
 * read. Drag the label to scrub by frames (Shift ×10, Cmd/Alt ×0.1 — so a slow fine drag steps one
 * frame per ten pixels), arrows step a frame, double-click the label resets to `defaultValue`.
 *
 * Typing accepts a timecode (`00:00:04:15`, or `4:15` right-aligned), `4.5s`, `135f`, a bare number
 * of seconds, and a signed distance from what the field holds (`+15f`, `-1s`, `+0:10`).
 */
export function TimecodeField({ fps, step = 1, framesReadout = false, value, ...field }: TimecodeFieldProps): ReactNode {
  return (
    <NumberField
      {...field}
      value={value}
      step={step}
      precision={0}
      format={(frames) => formatTimecode(frames, fps, true)}
      parse={(text) => timecodeEntry(text, fps, value)}
      valueText={(frames) => spokenTimecode(frames, fps)}
      suffix={framesReadout && Number.isFinite(value) ? `${Math.round(value)}f` : undefined}
    />
  )
}
