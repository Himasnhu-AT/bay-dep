/**
 * `add_captions` — a caption file, or a list of cues, onto the timeline in one call.
 *
 * Two inputs because they come from two places. An agent that transcribed the audio itself
 * already has frames, and making it format an SRT only for bay to parse it back would be a
 * round trip through a text format for nothing. A person usually has a file. Exactly one is
 * accepted: both at once would need a rule for which wins, and whichever rule was chosen would
 * be the one the caller did not expect.
 *
 * The checks live in `@shared/captions` and run again in the store, so what this file adds is
 * the argument shape — the validator does not look inside objects, so `cues[i]` is checked
 * here, by index, in words an agent can act on.
 */

import { captionStyle, cuesToFrames, parseSubtitles, type CaptionCue } from '@shared/captions'
import { fail, store, timeline, type Handlers } from './helpers'
import { mergeTextStyle } from './textStyle'

function cuesFromArgument(given: unknown[]): CaptionCue[] {
  return given.map((raw, index) => {
    const at = `cues[${index}]`
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      fail(`${at} must be an object of { fromFrame, toFrame, text }.`)
    }
    const cue = raw as Record<string, unknown>
    const unknown = Object.keys(cue).filter((k) => !['fromFrame', 'toFrame', 'text'].includes(k))
    if (unknown.length > 0) {
      fail(`${at} has no field "${unknown[0]}". A cue is { fromFrame, toFrame, text }, in frames.`)
    }
    for (const field of ['fromFrame', 'toFrame'] as const) {
      if (typeof cue[field] !== 'number' || !Number.isInteger(cue[field])) {
        fail(
          `${at}.${field} must be a whole number of frames, but got ${JSON.stringify(cue[field])}. ` +
            `Captions are timed in timeline frames; to pass seconds, send an SRT in "srt" instead.`
        )
      }
    }
    if (typeof cue.text !== 'string') {
      fail(`${at}.text must be a string, but got ${JSON.stringify(cue.text)}.`)
    }
    return {
      fromFrame: cue.fromFrame as number,
      toFrame: cue.toFrame as number,
      text: cue.text.trim(),
      where: at
    }
  })
}

export function addCaptions(args: Record<string, unknown>): Record<string, unknown> {
  const tl = timeline()
  if (args.cues !== undefined && args.srt !== undefined) {
    fail('Pass either "cues" or "srt", not both — there is no sensible way to merge the two.')
  }
  if (args.cues === undefined && args.srt === undefined) {
    fail(
      'Nothing to place: pass "cues" as [{ fromFrame, toFrame, text }], or "srt" as the text of ' +
        'an SRT or WebVTT file (or @./captions.srt to read one).'
    )
  }

  let cues: CaptionCue[]
  let format: 'srt' | 'vtt' | null = null
  let droppedEmpty = 0
  if (args.srt !== undefined) {
    const parsed = parseSubtitles(String(args.srt))
    if (!parsed.ok) fail(parsed.error)
    cues = cuesToFrames(parsed.cues, tl.fps)
    format = parsed.format
    droppedEmpty = parsed.droppedEmpty
  } else {
    cues = cuesFromArgument(args.cues as unknown[])
  }

  const offset = args.offsetFrames === undefined ? 0 : Number(args.offsetFrames)
  if (offset !== 0) {
    cues = cues.map((cue) => ({ ...cue, fromFrame: cue.fromFrame + offset, toFrame: cue.toFrame + offset }))
  }

  const style =
    args.style === undefined ? captionStyle(tl) : mergeTextStyle(captionStyle(tl), args.style)

  const outcome = store().addCaptions(cues, { style })
  if ('error' in outcome) fail(outcome.error)

  const placed = [...cues].sort((a, b) => a.fromFrame - b.fromFrame)
  const first = placed[0]!
  const last = placed[placed.length - 1]!
  return {
    trackId: outcome.trackId,
    trackName: outcome.trackName,
    captions: outcome.itemIds.length,
    // In time order, so the n-th id is the n-th caption on screen.
    itemIds: outcome.itemIds,
    textAssets: outcome.assetIds.length,
    fromFrame: first.fromFrame,
    toFrame: last.toFrame,
    ...(format ? { format } : {}),
    ...(droppedEmpty > 0
      ? { droppedEmptyCues: droppedEmpty, note: `${droppedEmpty} cue(s) had no words and were skipped.` }
      : {}),
    placement:
      `${outcome.trackName} is the topmost video track, so the captions draw over everything. ` +
      `Restyle one with edit_item "text"; reword every copy of a line with edit_asset.`
  }
}

export const handlers: Handlers = {
  add_captions: (args) => addCaptions(args),
}
