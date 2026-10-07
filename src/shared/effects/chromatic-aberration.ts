import { EFFECT_EPSILON, num, type EffectSpec } from './spec'

export const order = 50

export const effect: EffectSpec = {
  kind: 'chromatic-aberration',
  label: 'Chromatic Aberration',
  category: 'stylize',
  description:
    'Splits red and blue apart from green (RGB split). Radial, it grows toward the edges like a cheap lens; otherwise it shifts the whole frame along an angle. For a lens look, an impact frame, or a glitch accent.',
  params: {
    amount: {
      type: 'number', label: 'Amount', min: 0, max: 100, step: 0.5, default: 6, unit: 'px',
      description: 'How far red and blue move apart, in timeline pixels (at the frame edge when radial). 0 is off.'
    },
    angle: {
      type: 'number', label: 'Angle', min: -180, max: 180, step: 1, default: 0, unit: '°',
      description: 'Direction of the split when radial is false. 0 is horizontal.'
    },
    radial: {
      type: 'boolean', label: 'Radial', default: true,
      description: 'true: no split at the centre, growing to the edges. false: the same split everywhere, along angle.'
    }
  },
  isIdentity: (p) => num(p, 'amount') <= EFFECT_EPSILON
}
