/**
 * A sound-effect score: the few hits a short film needs, as data — the contract of `score_sfx`.
 *
 * The method this serves: a film's effects come from a **small palette of materials**, every hit
 * is sent to **one room**, there are **fewer sounds than visual events**, and the bus stops short
 * of full scale so music has somewhere to sit. One synthesised tone per visual event is what
 * that replaces — it reads as a slot machine, and nothing in it shares a space.
 *
 * So the palette is five voices (`SFX_MATERIALS`), an event names one of them with a time, a
 * level and a position, and everything else has a default chosen so a bare
 * `{ t, material, gain, pan }` — the shape a film composition reports from
 * `window.__film.events()` — is already a complete event.
 *
 * Nothing here makes sound: `checkScore` turns an untrusted argument into a score or into
 * sentences saying what to change. `render.ts` renders one.
 */

export const SFX_SAMPLE_RATE = 48_000

export interface SfxMaterialSpec {
  /** What it is for, as the tool description and the refusals say it. */
  use: string
  /** How it is made — one line, for the description. */
  made: string
  /** The pitch `pitch: 0` plays at, in Hz: a centre for noise, a fundamental for the rest. */
  homeHz: number
  /** Seconds the voice lasts at `size: 1`. */
  seconds: number
  /** Share sent to the room when the event names none: near things are dry, air is wet. */
  send: number
}

/**
 * The palette. Five, on purpose: every sound in a film is one of these, which is most of why
 * the sounds of one film belong together.
 */
export const SFX_MATERIALS = {
  whoosh: {
    use: 'something moving through air — a card or screen flying in or out, a camera move; pan it with the picture',
    made: 'noise through a band-pass that glides upward, under a swell',
    homeHz: 320,
    seconds: 0.5,
    send: 0.5
  },
  knock: {
    use: 'a small dry contact — a key, a click, a thing set down; for a run of them score one in three',
    made: 'a short low body with a pitch drop, plus a filtered snap',
    homeHz: 170,
    seconds: 0.22,
    send: 0.18
  },
  bell: {
    use: 'an accent with a pitch — a word landing, a tick, a confirmation; several at once make a chord',
    made: 'inharmonic partials of a struck bar, each with its own decay, plus a strike transient',
    homeHz: 880,
    seconds: 2.2,
    send: 0.4
  },
  thump: {
    use: 'weight — a hard cut, a landing, the one big hit; the loudest thing in the film and the rarest',
    made: 'a sine falling in pitch, saturated, with a soft felt transient',
    homeHz: 46,
    seconds: 0.9,
    send: 0.22
  },
  drop: {
    use: 'a rounded pop — something appearing, a bubble, a soft arrival',
    made: 'a resonance that rises as it closes, like a drop into water',
    homeHz: 520,
    seconds: 0.3,
    send: 0.3
  }
} as const satisfies Record<string, SfxMaterialSpec>

export type SfxMaterial = keyof typeof SFX_MATERIALS

export const SFX_MATERIAL_NAMES = Object.keys(SFX_MATERIALS) as SfxMaterial[]

export function isSfxMaterial(value: unknown): value is SfxMaterial {
  return typeof value === 'string' && Object.hasOwn(SFX_MATERIALS, value)
}

/** One hit, with every default filled in. */
export interface SfxEvent {
  /** Seconds from the start of the score — the film's own clock. */
  t: number
  material: SfxMaterial
  /** 0–1. 1 is the loudest one hit gets: just under the ceiling. */
  gain: number
  /** −1 (left) to 1 (right), constant power. */
  pan: number
  /** Semitones from the material's home pitch, −24 to 24. */
  pitch: number
  /** How long and large: a multiple of the material's own length, 0.25 to 4. */
  size: number
  /** 0 (dark, soft) to 1 (bright, hard). */
  brightness: number
  /** Share sent to the room, 0–1. Further away is wetter. */
  send: number
}

/** The one room every hit is sent to. */
export interface SfxRoom {
  /** Seconds for the room to fall 60 dB at low frequencies. */
  decaySeconds: number
  /** Milliseconds before the room answers. */
  preDelayMs: number
  /** 0 (highs ring as long as lows) to 1 (highs die quickly). */
  damping: number
  /** Level of the room's return, 0 (no room) to 1. */
  wet: number
}

export const DEFAULT_ROOM: SfxRoom = { decaySeconds: 1, preDelayMs: 15, damping: 0.5, wet: 1 }

