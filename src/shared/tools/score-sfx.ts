import type { ToolSpec } from './spec'
import { DEFAULT_CEILING_DB, DEFAULT_ROOM, SFX_LIMITS, SFX_MATERIAL_NAMES, describeMaterials } from '../sfx/score'

export const order = 101

export const tool: ToolSpec = {
  name: 'score_sfx',
  description:
    'Sound effects for a motion film, synthesised on this Mac from a score: a list of hits, each ' +
    'one of five materials, all sent to one shared room so they sound like one film. Use it when ' +
    'a film or graphic has events that should be heard — a card landing, a cut, a word arriving ' +
    '— and the user has supplied no sound files. Copy `events` from the film composition\'s ' +
    '`window.__film.events()` (each `{ t, material, gain, pan }`, t in SECONDS from the ' +
    'composition\'s start) and set durationSeconds to the film\'s length; do not retype times. ' +
    'Score FEWER events than the film has visual beats: one sound per visual event is a slot ' +
    'machine, so keep the contacts a viewer should feel, one of each run (one key in three), and ' +
    'leave rests. The loudest hit belongs to the biggest moment; vary gain. The palette — there ' +
    'is no other sound: ' +
    describeMaterials() +
    '. pitch (semitones), size (length) and brightness shape a hit; pan follows where the thing ' +
    'is on screen; send is how far away it is. The bus is held under ' +
    `${DEFAULT_CEILING_DB} dBFS so music has room. Returns the audio asset, and with atFrame also ` +
    'places it on an audio track in the same undo step (atFrame is the frame the film\'s clip ' +
    'starts at). It reports the measured peak and loudness and how many hits it rendered, and ' +
    'warns when hits pile up into the limiter or a sound is cut off by the end. Run with ' +
    'validateOnly: true to check a score and hear the same warnings without writing anything. More than ' +
    `${SFX_LIMITS.averagePerSecond} events a second on average, or ${SFX_LIMITS.perSecondWindow} in any one ` +
    'second, is refused.',
  category: 'write',
  readOnly: false,
  selfValidating: true,
  timeoutMs: 120_000,
  inputSchema: {
    type: 'object',
    properties: {
      durationSeconds: {
        type: 'number',
        description: `The film's length in seconds (${SFX_LIMITS.durationSeconds.min}–${SFX_LIMITS.durationSeconds.max}). The sound file is exactly this long unless tail is "ring".`
      },
      events: {
        type: 'array',
        description:
          'The hits. Each: t (seconds from the start, required), material (required: ' +
          SFX_MATERIAL_NAMES.join(', ') +
          '), gain 0–1 (default 0.7; 1 is the loudest one hit gets), pan −1 left to 1 right (default 0), ' +
          'pitch in semitones from the material\'s own pitch, −24 to 24 (default 0; bell 0, 4, 7 at one t is a ' +
          'chord), size 0.25–4 (length and weight, default 1), brightness 0–1 (default 0.5), send 0–1 (share ' +
          'sent to the room; default per material — a knock is close and dry, a whoosh is far and wet).',
        items: { type: 'object' }
      },
      room: {
        type: 'object',
        description:
          `The one room every hit is sent to. decaySeconds ${SFX_LIMITS.decaySeconds.min}–${SFX_LIMITS.decaySeconds.max} ` +
          `(default ${DEFAULT_ROOM.decaySeconds}), preDelayMs 0–${SFX_LIMITS.preDelayMs.max} (default ${DEFAULT_ROOM.preDelayMs}), ` +
          `damping 0–1 (default ${DEFAULT_ROOM.damping}; higher is a softer, darker room), wet 0–1 (default ${DEFAULT_ROOM.wet}; 0 is no room). ` +
          'Omit it for the default room; use the same room for every score in one film.'
      },
      seed: { type: 'integer', minimum: 0, description: 'Seeds the noise. The same score and seed is the same file. Default 1.' },
      ceilingDb: {
        type: 'number',
        description: `The level no sample of the bus passes, in dBFS (${SFX_LIMITS.ceilingDb.min} to ${SFX_LIMITS.ceilingDb.max}). Default ${DEFAULT_CEILING_DB}, which leaves room for music.`
      },
      tail: {
        type: 'string',
        enum: ['fit', 'ring'],
        description:
          '"fit" (default): the file is exactly durationSeconds, and sound still ringing at the end is faded. ' +
          '"ring": the file runs on until the last hit has died away, so it is longer than the film.'
      },
      name: { type: 'string', description: 'Name in the media pool. Default "Sound effects".' },
      atFrame: {
        type: 'integer',
        minimum: 0,
        description: 'Also place the sound on an audio track at this timeline frame — the frame the film starts at. Omit to only create the asset.'
      },
      trackId: { type: 'string', description: 'With atFrame: the audio track to place on. Default: one with room.' }
    },
    required: ['durationSeconds', 'events']
  }
}
