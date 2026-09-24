/**
 * The one timecode format bay shows, and the one parser for what a person types.
 *
 * **Why always four fields.** The walkthrough read the status bar's `0:05:00` as five minutes;
 * it was five seconds (`M:SS:FF`). Any three-field form is ambiguous that way, because
 * `MM:SS:FF` and `HH:MM:SS` look identical. SMPTE's `HH:MM:SS:FF` is not: four fields is
 * timecode in every NLE, so `00:00:05:00` cannot be read as anything but five seconds. The
 * hours cost two characters and buy an unambiguous reading, which is the whole job of the
 * display. Where a timecode would be noise (a clip length in a card, a caption), the `units`
 * style spells the unit instead — `5s`, `1m 08s` — which is unambiguous for a different reason.
 *
 * **Fractional rates are non-drop.** A 29.97 timeline counts thirty frame slots per second, as
 * every NLE's non-drop timecode does, so the frames field is always a whole number below
 * `round(fps)` and an hour of wall clock reads `00:59:56:12`. Format and parse use the same slot
 * count, so they are exact inverses at every rate `FRAME_RATES` offers. Typed *units* (`2s`,
 * `1.5m`) are wall-clock time and convert through the real rate — "+2s" is two seconds you can
 * hear, not sixty slots.
 */

export interface TimecodeOptions {
  /**
   * `timecode` (default): `HH:MM:SS:FF`, always four two-digit fields (hours grow past 99).
   * `units`: a short human length — `12f`, `5s`, `5s 12f`, `1m 08s`, `1h 02m` — for places
   * where a frame count is noise, never where someone needs to land on a frame.
   * `clock`: `M:SS`, `H:MM:SS` past an hour — two or three fields, never frames. Only for the
   * ruler's coarse labels, where it sits among its neighbours and cannot be read as timecode.
   */
  style?: 'timecode' | 'units' | 'clock'
}

/** Frame slots per second: the rate rounded, at least 1. A bad rate falls back to 30. */
export function frameSlots(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? Math.max(1, Math.round(fps)) : 30
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatTimecode(frames: number, fps: number, opts: TimecodeOptions = {}): string {
  const slots = frameSlots(fps)
  const total = Number.isFinite(frames) ? Math.max(0, Math.floor(frames)) : 0
  const totalSeconds = Math.floor(total / slots)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const rest = total % slots
  if (opts.style === 'clock') {
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
  }
  if (opts.style === 'units') {
    if (hours > 0) return `${hours}h ${pad(minutes)}m`
    if (minutes > 0) return `${minutes}m ${pad(seconds)}s`
    if (seconds > 0) return rest > 0 ? `${seconds}s ${rest}f` : `${seconds}s`
    return `${rest}f`
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(rest)}`
}

/** What a typed timecode means: a frame to go to, or a signed distance from where you are. */
export type ParsedTimecode = { kind: 'absolute'; frame: number } | { kind: 'relative'; delta: number }

const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 }

/**
 * Reads what someone typed into a timecode field, or null when it is not a time.
 *
 * - `00:01:23:10`, `1:23:10`, `1:23` — colon (or `;`) fields are right-aligned to frames,
 *   as NLE timecode fields read them: `1:23` is one second and 23 frames. A field below the
 *   leading one must be in range (seconds < 60, frames < the slot count); the leading field may
 *   overflow (`90:00` is ninety seconds).
 * - `12`, `4.5` — a bare number is seconds, the unit a person means when they type one.
 * - `2s`, `1.5s`, `2m`, `1h`, `135f`, `1m30s`, `1m 30s 12f` — units, largest first.
 * - A leading `+` or `-` makes any of these a distance from the playhead: `+2s`, `-15f`, `+1:00`.
 */
export function parseTimecode(text: string, fps: number): ParsedTimecode | null {
  const slots = frameSlots(fps)
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30
  let body = text.trim().toLowerCase()
  let sign = 0
  if (body.startsWith('+')) sign = 1
  else if (body.startsWith('-')) sign = -1
  if (sign !== 0) body = body.slice(1).trim()
  if (body === '') return null

  const frames = parseBody(body, slots, rate)
  if (frames === null) return null
  return sign === 0 ? { kind: 'absolute', frame: frames } : { kind: 'relative', delta: sign * frames }
}

function parseBody(body: string, slots: number, rate: number): number | null {
  if (/^\d+(\.\d+)?$/.test(body)) return Math.round(Number(body) * rate)

  if (/^\d+([:;]\d+){1,3}$/.test(body)) {
    const fields = body.split(/[:;]/).map(Number)
    // Right-aligned: the last field is frames, then seconds, minutes, hours.
    const [ff = 0, ss = 0, mm = 0, hh = 0] = [...fields].reverse()
    const leading = fields.length - 1
    // A field below the leading one has a range; the leading one may carry the overflow.
    const limits = [slots, 60, 60]
    for (let i = 0; i < leading; i += 1) {
      const value = [ff, ss, mm][i]!
      if (value >= limits[i]!) return null
    }
    return ((hh * 60 + mm) * 60 + ss) * slots + ff
  }

  // Units, largest first, each at most once: "1h", "1m30s", "1.5s", "2s 12f".
  const unit = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?\s*(?:(\d+(?:\.\d+)?)f)?$/
  const match = unit.exec(body)
  if (!match || !(match[1] || match[2] || match[3] || match[4])) return null
  let seconds = 0
  for (const [index, key] of [[1, 'h'], [2, 'm'], [3, 's']] as const) {
    const value = match[index]
    if (value) seconds += Number(value) * UNIT_SECONDS[key]!
  }
  return Math.round(seconds * rate + (match[4] ? Number(match[4]) : 0))
}

/** Where a parsed entry lands from `current`, clamped to `[0, duration]`. */
export function resolveTimecode(parsed: ParsedTimecode, current: number, duration: number): number {
  const target = parsed.kind === 'absolute' ? parsed.frame : current + parsed.delta
  return Math.max(0, Math.min(Math.max(0, duration), Math.round(target)))
}
