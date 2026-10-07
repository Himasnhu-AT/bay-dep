import {
  AUDIO_EFFECT_CATALOG,
  AUDIO_EFFECT_KINDS,
  AUDIO_EFFECT_PRESETS,
  MAX_AUDIO_EFFECTS,
  describeParams
} from '../audio-effects'
import type { ToolSpec } from './spec'

export const order = 166

/**
 * A tool of its own rather than a field on `edit_item`: a chain is an ordered list whose members
 * are added, edited, moved and removed one at a time by id, on a clip *or* a track, and
 * `edit_item` has neither a track target nor a place to return the ids. The kinds, their
 * parameters and the presets are written into the description from the catalogue itself, so the
 * ranges an agent reads are the ranges the handler enforces.
 */
export const tool: ToolSpec = {
  name: 'audio_effects',
  description:
    'Add, edit, reorder, remove or switch off audio effects on one clip (itemId) or on a whole ' +
    'track (trackId): an equaliser (high-pass, low-pass, shelves, parametric bands), a compressor, ' +
    'a noise gate, a de-esser, a limiter and noise removal — or apply a named preset. Use it to ' +
    'clean up or shape a voice ("remove the hum", "make the dialogue more even", "sound like a ' +
    'phone call"), not to set a level: volume, fades and ducking are edit_item, loudness across ' +
    'clips is level_voices, and the final loudness target is export_timeline.\n' +
    'Effects run in list order, before the clip\'s own volume and fades. Put a track effect on a ' +
    'track to treat every clip on it alike (a whole dialogue track); put a clip effect on one ' +
    'clip that needs something the others do not. Order matters: high-pass and noise removal ' +
    'first, then equaliser, de-esser, compressor, and a limiter last.\n' +
    'Kinds and their params (every value in the unit named):\n' +
    AUDIO_EFFECT_CATALOG.map((spec) => `- ${spec.kind}: ${spec.description} ${describeParams(spec.kind)}.`).join('\n') +
    '\nPresets (action "preset"; they become ordinary effects you can then edit): ' +
    AUDIO_EFFECT_PRESETS.map((p) => `"${p.slug}" — ${p.description}`).join(' ') +
    '\nHow they are rendered: equaliser kinds are live in the preview and written as filters in ' +
    'the export, from one table. compressor, gate, deesser, limiter and denoise are rendered once ' +
    'into a processed copy of the clip\'s sound that preview and export both play — so they sound ' +
    'the same in both, a change takes a moment to be heard in the preview, and on a track they ' +
    'act on each clip of the track before that clip\'s own volume. A composition\'s declared ' +
    'sounds take a track\'s equaliser but no clip effects and no dynamics.\n' +
    `A chain holds up to ${MAX_AUDIO_EFFECTS} effects. Every call returns the whole chain with ` +
    'each effect\'s id; read a chain without changing it with inspect_item or read_project.',
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: { type: 'string', description: 'The clip whose chain to change. Give this or trackId, not both.' },
      trackId: { type: 'string', description: 'The track whose chain to change. Give this or itemId, not both.' },
      action: {
        type: 'string',
        enum: ['add', 'edit', 'remove', 'move', 'preset', 'clear'],
        description:
          'add: a new effect of `kind` (params optional — omitted ones take their defaults), at `index` or last. ' +
          'edit: change `params` and/or `enabled` of `effectId`; params you leave out keep their values. ' +
          'remove: delete `effectId`. move: put `effectId` at `index`. ' +
          'preset: write the preset named by `preset` (mode "replace", the default, or "append"). ' +
          'clear: remove every effect.'
      },
      kind: { type: 'string', enum: [...AUDIO_EFFECT_KINDS], description: 'add only.' },
      params: {
        type: 'object',
        description: 'add and edit: parameter values by name, e.g. { "frequency": 90 } or { "threshold": -20, "ratio": 4 }.'
      },
      enabled: { type: 'boolean', description: 'add and edit: false switches the effect off and keeps its settings.' },
      effectId: { type: 'string', description: 'edit, remove and move: the effect, by the id a previous call returned.' },
      index: { type: 'integer', minimum: 0, description: 'add and move: position in the chain, 0 first.' },
      preset: { type: 'string', enum: AUDIO_EFFECT_PRESETS.map((p) => p.slug), description: 'preset only.' },
      mode: { type: 'string', enum: ['replace', 'append'], description: 'preset only. Default "replace".' }
    },
    required: ['action']
  }
}
