import type { EffectSpec } from './spec'

export const order = 120

export const effect: EffectSpec = {
  kind: 'chroma-key',
  label: 'Chroma Key',
  category: 'key',
  description:
    'Green screen: makes one colour transparent so the tracks beneath show through, and takes that colour\'s cast off what is left. Put the keyed clip on a track above its background. Set color to the screen\'s actual colour (look at a preview_frame), raise similarity until the screen is gone, then smoothness to soften the edge. Effects after it in the stack see the keyed picture.',
  params: {
    color: {
      type: 'color', label: 'Key colour', caption: 'Key', default: '#00B140',
      description: 'The screen colour to remove.'
    },
    similarity: {
      type: 'number', label: 'Similarity', min: 0, max: 1, step: 0.005, default: 0.2,
      description: 'How far from the key colour (in chroma) still counts as screen. Higher removes more; too high eats the subject.'
    },
    smoothness: {
      type: 'number', label: 'Smoothness', caption: 'Smooth', min: 0, max: 1, step: 0.005, default: 0.08,
      description: 'Width of the soft edge between removed and kept. 0 is a hard edge.'
    },
    spill: {
      type: 'number', label: 'Spill suppression', caption: 'Spill', min: 0, max: 1, step: 0.01, default: 0.5,
      description: 'How much of the key colour\'s cast is taken off the kept picture. 0 leaves it.'
    }
  },
  // Even at similarity 0 a pixel of exactly the key colour goes transparent.
  isIdentity: () => false
}
