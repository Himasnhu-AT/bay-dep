import { EFFECT_EPSILON, num, type EffectSpec } from './spec'

export const order = 80

export const effect: EffectSpec = {
  kind: 'duotone',
  label: 'Duotone',
  category: 'colour',
  description:
    'Maps the picture\'s brightness onto two colours: dark areas take one, bright areas the other. For a poster or brand look. For monochrome use adjustments.grayscale.',
  params: {
    shadows: {
      type: 'color', label: 'Shadows', default: '#1B1464',
      description: 'The colour black becomes.'
    },
    highlights: {
      type: 'color', label: 'Highlights', default: '#F7C948',
      description: 'The colour white becomes.'
    },
    amount: {
      type: 'number', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1,
      description: 'Mix with the original. 0 is off, 1 is fully duotone.'
    }
  },
  isIdentity: (p) => num(p, 'amount') <= EFFECT_EPSILON
}
