import type { ToolSpec } from './spec'

export const order = 165

/**
 * A tool of its own rather than an `edit_item` flag, because it creates an item: an agent needs
 * the new audio item's id back to fade, level, duck or J-cut it, and `edit_item` returns the one
 * item it edited. `action` keeps the three link operations in one place, where their contrast is
 * read together, the way `trim_item` keeps slip, slide and roll.
 */
export const tool: ToolSpec = {
  name: 'detach_audio',
  description:
    'Separate video clips\' sound from their picture ("Detach audio" in any NLE). Each clip\'s ' +
    'sound becomes an item of its own on an audio track — same file, same in-point, same span — ' +
    'and the picture plays no sound. Nothing changes audibly: the audio item takes the clip\'s ' +
    'volume, fades, J/L offsets and duck, and a transition whose two clips are both detached is ' +
    'copied onto the audio track. From then on they are edited apart: a picture fadeOutFrames ' +
    'fades only the picture, and the audio item has its own volume, fades, duck and ' +
    'audioLeadFrames/audioTrailFrames via edit_item. Use it for a picture dip without a sound ' +
    'dip, 4-frame sound fades at every cut, or ducking one clip\'s sound — never duplicate a ' +
    'clip onto a hidden track for its sound, which decodes the file twice.\n' +
    'The two stay LINKED: moving, trimming, slipping, splitting or deleting either acts on both, ' +
    'so they keep sync (edit_item and trim_item take linked: false for one alone). ' +
    'action "unlink" breaks the link and leaves both where they are; "reattach" removes the ' +
    'audio item and gives the picture its sound back. Returns each picture with its audioItemId.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description:
          'Video clips whose sound to detach. For unlink and reattach, either side of a linked pair.'
      },
      action: {
        type: 'string',
        enum: ['detach', 'unlink', 'reattach'],
        description: 'Default "detach".'
      },
      trackId: {
        type: 'string',
        description:
          'detach only: the audio track to put the sound on. Omitted, bay uses the first audio ' +
          'track with room and adds one when none has.'
      }
    },
    required: ['itemIds']
  }
}
