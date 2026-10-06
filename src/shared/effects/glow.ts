import { EFFECT_EPSILON, num, type EffectSpec } from './spec'

export const order = 40

export const effect: EffectSpec = {
  kind: 'glow',
  label: 'Glow',
  category: 'stylize',
  description:
    'Bloom: the bright parts of the picture are blurred and screened back over it, and spread past the edge of a keyed or transparent clip. For a dreamy look, neon, or lights that bleed. grade.halation is the film-emulation version, fixed in the grade\'s order; use glow when it must come after another effect, or take its colour from the picture.',
  params: {
    amount: {
      type: 'number', label: 'Amount', min: 0, max: 2, step: 0.01, default: 0.6,
      description: 'How bright the glow is. 0 is off.'
    },
    radius: {
      type: 'number', label: 'Radius', min: 0.5, max: 200, step: 0.5, default: 16, unit: 'px',
      description: 'How far the glow spreads (Gaussian sigma), in timeline pixels.'
    },
    threshold: {
      type: 'number', label: 'Threshold', min: 0, max: 0.99, step: 0.01, default: 0.6,
      description: 'How bright a pixel must be to glow. 0 makes everything glow, 0.9 only highlights.'
    },
    color: {
      type: 'color', label: 'Tint', default: '#FFFFFF',
      description: 'Multiplies the glow\'s colour. White keeps the picture\'s own colours.'
    }
  },
  isIdentity: (p) => num(p, 'amount') <= EFFECT_EPSILON
}
