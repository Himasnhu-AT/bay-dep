import { EFFECT_EPSILON, num, type EffectSpec } from './spec'

export const order = 10

export const effect: EffectSpec = {
  kind: 'directional-blur',
  label: 'Directional Blur',
  category: 'blur',
  description:
    'Smears the picture along one line, like a camera moving during the exposure. For speed, a whip-pan feel, or streaking a background. For an even soft blur use adjustments.blur instead.',
  params: {
    length: {
      type: 'number', label: 'Length', min: 0, max: 400, step: 0.5, default: 24, unit: 'px',
      description: 'How far the smear runs, in timeline pixels. 0 is off.'
    },
    angle: {
      type: 'number', label: 'Angle', min: -180, max: 180, step: 1, default: 0, unit: '°',
      description: 'Direction of the smear. 0 is horizontal, 90 vertical.'
    }
  },
  isIdentity: (p) => num(p, 'length') <= EFFECT_EPSILON
}
