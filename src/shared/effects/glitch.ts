import { EFFECT_EPSILON, num, type EffectSpec } from './spec'

export const order = 70

export const effect: EffectSpec = {
  kind: 'glitch',
  label: 'Glitch',
  category: 'stylize',
  description:
    'Digital tearing: horizontal bands jump sideways with their red and blue split, changing every few frames. The pattern is a function of the timeline frame and the seed, so the same frame always tears the same way. For an impact, a transition accent or a broken-signal look; keep it to a short clip.',
  params: {
    amount: {
      type: 'number', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.5,
      description: 'How many bands tear and how far. 0 is off, 1 tears every band.'
    },
    blockSize: {
      type: 'number', label: 'Band height', caption: 'Band', min: 2, max: 400, step: 1, default: 40, unit: 'px',
      description: 'Height of one band, in timeline pixels.'
    },
    hold: {
      type: 'number', label: 'Hold', min: 1, max: 60, step: 1, default: 3, unit: 'f',
      description: 'How many frames each pattern stays before the next. 1 changes every frame.'
    },
    rgbSplit: {
      type: 'number', label: 'RGB split', min: 0, max: 100, step: 0.5, default: 8, unit: 'px',
      description: 'How far red and blue separate inside a torn band, in timeline pixels.'
    },
    seed: {
      type: 'number', label: 'Seed', min: 0, max: 9999, step: 1, default: 0,
      description: 'Any whole number; a different seed is a different pattern.'
    }
  },
  isIdentity: (p) => num(p, 'amount') <= EFFECT_EPSILON
}
