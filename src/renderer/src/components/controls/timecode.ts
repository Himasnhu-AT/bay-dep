import { frameSlots, parseTimecode } from '@shared/timecode'

/**
 * What a typed entry in a timecode field means, as frames: an absolute time (`00:00:04:15`,
 * `4.5s`, `135f`, a bare number of seconds) or — with a leading sign — a distance from the value
 * the field holds now (`+15f`, `-1s`, `+0:10`), as NLE timecode fields read a relative entry. Null
 * when it is not a time. The parser is bay's one (`parseTimecode`), so a field reads exactly what
 * the transport's go-to box reads.
 */
export function timecodeEntry(text: string, fps: number, current: number): number | null {
  const parsed = parseTimecode(text, fps)
  if (!parsed) return null
  return parsed.kind === 'absolute' ? parsed.frame : Math.round(current + parsed.delta)
}

/**
 * A frame count as a screen reader should say it: "1 minute, 4 seconds, 15 frames", "12 frames",
 * "0 frames". Hours and minutes only when there are some; frames always, since they are the unit.
 */
export function spokenTimecode(frames: number, fps: number): string {
  const slots = frameSlots(fps)
  const total = Number.isFinite(frames) ? Math.max(0, Math.floor(frames)) : 0
  const totalSeconds = Math.floor(total / slots)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const rest = total % slots
  const part = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`
  const parts: string[] = []
  if (hours > 0) parts.push(part(hours, 'hour'))
  if (minutes > 0) parts.push(part(minutes, 'minute'))
  if (seconds > 0) parts.push(part(seconds, 'second'))
  if (rest > 0 || parts.length === 0) parts.push(part(rest, 'frame'))
  return parts.join(', ')
}
