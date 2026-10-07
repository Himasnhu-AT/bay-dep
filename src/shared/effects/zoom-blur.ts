import { EFFECT_EPSILON, num, type EffectSpec } from './spec'

export const order = 20

export const effect: EffectSpec = {
  kind: 'zoom-blur',
  label: 'Zoom Blur',
  category: 'blur',
  description:
    'Streaks the picture outward from a point, like zooming the lens during the exposure. For a punch-in hit, a speed burst, or pulling the eye to one spot — the centre stays sharp.',
  params: {
    amount: {
      type: 'number', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.2,
      description: 'How long the streaks are, as a share of the distance to the centre. 0 is off.'
    },
    centre: {
      type: 'point', label: 'Centre', default: [0.5, 0.5],
      description: 'The point that stays sharp, [x, y] from the top-left of the clip, each 0..1.'
    }
  },
  isIdentity: (p) => num(p, 'amount') <= EFFECT_EPSILON
}