/**
 * What happens to sound still ringing at `durationSeconds`:
 * - `fit` (default): the file is exactly `durationSeconds` long, and anything still ringing is
 *   faded over its last `FIT_FADE_SECONDS` — a score placed under a film never makes it longer.
 * - `ring`: the file runs on until the last hit and the room have died away.
 */
export type SfxTail = 'fit' | 'ring'

export interface SfxScore {
  durationSeconds: number
  events: SfxEvent[]
  room: SfxRoom
  /** Seeds every noise source. The same score renders the same bytes. */
  seed: number
  /** The bus never passes this, in dBFS. −8 leaves room for music. */
  ceilingDb: number
  tail: SfxTail
}

export const DEFAULT_CEILING_DB = -8
export const FIT_FADE_SECONDS = 0.25

export const SFX_LIMITS = {
  durationSeconds: { min: 0.1, max: 120 },
  /** Mean events a second over the whole score. */
  averagePerSecond: 3,
  /** Events starting inside any one second. */
  perSecondWindow: 8,
  /** Two hits of one material at one pitch closer than this mask each other. */
  nearSeconds: 0.04,
  gain: { min: 0, max: 1 },
  pan: { min: -1, max: 1 },
  pitch: { min: -24, max: 24 },
  size: { min: 0.25, max: 4 },
  brightness: { min: 0, max: 1 },
  send: { min: 0, max: 1 },
  decaySeconds: { min: 0.2, max: 3 },
  preDelayMs: { min: 0, max: 60 },
  damping: { min: 0, max: 1 },
  wet: { min: 0, max: 1 },
  ceilingDb: { min: -24, max: -1 },
  seed: { min: 0, max: 0xffff_ffff }
} as const

const EVENT_KEYS = ['t', 'material', 'gain', 'pan', 'pitch', 'size', 'brightness', 'send'] as const
const ROOM_KEYS = ['decaySeconds', 'preDelayMs', 'damping', 'wet'] as const
const SCORE_KEYS = ['durationSeconds', 'events', 'room', 'seed', 'ceilingDb', 'tail'] as const

export type ScoreCheck =
  | { ok: true; score: SfxScore; warnings: string[] }
  | { ok: false; errors: string[] }

