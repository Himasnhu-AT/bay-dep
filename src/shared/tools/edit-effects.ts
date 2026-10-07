import { describeCatalog, EFFECT_ITEM_KINDS, EFFECT_KINDS, MAX_EFFECTS } from '../effects/index'
import { EFFECT_OPS } from '../effects/edit'
import type { ToolSpec } from './spec'

export const order = 162

export const tool: ToolSpec = {
  name: 'edit_effects',
  description:
    'Add, change, reorder, switch off or remove video effects on one clip. A clip carries an ordered ' +
    'stack of effects, each a shader pass with its own parameters, drawn after the clip\'s grade and ' +
    'before its mask, first in the list first — so order changes the picture (chroma-key then glow ' +
    'glows the keyed subject; glow then chroma-key keys a glowing frame). Reach for this for a look a ' +
    'grade or adjustments cannot make: a green-screen key, a motion or zoom blur, glow, glitch, RGB ' +
    'split, pixelate, duotone, a flip. Do NOT use it for what another field already does: an even ' +
    'soft blur is edit_item adjustments.blur; vignette, film grain and halation are edit_item grade; ' +
    'brightness, contrast, saturation, sepia and greyscale are adjustments or grade. ' +
    `Effects draw on picture clips only (${EFFECT_ITEM_KINDS.join(', ')}); a title or an audio clip is refused. ` +
    'Give `operations`, applied in order as one undo step; if any one is refused nothing changes. ' +
    'Every value is checked against its range and a refusal says the range. The result is the whole ' +
    'stack with each effect\'s id — use those ids for update, move and remove — and says which effects ' +
    'will actually draw (one switched off, or at an amount of 0, runs no pass). Lengths in px are ' +
    'timeline pixels, so they are the same share of the picture at any export size. After editing, ' +
    'look with preview_frame: it reports under gradeWarnings if an effect could not run. ' +
    'inspect_item reports a clip\'s current effects.\n\nThe effects:\n' +
    describeCatalog(),
  category: 'write',
  readOnly: false,
  dryRunnable: true,
  inputSchema: {
    type: 'object',
    properties: {
      itemId: {
        type: 'string',
        description: 'The clip, from read_project. The first 10 characters are enough.'
      },
      operations: {
        type: 'array',
        minItems: 1,
        description:
          'What to do, in order. add: { "op": "add", "kind": "glow", "params": { "amount": 0.8 } } — ' +
          'params left out take their defaults; "index" places it (0 is drawn first), otherwise it goes last; ' +
          '"enabled": false adds it switched off. update: { "op": "update", "effectId": "fx_…", "params": { … } } — ' +
          'params merge over what the effect has; "enabled": false bypasses it and true switches it back on. ' +
          'move: { "op": "move", "effectId": "fx_…", "toIndex": 0 }. remove: { "op": "remove", "effectId": "fx_…" }. ' +
          `clear: { "op": "clear" } removes every effect. A clip takes at most ${MAX_EFFECTS}.`,
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: [...EFFECT_OPS] },
            kind: { type: 'string', enum: [...EFFECT_KINDS], description: 'For add: which effect.' },
            effectId: { type: 'string', description: 'For update, move and remove: an effect id from this tool\'s result or inspect_item. A prefix is enough.' },
            params: { type: 'object', description: 'For add and update: parameter values by name, as listed for the effect.' },
            enabled: { type: 'boolean', description: 'For add and update: false bypasses the effect without removing it.' },
            index: { type: 'integer', minimum: 0, description: 'For add: position in the stack; 0 is drawn first.' },
            toIndex: { type: 'integer', minimum: 0, description: 'For move: the position to move to; 0 is drawn first.' }
          },
          required: ['op']
        }
      }
    },
    required: ['itemId', 'operations']
  }
}
