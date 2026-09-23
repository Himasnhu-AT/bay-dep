import type { ToolSpec } from './spec'
import { frames, itemId } from './fields'

export const order = 160

export const tool: ToolSpec = {
  name: 'edit_item',
  description:
    'Change a placed item: when it starts, how long it runs, which track it sits on, where ' +
    'it sits on the canvas, its opacity, volume, fades or speed. Only the fields you pass ' +
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
      left: { type: 'number', description: 'Canvas x in pixels. Negative is valid.' },
      top: { type: 'number', description: 'Canvas y in pixels. Negative is valid.' },
      width: { type: 'number' },
      height: { type: 'number' },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      volume: { type: 'number', minimum: 0, maximum: 2 },
      speed: { type: 'number', description: 'Playback rate. 1 is source speed.' },
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