/** Refusals past this many are counted, not listed: an agent fixes a few at a time. */
const MAX_ERRORS = 6

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function show(value: unknown): string {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return `"${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value === 'object' ? 'an object' : String(value)
}

/** The palette as one line: `whoosh (…), knock (…)`. Refusals and the tool description use it. */
export function describeMaterials(): string {
  return SFX_MATERIAL_NAMES.map((name) => `${name} (${SFX_MATERIALS[name].use})`).join('; ')
}

/**
 * A number in a range, or the sentence saying what was wrong with it. Absent takes the default.
 * Non-finite is its own refusal: "NaN must be at most 1" tells nobody that an expression in the
 * film divided by zero.
 */
function numberIn(
  value: unknown,
  what: string,
  range: { min: number; max: number },
  fallback: number | null,
  unit: string,
  errors: string[]
): number {
  if (value === undefined || value === null) {
    if (fallback !== null) return fallback
    errors.push(`${what} is missing. Give a number from ${range.min} to ${range.max}${unit}.`)
    return range.min
  }
  if (typeof value !== 'number') {
    errors.push(`${what} must be a number from ${range.min} to ${range.max}${unit}, but is ${show(value)}.`)
    return fallback ?? range.min
  }
  if (!Number.isFinite(value)) {
    errors.push(
      `${what} is ${value}, which is not a finite number. It is usually a division by zero or a ` +
        `missing value where the score was computed; give a number from ${range.min} to ${range.max}${unit}.`
    )
    return fallback ?? range.min
  }
  if (value < range.min || value > range.max) {
    errors.push(`${what} is ${value}, outside ${range.min} to ${range.max}${unit}. Change it to a value in that range.`)
    return fallback ?? range.min
  }
  return value
}

/**
 * The densest second and the mean rate, measured the way the limits are stated.
 * `windowCount` is the most events starting inside any `[t, t + 1)`.
 */
export function scoreDensity(times: readonly number[], durationSeconds: number): {
  perSecond: number
  windowCount: number
  windowFrom: number
} {
  const sorted = [...times].sort((a, b) => a - b)
  let windowCount = 0
  let windowFrom = 0
  let tail = 0
  for (let head = 0; head < sorted.length; head += 1) {
    while (sorted[head]! - sorted[tail]! >= 1) tail += 1
    const count = head - tail + 1
    if (count > windowCount) {
      windowCount = count
      windowFrom = sorted[tail]!
    }
  }
  return { perSecond: durationSeconds > 0 ? sorted.length / durationSeconds : 0, windowCount, windowFrom }
}

const round = (value: number, places = 2): number => Number(value.toFixed(places))

/**
 * An argument as a score with every default filled, or the sentences saying what to change.
 * Each refusal names the thing, its value and the fix; warnings are things that render but are
 * probably not what was meant.
 */
export function checkScore(input: unknown): ScoreCheck {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        `The score must be an object: { durationSeconds, events: [{ t, material, gain, pan }] }, but is ${show(input)}.`
      ]
    }
  }
  const errors: string[] = []
  const warnings: string[] = []

  for (const key of Object.keys(input)) {
    if (!(SCORE_KEYS as readonly string[]).includes(key)) {
      errors.push(`The score has no field "${key}". It takes ${SCORE_KEYS.join(', ')}.`)
    }
  }

  const beforeDuration = errors.length
  const durationSeconds = numberIn(
    input['durationSeconds'],
    'durationSeconds',
    SFX_LIMITS.durationSeconds,
    null,
    ' seconds (the length of the film)',
    errors
  )
  const durationKnown = errors.length === beforeDuration

  const seed = numberIn(input['seed'], 'seed', SFX_LIMITS.seed, 1, '', errors)
  if (Number.isFinite(seed) && !Number.isInteger(seed)) {
    errors.push(`seed is ${seed}; it must be a whole number. Round it.`)
  }
  const ceilingDb = numberIn(input['ceilingDb'], 'ceilingDb', SFX_LIMITS.ceilingDb, DEFAULT_CEILING_DB, ' dBFS', errors)

  let tail: SfxTail = 'fit'
  if (input['tail'] !== undefined) {
    if (input['tail'] === 'fit' || input['tail'] === 'ring') tail = input['tail']
    else {
      errors.push(
        `tail is ${show(input['tail'])}. Use "fit" (the file is exactly durationSeconds; sound still ringing is ` +
          `faded) or "ring" (the file runs on until the last hit has died away).`
      )
    }
  }

  const room: SfxRoom = { ...DEFAULT_ROOM }
  if (input['room'] !== undefined) {
    const raw = input['room']
    if (!isRecord(raw)) {
      errors.push(`room must be an object of ${ROOM_KEYS.join(', ')}, but is ${show(raw)}. Omit it for the default room.`)
    } else {
      for (const key of Object.keys(raw)) {
        if (!(ROOM_KEYS as readonly string[]).includes(key)) {
          errors.push(`room has no field "${key}". It takes ${ROOM_KEYS.join(', ')}.`)
        }
      }
      room.decaySeconds = numberIn(raw['decaySeconds'], 'room.decaySeconds', SFX_LIMITS.decaySeconds, DEFAULT_ROOM.decaySeconds, ' seconds', errors)
      room.preDelayMs = numberIn(raw['preDelayMs'], 'room.preDelayMs', SFX_LIMITS.preDelayMs, DEFAULT_ROOM.preDelayMs, ' ms', errors)
      room.damping = numberIn(raw['damping'], 'room.damping', SFX_LIMITS.damping, DEFAULT_ROOM.damping, '', errors)
      room.wet = numberIn(raw['wet'], 'room.wet', SFX_LIMITS.wet, DEFAULT_ROOM.wet, '', errors)
    }
  }

  const events: SfxEvent[] = []
  const rawEvents = input['events']
  if (!Array.isArray(rawEvents)) {
    errors.push(
      `events must be an array of { t, material, gain, pan }, but is ${rawEvents === undefined ? 'missing' : show(rawEvents)}. ` +
        `Copy it from the film's window.__film.events().`
    )
  } else if (rawEvents.length === 0) {
    errors.push(
      `events is empty, so there is nothing to render. Give the film's hits: [{ t, material }], with material one of ` +
        `${SFX_MATERIAL_NAMES.join(', ')}.`
    )
  } else {
    const unread = new Map<string, number[]>()
    rawEvents.forEach((raw: unknown, index) => {
      const name = `events[${index}]`
      if (!isRecord(raw)) {
        errors.push(`${name} must be an object { t, material, gain, pan }, but is ${show(raw)}.`)
        return
      }
      for (const key of Object.keys(raw)) {
        if (!(EVENT_KEYS as readonly string[]).includes(key)) unread.set(key, [...(unread.get(key) ?? []), index])
      }
      const before = errors.length
      const material = raw['material']
      if (!isSfxMaterial(material)) {
        errors.push(
          `${name}.material is ${material === undefined ? 'missing' : show(material)}. The palette is ` +
            `${SFX_MATERIAL_NAMES.join(', ')} — ${describeMaterials()}. Use the nearest one; there is no other sound.`
        )
      }
      const beforeTime = errors.length
      const t = numberIn(raw['t'], `${name}.t`, { min: 0, max: SFX_LIMITS.durationSeconds.max }, null, ' seconds', errors)
      if (durationKnown && errors.length === beforeTime && t >= durationSeconds) {
        errors.push(
          `${name}.t is ${t} s, at or past the end of the score (durationSeconds ${durationSeconds}). Times are seconds ` +
            `from the film's start: move the event before ${durationSeconds}, or lengthen durationSeconds if the film is longer.`
        )
      }
      const spec = isSfxMaterial(material) ? SFX_MATERIALS[material] : SFX_MATERIALS.knock
      const event: SfxEvent = {
        t,
        material: isSfxMaterial(material) ? material : 'knock',
        gain: numberIn(raw['gain'], `${name}.gain`, SFX_LIMITS.gain, 0.7, ' (1 is the loudest one hit gets)', errors),
        pan: numberIn(raw['pan'], `${name}.pan`, SFX_LIMITS.pan, 0, ' (−1 left, 1 right)', errors),
        pitch: numberIn(raw['pitch'], `${name}.pitch`, SFX_LIMITS.pitch, 0, ' semitones from the material’s own pitch', errors),
        size: numberIn(raw['size'], `${name}.size`, SFX_LIMITS.size, 1, ' (a multiple of the material’s own length)', errors),
        brightness: numberIn(raw['brightness'], `${name}.brightness`, SFX_LIMITS.brightness, 0.5, '', errors),
        send: numberIn(raw['send'], `${name}.send`, SFX_LIMITS.send, spec.send, ' (the share sent to the room)', errors)
      }
      if (errors.length === before) events.push(event)
    })
    for (const [key, at] of unread) {
      warnings.push(
        `"${key}" on ${at.length === 1 ? `events[${at[0]}]` : `${at.length} events`} is not read. An event takes ` +
          `${EVENT_KEYS.join(', ')}.`
      )
    }
  }

  if (errors.length === 0) {
    const density = scoreDensity(events.map((event) => event.t), durationSeconds)
    // A short score may still hold one chord and a hit; the mean only means something over time.
    const allowed = Math.max(SFX_LIMITS.perSecondWindow, Math.floor(SFX_LIMITS.averagePerSecond * durationSeconds))
    if (events.length > allowed) {
      errors.push(
        `The score has ${round(density.perSecond)} events a second (${events.length} in ${durationSeconds} s). The palette ` +
          `is for the few moments a viewer should feel, not one sound per visual event: keep it to ` +
          `${SFX_LIMITS.averagePerSecond} a second on average (${allowed} here). Keep one of each run — one key in ` +
          `three, one tick per word — and let the rest pass in silence.`
      )
    } else if (density.windowCount > SFX_LIMITS.perSecondWindow) {
      errors.push(
        `${density.windowCount} events start in the second from ${round(density.windowFrom)} s. More than ` +
          `${SFX_LIMITS.perSecondWindow} in a second is a blur, not ${density.windowCount} sounds: keep the ones that ` +
          `mark a contact and drop the rest, or spread them out.`
      )
    }

    const order = events.map((event, index) => ({ event, index })).sort((a, b) => a.event.t - b.event.t)
    for (let i = 1; i < order.length; i += 1) {
      const a = order[i - 1]!
      const b = order[i]!
      if (
        a.event.material === b.event.material &&
        a.event.pitch === b.event.pitch &&
        b.event.t - a.event.t < SFX_LIMITS.nearSeconds
      ) {
        warnings.push(
          `events[${a.index}] and events[${b.index}] are the same ${a.event.material} ${round((b.event.t - a.event.t) * 1000)} ms ` +
            `apart, so they are heard as one louder hit. Keep one.`
        )
      }
    }
  }

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_ERRORS)
    if (errors.length > MAX_ERRORS) shown.push(`…and ${errors.length - MAX_ERRORS} more of the same kind.`)
    return { ok: false, errors: shown }
  }
  return { ok: true, score: { durationSeconds, events, room, seed, ceilingDb, tail }, warnings }
}
