import { EFFECT_EPSILON, num, type EffectSpec } from './spec'

export const order = 90

export const effect: EffectSpec = {
  kind: 'tint',
  label: 'Tint',
  category: 'colour',
  description:
    'Colourises toward one colour while black stays black and white stays white. For a wash of one hue over a clip. For colour correction use grade; for sepia use adjustments.sepia.',
  params: {
    color: {
      type: 'color', label: 'Colour', default: '#FF9A3C',
      description: 'The colour the midtones take.'
    },
    amount: {
      type: 'number', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.5,
      description: 'Mix with the original. 0 is off.'
    }
  },
  isIdentity: (p) => num(p, 'amount') <= EFFECT_EPSILON
}
