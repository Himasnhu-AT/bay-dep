import type { ToolSpec } from './spec'
import { frames, itemId } from './fields'

export const order = 160

export const tool: ToolSpec = {
  name: 'edit_item',
  description:
    'Change a placed item: when it starts, how long it runs, which track it sits on, where ' +
    'it sits on the canvas, its opacity, volume, pan, fades, speed, look, colour grade or keyframe animation. Only the fields you pass ' +
    'change. Moving an item onto occupied time on the same track is refused rather than ' +
    'silently overlapping — move the other item first, or use a different track. ' +
    'Returns the item complete after the edit. **That returned state is authoritative: you ' +
    'do not need to call read_project to confirm it.** Re-reading the whole project to check ' +
    'one change is the most expensive thing you can do here — on a 200-clip timeline it is ' +
    '36KB to verify an edit that cost 263 bytes.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      itemId,
      from: frames('New start frame.'),
      durationInFrames: { type: 'integer', minimum: 1, description: 'New length in frames.' },
      sourceStartSeconds: {
        type: 'number',
        minimum: 0,
        description:
          'Which part of the source this clip plays — seconds from the beginning of the ' +
          'file, not a position on the timeline. This is how you use the middle of a clip: ' +
          'set it to 10 and the clip starts ten seconds into the footage while staying ' +
          'exactly where it is on the timeline.\n' +
          'Seconds rather than the model\'s microseconds because six zeros are easy to get ' +
          'wrong and the error is silent — a clip reading from the wrong place still plays.\n' +
          'It is also what gives a clip the room a transition needs: a clip starting at 0 ' +
          'has nothing before its start to dissolve from, and add_transition will say so.'
      },
      trackId: { type: 'string' },
      linked: {
        type: 'boolean',
        description:
          'Default true: a clip linked to others (a picture and its detached sound — see ' +
          'detach_audio) moves, retimes and changes speed with them, so they stay in sync. false ' +
          'changes only this clip and leaves them out of step.'
      },
      left: { type: 'number', description: 'Canvas x in pixels. Negative is valid.' },
      top: { type: 'number', description: 'Canvas y in pixels. Negative is valid.' },
      width: { type: 'number' },
      height: { type: 'number' },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      scale: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description:
          'A zoom about the item\'s centre, drawn like rotation: 1.1 is 10% bigger, 1 unchanged. ' +
          'Enlarges a title\'s type rather than reflowing it, which width/height would do.'
      },
      volume: { type: 'number', minimum: 0, maximum: 2 },
      // No `type`: null must pass (it removes every key), and the validator does not recurse —
      // `mergeKeyframes` checks each key and names the property, index and legal range.
      keyframes: {
        description:
          'Animate properties over the clip: { property: [{ frame, value, ease? }, ...] }. ' +
          'Properties: opacity, left, top, width, height, rotation, scale, volume. A property with ' +
          'keys takes its value from them at every frame (its static field no longer draws); before ' +
          'the first key the first value holds, after the last the last. Fades, transitions and ' +
          'ducking still multiply on top.\n' +
          '- frame is ITEM-RELATIVE: 0 is the clip\'s first frame, durationInFrames its end. For ' +
          'timeline frame T use T - from. Keys move with the clip; trimming its head keeps them on ' +
          'the footage; split_at divides them; speed does not retime them.\n' +
          '- value is in the static field\'s unit (opacity 0..1, volume linear gain 0..2, scale 1 = ' +
          'unchanged, pixels, degrees). Volume keys may give db instead of value: { frame, db: -12 }.\n' +
          '- ease shapes the segment FROM this key to the next: "linear" (default), "hold" (jump at ' +
          'the next key), "in", "out", "inOut" (CSS ease-in/out), or a cubic-bezier [x1, y1, x2, y2].\n' +
          'Each property you name is replaced whole; others are kept. { scale: null } removes that ' +
          'property\'s keys; keyframes: null removes all.\n' +
          'Push in 4% over a 150-frame clip: { scale: [{ frame: 0, value: 1 }, { frame: 150, value: 1.04 }] }. ' +
          'Duck music (from 0, 30fps) to -12 dB over 0:10-0:14 with half-second ramps: { volume: ' +
          '[{ frame: 285, db: 0 }, { frame: 300, db: -12 }, { frame: 420, db: -12 }, { frame: 435, db: 0 }] }.'
      },
      speed: {
        type: 'number',
        description:
          'Playback rate. 1 is source speed. The clip keeps the footage it plays, so its length changes: ' +
          '2 halves durationInFrames, 0.5 doubles it (as in every editor), never past the end of the ' +
          'footage. In place, a longer clip stops at the next clip on its track (or a linked clip\'s) and ' +
          'the result warns how much shorter it is; pass ripple: true to move the later clips on those ' +
          'tracks by the change instead (a shorter clip then pulls them back). Pass durationInFrames too ' +
          'to set the length yourself. The result\'s retimed block reports the lengths and any moves. ' +
          'Keyframes are item-relative and are not rescaled.'
      },
      ripple: {
        type: 'boolean',
        description:
          'With speed: move later clips on this clip\'s track and its linked clips\' tracks by the change ' +
          'in length, so nothing is clamped or left with a gap. Other tracks do not move and are named ' +
          'in a warning if they are now out of step. Default false.'
      },
      fadeInFrames: { type: 'integer', minimum: 0 },
      fadeOutFrames: { type: 'integer', minimum: 0 },
      audioLeadFrames: {
        type: 'integer',
        minimum: 0,
        description:
          'J-cut: start this clip\'s SOUND this many frames before its picture, reading source ' +
          'from before its in-point — the next shot\'s sound arriving under the current one ' +
          '(~0.5 s is typical). Clamped to the footage before the in-point, and ignored where ' +
          'a transition already crosses that cut; the result says when. Fades apply to the ' +
          'sound\'s own edges, so give a lead a few frames of fadeInFrames. 0 removes it.'
      },
      audioTrailFrames: {
        type: 'integer',
        minimum: 0,
        description:
          'L-cut: let this clip\'s SOUND run on this many frames after its picture ends, ' +
          'reading source past its out-point. Same clamps as audioLeadFrames. 0 removes it.'
      },
      pan: {
        type: 'number',
        minimum: -1,
        maximum: 1,
        description:
          'Stereo position of this clip\'s sound: -1 hard left, 0 centre (unchanged), 1 hard right. ' +
          'Constant power with centre at unity: hard left is +3 dB on the left channel and ' +
          'silence on the right, so a mono voice keeps its loudness as it moves. A stereo source ' +
          'pans as a balance (the far side is turned down, not moved across). Static — not keyable. ' +
          'inspect_item reports it when it is not centre. 0 removes it.'
      },
      duck: {
        description:
          'Duck this clip under another track — music under dialogue: { keyTrackId, amountDb ' +
          '(dB down, default 6), attackFrames (ramp down, ending as the key starts; default ' +
          '0.25 s), releaseFrames (ramp up after it ends; default 0.5 s) }. Keyed on the key ' +
          'track\'s clips being present, not on their loudness, so preview and export duck ' +
          'identically; a pause inside a dialogue clip stays ducked. Fields merge with the ' +
          'current duck; null removes it.'
      },
      crop: {
        type: 'object',
        description:
          'Cut edges off this clip\'s source, as fractions from 0 to 1: ' +
          '{ left, top, right, bottom }. 0.1 removes a tenth. Cropping does NOT rescale what ' +
          'is left — the remainder stays exactly where and how big it was on screen, with ' +
          'less of it. Omitted edges keep their current value; pass 0 to restore one. ' +
          'Opposite edges cannot together take the whole source.'
      },
      variables: {
        type: 'object',
        description:
          'For an html item: values for the variables its composition declares, as ' +
          '{ id: value }. Only declared ids are honoured. read_composition lists what a ' +
          'composition declares, and inspect_item reports the values a clip is using. ' +
          'Values live on the clip, so one template placed several times can say something ' +
          'different each time.'
      },
      adjustments: {
        type: 'object',
        description:
          'Image adjustments — a look control, not a colour grade. Fields merge, so ' +
          'setting saturate leaves brightness alone. Defaults are the identity values, so ' +
          'an item with none looks exactly as it does today.',
        properties: {
          brightness: { type: 'number', minimum: 0, description: '1 is unchanged.' },
          contrast: { type: 'number', minimum: 0, description: '1 is unchanged.' },
          saturate: {
            type: 'number',
            minimum: 0,
            description: '1 is unchanged. 0 is greyscale, above 1 is richer.'
          },
          hueRotate: { type: 'number', description: 'Degrees. 0 is unchanged.' },
          blur: { type: 'number', minimum: 0, description: 'Canvas pixels. 0 is off.' },
          grayscale: { type: 'number', minimum: 0, maximum: 1 },
          sepia: { type: 'number', minimum: 0, maximum: 1 },
          invert: { type: 'number', minimum: 0, maximum: 1 }
        }
      },
      // No `type`, like the text effect groups below: `null` must pass (it removes the grade), and
      // the dispatcher's validator does not recurse into objects — `mergeGrade` checks every field
      // and names the legal range in its refusal.
      grade: {
        description:
          'A real colour grade, drawn by the GPU in preview, preview_frame and export alike. Fields ' +
          'merge (setting saturation leaves the wheels alone); null removes the whole grade or any ' +
          'one group. Applied in this order: temperature/tint → lift/gamma/gain → saturation → ' +
          'curves → lut → halation → vignette → grain.\n' +
          '- lift, gamma, gain: colour wheels as RGB offsets { r, g, b }. lift adds to shadows ' +
          '(-1..1, ±0.03 is visible), gamma bends mids (-0.9..4, +0.1 brightens), gain multiplies ' +
          '(-1..4, +0.1 is 10% brighter). Equal r/g/b is a brightness move; unequal is a colour cast.\n' +
          '- temperature: Kelvin shift, -3000..3000; +200 is ~200 K warmer. tint: -1..1, + is magenta.\n' +
          '- saturation: 0..4, 1 unchanged.\n' +
          '- curves: { master, r, g, b }, each 1-16 [input, output] points in 0..1; (0,0) and (1,1) ' +
          'are added if you leave the ends out. Channels apply first, then master (ffmpeg order).\n' +
          '- lut: { assetId, intensity 0..1 } — import a .cube file with import_media first.\n' +
          '- grain: { amount 0..1 (0.1-0.2 is fine 35mm), size 0.5..16 timeline px }. Animated per ' +
          'frame and deterministic, so an export is reproducible.\n' +
          '- halation: { amount 0..1, threshold 0..0.99 (keep ~0.85 so faces never glow), radius ' +
          'timeline px, color hex (default warm #FF8C40) }. Screened in RGB.\n' +
          '- vignette: { amount 0..1 }.\n' +
          'Only for picture clips (video, image, gif, html, brf). inspect_item reports it back.'
      },
      blendMode: {
        type: 'string',
        enum: [
          'normal',
          'multiply',
          'screen',
          'overlay',
          'darken',
          'lighten',
          'color-dodge',
          'color-burn',
          'hard-light',
          'soft-light',
          'difference',
          'exclusion',
          'hue',
          'saturation',
          'color',
          'luminosity'
        ],
        description:
          'How this clip combines with what is under it. Only meaningful on a clip that ' +
          'has something beneath it — on the lowest video track there is nothing to blend ' +
          'with and every mode looks the same. multiply darkens, screen lightens, overlay ' +
          'does both from the underlying tones.'
      },
      text: {
        type: 'object',
        description:
          'Type styling. Only for items whose asset is kind "text"; refused on anything ' +
          'else. Top-level fields merge, so setting color leaves size alone. The three ' +
          'effect groups — stroke, shadow and background — replace wholesale, or pass ' +
          'null to switch one off.',
        properties: {
          fontFamily: {
            type: 'string',
            description: 'A stack installed on this machine. There are no webfonts.'
          },
          fontSize: {
            type: 'number',
            minimum: 1,
            maximum: 2000,
            description:
              'Canvas pixels. What you ask for; bay shrinks it only when the words will ' +
              'not fit even wrapped, and says so when it does.'
          },
          fontWeight: {
            type: 'integer',
            minimum: 100,
            maximum: 900,
            description: 'A multiple of 100.'
          },
          italic: { type: 'boolean' },
          color: { type: 'string', description: 'Hex, such as "#FFFFFF".' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          verticalAlign: { type: 'string', enum: ['top', 'middle', 'bottom'] },
          lineHeight: {
            type: 'number',
            minimum: 0.5,
            maximum: 4,
            description: 'Multiple of fontSize.'
          },
          letterSpacing: { type: 'number', description: 'Canvas pixels.' },
          // The three groups carry a description and deliberately no `type`. The
          // dispatcher's validator understands only the keywords this catalog uses and does
          // not recurse into objects, so the checking happens in the text-style validator
          // instead — where it can say `"text.fontWeight" must be a multiple of 100 between
          // 100 and 900, but got 550` rather than a schema violation on an object the agent
          // cannot see inside. An error an agent cannot act on is the thing this surface
          // exists to avoid.
          stroke: { description: 'An outline: { color, width }. null to remove.' },
          shadow: {
            description: 'A drop shadow: { color, blur, offsetX, offsetY }. null to remove.'
          },
          background: {
            description: 'A plate behind the words: { color, padding, radius }. null to remove.'
          }
        }
      }
    },
    required: ['itemId']
  }
}
